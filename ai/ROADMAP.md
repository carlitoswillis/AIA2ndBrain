# AIA2ndBrain — The Whole Picture

_Written 2026-07-29, after the BASB/AI research sweep (see `ai/research/`). This is the
master doc: what the system is, its organs, how data flows, and the build phases.
Individual phase plans live in `ai/plans/`._

## Vision

An AI-augmented second brain, per Tiago Forte's BASB (Capture → Organize → Distill →
Express) updated for the AI era — where the second brain is not just a filing cabinet
for a human reader but **curated personal context for AI** (Forte's 2026 "Personal
Context Management" thesis). One system, five organs:

```
                 ┌─────────────────────────────────────────────┐
                 │              BRAIN APP (brain/)             │
   capture ──►   │  Reader/Inbox → Library → Search → Chat →   │
   (URL, text,   │             Weekly Review                   │
    share sheet) │        Next.js + SQLite + Gemini            │
                 └───────┬─────────────────────────▲───────────┘
                         │ "Keep" exports .md      │ indexes (FTS + embeddings)
                         ▼                         │
                 ┌─────────────────┐      ┌────────┴────────┐
                 │  VAULT INBOX    │ ───► │   PARA VAULT    │   iCloud markdown =
                 │  Inbox/notes    │      │ Projects/Areas/ │   SOURCE OF TRUTH
                 └─────────────────┘      │ Resources/Arch. │
                         ▲                └────────▲────────┘
                         │ files also dropped      │ classifies & files
                 ┌───────┴─────────────────────────┴───────┐
                 │        WATCHER (src/main.js)            │
                 │  chokidar → Gemini classify → PARA      │
                 └─────────────────────────────────────────┘
                                                  ┌──────────────────┐
                 everything above retrievable ──► │  MCP SERVER (v2) │ → Claude & agents
                                                  └──────────────────┘
```

1. **Vault** — the iCloud PARA folders (`~/Library/Mobile Documents/com~apple~CloudDocs/SecondBrain`).
   Plain markdown files. Source of truth; everything else is index or intake.
2. **Watcher** (`src/main.js`, exists) — file intake: watch `Inbox/notes`, Gemini-classify,
   file into PARA. Untouched by phase 1; hardened later (see Fix-first list below).
3. **Brain app** (`brain/`, new) — the face of the system. Grows phase by phase:
   capture/reader → library/search → chat → review. Next.js + better-sqlite3, patterns
   copied from workingmemory (schema-as-code, trigger event log, thin server actions).
4. **AI layer** — Gemini/Claude throughout, in strictly scoped roles: triage summaries at
   capture, PARA classification **constrained to the existing taxonomy**, embeddings for
   retrieval, weekly digests. AI routes attention; the human distills.
5. **Context ports** (v2) — MCP server exposing search/recent/highlights (Inxlusinf from live WorkingMemory site), making the
   brain memory for Claude Code and future agents. The 4k-note Apple Notes corpus
   (`Notes/`) is backfill data for the index — **and only that**: measured 2026-07-30, 94%
   of it sits in one undifferentiated folder at a 174-byte median, so it gets indexed and
   made findable, never bulk-filed into PARA (see
   `ai/plans/2026-07-30-apple-notes-intake.md`). Live Notes capture is specced there too.

   The reverse direction already exists: **Working Memory is an input.** Its task board is
   read (read-only) as current-work context for triage, per Forte's Personal Context
   Management thesis — the second brain curating context *for* the AI, not just storing
   documents for the human.

## How a thought flows through the system

Save a URL / jot a note / drop a file → extracted verbatim (raw kept — *unique data is
the moat*) → one Gemini call makes the triage card (summary, verdict, PARA suggestion)
→ human triages in 30s (delete is a success state — Forte kills ~half) → read/distill
lazily → "Keep" exports a structured .md to the vault inbox → watcher files it into
PARA → indexer picks it up → findable by search, citable by chat, surfaced by the
weekly review, servable to agents via MCP.

## Phases

| # | Phase | What ships | Status |
|---|-------|-----------|--------|
| 1 | **Capture + Reader** | Save by paste/bookmarklet/API·token, Defuddle extraction, clean reading view, Gemini triage summary, inbox triage (Read/Keep/Delete), Keep → vault inbox export | **scaffold started, paused 2026-07-29** — full build spec + resume checklist in `ai/plans/2026-07-29-phase1-capture-reader.md` |
| 2 | **Library + Search** | Index vault + Notes corpus into SQLite (FTS5 + sqlite-vec embeddings), browse PARA, hybrid search UI | **keyword half built 2026-07-30** (`docs`+`docs_fts`, `/library`, `/search`, `/doc/[id]`; 4,333 docs indexed) — spec in `ai/plans/2026-07-30-phase2-library-search.md`. Embeddings deferred to land with phase 3 chat |
| 3 | **Chat with your brain** | Grounded Q&A with citations over the index; master-context doc (mini Master Prompt) | planned — **context doc pulled forward 2026-07-30**: triage already reads the owner's live task board from the sibling Working Memory app (`brain/lib/context.ts`) and flags which current item a save bears on |
| 4 | **Review + resurfacing** | AI weekly review digest (themes, resurfaced items vs. Favorite Problems, queue hygiene), review mode | planned |
| 5 | **Context ports + intake growth** | MCP server, watcher hardening, RSS/newsletter email-in, highlights & progressive summarization, hosted deploy (Render+Litestream, WM's chain) | planned |

Each phase is independently usable; nothing in a later phase blocks a daily habit in an
earlier one. Scope contract: a phase doesn't start until the previous one has survived
two weeks of real use. [ehhhh idk]

**The contract was broken once, deliberately, on 2026-07-30.** Phase 1 shipped and the
owner's reaction was: "do I just open up the folder and work there?? it's not usable."
That's the correct reaction to a system with capture but no retrieval, and waiting two
weeks would only have proved it — the missing library was precisely what would have
prevented the daily use the contract waits for. The lesson kept for next time: the
contract exists to stop *speculative* scope, not to stall a fix for something the owner
has already hit.

## Principles (distilled from the research — see `ai/research/`)

- **Verbatim source is sacred.** Always store the raw capture; summaries are views,
  never replacements. "In a world of infinite summarization, the one with the most
  unique data to summarize wins." — Forte
- **AI routes attention; humans distill.** Triage summaries, constrained classification,
  retrieval, digests = proven. Auto-distillation, whole-vault-chat-as-analyst,
  unreviewed flashcards, self-organizing magic = documented gimmicks.
- **Constrained taxonomy.** LLM tagging/filing only against the existing PARA enum —
  unconstrained tagging produces tag landfills.
- **Deletion is a success state.** The #1 failure mode is the 10,000-unread landfill;
  guilt-free delete + resurfacing are the antidotes.
- **Design for the worst version of yourself.** Capture in seconds, defaults over
  taxonomies, recognition over recall, inbox-then-batch over file-at-capture.
- **Self-hosted.** Pocket (2025) and Omnivore (2024) died of business-model failure;
  this system can't be shut down.
- **Boring monolith.** One Next.js app, one SQLite file, in-process jobs. Omnivore's
  microservice sprawl is the cautionary tale.

## Fix-first list for the watcher — ✅ done 2026-07-30

From the codebase audit (`ai/research/code-aia2ndbrain.md` §7). All five shipped, two of
them after the bugs fired for real on the first day of reader volume (see
`ai/PROJECT_STATE.md` for the detail):

- [x] `awaitWriteFinish` + iCloud-stub handling (plus a serial queue and `depth: 0`)
- [x] Suffix slug collisions — the silent-overwrite data loss, **observed live**
- [x] Validate Gemini output enums before using them as paths
- [x] Idempotency ledger (`data/processed.json`, duplicates parked not deleted)
- [x] Keep full text, not just the summary, in `index.md`

Also fixed: the classifier was pinned to `gemini-2.5-pro`, which is `limit: 0` on the
free tier — every call 429'd, so *every* capture took the fallback path. That's what made
the collision fire. The brain app still mitigates from its side (timestamp-prefixed
filenames, atomic writes).

Single-provider classification is fixed too: `src/llm.js` gives the watcher the same
Claude-CLI-primary / Gemini-backstop chain as the brain app (`brain/lib/llm.ts`), so a
quota wall degrades to a different model instead of to a constant title.
