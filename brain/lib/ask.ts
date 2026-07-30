import { getDb } from "./db";
import { runStructured } from "./llm";

// Grounded Q&A over the library. Retrieval is FTS5 — the same index /search
// uses — and the model only ever sees passages that are actually in the vault.
// It answers from them or says it can't; it never answers from its own
// knowledge, because "what did I write about X" has exactly one correct source.
//
// No embeddings yet, on purpose: this corpus is mostly short fragments where
// the words in a note are the words you'd search for, and keyword retrieval is
// unusually strong on it. Shipping this first tells us whether semantic search
// is needed, instead of assuming it.

const MAX_PASSAGES = 12;
const PASSAGE_CHARS = 900;
const TOTAL_BUDGET = 14_000;

// Question words carry no signal and would wreck an AND query. Not a general
// stopword list — just the shapes questions actually take.
const STOPWORDS = new Set([
  "a", "about", "all", "am", "an", "and", "any", "anything", "are", "as", "at",
  "be", "been", "but", "by", "can", "did", "do", "does", "don", "dont", "for",
  "from", "get", "give", "had", "has", "have", "how", "i", "if", "in", "into",
  "is", "it", "its", "know", "like", "list", "me", "mine", "my", "of", "on",
  "or", "our", "out", "over", "remember", "said", "say", "show", "so", "some",
  "something", "tell", "that", "the", "their", "them", "then", "there", "these",
  "they", "thing", "things", "this", "those", "to", "up", "us", "was", "we",
  "were", "what", "when", "where", "which", "who", "why", "will", "with",
  "would", "write", "wrote", "you", "your",
]);

export type Passage = {
  n: number;
  id: string;
  title: string | null;
  area: string | null;
  source: string;
  text: string;
};

export type AskResult = {
  answer: string;
  passages: Passage[];
  cited: number[];
  matchQuery: string | null;
};

/** Content words, in order, deduped. */
export function contentWords(question: string): string[] {
  const words = question.toLowerCase().match(/[\p{L}\p{N}_'’+#-]+/gu) ?? [];
  const kept: string[] = [];
  for (const word of words) {
    const w = word.replace(/^[-']+|[-']+$/g, "");
    if (!w || STOPWORDS.has(w)) continue;
    if (w.length < 2) continue;
    if (!kept.includes(w)) kept.push(w);
  }
  return kept.slice(0, 10);
}

/**
 * Drop words that carry no signal *in this corpus*, judged by how many
 * documents contain them.
 *
 * A fixed threshold is wrong: measured here, "music" is in 8.8% of documents
 * and "job" 4.2%, but both are real subjects the reader writes about, while
 * "make" (13.8%) and "work" (10.1%) are noise. What separates them is rarity
 * relative to the rest of the same question — "contract" (0.5%) next to "work"
 * (10.1%) means the question is about contracts. Without this, "what was I
 * thinking about contract work" returns music-business notes, because
 * "thinking" and "work" are everywhere.
 *
 * The rarest word is always kept, so a question about a single common topic
 * still works.
 */
function byInformativeness(words: string[]): string[] {
  if (words.length <= 1) return words;
  const db = getDb();
  const counted = words.map((word) => {
    let df = 0;
    try {
      df = (
        db
          .prepare("SELECT COUNT(*) AS n FROM docs_fts WHERE docs_fts MATCH ?")
          .get(`"${word.replace(/"/g, "")}"`) as { n: number }
      ).n;
    } catch {
      df = 0;
    }
    return { word, df };
  });

  const rarest = Math.min(...counted.map((c) => c.df));
  // The floor matters when the rarest word has no matches at all (a subject the
  // reader never wrote about): without it, everything else would be kept and
  // the answer would be assembled from unrelated notes instead of admitting
  // there's nothing.
  // 5× measured against real questions: at 20× "thinking" (131 docs) survived
  // next to "contract" (20) and dragged the answer to "thinking of you always".
  const ceiling = Math.max(rarest * 5, 50);
  const kept = counted.filter((c) => c.df <= ceiling).map((c) => c.word);
  return kept.length ? kept : [counted.sort((a, b) => a.df - b.df)[0].word];
}

/**
 * Retrieval, precise-then-broad. Requiring every content word finds the sharp
 * answer when it exists; when it returns too little, OR them so a question
 * phrased differently from the note still lands. Plain AND across a whole
 * question matches nothing, which reads to the user as "my notes are empty".
 */
export function retrieve(question: string, limit = MAX_PASSAGES): {
  rows: Passage[];
  matchQuery: string | null;
} {
  const words = byInformativeness(contentWords(question));
  if (words.length === 0) return { rows: [], matchQuery: null };

  const db = getDb();
  const quoted = words.map((w) => `"${w.replace(/"/g, "")}"`);

  const run = (match: string) =>
    db
      .prepare(
        `SELECT d.id, d.title, d.area, d.source, d.body, d.summary,
                bm25(docs_fts, 8.0, 1.0) AS score
           FROM docs_fts
           JOIN docs d ON d.rowid = docs_fts.rowid
          WHERE docs_fts MATCH ?
            AND d.index_status = 'ok'
          ORDER BY score
          LIMIT ?`
      )
      .all(match, limit) as (Omit<Passage, "n" | "text"> & {
      body: string | null;
      summary: string | null;
    })[];

  let matchQuery = quoted.join(" AND ");
  let rows: ReturnType<typeof run> = [];

  try {
    rows = run(matchQuery);
  } catch {
    rows = [];
  }

  if (rows.length < 5 && quoted.length > 1) {
    const broad = quoted.join(" OR ");
    try {
      const more = run(broad);
      if (more.length > rows.length) {
        rows = more;
        matchQuery = broad;
      }
    } catch {
      /* keep whatever the precise pass found */
    }
  }

  let budget = TOTAL_BUDGET;
  const passages: Passage[] = [];
  for (const row of rows) {
    const body = (row.summary ? `${row.summary}\n\n` : "") + (row.body ?? "");
    const text = body.trim().slice(0, PASSAGE_CHARS);
    if (!text) continue;
    if (text.length > budget) break;
    budget -= text.length;
    passages.push({
      n: passages.length + 1,
      id: row.id,
      title: row.title,
      area: row.area,
      source: row.source,
      text,
    });
  }

  return { rows: passages, matchQuery };
}

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description:
        "The answer, grounded only in the passages, citing them as [1], [2]. " +
        "If they don't contain the answer, say so plainly.",
    },
    grounded: {
      type: "boolean",
      description: "False if the passages did not actually contain the answer.",
    },
  },
  required: ["answer", "grounded"],
  additionalProperties: false,
};

function buildPrompt(question: string, passages: Passage[]): string {
  const numbered = passages
    .map(
      (p) =>
        `[${p.n}] ${p.title ?? "(untitled)"}${p.area ? ` — ${p.area}` : ""}\n${p.text}`
    )
    .join("\n\n---\n\n");

  return [
    "You are answering a question using ONLY the passages below, which come from",
    "the reader's own notes and saved articles. These notes are often terse",
    "fragments written years ago — quote them rather than smoothing them into",
    "something more articulate than what was written.",
    "",
    "Rules:",
    "- Use only what the passages say. Do not add facts from your own knowledge,",
    "  even if you are confident they are true.",
    "- Cite every claim with the passage number in square brackets, like [3].",
    "- If the passages do not answer the question, say so directly and set",
    "  grounded to false. Report what IS there instead if it's close. A plain",
    "  'your notes don't cover this' is a useful answer; a confident invented one",
    "  is worse than useless in a system meant to be a memory.",
    "- Do not speculate about what the reader meant. Quote and attribute.",
    "- Keep it short. Two or three sentences unless the question needs more.",
    "",
    `QUESTION: ${question}`,
    "",
    "PASSAGES:",
    numbered,
  ].join("\n");
}

export async function ask(question: string): Promise<AskResult> {
  const trimmed = question.trim();
  if (!trimmed) return { answer: "", passages: [], cited: [], matchQuery: null };

  const { rows: passages, matchQuery } = retrieve(trimmed);
  if (passages.length === 0) {
    return {
      answer:
        "Nothing in your library matches that. Either it isn't captured yet, or " +
        "it's worded differently — try the words you'd have used at the time.",
      passages: [],
      cited: [],
      matchQuery,
    };
  }

  const raw = await runStructured(buildPrompt(trimmed, passages), ANSWER_SCHEMA, "ask");

  let answer: string;
  try {
    const parsed = JSON.parse(raw) as { answer?: unknown };
    answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
  } catch {
    throw new Error("the model's answer was not valid JSON");
  }
  if (!answer) throw new Error("the model returned an empty answer");

  // Drop citations pointing at passages that weren't shown. A number the model
  // invented would render as a dead link and quietly imply a source exists.
  const valid = new Set(passages.map((p) => p.n));
  const cited: number[] = [];
  answer = answer.replace(/\[(\d+)\]/g, (whole, digits: string) => {
    const n = Number(digits);
    if (!valid.has(n)) return "";
    if (!cited.includes(n)) cited.push(n);
    return whole;
  });

  return { answer: answer.trim(), passages, cited: cited.sort((a, b) => a - b), matchQuery };
}
