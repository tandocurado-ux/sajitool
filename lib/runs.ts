import { formatTime } from "./parse";
import {
  RUN_STATUSES,
  type Run,
  type RunStatus,
  type Schedule,
} from "./types";

/** blocked 率がこれを超えたら警告バナーを出す。 */
export const BLOCKED_RATE_THRESHOLD = 0.2;

/** 成功率（ok ÷ 実行済み）がこれ以上なら緑。 */
export const SUCCESS_RATE_GOOD = 0.95;
/** 成功率がこれ以上（かつ GOOD 未満）なら黄。未満は赤。 */
export const SUCCESS_RATE_WARN = 0.8;
/** 当日の予定枠に対する消化率がこれを下回ると「遅延」として黄色で示す。 */
export const PROGRESS_RATE_THRESHOLD = 0.8;

export type RateLevel = "good" | "warn" | "bad";

export function successRateLevel(rate: number): RateLevel {
  if (rate >= SUCCESS_RATE_GOOD) return "good";
  if (rate >= SUCCESS_RATE_WARN) return "warn";
  return "bad";
}

export type RunSummary = {
  total: number;
  counts: Record<RunStatus, number>;
  blockedRate: number;
  successRate: number;
};

export function emptyRunCounts(): Record<RunStatus, number> {
  return { ok: 0, blocked: 0, error: 0 };
}

/** すでに数え上げた内訳から率を出す。ループ中に件数だけ積む場所向け。 */
export function summaryFromCounts(counts: Record<RunStatus, number>): RunSummary {
  const total = counts.ok + counts.blocked + counts.error;
  return {
    total,
    counts,
    blockedRate: total === 0 ? 0 : counts.blocked / total,
    successRate: total === 0 ? 0 : counts.ok / total,
  };
}

export function summarizeRuns(runs: Run[]): RunSummary {
  const counts = emptyRunCounts();
  for (const run of runs) {
    if (RUN_STATUSES.includes(run.status)) counts[run.status] += 1;
  }
  return summaryFromCounts(counts);
}

export function formatRate(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

/** 「95%」のように整数で丸めた表記。一覧のセルなど桁を抑えたい場所向け。 */
export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// --------------------------------------------------------------------------
// 当日の進捗（予定枠ベース）
// --------------------------------------------------------------------------

export type DailyProgress = {
  /** 当日（JST）に実行済みの run の内訳。 */
  summary: RunSummary;
  /** 当日のスケジュール枠のうち、現在時刻までに来ているはずの件数。 */
  planned: number;
  /** 実行済み ÷ 予定。予定が 0 のときは 1。 */
  progressRate: number;
  /** 消化率がしきい値を下回っている（予定より実行が少ない）。 */
  delayed: boolean;
};

export function buildDailyProgress(
  summary: RunSummary,
  planned: number,
): DailyProgress {
  const progressRate = planned === 0 ? 1 : summary.total / planned;
  return {
    summary,
    planned,
    progressRate,
    delayed: planned > 0 && progressRate < PROGRESS_RATE_THRESHOLD,
  };
}

type PlannedScheduleFields = Pick<Schedule, "times" | "enabled" | "created_at">;

/**
 * そのスケジュールの枠のうち、現在時刻（JST）までに来ているはずの件数。
 *
 * 計測エンジンは enabled=true のスケジュールだけを毎分読み直して、
 * times（JST）が現在の分と一致したものを実行する。なので
 *   - 無効なスケジュールは予定に数えない
 *   - 当日作られたスケジュールは、作成時刻より前の枠は今日は走らないので除く
 * とすると、登録直後に「遅延」に見えてしまうのを避けられる。
 */
export function countDueSlots(
  schedule: PlannedScheduleFields,
  now: Date,
): number {
  if (!schedule.enabled) return 0;
  const nowKey = jstTimeKey(now);
  const createdAt = parseRunAt(schedule.created_at);
  const createdToday =
    !Number.isNaN(createdAt.getTime()) &&
    jstDateKey(createdAt) === jstDateKey(now);
  const floorKey = createdToday ? jstTimeKey(createdAt) : "";

  let due = 0;
  for (const raw of schedule.times ?? []) {
    const time = formatTime(raw);
    if (time <= nowKey && time >= floorKey) due += 1;
  }
  return due;
}

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const HAS_TIMEZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * run_at を Date に直す。
 *
 * 列が timestamptz なら "+00:00" 付きで返るが、timestamp だとオフセットが
 * 付かず、そのまま new Date() に渡すとローカル時刻として解釈されて9時間ずれる。
 * 計測エンジンは UTC で書き込むので、オフセットが無い場合は UTC とみなす。
 */
export function parseRunAt(value: string): Date {
  const normalized = HAS_TIMEZONE.test(value)
    ? value
    : `${value.replace(" ", "T")}Z`;
  return new Date(normalized);
}

/** run_at は UTC で入るので JST に直して表示する。 */
export function formatRunAt(value: string): string {
  const parsed = parseRunAt(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return dateTimeFormatter.format(parsed);
}

export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

export function isSince(run: Run, since: Date): boolean {
  const parsed = parseRunAt(run.run_at);
  return !Number.isNaN(parsed.getTime()) && parsed >= since;
}

const shortFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** マトリクスのセルなど、幅が取れない場所向けの短い表記。 */
export function formatRunAtShort(value: string): string {
  const parsed = parseRunAt(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return shortFormatter.format(parsed);
}

const dateKeyFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeKeyFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** JST での「HH:MM」。schedules.times（JST）との比較に使う。 */
export function jstTimeKey(value: string | Date): string {
  const parsed = typeof value === "string" ? parseRunAt(value) : value;
  if (Number.isNaN(parsed.getTime())) return "";
  return timeKeyFormatter.format(parsed);
}

/** JST での「YYYY-MM-DD」。当日判定に使う。 */
export function jstDateKey(value: string | Date): string {
  const parsed = typeof value === "string" ? parseRunAt(value) : value;
  if (Number.isNaN(parsed.getTime())) return "";
  return dateKeyFormatter.format(parsed);
}
