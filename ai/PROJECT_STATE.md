# Project State

_Last updated: 2026-07-30._

## Current Focus (2026-07-30, later)
- **Phase 2 — the hub — is built.** Pulled forward past the two-week contract on purpose:
  the owner's honest reaction to phase 1 was "do I just open up the folder and work
  there?? it's not usable", which is the correct reaction, and the missing return path is
  exactly what would have prevented the daily use the contract was waiting for. Spec:
  `ai/plans/2026-07-30-phase2-library-search.md`. Needs the live gate on the Mac: open
  `/library`, click **Build the index**, then search.

## Earlier focus
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
- [ ] Fix Working Memory context staleness — it reads a local snapshot, not the deployed
      source of truth. See "Known staleness" below for the preferred approach.
- [ ] Restart the watcher to pick up the hardening pass (see Completed 2026-07-30) and
      watch one real capture through it.
- [ ] Watch one real capture through the hardened watcher and confirm the startup line
      reports `claude ✓` (the CLI probe is untestable in the sandbox).
- [ ] Re-Keep the two articles whose vault copies the collision ate (both still intact
      in brain.db with raw HTML): "AI Data Centers Scramble for Electricians" and
      "AI Surging in Job Titles Across Sectors".

## Known staleness: Working Memory context is read from a local snapshot

`brain/lib/context.ts` reads `~/workspace/workingmemory/data/owner/wm.db`, but the
**hosted instance is the source of truth**. That local file is only as fresh as the last
`RESTORE_LOCAL=1 scripts/pull-backup.sh` or local dev session — so on a day with no pull,
triage confidently judges saves against a board that may be days stale. That's worse than
having no context, because a wrong "bears on: X" is trusted.

Near-term fix, in preference order:

1. **A scoped read endpoint on the deployed Working Memory** — e.g. `GET /api/context`
   returning just `{list, label, text}` for open items on the owner's active board,
   guarded by its own read-only token. Preferred because the existing `/api/export` is
   guarded by `OWNER_SECRET` and returns the *entire multi-account database*; dumping all
   accounts to read 40 task titles is wildly disproportionate, and it would put that
   secret inside the brain app.
2. **Cache locally, don't fetch per-triage.** A save must never block on the network or
   fail because Render cold-started. Refresh on an interval (or reuse the existing daily
   pull) into a small local JSON cache; `context.ts` reads the cache and reports its age.
3. ~~**Show the age in the UI.**~~ ✅ done 2026-07-30 — freshness is measured as
   `MAX(items.updated_at)` in the snapshot (not the file mtime, which a pull rewrites
   without making the data newer). The footnote reads "as of 3h ago"; past
   `WM_STALE_HOURS` (default 48) the context is **withheld entirely** and the footnote
   says so with the pull command, because stale context makes the model assert ties to
   work that may already be finished.

Until then `WM_DB_PATH` can be pointed at the newest verified snapshot in
`backups/pull/<stamp>/wm.db` if that's fresher than the local main DB.

## Backlog (now sequenced by ROADMAP.md phases)
- [ ] Apple Notes live intake — spec in `ai/plans/2026-07-30-apple-notes-intake.md`.
      Next step is running `src/notes-probe.mjs` on the Mac (needs Full Disk Access) to
      confirm the NoteStore schema before any ingestion is wired.
- [ ] Phase 2 semantic half — embeddings / `sqlite-vec` for hybrid retrieval. Deferred to
      land with phase 3 chat, where it pays for itself. FTS5 keyword half is **done**.
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
- [ ] Migrate the watcher's Gemini backstop from `@google/generative-ai` (deprecated) to
      `@google/genai` with SDK-native structured output, matching the brain app.

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
- [x] 2026-07-30 — Watcher provider chain (`src/llm.js`, new): Claude CLI primary with
      Gemini backstop, mirroring `brain/lib/llm.ts` — same headless `claude -p
      --json-schema` invocation on the subscription login, order pinned by
      `LLM_PROVIDER`. `src/main.js` no longer talks to Gemini directly; `classifyText()`
      just calls `classify()` and sanitizes. Startup now prints which providers are
      reachable instead of discovering it on the first capture. The classification prompt
      also gained actual PARA guidance (what makes something a Project vs. an Area) and a
      real JSON schema rather than a shape sketch in prose. Blank/garbage titles from a
      provider now fall back to the document's own heading, not a shared constant.
      Root `.env.example` documents the new knobs.
      Verified with fake `claude` binaries on PATH: happy path parses the envelope and
      classifies; non-zero exit ("Credit balance too low") is caught, tries Gemini, and
      surfaces one combined error; fenced ```json output is tolerated; and provider junk
      (`area:"projects"`, `domain:"NotADomain"`, blank title, `tags:"nope"`) sanitizes to
      `Projects`/`Other`/`real-doc-heading` with tags dropped.
- [x] 2026-07-30 — **Current-work context in triage** (`brain/lib/context.ts`), pulling
      phase 3's "master-context doc" forward because it's cheap and improves triage now.
      Reads the sibling Working Memory app's SQLite (`WM_DB_PATH`, default
      `~/workspace/workingmemory/data/owner/wm.db`) **read-only**, takes open items from
      the most recently touched board, groups them by list (Today → Focus → Waiting →
      Backlog → Brain Dump), caps at 40 items / 1.8k chars, caches 60s. Injected into the
      triage prompt; `triage()` now also returns `relevance` — one clause naming which
      current item a save bears on, explicitly instructed that most articles bear on none
      and that a forced connection is worse than nothing. Stored in a new `items.relevance`
      column via a `migrateDb()` step in `lib/schema.ts` (pragma table_info guard, so a
      live DB self-migrates on next open — workingmemory's pattern, no migration runner).
      Rendered on the card only when non-null; the inbox footnote reports how many context
      items are in play, or says context is missing.
- [x] 2026-07-30 — **Phase 2: Library + search (the hub).** `docs` + `docs_fts` (FTS5,
      external-content so 4.8 MB of text isn't stored twice) with versioned sync triggers;
      `lib/markdown-file.ts` (frontmatter subset + HTML stripping + title derivation),
      `lib/indexer.ts` (walks both roots, mtime-skips unchanged, deletes vanished rows),
      `lib/search.ts`; pages `/library` (facets by area with counts, newest-first rows),
      `/search` (bm25, title weighted 8×, highlighted snippets), `/doc/[id]` (the capture
      reading view pointed at an indexed file), plus a nav search box and a Reindex button.
      **Decision changed from ROADMAP:** `docs` is its own table, not an extension of
      `items` — the indexer's simplest correct form wipes and rebuilds, and that must never
      be able to touch irreplaceable capture state (raw HTML, triage, kept stamps). Also
      keeps 4,333 rows out of the triage inbox.
      Four things found by testing against the real corpus, all now handled:
      · **iCloud eviction** — 2 vault files stat with a real size but can't be read; the
        prototype skipped them silently, i.e. a quietly incomplete index. Now recorded as
        `index_status='unreadable'`, surfaced as a count in `/library`, and retried on the
        next reindex regardless of mtime (a download doesn't change mtime).
      · **HTML residue** — 946 of the exported notes contain `<span style=…>`, which
        react-markdown escapes rather than renders. Stripped at index time: 946 → 0.
      · **FTS5 MATCH is a query language, not a search box** — raw input fails constantly
        (`AI & jobs`, `don't`, `c++`, `foo-bar` reads as a column filter, lone `*`). Input
        is now tokenized into quoted phrases ANDed together; deliberate operator syntax is
        attempted first and falls back.
      · **Fragments need snippets, not scores** — median note is 174 bytes, so the excerpt
        *is* the result. Hence `snippet()` everywhere, rendered via `<mark>` by splitting on
        delimiters rather than injecting HTML.
      Verified end-to-end without a Mac: the actual `CREATE_TABLES`/`CREATE_TRIGGERS`
      strings extracted from `lib/schema.ts` execute cleanly in sqlite3; the real parser ran
      over all 4,333 files (1.99s) and loaded into that schema (10.5 MB, FTS rows 4333 via
      triggers); queries return in 0.1–0.8ms with sensible ranking; UPDATE and DELETE
      triggers leave no stale terms (a marker term goes 1 → 0 and counts stay in sync).
      `tsc --noEmit` clean. Live gate on the Mac still owed.
      Verified: `tsc --noEmit` clean; the exact SQL run against the real `wm.db` yields 40
      items / 964 chars (Today, Focus, Waiting/Later, Backlog, Brain Dump — Focus is
      dominated by contract work and job search); `parseTriage` normalizes "none", "N/A",
      "No clear connection", blank, "nothing" → null so hedges never render, and still
      throws on invalid JSON / missing summary. A missing or locked wm.db degrades to
      generic summaries rather than failing a save.
