import { getDb } from "./db";

// FTS5 search over the library.
//
// Hard-won detail: FTS5's MATCH takes a query *language*, not a search box
// string. Verified against the real corpus, raw user input fails constantly —
// `AI & jobs`, `don't`, `c++`, `foo-bar` (reads as a column filter!) and a lone
// `*` are all syntax errors. So ordinary input is tokenized and quoted into
// phrases, while deliberate operator syntax is attempted as-is and falls back.

export type SearchHit = {
  id: string;
  source: string;
  area: string | null;
  title: string | null;
  snippet: string;
  score: number;
  word_count: number | null;
  mtime: string | null;
};

// Title matches should outrank a passing mention in a long body.
const TITLE_WEIGHT = 8.0;
const BODY_WEIGHT = 1.0;

const OPERATOR_HINT = /\b(AND|OR|NOT|NEAR)\b|["*:]/;

/** Tokenize into quoted phrases ANDed together — always valid FTS5. */
export function toSafeMatch(input: string): string | null {
  const tokens = input.match(/[\p{L}\p{N}_'’+#-]+/gu);
  if (!tokens) return null;
  const phrases = tokens
    .map((t) => t.replace(/"/g, "").trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((t) => `"${t}"`);
  return phrases.length ? phrases.join(" AND ") : null;
}

export function searchDocs(query: string, limit = 40): SearchHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const db = getDb();
  const sql = `
    SELECT d.id, d.source, d.area, d.title, d.word_count, d.mtime,
           snippet(docs_fts, 1, '«', '»', '…', 18) AS snippet,
           bm25(docs_fts, ?, ?) AS score
      FROM docs_fts
      JOIN docs d ON d.rowid = docs_fts.rowid
     WHERE docs_fts MATCH ?
     ORDER BY score
     LIMIT ?`;

  const run = (match: string) =>
    db.prepare(sql).all(TITLE_WEIGHT, BODY_WEIGHT, match, limit) as SearchHit[];

  // Power syntax first, but only when the user clearly meant it.
  if (OPERATOR_HINT.test(trimmed)) {
    try {
      return run(trimmed);
    } catch {
      /* fall through to the safe form */
    }
  }

  const safe = toSafeMatch(trimmed);
  if (!safe) return [];
  try {
    return run(safe);
  } catch (err) {
    console.warn(`search failed for ${JSON.stringify(trimmed)}: ${String(err)}`);
    return [];
  }
}

export function countMatches(query: string): number {
  const trimmed = query.trim();
  if (!trimmed) return 0;
  const db = getDb();
  const attempt = (match: string) =>
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM docs_fts WHERE docs_fts MATCH ?")
        .get(match) as { n: number }
    ).n;

  if (OPERATOR_HINT.test(trimmed)) {
    try {
      return attempt(trimmed);
    } catch {
      /* fall through */
    }
  }
  const safe = toSafeMatch(trimmed);
  if (!safe) return 0;
  try {
    return attempt(safe);
  } catch {
    return 0;
  }
}

export type YearCount = { year: string; n: number };

/**
 * Notes per year. "What was I thinking about back then" is a browsing
 * question, not a search one — no keyword answers it, and asking the index for
 * the literal string "2019" finds notes that mention the year rather than
 * notes written in it. Exporter.app preserved each note's date as the file
 * mtime, so the archive really does span 2014–2026 and can be walked by period.
 */
export function libraryYears(): YearCount[] {
  return getDb()
    .prepare(
      `SELECT substr(mtime, 1, 4) AS year, COUNT(*) AS n
         FROM docs
        WHERE mtime IS NOT NULL AND year <> ''
        GROUP BY year
        ORDER BY year DESC`
    )
    .all() as YearCount[];
}

export type AreaCount = { source: string; area: string | null; n: number };

export function libraryAreas(): AreaCount[] {
  return getDb()
    .prepare(
      `SELECT source, area, COUNT(*) AS n FROM docs
         GROUP BY source, area ORDER BY source, n DESC`
    )
    .all() as AreaCount[];
}

export type DocRow = {
  id: string;
  source: string;
  rel_path: string;
  abs_path: string;
  area: string | null;
  title: string | null;
  summary: string | null;
  body: string | null;
  word_count: number | null;
  index_status: string;
  index_error: string | null;
  mtime: string | null;
  indexed_at: string;
};

export function listDocs(
  opts: {
    source?: string;
    area?: string;
    year?: string;
    limit?: number;
    offset?: number;
  } = {}
): DocRow[] {
  const { source, area, year, limit = 50, offset = 0 } = opts;
  const where: string[] = [];
  const params: unknown[] = [];
  if (source) {
    where.push("source = ?");
    params.push(source);
  }
  if (area) {
    where.push("area = ?");
    params.push(area);
  }
  if (year) {
    where.push("substr(mtime, 1, 4) = ?");
    params.push(year);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return getDb()
    .prepare(
      `SELECT * FROM docs ${clause} ORDER BY mtime DESC NULLS LAST LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as DocRow[];
}

export function getDoc(id: string): DocRow | undefined {
  return getDb().prepare("SELECT * FROM docs WHERE id = ?").get(id) as DocRow | undefined;
}

export function countDocs(
  opts: { source?: string; area?: string; year?: string } = {}
): number {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.source) {
    where.push("source = ?");
    params.push(opts.source);
  }
  if (opts.area) {
    where.push("area = ?");
    params.push(opts.area);
  }
  if (opts.year) {
    where.push("substr(mtime, 1, 4) = ?");
    params.push(opts.year);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return (
    getDb().prepare(`SELECT COUNT(*) AS n FROM docs ${clause}`).get(...params) as {
      n: number;
    }
  ).n;
}
