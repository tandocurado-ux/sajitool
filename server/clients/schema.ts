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
