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
const TTL_MS = Number(process.env.WM_FETCH_TTL_MIN || 15) * 60_000;
const FETCH_TIMEOUT_MS = 20_000; // Render cold start headroom; uptime ping keeps it rare
const SQLITE_MAGIC = "SQLite format 3 ";

let inFlight: Promise<void> | null = null;

export function wmRemoteConfigured(): boolean {
  return !!(process.env.WM_URL && process.env.WM_OWNER_SECRET);
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
