"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserFrom } from "@/server/auth/queries";
import { parseId } from "@/lib/parse";
import type { ActionState } from "@/lib/action-state";
import { parseClientInput, parseClientRename } from "./schema";

export async function addClient(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseClientInput(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createSupabaseServerClient();
  const user = await getUserFrom(supabase);
  if (!user) return { error: "ログインが必要です。" };

  const { error } = await supabase
    .from("clients")
    .insert({ name: parsed.data.name, user_id: user.id });

  if (error) return { error: `顧客の追加に失敗しました: ${error.message}` };

  revalidatePath("/clients");
  return { error: null };
}

export async function removeClient(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseId(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createSupabaseServerClient();
  const user = await getUserFrom(supabase);
  if (!user) return { error: "ログインが必要です。" };

  const { error } = await supabase.from("clients").delete().eq("id", parsed.data);
  if (error) return { error: `顧客の削除に失敗しました: ${error.message}` };

  revalidatePath("/clients");
  return { error: null };
}

export async function renameClient(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseClientRename(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createSupabaseServerClient();
  const user = await getUserFrom(supabase);
  if (!user) return { error: "ログインが必要です。" };

  const { error } = await supabase
    .from("clients")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id);

  if (error) return { error: `顧客名の変更に失敗しました: ${error.message}` };

  revalidatePath("/clients");
  revalidatePath(`/clients/${parsed.data.id}`);
  return { error: null };
}
