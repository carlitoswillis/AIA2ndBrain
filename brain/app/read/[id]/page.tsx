import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getDb, type Item } from "@/lib/db";
import { wmBridgeConfigured } from "@/lib/wm-remote";
import { deleteItem, keepItem, sendToBoard } from "../../actions";

export const dynamic = "force-dynamic";

export default function ReadPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { pushed?: string };
}) {
  const db = getDb();
  const item = db.prepare("SELECT * FROM items WHERE id = ?").get(params.id) as
    | Item
    | undefined;
  if (!item) notFound();

  // Stamp first read; the trigger logs the event for the phase-4 review.
  if (!item.read_at) {
    db.prepare(
      "UPDATE items SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
    ).run(item.id);
  }

  const mins = item.word_count
    ? `${Math.max(1, Math.round(item.word_count / 220))} min read`
    : null;

  return (
    <main className="article">
      <header>
        <h1>{item.title || item.url}</h1>
        <div className="meta">
          {item.site && <span>{item.site}</span>}
          {item.author && <span className="sep">{item.author}</span>}
          {item.published_at && <span className="sep">{item.published_at}</span>}
          {mins && <span className="sep">{mins}</span>}
        </div>
        <div className="actions">
          <form action={keepItem}>
            <input type="hidden" name="id" value={item.id} />
            <button className="primary">Keep → vault</button>
          </form>
          <form action={deleteItem}>
            <input type="hidden" name="id" value={item.id} />
            <button className="danger">Delete</button>
          </form>
          {wmBridgeConfigured() && (
            <form action={sendToBoard}>
              <input type="hidden" name="id" value={item.id} />
              <button>→ Board</button>
            </form>
          )}
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer">
              <button>Original</button>
            </a>
          )}
          {searchParams.pushed === "1" && (
            <span className="mutedhint">sent to your board ✓</span>
          )}
          {searchParams.pushed === "err" && (
            <span className="mutedhint">push failed — is the board deployed with BRAIN_TOKEN?</span>
          )}
        </div>
      </header>

      {item.content_md ? (
        <div className="md-body">
          <Markdown remarkPlugins={[remarkGfm]}>{item.content_md}</Markdown>
        </div>
      ) : (
        <p className="failed">
          No extracted content{item.extract_error ? `: ${item.extract_error}` : "."}
        </p>
      )}
    </main>
  );
}
