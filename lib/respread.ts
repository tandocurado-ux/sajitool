import { TIME_OPTIONS, spreadStride, timeSlotsBetween } from "./parse";

/**
 * 登録済みスケジュールの時刻を「1枠あたり N 件以内」に撒き直す純粋ロジック。
 *
 * - 各スケジュールの1日の実行回数（times の数）は変えない。時刻だけ振り直す
 * - 時間帯（start〜end の15分枠）の中で、同じキーワードの複数パターンが
 *   隣り合わないよう互いに素な歩幅で基準枠を決め、枠の空きを見て詰める
 * - runs には触らない（適用は schedules.times の UPDATE だけ）
 */

export type RespreadSchedule = {
  id: string;
  platform: string;
  keyword: string;
  regionLabel: string;
  device: string;
  enabled: boolean;
  /** "HH:MM" の配列（Postgres の time は呼び出し側で HH:MM に詰めておく）。 */
  times: string[];
};

export type RespreadOptions = {
  /** 対象 platform（"google" / "yahoo"）。両方なら2つ。上限は platform ごとに適用。 */
  platforms: string[];
  /** 1枠あたりの上限件数。 */
  maxPerSlot: number;
  spreadStart: string;
  spreadEnd: string;
  /** 決定的に並べ替えるためのシード（日付など）。 */
  seed: string;
};

export type SlotLoad = {
  slot: string;
  /** platform → 件数。 */
  counts: Record<string, number>;
  total: number;
};

export type RespreadAssignment = {
  id: string;
  platform: string;
  keyword: string;
  regionLabel: string;
  device: string;
  before: string[];
  after: string[];
  changed: boolean;
};

export type RespreadResult = {
  assignments: RespreadAssignment[];
  /** 撒き直し前の枠ごとの件数（対象 platform のみ）。 */
  before: SlotLoad[];
  /** 撒き直し後の枠ごとの件数（対象 platform のみ）。 */
  after: SlotLoad[];
  /** 変更されるスケジュール数。 */
  changed: number;
  /** 撒き直し後に上限を超える枠（platform 別）。空なら全枠が上限以内。 */
  overCap: { slot: string; platform: string; count: number }[];
  /** platform ごとの需要（実行回数）と容量（枠数 × 上限）。 */
  capacity: Record<string, { demand: number; capacity: number; slots: number }>;
  /** 容量不足で上限以内に収められない platform がある。 */
  insufficient: boolean;
};

/** 枠ごとの件数を数える（times は HH:MM）。 */
export function slotHistogram(
  schedules: readonly RespreadSchedule[],
  platforms: readonly string[],
): SlotLoad[] {
  const loads = new Map<string, SlotLoad>();
  for (const schedule of schedules) {
    if (!platforms.includes(schedule.platform)) continue;
    for (const time of schedule.times) {
      const load = loads.get(time) ?? { slot: time, counts: {}, total: 0 };
      load.counts[schedule.platform] = (load.counts[schedule.platform] ?? 0) + 1;
      load.total += 1;
      loads.set(time, load);
    }
  }
  return [...loads.values()].sort((a, b) => (a.slot < b.slot ? -1 : 1));
}

/** 文字列から決定的な乱数を作る（シャッフル用）。 */
function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (const char of seed) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], seed: string): T[] {
  const random = seededRandom(seed);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function sameTimes(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

/**
 * 1つの platform ぶんを撒き直す。
 *
 * 基準枠は互いに素な歩幅で決め（登録時の自動分散と同じ考え方）、
 * 回転数ぶんは「枠数 ÷ 回転数」ずつ離す。基準の枠が上限に達していれば、
 * 前方に向かって空いている枠を探す。全枠が埋まっていれば最も空いている枠に入れる
 * （その場合は overCap として報告する）。
 */
function respreadPlatform(
  targets: readonly RespreadSchedule[],
  slots: readonly string[],
  maxPerSlot: number,
  seed: string,
): Map<string, string[]> {
  const load = new Map<string, number>(slots.map((slot) => [slot, 0]));
  const result = new Map<string, string[]>();
  const stride = spreadStride(slots.length);

  // 同じキーワードの pc / mobile / 地域違いが隣り合わないよう、シャッフルしてから
  // 歩幅で散らす。キーワード順に並べてからのシャッフルなので決定的。
  const ordered = shuffled(
    [...targets].sort((a, b) => a.keyword.localeCompare(b.keyword, "ja") || a.id.localeCompare(b.id)),
    seed,
  );

  function pick(ideal: number, taken: Set<string>): string {
    // ideal から前方に探して、上限未満かつ未使用の枠を返す。
    for (let offset = 0; offset < slots.length; offset += 1) {
      const slot = slots[(ideal + offset) % slots.length];
      if (taken.has(slot)) continue;
      if ((load.get(slot) ?? 0) < maxPerSlot) return slot;
    }
    // 全枠が上限に達している: 最も空いている未使用の枠。
    let best: string | null = null;
    for (let offset = 0; offset < slots.length; offset += 1) {
      const slot = slots[(ideal + offset) % slots.length];
      if (taken.has(slot)) continue;
      if (best === null || (load.get(slot) ?? 0) < (load.get(best) ?? 0)) best = slot;
    }
    return best ?? slots[ideal % slots.length];
  }

  ordered.forEach((schedule, index) => {
    const rotations = Math.max(1, Math.min(schedule.times.length, slots.length));
    const base = (index * stride) % slots.length;
    const step = Math.max(1, Math.floor(slots.length / rotations));
    const taken = new Set<string>();
    const times: string[] = [];
    for (let turn = 0; turn < rotations; turn += 1) {
      const slot = pick((base + turn * step) % slots.length, taken);
      taken.add(slot);
      times.push(slot);
      load.set(slot, (load.get(slot) ?? 0) + 1);
    }
    result.set(schedule.id, times.sort());
  });

  return result;
}

export function respreadSchedules(
  schedules: readonly RespreadSchedule[],
  options: RespreadOptions,
): RespreadResult {
  const slots = timeSlotsBetween(options.spreadStart, options.spreadEnd);
  if (slots.length === 0) {
    throw new Error("終了時刻は開始時刻と同じか、それより後にしてください。");
  }
  const maxPerSlot = Math.max(1, Math.floor(options.maxPerSlot));

  const newTimes = new Map<string, string[]>();
  const capacity: RespreadResult["capacity"] = {};
  for (const platform of options.platforms) {
    const targets = schedules.filter((schedule) => schedule.platform === platform);
    const demand = targets.reduce(
      (sum, schedule) => sum + Math.max(1, Math.min(schedule.times.length, slots.length)),
      0,
    );
    capacity[platform] = { demand, capacity: slots.length * maxPerSlot, slots: slots.length };
    for (const [id, times] of respreadPlatform(targets, slots, maxPerSlot, `${options.seed}|${platform}`)) {
      newTimes.set(id, times);
    }
  }

  const assignments: RespreadAssignment[] = schedules
    .filter((schedule) => options.platforms.includes(schedule.platform))
    .map((schedule) => {
      const after = newTimes.get(schedule.id) ?? schedule.times;
      return {
        id: schedule.id,
        platform: schedule.platform,
        keyword: schedule.keyword,
        regionLabel: schedule.regionLabel,
        device: schedule.device,
        before: schedule.times,
        after,
        changed: !sameTimes(schedule.times, after),
      };
    });

  const afterSchedules: RespreadSchedule[] = schedules.map((schedule) => ({
    ...schedule,
    times: newTimes.get(schedule.id) ?? schedule.times,
  }));
  const after = slotHistogram(afterSchedules, options.platforms);
  const overCap: RespreadResult["overCap"] = [];
  for (const load of after) {
    for (const [platform, count] of Object.entries(load.counts)) {
      if (count > maxPerSlot) overCap.push({ slot: load.slot, platform, count });
    }
  }

  return {
    assignments,
    before: slotHistogram(schedules, options.platforms),
    after,
    changed: assignments.filter((assignment) => assignment.changed).length,
    overCap,
    capacity,
    insufficient: Object.values(capacity).some((entry) => entry.demand > entry.capacity),
  };
}

/** 撒き直し後の割り当てを HH:MM の妥当性まで含めて検証する（適用前のガード）。 */
export function isValidSlot(value: string): boolean {
  return TIME_OPTIONS.includes(value);
}
