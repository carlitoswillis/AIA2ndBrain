import { indexHealth, notesExportDate, reindexOnce } from "@/lib/indexer";
import { countDocs, libraryAreas, listDocs } from "@/lib/search";
import { reindexNow } from "../actions";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  vault: "Vault (PARA)",
  notes: "Apple Notes archive",
};

function when(iso: string | null): string {
  if (!iso) return "";
  const days = (Date.now() - Date.parse(iso)) / 86_400_000;
  if (Number.isNaN(days)) return "";
  if (days < 1) return "today";
  if (days < 30) return `${Math.round(days)}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export default function LibraryPage({
  searchParams,
}: {
  searchParams: { source?: string; area?: string };
}) {
  // First view of the library in this server process picks up anything that
  // changed on disk while the app wasn't running.
  reindexOnce();

  const health = indexHealth();
  const exportedAt = notesExportDate();
  const areas = libraryAreas();
  const { source, area } = searchParams;
  const docs = listDocs({ source, area, limit: 60 });
  const total = countDocs({ source, area });

  if (health.total === 0) {
    return (
      <main>
        <p className="empty">
          The library is empty — nothing has been indexed yet.
        </p>
        <div className="actions" style={{ justifyContent: "center" }}>
          <form action={reindexNow}>
            <button className="primary">Build the index</button>
          </form>
        </div>
        <div className="footnote">
          <p>
            Indexes markdown from the vault (<code>{health.roots.vault}</code>) and the
            Apple Notes export (<code>{health.roots.notes}</code>). Files are never
            modified — the index is a lens over them and can be rebuilt anytime.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <div className="facets">
        <a className={!source && !area ? "facet on" : "facet"} href="/library">
          All <span>{health.total}</span>
        </a>
        {areas.map((a) => {
          const on = source === a.source && area === (a.area ?? "");
          const href = `/library?source=${encodeURIComponent(a.source)}&area=${encodeURIComponent(
            a.area ?? ""
          )}`;
          return (
            <a className={on ? "facet on" : "facet"} href={href} key={`${a.source}/${a.area}`}>
              {a.area || "(unfiled)"} <span>{a.n}</span>
            </a>
          );
        })}
      </div>

      <p className="resultcount">
        {source || area ? (
          <>
            {total} in <strong>{area || "(unfiled)"}</strong>{" "}
            {source && <>· {SOURCE_LABEL[source] ?? source}</>} — newest first
          </>
        ) : (
          <>{total} documents, newest first</>
        )}
      </p>

      {docs.map((doc) => (
        <article className="row" key={doc.id}>
          <a className="rowtitle" href={`/doc/${doc.id}`}>
            {doc.title || doc.rel_path}
          </a>
          <div className="meta">
            <span>{doc.area || "(unfiled)"}</span>
            {/* 24% of the archive is a title and nothing else — worth knowing
                before clicking, so an empty reader isn't mistaken for a bug. */}
            {(doc.word_count ?? 0) <= 3 ? (
              <span className="sep">title only</span>
            ) : (
              <span className="sep">{doc.word_count} words</span>
            )}
            {doc.mtime && <span className="sep">{when(doc.mtime)}</span>}
            {doc.index_status !== "ok" && (
              <span className="sep" style={{ color: "var(--danger)" }}>
                not downloaded from iCloud
              </span>
            )}
          </div>
          {doc.summary && <p className="summary">{doc.summary.slice(0, 220)}</p>}
        </article>
      ))}

      <div className="footnote">
        {exportedAt && (
          <p>
            <strong>Notes archive is a snapshot</strong> — exported from Apple Notes{" "}
            {when(exportedAt)} ({exportedAt.slice(0, 10)}). Notes you write or edit on
            your phone since then aren&apos;t here, and reindexing won&apos;t find them:
            the export is a copy, not a live link. (Vault files are live — edits to those
            do show up.)
          </p>
        )}
        <p>
          Index: <strong>{health.total}</strong> documents
          {health.unreadable > 0 && (
            <>
              , <strong style={{ color: "var(--danger)" }}>{health.unreadable}</strong> whose
              contents iCloud has evicted (they exist but can&apos;t be read — open the
              folder in Finder, or <code>brctl download</code>, then reindex)
            </>
          )}
          . Last built {when(health.lastIndexedAt) || "never"}.
        </p>
        <form action={reindexNow} className="actions">
          <button>Reindex</button>
          <span className="mutedhint">
            re-reads both roots; unchanged files are skipped
          </span>
        </form>
      </div>
    </main>
  );
}
