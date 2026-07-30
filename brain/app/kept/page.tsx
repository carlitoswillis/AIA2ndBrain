import { getDb, type Item } from "@/lib/db";
import { vaultInbox } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default function KeptPage() {
  const items = getDb()
    .prepare(`SELECT * FROM items WHERE status = 'kept' ORDER BY kept_at DESC LIMIT 500`)
    .all() as Item[];

  return (
    <main>
      {items.length === 0 ? (
        <p className="empty">Nothing kept yet.</p>
      ) : (
        items.map((item) => (
          <article className="card" key={item.id}>
            <h2>
              <a href={`/read/${item.id}`}>{item.title || item.url}</a>
            </h2>
            <div className="meta">
              {item.site && <span>{item.site}</span>}
              {item.kept_at && <span className="sep">kept {item.kept_at.slice(0, 10)}</span>}
            </div>
            {item.vault_file && (
              <p className="pending">
                <code>{item.vault_file}</code>
              </p>
            )}
          </article>
        ))
      )}

      <div className="footnote">
        <p>
          Exports land in <code>{vaultInbox()}</code>, where the watcher classifies them
          into PARA.
        </p>
      </div>
    </main>
  );
}
