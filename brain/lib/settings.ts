import { getDb } from "./db";

// Tiny key-value settings on the existing SQLite file — runtime-switchable
// from the UI, no restart (unlike env vars).

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

export type LlmProvider = "claude" | "gemini";

// DB setting wins; LLM_PROVIDER env seeds the default before the first toggle.
export function getLlmProvider(): LlmProvider {
  const value = getSetting("llm_provider") ?? process.env.LLM_PROVIDER;
  return value === "gemini" ? "gemini" : "claude";
}
