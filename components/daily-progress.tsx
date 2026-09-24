import {
  formatPercent,
  successRateLevel,
  type DailyProgress,
  type RateLevel,
} from "@/lib/runs";
import { RUN_STATUS_LABELS, type RunStatus } from "@/lib/types";

export const RATE_TEXT_CLASSES: Record<RateLevel, string> = {
  good: "text-ok",
  warn: "text-warn",
  bad: "text-danger",
};

/** 「95%」を成功率の水準で色分けして出す。 */
export function SuccessRate({
  rate,
  className = "",
}: {
  rate: number;
  className?: string;
}) {
  return (
    <span
      className={`font-semibold ${RATE_TEXT_CLASSES[successRateLevel(rate)]} ${className}`}
    >
      {formatPercent(rate)}
    </span>
  );
}

/** 「検知 3 / エラー 2」のような、実行済みのうち失敗した分の内訳。 */
export function FailureBreakdown({
  counts,
}: {
  counts: Record<RunStatus, number>;
}) {
  return (
    <span className="text-xs text-subtle">
      <span className={counts.blocked > 0 ? "font-medium text-danger" : undefined}>
        {RUN_STATUS_LABELS.blocked} {counts.blocked}
      </span>
      {" / "}
      <span className={counts.error > 0 ? "font-medium text-warn" : undefined}>
        {RUN_STATUS_LABELS.error} {counts.error}
      </span>
    </span>
  );
}

/**
 * 当日の実行状況を「率」で出す。
 *
 *   成功 96 / 実行 101 件（95%）
 *   検知 3 / エラー 2
 *   予定 320 件中（現在時刻までの予定枠）
 *
 * 実行済みが予定の 8 割に届いていなければ「遅延」として黄色で示す。
 */
export function DailyProgressSummary({ progress }: { progress: DailyProgress }) {
  const { summary, planned, delayed } = progress;

  if (summary.total === 0 && planned === 0) {
    return <span className="text-subtle">-</span>;
  }

  return (
    <span className="flex flex-col gap-0.5">
      {summary.total === 0 ? (
        <span className="text-subtle">実行なし</span>
      ) : (
        <>
          <span className="text-fg">
            成功 {summary.counts.ok} / 実行 {summary.total} 件（
            <SuccessRate rate={summary.successRate} />）
          </span>
          <FailureBreakdown counts={summary.counts} />
        </>
      )}
      <span
        className={`text-xs ${delayed ? "font-medium text-warn" : "text-subtle"}`}
        title="当日のスケジュール枠のうち、現在時刻までに来ているはずの件数"
      >
        予定 {planned} 件中
        {delayed ? `（遅延・消化 ${formatPercent(progress.progressRate)}）` : ""}
      </span>
    </span>
  );
}
