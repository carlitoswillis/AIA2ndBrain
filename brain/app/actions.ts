"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getItem, insertItem, processItem } from "@/lib/save";
import { setSetting } from "@/lib/settings";
import { exportToVault } from "@/lib/vault";

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/kept");
}

export async function saveUrl(formData: FormData) {
  const url = String(formData.get("url") ?? "");
  const { id } = insertItem(url);
  revalidateAll();
  await processItem(id);
  revalidateAll();
}

export async function keepItem(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const item = getItem(id);
  if (!item) return;

  const vaultFile = exportToVault(item, item.content_md ?? item.summary ?? "");
  getDb()
    .prepare(
      `UPDATE items
          SET status = 'kept',
              kept_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              exported_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              vault_file = ?
        WHERE id = ?`
    )
    .run(vaultFile, id);

  revalidateAll();
  redirect("/");
}

export async function deleteItem(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  // Deletion is a success state. Hard delete, no trash to manage later.
  getDb().prepare("DELETE FROM items WHERE id = ?").run(id);
  revalidateAll();
  redirect("/");
}

export async function retryItem(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  await processItem(id);
  revalidateAll();
}

export async function setLlmProvider(formData: FormData) {
  const provider = String(formData.get("provider") ?? "");
  if (provider !== "claude" && provider !== "gemini") return;
  setSetting("llm_provider", provider);
  revalidateAll();
}
