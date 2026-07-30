import crypto from "node:crypto";
import zlib from "node:zlib";
import { getDb, type Item } from "./db";
import { fetchAndExtract } from "./extract";
import { triage } from "./llm";

// Reliability rule: the row is inserted BEFORE any network work. A fetch
// timeout, a bad extractor, a dead Gemini key — none of them can lose the URL.

const TRACKING_PARAMS = [
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "ref_src",
  "s",
  "spm",
];

export function normalizeUrl(input: string): { url: string; hash: string } {
  const raw = (input || "").trim();
  if (!raw) throw new Error("No URL provided");

  // An explicit non-http scheme is a rejection, not something to prefix.
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme && !/^https?$/i.test(scheme[1])) {
    throw new Error("Only http(s) URLs are supported");
  }

  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("Not a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are supported");
  }
  // Embedded credentials mean this is almost certainly not a web page
  // (e.g. a pasted "mailto:a@b.c"), and we never want to store secrets.
  if (u.username || u.password) throw new Error("Not a valid URL");

  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const key of [...u.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.includes(key.toLowerCase())) {
      u.searchParams.delete(key);
    }
  }
  if (u.pathname !== "/" && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }

  let url = u.toString();
  if (u.pathname === "/" && !u.search) url = url.replace(/\/$/, "");

  const hash = crypto.createHash("sha256").update(url).digest("hex");
  return { url, hash };
}

/** Insert (or resurface) a URL. Never throws on duplicates. */
export function insertItem(input: string): { id: string; deduped: boolean } {
  const { url, hash } = normalizeUrl(input);
  const db = getDb();

  const existing = db
    .prepare("SELECT id FROM items WHERE url_hash = ?")
    .get(hash) as { id: string } | undefined;

  if (existing) {
    // Re-saving something is a signal: move it back to the top of the inbox.
    db.prepare(
      `UPDATE items
          SET saved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              status = CASE WHEN status = 'kept' THEN status ELSE 'inbox' END
        WHERE id = ?`
    ).run(existing.id);
    return { id: existing.id, deduped: true };
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO items (id, kind, url, url_hash, title, site)
     VALUES (?, 'article', ?, ?, NULL, ?)`
  ).run(id, url, hash, new URL(url).hostname);
  return { id, deduped: false };
}

export function getItem(id: string): Item | undefined {
  return getDb().prepare("SELECT * FROM items WHERE id = ?").get(id) as Item | undefined;
}

/**
 * Extraction + triage. Each stage is independently guarded so a failure
 * degrades the row instead of destroying it.
 */
export async function processItem(id: string): Promise<void> {
  const db = getDb();
  const item = getItem(id);
  if (!item || !item.url) return;

  db.prepare(
    "UPDATE items SET extract_status = 'pending', extract_error = NULL WHERE id = ?"
  ).run(id);

  let contentMd: string | null = null;
  let title: string | null = item.title;

  try {
    const ex = await fetchAndExtract(item.url);
    contentMd = ex.contentMd;
    title = ex.title || title;

    // Verbatim source is sacred — keep the raw HTML (gzipped) for re-extraction.
    const gz = zlib.gzipSync(Buffer.from(ex.rawHtml, "utf8"));
    db.prepare(
      `INSERT INTO item_content (item_id, raw_html) VALUES (?, ?)
       ON CONFLICT(item_id) DO UPDATE SET raw_html = excluded.raw_html`
    ).run(id, gz);

    db.prepare(
      `UPDATE items
          SET title = ?, author = ?, site = ?, published_at = ?,
              content_md = ?, word_count = ?,
              extract_status = 'ok', extract_error = NULL
        WHERE id = ?`
    ).run(
      title,
      ex.author,
      ex.site ?? new URL(item.url).hostname,
      ex.published,
      ex.contentMd,
      ex.wordCount,
      id
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      "UPDATE items SET extract_status = 'failed', extract_error = ? WHERE id = ?"
    ).run(message, id);
    return;
  }

  if (!contentMd) return;

  try {
    const t = await triage(title, item.url, contentMd);
    db.prepare(
      `UPDATE items
          SET summary = ?, relevance = ?, title = COALESCE(NULLIF(?, ''), title)
        WHERE id = ?`
    ).run(t.summary, t.relevance, t.suggested_title, id);
  } catch (err) {
    // A missing summary is a degraded card, not a lost capture.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`triage failed for ${id}: ${message}`);
  }
}
