# Phase 2 — Library + Search (the hub)

_Written 2026-07-30. Pulled forward past the ROADMAP's "two weeks of daily use" contract
on purpose: the owner's reaction to phase 1 was "do I just open up the folder and work
there?? it's not usable." That's the correct reaction, and it's the reason to break the
contract rather than a reason to wait — the missing return path is exactly what would
prevent the daily use the contract is waiting for._

## The problem

Phase 1 built storage (vault) and intake (watcher + capture inbox). There is no **return
path**: no browse, no search, no resurfacing. Capture-without-retrieval is the #1
documented failure mode in `ai/research/` — 10,000 saves is a landfill. Finder is not a
UI for knowledge; it can't rank, snippet, or search inside 4,353 files.

The vault stays flat, local, file-based, and the source of truth. **The app is a lens over
the files, not a replacement for them.** The index is disposable and rebuildable from the
files at any time — that property is what makes it safe to be aggressive with it.

## Scope of this phase

- Index the vault (`SecondBrain/{Projects,Areas,Resources,Archives}`) **and** the 4,353-note
  Apple Notes export (`Notes/iCloud/**`) into SQLite FTS5.
- `/library` — browse by source and PARA area, with recents. A real UI, not Finder.
- `/search` — one input, instant keyword search across everything, ranked with snippets.
- `/doc/[id]` — read any indexed file in the same clean reading view captures get.
- The capture inbox becomes one tab of a hub, not the whole app.

**Deferred to phase 3:** embeddings / semantic search. `sqlite-vec` needs a native
extension binary that can't be installed offline, and keyword search over 4.8 MB of text
is genuinely fast. Hybrid retrieval arrives with chat, where it actually pays for itself.

## Why a separate `docs` table instead of extending `items`

`ai/ROADMAP.md` said phase 2 would extend `items` (which already has `kind: article|note`).
Changing that decision, for one reason: **reindexing.** The indexer's simplest correct
implementation wipes and rebuilds; `items` holds irreplaceable capture state (raw gzipped
HTML, triage summaries, kept/exported stamps, event history). A bug in a reindex must not
be able to touch it. Two tables means `DELETE FROM docs` is always a safe operation.

They also differ in kind: an `items` row is *a decision the human is making* (read? keep?
delete?). A `docs` row is *a file that exists*. Mixing them would also flood the triage
inbox with 4,353 rows, which is the landfill again.

`items` still owns captures; `docs` owns indexed files. The reading view is shared.

## Data model

```sql
docs
  id          TEXT PRIMARY KEY      -- uuid
  source      TEXT NOT NULL         -- 'vault' | 'notes'
  rel_path    TEXT NOT NULL UNIQUE  -- stable identity; re-index updates in place
  abs_path    TEXT NOT NULL
  area        TEXT                  -- Projects|Areas|Resources|Archives, or the Notes folder
  title       TEXT
  summary     TEXT                  -- vault frontmatter summary, when present
  body        TEXT                  -- full text, frontmatter stripped
  word_count  INTEGER
  mtime       TEXT                  -- file mtime; lets re-index skip unchanged files
  indexed_at  TEXT

docs_fts  -- FTS5 external-content over docs(title, body), kept in sync by triggers
```

External-content FTS5 (`content='docs'`) rather than a standalone index: the text is
stored once, not twice. Sync triggers on insert/update/delete, versioned `_v1` like the
existing ones.

`rel_path UNIQUE` is the dedupe key, so re-indexing is idempotent and an edited file
updates in place instead of duplicating.

## Frontmatter

Vault notes carry YAML frontmatter (`area`, `domain`, `type`, `title`, `tags`, `summary`).
The Notes export has none — first `# H1` is the title. Rather than add a YAML dependency
for four scalar fields, `lib/frontmatter.ts` parses the flat subset actually present
(`key: value`, plus `- item` lists) and ignores anything nested. If it ever sees real
nested YAML it degrades to treating the block as opaque, never crashes.

## Ranking

`bm25(docs_fts)` with a title column weight — a query matching a title should beat one
matching a passing mention in a body. `snippet()` for the highlighted excerpt. Ordering is
`bm25` ascending (SQLite returns negative scores, lower = better).

Median note is 174 bytes and 2,184 of them are under 200, so most "documents" are
fragments. Consequence: **snippets matter more than scores.** A ranked list of one-line
notes is only useful if you can see the line.

## Verification approach

`better-sqlite3` is a macOS-native binary and can't run in the Linux sandbox, so the
schema and every query are prototyped in `python3 sqlite3` (FTS5 confirmed available)
against the **real** 4,353-file corpus, checking ranking, snippets, index size, and build
time. The TypeScript is type-checked with `tsc --noEmit`. Live gate stays on the Mac.

## Not in this phase

Embeddings/semantic search · chat (phase 3) · weekly review (phase 4) · MCP (phase 5) ·
editing files from the app (the vault is written by the watcher and by hand, not by the
browser) · attachments/images beyond linking them.

## On the Working Memory overlap

They stay separate systems, per Forte: **Working Memory is attention** (what's on my mind
now, task-shaped, daily loop), **brain is knowledge** (what I captured and might need
someday, reference-shaped). Merging them makes both worse. The linkage is one-directional
and already started: WM's board is read as triage context (`brain/lib/context.ts`). Later,
the weekly review can push "3 things worth resurfacing" onto the board. Shared visual
language (Nocturne) is worth doing so the brain feels like part of the same world — a
separate, cosmetic task.
