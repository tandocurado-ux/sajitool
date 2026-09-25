"use client";

import { SLOT_CAPACITY_SECONDS } from "@/lib/intervals";
import type { SchedulePlan, SpreadSuggestion } from "@/lib/schedule-plan";
import { PLATFORM_LABELS, type Platform } from "@/lib/types";
import { subtleButtonClass } from "../ui";
import { CapacityNotice } from "./capacity-notice";

type Props = {
  plan: SchedulePlan;
  toCreate: number;
  /** 登録済みで今回はスキップされる件数。新規登録では 0。 */
  toSkip?: number;
  /** すでに登録済みのスケジュール数。見込みの但し書きに使う。 */
  existingScheduleCount?: number;
  /** 「推奨まで自動分散する」を押したときに時刻設定へ反映する。 */
  onApplySuggestion?: (suggestion: SpreadSuggestion) => void;
};

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform as Platform] ?? platform;
}

/** 作られる件数と、その設定で1枠に収まるかの見込み。platform ごとの推奨上限も見る。 */
export function SchedulePreview({
  plan,
  toCreate,
  toSkip = 0,
  existingScheduleCount = 0,
  onApplySuggestion,
}: Props) {
  if (plan.slotCount === 0 || toCreate === 0) return null;

  const tone = plan.overCapacity || plan.dailyCapacity.over
    ? "border-danger-line bg-danger-soft text-danger"
    : plan.overRecommended
      ? "border-warn-line bg-warn-soft text-warn"
      : "border-line bg-inset text-muted";

  return (
    <div className={`mt-3 rounded-md border px-4 py-3 text-sm ${tone}`}>
      <p>
        1日の実行回数 <span className="tabular-nums">{plan.totalRuns}</span> 回 ／
        1枠あたり最大 <span className="font-semibold tabular-nums">{plan.perSlot} 件</span> ／
        消化見込み{" "}
        <span className="font-semibold tabular-nums">
          約 {Math.round(plan.drainSeconds / 60)} 分
        </span>
        （平均間隔 {Math.round(plan.averageInterval)} 秒）
      </p>

      {/* platform ごとの1枠あたり件数。推奨上限を超えたものは強調する。 */}
      <ul className="mt-2 flex flex-col gap-0.5 text-xs">
        {plan.platformLoads.map((load) => (
          <li key={load.platform} className={load.over ? "font-semibold" : undefined}>
            {platformLabel(load.platform)}: 1枠あたり最大{" "}
            <span className="tabular-nums">{load.perSlot} 件</span>
            （推奨 {load.recommended} 件以下・1日{" "}
            <span className="tabular-nums">{load.runsPerDay}</span> 回）
            {load.over ? " ← 推奨を超えています" : ""}
          </li>
        ))}
      </ul>

      {plan.overRecommended && plan.suggestion ? (
        <div className="mt-2 text-xs">
          <p className="font-semibold">
            1枠あたりの件数が推奨上限を超えています。Google は1枠に集中すると
            ボット検知とキュー溢れ（消化できずスキップ）の原因になります。
          </p>
          {plan.suggestion.insufficient ? (
            <p className="mt-1">
              00:00〜23:45 の全日に分散して1日1回にしても推奨上限を超えます。
              キーワードや地域を分けて、別の登録に分割してください。
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {onApplySuggestion ? (
                <button
                  type="button"
                  onClick={() => onApplySuggestion(plan.suggestion!)}
                  className={subtleButtonClass}
                >
                  推奨まで自動分散する
                </button>
              ) : null}
              <span>
                {plan.suggestion.spreadStart}〜{plan.suggestion.spreadEnd} の{" "}
                {plan.suggestion.slotCount} 枠に分散 ／ 1日 {plan.suggestion.rotations} 回 →{" "}
                {Object.entries(plan.suggestion.perSlotAfter)
                  .map(([platform, count]) => `${platformLabel(platform)} ${count} 件/枠`)
                  .join("、")}
              </span>
            </div>
          )}
        </div>
      ) : null}

      {existingScheduleCount > 0 ? (
        <p className="mt-1 text-xs">
          ※ ここに出しているのは今回作る分だけです。登録済みの{" "}
          {existingScheduleCount} 件はそれぞれの時刻で別に実行されます。
        </p>
      ) : null}
      {toSkip > 0 ? (
        <p className="mt-1 text-xs">
          ※ {toSkip} 件は登録済みのため今回は作られません。
        </p>
      ) : null}
      {plan.overCapacity ? (
        <p className="mt-1 font-semibold">
          1枠（{SLOT_CAPACITY_SECONDS / 60} 分）で消化しきれません。
          時間帯を広げるか回転数を減らすか、キーワード・地域を絞ってください。
          このままだと超過分は実行されません。
        </p>
      ) : null}

      <CapacityNotice capacity={plan.dailyCapacity} />
    </div>
  );
}
