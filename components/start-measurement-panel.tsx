"use client";

import { useActionState, useMemo, useState } from "react";
import { startKeywordMeasurement } from "@/server/setup/actions";
import { initialStartMeasurementState } from "@/server/setup/schema";
import { computeSchedulePlan, type SpreadSuggestion } from "@/lib/schedule-plan";
import { DEVICE_LABELS, PLATFORM_LABELS, type Device, type Platform } from "@/lib/types";
import { FormError } from "./form-error";
import { MeasurementResult } from "./measurement-result";
import { SchedulePreview } from "./setup/schedule-preview";
import {
  DEFAULT_TIMING,
  ScheduleTimingFields,
  describeTiming,
  isTimingReady,
  type TimingValue,
} from "./setup/schedule-timing-fields";
import { primaryButtonClass, subtleButtonClass } from "./ui";

type Props = {
  keywordId: string;
  keyword: string;
  platform: Platform;
  /** この顧客の登録済み地域の数。 */
  regionCount: number;
  /** この platform で作ってよいデバイス（Google は pc、Yahoo! は pc / mobile）。 */
  devices: readonly Device[];
  /** 新規に作られる件数（登録済みの組み合わせを除く）。 */
  toCreate: number;
  /** 登録済みのためスキップされる件数。 */
  toSkip: number;
  /** アカウント全体で登録済みの1日の実行回数（platform 別）。 */
  existingRunsByPlatform: Partial<Record<string, number>>;
  onClose: () => void;
};

/**
 * 「このキーワードで計測を開始」の確認パネル。
 * 時刻の決め方を選び、件数と消化見込みを見てから作成する（既定は時間帯に自動分散）。
 */
export function StartMeasurementPanel({
  keywordId,
  keyword,
  platform,
  regionCount,
  devices,
  toCreate,
  toSkip,
  existingRunsByPlatform,
  onClose,
}: Props) {
  const [state, formAction, pending] = useActionState(
    startKeywordMeasurement,
    initialStartMeasurementState,
  );
  const [timing, setTiming] = useState<TimingValue>({ ...DEFAULT_TIMING, timeMode: "spread" });

  const plan = useMemo(
    () =>
      computeSchedulePlan({
        toCreate,
        toCreateByPlatform: { [platform]: toCreate },
        timeMode: timing.timeMode,
        times: timing.times,
        spreadStart: timing.spreadStart,
        spreadEnd: timing.spreadEnd,
        rotations: timing.rotations,
        platforms: [platform],
        existingRunsByPlatform,
      }),
    [toCreate, platform, timing, existingRunsByPlatform],
  );

  function applySuggestion(suggestion: SpreadSuggestion) {
    setTiming((current) => ({
      ...current,
      timeMode: "spread",
      spreadStart: suggestion.spreadStart,
      spreadEnd: suggestion.spreadEnd,
      rotations: suggestion.rotations,
    }));
  }

  const deviceLabel = devices.map((device) => DEVICE_LABELS[device] ?? device).join("・");
  const canSubmit = toCreate > 0 && isTimingReady(timing);
  const finished = state.summary !== null && !state.error;

  return (
    <form
      action={formAction}
      className="mt-3 rounded-md border border-line-strong bg-inset px-4 py-4"
    >
      <input type="hidden" name="keyword_id" value={keywordId} />

      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-semibold tracking-tight text-fg">
          「{keyword}」（{PLATFORM_LABELS[platform] ?? platform}）の計測を開始
        </p>
        <button type="button" onClick={onClose} className={subtleButtonClass}>
          閉じる
        </button>
      </div>

      {finished ? null : (
        <>
          <p className="mt-2 text-sm text-muted">
            登録済みの地域 {regionCount} 件 × デバイス {devices.length}（{deviceLabel}）のうち、
            <span className="font-semibold tabular-nums text-fg"> 新規に作られるのは {toCreate} 件</span>
            {toSkip > 0 ? `（${toSkip} 件は登録済みのためスキップ）` : ""}
          </p>

          <div className="mt-4">
            <ScheduleTimingFields
              value={timing}
              onChange={(patch) => setTiming((current) => ({ ...current, ...patch }))}
              recommendSpread
            />
          </div>

          <p className="mt-3 text-sm text-subtle">{describeTiming(timing)}</p>
          <SchedulePreview
            plan={plan}
            toCreate={toCreate}
            toSkip={toSkip}
            onApplySuggestion={applySuggestion}
          />

          <div className="mt-4">
            <button
              type="submit"
              disabled={pending || !canSubmit}
              className={primaryButtonClass}
            >
              {pending ? "作成中…" : `${toCreate} 件のスケジュールを作成して計測を開始`}
            </button>
          </div>
        </>
      )}

      <FormError message={state.error} />
      <MeasurementResult state={state} />
    </form>
  );
}
