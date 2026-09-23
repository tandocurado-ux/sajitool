import type { ParseResult } from "@/lib/parse";

export type ClientInput = { name: string };

export function parseClientInput(formData: FormData): ParseResult<ClientInput> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "顧客名を入力してください。" };
  if (name.length > 100) {
    return { ok: false, error: "顧客名は100文字以内で入力してください。" };
  }
  return { ok: true, data: { name } };
}

export type ClientRenameInput = { id: string; name: string };

export function parseClientRename(
  formData: FormData,
): ParseResult<ClientRenameInput> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "顧客が指定されていません。" };

  const parsed = parseClientInput(formData);
  if (!parsed.ok) return parsed;

  return { ok: true, data: { id, name: parsed.data.name } };
}
