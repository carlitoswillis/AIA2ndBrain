# Resonance

Resonance is a self-hosted, single-user read-later app built as the capture front door of the CODE pipeline: one-tap verbatim capture from anywhere, a guilt-free triage queue with AI summaries used only to decide whether to read, a reading view where progressive summarization (bold → highlight → your-words executive summary) is the core interaction, and a one-click export that drops a distilled Intermediate Packet into the iCloud Inbox your existing Gemini/PARA watcher already files. AI routes attention and drafts on demand; it never replaces the verbatim source or your judgment of what resonates.

## MVP scope
## v1 scope — feature by feature (mapped to CODE)

### Capture (verbatim, seconds, from anywhere)
1. **Paste-a-URL capture** in the web app: server fetches the page, extracts with Defuddle (Readability fallback), stores **both** raw HTML (gzipped) and clean Markdown. Raw source is the moat — always kept for re-extraction.
2. **`POST /api/save` capture endpoint** (bearer capture-token) accepting `{url, html?, title?, selection?}`:
   - **Bookmarklet** that POSTs the user's own rendered, authenticated DOM — the legitimate paywall/JS-page escape hatch, no headless Chrome in v1.
   - **iOS Shortcut** on the share sheet POSTing the URL — phone capture is why the app is hosted, not local.
3. **Resonance note at capture (optional, one line)**: a single "why this?" field, plus four one-tap flags (inspiring / useful / personal / surprising). Skippable — designed for the worst version of yourself.

### Organize (queue ≠ archive; triage is first-class)
4. **Statuses**: `inbox → queue → reading → distilled → exported | trashed`. The queue is deliberately separate from the PARA vault; nothing is "filed" at capture.
5. **AI triage summary on save**: one Gemini Flash call producing a 150–300 word summary + word count + est. reading time, shown on the queue card. Its only job is the 30-second keep/read/kill decision; it collapses out of sight in the reading view.
6. **Twelve Favorite Problems**: a `problems` list the user maintains; every saved item is matched against it at capture (constrained classification). Matched problems show as badges in the queue — the standing capture filter, automated.
7. **Guilt-free deletion + review mode**: `/review` presents the inbox one item at a time with keyboard triage (queue / shortlist / trash / open). Deletion count is celebrated in stats, not hidden — Forte deletes ~half; so should this app's user.

### Distill (the heart: progressive summarization on verbatim text)
8. **Reading view** rendering the extracted Markdown (WM's `.md-body` ruleset), with scroll-position read progress persisted.
9. **Layered highlighting**: select text → **Layer 2 (bold)**; select within bolded text → **Layer 3 (highlight)**; attach a note to any highlight. Layers are the data model, not a styling trick. Distillation happens lazily, whenever the user actually reads — never eagerly at capture.
10. **Executive summary (Layer 4) in the user's own words**, edited in a side panel. One on-demand AI assist: "draft from my highlights" — grounded ONLY in the user's own Layer 2/3 selections, clearly labeled as a draft to rewrite. AI never summarizes the full text into Layer 4.
11. **On-demand resonance suggestions**: a button that asks Gemini to propose up to ~10% of passages likely to resonate (biased by the Favorite Problems). Suggestions render as ghost-underlines the user must tap to confirm into real highlights. Never auto-applied.

### Express (close the loop into the existing second brain)
12. **Export to vault**: composes one Markdown file — title, source URL, dates, executive summary, resonance note, highlights as blockquotes with bolds preserved and notes attached — and queues it. A tiny launchd puller on the Mac writes it atomically into `SecondBrain/Inbox/notes`, where the **existing AIA2ndBrain watcher classifies it into PARA unchanged** (zero-code-change integration). Item flips to `exported` with the eventual vault path recorded.
13. **Full-text search** (SQLite FTS5 over title + content + highlights) and a plain list of all highlights per item.
14. **Auth + deploy**: WM's scrypt + HMAC session copy-paste, Docker + Litestream → B2 on Render free tier.

### Explicitly deferred (v2+)
- RSS / newsletter email-in (Forte's "air-gapped feed" — the biggest v2 feature, but capture must be proven first)
- MCP server exposing search/recent/highlights to Claude (v2 headline, per Forte's PCM thesis)
- PDFs and YouTube transcripts in the reader (PDFs already flow through the watcher directly)
- Headless-Chrome fetch worker, browser extension (bookmarklet covers it)
- Embeddings/semantic search, weekly AI digest, spaced repetition, chat-with-library, any auto-tagging beyond the watcher's existing PARA taxonomy
- Multi-user scoping beyond WM's `scope_id IS ?` pattern (schema carries the column; UI ignores it)

## Architecture
## Stack

Sibling repo `~/workspace/resonance` (not a bolt-on to workingmemory — WM's schema is board/item-shaped; everything reusable is a copyable pattern):

- **Next.js 14 (App Router) + React 18 + TypeScript + Tailwind**, pinned like WM; `experimental.serverComponentsExternalPackages: ["better-sqlite3"]`
- **better-sqlite3** with WM's schema.ts triple: `CREATE_TABLES` + `CREATE_TRIGGERS` as separate exports + pragma-guarded additive `migrateDb`, applied idempotently on every open; no migration runner
- **Extraction**: `defuddle` (primary) + `@mozilla/readability` + `linkedom` (fallback), `zlib` gzip for raw HTML blobs
- **AI**: `@google/genai` (new SDK), `gemini-2.5-flash` with `responseMimeType: "application/json"` + response schema (fixing the prompt-only STRICT-JSON fragility of the watcher); `lib/gemini.ts` pure module
- **Rendering**: `react-markdown` + `remark-gfm` via WM's Markdown component; Nocturne CSS-variable theming + pre-paint theme script copied wholesale
- **Auth/deploy**: WM's scrypt hashes, `v2.<uid>.<exp>.<hmac>` stateless sessions, edge twin for middleware, token-bucket rate limits; node:22-slim Docker + baked Litestream + start.sh restore-then-exec → Render free tier → B2 (with the explicit-retention litestream.yml and uptime ping WM proved necessary)
- **Tests**: plain `node lib/*.test.ts`, gate = `tsc --noEmit && next build && npm test`

## Data model (`lib/schema.ts`)

```sql
items(
  id text pk,               -- uuid
  scope_id text,            -- WM scoping pattern, null in single-user
  url text not null, canonical_url text,
  title text, author text, site_name text, published_at text,
  saved_at text default ISO_NOW,
  status text default 'inbox',  -- inbox|queue|reading|distilled|exported|trashed
  shortlisted integer default 0,
  word_count integer, read_progress real default 0,
  resonance_note text,          -- "why this?" at capture
  flag_inspiring/flag_useful/flag_personal/flag_surprising integer,
  ai_summary text, ai_model text,          -- triage summary, 150-300 words
  exec_summary text,                        -- Layer 4, user's words
  exported_at text, vault_path text,
  created_at/updated_at text
)

item_content(                 -- 1:1, keeps items rows small & listable
  item_id text pk references items on delete cascade,
  raw_html blob,              -- gzipped verbatim source (the moat)
  content_md text,            -- Defuddle output
  extracted_with text, extracted_at text
)

highlights(
  id text pk, item_id text references items on delete cascade,
  layer integer not null,     -- 2 = bold, 3 = highlight
  text text not null,         -- exact verbatim quote
  prefix text, suffix text,   -- W3C text-quote anchors for re-anchoring
  start_off integer, end_off integer,  -- offsets into content_md
  note text, suggested_by text,        -- null | 'ai' (accepted suggestion)
  created_at text
)

problems(id text pk, text text not null, position real, active integer default 1)
item_problems(item_id, problem_id, matched_by text, confidence real, pk(item_id, problem_id))

item_events(                  -- append-only, written ONLY by triggers (WM rule)
  id integer pk autoincrement, item_id, type text,
  -- saved|triaged|opened|progressed|highlighted|distilled|exported|trashed|restored
  field text, old_value text, new_value text, actor_id text, at text
)
-- AFTER INSERT logs 'saved'; one AFTER UPDATE OF per tracked field
-- (status, read_progress, exec_summary, ...) with WHEN new.x IS NOT old.x;
-- versioned by drop-v1/create-v2 names

items_fts(fts5: title, content_md, exec_summary, highlights_concat)
-- kept in sync by triggers; BM25 search at personal scale, no vector DB
```

`max(item_events.id)` doubles as a changefeed cursor — the same substrate WM plans to run LLM weekly reviews over, ready for v2 digests.

## Routes & server actions

- `/` — queue (tabs: Inbox / Queue / Shortlist / Distilled / Exported / Trash), cards show AI summary + reading time + problem badges + resonance flags; keyboard j/k/q/s/x/enter
- `/read/[id]` — reading view; selection toolbar (Bold L2 / Highlight L3 / Note); right panel: exec-summary editor, highlight list, collapsed AI triage summary
- `/review` — weekly-review mode: one inbox item at a time, big keys, deletion streak stats
- `/problems` — manage the Twelve Favorite Problems
- `/search` — FTS5 results with snippet()
- `POST /api/save` — capture endpoint (capture-token bearer) for bookmarklet + iOS Shortcut
- `GET /api/exports/pending` + `POST /api/exports/ack` — export handoff (OWNER_SECRET bearer, like WM's /api/export)
- Server actions (thin, WM style: scope-first arg, choke-point `getReaderContext()`, one prepared statement, `revalidatePath`): `saveUrl`, `triageItem`, `setProgress`, `addHighlight`, `promoteHighlight`, `removeHighlight`, `saveExecSummary`, `draftExecSummaryFromHighlights`, `suggestResonantPassages`, `exportItem`, `matchProblems`

## Ingestion pipeline (in-process, boring monolith)

`saveUrl` / `api/save` → insert `items` row (status inbox, instant response) → in-process job (setImmediate; no queue infra): fetch (skipped when bookmarklet supplied HTML) → Defuddle → store `item_content` → count words → one Gemini Flash call returning `{summary, problems: [ids], confidence}` (structured output, constrained to the user's problem list) → update row. Failures leave the item in inbox with a "extraction failed — open original" state, never lost.

## Closing the loop with AIA2ndBrain (zero-code-change first)

1. `exportItem` composes Markdown: H1 title, source/saved/read metadata lines, `## Executive Summary` (user's words), `## Why it resonated`, `## Highlights` (blockquotes, **bolds preserved**, notes as sub-bullets), source link footer.
2. A ~60-line launchd script on the Mac (`scripts/pull-exports.mjs`, modeled on WM's launchd backup pull) polls `/api/exports/pending`, writes each file atomically (tmp + rename) into `SecondBrain/Inbox/notes`, then acks.
3. The existing watcher classifies it into PARA exactly as it does any note — Gemini sees a distilled, structured document, so classification quality goes up, not down.
4. **Optional phase 4b (small watcher PR)**: add chokidar `awaitWriteFinish`, suffix slug collisions instead of overwriting, and pass through incoming frontmatter keys (`source_url`, `saved_at`, `read_at`, `type: article`) — yaml is already a dependency. This hardens the pipeline for volume but is not required for v1 to work.

Relevant absolute paths: watcher contract at `/Users/carlitoswillis/workspace/AIA2ndBrain/src/main.js` (frontmatter = `captured_at` + Gemini fields + `source_path`; vault = `~/Library/Mobile Documents/com~apple~CloudDocs/SecondBrain`); patterns to copy from `/Users/carlitoswillis/workspace/workingmemory/lib/{schema.ts,db.ts,auth.ts,auth-edge.ts,session.ts,search.ts}`.

## Build estimate
Phase 0 — Skeleton + capture (first working session, ~1 day): scaffold repo from WM patterns (schema.ts with items/item_content/highlights/problems/item_events/FTS, db.ts, auth copy, theming), `saveUrl` action + Defuddle extraction + gzip raw HTML, queue list at `/`. Deliverable at end of session: paste a URL, watch it extract, read the clean text in a basic view — the CODE front door exists.

Phase 1 — Distill (2-3 sessions): reading view with .md-body, progress tracking, selection toolbar, Layer 2/3 highlights with text-quote anchors, exec-summary editor. Phase 2 — AI triage (1-2 sessions): lib/gemini.ts with structured output, capture-time summary, Favorite Problems CRUD + matching, /review triage mode with keyboard flow. Phase 3 — Express loop (1-2 sessions): export composer, /api/exports/pending + launchd puller into Inbox/notes, exported-status tracking; optional watcher hardening PR (awaitWriteFinish, slug-collision suffix, frontmatter passthrough). Phase 4 — Ship (1 session): capture token + bookmarklet + iOS Shortcut, Docker/Litestream/Render/B2 deploy with uptime ping. On-demand AI assists (draft-from-highlights, resonance suggestions) slot into any later session; RSS, MCP server, and weekly digest are v2.

## Risks
- DB size class: gzipped raw HTML blobs make the SQLite file grow far faster than workingmemory's, stressing Litestream replication and B2 free-tier caps — mitigate with compression, a per-item raw-HTML size cap (~2MB), and monitoring; be ready to move raw_html to a second non-replicated DB or B2 object storage.
- Render free-tier cold starts plus Litestream can blow B2's Class C list-call cap without the explicit-retention litestream.yml and an external uptime ping (already proven necessary by workingmemory) — capture from the phone also feels bad if the service takes 30s to wake.
- Extraction failure on JS-rendered and paywalled pages when saving by URL from the phone (no rendered DOM available); the bookmarklet covers desktop, but some mobile saves will land as 'open original' stubs until a fetch worker or extension exists.
- Feeding volume into the unhardened watcher: slug collisions silently overwrite notes and there is no awaitWriteFinish or dedupe — exports from the reader raise collision odds (similar article titles), so the phase-4b watcher hardening is genuinely load-bearing, not optional polish.
- Highlight anchor drift: if content_md is ever re-extracted (better extractor, fixed bug), offset-based anchors break — text-quote prefix/suffix re-anchoring mitigates but won't be perfect; never discard the original content_md a highlight was made against.
- Queue landfill risk: even with review mode and deletion stats, a solo user can stop triaging; without the v2 resurfacing digest the app can quietly become the '10,000 unread saves' failure mode BASB warns about.
- Export loop depends on the Mac being awake to run the launchd puller — exports queue harmlessly, but the capture→PARA loop is only as live as the laptop; acceptable for v1, worth revisiting if the vault ever moves off iCloud.
- AI cost/latency at capture: a Gemini call per save is cheap at personal volume but becomes the reason to skip auto-summarizing if RSS ingestion arrives in v2 (Readwise deliberately doesn't summarize feed items); keep the summary call isolated so it can be made conditional.
- Scope temptation: chat-with-library, embeddings, flashcards, and auto-distillation are all documented gimmicks at this scale — the purist line (AI routes attention, human distills) is also the smallest buildable line; hold it.