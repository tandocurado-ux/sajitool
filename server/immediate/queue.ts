import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserFrom } from "@/server/auth/queries";
import { isClientOwned } from "@/server/clients/queries";
import { listKeywords } from "@/server/keywords/queries";
import { listRegions } from "@/server/regions/queries";
import { listSchedulesByKeywordIds } from "@/server/schedules/queries";
import { compareAsc } from "@/server/supabase-query";
import type { BulkSetupInput } from "@/server/setup/schema";
import {
  IMMEDIATE_QUEUE_KEY,
  IMMEDIATE_QUEUE_LIMIT,
  activeImmediateRunFor,
  readImmediateQueue,
} from "@/lib/immediate";

export type EnqueueResult =
  | { ok: true; requestId: string; scheduleId: string }
  | { ok: false; error: string };

/**
 * 1件のスケジュールを即時実行キュー（本人の user_metadata）に積む。
 *
 * 1回1件。同じスケジュールが実行待ち／実行中なら積まない（連打対策）。
 */
export async function enqueueImmediateRun(
  supabase: SupabaseClient,
  scheduleId: string,
): Promise<EnqueueResult> {
  const user = await getUserFrom(supabase);
  if (!user) return { ok: false, error: "ログインが必要です。" };

  // 所有権: schedules → keywords → clients。RLS で他人の行は見えない。
  const schedule = await supabase
    .from("schedules")
    .select("id, keyword_id")
    .eq("id", scheduleId)
    .maybeSingle();
  if (schedule.error || !schedule.data) {
    return { ok: false, error: "スケジュールが見つかりません。" };
  }
  const keyword = await supabase
    .from("keywords")
    .select("client_id")
    .eq("id", String(schedule.data.keyword_id))
    .maybeSingle();
  if (keyword.error || !keyword.data) {
    return { ok: false, error: "スケジュールのキーワードが見つかりません。" };
  }
  if (!(await isClientOwned(supabase, String(keyword.data.client_id)))) {
    return { ok: false, error: "このスケジュールを操作する権限がありません。" };
  }

  const active = activeImmediateRunFor(user, scheduleId);
  if (active) {
    return {
      ok: false,
      error:
        active.status === "running"
          ? "このスケジュールは実行中です。完了してからもう一度実行してください。"
          : "このスケジュールはすでに実行待ちです。",
    };
  }
  const queue = readImmediateQueue(user);
  if (queue.length >= IMMEDIATE_QUEUE_LIMIT) {
    return {
      ok: false,
      error: `実行待ちが ${IMMEDIATE_QUEUE_LIMIT} 件あります。完了を待ってから実行してください。`,
    };
  }

  const request = {
    id: crypto.randomUUID(),
    schedule_id: scheduleId,
    requested_at: new Date().toISOString(),
  };
  const { error } = await supabase.auth.updateUser({
    data: { [IMMEDIATE_QUEUE_KEY]: [...queue, request] },
  });
  if (error) {
    return { ok: false, error: `即時実行の登録に失敗しました: ${error.message}` };
  }
  return { ok: true, requestId: request.id, scheduleId };
}

/**
 * 一括登録の内容から「先頭のキーワード × 地域 × デバイス」のスケジュール id を探す。
 * 見つからなければ、その顧客で最後に作られたスケジュールにフォールバックする。
 */
export async function findFirstScheduleId(input: BulkSetupInput): Promise<string | null> {
  const [keywords, regions] = await Promise.all([
    listKeywords(input.client_id),
    listRegions(input.client_id),
  ]);
  const firstKeyword = input.keywords[0];
  const firstPlatform = input.platforms[0];
  const firstDevice = input.devices[0];

  const keyword = keywords.find(
    (entry) => entry.keyword === firstKeyword && entry.platform === firstPlatform,
  );
  const firstRegionId =
    input.regionIds[0] ??
    (input.newRegions[0]
      ? regions.find((region) => region.label === input.newRegions[0].label)?.id
      : undefined);

  if (keyword) {
    const schedules = await listSchedulesByKeywordIds([keyword.id]);
    const exact = schedules.find(
      (schedule) =>
        (firstRegionId === undefined || schedule.region_id === firstRegionId) &&
        (firstDevice === undefined || schedule.device === firstDevice),
    );
    if (exact) return exact.id;
    if (schedules.length > 0) return schedules[0].id;
  }

  const all = await listSchedulesByKeywordIds(keywords.map((entry) => entry.id));
  if (all.length === 0) return null;
  return [...all].sort((a, b) => compareAsc(b.created_at, a.created_at))[0].id;
}
