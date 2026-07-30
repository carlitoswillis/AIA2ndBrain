# Working Memory (`/Users/carlitoswillis/workspace/workingmemory`) — Pattern Audit for a Sibling Read-Later App

Analyzed 2026-07-29 from `main`. Live instance: https://workingmemory.onrender.com (GitHub: github.com/carlitoswillis/workingmemory). This report covers the stack, the proven patterns, what to copy into a new read-later app, and whether the reader belongs inside this app or beside it.

## 1. Stack & versions (`package.json`)

- **Next.js 14.2.15** (App Router, pinned exact), **React 18.3.1**, **TypeScript 5**, **Tailwind CSS 3.4.14** (+ postcss/autoprefixer)
- **better-sqlite3 ^12.11.1** (synchronous native SQLite; `@types/better-sqlite3`)
- **@dnd-kit** core/sortable/utilities (drag & drop)
- **react-markdown ^9.1.0 + remark-gfm ^4.0.1** (XSS-safe details rendering, code-split via `next/dynamic` in `components/Markdown.tsx`)
- Node 22 in the Docker image (`node:22-slim`); **zero auth/ORM/DB-client dependencies** — auth is hand-rolled `node:crypto`, DB access is raw prepared statements
- Tests: **plain `node lib/*.test.ts` suites** (11 of them), no test framework at all — `npm test` is a chain of `node` invocations. Verification gate: `npx tsc --noEmit && npm run build && npm test`
- `next.config.js` has exactly one setting worth copying: `experimental.serverComponentsExternalPackages: ["better-sqlite3"]` so Next doesn't try to bundle the `.node` binary

## 2. The SQLite + better-sqlite3 + trigger-history pattern

This is the crown jewel of the repo. Key files: `lib/schema.ts`, `lib/db.ts`, `lib/queries.ts`, `lib/timetravel.ts`.

### schema.ts — schema as code, no migration runner
- Exports **three things**: `CREATE_TABLES` (all `create table if not exists` DDL as one SQL string), `CREATE_TRIGGERS` (the history triggers), and `migrateDb(db)` (additive column migrations). They are **deliberately separate exports** so bulk importers/seeders can insert rows BEFORE triggers exist — otherwise every imported row would emit a spurious `created` event and clobber real history.
- Applied **idempotently on every connection open** (`openAt()` in db.ts): `CREATE_TABLES` → `migrateDb` → (optional bootstrap) → `CREATE_TRIGGERS`. There is no migration runner, no migrations folder, no version table.
- `migrateDb` handles the "if not exists can't add a column" gap: it checks `pragma table_info(table)` for the column name before `ALTER TABLE ... ADD COLUMN`, and every step is keyed on "the shape is missing" so re-running is a no-op. It even handles a primary-key re-key (SQLite can't alter PKs) via rename-to-`_legacy` → create new → copy → bootstrap re-homes → drop.
- Conventions: **ids are text uuids**, booleans are 0/1 integers (better-sqlite3 rejects JS booleans — bind `done ? 1 : 0`), timestamps are ISO-8601 text via `` export const ISO_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')` `` used as column defaults and in trigger bodies, ordering uses `position real` with fractional midpoint inserts.

### The trigger-history design
- **History is never written by app code** (hard architectural rule in AGENTS.md). `items` has an append-only companion `item_events` (autoincrement id, item_id FK cascade, `type` ∈ created|edited|moved|completed|reopened|archived, `field`, `old_value`, `new_value`, `actor_id`, `at`).
- One `AFTER INSERT` trigger logs `created`; **one `AFTER UPDATE OF <col>` trigger per change-tracked field** with a `WHEN new.x IS NOT old.x` guard logs the diff. A separate `items_touch_updated_at` trigger bumps `updated_at` on any update (safe because SQLite's `recursive_triggers` is OFF by default, so its inner UPDATE doesn't re-fire loggers).
- **Trigger versioning trick**: `create trigger if not exists` never replaces a body, so when trigger bodies changed (adding actor attribution), the pattern is *drop the v1 names, create `_v2` names* — still idempotent, self-migrates any old DB on next open, and avoids double-logging.
- Payoffs proved in this app: time-travel (`lib/timetravel.ts` reverts events after time T using each event's `old_value` — pure function, tested), history search ("what a card used to say"), streaks computed from events, a real-time high-water mark (`max(item_events.id)` as a monotonic changefeed cursor), and future AI-over-the-event-stream. The event log is explicitly called "the substrate and the moat."

### db.ts — connection management
- `getDb`-style resolver per request. Local mode: one file `DATA_DIR/wm.db`, `journal_mode = WAL`, `foreign_keys = ON`, connection cached on `globalThis` so Next dev hot-reload doesn't leak handles.
- Hosted mode (`DEMO_MODE=1`): ONE multi-tenant main DB (`DATA_DIR/owner/wm.db`) for all accounts + per-visitor throwaway demo DBs (`DATA_DIR/demo/<uuid>.db`, keyed by an httpOnly cookie, seeded with fabricated history, TTL-swept opportunistically with no background process, LRU cap on open connections).
- `getBoardContext(boardId?)` is the **single choke point**: resolves the request to `{db, userId, boardId}`, verifies board membership ONCE (404 not 403 for non-members), and downstream everything trusts plain `board_id IS ?`. The **`IS ?` NULL trick**: local/demo contexts pass `boardId = null` and `IS null` matches the whole file — so one SQL shape serves multi-tenant hosted AND single-file local. This is how the same code runs with zero auth locally and full multi-tenancy hosted.
- Idempotent bootstraps (legacy-owner migration, per-account personal boards) run BEFORE triggers attach so backfills don't emit spurious history.
- `replaceMainDb(snapshot)` — verified atomic DB swap: write to `.incoming`, `integrity_check` + expected-tables check on the copy, close the live handle, delete stale `-wal`/`-shm`, `renameSync`. Bad upload changes nothing.

### queries.ts — pure reads
- Every read function takes `(db, boardId)` explicitly, no Next imports, so plain-node tests run against scratch DBs. `rowToItem` maps 0/1 → booleans. History always scopes through a join on `items` (events carry no board_id).

## 3. Server actions structure (`app/actions.ts`)

- One `"use server"` file with ~20 async action functions. Shape of every mutation:
  1. take `boardId` as the **first explicit argument** (the client provides it via a `useBoardId()` context — IDOR-safe: knowing a row id is never enough),
  2. validate/trim input; apply demo/hosted caps (`lib/demo/limits.ts`) when `DEMO_MODE`,
  3. `const { db, userId, boardId: bid } = getBoardContext(boardId)` — auth + scope in one call,
  4. one prepared-statement CRUD write, always carrying `and board_id is ?` and stamping `touched_by = userId`,
  5. `revalidateBoard(bid)` = `revalidatePath("/", "layout")` + `pokeBoard(bid)` (the in-process EventEmitter → SSE realtime bus).
- No event-logging in actions (triggers do it), no per-query auth re-checks (the choke point did it). Actions that can fail user-visibly return a string error for the UI (`setParentAction`). Complex domain rules live in pure lib modules (`lib/nesting.ts`, `lib/columns.ts`, `lib/boards.ts`) that the action calls.
- Rate limiting is split: **write RATE limits in middleware** (edge, token bucket), **size/count caps in actions** (need DB access).

## 4. Auth model

- **Local mode: no auth at all.** `DEMO_MODE` off → middleware is inert, `userId` null everywhere.
- **Hosted: hand-rolled, zero-dependency** (`lib/auth.ts`, ~90 lines of `node:crypto`):
  - Passwords: scrypt, stored as `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>` so params can be raised without invalidating hashes; `timingSafeEqual` verify.
  - Sessions: **stateless HMAC tokens** `v2.<userId>.<expiryMs>.<hmacHex>` (HMAC-SHA256 keyed by `SESSION_SECRET` env), 90 days, in httpOnly `wm_session` cookie (`lib/session.ts` sets it). No session store — tokens survive redeploys; rotating the secret signs everyone out. Constant-time compares via hash-both-sides (`safeEqual`). Stateless-token gotcha handled: `getRequestUserId()` re-checks the user row still exists.
  - `lib/auth-edge.ts` is a **WebCrypto twin** of the verifier because middleware runs on the edge runtime (no node:crypto, no native modules) — formats kept in sync by hand.
  - `middleware.ts`: per-IP token buckets for POST /login (burst 5) and /signup (burst 3, ~1/5min); mints the demo visitor cookie (injected into the current request so first render already has it); per-visitor write rate limit; matcher excludes static assets AND icons/manifest so asset fetches don't mint cookies.
  - `OWNER_SECRET` is a separate **ops bearer** guarding `GET /api/export` / `PUT /api/import` only (the file holds every account, so no browser session may dump it). No email → no password reset (recovery codes are a written-but-ungated plan).

## 5. Deploy & backup story (Render + Litestream + B2)

- **Image** (`Dockerfile`): node:22-slim multi-stage (deps → build → runtime); better-sqlite3 installs its prebuilt linux binary during `npm ci` (nothing compiles on the host); Litestream v0.3.13 `.deb` baked in via `TARGETARCH`; **`ca-certificates` must be installed** (node:22-slim ships no system CA store; litestream is a Go binary and fails TLS without it — learned the hard way).
- **Entrypoint** (`scripts/start.sh`): if `LITESTREAM_REPLICA_URL` is set → `litestream restore -config /etc/litestream.yml -if-db-not-exists -if-replica-exists $OWNER_DB` then `exec litestream replicate -config /etc/litestream.yml -exec "npx next start"`. Replication lives and dies with the server; a fresh disk self-heals on boot; **the disk is disposable by design** (demo DBs deliberately not replicated).
- **Render free tier** (`render.yaml`): $0, Docker runtime, NO persistent disk — viable purely because of restore-on-boot. Env: `DEMO_MODE=1`, `DATA_DIR=/data`, `OWNER_SECRET`, `SESSION_SECRET`, `LITESTREAM_REPLICA_URL` (must have `s3://` scheme: `s3://<bucket>.s3.us-east-005.backblazeb2.com/<prefix>`), `LITESTREAM_ACCESS_KEY_ID/SECRET_ACCESS_KEY`. B2 chosen over R2 because uploads are free and no card needed. `fly.toml` is the alternative (persistent volume, ~$2–5/mo, scale-to-zero) — persistent disk makes the whole cold-start problem class disappear.
- **The B2 Class C incident (must-know for any clone)**: Render free spins down after 15 idle minutes; every cold start on a blank disk re-lists the bucket to restore AND opens a fresh Litestream generation, while the default hourly retention check never fires in a ~15-min process life → generations pile up → ~6k `s3_list_objects`/day, blowing B2's 2,500/day free cap and silently stalling replication. **Two fixes, both required**: (1) the real cure — an external uptime ping (UptimeRobot → `/api/health` every ~5 min) keeps the container warm; (2) `litestream.yml` baked at `/etc/litestream.yml` with explicit `retention: 24h`, `retention-check-interval: 1h`, `snapshot-interval: 24h`, `sync-interval: 10s` (the positional `db url` CLI form cannot set retention at all). Also: **restart after any `/api/import`** so Litestream opens a fresh generation, or a later restore can resurrect the pre-import DB.
- **Belt-and-suspenders backup**: `GET /api/export` streams a consistent snapshot via better-sqlite3's `db.backup()` (never copy a live WAL file directly — it tears), bearer-`OWNER_SECRET` auth. `scripts/pull-backup.sh` curls it daily to the Mac (`backups/pull/<stamp>/`), **verifies it** (`integrity_check` + row counts — "a backup you haven't verified is a hope"), prunes to newest 30; run by **launchd, not cron** (`com.carlitoswillis.wm-backup.plist`, env in `~/.wm-backup.env` chmod 600) because launchd catches up after sleep. `scripts/push-local-db.sh` is the reverse cutover. `GET /api/health` deliberately touches no SQLite (would defeat the demo idle-TTL sweep). CI: GitHub Actions runs tsc + tests + build; Render blueprint auto-deploys on push, so **every deploy doubles as a restore drill**.

## 6. Styling/theming — "Nocturne"

- **Everything is CSS variables in `app/globals.css`**; the hard rule (AGENTS.md) is *components may only use `var(--*)`, never literal colors*, and both theme blocks must define every token.
- Dark (default) `:root` block + light ("Nocturne Day", warm paper) under `html[data-theme="light"]`. Theme is user-toggled (`components/ThemeToggle.tsx`), stored in `localStorage["wm-theme"]`, and applied **pre-paint by a tiny inline script** at the top of `<body>` in `app/layout.tsx` (`THEME_INIT`, with `suppressHydrationWarning` on `<html>`) — no flash. Note: it does NOT follow `prefers-color-scheme`; dark unless "light" explicitly stored.
- Token vocabulary: layered surfaces `--bg-0/--bg-1/--surface/--surface-2`, borders `--veil/--veil-soft`, text ramp `--text-hi/mid/lo`, and **semantic accents**: `--now` (warm amber = attention/present), `--past` (cool faded blue = history), `--done` (muted green), plus derived washes/lines (`--scrim`, `--field`, `--wash`, `--now-wash/line/tint`, `--past-wash/line`) kept explicit so light mode can retune them.
- Taste rules: **matte, no glow**; **no emoji anywhere in the UI** (monochrome typographic glyphs ✓ ✎ ✕ ↳ ↻ ‹ › fine; avoid codepoints Apple renders emoji-style); gentle motion (`card-in` rise, `check-pop`) with `prefers-reduced-motion` fully respected; hover-reveal actions only under `@media (hover:hover) and (pointer:fine)` so touch always sees them.
- Typography: **Fraunces** (literary/display voice, incl. italic) + **Space Grotesk** (interface voice) via `next/font/google` exposed as `--font-fraunces`/`--font-grotesk`; `.font-display` utility class.
- Tailwind is used for layout/spacing with arbitrary-value color refs like `bg-[var(--surface)]`; there's also a hand-rolled `.md-body` ruleset styling rendered markdown in the palette (no typography plugin).
- Signature detail worth stealing for a reader: `ItemCard.tsx` computes a **recency-warmed left edge** — `exp(-ageHours/96)` mapped through an rgb lerp — so recently-touched items visibly glow-less-warm. For a read-later app the same idea inverts nicely ("staleness" of unread items).
- Server/client split convention: pages and screen shells are **server components** (e.g. `app/page.tsx` branches per request; `app/BoardScreen.tsx` does all reads synchronously via `getBoardContext`), interactivity lives in `"use client"` components under `components/` receiving plain props, with a tiny context (`board-context.tsx`) threading `boardId` to action callers. Optimistic updates are manual `useState` + `useTransition` (a considered rejection of `useOptimistic`), reconciled by `revalidatePath`.

## 7. What to COPY into a new read-later app vs. what's app-specific

### Copy nearly verbatim (proven, generic)
- `lib/schema.ts` **pattern** (not tables): `CREATE_TABLES` / `CREATE_TRIGGERS` / `migrateDb` triple, `ISO_NOW`, per-field `AFTER UPDATE OF` logging triggers with `IS NOT` guards, the touch-updated_at trigger, the drop-then-create trigger-versioning convention, pragma-guarded additive migrations.
- `lib/db.ts` skeleton: `openAt()` (WAL + FKs + idempotent schema), globalThis connection caching for dev, `getBoardContext`-style single choke point with the `IS ?` NULL scoping trick, `replaceMainDb` verified atomic swap. (Rename wm→your prefix; decide whether you need demo-DB machinery at all.)
- `lib/auth.ts` + `lib/auth-edge.ts` + `lib/session.ts` wholesale — scrypt hashing, stateless HMAC v2 sessions, edge twin. Only the cookie name and HMAC context string (`wm-user.`) change.
- `middleware.ts` — token-bucket rate limiting (login/signup per IP, writes per visitor), cookie minting with inject-into-current-request, asset-excluding matcher.
- Deploy chain as a unit: `Dockerfile` (incl. ca-certificates + TARGETARCH litestream install), `scripts/start.sh` (restore-then-replicate-exec), `litestream.yml` (explicit retention — non-negotiable on any diskless host), `render.yaml`/`fly.toml`, `/api/health` (no-DB), `/api/export` (`db.backup()` + bearer), `/api/import` (verify-then-atomic-swap), `scripts/pull-backup.sh` + the launchd plist pattern. Use a **separate B2 bucket/prefix and separate keys** per app. Budget the UptimeRobot ping from day one if on Render free.
- `next.config.js` (`serverComponentsExternalPackages: ["better-sqlite3"]`).
- Server-action shape: explicit scope-id first arg, choke-point context call, prepared-statement CRUD with the scope guard on every statement, `revalidate + poke` helper. Also `lib/realtime.ts` (globalThis EventEmitter poke bus) + the SSE route + debounced `router.refresh()` client hook if the reader ever wants live updates — it's dependency-free.
- The **pure-lib + plain-node-test** convention: domain logic in modules that take `(db, scopeId)` with no Next imports, tested by `node lib/x.test.ts` against scratch DBs; verification = tsc + build + tests.
- Nocturne mechanics (even with a different palette): all-tokens rule, dual theme blocks, pre-paint THEME_INIT inline script, ThemeToggle, `prefers-reduced-motion` block, hover-capability media query, next/font CSS-var fonts, `.md-body` markdown styling (a read-later app renders lots of long-form text — this is directly reusable).
- The `/ai` workspace convention itself: `ARCHITECTURE.md` / `AGENTS.md` / `PROJECT_STATE.md` / `plans/` with decision logs. It demonstrably kept a solo+AI project coherent through five architectural pivots.

### App-specific — do NOT copy (or rethink)
- The domain tables/columns: `items` (list/done/position/recurrence/completed_on/parent_id), `lists`, `boards`, `board_members`, `profiles`. A reader wants `articles` (url, title, byline, site, saved_at, read_at, archived, extracted content/text, maybe reading position) + its own `article_events`.
- `lib/recurrence.ts`, `lib/streaks.ts`, `lib/nesting.ts`, `lib/columns.ts`, `lib/boards.ts`, `lib/dnd.ts`, `lib/timetravel.ts` (the reconstruction *idea* transfers; the field list doesn't), `lib/lists.ts`.
- All of `components/` (Board/Column/CardPanel/dnd wrappers/TimeMachineBar) and the dnd-kit dependency entirely — a reading queue is a list, not a drag board.
- The demo-mode apparatus (`lib/demo/seed.ts`, per-visitor DBs, sweep/LRU, demo banners, `/demo` route, visitor cookie) — that exists because WM is a public portfolio demo. A personal read-later app can start with local mode + one hosted account and skip ~40% of db.ts/middleware complexity.
- The boards/multi-tenant sharing layer — unless the reader is multi-user from day one, start with the simpler pre-boards shape (or even the DEMO_MODE-off single-file mode) and keep `migrateDb` as the path to grow.
- `scripts/gen-icons.mjs` (cute, reusable in spirit, WM-branded geometry), the seed script, `scripts/import-backup.ts` (Supabase-export-specific).
- Historical baggage: the `owner/wm.db` legacy path, `bootstrapLegacyOwner`, profiles/list_order compat, the lists re-key migration — all scars of THIS app's history; a fresh app starts clean.

## 8. Bolt the reader INTO Working Memory, or build a sibling?

**Recommendation: sibling app.** Reasoning:

**For bolting in (acknowledged honestly):** the plumbing is already paid for — auth, sessions, rate limits, Litestream, backups, the event-log substrate, deploy. A saved article could be "just an item" in a Reading column, and the owner already has a capture-from-anywhere email plan on the backlog. One deploy, one backup, one login.

**Why sibling wins anyway:**
1. **The data model fights it.** WM's schema is a *board*: `list`, `position`, `done`, `recurrence`, `parent_id`, dnd everywhere. A read-later item's essential fields (url, extracted full text, byline, read/unread, reading progress, highlights, AI summaries) map onto none of that; you'd either bloat `items` with a dozen nullable columns behind `migrateDb` or bolt a parallel `articles` table into a codebase whose every rule ("every mutation carries `board_id is ?`", "columns are user data", trigger field lists, time-travel reconstruction) assumes items. Extracted article text is also 100–1000x the size of a card title — it changes the DB's weight class and the economics of `getTimelineData`-style "ship everything to the client" choices, and stresses the 24h-retention Litestream pipeline sized for a "low-write personal board."
2. **The product philosophies differ.** WM's whole identity is "every change tracked, time-travel the board" — its triggers, event log, search, and planned AI review all orbit change-history of short text. A reader's core loop is ingest → extract → read → AI-digest; its interesting history is *reading activity*, not field diffs of card titles. Forcing one event vocabulary over both muddies WM's clean moat (and PROJECT_STATE shows the owner has product ambitions for WM — a bolted-on reader dilutes a portfolio piece that's deliberately "NOT trying to out-Trello Trello").
3. **The AI needs differ.** WM's AI plan is "LLM over the event stream, weekly review." A read-later app's AI (summarize, auto-tag, ask-your-library) wants content extraction, possibly embeddings/FTS5 — dependencies and API routes WM deliberately doesn't carry (its dependency list is 8 packages and the repo treats that as a feature).
4. **The repo's own history argues for it.** This codebase has executed five clean pivots precisely because it stays small and single-purpose, governed by an AGENTS.md whose constraints are all items/boards-shaped. A second domain doubles the rulebook.
5. **The sibling is cheap.** Everything expensive is a pattern, not code you must share at runtime: copy schema-triple + db choke point + auth + middleware + Docker/Litestream/backup chain (§7), point Litestream at a new B2 prefix, and you have the reader's chassis in a day. Two Render free services + one B2 account is still ~$0 (both need the keep-alive ping). If unified capture/search across both apps ever matters, that's a future thin layer over two clean event logs — easier than untangling one entangled schema.

**One hybrid worth considering:** keep WM as the *inbox* — the existing email-capture plan can drop a URL as a card — and let the reader be where the article lives. Cross-linking by URL costs nothing and preserves both apps' shapes.

## Key file index
- `/Users/carlitoswillis/workspace/workingmemory/lib/schema.ts` — tables + versioned triggers + migrateDb (the pattern to copy)
- `/Users/carlitoswillis/workspace/workingmemory/lib/db.ts` — openAt, getBoardContext choke point, IS-null scoping, replaceMainDb
- `/Users/carlitoswillis/workspace/workingmemory/lib/auth.ts`, `lib/auth-edge.ts`, `lib/session.ts` — scrypt + stateless HMAC sessions + edge twin
- `/Users/carlitoswillis/workspace/workingmemory/middleware.ts` — token buckets + visitor cookie
- `/Users/carlitoswillis/workspace/workingmemory/app/actions.ts` — server-action shape
- `/Users/carlitoswillis/workspace/workingmemory/lib/queries.ts` — pure reads, high-water changefeed cursor
- `/Users/carlitoswillis/workspace/workingmemory/Dockerfile`, `scripts/start.sh`, `litestream.yml`, `render.yaml`, `fly.toml` — deploy chain
- `/Users/carlitoswillis/workspace/workingmemory/scripts/pull-backup.sh` — verified daily backup (launchd)
- `/Users/carlitoswillis/workspace/workingmemory/app/globals.css`, `app/layout.tsx` — Nocturne tokens + pre-paint theme init
- `/Users/carlitoswillis/workspace/workingmemory/ai/AGENTS.md`, `ai/ARCHITECTURE.md`, `ai/PROJECT_STATE.md` — the governing docs and decision log

## Key takeaways
- Build the read-later app as a SIBLING repo, not a bolt-on: WM's schema, rulebook, and product identity are board/item-shaped, and everything expensive to reuse is a copyable pattern, not runtime code.
- Copy the schema.ts triple — CREATE_TABLES + CREATE_TRIGGERS as separate exports plus a pragma-guarded additive migrateDb — applied idempotently on every DB open, with no migration runner.
- Write history via per-field SQLite AFTER UPDATE OF triggers into an append-only events table (never in app code); version trigger bodies by drop-v1-then-create-v2 names to stay idempotent.
- Reuse the getBoardContext choke-point pattern: one call resolves {db, userId, scopeId} and verifies access once, then every query uses `scope_id IS ?` so null (local mode) and a uuid (hosted) share one SQL shape.
- Auth is copy-paste ready: scrypt password hashes with self-describing params, stateless HMAC session tokens (v2.<uid>.<exp>.<hmac>) keyed by SESSION_SECRET, an edge-runtime WebCrypto twin for middleware, and token-bucket rate limits in middleware.
- The deploy chain (node:22-slim Docker + baked-in Litestream + start.sh restore-then-replicate-exec + Render free tier + B2) makes the disk disposable — but it REQUIRES the explicit-retention litestream.yml AND an external uptime ping, or Render cold starts blow B2's Class C list-call cap.
- Backups must be verified and layered: /api/export streams a db.backup() snapshot behind an OWNER_SECRET bearer, a launchd (not cron) daily pull runs integrity_check + row counts, and every deploy doubles as a restore drill.
- Keep server actions thin and uniform: explicit scope-id first arg, choke-point context, one prepared statement carrying the scope guard and actor stamp, then revalidatePath + an in-process EventEmitter poke for SSE realtime.
- Adopt the Nocturne theming mechanics regardless of palette: all color through CSS variables (dark :root + html[data-theme=light]), a pre-paint inline localStorage script to avoid flash, no-emoji/matte taste rules, and the .md-body markdown ruleset (directly useful for article rendering).
- Keep domain logic in pure lib modules taking (db, scopeId) with no Next imports, tested by plain `node lib/x.test.ts` suites — no test framework, verification gate is tsc + build + tests.
- For the reader's schema, don't inherit items/lists/boards: design articles + article_events around ingest/extract/read/highlight, and note that extracted full text changes the DB size class WM's ship-everything and 24h-retention choices assume.
- The append-only event log is the AI substrate: max(events.id) doubles as a changefeed cursor, and WM's planned LLM-over-event-stream weekly review is the same play a read-later app can run over reading/highlight events.