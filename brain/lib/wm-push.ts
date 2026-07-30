import { wmBridgeConfigured } from "./wm-remote";

// The one write path to Working Memory, and it goes through WM's front door:
// POST /api/items creates a single item via WM's normal insert (its DB
// triggers write actor-attributed history). This module never touches WM's
// SQLite — that rule stays absolute.

const TIMEOUT_MS = 15_000;

export type PushResult =
  | { ok: true; list: string; board: string | null }
  | { ok: false; error: string };

export async function pushToBoard(text: string, list?: string): Promise<PushResult> {
  if (!wmBridgeConfigured()) {
    return { ok: false, error: "WM_URL / WM_BRAIN_TOKEN not configured" };
  }
  try {
    const base = process.env.WM_URL!.replace(/\/+$/, "");
    const res = await fetch(`${base}/api/items`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.WM_BRAIN_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(list ? { text, list } : { text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${await res.text()}` };
    const data = (await res.json()) as { list?: string; board?: string | null };
    return { ok: true, list: data.list ?? "braindump", board: data.board ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
