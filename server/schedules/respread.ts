"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserFrom } from "@/server/auth/queries";
import { isClientOwned } from "@/server/clients/queries";
import { listKeywords } from "@/server/keywords/queries";
import { listRegions } from "@/server/regions/queries";
import { listSchedulesByKeywordIds } from "@/server/schedules/queries";
import { describeQueryError, fetchInChunks } from "@/server/supabase-query";
import { formatTime } from "@/lib/parse";
import { jstDateKey } from "@/lib/runs";
import { respreadSchedules, type RespreadSchedule } from "@/lib/respread";
import {
  initialRespreadState,
  parseAssignments,
  parseRespreadParams,
  type RespreadState,
} from "./respread-schema";

/** 顧客のスケジュールを、撒き直しロジックが読む形に揃える。 */
async function loadRespreadSchedules(clientId: string): Promise<RespreadSchedule[]> {
  const [keywords, regions] = await Promise.all([
    listKeywords(clientId),
    listRegions(clientId),
  ]);
  const schedules = await listSchedulesByKeywordIds(keywords.map((keyword) => keyword.id));
  const keywordById = new Map(keywords.map((keyword) => [keyword.id, keyword]));
  const regionById = new Map(regions.map((region) => [region.id, region]));

  return schedules.map((schedule) => {
    const keyword = keywordById.get(schedule.keyword_id);
    const region = regionById.get(schedule.region_id);
    return {
      id: schedule.id,
      platform: keyword?.platform ?? "google",
      keyword: keyword?.keyword ?? "(削除済みキーワード)",
      regionLabel: region?.label ?? "(削除済み地域)",
      device: schedule.device,
      enabled: Boolean(schedule.enabled),
      times: (Array.isArray(schedule.times) ? schedule.times : [])
        .map(formatTime)
        .filter((time) => time !== ""),
    };
  });
}

async function authorize(
  clientId: string,
): Promise<{ ok: true; supabase: SupabaseClient } | { ok: false; error: string }> {
  const supabase = await createSupabaseServerClient();
  const user = await getUserFrom(supabase);
  if (!user) return { ok: false, error: "ログインが必要です。" };
  if (!(await isClientOwned(supabase, clientId))) {
    return { ok: false, error: "顧客が見つかりません。" };
  }
  return { ok: true, supabase };
}

/**
 * ドライラン。撒き直し後に各枠が何件になるかを返すだけで、何も書かない。
 */
export async function previewRespread(
  _prevState: RespreadState,
  formData: FormData,
): Promise<RespreadState> {
  const parsed = parseRespreadParams(formData);
  if (!parsed.ok) return { ...initialRespreadState, error: parsed.error };
  const params = parsed.data;

  const auth = await authorize(params.clientId);
  if (!auth.ok) return { ...initialRespreadState, error: auth.error };

  try {
    const schedules = await loadRespreadSchedules(params.clientId);
    const result = respreadSchedules(schedules, {
      platforms: params.platforms,
      maxPerSlot: params.maxPerSlot,
      spreadStart: params.spreadStart,
      spreadEnd: params.spreadEnd,
      // 同じ日に何度プレビューしても同じ結果になるよう日付をシードにする。
      seed: `${params.clientId}|${jstDateKey(new Date())}`,
    });
    return { error: null, preview: { ...result, params }, applied: null };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return { ...initialRespreadState, error: message };
  }
}

/**
 * 適用。画面が見せた割り当て（schedule_id → times）を、その顧客のスケジュールに
 * 限って schedules.times に書く。runs には触れない。
 */
export async function applyRespread(
  _prevState: RespreadState,
  formData: FormData,
): Promise<RespreadState> {
  const parsed = parseRespreadParams(formData);
  if (!parsed.ok) return { ...initialRespreadState, error: parsed.error };
  const params = parsed.data;

  const assignments = parseAssignments(String(formData.get("assignments") ?? ""));
  if (!assignments.ok) return { ...initialRespreadState, error: assignments.error };

  const auth = await authorize(params.clientId);
  if (!auth.ok) return { ...initialRespreadState, error: auth.error };

  // 適用対象は「この顧客の、対象 platform の」スケジュールだけ。
  const current = await loadRespreadSchedules(params.clientId);
  const allowed = new Map(
    current
      .filter((schedule) => params.platforms.includes(schedule.platform))
      .map((schedule) => [schedule.id, schedule]),
  );
  const unknown = assignments.data.filter((entry) => !allowed.has(entry.id));
  if (unknown.length > 0) {
    return {
      ...initialRespreadState,
      error: "スケジュールが変わっています。もう一度プレビューしてから適用してください。",
    };
  }

  const changes = assignments.data.filter((entry) => {
    const before = [...(allowed.get(entry.id)?.times ?? [])].sort();
    return before.length !== entry.times.length || before.some((time, index) => time !== entry.times[index]);
  });
  const unchanged = assignments.data.length - changes.length;
  if (changes.length === 0) {
    return { error: null, preview: null, applied: { updated: 0, unchanged } };
  }

  try {
    // 1件ずつ UPDATE（times は行ごとに違う）。多くても数百件なので 4 並列で回す。
    await fetchInChunks(changes, async (chunk) => {
      for (const entry of chunk) {
        const { error } = await auth.supabase
          .from("schedules")
          .update({ times: entry.times })
          .eq("id", entry.id);
        if (error) {
          throw new Error(`スケジュール ${entry.id} の更新に失敗しました: ${describeQueryError(error)}`);
        }
      }
      return [] as never[];
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    console.error(`[supabase] 再分散の適用に失敗しました: ${message}`);
    return { ...initialRespreadState, error: message };
  }

  revalidatePath(`/clients/${params.clientId}`);
  return { error: null, preview: null, applied: { updated: changes.length, unchanged } };
}
