import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "./db";
import { deriveTitle, parseMarkdownFile, stripHtml } from "./markdown-file";

// The library index. Files on disk are the source of truth; this table is a lens
// over them and can be rebuilt at any time. Nothing here ever writes to the vault.

const VAULT_ROOT =
  process.env.VAULT_ROOT ||
  path.join(os.homedir(), "Library/Mobile Documents/com~apple~CloudDocs/SecondBrain");

// The Apple Notes export (Exporter.app output) that lives in the repo.
const NOTES_ROOT =
  process.env.NOTES_ROOT || path.join(process.cwd(), "..", "Notes");

const VAULT_AREAS = ["Projects", "Areas", "Resources", "Archives", "Reviews"];
const NOTES_SUBDIRS = ["iCloud"];

// "Failed Exports" is Exporter.app's own reject pile — indexing it would surface
// known-broken duplicates of notes that exported fine elsewhere.
const SKIP_DIRS = new Set(["Failed Exports", "attachments", "images", ".git", "node_modules"]);

export type IndexStats = {
  scanned: number;
  inserted: number;
  updated: number;
  unchanged: number;
  unreadable: number;
  removed: number;
  ms: number;
};

function* walkMarkdown(root: string): Generator<string> {
  if (!fs.existsSync(root)) return;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) yield full;
    }
  }
}

function isoMtime(file: string): string | null {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * Rebuilds the index from disk. Unchanged files (same mtime) are left alone, so
 * a re-run is cheap. Rows whose file has disappeared are deleted.
 */
export function reindex(): IndexStats {
  const started = Date.now();
  const db = getDb();
  const stats: IndexStats = {
    scanned: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    unreadable: 0,
    removed: 0,
    ms: 0,
  };

  const existing = new Map(
    (
      db.prepare("SELECT rel_path, mtime, index_status FROM docs").all() as {
        rel_path: string;
        mtime: string | null;
        index_status: string;
      }[]
    ).map((r) => [r.rel_path, r])
  );
  const seen = new Set<string>();

  const insert = db.prepare(
    `INSERT INTO docs (id, source, rel_path, abs_path, area, title, summary, body,
                       word_count, index_status, index_error, mtime, indexed_at)
     VALUES (@id, @source, @rel_path, @abs_path, @area, @title, @summary, @body,
             @word_count, @index_status, @index_error, @mtime,
             strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  );
  const update = db.prepare(
    `UPDATE docs
        SET abs_path = @abs_path, area = @area, title = @title, summary = @summary,
            body = @body, word_count = @word_count, index_status = @index_status,
            index_error = @index_error, mtime = @mtime,
            indexed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE rel_path = @rel_path`
  );

  const sources: Array<{ source: "vault" | "notes"; root: string; tops: string[] }> = [
    { source: "vault", root: VAULT_ROOT, tops: VAULT_AREAS },
    { source: "notes", root: NOTES_ROOT, tops: NOTES_SUBDIRS },
  ];

  const work = db.transaction(() => {
    // A root that doesn't exist means misconfiguration (or a folder that moved),
    // NOT that every file was deleted. Without this, one bad path turns Reindex
    // into "wipe 4,327 rows".
    const liveSources = new Set<string>(
      sources.filter((s) => fs.existsSync(s.root)).map((s) => s.source)
    );
    for (const { source, root } of sources) {
      if (!liveSources.has(source)) {
        console.warn(
          `index root missing for '${source}' (${root}) — keeping its existing rows ` +
            `instead of treating them as deleted. Check VAULT_ROOT / NOTES_ROOT.`
        );
      }
    }

    for (const { source, root, tops } of sources) {
      for (const top of tops) {
        for (const file of walkMarkdown(path.join(root, top))) {
          stats.scanned += 1;
          const relPath = `${source}/${path.relative(root, file)}`;
          seen.add(relPath);

          const mtime = isoMtime(file);
          const prior = existing.get(relPath);
          // Skip untouched files — but always retry ones that failed to read,
          // since an iCloud download changes readability without changing mtime.
          if (prior && prior.mtime === mtime && prior.index_status === "ok") {
            stats.unchanged += 1;
            continue;
          }

          let raw: string | null = null;
          let error: string | null = null;
          try {
            raw = fs.readFileSync(file, "utf8");
          } catch (err) {
            error = err instanceof Error ? err.message : String(err);
          }

          let row;
          if (raw === null) {
            // iCloud eviction: the file stats fine and reports a size, but its
            // contents live in the cloud. Record it so the gap is visible.
            stats.unreadable += 1;
            row = {
              id: crypto.randomUUID(),
              source,
              rel_path: relPath,
              abs_path: file,
              area: path.relative(root, file).split(path.sep)[0] || null,
              title: path.basename(file, ".md"),
              summary: null,
              body: null,
              word_count: null,
              index_status: "unreadable",
              index_error: error,
              mtime,
            };
          } else {
            const { meta, body } = parseMarkdownFile(raw);
            const clean = stripHtml(body);
            const relative = path.relative(root, file).split(path.sep);
            row = {
              id: crypto.randomUUID(),
              source,
              rel_path: relPath,
              abs_path: file,
              // Vault notes declare their area in frontmatter; for the Notes
              // export the containing folder is all there is.
              area: meta.area || (source === "notes" ? relative[1] : relative[0]) || null,
              title: deriveTitle(meta, clean, path.basename(file)),
              summary: meta.summary || null,
              body: clean,
              word_count: clean ? clean.split(/\s+/).length : 0,
              index_status: "ok",
              index_error: null,
              mtime,
            };
          }

          if (prior) {
            update.run(row);
            stats.updated += 1;
          } else {
            insert.run(row);
            stats.inserted += 1;
          }
        }
      }
    }

    // Files deleted on disk leave the index; the triggers clean up docs_fts.
    // Only ever prune sources whose root was actually readable this run.
    const remove = db.prepare("DELETE FROM docs WHERE rel_path = ?");
    for (const relPath of existing.keys()) {
      const source = relPath.split("/")[0];
      if (!liveSources.has(source)) continue;
      if (!seen.has(relPath)) {
        remove.run(relPath);
        stats.removed += 1;
      }
    }
  });

  work();
  stats.ms = Date.now() - started;
  return stats;
}

export function indexHealth(): {
  total: number;
  unreadable: number;
  lastIndexedAt: string | null;
  roots: { vault: string; notes: string };
} {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN index_status <> 'ok' THEN 1 ELSE 0 END) AS unreadable,
              MAX(indexed_at) AS last
         FROM docs`
    )
    .get() as { total: number; unreadable: number | null; last: string | null };

  return {
    total: row.total,
    unreadable: row.unreadable ?? 0,
    lastIndexedAt: row.last,
    roots: { vault: VAULT_ROOT, notes: NOTES_ROOT },
  };
}
