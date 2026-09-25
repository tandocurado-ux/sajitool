import {
  SLOT_CAPACITY_SECONDS,
  averageIntervalFor,
  recommendedPerSlot,
} from "./intervals";
import { TIME_OPTIONS, timeSlotsBetween } from "./parse";

export type TimeModeValue = "fixed" | "spread";

export type SchedulePlanInput = {
  /** 新規に作られるスケジュール数。 */
  toCreate: number;
  /**
   * platform ごとの新規作成数。無ければ toCreate を platforms で等分する
   * （まとめて登録では既存スキップの偏りがあるので、分かるなら渡す）。
   */
  toCreateByPlatform?: Partial<Record<string, number>>;
  timeMode: TimeModeValue;
  times: string[];
  spreadStart: string;
  spreadEnd: string;
  rotations: number;
  platforms: readonly string[];
};

/** platform ごとの「1枠にどれだけ入るか」。 */
export type PlatformSlotLoad = {
  platform: string;
  /** その platform のスケジュール数（新規作成分）。 */
  schedules: number;
  /** 1日の実行回数。 */
  runsPerDay: number;
  /** 1枠あたりに入る最大件数。 */
  perSlot: number;
  /** 推奨上限（lib/intervals.ts）。 */
  recommended: number;
  /** 推奨上限を超えているか。 */
  over: boolean;
};

/** 推奨上限に収めるための「時間帯に自動分散」の提案。 */
export type SpreadSuggestion = {
  spreadStart: string;
  spreadEnd: string;
  rotations: number;
  slotCount: number;
  /** 提案どおりにしたときの platform ごとの1枠あたり件数。 */
  perSlotAfter: Record<string, number>;
  /** 全日（00:00〜23:45・1日1回）に広げても推奨上限に収まらない。 */
  insufficient: boolean;
};

export type SchedulePlan = {
  /** 自動分散で使う15分枠。fixed のときは空。 */
  spreadSlots: string[];
  /** 時刻が入る枠の数。 */
  slotCount: number;
  /** 1日の実行回数（全 platform 合計）。 */
  totalRuns: number;
  /** 1枠あたりに入る最大件数（全 platform 合計）。 */
  perSlot: number;
  /** 1枠を消化するのにかかる見込み秒数。 */
  drainSeconds: number;
  averageInterval: number;
  /** 1枠（60分）で消化しきれないか。 */
  overCapacity: boolean;
  /** platform ごとの1枠あたり件数と推奨上限。 */
  platformLoads: PlatformSlotLoad[];
  /** いずれかの platform が推奨上限を超えているか。 */
  overRecommended: boolean;
  /** 推奨上限を超えているときの分散提案。超えていなければ null。 */
  suggestion: SpreadSuggestion | null;
};

const FULL_DAY_SLOTS = TIME_OPTIONS.length; // 96
const MAX_ROTATIONS = 3;

function countsByPlatform(input: SchedulePlanInput): Record<string, number> {
  const counts: Record<string, number> = {};
  const fallback =
    input.platforms.length > 0 ? Math.ceil(input.toCreate / input.platforms.length) : 0;
  for (const platform of input.platforms) {
    const given = input.toCreateByPlatform?.[platform];
    counts[platform] = given === undefined ? fallback : given;
  }
  return counts;
}

/**
 * 登録前に「その設定で回るのか」を見積もる。
 *
 * 間隔の値は計測エンジンの既定に合わせた目安（lib/intervals.ts）。
 *
 * 全件同じ時刻（fixed）は、選んだ時刻それぞれに全スケジュールが入るので、
 * 1枠あたりの件数 = スケジュール数、1日の実行回数 = スケジュール数 × 時刻数。
 * 自動分散（spread）は、スケジュール数 × 回転数 を枠数で割った値が1枠あたりの件数。
 */
export function computeSchedulePlan(input: SchedulePlanInput): SchedulePlan {
  const spreadSlots =
    input.timeMode === "spread"
      ? timeSlotsBetween(input.spreadStart, input.spreadEnd)
      : [];

  const slotCount =
    input.timeMode === "fixed" ? input.times.length : spreadSlots.length;
  const counts = countsByPlatform(input);
  const rotations = input.timeMode === "fixed" ? Math.max(1, input.times.length) : input.rotations;

  const platformLoads: PlatformSlotLoad[] = input.platforms.map((platform) => {
    const schedules = counts[platform] ?? 0;
    const runsPerDay = schedules * rotations;
    const perSlot =
      input.timeMode === "fixed"
        ? schedules
        : slotCount > 0
          ? Math.ceil(runsPerDay / slotCount)
          : 0;
    const recommended = recommendedPerSlot(platform);
    return {
      platform,
      schedules,
      runsPerDay,
      perSlot,
      recommended,
      over: perSlot > recommended,
    };
  });

  const totalRuns = platformLoads.reduce((sum, load) => sum + load.runsPerDay, 0);
  const perSlot =
    input.timeMode === "fixed"
      ? input.toCreate
      : slotCount > 0
        ? Math.ceil(totalRuns / slotCount)
        : 0;

  const averageInterval = averageIntervalFor(input.platforms);
  const drainSeconds = perSlot * averageInterval;
  const overRecommended = platformLoads.some((load) => load.over);

  return {
    spreadSlots,
    slotCount,
    totalRuns,
    perSlot,
    drainSeconds,
    averageInterval,
    overCapacity: drainSeconds > SLOT_CAPACITY_SECONDS,
    platformLoads,
    overRecommended,
    suggestion: overRecommended ? suggestSpread(input, counts) : null,
  };
}

/**
 * 推奨上限に収まる最小の「時間帯 × 回転数」を提案する。
 *
 * 回転数は今の設定（fixed なら時刻数、上限3）から下げていき、
 * 必要な枠数が1日（96枠）に収まる組み合わせを探す。時間帯は今の開始時刻を
 * なるべく保ち、足りなければ前に広げる。全日・1回でも収まらなければ
 * insufficient=true で返す（登録を分ける必要がある）。
 */
export function suggestSpread(
  input: SchedulePlanInput,
  counts: Record<string, number> = countsByPlatform(input),
): SpreadSuggestion {
  const wanted =
    input.timeMode === "fixed"
      ? Math.min(MAX_ROTATIONS, Math.max(1, input.times.length))
      : Math.max(1, input.rotations);
  const startIndex = Math.max(0, TIME_OPTIONS.indexOf(input.spreadStart || "06:00"));

  function neededSlots(rotations: number): number {
    let needed = 1;
    for (const platform of input.platforms) {
      const runs = (counts[platform] ?? 0) * rotations;
      needed = Math.max(needed, Math.ceil(runs / recommendedPerSlot(platform)));
    }
    return needed;
  }

  function build(rotations: number, slotCount: number, insufficient: boolean): SpreadSuggestion {
    const from = Math.max(0, Math.min(startIndex, FULL_DAY_SLOTS - slotCount));
    const to = Math.min(FULL_DAY_SLOTS - 1, from + slotCount - 1);
    const perSlotAfter: Record<string, number> = {};
    for (const platform of input.platforms) {
      perSlotAfter[platform] = Math.ceil(((counts[platform] ?? 0) * rotations) / (to - from + 1));
    }
    return {
      spreadStart: TIME_OPTIONS[from],
      spreadEnd: TIME_OPTIONS[to],
      rotations,
      slotCount: to - from + 1,
      perSlotAfter,
      insufficient,
    };
  }

  for (let rotations = wanted; rotations >= 1; rotations -= 1) {
    const needed = neededSlots(rotations);
    if (needed <= FULL_DAY_SLOTS) return build(rotations, needed, false);
  }
  return build(1, FULL_DAY_SLOTS, true);
}
