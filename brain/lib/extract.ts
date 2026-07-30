import { Defuddle } from "defuddle/node";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type Extraction = {
  rawHtml: string;
  contentMd: string;
  title: string | null;
  author: string | null;
  site: string | null;
  published: string | null;
  wordCount: number | null;
};

export async function fetchAndExtract(url: string): Promise<Extraction> {
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("html")) {
    throw new Error(`Not an HTML page (${contentType.split(";")[0]})`);
  }
  const rawHtml = await res.text();
  return extractFromHtml(rawHtml, url);
}

function normalizeBlock(block: string): string {
  return block
    .replace(/\s+/g, " ")
    .replace(/[.,;:—–-]+$/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Defuddle leaves figure debris behind: the same caption emitted as the image
 * alt text, again as a paragraph, and once more with the photo credit glued on.
 * Collapse duplicate neighbours and captions that merely restate the image alt.
 */
export function tidyMarkdown(md: string): string {
  const blocks = md.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out: string[] = [];

  for (const block of blocks) {
    const prev = out[out.length - 1];
    if (prev) {
      const a = normalizeBlock(prev.replace(/^!\[(.*?)\]\(.*\)$/s, "$1"));
      const b = normalizeBlock(block.replace(/^!\[(.*?)\]\(.*\)$/s, "$1"));
      const isImage = /^!\[/.test(block);
      if (!isImage && a && b) {
        // Exact repeat, or the same text with a credit line appended.
        if (a === b) continue;
        if (a.length >= 25 && b.startsWith(a)) {
          if (!/^!\[/.test(prev)) out[out.length - 1] = block;
          continue;
        }
        if (b.length >= 25 && a.startsWith(b)) continue;
      }
    }
    out.push(block);
  }

  return out.join("\n\n");
}

export async function extractFromHtml(rawHtml: string, url: string): Promise<Extraction> {
  const result = await Defuddle(rawHtml, url, { markdown: true });
  const contentMd = tidyMarkdown((result.content ?? "").trim());
  if (!contentMd) throw new Error("Extraction produced no content");
  return {
    rawHtml,
    contentMd,
    title: result.title || null,
    author: result.author || null,
    site: result.site || result.domain || null,
    published: result.published || null,
    wordCount: result.wordCount || contentMd.split(/\s+/).length,
  };
}
