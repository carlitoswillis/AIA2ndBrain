import { countMatches, searchDocs } from "@/lib/search";

export const dynamic = "force-dynamic";

// snippet() returns text with « » around matched terms. Rendering it as a string
// would show the guillemets literally; splitting on them lets the matches be
// marked without ever putting model- or file-derived HTML into the DOM.
function Snippet({ text }: { text: string }) {
  const parts = text.split(/«|»/);
  return (
    <p className="snippet">
      {parts.map((part, i) =>
        i % 2 === 1 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>
      )}
    </p>
  );
}

export default function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const query = (searchParams.q ?? "").trim();
  const hits = query ? searchDocs(query) : [];
  const total = query ? countMatches(query) : 0;

  return (
    <main>
      <form action="/search" method="get" className="saveform">
        <input
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Search the library…"
          autoFocus
        />
        <button className="primary">Search</button>
      </form>

      {!query ? (
        <p className="empty">
          Search titles and full text across the vault and your Notes archive.
        </p>
      ) : hits.length === 0 ? (
        <p className="empty">Nothing matched “{query}”.</p>
      ) : (
        <>
          <p className="resultcount">
            {total} match{total === 1 ? "" : "es"} for <strong>{query}</strong>
            {total > hits.length && <> — showing the top {hits.length}</>}
          </p>
          {hits.map((hit) => (
            <article className="row" key={hit.id}>
              <a className="rowtitle" href={`/doc/${hit.id}`}>
                {hit.title || "(untitled)"}
              </a>
              <div className="meta">
                <span>{hit.area || "(unfiled)"}</span>
                <span className="sep">
                  {hit.source === "vault" ? "vault" : "notes archive"}
                </span>
                {hit.word_count ? (
                  <span className="sep">{hit.word_count} words</span>
                ) : null}
              </div>
              <Snippet text={hit.snippet} />
            </article>
          ))}
        </>
      )}

      <div className="footnote">
        <p>
          Keyword search (SQLite FTS5, title matches weighted 8×). Plain words are
          matched as a phrase set; <code>OR</code>, <code>NOT</code>,{" "}
          <code>NEAR()</code>, <code>&quot;exact phrase&quot;</code> and{" "}
          <code>title:word</code> also work. Semantic search arrives with chat in
          phase 3.
        </p>
      </div>
    </main>
  );
}
