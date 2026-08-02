# Making the WM read path visible

_Written 2026-08-02, after the bridge went live. The owner's report: "one way I can send
a note from brain to brain dump board! It works" — and then "I'm not seeing WM surface in
brain though, is that implemented or was that not the goal anyway"._

## The problem

Both directions are built. Only one is legible.

**Push** is a button (`→ Board`, `app/read/[id]/page.tsx:62`) — you press it, a card
appears on the board, the reader remembers (`pushed_at`). Obvious.

**Pull** is a substrate. `buildContextBlock()` splices the open board into the triage
prompt (`lib/llm.ts:46`) and that is the whole feature: it changes how summaries get
written, not what appears on screen. It surfaces in exactly two visible places today, and
both are easy to read as "nothing happened":

- `↳ relevance` on an inbox card (`app/page.tsx:53`) — deliberately rare. `lib/llm.ts:64-70`
  tells the model most articles bear on nothing and a forced connection is worse than
  nothing; `llm.ts:96-97` normalizes "none"/"N/A"/blank → null. A week of general reading
  renders zero of these, which is correct behaviour and indistinguishable from broken.
- The footnote count (`app/page.tsx:130-153`) — one number, below 200 cards.

So the honest diagnosis is not "the read path is missing." It's that **a working read path
and a dead one look identical**, and there is no way to tell which you have without reading
the code.

## What this is not

Not a Working Memory panel inside brain. `ai/ROADMAP.md:55-58` fixes the direction — WM is
an *input*, curated context for the AI per Forte's Personal Context Management thesis, not
a widget for the human — and the top backlog item (`ai/PROJECT_STATE.md:83-88`) is actively
*narrowing* the coupling to three JSON fields. Rendering WM's board in brain would refatten
the seam we're thinning.

The goal is narrower and duller: **make the existing signal legible.** Show what the model
was given; show the tie where the decision gets made. No new data, no new coupling, no new
dependency, no schema change.

Neither change is phase 4. Resurfacing (`ROADMAP.md:76`) is where WM legitimately earns a
real surface in brain; this is two afternoons of making phase-3-era plumbing visible, and
it must not be allowed to grow into the digest.

## Step 0 — establish which source is actually live (do this first)

Push working does **not** prove pull switched over. `wm-remote.ts` auto-falls back to the
`/api/export` snapshot, and `context.ts:234-236` names whichever source was really used.
Open `/` and read the Context line:

| What it says | Meaning | Effect on this plan |
|---|---|---|
| `…/api/context`, non-zero count, hours-fresh | fully bridged | proceed |
| a filesystem path | push bridged, reads still on the snapshot fallback | proceed; note it, it makes the backlog's coupling-removal item unfinishable |
| "no current-work context found" | context never reaches triage | **stop** — every summary so far has been generic; that is a bug, and idea 1 would render an empty box |
| "too stale to trust" | read, then withheld by the 48h guard | **stop** — fix freshness first |

Both ideas below are presentation over `readCurrentContext()`. If that returns nothing,
they present nothing, and the fix is upstream.

## Idea 1 — the context panel in the footnote

**Shape:** a native `<details>` in the existing `.footnote` block on `/`, collapsed by
default, listing the items grouped by list label. Server-rendered, no client JS.

**Cost: zero fetches.** `contextSummary()` already calls `readCurrentContext()` and throws
the items away, keeping only `.count`. It gains an `items` field. The 60s cache
(`CACHE_MS`, `context.ts:39`) already covers the double read on the same request.

### The one design rule: show what the model got, not what the file said

This panel is worthless — worse, actively misleading — if it drifts from the prompt. Three
places it could drift, all of which the implementation must close:

1. **Staleness.** `buildContextBlock()` returns `null` past `STALE_HOURS`
   (`context.ts:193-198`), but `contextSummary()` still reports a count. The panel must
   render under a disclosure line that states whether the context is *in play* or *withheld*,
   using the same predicate. A list of 40 items above the words "too stale to trust" is the
   exact confusion this is meant to end.
2. **Per-item truncation.** The prompt slices each item to 90 chars
   (`context.ts:203`). The panel shows the same 90 chars, not the full text.
3. **Block truncation.** `.slice(0, MAX_CHARS)` (1800, `context.ts:218`) can drop the tail —
   you would see 40 items where the model saw 28. The panel must say so when it bites.

The way to get all three for free is to **stop duplicating the grouping**. Extract the
group-and-truncate step out of `buildContextBlock()` into one exported pure function, and
have both the prompt builder and the panel consume it:

```ts
// lib/context.ts
export type ContextGroup = { label: string; texts: string[] };
export type BuiltContext = {
  groups: ContextGroup[];
  block: string | null;   // null = withheld (stale / empty)
  withheld: "stale" | "empty" | null;
  clipped: boolean;       // MAX_CHARS dropped the tail
};
export function buildContext(): BuiltContext;
```

`buildContextBlock()` becomes `buildContext().block` (keep the name; `llm.ts` is its only
caller and needn't change). `contextSummary()` returns the same object plus count/source/age.
One code path, so the panel is incapable of lying by construction.

### Rendering

```
Context — …/api/context · 45 open items · 3h old · in play        [▸]
  ▾ expanded:
    Today       finish the WM bridge deploy · pull-backup cron
    Focus       contract work — invoice Q3 · job search: 3 follow-ups
    Waiting     reply from recruiter
    Backlog     …
    Brain Dump  …
    ⚠ 12 items past the 1,800-char cap were not sent to the model
```

- Group order comes from `LIST_ORDER` (`context.ts:29-35`) — already applied upstream, so
  preserve iteration order rather than re-sorting.
- Reuse `.footnote` type scale; labels get `.mutedhint`, item text plain. New CSS is a
  `.ctx-panel` grid (label column + text column) and a `summary { cursor: pointer }` — the
  `.relevance` accent colour stays reserved for actual ties, or the panel will read as 45
  relevance hits.
- The withheld/clipped notices are the payload. Do not bury them inside the disclosure —
  the disclosure summary line carries the verdict, the expansion carries the detail.

**Empty-board case:** `context.ts:92-95` already treats an authoritatively-empty bridged
cache as legitimate. The panel must render "board is clear" rather than the "not found"
copy, or a finished week reads as a broken bridge.

## Idea 2 — the relevance line on the reader

Trivially available: `items.relevance` is on the row (`lib/db.ts:40`) and `/read/[id]`
already does `SELECT *` (`app/read/[id]/page.tsx:18`). This is a render, not a query.

**Placement:** between `.meta` and `.actions` (after line 43). It belongs next to `→ Board`
because that is the decision it informs — "does this bear on current work" is precisely the
question you are answering when you press it. Reuse the existing `.relevance` class so the
inbox and the reader speak with one voice.

**The nuance that must ship with it:** relevance is computed **once, at save time**, against
the board as it stood then. On the reader you may be looking at it days later, at a board
that has moved on. Unqualified, a stale `↳` line asserts a connection to work you finished
Tuesday — the same failure the 48h guard exists to prevent, leaking in through a column
that has no staleness guard at all.

So render it qualified against `item.saved_at`:

```
↳ bears on "finish the WM bridge deploy" · when saved, 3d ago
```

Cheap, honest, and it explains the mismatch before you notice it yourself. **Do not**
recompute on read — that is an LLM call per page view for a line of garnish.

When `pushed_at` is set, the relevance line and the existing "on your board" hint sit
together and complement each other; no interaction needed.

## Files touched

| File | Change |
|---|---|
| `brain/lib/context.ts` | extract `buildContext()`; `buildContextBlock()` delegates; `contextSummary()` returns groups + `withheld` + `clipped` |
| `brain/app/page.tsx` | `<details>` panel in `.footnote`; footnote copy folds in the withheld/clipped verdict |
| `brain/app/read/[id]/page.tsx` | render `item.relevance` + age qualifier after `.meta` |
| `brain/app/globals.css` | `.ctx-panel` grid, `summary` affordance |

No schema change, no migration, no new dependency, `lib/llm.ts` unchanged.

## Verification

`better-sqlite3` is a macOS-native binary, so the sandbox can do everything except run the
app — the same split as phase 2 (`ai/plans/2026-07-30-phase2-library-search.md:91-96`).

**In-sandbox:**
- `tsc --noEmit` clean.
- `buildContext()` is pure over a `Snapshot`, so unit-check it directly, workingmemory-style
  (plain `node`, no framework): 40 items → groups in `LIST_ORDER`; a 200-char item truncates
  to 90 in *both* the block and the groups; an oversized set sets `clipped` and the group
  count still matches what survived the slice; a 72h-old `asOf` yields `block === null` with
  `withheld === "stale"` **and** non-empty groups (the panel-shows-withheld case); empty
  items yield `withheld === "empty"`.
- The regression that matters: assert the panel's rendered text is a **subset** of `block`.
  That is the anti-drift property, and it is worth a test that fails loudly.

**Live gate on the Mac:**
1. `/` footnote shows the source, count, age, and `in play` — matches step 0's reading.
2. Expand: the lists match what's on the board right now.
3. Complete an item in WM, wait past the `WM_FETCH_TTL_MIN` (15m) TTL, reload — it drops out.
   This is the check that proves the panel reflects the *live bridge*, not a cached file.
4. Force stale (`WM_STALE_HOURS=0`): line flips to withheld, panel still lists items, and a
   fresh save comes back with `relevance` null.
5. Open a saved item that has a relevance line — reader shows it with the age qualifier.

## Not in this

Recomputing relevance on read · a WM item list anywhere outside the footnote · editing or
completing WM items from brain · relevance on `/library` or `/doc/[id]` (indexed docs never
had a triage pass, so there is nothing to show) · the weekly digest that ranks the whole
backlog against the board — that is phase 4, and it is the thing this must not become.
