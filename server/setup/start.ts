import type { SupabaseClient } from "@supabase/supabase-js";
import { allowedDevicesFor } from "@/lib/device-policy";
import { TIME_OPTIONS, timeSlotsBetween } from "@/lib/parse";
import { computeSchedulePlan, maxAddableSchedules } from "@/lib/schedule-plan";
import { DEVICE_LABELS, PLATFORM_LABELS, type Platform } from "@/lib/types";
import { devicePolicyOptions } from "@/server/device-policy";
import { getDailyRunsByPlatform } from "@/server/schedules/capacity";
import { applyBulkSetup } from "./apply";
import {
  AUTO_ROTATIONS,
  AUTO_SPREAD_END,
  AUTO_SPREAD_START,
  initialStartMeasurementState,
  type StartMeasurementState,
  type TimingSettings,
} from "./schema";

export type StartMeasurementRequest = {
  clientId: string;
  keyword: string;
  platform: Platform;
  /** 登録済みのキーワード行を対象にするとき（詳細画面の「計測を開始」）。 */
  keywordId?: string;
  /**
   * 時刻設定。null なら自動（時間帯に自動分散・1日1回。1枠あたりの推奨上限を
   * 超えるときは時間帯を広げる）。
   */
  timing: TimingSettings | null;
  /** true なら、1日の消化能力に収まる件数までしか作らない（自動作成用）。 */
  capToCapacity: boolean;
};

function describeWindow(timing: TimingSettings): string {
  if (timing.timeMode === "fixed") return `${timing.times.join(", ")}（全件同じ時刻）`;
  const slots = timing.spreadSlots;
  return `${slots[0]}〜${slots[slots.length - 1]} に自動分散・1日 ${timing.rotations} 回`;
}

/**
 * 1つのキーワードについて「その顧客の登録済み地域 × 許可デバイス」のスケジュールを作る。
 *
 * 詳細画面の「計測を開始」と、キーワード登録時の自動スケジュール化の両方から呼ぶ。
 * 作成そのもの（キーワードの重複スキップ・スケジュールの重複スキップ・時刻の分散）は
 * applyBulkSetup、消化能力の判定は lib/schedule-plan.ts に任せ、ここでは
 * 対象の決定と結果の文言だけを扱う。認証と所有権の確認は呼び出し側の責任。
 */
export async function startMeasurement(
  supabase: SupabaseClient,
  request: StartMeasurementRequest,
): Promise<StartMeasurementState> {
  const base: StartMeasurementState = {
    ...initialStartMeasurementState,
    platform: request.platform,
  };
  const platformLabel = PLATFORM_LABELS[request.platform] ?? request.platform;

  const regions = await supabase
    .from("regions")
    .select("id")
    .eq("client_id", request.clientId)
    .order("created_at", { ascending: true });
  if (regions.error) {
    return { ...base, error: `地域の確認に失敗しました: ${regions.error.message}` };
  }
  const regionIds = (regions.data ?? []).map((row) => String(row.id));

  const policy = devicePolicyOptions();
  // Google は mobile（実験モードのときは pc も）。Yahoo! は pc / mobile。
  const devices = [...allowedDevicesFor(request.platform, policy)];
  const deviceLabel = devices.map((device) => DEVICE_LABELS[device] ?? device).join("・");

  const existingRuns = regionIds.length > 0 ? await getDailyRunsByPlatform() : {};
  const wanted = regionIds.length * devices.length;
  const warnings: string[] = [];

  // --- 時刻と作成数の上限 ---
  let timing: TimingSettings = request.timing ?? {
    timeMode: "spread",
    times: [],
    spreadSlots: timeSlotsBetween(AUTO_SPREAD_START, AUTO_SPREAD_END),
    rotations: AUTO_ROTATIONS,
  };
  const perSchedule = timing.timeMode === "fixed" ? timing.times.length : timing.rotations;
  const maxSchedules = request.capToCapacity
    ? maxAddableSchedules(request.platform, wanted, perSchedule, existingRuns)
    : undefined;
  const planned = Math.min(wanted, maxSchedules ?? wanted);

  if (planned > 0) {
    const plan = computeSchedulePlan({
      toCreate: planned,
      toCreateByPlatform: { [request.platform]: planned },
      timeMode: timing.timeMode,
      times: timing.times,
      spreadStart: timing.spreadSlots[0] ?? AUTO_SPREAD_START,
      spreadEnd: timing.spreadSlots[timing.spreadSlots.length - 1] ?? AUTO_SPREAD_END,
      rotations: timing.rotations,
      platforms: [request.platform],
      existingRunsByPlatform: existingRuns,
    });

    if (plan.overRecommended && plan.suggestion) {
      if (!request.timing) {
        // 自動のときは、推奨上限に収まるところまで時間帯を広げる。
        const suggestion = plan.suggestion;
        timing = {
          timeMode: "spread",
          times: [],
          spreadSlots: suggestion.insufficient
            ? [...TIME_OPTIONS]
            : timeSlotsBetween(suggestion.spreadStart, suggestion.spreadEnd),
          rotations: suggestion.rotations,
        };
        warnings.push(
          suggestion.insufficient
            ? `${platformLabel} は1枠あたりの推奨上限を超えるため、00:00〜23:45 の全日に分散しました（それでも推奨を超えています）。`
            : `${platformLabel} は1枠あたりの推奨上限を超えるため、時間帯を ${suggestion.spreadStart}〜${suggestion.spreadEnd} に広げて分散しました。`,
        );
      } else {
        warnings.push(
          `${platformLabel} の1枠あたりの件数が推奨上限を超えています。「スケジュール」タブの再分散で散らせます。`,
        );
      }
    }
    if (!request.capToCapacity && plan.dailyCapacity.over) {
      warnings.push(
        "登録件数が1日の消化能力を超えています。超過分は消化されずスキップされます。",
      );
    }
  }

  const result = await applyBulkSetup(
    supabase,
    {
      client_id: request.clientId,
      keywords: [request.keyword],
      platforms: [request.platform],
      regionIds,
      newRegions: [],
      timeMode: timing.timeMode,
      times: timing.times,
      spreadSlots: timing.spreadSlots,
      rotations: timing.rotations,
      devices,
    },
    {
      googlePc: policy.googlePc,
      // 登録済みの続きの枠から割り振る（毎回先頭の枠に固まらないように）。
      spreadOffset: existingRuns[request.platform] ?? 0,
      maxSchedules,
      preferKeywordId: request.keywordId,
    },
  );
  if (!result.ok) {
    return { ...base, error: `${result.error}（${result.progress}）` };
  }

  const summary = result.summary;
  const keywordPart = summary.keywordsCreated > 0 ? "キーワードを登録しました。" : "";

  if (regionIds.length === 0) {
    return {
      ...base,
      summary,
      notice: `${keywordPart}地域が未登録のため、スケジュールは作成していません。先に地域を登録してください。`,
    };
  }

  if (summary.schedulesOmitted > 0) {
    const total = summary.schedulesCreated + summary.schedulesOmitted;
    warnings.push(
      (summary.schedulesCreated > 0
        ? `1日の消化能力を超えるため、${total} 件のうち ${summary.schedulesCreated} 件だけ作成しました。`
        : `${platformLabel} の登録数が1日の消化能力に達しているため、${total} 件のスケジュールは作成していません。`) +
        `残り ${summary.schedulesOmitted} 件は、登録数を見直してからキーワード一覧の「計測を開始」で追加してください。`,
    );
  }

  let notice: string;
  if (summary.schedulesCreated > 0) {
    notice =
      `${keywordPart}${platformLabel} のスケジュールを ${summary.schedulesCreated} 件作成しました` +
      `（地域 ${regionIds.length} 件 × ${deviceLabel}、${describeWindow(timing)}）。`;
  } else if (summary.schedulesOmitted > 0) {
    notice = `${keywordPart}スケジュールは作成していません。`;
  } else {
    notice = `${keywordPart}作成できるスケジュールはありませんでした（${summary.schedulesSkipped} 件は登録済み）。`;
  }

  return { ...base, summary, notice, warnings };
}
