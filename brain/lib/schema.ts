import type Database from "better-sqlite3";

// Schema-as-code, applied idempotently on every open (workingmemory pattern).
//
// Two families of table, deliberately not merged (see
// ai/plans/2026-07-30-phase2-library-search.md):
//   items — captures. Irreplaceable: raw gzipped HTML, triage, kept/exported state.
//   docs  — the index over files on disk. Disposable; rebuildable from the vault at
//           any time, so `DELETE FROM docs` must always be a safe operation. Keeping
//           it out of `items` is what makes reindexing risk-free.

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS items (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL DEFAULT 'article',
  url            TEXT,
  url_hash       TEXT UNIQUE,
  title          TEXT,
  author         TEXT,
  site           TEXT,
  status         TEXT NOT NULL DEFAULT 'inbox',
  extract_status TEXT NOT NULL DEFAULT 'pending',
  extract_error  TEXT,
  content_md     TEXT,
  word_count     INTEGER,
  summary        TEXT,
  published_at   TEXT,
  saved_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at        TEXT,
  kept_at        TEXT,
  exported_at    TEXT,
  vault_file     TEXT
);

CREATE TABLE IF NOT EXISTS item_content (
  item_id  TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  raw_html BLOB
);

CREATE TABLE IF NOT EXISTS item_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type    TEXT NOT NULL,
  at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- The library index: one row per markdown file on disk (vault + Notes export).
CREATE TABLE IF NOT EXISTS docs (
  id           TEXT PRIMARY KEY,
  source       TEXT NOT NULL,             -- 'vault' | 'notes'
  rel_path     TEXT NOT NULL UNIQUE,      -- identity; reindex updates in place
  abs_path     TEXT NOT NULL,
  area         TEXT,                      -- PARA area, or the Notes folder
  title        TEXT,
  summary      TEXT,                      -- from vault frontmatter, when present
  body         TEXT,                      -- full text, frontmatter + HTML stripped
  word_count   INTEGER,
  -- 'ok' | 'unreadable'. iCloud evicts file contents while leaving a stat-able
  -- stub, so a file can exist, report a size, and still fail to open. Skipping
  -- those silently would leave the index quietly incomplete.
  index_status TEXT NOT NULL DEFAULT 'ok',
  index_error  TEXT,
  mtime        TEXT,                      -- lets reindex skip unchanged files
  indexed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- External-content FTS5: the text lives in docs, the index only points at it,
-- so 4.8 MB of notes isn't stored twice.
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
  title, body, content='docs', content_rowid='rowid', tokenize='unicode61'
);

CREATE INDEX IF NOT EXISTS idx_items_status ON items(status, saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_item ON item_events(item_id, id);
CREATE INDEX IF NOT EXISTS idx_docs_area ON docs(source, area);
CREATE INDEX IF NOT EXISTS idx_docs_mtime ON docs(mtime DESC);
`;

// History is written only by triggers, never by app code (workingmemory rule).
// Trigger names are versioned: to change a body, drop the _v1 and create a _v2.
const CREATE_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS items_saved_v1
AFTER INSERT ON items BEGIN
  INSERT INTO item_events (item_id, type) VALUES (new.id, 'saved');
END;

CREATE TRIGGER IF NOT EXISTS items_status_v1
AFTER UPDATE OF status ON items WHEN new.status IS NOT old.status BEGIN
  INSERT INTO item_events (item_id, type) VALUES (new.id, new.status);
END;

CREATE TRIGGER IF NOT EXISTS items_read_v1
AFTER UPDATE OF read_at ON items WHEN new.read_at IS NOT NULL AND old.read_at IS NULL BEGIN
  INSERT INTO item_events (item_id, type) VALUES (new.id, 'read');
END;

CREATE TRIGGER IF NOT EXISTS items_exported_v1
AFTER UPDATE OF exported_at ON items WHEN new.exported_at IS NOT NULL AND old.exported_at IS NULL BEGIN
  INSERT INTO item_events (item_id, type) VALUES (new.id, 'exported');
END;

-- Keep docs_fts in lockstep with docs. External-content FTS5 tables don't
-- self-maintain; the 'delete' command must replay the OLD values or the index
-- keeps stale terms forever.
CREATE TRIGGER IF NOT EXISTS docs_fts_insert_v1
AFTER INSERT ON docs BEGIN
  INSERT INTO docs_fts (rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;

CREATE TRIGGER IF NOT EXISTS docs_fts_delete_v1
AFTER DELETE ON docs BEGIN
  INSERT INTO docs_fts (docs_fts, rowid, title, body)
  VALUES ('delete', old.rowid, old.title, old.body);
END;

CREATE TRIGGER IF NOT EXISTS docs_fts_update_v1
AFTER UPDATE ON docs BEGIN
  INSERT INTO docs_fts (docs_fts, rowid, title, body)
  VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO docs_fts (rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
`;

// `CREATE TABLE IF NOT EXISTS` can't add a column to an existing table, so
// additive changes go here (workingmemory's migrateDb pattern): check
// pragma table_info first, so re-running is a no-op and a live DB self-migrates
// on the next open — no migration runner, no version table.
const ADDED_COLUMNS: Array<{ table: string; column: string; ddl: string }> = [
  // Why the article matters given the owner's current work (see lib/context.ts).
  { table: "items", column: "relevance", ddl: "ALTER TABLE items ADD COLUMN relevance TEXT" },
];

function migrateDb(db: Database.Database) {
  for (const { table, column, ddl } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) db.exec(ddl);
  }
}

export function applySchema(db: Database.Database) {
  db.exec(CREATE_TABLES);
  migrateDb(db);
  db.exec(CREATE_TRIGGERS);
}
