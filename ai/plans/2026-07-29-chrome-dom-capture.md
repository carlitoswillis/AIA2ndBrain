# Chrome DOM-capture extension (parked — phase 5 intake)

_Logged 2026-07-30. Trigger: first real phase-1 save of an nytimes.com article returned
`Fetch failed: HTTP 403`. Status: **design only, no code.** Scope contract holds — phase 1
gets two weeks of daily use before anything new ships (`ai/ROADMAP.md`)._

## The problem it solves

`fetchAndExtract` is a server-side `fetch` with a browser user-agent. Three classes of
page defeat it:

1. **Bot-blocked** — NYT, Bloomberg, most large publishers. HTTP 403 at the edge.
2. **Paywalled** — the server has no session; even a 200 returns the teaser.
3. **JS-rendered** — the HTML shell has no article text for Defuddle to find.

Today these land as a visible `failed` card with Retry and the original link (working as
designed — the URL is never lost). But retry can't help: the server will never be
allowed to see what the browser already has on screen.

## Why an extension and not a bookmarklet

The obvious cheap fix — a bookmarklet that `fetch`es `document.documentElement.outerHTML`
to localhost — fails on exactly the sites that need it. A bookmarklet runs in the page's
origin, so it's subject to the page's Content-Security-Policy, and every large publisher
sets a `connect-src` that forbids `http://localhost:3002`. An MV3 extension's service
worker runs in the extension's own context: not bound by page CSP, and CORS is granted
by declaring the host permission. It also inherits the user's logged-in session for free,
which is the whole point for paywalled reads.

Consequence: this cannot be a 10-line hack. It's a real (if small) second artifact with
its own install path (`chrome://extensions` → Load unpacked, unlisted, local-only).

## Design

```
extension/
  manifest.json     MV3. permissions: ["activeTab","scripting","storage"]
                    host_permissions: ["http://localhost:3002/*"]
                    action + background service_worker
  background.js     chrome.action.onClicked →
                      chrome.scripting.executeScript({target:{tabId},
                        func: () => document.documentElement.outerHTML})
                      → POST to /api/save/html
                      → chrome.action.setBadgeText("✓" | "✗") to report outcome
  options.html/js   one field: SAVE_TOKEN, kept in chrome.storage.local
  icon128.png
```

New server endpoint — the only app-side change:

```
brain/app/api/save/html/route.ts
  POST {url, html}  · same constant-time SAVE_TOKEN check as /api/save
  1. insertItem(url)                     ← row first, as always
  2. extractFromHtml(html, url)          ← existing fn, unchanged
  3. gzip html → item_content, fields → items, then triage()
  → {id, deduped, extract_status}
```

That is deliberately `processItem` with the network step replaced by a caller-supplied
body. Refactor `processItem(id, {html?})` rather than duplicating the stage-by-stage
error handling; the try/caught staging is the reliability guarantee and must not fork.

## Open questions

- **Retry path.** A `failed` card's Retry button can't reach the browser. Either the
  extension offers a "resave from this tab" flow, or `failed` cards grow a "capture via
  extension" hint. Leaning on the hint — less machinery.
- **Reader-mode source.** Grabbing `outerHTML` post-render is right, but on some SPAs
  the article is in a shadow root or behind a virtualized scroller. Accept the failure;
  don't chase it.
- **Token distribution.** An options page is honest but is one more thing to set up. A
  first-run prompt that reads the token from a localhost endpoint would be smoother and
  is safe enough for a local-only tool — decide when building.
- **Firefox** is not a target.

## Do not build this until

Phase 1 has survived two weeks of daily use (ROADMAP scope contract), and the failure
rate is high enough to be worth 60 lines plus an install path. If bot-blocked saves turn
out to be a handful a month, the `failed` card + open-original is already the right
answer and this file stays a design.
