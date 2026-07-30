import { ask, type AskResult } from "@/lib/ask";
import { reindexOnce } from "@/lib/indexer";

export const dynamic = "force-dynamic";

// Citations arrive as [3] inside the answer text. Split on them and render each
// as a link to the source, so every claim is one click from the note it came
// from — the whole point of grounding.
function Answer({ result }: { result: AskResult }) {
  const byNumber = new Map(result.passages.map((p) => [p.n, p]));
  const parts = result.answer.split(/(\[\d+\])/g);

  return (
    <p className="answer">
      {parts.map((part, i) => {
        const match = /^\[(\d+)\]$/.exec(part);
        if (!match) return <span key={i}>{part}</span>;
        const passage = byNumber.get(Number(match[1]));
        if (!passage) return null;
        return (
          <a key={i} className="cite" href={`/doc/${passage.id}`} title={passage.title ?? ""}>
            {match[1]}
          </a>
        );
      })}
    </p>
  );
}

export default async function AskPage({ searchParams }: { searchParams: { q?: string } }) {
  reindexOnce();

  const question = (searchParams.q ?? "").trim();
  let result: AskResult | null = null;
  let error: string | null = null;

  if (question) {
    try {
      result = await ask(question);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  // Sources the answer actually leaned on come first; the rest are still listed,
  // because "what else was nearby" is often the useful part.
  const cited = result?.passages.filter((p) => result!.cited.includes(p.n)) ?? [];
  const uncited = result?.passages.filter((p) => !result!.cited.includes(p.n)) ?? [];

  return (
    <main>
      <form action="/ask" method="get" className="saveform">
        <input
          name="q"
          type="search"
          defaultValue={question}
          placeholder="Ask your notes something…"
          autoFocus
        />
        <button className="primary">Ask</button>
      </form>

      {!question && (
        <p className="empty">
          Answers come only from what you&apos;ve saved — with links to the notes they
          came from. If your library doesn&apos;t cover it, it&apos;ll say so.
        </p>
      )}

      {error && (
        <p className="failed">
          Couldn&apos;t answer: {error}
          <br />
          The library search still works — try <a href={`/search?q=${encodeURIComponent(question)}`}>
            searching for it
          </a> instead.
        </p>
      )}

      {result && !error && (
        <>
          <Answer result={result} />

          {cited.length > 0 && (
            <>
              <p className="resultcount">Sources</p>
              {cited.map((p) => (
                <article className="row" key={p.id}>
                  <a className="rowtitle" href={`/doc/${p.id}`}>
                    <span className="citebadge">{p.n}</span> {p.title || "(untitled)"}
                  </a>
                  <div className="meta">
                    <span>{p.area || "(unfiled)"}</span>
                    <span className="sep">
                      {p.source === "vault" ? "vault" : "notes archive"}
                    </span>
                  </div>
                </article>
              ))}
            </>
          )}

          {uncited.length > 0 && (
            <>
              <p className="resultcount">
                Also searched, not cited ({uncited.length})
              </p>
              {uncited.map((p) => (
                <article className="row" key={p.id}>
                  <a className="rowtitle" href={`/doc/${p.id}`}>
                    {p.title || "(untitled)"}
                  </a>
                  <div className="meta">
                    <span>{p.area || "(unfiled)"}</span>
                  </div>
                </article>
              ))}
            </>
          )}

          <div className="footnote">
            <p>
              Answered from {result.passages.length} passage
              {result.passages.length === 1 ? "" : "s"} retrieved by keyword search
              {result.matchQuery && (
                <>
                  {" "}
                  (<code>{result.matchQuery}</code>)
                </>
              )}
              {result.year && (
                <>
                  , restricted to notes written in <strong>{result.year}</strong> by
                  date rather than by the text mentioning it
                </>
              )}
              . Vague words are dropped in favour of the rarer, more specific ones in
              your question. Nothing outside your library is used — if the answer
              isn&apos;t in there, it says so rather than filling the gap.
            </p>
          </div>
        </>
      )}
    </main>
  );
}
