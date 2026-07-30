import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// Pulls a verified snapshot of the DEPLOYED Working Memory DB (the source of
// truth) so triage context is hours-fresh instead of as-old-as-the-last-backup.
// Same contract as scripts/pull-backup.sh in the WM repo: GET /api/export with
// the owner bearer, verify before trusting, promote atomically.
//
// Read-only by design: this file never writes anything back to Working Memory.
// (The only remote write WM exposes is PUT /api/import, which replaces the
// entire DB — a disaster-recovery tool, not a sync channel.)

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const SNAPSHOT = path.join(DATA_DIR, "wm-remote", "wm.db");
const CONTEXT_JSON = path.join(DATA_DIR, "wm-remote", "context.json");
const TTL_MS = Number(process.env.WM_FETCH_TTL_MIN || 15) * 60_000;
const FETCH_TIMEOUT_MS = 20_000; // Render cold start headroom; uptime ping keeps it rare
const SQLITE_MAGIC = "SQLite format 3 ";

let inFlight: Promise<void> | null = null;
let contextInFlight: Promise<void> | null = null;

export function wmRemoteConfigured(): boolean {
  return !!(process.env.WM_URL && process.env.WM_OWNER_SECRET);
}

// The scoped bridge (WM's GET /api/context + POST /api/items, BRAIN_TOKEN) —
// preferred over /api/export because it never moves the multi-account DB or
// OWNER_SECRET around.
export function wmBridgeConfigured(): boolean {
  return !!(process.env.WM_URL && process.env.WM_BRAIN_TOKEN);
}

export type WmContextCache = {
  fetchedAt: string;
  board: { id: string; name: string | null } | null;
  asOf: string | null;
  items: { list: string; label: string; text: string }[];
};

/** The cached /api/context payload, or null if absent/unreadable. */
export function readWmContextCache(): WmContextCache | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONTEXT_JSON, "utf8")) as WmContextCache;
    return Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget refresh of the scoped context cache. If the endpoint isn't
 * live yet (WM not redeployed with BRAIN_TOKEN), falls back to refreshing the
 * full snapshot so context keeps flowing during the transition.
 */
export function maybeRefreshWmContext(): void {
  if (!wmBridgeConfigured()) {
    maybeRefreshWmSnapshot();
    return;
  }
  if (contextInFlight) return;
  try {
    const st = fs.statSync(CONTEXT_JSON);
    if (Date.now() - st.mtimeMs < TTL_MS) return;
  } catch {
    // no cache yet — fetch one
  }
  contextInFlight = refreshContext()
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`wm context refresh failed (${message}) — falling back to snapshot`);
      maybeRefreshWmSnapshot();
    })
    .finally(() => {
      contextInFlight = null;
    });
}

async function refreshContext(): Promise<void> {
  const base = process.env.WM_URL!.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/context`, {
    headers: { authorization: `Bearer ${process.env.WM_BRAIN_TOKEN}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GET /api/context: HTTP ${res.status}`);
  const payload = (await res.json()) as Omit<WmContextCache, "fetchedAt">;
  if (!Array.isArray(payload.items)) throw new Error("unexpected /api/context shape");

  fs.mkdirSync(path.dirname(CONTEXT_JSON), { recursive: true });
  const tmp = `${CONTEXT_JSON}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({ fetchedAt: new Date().toISOString(), ...payload })
  );
  fs.renameSync(tmp, CONTEXT_JSON);
  console.log(`wm context refreshed (${payload.items.length} items)`);
}

/** The managed snapshot file, or null if none has been fetched yet. */
export function wmSnapshotPath(): string | null {
  return fs.existsSync(SNAPSHOT) ? SNAPSHOT : null;
}

export function wmSnapshotFetchedAt(): Date | null {
  try {
    return fs.statSync(SNAPSHOT).mtime;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget refresh when the snapshot is past its TTL. Never blocks the
 * caller and never throws — capture latency must not depend on Render.
 */
export function maybeRefreshWmSnapshot(): void {
  if (!wmRemoteConfigured() || inFlight) return;
  try {
    const st = fs.statSync(SNAPSHOT);
    if (Date.now() - st.mtimeMs < TTL_MS) return;
  } catch {
    // no snapshot yet — fetch one
  }
  inFlight = refresh()
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`wm snapshot refresh failed (keeping previous): ${message}`);
    })
    .finally(() => {
      inFlight = null;
    });
}

async function refresh(): Promise<void> {
  const base = process.env.WM_URL!.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/export`, {
    headers: { authorization: `Bearer ${process.env.WM_OWNER_SECRET}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GET /api/export: HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100 || !buf.subarray(0, 16).equals(Buffer.from(SQLITE_MAGIC, "latin1"))) {
    throw new Error("response is not a SQLite database");
  }

  // Verify on a tmp file before promoting — an unverified backup is a hope.
  fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
  const tmp = `${SNAPSHOT}.tmp`;
  fs.writeFileSync(tmp, buf);
  const db = new Database(tmp, { readonly: true });
  try {
    const ic = db.prepare("pragma integrity_check").get() as { integrity_check: string };
    if (ic.integrity_check !== "ok") throw new Error("integrity_check failed");
    db.prepare("SELECT count(*) FROM items").get();
  } finally {
    db.close();
  }
  fs.renameSync(tmp, SNAPSHOT);
  console.log(`wm snapshot refreshed from ${base} (${(buf.length / 1024).toFixed(0)} KB)`);
}
