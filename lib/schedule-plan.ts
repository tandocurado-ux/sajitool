import { SLOT_CAPACITY_SECONDS, averageIntervalFor } from "./intervals";
import { timeSlotsBetween } from "./parse";

export type TimeModeValue = "fixed" | "spread";

export type SchedulePlanInput = {
  /** 新規に作られるスケジュール数。 */
  toCreate: number;
  timeMode: TimeModeValue;
  times: string[];
  spreadStart: string;
  spreadEnd: string;
  rotations: number;
  platforms: readonly string[];
};

export type SchedulePlan = {
  /** 自動分散で使う15分枠。fixed のときは空。 */
  spreadSlots: string[];
  /** 時刻が入る枠の数。 */
  slotCount: number;
  /** 1日の実行回数。 */
  totalRuns: number;
  /** 1枠あたりに入る最大件数。 */
  perSlot: number;
  /** 1枠を消化するのにかかる見込み秒数。 */
  drainSeconds: number;
  averageInterval: number;
  /** 1枠（60分）で消化しきれないか。 */
  overCapacity: boolean;
};

/**
 * 登録前に「その設定で回るのか」を見積もる。
 *
 * 間隔の値は計測エンジンの既定に合わせた目安（lib/intervals.ts）。
 */
export function computeSchedulePlan(input: SchedulePlanInput): SchedulePlan {
  const spreadSlots =
    input.timeMode === "spread"
      ? timeSlotsBetween(input.spreadStart, input.spreadEnd)
      : [];

  const slotCount =
    input.timeMode === "fixed" ? input.times.length : spreadSlots.length;
  const totalRuns =
    input.timeMode === "fixed" ? input.toCreate : input.toCreate * input.rotations;

  const averageInterval = averageIntervalFor(input.platforms);
  const perSlot = slotCount > 0 ? Math.ceil(totalRuns / slotCount) : 0;
  const drainSeconds = perSlot * averageInterval;

  return {
    spreadSlots,
    slotCount,
    totalRuns,
    perSlot,
    drainSeconds,
    averageInterval,
    overCapacity: drainSeconds > SLOT_CAPACITY_SECONDS,
  };
}
