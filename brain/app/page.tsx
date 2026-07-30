import { contextSummary } from "@/lib/context";
import { getDb, type Item } from "@/lib/db";
import { getLlmProvider } from "@/lib/settings";
import { deleteItem, keepItem, retryItem, saveUrl, setLlmProvider } from "./actions";

export const dynamic = "force-dynamic";

function readingTime(words: number | null): string | null {
  if (!words) return null;
  return `${Math.max(1, Math.round(words / 220))} min read`;
}

function formatAge(hours: number | null): string {
  if (hours === null) return "unknown age";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function Card({ item }: { item: Item }) {
  const mins = readingTime(item.word_count);
  const failed = item.extract_status === "failed";

  return (
    <article className="card">
      <h2>
        {failed ? (
          <a href={item.url ?? "#"} target="_blank" rel="noreferrer">
            {item.title || item.url}
          </a>
        ) : (
          <a href={`/read/${item.id}`}>{item.title || item.url}</a>
        )}
      </h2>

      <div className="meta">
        {item.site && <span>{item.site}</span>}
        {mins && <span className="sep">{mins}</span>}
        {item.author && <span className="sep">{item.author}</span>}
        {item.read_at && <span className="sep">read</span>}
      </div>

      {failed ? (
        <p className="failed">Extraction failed: {item.extract_error}</p>
      ) : item.summary ? (
        <p className="summary">{item.summary}</p>
      ) : (
        <p className="pending">No summary yet.</p>
      )}

      {/* Only rendered when the model found a real tie to current work —
          absence is the common, correct case. */}
      {item.relevance && <p className="relevance">↳ {item.relevance}</p>}

      <div className="actions">
        {failed ? (
          <>
            <form action={retryItem}>
              <input type="hidden" name="id" value={item.id} />
              <button className="primary">Retry</button>
            </form>
            <a href={item.url ?? "#"} target="_blank" rel="noreferrer">
              <button>Open original</button>
            </a>
          </>
        ) : (
          <>
            <a href={`/read/${item.id}`}>
              <button className="primary">Read</button>
            </a>
            <form action={keepItem}>
              <input type="hidden" name="id" value={item.id} />
              <button>Keep</button>
            </form>
          </>
        )}
        <form action={deleteItem}>
          <input type="hidden" name="id" value={item.id} />
          <button className="danger">Delete</button>
        </form>
      </div>
    </article>
  );
}

export default function InboxPage() {
  const items = getDb()
    .prepare(
      `SELECT * FROM items WHERE status = 'inbox' ORDER BY saved_at DESC LIMIT 200`
    )
    .all() as Item[];

  const context = contextSummary();
  const token = process.env.SAVE_TOKEN;
  const bookmarklet = token
    ? `javascript:void(open('http://localhost:3002/api/save?token=${encodeURIComponent(
        token
      )}&url='+encodeURIComponent(location.href),'_blank'))`
    : null;

  return (
    <main>
      <form action={saveUrl} className="saveform">
        <input
          name="url"
          type="text"
          placeholder="Paste a URL to save…"
          autoComplete="off"
          required
        />
        <button className="primary">Save</button>
      </form>

      {items.length === 0 ? (
        <p className="empty">Inbox empty. Paste a URL above.</p>
      ) : (
        items.map((item) => <Card key={item.id} item={item} />)
      )}

      <div className="footnote">
        <form action={setLlmProvider} className="providerform">
          <strong>Summaries by</strong>{" "}
          <select name="provider" defaultValue={getLlmProvider()}>
            <option value="claude">Claude (CLI, sonnet)</option>
            <option value="gemini">Gemini (flash)</option>
          </select>{" "}
          <button>Apply</button>
          <span className="mutedhint">the other provider backstops on failure</span>
        </form>
        <p>
          <strong>Context</strong> —{" "}
          {context.count === 0 ? (
            <>
              no current-work context found at <code>{context.source}</code> — summaries
              are generic. Set <code>WM_DB_PATH</code> to point at it.
            </>
          ) : context.stale ? (
            <>
              Working Memory snapshot is <strong>{formatAge(context.ageHours)} old</strong>{" "}
              — too stale to trust, so it is <em>not</em> being used. Pull a fresh one
              (<code>RESTORE_LOCAL=1 scripts/pull-backup.sh</code>).
            </>
          ) : (
            <>
              triage is judging saves against your <strong>{context.count}</strong> open
              Working Memory items, as of {formatAge(context.ageHours)} ago; a card shows a{" "}
              <span className="relevance" style={{ margin: 0 }}>
                ↳ line
              </span>{" "}
              only when there's a real tie.
            </>
          )}
        </p>
        {bookmarklet ? (
          <>
            <p>
              <strong>Bookmarklet</strong> — drag this to your bookmarks bar:{" "}
              {/* Emitted as raw HTML on purpose: React sanitizes javascript: hrefs,
                  which silently turns the link into a non-draggable no-op. */}
              <span
                dangerouslySetInnerHTML={{
                  __html: `<a href="${bookmarklet
                    .replace(/&/g, "&amp;")
                    .replace(/"/g, "&quot;")
                    .replace(/</g, "&lt;")}">Save to Brain</a>`,
                }}
              />
            </p>
            <p>
              If Chrome refuses the drop, add it by hand: right-click the bookmarks bar →
              <em> Add page…</em>, name it anything, and paste this as the URL:
            </p>
            <p>
              <code>{bookmarklet}</code>
            </p>
          </>
        ) : (
          <p>
            <strong>Bookmarklet</strong> —{" "}
            <em>set SAVE_TOKEN in brain/.env to enable</em>
          </p>
        )}
        <p>
          <strong>iOS Shortcut</strong> — Get Contents of URL →{" "}
          <code>http://localhost:3002/api/save</code>, method POST, header{" "}
          <code>Authorization: Bearer {token ? "<SAVE_TOKEN>" : "…"}</code>, JSON body{" "}
          <code>{`{"url": <Shortcut Input>}`}</code>.
        </p>
      </div>
    </main>
  );
}
