"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserFrom } from "@/server/auth/queries";
import { isClientOwned } from "@/server/clients/queries";
import { parseId } from "@/lib/parse";
import type { ActionState } from "@/lib/action-state";
import {
  initialStartMeasurementState,
  wantsStartMeasurement,
  type StartMeasurementState,
} from "@/server/setup/schema";
import { startMeasurement } from "@/server/setup/start";
import { parseKeywordInput } from "./schema";

/**
 * キーワードを1件登録する。
 *
 * 「登録と同時に計測を開始する」が ON なら、その顧客の登録済み地域 × 許可デバイスの
 * スケジュールも作る（時間帯に自動分散。1日の消化能力に収まる件数まで）。
 * OFF なら従来どおりキーワードだけを登録する。
 */
export async function addKeyword(
  _prevState: StartMeasurementState,
  formData: FormData,
): Promise<StartMeasurementState> {
  const fail = (error: string): StartMeasurementState => ({
    ...initialStartMeasurementState,
    error,
  });
  const parsed = parseKeywordInput(formData);
  if (!parsed.ok) return fail(parsed.error);

  const supabase = await createSupabaseServerClient();
  const user = await getUserFrom(supabase);
  if (!user) return fail("ログインが必要です。");

  if (!(await isClientOwned(supabase, parsed.data.client_id))) {
    return fail("この顧客を操作する権限がありません。");
  }

  if (wantsStartMeasurement(formData)) {
    const state = await startMeasurement(supabase, {
      clientId: parsed.data.client_id,
      keyword: parsed.data.keyword,
      platform: parsed.data.platform,
      timing: null,
      capToCapacity: true,
    });
    if (state.error) return state;
    revalidatePath(`/clients/${parsed.data.client_id}`);
    revalidatePath(`/clients/${parsed.data.client_id}/setup`);
    return state;
  }

  const { error } = await supabase.from("keywords").insert(parsed.data);
  if (error) return fail(`キーワードの追加に失敗しました: ${error.message}`);

  revalidatePath(`/clients/${parsed.data.client_id}`);
  return {
    ...initialStartMeasurementState,
    platform: parsed.data.platform,
    notice: "キーワードを登録しました（スケジュールは作成していません）。",
  };
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
