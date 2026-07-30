import type Database from "better-sqlite3";

// Schema-as-code, applied idempotently on every open (workingmemory pattern).
// items is deliberately general (kind: article | note) so phase 2 (library/index)
// extends this table instead of renaming it.

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

CREATE INDEX IF NOT EXISTS idx_items_status ON items(status, saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_item ON item_events(item_id, id);
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
`;

export function applySchema(db: Database.Database) {
  db.exec(CREATE_TABLES);
  db.exec(CREATE_TRIGGERS);
}
