import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import YAML from 'yaml';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { execFile } from "child_process";
import util from "util";
const execFilePromise = util.promisify(execFile);

// ✅ Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ iCloud SecondBrain folder
const VAULT = path.resolve(
  process.env.HOME,
  "Library/Mobile Documents/com~apple~CloudDocs/SecondBrain"
);
const INBOX = path.join(VAULT, "Inbox/notes");
const DUPLICATES = path.join(VAULT, "Inbox/duplicates");

// Ledger lives in the repo, not the vault: it's machine state, not knowledge.
const LEDGER_PATH = path.resolve(
  process.env.LEDGER_PATH || path.join(process.cwd(), "data/processed.json")
);

// ✅ The only taxonomy that exists. LLM output is matched against these and
// nothing else — an unconstrained value would become a filesystem path.
const AREAS = ["Projects", "Areas", "Resources", "Archives"];
const DOMAINS = [
  "Music", "Career", "Health", "Finances", "Creativity", "Relationships", "Other"
];
const TYPES = ["idea", "task", "note", "reflection", "resource"];

// ✅ Create PARA + Inbox structure on start
function ensureStructure() {
  const dirs = [
    "Inbox/notes",
    "Inbox/audio",
    "Inbox/images",
    "Inbox/duplicates",
    "Projects",
    "Areas",
    "Resources",
    "Archives",
    "Reviews"
  ];
  dirs.forEach(dir => fs.mkdirSync(path.join(VAULT, dir), { recursive: true }));
  console.log("✅ PARA + Inbox structure verified at:", VAULT);
}

// ✅ Idempotency ledger: content hash → where it landed. A restart, an iCloud
// re-sync, or the same article kept twice must not create a second PARA entry.
function loadLedger() {
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
  } catch {
    return {};
  }
}

function recordProcessed(hash, entry) {
  const ledger = loadLedger();
  ledger[hash] = entry;
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  const tmp = `${LEDGER_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
  fs.renameSync(tmp, LEDGER_PATH);
}

function hashContent(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// Duplicates are parked, never deleted — the user's file is the user's file.
function parkDuplicate(filePath, previous) {
  fs.mkdirSync(DUPLICATES, { recursive: true });
  let dest = path.join(DUPLICATES, path.basename(filePath));
  let n = 2;
  while (fs.existsSync(dest)) {
    const ext = path.extname(filePath);
    dest = path.join(DUPLICATES, `${path.basename(filePath, ext)}-${n}${ext}`);
    n += 1;
  }
  fs.renameSync(filePath, dest);
  console.log(`⏭️  Already processed → ${previous.dest}\n   parked duplicate at ${dest}`);
}

// ✅ PDF → text extraction using Poppler
async function extractTextFromPDF(filePath) {
  try {
    const { stdout } = await execFilePromise("pdftotext", ["-layout", filePath, "-"]);
    return stdout;
  } catch (err) {
    console.error("❌ PDF extraction failed:", err);
    return "";
  }
}

// ✅ Constrained taxonomy: case-insensitive match against the enum, or fall back.
// Never trust the model with a value that becomes a directory name.
function pickEnum(value, allowed, fallback) {
  if (typeof value !== "string") return fallback;
  const found = allowed.find(a => a.toLowerCase() === value.trim().toLowerCase());
  return found || fallback;
}

function cleanTitle(value) {
  if (typeof value !== "string") return "Untitled Capture";
  const title = value
    .replace(/[\r\n]+/g, " ")
    .replace(/["`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/).slice(0, 12).join(" ")
    .slice(0, 120)
    .trim();
  // A title of only punctuation would slug to "" and land everything together.
  return /[a-z0-9]/i.test(title) ? title : "Untitled Capture";
}

function cleanTags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter(t => typeof t === "string")
      .map(t => t.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 40))
      .filter(Boolean)
  )].slice(0, 8);
}

// Everything downstream of the LLM reads sanitized meta, never the raw response.
function sanitizeMeta(meta, text) {
  const raw = (meta && typeof meta === "object") ? meta : {};
  const summary = typeof raw.summary === "string" && raw.summary.trim()
    ? raw.summary.trim()
    : text.slice(0, 300);
  return {
    area: pickEnum(raw.area, AREAS, "Resources"),
    domain: pickEnum(raw.domain, DOMAINS, "Other"),
    type: pickEnum(raw.type, TYPES, "note"),
    title: cleanTitle(raw.title),
    tags: cleanTags(raw.tags),
    summary
  };
}

// ✅ Gemini classification + summarization
async function classifyText(text) {
  const prompt = `
Return STRICT JSON ONLY:

{
  "area": "Projects|Areas|Resources|Archives",
  "domain": "Music|Career|Health|Finances|Creativity|Relationships|Other",
  "type": "idea|task|note|reflection|resource",
  "title": "short title <= 10 words",
  "tags": ["lowercase","keywords"],
  "summary": "2-3 sentence summary"
}

TEXT:
${text}
`;

  try {
    // 2.5-pro is limit:0 on the free tier — every call 429s. flash is the workhorse.
    const model = genAI.getGenerativeModel({ model: "models/gemini-2.5-flash" });
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ]
    });

    // ✅ Correct response extraction for Gemini API
    const raw = result.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log("🤖 Gemini raw:", raw);

    const match = raw.match(/```json([\s\S]*?)```/i);
    const jsonStr = match ? match[1].trim() : raw.trim();

    return sanitizeMeta(JSON.parse(jsonStr), text);
  } catch (err) {
    console.error("⚠️ Gemini fallback used:", err.message);

    // Borrow a title from the document itself. The old constant "Unclassified
    // Capture" meant every failure slugged identically — the collision that ate
    // a note on 2026-07-30.
    return sanitizeMeta({
      area: "Resources",
      domain: "Other",
      type: "note",
      title: fallbackTitle(text),
      tags: [],
      summary: text.slice(0, 300)
    }, text);
  }
}

// First markdown H1, else first non-empty line, else a constant.
function fallbackTitle(text) {
  const heading = text.match(/^#\s+(.+)$/m);
  if (heading) return heading[1];
  const firstLine = text.split("\n").map(l => l.trim()).find(Boolean);
  return firstLine || "Unclassified Capture";
}

// ✅ Never reuse an existing capture directory — two notes that slug alike used to
// overwrite each other's index.md AND their moved asset. Suffix instead: -2, -3, …
function uniqueDestDir(areaDir, slug) {
  let dir = path.join(areaDir, slug);
  let n = 2;
  while (fs.existsSync(dir)) {
    dir = path.join(areaDir, `${slug}-${n}`);
    n += 1;
  }
  return dir;
}

function slugify(title) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  // "." and ".." would resolve outside the area directory.
  return (slug && slug !== "." && slug !== "..") ? slug : "untitled";
}

// ✅ Write note into PARA
function writeNoteAndMoveAsset(meta, text, filePath, originalName) {
  const destDir = uniqueDestDir(path.join(VAULT, meta.area), slugify(meta.title));
  fs.mkdirSync(destDir, { recursive: true });

  const frontmatter = YAML.stringify({
    captured_at: new Date().toISOString(),
    ...meta,
    source_path: filePath
  });

  // index.md carries the FULL text, not just the summary. The summary is a view;
  // losing the source to a truncated 300-char fallback is not acceptable, and a
  // vault note should stand on its own in Obsidian without opening the asset.
  const body = [
    `---\n${frontmatter}---`,
    "",
    "## Summary",
    "",
    meta.summary,
    "",
    "---",
    "",
    text.trim(),
    ""
  ].join("\n");

  const mdPath = path.join(destDir, "index.md");
  fs.writeFileSync(mdPath, body);

  fs.renameSync(filePath, path.join(destDir, originalName));

  console.log(`✅ Saved → ${mdPath}`);
  return mdPath;
}

// ✅ Shared pipeline: hash → ledger check → classify → write → record.
async function ingest(filePath, text, originalName) {
  if (!text.trim()) {
    console.log("⚠️ Empty after extraction, leaving in place:", filePath);
    return;
  }

  const hash = hashContent(text);
  const ledger = loadLedger();
  if (ledger[hash]) {
    parkDuplicate(filePath, ledger[hash]);
    return;
  }

  const meta = await classifyText(text.slice(0, 10000));
  const dest = writeNoteAndMoveAsset(meta, text, filePath, originalName);
  // Recorded only after the write succeeded — a crash mid-way retries cleanly.
  recordProcessed(hash, { dest, title: meta.title, at: new Date().toISOString() });
}

// ✅ PDF handler
async function processPDF(filePath) {
  console.log("📄 Processing PDF:", filePath);
  const text = await extractTextFromPDF(filePath);
  await ingest(filePath, text, "asset.pdf");
}

// ✅ TEXT handler
async function processTextFile(filePath) {
  console.log("📝 Processing text:", filePath);
  const text = fs.readFileSync(filePath, "utf8");
  await ingest(filePath, text, "original.txt");
}

// ✅ Files we must never treat as a capture: dotfiles, iCloud's not-yet-downloaded
// placeholder stubs (.name.ext.icloud), and half-written temp files.
function isNoise(filePath) {
  const base = path.basename(filePath);
  return (
    base.startsWith(".") ||
    /\.(icloud|tmp|download|part|crdownload|partial)$/i.test(base)
  );
}

// ✅ One capture at a time. Concurrent runs race on uniqueDestDir's
// existsSync-then-mkdir and can both pick the same directory.
let queue = Promise.resolve();
function enqueue(task) {
  queue = queue.then(task).catch(err => console.error("❌ Queue error:", err));
  return queue;
}

async function handleFile(file) {
  if (isNoise(file)) {
    console.log("🚫 Skipped (not a capture):", path.basename(file));
    return;
  }
  const lower = file.toLowerCase();
  try {
    if (lower.endsWith(".pdf")) {
      await processPDF(file);
    } else if (lower.endsWith(".txt") || lower.endsWith(".md")) {
      await processTextFile(file);
    } else {
      console.log("⚠️ Ignored:", path.basename(file));
    }
  } catch (err) {
    // The file stays in the inbox so the next restart retries it.
    console.error("❌ Failed processing:", file, err);
  }
}

// ✅ Startup + watch
function main() {
  ensureStructure();
  console.log(`👀 Watching for new notes → ${INBOX}`);
  console.log(`📒 Ledger → ${LEDGER_PATH}`);

  chokidar
    .watch(INBOX, {
      depth: 0,
      // iCloud materializes files in chunks; without this, chokidar fires on a
      // partial write and we classify half a document.
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 }
    })
    .on("add", file => enqueue(() => handleFile(file)));
}

main();