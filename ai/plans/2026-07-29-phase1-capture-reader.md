# Phase 1 — Capture + Reader (`brain/`)

_Part of the second brain app; see `ai/ROADMAP.md` for how it fits the whole system.
Research basis: `ai/research/` (2026-07-29 sweep). Status: **scaffold started, paused
2026-07-29 — resume checklist at the bottom.**_

## What phase 1 is

The capture front door of the brain app (BASB step 3: the capture tool). Save a URL
from anywhere → verbatim extraction → one Gemini triage summary → 30-second
keep/read/kill inbox → clean reading view → "Keep" exports a structured .md into the
iCloud vault inbox, where the existing watcher (`src/main.js`) classifies it into PARA
**unchanged**. The reader is deliberately just capture-and-read; organization stays
downstream.

## What already exists on disk (paused here)

```
brain/
  package.json        ✅ deps installed (next 14.2.30, better-sqlite3, defuddle 0.6.6,
                         jsdom ^24 (defuddle peer requires ^24, NOT 26), @google/genai,
                         react-markdown, remark-gfm). Scripts: dev on PORT 3002.
  tsconfig.json       ✅ standard Next strict TS
  next.config.js      ✅ serverComponentsExternalPackages: better-sqlite3, jsdom, defuddle
  .gitignore          ✅ node_modules, .next, data/, .env*
  .env.example        ✅ GEMINI_API_KEY, SAVE_TOKEN, VAULT_INBOX, DATA_DIR
  lib/schema.ts       ✅ items / item_content / item_events + versioned triggers (below)
  lib/db.ts           ✅ getDb() singleton, WAL, FK on, idempotent schema apply, Item type
  lib/extract.ts      ✅ fetchAndExtract(url) / extractFromHtml(html, url) via Defuddle
                         (API verified: Defuddle(htmlString, url, {markdown:true}) →
                         {content, title, author, site, domain, published, wordCount})
```

Not yet written: `lib/gemini.ts`, `lib/vault.ts`, `lib/save.ts`, `app/*` (all pages,
actions, api route, css). Specs below are complete — write them as specced.

## Data model (in lib/schema.ts, already written)

- `items` — id (uuid), kind ('article' now, 'note' in phase 2), url, url_hash
  (sha256 of normalized url, UNIQUE — dedupe), title, author, site,
  status ('inbox' | 'kept'), extract_status ('pending' | 'ok' | 'failed'),
  extract_error, content_md (Defuddle markdown — canonical text), word_count,
  summary (Gemini), published_at, saved_at, read_at, kept_at, exported_at, vault_file.
  Delete is a hard delete (guilt-free, no trash to manage).
- `item_content` — 1:1, raw_html BLOB (gzipped verbatim source; the re-extraction moat).
- `item_events` — append-only, written ONLY by triggers (saved / kept / read /
  exported). This is the future substrate for the phase-4 weekly review.

## Remaining modules — exact specs

### lib/gemini.ts
- `@google/genai`: `new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY})`,
  model `gemini-2.5-flash`, `config: {responseMimeType: "application/json",
  responseSchema}` (use `Type.OBJECT` etc. — no regex JSON parsing, fixing the
  watcher's fragility).
- One exported fn: `triage(title, url, contentMd)` → `{summary, suggested_title}`.
  Prompt: ~120-word summary whose only job is deciding whether to read at all;
  truncate content to ~40k chars. Throw on failure (caller stores null summary +
  shows retry) — never fabricate.

### lib/vault.ts
- `exportToVault(item, contentMd)` → writes markdown to `VAULT_INBOX`
  (default `~/Library/Mobile Documents/com~apple~CloudDocs/SecondBrain/Inbox/notes`).
- File shape: H1 title · metadata lines (Source url, Saved date, Author/Site) ·
  `## Summary` (Gemini) · `---` · full content_md. The watcher Gemini-classifies the
  text, so metadata lines must be in-body (it doesn't parse frontmatter).
- Filename `YYYY-MM-DD-HHmmss-<slug>.md` (timestamp prefix defends against the
  watcher's slug-collision overwrite bug). Write atomically: `.name.md.tmp` in the
  same dir (watcher ignores .tmp extensions), then `fs.renameSync`. `mkdirSync
  recursive` first.
- Returns the filename; caller stamps exported_at + vault_file.

### lib/save.ts
- `normalizeUrl(url)`: http(s) only (reject others), strip hash, strip `utm_*`
  params, lowercase host, drop trailing slash. sha256 → url_hash.
- `insertItem(url)` → `{id, deduped}` — INSERT OR IGNORE on url_hash; on conflict
  bump saved_at (resave = move to top), return existing id.
- `processItem(id)`: fetchAndExtract → gzip raw_html into item_content → update
  extraction fields → try triage() → update summary. Each stage try/caught so the
  URL row is never lost; failures set extract_status='failed' + extract_error.
  Row is inserted BEFORE any network work — that ordering is the reliability
  guarantee.

### app/actions.ts ("use server", thin — one statement each, then revalidatePath)
- `saveUrl(formData)` — insert + await processItem
- `keepItem(id)` — exportToVault, then status='kept', kept_at/exported_at/vault_file
- `deleteItem(id)` — hard DELETE
- `retryItem(id)` — re-run processItem

### app/api/save/route.ts
- GET (bookmarklet: `?token=&url=`) and POST (iOS Shortcut: bearer or ?token,
  json/form). Token = constant-time compare vs `SAVE_TOKEN`. Insert row FIRST, then
  process; GET redirects to `/`, POST returns `{id, extract_status}`. A timeout can
  never lose the URL.

### Pages (server components only; zero client JS in v1)
- `/` inbox: save form (input name=url → saveUrl) + cards newest-first:
  title · site · ~N min read · summary · [Read] [Keep] [Delete] as forms.
  extract_status='failed' cards show the error, [Retry], and the original link.
  Footer: bookmarklet link (href built server-side from SAVE_TOKEN) + iOS Shortcut
  one-liner instructions.
- `/read/[id]`: stamps read_at if null, renders content_md via react-markdown +
  remark-gfm in a 42rem column, header meta line, Keep/Delete/original-link actions.
- `/kept`: kept items list with vault_file shown.
- Styling: `app/globals.css` only — CSS variables, dark + light via
  prefers-color-scheme, serif reading stack (Charter/Georgia) for article text,
  system sans UI. No Tailwind. (Steal the .md-body feel from workingmemory's
  Nocturne, not its code.)

### Env / local setup
- `brain/.env`: copy `GEMINI_API_KEY` from repo-root `.env`; generate
  `SAVE_TOKEN=$(openssl rand -hex 24)`. Dev: `npm run dev` → localhost:3002
  (3001 is workingmemory).

## Verification gate
`npx tsc --noEmit && npm run build`, then live: save a real article URL, see summary
appear, Read renders clean, Keep drops a file in the vault inbox and the watcher files
it, Delete removes, duplicate save dedupes, a garbage URL fails visibly with Retry.

## Deferred (contract: nothing moves up until 2 weeks of daily use)
Highlights/progressive summarization · FTS5 search · RSS/email-in · YouTube/PDF
in-reader · embeddings + chat (phase 2/3) · MCP · weekly digest (phase 4) · hosted
deploy via workingmemory's Render+Litestream chain (phase 5) · multi-user.

## Risks accepted for v1
- JS-rendered/paywalled pages fail extraction → visible failed state + original
  link + retry; bookmarklet-posts-DOM is the v2 escape hatch.
- Export writes directly to the iCloud path → local-only until phase 5's puller.
- Watcher fragility downstream (see ROADMAP fix-first list) → mitigated here by
  timestamp filenames + atomic writes.

## Resume checklist (weekend)
1. ~~`cd brain` — node_modules already installed~~
2. ~~Write `lib/gemini.ts`, `lib/vault.ts`, `lib/save.ts` per specs above~~ ✅ 2026-07-29
3. ~~Write `app/` (layout, globals.css, page, read/[id], kept, api/save, actions)~~ ✅
4. ~~Create `brain/.env` (key from root `.env`, fresh SAVE_TOKEN)~~ ✅
5. Verification gate — **`tsc --noEmit` clean ✅; live gate still owed** (must run on the
   Mac: `npm run build` needs the macOS-native swc/better-sqlite3 binaries)
6. Then: two weeks of real use before phase 2 (per ROADMAP scope contract)

## Deltas from the spec (as built, 2026-07-29)
- `tsconfig.json` gained `"target": "es2022"` (spec's `URLSearchParams` iteration
  needed it).
- `normalizeUrl` additionally strips `www.` and a handful of non-utm trackers
  (`gclid`, `fbclid`, `ref`, …), and rejects explicit non-http schemes and URLs
  carrying embedded credentials.
- `insertItem` does a SELECT-then-UPDATE/INSERT rather than `INSERT OR IGNORE`, so the
  resave path can bump `saved_at` without firing the insert trigger a second time.
- Server actions take `FormData` (they're wired directly to `<form action={…}>`);
  `keepItem`/`deleteItem` redirect to `/` so they work from the reading view.
- `/api/save` GET redirects to `/`; POST accepts JSON, form-encoded, or a bare-text
  body, and returns `{id, deduped, extract_status, title}`.
