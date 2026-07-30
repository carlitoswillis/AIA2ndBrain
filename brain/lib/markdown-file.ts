// Parsing the markdown files the vault and the Apple Notes export actually
// contain — not general YAML, and not general HTML.
//
// The vault's frontmatter is written by the watcher: flat scalars plus one
// string list (tags). Pulling in a YAML dependency for four fields isn't worth
// it, so this handles the shape that exists and degrades instead of throwing on
// anything fancier.

export type ParsedFile = {
  meta: Record<string, string>;
  tags: string[];
  body: string;
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseMarkdownFile(text: string): ParsedFile {
  const match = FRONTMATTER.exec(text);
  if (!match) return { meta: {}, tags: [], body: text };

  const meta: Record<string, string> = {};
  const tags: string[] = [];
  let lastKey: string | null = null;

  for (const line of match[1].split(/\r?\n/)) {
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && lastKey) {
      // Only tags are consumed as a list; other lists are ignored on purpose.
      if (lastKey === "tags") tags.push(unquote(listItem[1]));
      continue;
    }
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (pair) {
      lastKey = pair[1];
      const value = pair[2].trim();
      // A bare `key:` opens a block (list or folded scalar) — the value, if any,
      // arrives on following lines. Folded blocks are joined below.
      if (value) meta[lastKey] = unquote(value);
      continue;
    }
    // Continuation line of a folded scalar (`summary: |-` or wrapped text).
    if (lastKey && /^\s+\S/.test(line) && meta[lastKey] !== undefined) {
      meta[lastKey] = `${meta[lastKey]} ${line.trim()}`;
    } else if (lastKey && /^\s+\S/.test(line)) {
      meta[lastKey] = line.trim();
    }
  }

  return { meta, tags, body: text.slice(match[0].length) };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length > 1)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// Exporter.app leaves styling markup behind: 946 of the 4,086 exported notes
// contain <span style="...">. react-markdown escapes raw HTML rather than
// rendering it, so left alone it shows up as literal tags in the reader AND
// pollutes search snippets. Strip it at index time; the file on disk is
// untouched (it's the source of truth, we just don't index the noise).
export function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>\n]{1,200}>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Title, in order of trust: frontmatter → first H1 → first line → filename. */
export function deriveTitle(
  meta: Record<string, string>,
  body: string,
  filename: string
): string {
  if (meta.title?.trim()) return meta.title.trim();

  const heading = /^#{1,3}\s+(.+)$/m.exec(body);
  if (heading?.[1].trim()) return heading[1].trim().slice(0, 200);

  const firstLine = body
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (firstLine) return firstLine.replace(/^#+\s*/, "").slice(0, 200);

  return filename.replace(/\.md$/i, "");
}
