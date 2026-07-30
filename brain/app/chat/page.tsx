import { chat, type Turn } from "@/lib/agent";
import { reindexOnce } from "@/lib/indexer";

export const dynamic = "force-dynamic";

// Conversation state lives in the URL rather than a table: this is a scratch
// interaction, not a record worth keeping, and a shareable/reloadable link
// costs nothing. If saved conversations ever matter, they get a real table.
function parseHistory(raw: string | undefined): Turn[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Turn[];
    return Array.isArray(parsed)
      ? parsed
          .filter((t) => (t.role === "user" || t.role === "brain") && typeof t.text === "string")
          .slice(-8)
      : [];
  } catch {
    return [];
  }
}

function Answer({
  text,
  passages,
}: {
  text: string;
  passages: { n: number; id: string; title: string | null }[];
}) {
  const byNumber = new Map(passages.map((p) => [p.n, p]));
  return (
    <p className="answer">
      {text.split(/(\[\d+\])/g).map((part, i) => {
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

export default async function ChatPage({
  searchParams,
}: {
  searchParams: { q?: string; h?: string };
}) {
  reindexOnce();

  const question = (searchParams.q ?? "").trim();
  const history = parseHistory(searchParams.h);

  let result = null;
  let error: string | null = null;
  if (question) {
    try {
      result = await chat(question, history);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  const nextHistory = result
    ? encodeURIComponent(
        JSON.stringify(
          [...history, { role: "user", text: question }, { role: "brain", text: result.answer }].slice(-8)
        )
      )
    : searchParams.h ?? "";

  const cited = result?.passages.filter((p) => result.cited.includes(p.n)) ?? [];

  return (
    <main>
      {history.length > 0 && (
        <div className="thread">
          {history.map((turn, i) => (
            <p key={i} className={turn.role === "user" ? "said you" : "said brain"}>
              {turn.text}
            </p>
          ))}
        </div>
      )}

      {question && (
        <p className="said you now">{question}</p>
      )}

      {error && (
        <p className="failed">
          Couldn&apos;t answer: {error}
        </p>
      )}

      {result && !error && (
        <>
          {/* The searches it ran, before the answer — you can see whether it
              looked in the right place before deciding whether to believe it. */}
          {result.steps.length > 0 && (
            <div className="trace">
              {result.steps.map((step, i) => (
                <div className="tracestep" key={i}>
                  <span className="tracequery">
                    searched <strong>{step.query}</strong>
                    {step.year && <> in {step.year}</>}
                  </span>
                  <span className="tracecount">
                    {step.found === 0 ? "nothing" : `${step.found} found`}
                    {step.titles.length > 0 && (
                      <span className="tracetitles"> · {step.titles.join(" · ")}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          <Answer text={result.answer} passages={result.passages} />

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

          {result.hitRoundLimit && (
            <p className="pending">
              Stopped after {result.steps.length} searches. Ask again more specifically
              if that wasn&apos;t it.
            </p>
          )}
        </>
      )}

      <form action="/chat" method="get" className="saveform chatform">
        <input
          name="q"
          type="search"
          placeholder={
            history.length || question ? "Ask a follow-up…" : "Ask your brain anything…"
          }
          autoFocus
          autoComplete="off"
        />
        <input type="hidden" name="h" value={nextHistory} />
        <button className="primary">Send</button>
      </form>

      {(history.length > 0 || question) && (
        <p className="resultcount">
          <a href="/chat">Start over</a>
        </p>
      )}

      {!question && history.length === 0 && (
        <div className="footnote">
          <p>
            Unlike <a href="/ask">Ask</a>, this one searches repeatedly — rephrasing and
            trying different years until it finds something or runs out of tries. Every
            search it runs is shown, so you can tell the difference between &quot;you
            never wrote that down&quot; and &quot;it looked in the wrong place&quot;.
          </p>
        </div>
      )}
    </main>
  );
}
