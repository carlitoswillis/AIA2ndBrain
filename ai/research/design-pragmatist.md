# Later

Later is a single-user, self-hosted read-later app you can have working this week: paste or share a URL, get a clean reading view, and see one Gemini-generated triage summary per article so you can decide keep/read/kill in 30 seconds. When you archive something worth keeping, it drops a Markdown file into the AIA2ndBrain Inbox and your existing watcher files it into PARA — the app is deliberately just the capture-and-read layer, nothing more.

## MVP scope
## What v1 does — feature by feature

**1. Save a URL (three ways, zero client code)**
- A text input at the top of the inbox page (paste, hit enter).
- A bookmarklet (`javascript:location='https://<host>/api/save?token=...&url='+encodeURIComponent(location.href)`).
- An iOS Shortcut in the share sheet that POSTs to the same `/api/save?token=...` endpoint. This is the daily-use driver — saving from the phone must be one tap.
- Dedupe on normalized URL hash: saving the same URL twice just bumps it to the top of the inbox.

**2. Clean extraction + reading view**
- On save, the server fetches the page and runs Defuddle (with jsdom) to get clean Markdown + title + site + word count. Raw HTML is stored in a column as insurance for future re-extraction — it's one `text` column, not a feature.
- `/read/[id]` renders the Markdown with react-markdown + the `.md-body` typography ruleset copied from workingmemory. Comfortable line length, estimated read time at the top, "open original" link always visible.
- If extraction fails (JS-rendered page, paywall), the article still saves with a visible "extraction failed" state, a retry button, and the original link. No headless Chrome in v1 — failure is a link, not a crash.

**3. One AI touch: triage summary on save**
- After extraction, a fire-and-forget Gemini call (gemini-2.5-flash, the plumbing pattern lifted from AIA2ndBrain) writes a ~120-word summary into the row. The inbox card shows it.
- Purpose: decide whether to read at all — this is the single most validated AI feature in the whole landscape research. It routes attention; it never replaces the article.
- That is the entire AI surface of v1. No auto-tagging, no chat, no embeddings, no favorite-problems matching.

**4. Triage-first inbox**
- `/` is the queue: newest first, each card = title, site, read time, summary, and three big buttons: **Read**, **Keep** (archive + export), **Delete**.
- Delete is one tap and guilt-free (Forte deletes ~half his queue; deletion is a success state). Hard delete — no trash can to manage.
- `/archive` lists kept items, read-only.

**5. Close the loop: export to the second brain**
- "Keep" writes `<slug>.md` (title, source_url, saved_at, summary, then the full extracted Markdown) into `~/Library/Mobile Documents/com~apple~CloudDocs/SecondBrain/Inbox/notes/`. The existing AIA2ndBrain watcher classifies and files it — **zero changes to that repo**.
- When running locally on the Mac this is a direct file write. Once hosted on Render, a small launchd script on the Mac (same pattern as workingmemory's backup pull) polls `/api/export-pending` and drops the files — but local-first works day one.

## Explicitly deferred (v2+, only if v1 gets daily use)
- Highlights and notes (read in the app, but distill in the vault/Obsidian for now)
- Full-text search (FTS5 column is trivial to add later; the inbox should be small enough to scroll)
- Tags (the Gemini classifier downstream already tags; don't tag twice)
- RSS, newsletters/email-in, YouTube transcripts, PDF ingestion (PDFs already have a path: drop them in Inbox/notes)
- Browser extension, headless-Chrome fetch worker, paywall DOM capture
- MCP server over the library, chat-with-article, weekly digests, spaced repetition
- Event-sourced history beyond a minimal status-change log
- Multi-user anything

## Architecture
## Stack

Sibling repo at `~/workspace/later`, scaffolded by copying patterns (not code paths) from `~/workspace/workingmemory`:

- **Next.js 14.2.15** (App Router, pinned — same as WM), React 18, TypeScript 5, Tailwind 3.4
- **better-sqlite3** with `experimental.serverComponentsExternalPackages: ["better-sqlite3"]`
- **defuddle + jsdom** for extraction (kepano's Readability successor; outputs clean Markdown directly). `@mozilla/readability` only if Defuddle disappoints — don't ship two extractors on day one.
- **@google/generative-ai** with `gemini-2.5-flash` for summaries (key already in the user's environment; flash, not pro — summaries are cheap and latency-sensitive)
- **react-markdown + remark-gfm** for the reading view, with WM's `.md-body` CSS and Nocturne theming mechanics (CSS variables, pre-paint theme script)
- Tests: plain `node lib/*.test.ts` files, verification gate `tsc --noEmit && next build && npm test` — WM's no-framework approach
- Deploy (phase 3): WM's exact chain — node:22-slim Docker + Litestream restore-then-exec + Render free tier + B2, plus the uptime ping and explicit-retention litestream.yml the WM audit flags as mandatory

## Data model (schema-as-code, WM style: CREATE_TABLES / CREATE_TRIGGERS / migrateDb applied idempotently on every open)

```sql
create table if not exists articles (
  id           text primary key,             -- uuid
  url          text not null,
  url_hash     text not null unique,         -- sha256 of normalized url, dedupe key
  title        text,
  site         text,
  status       text not null default 'inbox',   -- 'inbox' | 'archived'
  extract_status text not null default 'pending', -- 'pending' | 'ok' | 'failed'
  content_md   text,                          -- defuddle markdown
  raw_html     text,                          -- fetched html, future re-extraction
  summary      text,                          -- gemini triage summary (null until job lands)
  word_count   integer,
  saved_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at      text,
  archived_at  text,
  exported_at  text
);

create table if not exists article_events (   -- minimal WM trigger-history: status changes only
  id integer primary key autoincrement,
  article_id text not null references articles(id) on delete cascade,
  type text not null,                          -- 'saved' | 'read' | 'archived' | 'exported'
  at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

One `AFTER INSERT` trigger and one `AFTER UPDATE OF status/read_at/exported_at` trigger, copied structurally from WM (separate CREATE_TRIGGERS export so a future backfill can insert quietly). No boards/items/scopes inherited — WM stays a sibling, exactly as its audit recommends. Note `raw_html` changes the DB size class vs WM: keep Litestream retention short and consider `pragma page_size` defaults fine at hundreds-of-articles scale.

## Routes and actions

- `GET /` — inbox queue (server component, one prepared statement)
- `GET /read/[id]` — reading view; visiting it stamps `read_at`
- `GET /archive` — kept items
- `POST /api/save` — bearer/query token (single `SAVE_TOKEN` env var) for bookmarklet + iOS Shortcut; responds fast, extraction continues in-process
- `GET /api/export-pending` (phase 3, `OWNER_SECRET` bearer) — returns kept-but-unexported items as Markdown for the launchd puller, which then confirms via `POST /api/mark-exported`
- Server actions (thin, WM style): `saveUrl(url)`, `archiveAndExport(id)`, `deleteArticle(id)`, `retryExtract(id)`

## Capture → extract → AI flow (no job queue)

`saveUrl` inserts the row (`extract_status='pending'`), then inline: `fetch` with a browser UA → Defuddle → update row → fire-and-forget `summarize(id)` promise that calls Gemini and updates `summary` → `revalidatePath('/')`. Failures set `extract_status='failed'` and never lose the URL. An in-process flow is fine at one-user scale; the only concurrency is you.

## Second-brain integration

"Keep" produces exactly what the AIA2ndBrain watcher already eats: a `.md` file in `Inbox/notes`. Frontmatter carries `source_url`, `saved_at`, `type: article` — the watcher's Gemini classifier does PARA placement, tagging, and vault filing. The read app conforms to the existing vault contract instead of extending the watcher; extending the watcher to pass through frontmatter is a later, optional improvement in the *other* repo. workingmemory is untouched — it remains the task board; this is the capture layer beside it.

## Build estimate
**Phase 1 — first working session (one evening, ~3-4h):** scaffold repo from WM patterns (db.ts, schema.ts triple, layout, theming), `articles` table, `saveUrl` action with fetch+Defuddle, inbox list, `/read/[id]` view. End of session: paste a URL on localhost, read it clean. This is the lovable core — usable immediately via `npm run dev` on the Mac.

**Phase 2 — second session (~3h):** Gemini summary job + inbox cards with Read/Keep/Delete, dedupe, extraction-failure state + retry, bookmarklet, `.md-body` reading typography polish, direct-write export to `SecondBrain/Inbox/notes`. End of session: the full capture→triage→read→export loop works locally and feeds the PARA watcher.

**Phase 3 — third session (~3-4h):** copy WM's Dockerfile + Litestream + Render deploy, `SAVE_TOKEN`-guarded `/api/save`, iOS Shortcut, `export-pending` endpoint + launchd puller, uptime ping. End of session: one-tap save from the phone anywhere.

Total: three focused sessions inside one week, each ending with something usable. If phase 3 slips, phases 1-2 already deliver a daily-usable local tool.

## Risks
- Extraction quality is the make-or-break: if Defuddle mangles the first ten articles the user saves, the app dies of disuse. Mitigation: raw_html is always stored, 'open original' is always one tap, and a retry/re-extract path exists — but budget real time in phase 1 for testing extraction on the sites the user actually reads.
- Save-from-phone latency on Render free tier: cold starts make the iOS Shortcut feel broken (10-30s spin-up). The WM audit's uptime-ping requirement is doubly load-bearing here — a save endpoint that hangs kills the daily habit. Fallback: the Shortcut fires-and-forgets, and /api/save must insert the URL before extraction so nothing is lost even on timeout.
- The hosted app cannot reach the iCloud vault, so export depends on a launchd puller on the Mac — a second moving part that can silently stop. Mitigation: exported_at is tracked in the DB, so unexported kept items are visible in the UI as a badge rather than silently stranded.
- Scope creep is the real enemy of this lens: highlights, RSS, MCP, and search are all individually cheap and collectively fatal to shipping. The deferred list should be treated as a contract — nothing moves up until the user has saved and triaged articles for two consecutive weeks.
- Silent queue rot (the documented number-one failure mode of read-later apps): v1 has no resurfacing, so the inbox can become a landfill. The guilt-free one-tap Delete and summary-driven triage mitigate, but if the inbox exceeds ~50 items in month one, the v2 priority should be a weekly triage digest, not more capture paths.
- AIA2ndBrain watcher fragility inherited downstream: slug collisions overwrite notes and there is no awaitWriteFinish, so a burst of exported articles could lose data in the vault. Cheap insurance on the read-app side: prefix export filenames with a timestamp to make collisions near-impossible, and write files atomically (write temp, then rename).