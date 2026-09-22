"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserFrom } from "@/server/auth/queries";
import { isClientOwned } from "@/server/clients/queries";
import { parseId } from "@/lib/parse";
import type { ActionState } from "@/lib/action-state";
import { parseKeywordInput } from "./schema";

export async function addKeyword(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseKeywordInput(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createSupabaseServerClient();
  const user = await getUserFrom(supabase);
  if (!user) return { error: "ログインが必要です。" };

  if (!(await isClientOwned(supabase, parsed.data.client_id))) {
    return { error: "この顧客を操作する権限がありません。" };
  }

  const { error } = await supabase.from("keywords").insert(parsed.data);
  if (error) return { error: `キーワードの追加に失敗しました: ${error.message}` };

  revalidatePath(`/clients/${parsed.data.client_id}`);
  return { error: null };
}

export async function removeKeyword(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseId(formData);
  if (!parsed.ok) return { error: parsed.error };
  const clientId = String(formData.get("client_id") ?? "");

  const supabase = await createSupabaseServerClient();
  const user = await getUserFrom(supabase);
  if (!user) return { error: "ログインが必要です。" };

  const { error } = await supabase.from("keywords").delete().eq("id", parsed.data);
  if (error) return { error: `キーワードの削除に失敗しました: ${error.message}` };

  if (clientId) revalidatePath(`/clients/${clientId}`);
  return { error: null };
}
