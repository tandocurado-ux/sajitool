"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserFrom } from "@/server/auth/queries";
import { findImmediateRun, type ImmediateRun } from "@/lib/immediate";
import { enqueueImmediateRun } from "./queue";

export type ImmediateRequestState = {
  error: string | null;
  requestId: string | null;
  scheduleId: string | null;
};

/** 「今すぐ実行」ボタン。1件だけ即時実行キューに積む。 */
export async function requestImmediateRun(
  _prevState: ImmediateRequestState,
  formData: FormData,
): Promise<ImmediateRequestState> {
  const scheduleId = String(formData.get("schedule_id") ?? "").trim();
  if (!scheduleId) return { error: "スケジュールが指定されていません。", requestId: null, scheduleId: null };

  const supabase = await createSupabaseServerClient();
  const result = await enqueueImmediateRun(supabase, scheduleId);
  if (!result.ok) return { error: result.error, requestId: null, scheduleId };
  return { error: null, requestId: result.requestId, scheduleId };
}

/**
 * 依頼の現在の状態（ポーリング用）。
 * 進捗は計測エンジンが app_metadata に書くので、getUser() で読み直す。
 */
export async function getImmediateRunStatus(requestId: string): Promise<ImmediateRun | null> {
  if (!requestId) return null;
  const supabase = await createSupabaseServerClient();
  const user = await getUserFrom(supabase);
  if (!user) return null;
  return findImmediateRun(user, requestId);
}
