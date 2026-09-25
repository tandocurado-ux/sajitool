"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserFrom } from "@/server/auth/queries";
import { isClientOwned } from "@/server/clients/queries";
import { enqueueImmediateRun, findFirstScheduleId } from "@/server/immediate/queue";
import { applyBulkSetup } from "./apply";
import {
  initialBulkSetupState,
  parseBulkSetupInput,
  wantsImmediateTest,
  type BulkSetupState,
} from "./schema";

export async function bulkCreateSchedules(
  _prevState: BulkSetupState,
  formData: FormData,
): Promise<BulkSetupState> {
  const parsed = parseBulkSetupInput(formData);
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

  const result = await applyBulkSetup(supabase, input);
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
