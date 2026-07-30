# Project State

_Last updated: 2026-07-30._

## Current Focus
- **The brain app** (`brain/`): the AI-augmented second brain UI. Master plan in
  `ai/ROADMAP.md`; phase 1 (capture + reader) spec in
  `ai/plans/2026-07-29-phase1-capture-reader.md`. **Code complete as of 2026-07-29** —
  all libs + pages written, `tsc --noEmit` clean. Awaiting the live gate on the Mac
  (`npm run build` + real-URL walkthrough); `npm run build` cannot run in the Linux
  sandbox because node_modules holds macOS-native swc/better-sqlite3 binaries.
  **Running live on :3002 as of 2026-07-30** — first real saves went through.

## Active Tasks
- [ ] Finish the phase 1 live gate. Confirmed so far: save → Gemini summary → Read
      renders (NBC article, 631 words, raw HTML stored) and a bot-blocked NYT URL failed
      visibly with Retry + open-original. **Still owed: Keep → vault inbox → watcher
      files it into PARA**, Delete, duplicate-save dedupe.
- [ ] Then: two weeks of daily use before phase 2 (ROADMAP scope contract).
- [ ] Restart the watcher to pick up the hardening pass (see Completed 2026-07-30) and
      watch one real capture through it.
- [ ] Consider giving the watcher the brain app's provider chain (`brain/lib/llm.ts`:
      Claude CLI primary, Gemini backstop). The watcher is plain ESM JS and can't import
      the TS, so this means either a shared JS module or a small port — the classifier is
      currently single-provider and 429s take out filing entirely.
- [ ] Re-Keep the two articles whose vault copies the collision ate (both still intact
      in brain.db with raw HTML): "AI Data Centers Scramble for Electricians" and
      "AI Surging in Job Titles Across Sectors".

## Backlog (now sequenced by ROADMAP.md phases)
- [ ] Phase 2 — Library + hybrid search (index vault + 4k-note corpus; FTS5 + sqlite-vec).
- [ ] Phase 3 — Chat with your brain (grounded, cited) + master-context doc.
- [ ] Phase 4 — AI weekly review digest + resurfacing (reads item_events).
- [ ] Phase 5 — MCP server, RSS/email-in, highlights/progressive summarization,
      hosted deploy (workingmemory's Render+Litestream chain).
- [ ] Chrome DOM-capture extension for bot-blocked/paywalled/JS-rendered pages —
      design parked in `ai/plans/2026-07-29-chrome-dom-capture.md`. Phase 5 intake;
      do not build until phase 1 has two weeks of use and the failure rate justifies it.
- [ ] Voice memo transcription (audio → text → PARA).
- [ ] Obsidian backlink support.
- [ ] Improve PDF extraction robustness (currently relies on `pdftotext`).
- [ ] Refine watcher Gemini classification prompt / migrate to `@google/genai`
      structured output.

## Completed
- [x] Basic file watcher with Chokidar.
- [x] Gemini AI integration for classification.
- [x] PARA directory structure auto-healing.
- [x] Basic PDF text extraction using Poppler.
- [x] 2026-07-29 — Research sweep: BASB methodology, Forte × AI (Personal Context
      Management), AI-PKM landscape, read-later landscape, both codebase audits,
      3 design proposals → `ai/research/` (9 docs).
- [x] 2026-07-29 — `ai/ROADMAP.md` (system vision, 5 organs, 5 phases, principles).
- [x] 2026-07-29 — `brain/` scaffold: package.json (deps installed), configs,
      lib/schema.ts, lib/db.ts, lib/extract.ts.
- [x] 2026-07-29 — Phase 1 implementation: `lib/gemini.ts` (structured-output triage),
      `lib/vault.ts` (atomic timestamp-prefixed export), `lib/save.ts` (normalize /
      dedupe / row-first process), `app/` (layout, globals.css, inbox, read/[id], kept,
      api/save, actions.ts), `brain/.env` (key + fresh SAVE_TOKEN), tsconfig
      `target: es2022`. Verified: `tsc --noEmit` clean; vault markdown shape, atomic
      write, slugify and URL normalization/rejection unit-checked in-sandbox.
- [x] 2026-07-30 — `tidyMarkdown()` in `lib/extract.ts`: collapses Defuddle's figure
      debris (caption repeated as image alt, again as a paragraph, and a third time with
      the photo credit glued on). Verified against the stored NBC capture: 18 → 16
      blocks. Applies to new captures only — existing rows keep their stored markdown
      until re-extracted.
- [x] 2026-07-30 — Claude wired in as the triage LLM (autojob's headless-CLI pattern):
      `lib/claude.ts` spawns `claude -p --output-format json --json-schema --model
      sonnet` (subscription login, no API key, prompt over stdin, cwd=tmpdir).
      `lib/llm.ts` now owns the shared prompt/validation and dispatches; `lib/gemini.ts`
      slimmed to the backstop provider. Runtime-switchable at will from the inbox
      footer ("Summaries by" select → `settings` table, seeded by LLM_PROVIDER env);
      whichever provider is picked, the other backstops on failure. Verified live:
      sonnet ran via CLI, schema-conforming grounded summary; `tsc --noEmit` clean;
      `settings` table created in the live DB (no restart needed).
- [x] 2026-07-30 — **Vault handoff verified live**: Keep wrote timestamped files into
      `Inbox/notes` and the watcher picked both up instantly. Chain works.
- [x] 2026-07-30 — Watcher minimal fix (`src/main.js`), from a live failure: classifier
      model `gemini-2.5-pro` → `gemini-2.5-flash` (pro is `limit: 0` on the free tier, so
      every call 429'd and fell back to title "Unclassified Capture"), and
      `uniqueDestDir()` suffixes colliding slugs `-2, -3` instead of overwriting. The two
      identically-titled fallbacks had written to the same
      `Resources/unclassified-capture/index.md`, each clobbering the other's index.md and
      `original.txt` — the predicted data-loss bug, observed for real.
- [x] 2026-07-30 — Watcher hardening, rest of the ROADMAP fix-first list (`src/main.js`):
      · **Constrained taxonomy** — `sanitizeMeta()` matches area/domain/type against the
        enums case-insensitively and falls back (`Resources`/`Other`/`note`); titles are
        stripped of newlines/quotes, capped at 12 words, and rejected if they contain no
        alphanumerics; tags lowercased, deduped, capped at 8. Nothing from the model
        reaches the filesystem unvalidated, and `slugify()` refuses `.`/`..`.
      · **Fallback title from the document** — first markdown H1, else first non-empty
        line, instead of the constant "Unclassified Capture" that caused the collision.
      · **Full text in index.md** — frontmatter + `## Summary` + `---` + the complete
        body. Previously index.md held only `meta.summary`, which on the fallback path
        was `text.slice(0,300)` (observed truncating mid-word at "Job titles mentioni").
      · **Idempotency ledger** — `data/processed.json` (gitignored, atomic write) maps
        content sha256 → destination; a re-drop is parked in `Inbox/duplicates/` rather
        than filed twice or deleted. Recorded only after a successful write.
      · **Intake hardening** — `awaitWriteFinish` (2s stability) so partial iCloud
        materializations aren't classified; `isNoise()` skips dotfiles and
        `.icloud`/`.tmp`/`.download`/`.part` stubs; `depth: 0`; a serial promise queue so
        two captures can't race `uniqueDestDir`'s existsSync-then-mkdir.
      Verified: `node --check` plus a harness that splices the real functions out of
      `src/main.js` and runs them against a scratch vault — hostile classifier output
      (`area: "../../../etc"`, `title: "../../escape"`, `tags: "notanarray"`) sanitized to
      valid PARA with the traversal neutralized to `escape`; two same-titled notes filed
      to `same-title` and `same-title-2` with both bodies intact; an identical third drop
      parked as a duplicate.
