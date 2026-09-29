"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserFrom } from "@/server/auth/queries";
import { isClientOwned } from "@/server/clients/queries";
import { devicePolicyOptions } from "@/server/device-policy";
import { enqueueImmediateRun, findFirstScheduleId } from "@/server/immediate/queue";
import type { Platform } from "@/lib/types";
import { applyBulkSetup } from "./apply";
import { startMeasurement } from "./start";
import {
  initialBulkSetupState,
  initialStartMeasurementState,
  parseBulkSetupInput,
  parseTimingFields,
  wantsImmediateTest,
  type BulkSetupState,
  type StartMeasurementState,
} from "./schema";

export async function bulkCreateSchedules(
  _prevState: BulkSetupState,
  formData: FormData,
): Promise<BulkSetupState> {
  const policy = devicePolicyOptions();
  const parsed = parseBulkSetupInput(formData, policy);
  if (!parsed.ok) {
    return { ...initialBulkSetupState, error: parsed.error };
  }
  const { input, warnings } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const user = await getUserFrom(supabase);
  if (!user) {
    return { ...initialBulkSetupState, warnings, error: "ログインが必要です。" };
  }
  if (!(await isClientOwned(supabase, input.client_id))) {
    return {
      ...initialBulkSetupState,
      warnings,
      error: "この顧客を操作する権限がありません。",
    };
  }

  const result = await applyBulkSetup(supabase, input, policy);
  if (!result.ok) {
    return {
      ...initialBulkSetupState,
      error: result.error,
      warnings,
      progress: result.progress,
    };
  }

  revalidatePath(`/clients/${input.client_id}`);
  revalidatePath(`/clients/${input.client_id}/setup`);

  // 「登録して今すぐ1件テスト実行」: 先頭のキーワード × 地域 × デバイスを1件だけ積む。
  let immediateRequestId: string | null = null;
  let immediateError: string | null = null;
  if (wantsImmediateTest(formData)) {
    const scheduleId = await findFirstScheduleId(input);
    if (!scheduleId) {
      immediateError = "テスト実行するスケジュールが見つかりませんでした。";
    } else {
      const queued = await enqueueImmediateRun(supabase, scheduleId);
      if (queued.ok) immediateRequestId = queued.requestId;
      else immediateError = queued.error;
    }
  }

  return {
    error: null,
    warnings,
    summary: result.summary,
    progress: null,
    immediateRequestId,
    immediateError,
  };
}

/**
 * 詳細画面の「このキーワードで計測を開始」。
 * その顧客の登録済み地域 × 許可デバイス × 選んだ時刻設定でスケジュールを作る。
 */
export async function startKeywordMeasurement(
  _prevState: StartMeasurementState,
  formData: FormData,
): Promise<StartMeasurementState> {
  const fail = (error: string): StartMeasurementState => ({
    ...initialStartMeasurementState,
    error,
  });
  const keywordId = String(formData.get("keyword_id") ?? "").trim();
  if (!keywordId) return fail("キーワードが指定されていません。");

  const timing = parseTimingFields(formData);
  if (!timing.ok) return fail(timing.error);

  const supabase = await createSupabaseServerClient();
  const user = await getUserFrom(supabase);
  if (!user) return fail("ログインが必要です。");

  // 所有権: keywords → clients。RLS で他人の行は見えない。
  const keyword = await supabase
    .from("keywords")
    .select("id, client_id, keyword, platform")
    .eq("id", keywordId)
    .maybeSingle();
  if (keyword.error || !keyword.data) return fail("キーワードが見つかりません。");

  const clientId = String(keyword.data.client_id);
  if (!(await isClientOwned(supabase, clientId))) {
    return fail("このキーワードを操作する権限がありません。");
  }

  const state = await startMeasurement(supabase, {
    clientId,
    keyword: String(keyword.data.keyword),
    platform: String(keyword.data.platform) as Platform,
    keywordId,
    timing: timing.data,
    capToCapacity: false,
  });
  if (state.error) return state;

  revalidatePath(`/clients/${clientId}`);
  revalidatePath(`/clients/${clientId}/setup`);
  return state;
}
