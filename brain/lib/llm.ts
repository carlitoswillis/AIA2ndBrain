import { hasClaudeCli, runClaude } from "./claude";
import { buildContextBlock } from "./context";
import { hasGemini, runGemini } from "./gemini";
import { getLlmProvider } from "./settings";

// One narrowly scoped AI role: the triage card. AI routes attention; the human
// distills. The prompt and validation live here; providers just turn a prompt
// into JSON text. The picked provider (settings toggle on the inbox page,
// seeded by LLM_PROVIDER env) goes first; the other one backstops it, so a
// missing CLI or rate-limited key degrades to a different model, not a
// missing summary.

const MAX_CHARS = 40_000;

export type Triage = {
  summary: string;
  suggested_title: string;
  relevance: string | null;
};

// Plain JSON Schema — claude's --json-schema enforces it server-side.
// gemini.ts mirrors it with the SDK's Type-based responseSchema.
export const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "~120 word read/skip decision summary, plain prose.",
    },
    suggested_title: {
      type: "string",
      description: "Clean human-readable title.",
    },
    relevance: {
      type: "string",
      description:
        "One short clause naming which of the reader's current items this bears " +
        "on, or the empty string if it genuinely bears on none of them.",
    },
  },
  required: ["summary", "suggested_title", "relevance"],
  additionalProperties: false,
};

function buildPrompt(title: string | null, url: string | null, contentMd: string): string {
  const context = buildContextBlock();

  return [
    "You are the triage assistant for a personal second brain.",
    "The reader has a queue of saved articles and 30 seconds per item.",
    "",
    "Write a summary whose ONLY job is helping them decide whether to read the full",
    "piece at all: what it actually claims, what is concretely useful in it, and who",
    "it is for. About 120 words, plain prose, no bullet points, no preamble, no",
    "phrases like 'this article'. Be specific — name the actual claims and details.",
    "Do not invent anything not present in the text.",
    "",
    "Also give a clean, human title (strip site names, SEO padding, clickbait).",
    ...(context
      ? [
          "",
          context,
          "",
          "For `relevance`: if this piece genuinely bears on one of those items, say",
          "which one and how, in one short clause (e.g. \"bears on: seek contract work\").",
          "Judge honestly — most articles will relate to NONE of them, and a forced or",
          "vague connection is worse than none. Return an empty string in that case.",
          "Do not stretch a topical word-match into a connection.",
        ]
      : ["", "For `relevance`: return an empty string (no context available)."]),
    "",
    'Respond with JSON only: {"summary": "...", "suggested_title": "...", "relevance": "..."}',
    "",
    `URL: ${url ?? "(none)"}`,
    `Extracted title: ${title ?? "(none)"}`,
    "",
    "CONTENT:",
    contentMd.slice(0, MAX_CHARS),
  ].join("\n");
}

function parseTriage(text: string, fallbackTitle: string | null): Triage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("response was not valid JSON");
  }
  const obj = parsed as Partial<Triage>;
  if (!obj || typeof obj.summary !== "string" || !obj.summary.trim()) {
    throw new Error("response missing summary");
  }
  // "No connection" is a first-class answer — normalize the many ways a model
  // says it into null so the UI shows nothing rather than a hedge.
  const raw = typeof obj.relevance === "string" ? obj.relevance.trim() : "";
  const relevance =
    raw && !/^(none|n\/?a|nothing|no( clear| direct)? (connection|relevance))\b/i.test(raw)
      ? raw
      : null;

  return {
    summary: obj.summary.trim(),
    suggested_title:
      typeof obj.suggested_title === "string" && obj.suggested_title.trim()
        ? obj.suggested_title.trim()
        : (fallbackTitle ?? "").trim(),
    relevance,
  };
}

export async function triage(
  title: string | null,
  url: string | null,
  contentMd: string
): Promise<Triage> {
  const prompt = buildPrompt(title, url, contentMd);
  const order =
    getLlmProvider() === "gemini"
      ? (["gemini", "claude"] as const)
      : (["claude", "gemini"] as const);

  const errors: string[] = [];
  for (const provider of order) {
    try {
      if (provider === "claude") {
        if (!hasClaudeCli()) {
          errors.push("claude: CLI not found");
          continue;
        }
        return parseTriage(await runClaude(prompt, TRIAGE_SCHEMA), title);
      }
      if (!hasGemini()) {
        errors.push("gemini: GEMINI_API_KEY not set");
        continue;
      }
      return parseTriage(await runGemini(prompt), title);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`triage via ${provider} failed: ${message}`);
      errors.push(`${provider}: ${message}`);
    }
  }
  throw new Error(`all LLM providers failed — ${errors.join("; ")}`);
}
