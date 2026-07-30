import { retrieve, type Passage } from "./ask";
import { runStructured } from "./llm";

// A search loop, not a chatbot with a corpus stuffed into it. Each round the
// model either asks for another search or answers; searches run against the
// same FTS5 index the rest of the app uses, and it only ever sees passages that
// really exist. One search is often not enough — the words you'd use today
// aren't the words you used in 2016 — so it gets to reformulate.
//
// Every search it runs is recorded and shown. A retrieval system you can't see
// into is one you can't correct, and "why did it say that" is answerable only
// if you know what it looked at.

const MAX_ROUNDS = 4;
const MAX_PASSAGES_TOTAL = 20;
const MAX_HISTORY = 8;

export type Turn = { role: "user" | "brain"; text: string };

export type SearchStep = {
  query: string;
  year: string | null;
  found: number;
  /** Titles found, for the trace — enough to see what it was looking at. */
  titles: string[];
};

export type ChatResult = {
  answer: string;
  steps: SearchStep[];
  passages: Passage[];
  cited: number[];
  rounds: number;
  hitRoundLimit: boolean;
};

const STEP_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["search", "answer"],
      description: "search to look in the notes again, answer when you have enough.",
    },
    query: {
      type: "string",
      description:
        "When action is search: the words to look for. Keywords, not a sentence.",
    },
    year: {
      type: "string",
      description:
        "When action is search: restrict to notes written in this year (e.g. 2018). Empty for any year.",
    },
    reason: {
      type: "string",
      description: "When action is search: one short clause on what you're checking.",
    },
    answer: {
      type: "string",
      description:
        "When action is answer: the reply, grounded in the passages, citing [1], [2].",
    },
  },
  required: ["action"],
  additionalProperties: false,
};

function buildPrompt(
  question: string,
  history: Turn[],
  passages: Passage[],
  steps: SearchStep[],
  roundsLeft: number
): string {
  const lines: string[] = [
    "You are searching someone's personal notes to answer their question. The",
    "notes are their own: terse fragments, journal entries and saved articles",
    "going back to 2013.",
    "",
    "Each turn you either SEARCH again or ANSWER.",
    "",
    "Search well:",
    "- Keywords, not sentences. The index is keyword-based.",
    "- Their words, not yours. They wrote 'beats' and 'DAW', not 'music production'.",
    "- One concept per search. Add a year only if the question is about a period.",
    "- If a search returns nothing, try a different word before giving up —",
    "  synonyms, the older term, the specific name.",
    "",
    "Answer when you have enough, or when further searches keep missing:",
    "- Use ONLY the passages found. Never add outside knowledge.",
    "- Cite with [n]. Every claim needs one.",
    "- Say plainly when their notes don't cover it. That is a real answer here;",
    "  an invented one is worse than useless in something meant to be a memory.",
    "- Quote their phrasing rather than tidying it into something more polished.",
    "",
    `Searches left after this one: ${roundsLeft}.`,
  ];

  if (history.length) {
    lines.push("", "CONVERSATION SO FAR:");
    for (const turn of history.slice(-MAX_HISTORY)) {
      lines.push(`${turn.role === "user" ? "Them" : "You"}: ${turn.text}`);
    }
  }

  if (steps.length) {
    lines.push("", "SEARCHES ALREADY RUN (do not repeat these):");
    for (const step of steps) {
      lines.push(
        `- "${step.query}"${step.year ? ` (${step.year})` : ""} → ${step.found} results`
      );
    }
  }

  if (passages.length) {
    lines.push("", "PASSAGES FOUND SO FAR:");
    for (const passage of passages) {
      lines.push(
        `[${passage.n}] ${passage.title ?? "(untitled)"}${
          passage.area ? ` — ${passage.area}` : ""
        }\n${passage.text}`
      );
    }
  } else {
    lines.push("", "No passages yet.");
  }

  lines.push("", `THEIR QUESTION: ${question}`);
  return lines.join("\n");
}

export async function chat(question: string, history: Turn[] = []): Promise<ChatResult> {
  const trimmed = question.trim();
  const steps: SearchStep[] = [];
  const passages: Passage[] = [];
  const seen = new Set<string>();
  let answer = "";
  let rounds = 0;

  for (; rounds < MAX_ROUNDS; rounds++) {
    const roundsLeft = MAX_ROUNDS - rounds - 1;
    const raw = await runStructured(
      buildPrompt(trimmed, history, passages, steps, roundsLeft),
      STEP_SCHEMA,
      "chat"
    );

    let step: { action?: string; query?: string; year?: string; answer?: string };
    try {
      step = JSON.parse(raw);
    } catch {
      throw new Error("the model's reply was not valid JSON");
    }

    if (step.action === "answer" || !step.query) {
      answer = (step.answer ?? "").trim();
      // Asking to answer with nothing found is the one case worth overriding:
      // it means every search missed, and saying so is more use than a
      // paragraph of hedging.
      if (!answer && passages.length === 0) {
        answer =
          "I couldn't find anything in your notes about that. It may not be " +
          "captured, or it may be filed under words you'd have used at the time.";
      }
      if (answer) break;
    }

    // A search round.
    const query = (step.query ?? "").trim();
    const year = (step.year ?? "").trim().match(/^(19|20)\d{2}$/)?.[0] ?? null;
    if (!query) continue;

    const found = retrieve(year ? `${query} ${year}` : query, 8);
    const titles: string[] = [];
    for (const row of found.rows) {
      titles.push(row.title ?? "(untitled)");
      if (seen.has(row.id) || passages.length >= MAX_PASSAGES_TOTAL) continue;
      seen.add(row.id);
      // Renumber across the whole conversation so a citation means one thing.
      passages.push({ ...row, n: passages.length + 1 });
    }

    steps.push({ query, year, found: found.rows.length, titles: titles.slice(0, 5) });
  }

  const hitRoundLimit = !answer && rounds >= MAX_ROUNDS;
  if (!answer) {
    answer = passages.length
      ? "I searched several ways and found related notes, but nothing that " +
        "actually answers this. The passages below are the closest."
      : "I couldn't find anything in your notes about that.";
  }

  // Same rule as /ask: a citation pointing at a passage that was never shown
  // would render as a dead link and imply a source that doesn't exist.
  const valid = new Set(passages.map((p) => p.n));
  const cited: number[] = [];
  answer = answer
    .replace(/\[(\d+)\]/g, (whole, digits: string) => {
      const n = Number(digits);
      if (!valid.has(n)) return "";
      if (!cited.includes(n)) cited.push(n);
      return whole;
    })
    // Removing a citation leaves the gap it sat in: "also  which" and " ."
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1");

  return {
    answer: answer.trim(),
    steps,
    passages,
    cited: cited.sort((a, b) => a - b),
    // Model calls actually made — capped, not one past the cap.
    rounds: Math.min(rounds + 1, MAX_ROUNDS),
    hitRoundLimit,
  };
}
