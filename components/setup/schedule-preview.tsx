"use client";

import { SLOT_CAPACITY_SECONDS } from "@/lib/intervals";
import type { SchedulePlan } from "@/lib/schedule-plan";

type Props = {
  plan: SchedulePlan;
  toCreate: number;
  /** 登録済みで今回はスキップされる件数。新規登録では 0。 */
  toSkip?: number;
  /** すでに登録済みのスケジュール数。見込みの但し書きに使う。 */
  existingScheduleCount?: number;
};

/** 作られる件数と、その設定で1枠に収まるかの見込み。 */
export function SchedulePreview({
  plan,
  toCreate,
  toSkip = 0,
  existingScheduleCount = 0,
}: Props) {
  if (plan.slotCount === 0 || toCreate === 0) return null;

  return (
    <div
      className={`mt-3 rounded border px-4 py-3 text-sm ${
        plan.overCapacity
          ? "border-red-300 bg-red-50 text-red-700"
          : "border-neutral-200 bg-neutral-50 text-neutral-700"
      }`}
    >
      <p>
        1日の実行回数 {plan.totalRuns} 回 ／ 1枠あたり最大{" "}
        <span className="font-semibold">{plan.perSlot} 件</span> ／ 消化見込み{" "}
        <span className="font-semibold">
          約 {Math.round(plan.drainSeconds / 60)} 分
        </span>
        （平均間隔 {Math.round(plan.averageInterval)} 秒）
      </p>
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
    </div>
  );
}
