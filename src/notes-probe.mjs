#!/usr/bin/env node
// Apple Notes schema reconnaissance. READ ONLY — copies the database and never
// writes to Apple's files. Run this before wiring any Notes ingestion:
//
//   node src/notes-probe.mjs
//
// Requires Full Disk Access for whatever runs node (System Settings → Privacy &
// Security → Full Disk Access → add Terminal, or your node binary). Without it
// the copy fails with EPERM and this script says so plainly.
//
// Apple has reshuffled this schema across macOS versions and the forensic
// write-ups disagree, so we discover column names instead of assuming them.

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const GROUP_DIR = path.join(
  os.homedir(),
  "Library/Group Containers/group.com.apple.notes"
);
const STORE = path.join(GROUP_DIR, "NoteStore.sqlite");

// Core Data stores timestamps as seconds since 2001-01-01 UTC.
const CORE_DATA_EPOCH = 978_307_200;
const toDate = z =>
  z ? new Date((Number(z) + CORE_DATA_EPOCH) * 1000).toISOString() : null;

function fail(message, hint) {
  console.error(`\n❌ ${message}`);
  if (hint) console.error(`   ${hint}`);
  process.exit(1);
}

if (!fs.existsSync(STORE)) {
  fail(
    `No NoteStore.sqlite at ${STORE}`,
    "Either Notes has never synced on this Mac, or the path moved in this macOS version."
  );
}

// Copy the DB plus its WAL sidecars: Notes holds the live file open in WAL mode,
// and reading it without -wal/-shm gives a stale or torn view.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "notes-probe-"));
const copy = path.join(tmp, "NoteStore.sqlite");
try {
  for (const suffix of ["", "-wal", "-shm"]) {
    const src = `${STORE}${suffix}`;
    if (fs.existsSync(src)) fs.copyFileSync(src, `${copy}${suffix}`);
  }
} catch (err) {
  if (err.code === "EPERM" || err.code === "EACCES") {
    fail(
      "Permission denied reading the Notes database.",
      "Grant Full Disk Access to Terminal (or your node binary) and re-run."
    );
  }
  fail(`Could not copy the Notes database: ${err.message}`);
}

// `sqlite3` ships with macOS, which avoids adding a native dep just to probe.
function sql(query) {
  try {
    return execFileSync("sqlite3", ["-readonly", "-json", copy, query], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    }).trim();
  } catch (err) {
    return `__ERROR__ ${err.stderr?.toString().trim() || err.message}`;
  }
}

function rows(query) {
  const out = sql(query);
  if (out.startsWith("__ERROR__")) return { error: out.slice(10) };
  if (!out) return [];
  try {
    return JSON.parse(out);
  } catch {
    return { error: `unparseable output: ${out.slice(0, 200)}` };
  }
}

console.log(`\n📓 Notes store: ${STORE}`);
console.log(`   probing a copy at ${copy}\n`);

// --- 1. What tables exist ---
const tables = rows(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
);
if (tables.error) fail(`Could not list tables: ${tables.error}`);
const names = tables.map(t => t.name);
console.log(`Tables (${names.length}):`);
console.log(
  "  " +
    names
      .filter(n => n.startsWith("ZIC") || n.startsWith("Z_"))
      .join("  ") || "  (none matching ZIC*/Z_*)"
);

// --- 2. Columns on the object table ---
const OBJ = "ZICCLOUDSYNCINGOBJECT";
if (!names.includes(OBJ)) {
  fail(
    `${OBJ} is missing — this macOS version stores notes differently.`,
    "Stop here; the ingestion design assumes this table."
  );
}
const cols = rows(`PRAGMA table_info(${OBJ})`);
const colNames = cols.map(c => c.name);
console.log(`\n${OBJ} has ${colNames.length} columns. Ones we care about:`);
const WANTED = [
  "Z_PK", "ZTITLE1", "ZTITLE2", "ZSNIPPET",
  "ZMODIFICATIONDATE1", "ZMODIFICATIONDATE", "ZCREATIONDATE1", "ZCREATIONDATE",
  "ZFOLDER", "ZNOTE", "ZISPASSWORDPROTECTED", "ZMARKEDFORDELETION",
  "ZIDENTIFIER", "ZACCOUNT2", "ZACCOUNT3", "ZACCOUNT4"
];
for (const want of WANTED) {
  console.log(`  ${colNames.includes(want) ? "✓" : "·"} ${want}`);
}
const missing = ["Z_PK", "ZTITLE1", "ZMODIFICATIONDATE1", "ZFOLDER"].filter(
  c => !colNames.includes(c)
);
if (missing.length) {
  console.log(`\n⚠️  Expected columns absent: ${missing.join(", ")}`);
  console.log("   The detect query in src/notes.js needs adjusting for this version.");
}

// --- 3. Counts ---
const noteCount = rows(
  `SELECT COUNT(*) n FROM ${OBJ} WHERE ZTITLE1 IS NOT NULL AND IFNULL(ZMARKEDFORDELETION,0)=0`
);
const folderCount = rows(
  `SELECT COUNT(*) n FROM ${OBJ} WHERE ZTITLE2 IS NOT NULL`
);
console.log(`\nNotes (not deleted): ${noteCount[0]?.n ?? noteCount.error}`);
console.log(`Folders:             ${folderCount[0]?.n ?? folderCount.error}`);

if (colNames.includes("ZISPASSWORDPROTECTED")) {
  const locked = rows(
    `SELECT COUNT(*) n FROM ${OBJ} WHERE ZISPASSWORDPROTECTED=1`
  );
  console.log(`Locked (skipped):    ${locked[0]?.n ?? locked.error}`);
}

// --- 4. Folder distribution: is anything actually filed? ---
const byFolder = rows(`
  SELECT IFNULL(f.ZTITLE2,'(none)') folder, COUNT(*) n
    FROM ${OBJ} note
    LEFT JOIN ${OBJ} f ON f.Z_PK = note.ZFOLDER
   WHERE note.ZTITLE1 IS NOT NULL AND IFNULL(note.ZMARKEDFORDELETION,0)=0
   GROUP BY folder ORDER BY n DESC LIMIT 20`);
if (!byFolder.error) {
  console.log(`\nNotes per folder:`);
  for (const r of byFolder) console.log(`  ${String(r.n).padStart(5)}  ${r.folder}`);
}

// --- 5. The newest few, with dates converted ---
const recent = rows(`
  SELECT note.Z_PK id, note.ZTITLE1 title, IFNULL(f.ZTITLE2,'(none)') folder,
         note.ZMODIFICATIONDATE1 modified
    FROM ${OBJ} note
    LEFT JOIN ${OBJ} f ON f.Z_PK = note.ZFOLDER
   WHERE note.ZTITLE1 IS NOT NULL AND IFNULL(note.ZMARKEDFORDELETION,0)=0
   ORDER BY note.ZMODIFICATIONDATE1 DESC LIMIT 10`);
if (!recent.error) {
  console.log(`\n10 most recently modified:`);
  for (const r of recent) {
    console.log(
      `  ${toDate(r.modified)?.slice(0, 19) ?? "?"}  [${r.folder}]  ${String(r.title).slice(0, 60)}`
    );
  }
  console.log(
    "\n👆 If those dates and titles look right, the detect half of the design works."
  );
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n🧹 Removed the copy. Nothing was written to Apple's database.\n`);
