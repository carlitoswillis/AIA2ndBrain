# Read-Later App Landscape 2024–2026: Research Report for Building an AI-Augmented "Read App"

## 1. The Shakeout: Why This Is a Good Moment to Build Your Own

### Pocket — shut down by Mozilla, July 2025
- Mozilla announced the shutdown May 22, 2025; **Pocket stopped working July 8, 2025**; users could export saves until **October 8, 2025**, after which all data was permanently deleted ([Engadget](https://www.engadget.com/apps/mozilla-is-shutting-down-its-read-it-later-app-pocket-183247576.html), [Nieman Lab](https://www.niemanlab.org/2025/05/mozilla-shuts-down-pocket/)).
- Pocket launched in 2007 as "Read It Later," was acquired by Mozilla in 2017, and had ~30M registered users at peak. Mozilla's stated reason: "the way people use the web has evolved" and it wanted to concentrate resources on Firefox. Premium subscribers were auto-cancelled/refunded; the Pocket Hits newsletter survived under a new name ("Ten Tabs").
- Lesson: even a market-leading, corporate-backed read-later app with millions of users was not worth maintaining to its owner.

### Omnivore — shut down November 2024
- Omnivore (launched ~2022, open source, TypeScript) was the darling of the developer/Obsidian crowd: clean design, full-text search, open API, free. The team was **acqui-hired by ElevenLabs (announced late Oct 2024)** and the hosted service was killed ~Nov 15, 2024 with roughly **two weeks' notice**; all cloud data was deleted, no read-only mode ([Yury Molodtsov's post](https://molodtsov.me/2024/10/omnivore-is-dead-where-to-go-next/), [heise](https://www.heise.de/en/news/Later-reading-app-Omnivore-closes-down-9998733.html)).
- The code lives on at [github.com/omnivore-app/omnivore](https://github.com/omnivore-app/omnivore), but self-hosting docs were never finished and the stack is heavy (see §6).
- Root cause analysis widely repeated in the community: **"free" was the product's main draw and also why it died** — read-later is a niche market with weak willingness-to-pay, and Omnivore had VC money that needed an exit ([Medium: "When Free Isn't Sustainable"](https://medium.com/@danielasgharian/when-free-isnt-sustainable-the-demise-of-read-it-later-apps-8d8b3d13e4e0)). Steph Ango (Obsidian CEO) pointed out that being free with no revenue model made it an acquisition target. Also a cautionary tale about the "open source" label: source availability did not save users' data or the running service.

**Combined takeaway:** in under a year, the two most-loved free read-later services died and deleted user data. This is the strongest possible argument for a **self-hosted / local-first personal tool where you own the SQLite file** — exactly what a solo dev building a second brain should do, and consistent with the user's existing workingmemory (Next.js + SQLite) pattern.

## 2. The Survivors and Current Players

### Readwise Reader — the current leader, and the AI benchmark
Paid-only (~$9.99/mo bundled with Readwise; no permanent free tier). The most complete reading environment: web/desktop/iOS/Android, RSS feeds, newsletter ingestion via a personal email address, PDFs, EPUBs, YouTube transcripts, Twitter threads, TTS, keyboard-driven triage (Inbox → Later → Archive; "Shortlist"), and deep export to Obsidian/Notion via the Readwise sync ecosystem. Highlights flow into Readwise's spaced-repetition Daily Review. ([docs.readwise.io/reader/docs](https://docs.readwise.io/reader/docs))

**Ghostreader (its AI layer) in detail** ([overview](https://docs.readwise.io/reader/guides/ghostreader/overview), [default prompts](https://docs.readwise.io/reader/guides/ghostreader/default-prompts)):
- **Invocation:** `Shift+G` on the whole document (now routed into a unified **Chat tab** with follow-up questions); select text and press `G` for passage-level prompts; mobile via share/`...` menu and tap-highlight. 1–3 word selections trigger "Quick Lookup."
- **Word-level default prompts:** Dictionary definition (context-aware), Encyclopedia lookup (proper nouns), "Internal X-Ray" (explain a term *as defined within this document* — clever for jargon/neologisms), Translate.
- **Passage-level:** Explain/simplify passage, Expand/elaborate concept, **"Pick up where I left off"** (recap of everything above your current scroll position — "Previously on…" for fiction), Translate passage.
- **Document-level:** Generate thought-provoking questions, Extract key takeaways + to-dos (uses your notes/highlights), Draft newsletter blurb from your highlights.
- **Automatic prompts:** (1) **auto-summarize** every manually saved document into the summary metadata field (deliberately *not* run on high-volume RSS feed items — a cost/noise decision worth copying); (2) experimental **auto-tag** (off by default).
- **Custom prompts:** full Jinja2-style templating with document variables (title, author, word count, your highlights, etc.), and bring-your-own OpenAI key for custom prompts on newer models.
- Newer feature: **Themed Review** — AI pulls together your best highlights on a chosen theme with no tagging needed.

### Instapaper — the steady classic
Running since 2008; survived multiple ownership changes (betaworks → Pinterest → independent). Clean text extraction, distraction-free reading, folders, highlights (limited on free), Send to Kindle, offline. Free tier is generous; paid ~$5.99/mo adds full-text search, unlimited notes, TTS playlists, permanent archive. Minimal AI. It is the proof that a small, focused, subscription-funded app can persist ([keep.md comparison](https://keep.md/compare/instapaper-vs-matter)).

### Matter — design/audio-first
iPhone/iPad/web (no Android). Core saving free forever; Premium $8/mo / $60/yr adds **HD human-like TTS** (its signature), newsletter ingestion via Gmail integration or a personal Matter email, RSS, podcast/YouTube transcription to time-synced text, highlight export to Obsidian/Notion/Readwise, and an **"AI Co-Reader"** that summarizes, explains context, and answers questions about what you're reading ([Robert Breen review](https://robertbreen.com/2025/02/27/elevate-your-online-reading-with-matter/)).

### Wallabag — the self-hosted veteran
PHP/Symfony, since 2013, ~13k GitHub stars, the default self-hosted Pocket alternative. Self-host or pay ~€11/yr for wallabag.it. Full apps ecosystem, importers, annotations, tags, e-reader support. Heavy stack (PHP + Postgres + Redis), dated UX, no AI ([wallabag.it](https://wallabag.it/en/alternatives/)).

### Readeck — the modern lightweight self-hosted option
**Single Go binary + SQLite**, starts in <5s, EPUB export and OPDS feeds for e-readers, integrates with SingleFile for faithful page capture, saves a full archive of each bookmark. Self-host only. In one head-to-head fetch test Readeck and Wallabag failed on similar numbers of articles (~1,050/1,100 of a large corpus), i.e., extraction quality is comparable ([selfhosting.sh comparison](https://selfhosting.sh/compare/readeck-vs-wallabag/), [Autodidacts review](https://www.autodidacts.io/readeck-open-source-read-it-later-app-with-kobo-support/)). Its Go+SQLite shape is the closest philosophical cousin to the user's workingmemory app.

### Karakeep (formerly Hoarder) — the AI-native self-hosted reference
The most relevant open-source codebase to study: **Next.js + SQLite (Drizzle) monorepo**, ~25k stars, 190+ contributors, launched Jan 2023, renamed 2025, now also a paid cloud (cloud.karakeep.app) ([github.com/karakeep-app/karakeep](https://github.com/karakeep-app/karakeep)). "Bookmark-everything" (links, notes, images, PDFs) with:
- **AI auto-tagging and summarization via any OpenAI-compatible endpoint or local Ollama** — fully local pipeline possible
- Full-text search via Meilisearch, OCR on images
- Full-page archival via **monolith**, video archival via yt-dlp, Chrome-based crawling for JS pages
- RSS "auto-hoarding," browser extensions, native iOS/Android apps
This is essentially a working blueprint for the user's stack (Node/Next.js + SQLite + LLM tagging — the same pattern as their AIA2ndBrain Gemini classifier, productized).

### Obsidian Web Clipper — capture-to-Markdown, not a queue
Free/open-source official extension by Obsidian (Steph Ango). Extracts the page (Readability-lineage → now the Defuddle engine), converts to Markdown with YAML properties into your vault; **highlights are first-class objects** you can make in-browser and capture selectively; template system with variables/filters/conditionals; **"Interpreter"** feature runs an LLM prompt over page content at clip time to extract/summarize/structure data into template fields ([stephango.com/obsidian-web-clipper](https://stephango.com/obsidian-web-clipper)). It's a capture tool, not a read-later queue (no reading progress, no triage) — but its clip-time-AI-templating idea is worth stealing.

### Others worth knowing
- **Raindrop.io** — bookmark manager with "Stella" AI assistant that chats across your whole library ([raindrop blog](https://blog.raindrop.io/pocket-alternatives/)).
- **Slax Reader, Readless, BeeMind, Gleamr, Noverload, smry.ai** — the post-Pocket wave of small AI-first readers; common feature set: AI summary on save, in-app "chat with article," AI-organized library, chat-with-library with citations.
- **Inoreader** — RSS reader that added AI "Intelligence": suggested tags from your existing taxonomy, article summaries, filtering rules ([Inoreader blog](https://www.inoreader.com/blog/2025/12/inoreader-2025-intelligence-and-automation-in-one-content-hub.html)).

## 3. Feature Table Stakes (what every credible read-later app has)

**Capture:**
- Save by URL (paste into web app), browser extension and/or bookmarklet, mobile share-sheet (PWA share target is the low-cost path for a solo dev), email-in address for newsletters
- RSS feed subscriptions (kept separate from manually saved items — Reader's Feed vs Library split is the right model)
- PDFs; optionally EPUB, YouTube (transcript), Twitter/X threads

**Reading:**
- Article extraction to a clean, typographically pleasant reading view (fonts, width, dark mode)
- Reading progress: scroll position sync, percent-read, "continue reading"
- Offline access (PWA + cached content)
- Estimated reading time, word count

**Organization/triage:**
- Inbox → Later → Archive lifecycle (Reader's triage model, keyboard-driven, is best-in-class)
- Tags, full-text search, favorites/shortlist

**Annotation & export:**
- Highlights + per-highlight notes; document notes
- **Export to note systems is non-negotiable for a second brain**: Markdown export (Obsidian-friendly with YAML frontmatter), and after Pocket/Omnivore, users demand one-click full-data export
- TTS is a differentiator, not table stakes (Matter's moat)

## 4. AI Differentiators Users Actually Value (2024–2026 consensus)

Ranked by observed value across Reader/Matter/Karakeep/the post-Pocket wave:
1. **Auto-summary on save (150–300 words) used for triage** — the single highest-value feature; it answers "is this worth my time?" and many saves never need opening. Reader auto-summarizes manual saves only, not feed items — copy that economy.
2. **"Chat with the document"** — ask questions, get explanations, simplify passages, with the document as context. Now table stakes for AI readers (Ghostreader Chat, Matter Co-Reader, Slax, BeeMind).
3. **Auto-tagging into an existing taxonomy** — Karakeep's core loop; Inoreader's version suggests tags *from your existing system* rather than inventing new ones (important detail — unconstrained LLM tagging creates tag sprawl). For the user's BASB system: classify into PARA projects/areas/resources, reusing their existing Gemini classifier logic.
4. **Highlight distillation** — Reader's "extract key takeaways from my highlights," Themed Review (AI-assembled highlight collections by theme), draft-a-blurb-from-highlights. Maps directly to BASB "Progressive Summarization."
5. **Queue triage/prioritization** — AI ranking of the backlog by relevance to current projects, digest of "what to read today." Everyone acknowledges the core failure mode: *the queue grows faster than you read it*; AI triage is the emerging answer and still underserved — a genuine differentiation opportunity.
6. **Contextual lookups while reading** — define term, "Internal X-Ray" (explain the author's own usage), recap-to-here. Cheap to build, delightful.
7. **Chat across the whole library with citations** (RAG over your saves) — Raindrop Stella, BeeMind. This is where a read-later app becomes a second brain.

## 5. Technical Guts: Extraction, Rendering, Snapshots

### Article extraction libraries (Node/JS), current state
- **[@mozilla/readability](https://github.com/mozilla/readability)** — the Firefox Reader View algorithm; the incumbent, used via jsdom server-side. Battle-tested but conservative (over-removes content), one monolithic heuristic pass, mangles modern constructs (MathJax/KaTeX, syntax-highlighted code blocks, footnotes), and is now widely described as barely maintained.
- **[Defuddle](https://github.com/kepano/defuddle)** (kepano/Obsidian team, released early 2025; `npm i defuddle`) — the modern successor: more forgiving (removes fewer uncertain elements), **multi-pass detection with fallback recovery**, standardized clean output for footnotes/math/code, an **extractor registry** for known sites plus heuristics for everything else, and built-in HTML→Markdown. Runs in browser or Node (with jsdom). Still young/work-in-progress but this is where the ecosystem is moving ([HN thread](https://news.ycombinator.com/item?id=44067409), [comparison](https://jocmp.com/2025/07/12/full-content-extractors-comparing-defuddle/)).
- **[postlight/parser](https://github.com/postlight/parser)** (ex Mercury Parser) — returns structured metadata (title, author, date, excerpt, lead image) plus content; famous for its **per-site custom parsers defined with CSS selectors** (150+ sites). Effectively unmaintained but the custom-parser pattern is worth borrowing.
- **[@extractus/article-extractor](https://github.com/extractus/article-extractor)** (renamed from article-parser) — lightweight URL→{title, content, author, published, image, ttr} pipeline, wraps Readability-style extraction with metadata parsing; convenient but shares Readability's weaknesses.
- **Practical recommendation:** Defuddle as primary (`defuddle/node` with jsdom), fall back to @mozilla/readability when Defuddle returns thin content, and always store the raw fetched HTML so you can re-extract later as libraries improve. Use `linkedom` or `happy-dom` instead of jsdom if performance matters. For metadata, parse OpenGraph/JSON-LD yourself or via article-extractor.

### JS-rendered pages and paywalls
- Plain `fetch` fails on SPA/JS-rendered pages and many soft paywalls. The standard fix is a **headless-Chrome content-fetch worker (Puppeteer/Playwright)** — exactly what Omnivore ran as its `content-fetch` microservice and what Karakeep does with a Chrome container. Make it a queue-based worker, not inline in the request path.
- **The browser-extension route is strictly better for paywalled/logged-in content**: capture the *rendered DOM from the user's own authenticated browser session* and POST it to your server, rather than the server re-fetching the URL. Many "paywalls" are client-side overlays/CSS-hiding over content already present in the delivered HTML; the user's browser has the cookies/subscription the server lacks. This is how the Obsidian Web Clipper and SingleFile-based flows work, and it sidesteps most paywall pain legitimately (you're saving what you were already served). Dedicated bypass extensions (Bypass Paywalls Clean etc.) exist but are legally fraught — don't build that in; do accept client-side DOM submissions.
- Fallback chain worth implementing: direct fetch → headless Chrome → extension-submitted DOM → (optionally) archive.org/archive.today lookup.

### Snapshots: full HTML vs extracted text
- Store **both**: (1) raw fetched HTML (cheap insurance, enables re-extraction), (2) cleaned article HTML/Markdown for the reading view, (3) optionally a **self-contained single-file snapshot** for faithful archival — tools: **[monolith](https://github.com/Y2Z/monolith)** (Rust CLI, inlines all assets as data URIs; Karakeep uses it) or **[SingleFile CLI](https://github.com/gildas-lormeau/singlefile)** (works with puppeteer/playwright backends; Readeck integrates with it). Link rot is real; the extracted text is what you read, the snapshot is what you trust.
- SQLite handles all of this fine at personal scale (Karakeep and Readeck both prove it); store article bodies in the DB or content-addressed files on disk, FTS5 for full-text search (skip Meilisearch at single-user scale).

## 6. Lessons from Omnivore's Codebase and the Death Pattern

- Omnivore's stack: TypeScript monorepo, Next.js web, Apollo GraphQL API, Postgres, Puppeteer content-fetch microservice, PDF.js, queues — a **cloud-service architecture** (built for GCP/fly.io + external Elasticsearch/bonsai) that proved painful to self-host; the self-hosting docs were never completed, and the recommended minimal deploy dropped features ([self-hosting docs](https://docs.omnivore.app/self-hosting/self-hosting.html), [minimal deploy post](https://blog.omnivore.app/p/deploying-a-minimal-self-hosted-omnivore)). Contrast Readeck (one Go binary + SQLite) and Karakeep (Docker Compose, SQLite). **Lesson: for a personal tool, monolith + SQLite + a background job queue in-process; the only justified separate service is the headless-Chrome fetcher.**
- Good ideas to keep from Omnivore: clean separation of "save" (fast enqueue) from "fetch/parse" (async worker with retries and status shown in UI); labels + full-text search; open API from day one; email-in address for newsletters.
- The death pattern across Pocket/Omnivore/Matter-adjacent apps: niche market, free users don't convert, VC or corporate owner loses interest → shutdown with data deletion. Instapaper (small, subscription, independent) and Wallabag/Readeck/Karakeep (self-hosted) are the survivors. **A personal self-hosted tool has zero business-model risk — its only risk is your own maintenance appetite, which SQLite + boring monolith minimizes.**

## 7. Concrete Build Recommendation (Node/Next.js, matching the user's existing stack)

**Architecture:** Next.js (App Router) + SQLite (better-sqlite3 or Drizzle, matching workingmemory) + FTS5. In-process job queue (e.g., a simple jobs table + poller, or BullMQ+Redis only if needed). Separate optional Docker'd Playwright worker for hard pages. Deploy on Render like workingmemory, or local + Tailscale.

**Capture surfaces (cheapest first):** paste-URL box → PWA share target (Android) / iOS Shortcut hitting a save API → bookmarklet → minimal browser extension that can also POST the rendered DOM (paywall/JS escape hatch) → unique inbound email address (e.g., via a Cloudflare Email Worker or Mailgun route) for newsletters.

**Extraction pipeline:** fetch (undici, realistic UA) → store raw HTML → Defuddle (node build) → fallback @mozilla/readability → store cleaned HTML + Markdown + metadata (title/author/date/lead image/word count/reading time) → optional monolith snapshot.

**Data model:** items(id, url, source, status[inbox|later|archived], progress, raw_html, content_html, content_md, metadata json, para_category, created/read timestamps), highlights(item_id, quote, note, position), tags + item_tags, events table for full history (the workingmemory pattern).

**AI layer (v1, in value order):** (1) auto-summary on save into a summary field, shown on the queue card; (2) auto-classify into PARA/tags constrained to the existing taxonomy — port the AIA2ndBrain Gemini classifier; (3) "chat with this article" (document text in context — no RAG needed per-article); (4) highlight distillation → export a Markdown note (summary + highlights + takeaways) into the PARA vault, closing the loop with AIA2ndBrain; (5) later: daily triage digest ranking the queue against active projects, and library-wide RAG chat with citations.

**Export/ownership:** every item exportable as Markdown+frontmatter into the second-brain folder watched by AIA2ndBrain; one-command full JSON/SQLite export.

### Sources
[Engadget – Pocket shutdown](https://www.engadget.com/apps/mozilla-is-shutting-down-its-read-it-later-app-pocket-183247576.html) · [Nieman Lab](https://www.niemanlab.org/2025/05/mozilla-shuts-down-pocket/) · [Molodtsov – Omnivore is Dead](https://molodtsov.me/2024/10/omnivore-is-dead-where-to-go-next/) · [heise – Omnivore closes](https://www.heise.de/en/news/Later-reading-app-Omnivore-closes-down-9998733.html) · [When Free Isn't Sustainable](https://medium.com/@danielasgharian/when-free-isnt-sustainable-the-demise-of-read-it-later-apps-8d8b3d13e4e0) · [Ghostreader overview](https://docs.readwise.io/reader/guides/ghostreader/overview) · [Ghostreader default prompts](https://docs.readwise.io/reader/guides/ghostreader/default-prompts) · [Karakeep GitHub](https://github.com/karakeep-app/karakeep) · [Karakeep docs](https://docs.karakeep.app/) · [Defuddle GitHub](https://github.com/kepano/defuddle) · [Defuddle vs Postlight](https://jocmp.com/2025/07/12/full-content-extractors-comparing-defuddle/) · [HN Defuddle thread](https://news.ycombinator.com/item?id=44067409) · [postlight/parser](https://github.com/postlight/parser) · [@extractus/article-extractor](https://github.com/extractus/article-extractor) · [monolith](https://github.com/Y2Z/monolith) · [SingleFile](https://github.com/gildas-lormeau/singlefile) · [Omnivore GitHub](https://github.com/omnivore-app/omnivore) · [Omnivore self-hosting](https://docs.omnivore.app/self-hosting/self-hosting.html) · [Readeck vs Wallabag](https://selfhosting.sh/compare/readeck-vs-wallabag/) · [Autodidacts – Readeck](https://www.autodidacts.io/readeck-open-source-read-it-later-app-with-kobo-support/) · [wallabag.it](https://wallabag.it/en/alternatives/) · [stephango.com – Web Clipper](https://stephango.com/obsidian-web-clipper) · [Matter review](https://robertbreen.com/2025/02/27/elevate-your-online-reading-with-matter/) · [Instapaper vs Matter](https://keep.md/compare/instapaper-vs-matter) · [Raindrop – Pocket alternatives](https://blog.raindrop.io/pocket-alternatives/) · [Inoreader AI](https://www.inoreader.com/blog/2025/12/inoreader-2025-intelligence-and-automation-in-one-content-hub.html)

## Key takeaways
- Pocket (dead July 8, 2025, data deleted Oct 8) and Omnivore (killed Nov 2024 with ~2 weeks' notice after an ElevenLabs acqui-hire) prove read-later services die from business-model failure, making a self-hosted personal tool the only shutdown-proof option.
- Readwise Reader is the feature benchmark; its Ghostreader AI (auto-summary on save, contextual lookups, 'recap to here', chat with document, highlight distillation, experimental auto-tagging, custom templated prompts) is the AI feature set to emulate.
- Karakeep (ex-Hoarder, ~25k stars) is the closest open-source blueprint to the user's stack: Next.js + SQLite monorepo with LLM auto-tagging/summarization via OpenAI-compatible or local Ollama endpoints, Meilisearch FTS, and monolith page archival.
- Table stakes: save via URL/extension/share-sheet/email-in, clean extraction + reading view, Inbox->Later->Archive triage, tags, full-text search, highlights with notes, progress sync, RSS/newsletter ingestion, and Markdown export to note systems.
- The highest-value AI feature is a 150-300 word auto-summary on save used for queue triage (deciding whether to read at all); Reader deliberately skips auto-summarizing RSS feed items to control cost/noise.
- AI triage of the reading backlog against current projects is the acknowledged unsolved problem ('the queue grows faster than you read it') and the biggest differentiation opportunity.
- For extraction use Defuddle (kepano's 2025 Readability successor: multi-pass, forgiving, clean Markdown, site extractor registry) with @mozilla/readability as fallback, and always store raw HTML for future re-extraction.
- Handle JS-rendered and paywalled pages with a queue-based headless-Chrome worker plus a browser extension that POSTs the user's own rendered, authenticated DOM - the legitimate paywall escape hatch used by clipper-style tools.
- Archive faithfully with monolith or SingleFile CLI single-file snapshots alongside extracted text; SQLite + FTS5 is sufficient at personal scale (Readeck and Karakeep both prove it).
- Omnivore's cloud-shaped microservice architecture (GraphQL, Postgres, Elasticsearch, separate content-fetch service) made self-hosting painful; build a boring monolith with an in-process job queue, keeping only the Chrome fetcher separate.
- Close the second-brain loop: export each read item as Markdown with frontmatter (summary + highlights + takeaways) into the PARA folder watched by AIA2ndBrain, reusing its Gemini classifier for constrained-taxonomy auto-tagging.
- Constrain LLM auto-tagging to the user's existing tag/PARA taxonomy (Inoreader's approach) to avoid tag sprawl from unconstrained generation.