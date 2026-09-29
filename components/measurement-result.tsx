import type { StartMeasurementState } from "@/server/setup/schema";
import { PLATFORM_LABELS, type Platform } from "@/lib/types";

/**
 * 「計測を開始」とキーワード登録の結果。
 * 何が何件作られたか（platform 別）と、消化能力などの注意を出す。
 */
export function MeasurementResult({ state }: { state: StartMeasurementState }) {
  if (state.error || (!state.notice && state.warnings.length === 0)) return null;

  const created = Object.entries(state.summary?.schedulesCreatedByPlatform ?? {});
  const skipped = state.summary?.schedulesSkipped ?? 0;

  return (
    <div className="mt-3 flex flex-col gap-2">
      {state.notice ? (
        <div
          role="status"
          className="rounded-md border border-ok-line bg-ok-soft px-4 py-3 text-sm text-ok"
        >
          <p className="font-semibold">{state.notice}</p>
          {created.length > 0 || skipped > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {created.map(([platform, count]) => (
                <li key={platform}>
                  {PLATFORM_LABELS[platform as Platform] ?? platform}: スケジュール{" "}
                  <span className="tabular-nums">{count}</span> 件作成
                </li>
              ))}
              {skipped > 0 ? (
                <li>
                  <span className="tabular-nums">{skipped}</span> 件は登録済みのためスキップ
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      {state.warnings.length > 0 ? (
        <ul className="list-disc rounded-md border border-warn-line bg-warn-soft py-3 pl-8 pr-4 text-xs font-medium text-warn">
          {state.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
