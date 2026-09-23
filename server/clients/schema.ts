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

// --------------------------------------------------------------------------
// 新規顧客登録（/clients/new）の実行結果
// --------------------------------------------------------------------------
//
// Client Component から読むので、"use server" ではないこのファイルに置く。

import type { BulkSetupSummary } from "@/server/setup/schema";

export type NewClientState = {
  error: string | null;
  warnings: string[];
  summary: BulkSetupSummary | null;
  /** 顧客は作れたが、その先で失敗したときに「どこまで」を伝える。 */
  progress: string | null;
  /** 作成できた顧客の id。失敗時に導線を出すために持つ。 */
  createdClientId: string | null;
};

export const initialNewClientState: NewClientState = {
  error: null,
  warnings: [],
  summary: null,
  progress: null,
  createdClientId: null,
};
