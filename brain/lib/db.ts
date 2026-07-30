import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { applySchema } from "./schema";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

declare global {
  // eslint-disable-next-line no-var
  var __brainDb: Database.Database | undefined;
}

// Connection reused across dev hot-reloads via a global (workingmemory pattern).
export function getDb(): Database.Database {
  if (!global.__brainDb) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const db = new Database(path.join(DATA_DIR, "brain.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    applySchema(db);
    global.__brainDb = db;
  }
  return global.__brainDb;
}

export type Item = {
  id: string;
  kind: string;
  url: string | null;
  url_hash: string | null;
  title: string | null;
  author: string | null;
  site: string | null;
  status: "inbox" | "kept";
  extract_status: "pending" | "ok" | "failed";
  extract_error: string | null;
  content_md: string | null;
  word_count: number | null;
  summary: string | null;
  published_at: string | null;
  saved_at: string;
  read_at: string | null;
  kept_at: string | null;
  exported_at: string | null;
  vault_file: string | null;
};
