import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getDoc } from "@/lib/search";
import { wmBridgeConfigured } from "@/lib/wm-remote";
import { sendDocToBoard } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * 24% of the Notes archive is title-only — the note was created and never
 * written in. Rendering just an H1 looks identical to a broken page, so detect
 * it and say so. Exporter.app also repeats the title as the first body line,
 * which counts as "nothing beyond the title".
 */
function bodyBeyondTitle(body: string | null, title: string | null): string | null {
  if (!body) return null;
  const normalize = (s: string) =>
    s.replace(/^#{1,6}\s*/, "").replace(/…$/, "").replace(/\s+/g, " ").trim().toLowerCase();
  const wanted = normalize(title ?? "");
  const remaining = body
    .split("\n")
    .filter((line) => line.trim() && normalize(line) !== wanted);
  return remaining.length ? body : null;
}

// The same reading view captures get, pointed at an indexed file. Read-only
// toward the vault: files are written by the watcher and by hand, never by the
// browser. (→ Board writes to Working Memory via its API, not to any file.)
export default function DocPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { pushed?: string };
}) {
  const doc = getDoc(params.id);
  if (!doc) notFound();

  const content = bodyBeyondTitle(doc.body, doc.title);

  return (
    <main className="article">
      <header>
        <h1>{doc.title || doc.rel_path}</h1>
        <div className="meta">
          <span>{doc.source === "vault" ? "vault" : "notes archive"}</span>
          <span className="sep">{doc.area || "(unfiled)"}</span>
          {doc.word_count ? <span className="sep">{doc.word_count} words</span> : null}
          {doc.mtime && <span className="sep">{doc.mtime.slice(0, 10)}</span>}
        </div>
        <div className="meta">
          <code>{doc.rel_path}</code>
        </div>
        {wmBridgeConfigured() && (
          <div className="actions">
            <form action={sendDocToBoard}>
              <input type="hidden" name="id" value={doc.id} />
              <button>→ Board</button>
            </form>
            {searchParams.pushed === "1" && (
              <span className="mutedhint">sent to your board ✓</span>
            )}
            {searchParams.pushed === "err" && (
              <span className="mutedhint">push failed — see server log</span>
            )}
          </div>
        )}
      </header>

      {doc.index_status !== "ok" ? (
        <p className="failed">
          This file&apos;s contents aren&apos;t on disk — iCloud has evicted them.
          {doc.index_error ? ` (${doc.index_error})` : ""} Open the containing folder in
          Finder to download it, then reindex.
        </p>
      ) : content ? (
        <div className="md-body">
          <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
        </div>
      ) : (
        <p className="pending">
          <strong>This note has no body — the title is all there is.</strong> Nothing was
          skipped in indexing: the file on disk is {doc.body?.length ?? 0} bytes. About a
          quarter of the Notes archive is title-only like this.
        </p>
      )}
    </main>
  );
}
