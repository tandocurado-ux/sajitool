import { RUN_STATUSES, type Run, type RunStatus } from "./types";

/** blocked 率がこれを超えたら警告バナーを出す。 */
export const BLOCKED_RATE_THRESHOLD = 0.2;

export type RunSummary = {
  total: number;
  counts: Record<RunStatus, number>;
  blockedRate: number;
  successRate: number;
};

export function summarizeRuns(runs: Run[]): RunSummary {
  const counts: Record<RunStatus, number> = { ok: 0, blocked: 0, error: 0 };
  for (const run of runs) {
    if (RUN_STATUSES.includes(run.status)) counts[run.status] += 1;
  }
  const total = runs.length;
  return {
    total,
    counts,
    blockedRate: total === 0 ? 0 : counts.blocked / total,
    successRate: total === 0 ? 0 : counts.ok / total,
  };
}

export function formatRate(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
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
