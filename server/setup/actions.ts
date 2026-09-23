"use server";

import { revalidatePath } from "next/cache";
import { assignSpreadTimes } from "@/lib/parse";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserFrom } from "@/server/auth/queries";
import { isClientOwned } from "@/server/clients/queries";
import {
  initialBulkSetupState,
  parseBulkSetupInput,
  type BulkSetupState,
  type BulkSetupSummary,
} from "./schema";

const SEP = "\u0000";

function emptySummary(): BulkSetupSummary {
  return {
    keywordsCreated: 0,
    keywordsSkipped: 0,
    regionsCreated: 0,
    schedulesCreated: 0,
    schedulesSkipped: 0,
  };
}

function describeProgress(summary: BulkSetupSummary): string {
  return [
    `キーワード ${summary.keywordsCreated} 件`,
    `地域 ${summary.regionsCreated} 件`,
    `スケジュール ${summary.schedulesCreated} 件`,
  ].join(" / ");
}

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

  const summary = emptySummary();
  const fail = (message: string): BulkSetupState => ({
    error: message,
    warnings,
    summary: null,
    progress: `${describeProgress(summary)} まで作成済みです。`,
  });

  // --- キーワード（既存の keyword × platform はスキップ）---
  const keywordKey = (keyword: string, platform: string) =>
    `${keyword}${SEP}${platform}`;
  const keywordIdByKey = new Map<string, string>();

  const existingKeywords = await supabase
    .from("keywords")
    .select("id, keyword, platform")
    .eq("client_id", input.client_id);
  if (existingKeywords.error) {
    return fail(`キーワードの確認に失敗しました: ${existingKeywords.error.message}`);
  }
  for (const row of existingKeywords.data ?? []) {
    keywordIdByKey.set(keywordKey(row.keyword, row.platform), String(row.id));
  }

  const missingKeywords: {
    client_id: string;
    keyword: string;
    platform: string;
  }[] = [];
  for (const keyword of input.keywords) {
    for (const platform of input.platforms) {
      if (keywordIdByKey.has(keywordKey(keyword, platform))) {
        summary.keywordsSkipped += 1;
        continue;
      }
      missingKeywords.push({
        client_id: input.client_id,
        keyword,
        platform,
      });
    }
  }

  if (missingKeywords.length > 0) {
    const inserted = await supabase
      .from("keywords")
      .insert(missingKeywords)
      .select("id, keyword, platform");
    if (inserted.error) {
      return fail(`キーワードの登録に失敗しました: ${inserted.error.message}`);
    }
    for (const row of inserted.data ?? []) {
      keywordIdByKey.set(keywordKey(row.keyword, row.platform), String(row.id));
    }
    summary.keywordsCreated = inserted.data?.length ?? 0;
  }

  // --- 地域 ---
  let regionIds: string[] = [];
  if (input.regionIds.length > 0) {
    // 選ばれた地域が本当にこの顧客のものかを確認する。
    const owned = await supabase
      .from("regions")
      .select("id")
      .eq("client_id", input.client_id)
      .in("id", input.regionIds);
    if (owned.error) {
      return fail(`地域の確認に失敗しました: ${owned.error.message}`);
    }
    regionIds = (owned.data ?? []).map((row) => String(row.id));
    if (regionIds.length !== input.regionIds.length) {
      return fail("選択された地域の一部が見つかりませんでした。画面を再読み込みしてください。");
    }
  }

  if (input.newRegions.length > 0) {
    const inserted = await supabase
      .from("regions")
      .insert(
        input.newRegions.map((region) => ({
          client_id: input.client_id,
          ...region,
        })),
      )
      .select("id");
    if (inserted.error) {
      return fail(`地域の登録に失敗しました: ${inserted.error.message}`);
    }
    regionIds = regionIds.concat((inserted.data ?? []).map((row) => String(row.id)));
    summary.regionsCreated = inserted.data?.length ?? 0;
  }

  if (regionIds.length === 0) {
    return fail("地域が1つも指定されていません。");
  }

  // --- スケジュール（同じ keyword × region × device は作らない）---
  const keywordIds = [...keywordIdByKey.values()];
  const existingSchedules = await supabase
    .from("schedules")
    .select("keyword_id, region_id, device")
    .in("keyword_id", keywordIds);
  if (existingSchedules.error) {
    return fail(
      `スケジュールの確認に失敗しました: ${existingSchedules.error.message}`,
    );
  }
  const scheduleKey = (keywordId: string, regionId: string, device: string) =>
    `${keywordId}${SEP}${regionId}${SEP}${device}`;
  const existingScheduleKeys = new Set(
    (existingSchedules.data ?? []).map((row) =>
      scheduleKey(String(row.keyword_id), String(row.region_id), row.device),
    ),
  );

  const scheduleRows: {
    keyword_id: string;
    region_id: string;
    device: string;
    times: string[];
    enabled: boolean;
  }[] = [];

  // 自動分散のときは、作る順に15分枠へ均等に割り振る。
  // 枠数と互いに素な歩幅で飛ばすので、同じキーワードの数パターンが
  // 隣り合う枠に固まらない。回転数ぶんの時刻を1スケジュールに入れる。
  const spreadSlots = input.timeMode === "spread" ? input.spreadSlots : null;
  let assigned = 0;

  for (const keyword of input.keywords) {
    for (const platform of input.platforms) {
      const keywordId = keywordIdByKey.get(keywordKey(keyword, platform));
      if (!keywordId) continue;
      for (const regionId of regionIds) {
        for (const device of input.devices) {
          if (existingScheduleKeys.has(scheduleKey(keywordId, regionId, device))) {
            summary.schedulesSkipped += 1;
            continue;
          }
          const times = spreadSlots
            ? assignSpreadTimes(assigned, spreadSlots, input.rotations)
            : input.times;
          assigned += 1;
          scheduleRows.push({
            keyword_id: keywordId,
            region_id: regionId,
            device,
            times,
            enabled: true,
          });
        }
      }
    }
  }

  if (scheduleRows.length > 0) {
    const inserted = await supabase
      .from("schedules")
      .insert(scheduleRows)
      .select("id");
    if (inserted.error) {
      return fail(`スケジュールの登録に失敗しました: ${inserted.error.message}`);
    }
    summary.schedulesCreated = inserted.data?.length ?? 0;
  }

  revalidatePath(`/clients/${input.client_id}`);
  revalidatePath(`/clients/${input.client_id}/setup`);

  return { error: null, warnings, summary, progress: null };
}
