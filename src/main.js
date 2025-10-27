import 'dotenv/config';
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

// ✅ Create PARA + Inbox structure on start
function ensureStructure() {
  const dirs = [
    "Inbox/notes",
    "Inbox/audio",
    "Inbox/images",
    "Projects",
    "Areas",
    "Resources",
    "Archives",
    "Reviews"
  ];
  dirs.forEach(dir => fs.mkdirSync(path.join(VAULT, dir), { recursive: true }));
  console.log("✅ PARA + Inbox structure verified at:", VAULT);
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
    const model = genAI.getGenerativeModel({ model: "models/gemini-2.5-pro" });
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

    return JSON.parse(jsonStr);
  } catch (err) {
    console.error("⚠️ Gemini fallback used:", err.message);

    return {
      area: "Resources",
      domain: "Other",
      type: "note",
      title: "Unclassified Capture",
      tags: [],
      summary: text.slice(0, 300)
    };
  }
}

// ✅ Write note into PARA
function writeNoteAndMoveAsset(meta, text, filePath, originalName) {
  const slug = meta.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "untitled";

  const destDir = path.join(VAULT, meta.area || "Resources", slug);
  fs.mkdirSync(destDir, { recursive: true });

  const frontmatter = YAML.stringify({
    captured_at: new Date().toISOString(),
    ...meta,
    source_path: filePath
  });

  const mdPath = path.join(destDir, "index.md");
  fs.writeFileSync(mdPath, `---\n${frontmatter}---\n\n${meta.summary}\n`);

  fs.renameSync(filePath, path.join(destDir, originalName));

  console.log(`✅ Saved → ${mdPath}`);
}

// ✅ PDF handler
async function processPDF(filePath) {
  console.log("📄 Processing PDF:", filePath);
  const text = await extractTextFromPDF(filePath);
  const meta = await classifyText(text.slice(0, 10000));
  writeNoteAndMoveAsset(meta, text, filePath, "asset.pdf");
}

// ✅ TEXT handler
async function processTextFile(filePath) {
  console.log("📝 Processing text:", filePath);
  const text = fs.readFileSync(filePath, "utf8");
  const meta = await classifyText(text.slice(0, 10000));
  writeNoteAndMoveAsset(meta, text, filePath, "original.txt");
}

// ✅ Startup + watch
function main() {
  ensureStructure();
  console.log(`👀 Watching for new notes → ${INBOX}`);

  chokidar.watch(INBOX).on("add", async (file) => {
    const lower = file.toLowerCase();
    try {
      if (lower.endsWith(".pdf")) {
        await processPDF(file);
      } else if (lower.endsWith(".txt") || lower.endsWith(".md")) {
        await processTextFile(file);
      } else {
        console.log("⚠️ Ignored:", lower);
      }
    } catch (err) {
      console.error("❌ Failed processing:", file, err);
    }
  });
}

main();