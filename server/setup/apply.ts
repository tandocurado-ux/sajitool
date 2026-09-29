import type { SupabaseClient } from "@supabase/supabase-js";
import { assignSpreadTimes } from "@/lib/parse";
import { devicesForPlatform } from "@/lib/device-policy";
import type { BulkSetupInput, BulkSetupSummary } from "./schema";
import { describeQueryError, fetchInChunks } from "@/server/supabase-query";

const SEP = "\u0000";

export type ApplyResult =
  | { ok: true; summary: BulkSetupSummary }
  | { ok: false; error: string; progress: string };

/**
 * 呼び出し元ごとの違い。省略すれば、まとめて登録・新規登録の従来の動作になる。
 */
export type ApplyOptions = {
  /** 実験モード（SAJI_GOOGLE_PC_ENABLED=1）。true のときだけ Google × pc も作る。 */
  googlePc?: boolean;
  /**
   * 自動分散の開始位置。登録済みの件数を渡すと、前回の続きの枠から割り振る。
   * 少数ずつ何度も登録しても、毎回同じ枠（先頭）に固まらない。
   */
  spreadOffset?: number;
  /** 作成するスケジュール数の上限（消化能力）。超えた分は作らずに件数だけ返す。 */
  maxSchedules?: number;
  /**
   * 同じ keyword × platform の行が複数あるとき、この id を対象にする。
   * 「計測を開始」で押した行とは別の行にスケジュールが付くのを防ぐ。
   */
  preferKeywordId?: string;
};

function emptySummary(): BulkSetupSummary {
  return {
    keywordsCreated: 0,
    keywordsSkipped: 0,
    regionsCreated: 0,
    schedulesCreated: 0,
    schedulesSkipped: 0,
    schedulesCreatedByPlatform: {},
    schedulesOmitted: 0,
  };
}

function describeProgress(summary: BulkSetupSummary): string {
  return [
    `キーワード ${summary.keywordsCreated} 件`,
    `地域 ${summary.regionsCreated} 件`,
    `スケジュール ${summary.schedulesCreated} 件`,
  ].join(" / ");
}

/**
 * キーワード・地域・スケジュールを作る本体。
 *
 * まとめて登録（既存顧客への追加）、新規顧客登録、キーワード単位の計測開始
 * （server/setup/start.ts）から呼ぶ。
 * 重複判定（同じ keyword × platform、同じ keyword × region × device）は
 * ここにしかない。認証と所有権の確認は呼び出し側の責任。
 *
 * キーワードか地域が空でも落ちない（その場合はスケジュールを作らない）。
 */
export async function applyBulkSetup(
  supabase: SupabaseClient,
  input: BulkSetupInput,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const summary = emptySummary();
  const fail = (message: string): ApplyResult => ({
    ok: false,
    error: message,
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
    const key = keywordKey(row.keyword, row.platform);
    // 指定された行があれば、同じ keyword × platform の別の行で上書きしない。
    if (options.preferKeywordId && keywordIdByKey.get(key) === options.preferKeywordId) continue;
    keywordIdByKey.set(key, String(row.id));
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
    // id は IN_CHUNK_SIZE 件ずつに分けて投げる（地域が何百件でも URL 長で落ちない）。
    try {
      const owned = await fetchInChunks(input.regionIds, async (ids) => {
        const { data, error } = await supabase
          .from("regions")
          .select("id")
          .eq("client_id", input.client_id)
          .in("id", ids);
        if (error) throw new Error(describeQueryError(error));
        return data ?? [];
      });
      regionIds = owned.map((row) => String(row.id));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      console.error(`[supabase] 地域の確認に失敗しました: ${message}`);
      return fail(`地域の確認に失敗しました: ${message}`);
    }
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

  // 顧客だけ、あるいはキーワードだけの登録もあるので、
  // 足りないときはスケジュールを作らずに終える。
  if (regionIds.length === 0 || input.keywords.length === 0) {
    return { ok: true, summary };
  }

  // --- スケジュール（同じ keyword × region × device は作らない）---
  const keywordIds = [...keywordIdByKey.values()];
  // keyword_id は IN_CHUNK_SIZE 件ずつに分けて投げる（キーワードが数千件でも URL 長で落ちない）。
  let existingSchedules: { keyword_id: string; region_id: string; device: string }[];
  try {
    existingSchedules = await fetchInChunks(keywordIds, async (ids) => {
      const { data, error } = await supabase
        .from("schedules")
        .select("keyword_id, region_id, device")
        .in("keyword_id", ids);
      if (error) throw new Error(describeQueryError(error));
      return (data ?? []) as { keyword_id: string; region_id: string; device: string }[];
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    console.error(`[supabase] スケジュールの確認に失敗しました: ${message}`);
    return fail(`スケジュールの確認に失敗しました: ${message}`);
  }
  const scheduleKey = (keywordId: string, regionId: string, device: string) =>
    `${keywordId}${SEP}${regionId}${SEP}${device}`;
  const existingScheduleKeys = new Set(
    existingSchedules.map((row) =>
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
  const rowPlatforms: string[] = [];

  // 自動分散のときは、作る順に15分枠へ均等に割り振る。
  // 枠数と互いに素な歩幅で飛ばすので、同じキーワードの数パターンが
  // 隣り合う枠に固まらない。回転数ぶんの時刻を1スケジュールに入れる。
  const spreadSlots = input.timeMode === "spread" ? input.spreadSlots : null;
  let assigned = Math.max(0, Math.trunc(options.spreadOffset ?? 0));
  const maxSchedules =
    options.maxSchedules === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.trunc(options.maxSchedules));

  for (const keyword of input.keywords) {
    for (const platform of input.platforms) {
      const keywordId = keywordIdByKey.get(keywordKey(keyword, platform));
      if (!keywordId) continue;
      // Google は mobile のみ（pc は実験モードのときだけ）。Yahoo! は選んだデバイス全部。
      const devices = devicesForPlatform(platform, input.devices, {
        googlePc: options.googlePc,
      });
      for (const regionId of regionIds) {
        for (const device of devices) {
          if (existingScheduleKeys.has(scheduleKey(keywordId, regionId, device))) {
            summary.schedulesSkipped += 1;
            continue;
          }
          if (scheduleRows.length >= maxSchedules) {
            summary.schedulesOmitted += 1;
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
          rowPlatforms.push(platform);
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
    for (const platform of rowPlatforms) {
      summary.schedulesCreatedByPlatform[platform] =
        (summary.schedulesCreatedByPlatform[platform] ?? 0) + 1;
    }
  }

  return { ok: true, summary };
}
