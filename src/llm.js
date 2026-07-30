import { spawn, spawnSync } from "child_process";
import os from "os";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Classification provider chain for the watcher, mirroring brain/lib/llm.ts.
//
// Why this exists: on 2026-07-30 the classifier was pinned to a single provider
// whose free-tier quota was zero. Every call 429'd, every capture took the
// fallback path, every fallback produced the same title, and two notes
// overwrote each other. A provider outage must degrade to a different model,
// not to a constant.
//
// Pin the order with LLM_PROVIDER=claude|gemini (default claude, no API key
// needed — it runs on the subscription login).

const CLAUDE_TIMEOUT_MS = 120_000;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "sonnet";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "models/gemini-2.5-flash";

// The taxonomy is duplicated in main.js, which validates against it; this copy
// only shapes the request. main.js remains the authority.
export const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    area: { type: "string", enum: ["Projects", "Areas", "Resources", "Archives"] },
    domain: {
      type: "string",
      enum: [
        "Music", "Career", "Health", "Finances",
        "Creativity", "Relationships", "Other"
      ]
    },
    type: {
      type: "string",
      enum: ["idea", "task", "note", "reflection", "resource"]
    },
    title: { type: "string", description: "Short title, 10 words or fewer." },
    tags: { type: "array", items: { type: "string" } },
    summary: { type: "string", description: "2-3 sentence summary." }
  },
  required: ["area", "domain", "type", "title", "tags", "summary"],
  additionalProperties: false
};

function buildPrompt(text) {
  return `Classify this capture for a personal second brain organized with PARA.

Choose ONLY from these values:
  area:   Projects | Areas | Resources | Archives
  domain: Music | Career | Health | Finances | Creativity | Relationships | Other
  type:   idea | task | note | reflection | resource

Guidance:
- Projects = has a finish line the owner is actively working toward.
- Areas = an ongoing responsibility with no end date.
- Resources = reference material and things saved to consult later.
- Archives = finished or dormant.
Most saved articles are Resources. Give a specific title drawn from the content
(not "Note" or "Capture"), lowercase keyword tags, and a 2-3 sentence summary.
Respond with JSON only.

TEXT:
${text}`;
}

// ---- Claude (headless CLI, subscription login) ----

let cliAvailable = null;

export function hasClaudeCli() {
  if (cliAvailable === null) {
    try {
      cliAvailable = spawnSync("claude", ["--version"], { timeout: 10_000 }).status === 0;
    } catch {
      cliAvailable = false;
    }
  }
  return cliAvailable;
}

function runClaude(prompt, schema) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--output-format", "json",
      "--model", CLAUDE_MODEL,
      "--json-schema", JSON.stringify(schema)
    ];
    // Neutral cwd so the watcher's runs don't load this repo's agent context.
    const child = spawn("claude", args, { cwd: os.tmpdir() });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`claude timed out after ${CLAUDE_TIMEOUT_MS}ms`));
    }, CLAUDE_TIMEOUT_MS);
    child.stdout.on("data", d => (stdout += d));
    child.stderr.on("data", d => (stderr += d));
    child.on("error", err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.trim().slice(0, 300)}`));
        return;
      }
      try {
        const envelope = JSON.parse(stdout);
        if (envelope.is_error || typeof envelope.result !== "string") {
          reject(new Error(`claude returned an error envelope: ${stdout.slice(0, 200)}`));
          return;
        }
        resolve(envelope.result);
      } catch {
        reject(new Error(`claude envelope was not JSON: ${stdout.slice(0, 200)}`));
      }
    });
    // Prompt over stdin — note bodies overflow argv limits.
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ---- Gemini (API key backstop) ----

let genAI;

export function hasGemini() {
  return !!process.env.GEMINI_API_KEY;
}

async function runGemini(prompt) {
  if (!genAI) genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: "application/json" }
  });
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }]
  });
  const raw = result.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!raw.trim()) throw new Error("gemini returned an empty response");
  return raw;
}

// ---- Dispatch ----

// Providers hand back text; parsing happens here, validation in main.js.
function parseJson(text) {
  const fenced = text.match(/```(?:json)?([\s\S]*?)```/i);
  try {
    return JSON.parse((fenced ? fenced[1] : text).trim());
  } catch {
    throw new Error("response was not valid JSON");
  }
}

/**
 * Returns the raw parsed classification object, or throws if every provider
 * failed. Callers must still sanitize — a well-formed response can carry
 * values that were never in the enum.
 */
export async function classify(text) {
  const prompt = buildPrompt(text);
  const order = (process.env.LLM_PROVIDER || "claude") === "gemini"
    ? ["gemini", "claude"]
    : ["claude", "gemini"];

  const errors = [];
  for (const provider of order) {
    try {
      if (provider === "claude") {
        if (!hasClaudeCli()) {
          errors.push("claude: CLI not found");
          continue;
        }
        const meta = parseJson(await runClaude(prompt, CLASSIFY_SCHEMA));
        console.log("🤖 Classified via claude:", meta.title);
        return meta;
      }
      if (!hasGemini()) {
        errors.push("gemini: GEMINI_API_KEY not set");
        continue;
      }
      const meta = parseJson(await runGemini(prompt));
      console.log("🤖 Classified via gemini:", meta.title);
      return meta;
    } catch (err) {
      console.warn(`⚠️ classify via ${provider} failed: ${err.message}`);
      errors.push(`${provider}: ${err.message}`);
    }
  }
  throw new Error(`all providers failed — ${errors.join("; ")}`);
}
