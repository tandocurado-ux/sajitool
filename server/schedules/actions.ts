"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserFrom } from "@/server/auth/queries";
import { parseId } from "@/lib/parse";
import type { ActionState } from "@/lib/action-state";
import { parseScheduleInput } from "./schema";

/**
 * キーワードと地域が同一顧客のものか確認する。
 * RLS で他人の行は select できないため、両方取れれば自分のデータ。
 */
async function resolveOwnedClientId(
  supabase: SupabaseClient,
  keywordId: string,
  regionId: string,
): Promise<{ ok: true; clientId: string } | { ok: false; error: string }> {
  const [keyword, region] = await Promise.all([
    supabase.from("keywords").select("client_id").eq("id", keywordId).maybeSingle(),
    supabase.from("regions").select("client_id").eq("id", regionId).maybeSingle(),
  ]);

  if (!keyword.data) return { ok: false, error: "キーワードが見つかりません。" };
  if (!region.data) return { ok: false, error: "地域が見つかりません。" };
  if (keyword.data.client_id !== region.data.client_id) {
    return { ok: false, error: "同じ顧客のキーワードと地域を選択してください。" };
  }

  return { ok: true, clientId: String(keyword.data.client_id) };
}

export async function addSchedule(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseScheduleInput(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createSupabaseServerClient();
  const user = await getUserFrom(supabase);
  if (!user) return { error: "ログインが必要です。" };

  const owned = await resolveOwnedClientId(
    supabase,
    parsed.data.keyword_id,
    parsed.data.region_id,
  );
  if (!owned.ok) return { error: owned.error };

  const { error } = await supabase
    .from("schedules")
    .insert({ ...parsed.data, enabled: true });

  if (error) return { error: `スケジュールの追加に失敗しました: ${error.message}` };

  revalidatePath(`/clients/${owned.clientId}`);
  return { error: null };
}

export async function toggleSchedule(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseId(formData);
  if (!parsed.ok) return { error: parsed.error };
  const clientId = String(formData.get("client_id") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";

  const supabase = await createSupabaseServerClient();
  const user = await getUserFrom(supabase);
  if (!user) return { error: "ログインが必要です。" };

  const { error } = await supabase
    .from("schedules")
    .update({ enabled })
    .eq("id", parsed.data);

  if (error) return { error: `スケジュールの更新に失敗しました: ${error.message}` };

  if (clientId) revalidatePath(`/clients/${clientId}`);
  return { error: null };
}

export async function removeSchedule(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseId(formData);
  if (!parsed.ok) return { error: parsed.error };
  const clientId = String(formData.get("client_id") ?? "");

  const supabase = await createSupabaseServerClient();
  const user = await getUserFrom(supabase);
  if (!user) return { error: "ログインが必要です。" };

  const { error } = await supabase.from("schedules").delete().eq("id", parsed.data);
  if (error) return { error: `スケジュールの削除に失敗しました: ${error.message}` };

  if (clientId) revalidatePath(`/clients/${clientId}`);
  return { error: null };
}
