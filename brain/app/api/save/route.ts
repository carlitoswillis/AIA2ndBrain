import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getItem, insertItem, processItem } from "@/lib/save";

export const dynamic = "force-dynamic";

function tokenOk(req: NextRequest, queryToken: string | null): boolean {
  const expected = process.env.SAVE_TOKEN;
  if (!expected) return false;

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const provided = bearer || queryToken || "";
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/** Bookmarklet: GET /api/save?token=…&url=… → saves, then redirects to the inbox. */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  if (!tokenOk(req, searchParams.get("token"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = searchParams.get("url");
  if (!url) return NextResponse.json({ error: "missing url" }, { status: 400 });

  try {
    // Row first, network second — a timeout can never lose the URL.
    const { id } = insertItem(url);
    await processItem(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return NextResponse.redirect(`${origin}/`);
}

/** iOS Shortcut / anything scriptable: POST JSON or form with a url. */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (!tokenOk(req, searchParams.get("token"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let url: string | null = searchParams.get("url");
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("json")) {
      const body = (await req.json()) as { url?: string };
      url = body.url ?? url;
    } else if (
      contentType.includes("form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const form = await req.formData();
      url = (form.get("url") as string | null) ?? url;
    } else if (!url) {
      url = (await req.text()).trim() || null;
    }
  } catch {
    /* fall through to the missing-url check */
  }

  if (!url) return NextResponse.json({ error: "missing url" }, { status: 400 });

  let id: string;
  let deduped: boolean;
  try {
    ({ id, deduped } = insertItem(url));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  await processItem(id);

  const row = getItem(id);
  return NextResponse.json({
    id,
    deduped,
    extract_status: row?.extract_status ?? "pending",
    title: row?.title ?? null,
  });
}
