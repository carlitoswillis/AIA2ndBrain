import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Item } from "./db";

// "Keep" hands the item off to the vault: a plain markdown file in Inbox/notes,
// where the existing watcher (src/main.js) Gemini-classifies it into PARA.
// The watcher reads body text and does NOT parse frontmatter, so metadata lives
// in the body. Timestamp-prefixed filenames + atomic rename defend against the
// watcher's slug-collision overwrite bug and its lack of awaitWriteFinish.

const DEFAULT_VAULT_INBOX = path.join(
  os.homedir(),
  "Library/Mobile Documents/com~apple~CloudDocs/SecondBrain/Inbox/notes"
);

export function vaultInbox(): string {
  return process.env.VAULT_INBOX || DEFAULT_VAULT_INBOX;
}

export function slugify(input: string): string {
  const slug = (input || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’"“”]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "untitled";
}

function stamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

export function buildVaultMarkdown(item: Item, contentMd: string): string {
  const title = item.title?.trim() || item.url || "Untitled";
  const meta: string[] = [];
  if (item.url) meta.push(`Source: ${item.url}`);
  meta.push(`Saved: ${item.saved_at}`);
  if (item.author) meta.push(`Author: ${item.author}`);
  if (item.site) meta.push(`Site: ${item.site}`);
  if (item.published_at) meta.push(`Published: ${item.published_at}`);
  if (item.word_count) meta.push(`Words: ${item.word_count}`);

  const parts = [`# ${title}`, "", meta.join("\n")];
  if (item.summary) parts.push("", "## Summary", "", item.summary);
  parts.push("", "---", "", contentMd.trim(), "");
  return parts.join("\n");
}

/** Writes the item into the vault inbox. Returns the filename written. */
export function exportToVault(item: Item, contentMd: string): string {
  const dir = vaultInbox();
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${stamp()}-${slugify(item.title || item.url || "untitled")}.md`;
  const target = path.join(dir, filename);
  // .tmp in the same dir so the rename is atomic; the watcher only picks up .md
  const tmp = path.join(dir, `.${filename}.tmp`);

  fs.writeFileSync(tmp, buildVaultMarkdown(item, contentMd), "utf8");
  fs.renameSync(tmp, target);
  return filename;
}
