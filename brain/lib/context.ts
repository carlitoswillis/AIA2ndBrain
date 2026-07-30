import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { maybeRefreshWmContext, readWmContextCache, wmSnapshotPath } from "./wm-remote";

// Personal Context Management (Forte, 2026): a second brain is curated context
// for AI, not just a filing cabinet. The owner's live task board lives in the
// sibling Working Memory app, so triage can judge an article against what he is
// actually working on this week instead of summarizing into a vacuum.
//
// Strictly read-only, strictly optional: if the DB is missing, locked, or has
// moved, context is null and triage degrades to a generic summary.
//
// Freshness: the hosted Working Memory instance is the source of truth, so
// when WM_URL + WM_OWNER_SECRET are set, lib/wm-remote.ts keeps a verified
// snapshot of the DEPLOYED DB (TTL'd, refreshed in the background) and that
// snapshot is preferred. WM_DB_PATH explicitly overrides; the local dev file
// is the last resort. The staleness guard below still applies to all three —
// wrong-but-confident context is worse than none.

const DEFAULT_WM_DB = path.join(
  os.homedir(),
  "workspace/workingmemory/data/owner/wm.db"
);

// Working Memory's default list ids, in the order a human would read them.
// Anything else (custom lists) sorts last but is still included.
const LIST_ORDER: Record<string, number> = {
  today: 1,
  focus: 2,
  waiting: 3,
  backlog: 4,
  braindump: 5,
};

const MAX_ITEMS = 40;
const MAX_CHARS = 1800;
const CACHE_MS = 60_000;

// Past this, the snapshot is presumed stale and NOT injected — a confidently
// wrong "bears on: X" is worse than a generic summary. Raise via env if the
// pull cadence changes.
const STALE_HOURS = Number(process.env.WM_STALE_HOURS || 48);

export type ContextItem = { list: string; label: string; text: string };

type Snapshot = { items: ContextItem[]; asOf: string | null };

let cache: { at: number; snapshot: Snapshot } | null = null;

export function wmDbPath(): string {
  return process.env.WM_DB_PATH || wmSnapshotPath() || DEFAULT_WM_DB;
}

/**
 * The hosted DB is multi-tenant (open signup), so "most recently touched
 * board" without a user filter could be a stranger's. The owner is the account
 * NAMED "owner" (WM_OWNER_USERNAME overrides) — pinned by name, not inferred;
 * first-created is only the last-resort fallback. Local/demo DBs have an empty
 * users table and null user_ids — no scoping needed, return null.
 */
function ownerId(db: Database.Database): string | null {
  try {
    const count = (db.prepare("SELECT count(*) AS c FROM users").get() as { c: number }).c;
    if (!count) return null;
    const username = process.env.WM_OWNER_USERNAME ?? "owner";
    const row = ((db.prepare("SELECT id FROM users WHERE username = ?").get(username) ??
      db.prepare("SELECT id FROM users ORDER BY created_at LIMIT 1").get()) as
      | { id: string }
      | undefined);
    return row?.id ?? null;
  } catch {
    return null; // pre-accounts schema — single tenant
  }
}

/**
 * Open items from the most recently touched board. Never throws — a broken
 * sibling app must not be able to break capture.
 */
export function readCurrentContext(): Snapshot {
  // Kick a background refresh (scoped /api/context when bridged, else the
  // full-snapshot fallback) — never blocks this read; the next one benefits.
  maybeRefreshWmContext();

  if (cache && Date.now() - cache.at < CACHE_MS) return cache.snapshot;

  // Preferred source: the scoped context cache from WM's GET /api/context —
  // already owner-scoped and label-resolved by WM itself.
  //
  // If the cache exists it wins even when it holds zero items: an empty board
  // is a legitimate state (everything done), and falling through to the local
  // dev file would resurrect months-old items and present them as current.
  // Authoritatively-empty beats stale-and-plausible.
  const bridged = readWmContextCache();
  if (bridged) {
    const snapshot = { items: bridged.items.slice(0, MAX_ITEMS), asOf: bridged.asOf };
    cache = { at: Date.now(), snapshot };
    return snapshot;
  }

  let items: ContextItem[] = [];
  let asOf: string | null = null;
  try {
    const file = wmDbPath();
    if (fs.existsSync(file)) {
      // readonly + immutable-free: we tolerate a stale read rather than fight
      // Working Memory for the WAL.
      const db = new Database(file, { readonly: true, fileMustExist: true });
      try {
        const owner = ownerId(db);
        // Every board (incl. "Personal") is a real boards row, so scope to the
        // board the owner most recently WROTE to — their live daily loop, not a
        // stranger's (open signup) and not a dormant shared board. Legacy DBs
        // (pre-boards) fall back to board_id NULL + user_id, then to unscoped.
        let scope = "1 = 1";
        let scopeArgs: string[] = [];
        if (owner) {
          const board = db
            .prepare(
              `SELECT board_id AS b FROM items
                WHERE user_id = ? AND board_id IS NOT NULL
                GROUP BY board_id ORDER BY MAX(updated_at) DESC LIMIT 1`
            )
            .get(owner) as { b: string } | undefined;
          if (board) {
            scope = "i.board_id = ?";
            scopeArgs = [board.b];
          } else {
            scope = "i.board_id IS NULL AND i.user_id = ?";
            scopeArgs = [owner];
          }
        }

        // Freshness is the newest write in the scoped set, not the file mtime —
        // a pull rewrites the file without making the data any newer.
        asOf =
          (
            db
              .prepare(`SELECT MAX(updated_at) AS m FROM items i WHERE ${scope}`)
              .get(...scopeArgs) as { m: string | null }
          ).m ?? null;

        const rows = db
          .prepare(
            `SELECT i.list AS list, COALESCE(l.label, i.list) AS label, i.text AS text
               FROM items i
               LEFT JOIN lists l ON l.id = i.list AND l.board_id IS i.board_id
              WHERE ${scope} AND i.archived = 0 AND i.done = 0
                AND i.text IS NOT NULL AND TRIM(i.text) <> ''
              ORDER BY i.position`
          )
          .all(...scopeArgs) as ContextItem[];

        items = rows
          .sort(
            (a, b) =>
              (LIST_ORDER[a.list] ?? 9) - (LIST_ORDER[b.list] ?? 9)
          )
          .slice(0, MAX_ITEMS);
      } finally {
        db.close();
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`current-context unavailable: ${message}`);
    items = [];
    asOf = null;
  }

  const snapshot = { items, asOf };
  cache = { at: Date.now(), snapshot };
  return snapshot;
}

export function contextAgeHours(asOf: string | null): number | null {
  if (!asOf) return null;
  const ms = Date.parse(asOf);
  if (Number.isNaN(ms)) return null;
  return (Date.now() - ms) / 3_600_000;
}

/** The block injected into the triage prompt, or null when there's nothing. */
export function buildContextBlock(): string | null {
  const { items, asOf } = readCurrentContext();
  if (items.length === 0) return null;

  // Stale context is not neutral — it makes the model assert connections to work
  // the reader may have finished days ago. Withhold it instead.
  const age = contextAgeHours(asOf);
  if (age !== null && age > STALE_HOURS) {
    console.warn(
      `current-context is ${Math.round(age)}h old (> ${STALE_HOURS}h) — not injecting`
    );
    return null;
  }

  const groups = new Map<string, string[]>();
  for (const item of items) {
    const list = groups.get(item.label) ?? [];
    list.push(item.text.replace(/\s+/g, " ").trim().slice(0, 90));
    groups.set(item.label, list);
  }

  const lines: string[] = [];
  for (const [label, texts] of groups) {
    lines.push(`${label}: ${texts.join(" · ")}`);
  }

  return [
    "THE READER'S CURRENT WORK (from their task board — this is what they are",
    "actually doing right now, most urgent list first):",
    ...lines,
  ]
    .join("\n")
    .slice(0, MAX_CHARS);
}

/** For the UI footnote — how much context is in play, and how old it is. */
export function contextSummary(): {
  count: number;
  source: string;
  asOf: string | null;
  ageHours: number | null;
  stale: boolean;
} {
  const { items, asOf } = readCurrentContext();
  const ageHours = contextAgeHours(asOf);
  // Name the source that was actually used, not the DB path we might have
  // fallen back to — "which of three sources am I reading?" is the first
  // question when the context looks wrong.
  const source = readWmContextCache()
    ? `${process.env.WM_URL ?? "working memory"} /api/context`
    : wmDbPath();
  return {
    count: items.length,
    source,
    asOf,
    ageHours,
    stale: ageHours !== null && ageHours > STALE_HOURS,
  };
}
