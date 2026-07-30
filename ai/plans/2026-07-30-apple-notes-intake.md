# Apple Notes live intake

_Written 2026-07-30. Origin: the owner asked why the system waits for a manual
`/Applications/Exporter.app` run when Apple Notes is where he actually writes. Correct
instinct — a one-time export is a snapshot that goes stale the next day. Status: **spec;
partial implementation, permission-gated steps unverified.**_

## What the corpus actually is (measured, not assumed)

The first design draft claimed "your Notes folders are already PARA, so filing is free."
That was wrong, from reading directory names without counting what's in them:

| Folder | Notes |
|---|---|
| `iCloud/Notes` (default bucket) | **4,086** |
| `Archive/*` (Musica, Gusto, Daily Journal, dreams) | 235 |
| `Resources/*` | 4 |
| `Projects/*` | 2 |

94% sit in the undifferentiated pile. The PARA folders are the residue of an earlier
attempt, so **folder name is a weak hint at best, not a taxonomy.**

Size distribution of those 4,086 (bytes): p10 **24**, median **174**, p90 2,223, max
213K; 2,184 under 200 bytes, only 432 over 2KB, 4.8 MB total. Representative titles:
`sugar foot`, `pizzaandbeer`, `5 x 20 x 5`, `monthly`, a bare Instagram URL.

This is a **memory substrate**, not a library of documents awaiting organization. The
design follows from that.

## Two conclusions the data forces

1. **Never bulk-file the archive.** Running 4,086 fragments through a classifier and
   writing 4,086 PARA directories would produce a vault that looks organized and is a
   landfill with better lighting — the #1 failure mode in `ai/research/`. Filing is not
   the same as being useful. The archive gets **indexed** (phase 2), left in place.
2. **New notes go to the inbox, not to PARA.** Live notes join the brain app's triage
   queue as `items(kind:'note')` and reach the vault only when the human hits Keep. This
   reuses the whole phase-1 pipeline and keeps "deletion is a success state" intact. A
   note that auto-files itself is a note nobody ever decided about.

Corollary: the interesting subset is the **432 notes over 2KB**. If triage-at-scale is
ever wanted, that's the candidate set — not all 4,086.

## Architecture: hybrid detect-then-fetch

Neither access route is good alone. `NoteStore.sqlite` is fast but note bodies are
gzipped protobuf carrying CRDT structures (and encrypted for locked notes) — decoding
that is a forensics project that breaks on macOS updates. AppleScript returns clean HTML
but costs seconds per call, which is hopeless as a change-detection sweep across 4k
notes. So: **SQLite answers "what changed", AppleScript answers "what does it say".**

```
┌──────────────────────────────────────────────────────────┐
│ 1. DETECT  (cheap, no protobuf)                          │
│    cp NoteStore.sqlite{,-wal,-shm} → tmp, open read-only  │
│    SELECT id, title, folder, modified, locked             │
│    → notes changed since ledger's last-seen mtime         │
├──────────────────────────────────────────────────────────┤
│ 2. FETCH  (only the changed set, seconds each is fine)   │
│    osascript/JXA: body of note id X → HTML                │
├──────────────────────────────────────────────────────────┤
│ 3. CONVERT  HTML → markdown                              │
├──────────────────────────────────────────────────────────┤
│ 4. ENQUEUE  → brain.db items(kind:'note', status:'inbox') │
│    folder recorded as a HINT only; no PARA decision made  │
├──────────────────────────────────────────────────────────┤
│ 5. HUMAN triages. Keep → vault → watcher files it.        │
└──────────────────────────────────────────────────────────┘
```

Why the DB is copied rather than opened in place: Notes holds it open in WAL mode, and a
reader that ignores `-wal`/`-shm` sees a stale or torn view. Copy all three, open the
copy `mode=ro`, throw it away after. Never write to Apple's database — this system is a
reader of Notes, never an author.

## Cutoff: the archive must not stampede

First run must NOT ingest 4,086 notes. Default `NOTES_SINCE` = the moment of first run,
recorded in the ledger; only notes modified after it are picked up. Backfill is a
separate, explicit, opt-in command with a date range — never the default path.

## Ledger

Keyed `note:<apple-note-id>` → `{modified, title, item_id, at}`. Re-ingest only when
`modified` advances, so an edited note updates its inbox row instead of creating a
second. Reuses `data/processed.json`, extended with the `note:` prefix.

Apple Notes **deletions are not mirrored.** The vault is knowledge the human chose to
keep; deleting a scratch note shouldn't retract it. Divergence here is correct.

## Unverified: the NoteStore schema

Column and table names must be probed on the actual machine before trusting them —
Apple has reshuffled this schema repeatedly, and forensic write-ups disagree by version.
Notes and folders both live in `ZICCLOUDSYNCINGOBJECT` in modern versions, with note
bodies joined via `ZICNOTEDATA`. Timestamps are **Core Data epoch: seconds since
2001-01-01 UTC**, so `unix = zvalue + 978307200`.

`src/notes-probe.mjs` exists to answer this: it prints the table list, the
`ZICCLOUDSYNCINGOBJECT` columns actually present, note/folder counts, and the newest few
notes with converted dates. Run it before wiring anything to real ingestion.

## Permissions (the user must grant these; they cannot be scripted)

- **Full Disk Access** for whatever runs node (Terminal.app or the node binary) —
  required to read `~/Library/Group Containers/group.com.apple.notes/`.
- **Automation → Notes** for the AppleScript body fetch; macOS prompts once per app.
- Locked notes are skipped by design (`ZISPASSWORDPROTECTED`); their bodies are
  encrypted and prompting for a password mid-sweep is not acceptable behavior.

## Risks accepted

- **Schema drift** on macOS updates breaks detection. Mitigation: probe script, and
  detection failing loudly beats filing wrongly.
- **osascript latency** — fine for a trickle, unusable for backfill. Backfill, if ever
  built, should read the existing Exporter markdown in `Notes/` instead.
- **iCloud sync lag** means a note written on the phone appears late. Acceptable.
- **A dead Notes.app** (not running) — JXA can launch it; the sweep should not force it
  to the foreground while the user is working.

## Build order

1. `src/notes-probe.mjs` — schema reconnaissance, read-only, no writes anywhere. ✅
2. `src/notes.js` — pure logic first (Core Data dates, folder hints, HTML→markdown,
   ledger keys), all unit-tested; then the SQLite detect query once the probe confirms
   column names.
3. Enqueue path into `brain.db` as `kind:'note'` — needs a phase-1 schema touch
   (`url_hash` is UNIQUE but nullable, so notes need their own dedupe key).
4. Only then a scheduled sweep (launchd or an interval in the watcher process).

## Deferred

Indexing the 4,086-note archive (that's phase 2, `ai/ROADMAP.md`) · attachments and
images · handwriting/scan OCR · writing back to Apple Notes (never) · triaging the 432
substantial notes as a batch.
