# Marrow

Marrow is an AI-native read-later app that treats every save as future context, not just future reading: each capture is extracted verbatim, summarized and triaged by Gemini against your Twelve Favorite Problems in one structured call, made retrievable via hybrid FTS5+vector search, and exported into the PARA vault your AIA2ndBrain watcher already files. The queue triages itself, the app writes your weekly review, and an MCP server turns the whole library into memory for Claude — while keeping the raw originals (your "unique data moat") sacred and the AI strictly in a routing role.

## MVP scope
## v1 — What it does, feature by feature

**1. Capture (seconds, two paths)**
- `POST /api/capture` with a bearer token; body is `{url}` or `{url, html, title}`.
- A bookmarklet + minimal MV3 extension that POSTs the *user's own rendered, authenticated DOM* — this is the paywall/JS-page escape hatch, so no headless Chrome worker is needed in v1.
- Manual paste box in the UI for a URL or raw text/markdown (voice memos and PDFs already flow through the existing AIA2ndBrain inbox; don't duplicate).

**2. Extraction + faithful archive**
- Defuddle first, `@mozilla/readability` fallback, producing clean Markdown (`content_md`).
- Raw HTML is always stored gzipped so anything can be re-extracted later. Verbatim source is the moat; nothing is stored summary-only (the exact fragility AIA2ndBrain has today).

**3. One AI call per save (the AI-native core)**
- A single Gemini 2.5 Flash structured-output call returns the whole "triage card": 150–300 word summary, verdict (`read | skim | kill`), resonance score against the user's stored Favorite Problems (with which problem matched and why), suggested PARA area + tags **constrained to the existing vault taxonomy**, estimated read time.
- Runs async via an in-process job queue — capture returns in <200ms, the card appears when ready. Honest cost: ~$0.002–0.01 per article on Flash; explicitly *no* auto-summarization of bulk/RSS-shaped sources (Readwise's own cost lesson).
- Embeddings (gemini-embedding-001, ~1000-token chunks) generated in the same job for retrieval.

**4. Triage inbox ("the queue triages itself")**
- Keyboard-driven 30-second flow: j/k navigate, glanceable AI card per item, one-key `later / shortlist / archive / kill`. Deletion is celebrated (Forte kills ~half), and the AI verdict pre-sorts the inbox — kill-recommended items sink to a "probably skip" band you can mass-delete.

**5. Reading view + highlights**
- WM's `.md-body` markdown ruleset, theme variables, progress tracking. Selection → highlight stored with quote + prefix/suffix anchors + optional note. Human distillation stays manual (Progressive Summarization is lazy by design); AI never bolds for you.

**6. Chat with your library (grounded, cited)**
- `/chat`: hybrid retrieval (FTS5 BM25 + sqlite-vec cosine, reciprocal-rank fusion) → top-k chunks → Gemini answer with `[item]` citations linking into the reader. Scoped to "what did I save about X" retrieval, not whole-vault synthesis — that's the version of RAG that actually works.
- A `master_context` document (mini Master Prompt: role, goals, style) is prepended to chat and review calls.

**7. AI weekly review**
- A cron-triggered job runs the LLM over the week's `item_events` + triage cards → a digest note: what you saved, what you actually read, themes clustered, 3–5 resurfaced items matched to Favorite Problems, and a "queue hygiene" section (stale items proposed for deletion). Rendered at `/review` and exported to the vault as a Review note.

**8. PARA export bridge (closing the BASB loop)**
- "Send to brain" (and auto on archive-with-highlights): compose an `index.md`-style Markdown file — frontmatter extended with `source_url`, `saved_at`, `status`, `type: article`, plus summary and highlights — queued in the DB; a tiny local launchd script polls `/api/vault-queue` and writes files into the iCloud `Inbox/notes` folder. **Zero changes to the existing watcher.**

**9. MCP server**
- Tools: `search_library`, `get_item`, `get_summary`, `list_recent`, `list_highlights`, `save_url`. This is the "library as retrievable context for future agents" payoff and Forte's headline ask.

## Explicitly deferred
- RSS/newsletter email-in ingestion (biggest omission, but it changes the volume/cost class — v2)
- YouTube transcripts, EPUBs, in-app PDF reading
- Headless-Chrome fetch worker (extension DOM-post covers v1)
- Spaced-repetition quizzes, TTS, Karpathy-style auto-compiled topic wiki pages
- Auto-highlighting / AI-suggested resonant passages (flagging only, later)
- Multi-user, mobile apps (PWA share target is a cheap v1.5)
- Any graph view (Forte: useless)

## Architecture
## Stack
- **Next.js 14 App Router + TypeScript + Tailwind + better-sqlite3** — a direct sibling of workingmemory, copying its proven kit: `schema.ts` triple (CREATE_TABLES / CREATE_TRIGGERS / pragma-guarded `migrateDb`) applied idempotently on open, scrypt + HMAC stateless sessions, `serverComponentsExternalPackages: ["better-sqlite3"]`, plain `node lib/*.test.ts` tests, Nocturne theming mechanics, thin server actions with a `getContext()` choke point.
- **AI**: `@google/genai` (the new SDK — upgrade from AIA2ndBrain's 0.5.0) with `responseMimeType: "application/json"` + `responseSchema` and enum validation on parse — fixing the silent-misfile fallback bug class. Gemini 2.5 Flash for triage/chat/digest, `gemini-embedding-001` for vectors.
- **Extraction**: `defuddle` → `@mozilla/readability` fallback; `node:zlib` gzip for raw HTML.
- **Search**: SQLite **FTS5** (external-content table over items, trigger-maintained) + **sqlite-vec** for embeddings; brute-force cosine is fine at personal scale.
- **Deploy**: same Docker + Litestream → B2 + Render chain as WM, with the uptime ping doubling as the cron heartbeat.

## Data model (SQLite)
- `items` — id (text uuid), url, canonical_url, title, author, site, kind (`article|pdf|note`), source (`extension|manual|api`), status (`inbox|later|shortlist|archive|trash`), content_md, word_count, read_progress (0–1), lang, saved_at, published_at, updated_at
- `item_archives` — item_id, raw_html_gz (blob), fetched_at (separate table so the hot `items` rows stay small)
- `item_events` — append-only, written **only by AFTER INSERT / AFTER UPDATE OF triggers** (WM's crown jewel): saved, status, progress, title edits, with actor + ISO `at`; `max(id)` is the changefeed cursor the weekly review reads
- `ai_notes` — item_id, summary_md, verdict, resonance (json: {score, matched_problem_id, rationale}), suggested_area, suggested_tags (json), est_read_min, model, tokens_in, tokens_out, cost_usd, created_at — **cost is a first-class column**, surfaced in settings
- `chunks` — item_id, idx, text; `vec_chunks` — sqlite-vec virtual table keyed to chunks
- `items_fts` — FTS5 over title + content_md
- `highlights` — id, item_id, quote, prefix, suffix, note_md, created_at
- `tags` / `item_tags` — taxonomy seeded from the PARA vault's existing tags; LLM may only pick from it
- `favorite_problems` — id, text, active (injected into every triage prompt)
- `master_context` — single versioned document (the mini Master Prompt)
- `chat_sessions` / `chat_messages` — role, content_md, citations (json of item_ids + chunk idx)
- `digests` — id, week_of, body_md, created_at
- `jobs` — id, type (`extract|triage|embed|export`), item_id, status, attempts, last_error, run_after — in-process queue drained by a `setInterval` worker in instrumentation; boring monolith, no Redis
- `vault_exports` — item_id, frontmatter_json, body_md, status (`pending|written`) — the outbox the local bridge polls

## Key routes / surfaces
- `POST /api/capture` (bearer token; url or url+DOM) → insert item + enqueue jobs
- Pages: `/` (triage inbox), `/read/[id]`, `/library` (search + filters), `/chat`, `/review`, `/settings` (problems, master context, taxonomy, cost meter)
- `GET /api/vault-queue` + `POST /api/vault-queue/ack` (OWNER_SECRET) — consumed by a launchd bridge script that writes Markdown into iCloud `Inbox/notes`, where **AIA2ndBrain's watcher classifies and files it unchanged**; frontmatter passthrough is the only watcher enhancement worth making later
- `GET /api/cron/weekly?secret=` — digest job trigger
- `/api/export` — streamed `db.backup()` snapshot behind OWNER_SECRET (copied from WM, verified by the existing launchd pull)
- **MCP server**: a small standalone Node process (`mcp/server.ts`, stdio for Claude Code + streamable-HTTP behind the bearer token) reading the same SQLite file locally or hitting a `/api/mcp-query` endpoint when remote — tools: search_library, get_item, get_summary, list_recent, list_highlights, save_url

## How the AI pipeline flows
capture → `extract` job (Defuddle, store md + gzipped HTML) → `triage` job (one Flash call: summary + verdict + resonance + constrained PARA/tags, schema-validated; failures land in a visible "needs review" state, never silently misfiled) → `embed` job (chunk + embed) → item surfaces in inbox with its card. Reading/highlighting emits trigger events → weekly cron feeds events + cards + master_context to Flash → digest + resurfacing → digest and archived-with-highlights items flow through `vault_exports` → local bridge → PARA vault → existing Gemini watcher. Chat and MCP read the same FTS+vec indexes, so the second brain is one substrate with three mouths: the UI, Claude via MCP, and the vault.

## Build estimate
Phase 1 — Skeleton reader (first working session, ~1 weekend): scaffold sibling repo copying WM's db/schema/auth/theming kit; `items` + `item_events` + triggers; `POST /api/capture` + bookmarklet; Defuddle extraction with raw-HTML archive; reading view with progress. Deliverable: paste/bookmarklet a URL, read it clean, status flows inbox→archive — a usable Pocket replacement on day one, deployable on the existing Render+Litestream chain.
Phase 2 — AI triage (~1 weekend): `jobs` worker, Gemini structured triage call with favorite_problems + constrained taxonomy, `ai_notes`, keyboard triage inbox with verdict-sorted bands, cost meter.
Phase 3 — Retrieval (~1–2 weekends): highlights, FTS5 + sqlite-vec embeddings, `/library` hybrid search, grounded `/chat` with citations.
Phase 4 — The loop (~1–2 weekends): weekly digest cron + `/review`, `vault_exports` + launchd bridge into AIA2ndBrain, MCP server, MV3 extension with DOM-post. Total: roughly 4–6 solo weekends to full v1, with each phase independently shippable.

## Risks
- Render free-tier cold starts can eat captures: an extension POST during spin-up times out, and capture is the one flow that must never fail. Mitigate with retry+localStorage queue in the extension and the existing uptime ping — or accept that capture reliability may eventually force a $7 paid dyno.
- Full text + gzipped raw HTML changes the DB size class that WM's Litestream ship-everything/24h-retention settings assume; unmonitored, this blows B2 free-tier caps. Mitigate: compress aggressively, keep archives in a separate table, add size to the launchd backup check, and plan an archive-offload path.
- Per-save LLM cost/latency creep: fine at 10 saves/day on Flash (~$1–3/mo), but adding RSS/newsletter ingestion later multiplies volume 10–50x — the pipeline must keep its 'no auto-summary for bulk sources' rule and the cost_usd column honest before v2 ingestion lands.
- The iCloud vault lives on the Mac while the app lives on Render, so the PARA loop depends on a launchd bridge script — a silent-failure moving part. Mitigate with a staleness alarm (pending vault_exports older than 24h surfaces in the UI).
- Schema-validated or not, Gemini triage will sometimes be confidently wrong; AIA2ndBrain already demonstrates the silent-misfile failure mode. Verdicts must route attention (sorting, suggestions) and never auto-delete or auto-file without a human keystroke.
- AI summaries as cognitive crutch: if the triage card is good enough, the user stops reading and the second brain fills with unread summaries — the documented landfill failure. Mitigate by keeping summaries triage-length, celebrating deletion, and having the weekly review nag about save:read ratio and stale items.
- Extraction gaps: Defuddle+Readability will fail on some JS-heavy/paywalled sites until the extension DOM-post ships in Phase 4; early phases should make 'extraction failed, kept raw HTML' a visible recoverable state, not a lost save.
- MCP/API exposure: save_url and search over a personal library behind a single bearer token on a public Render URL is a real attack surface; scope tokens, rate-limit in middleware (WM pattern), and keep the stdio-local MCP path as the default for Claude Code.
- Tag/taxonomy drift between the reader's tags table and the vault's actual folders/tags: without a periodic sync (or making the vault the single source of truth), the 'constrained taxonomy' quietly stops matching reality.