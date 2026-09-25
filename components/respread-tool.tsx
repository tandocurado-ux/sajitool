"use client";

import { useActionState, useState } from "react";
import { applyRespread, previewRespread } from "@/server/schedules/respread";
import {
  initialRespreadState,
  type RespreadPlatformMode,
} from "@/server/schedules/respread-schema";
import { TIME_OPTIONS } from "@/lib/parse";
import { recommendedPerSlot } from "@/lib/intervals";
import { computeDailyCapacity } from "@/lib/schedule-plan";
import { CapacityNotice } from "./setup/capacity-notice";
import { PLATFORM_LABELS, type Platform } from "@/lib/types";
import { FormError } from "./form-error";
import { inputClass, labelClass, primaryButtonClass, subtleButtonClass } from "./ui";

type Props = {
  clientId: string;
  /** この顧客に存在する platform（無いものは選べない）。 */
  platforms: Platform[];
  /** アカウント全体で登録済みの1日の実行回数（platform 別）。 */
  existingRunsByPlatform?: Partial<Record<string, number>>;
};

const MODE_LABELS: Record<RespreadPlatformMode, string> = {
  google: "Google だけ",
  yahoo: "Yahoo! だけ",
  both: "両方",
};

function label(platform: string): string {
  return PLATFORM_LABELS[platform as Platform] ?? platform;
}

/**
 * 登録済みスケジュールの時刻を撒き直す管理ツール。
 * 必ずドライラン（各枠の件数プレビュー）を出してから適用する。
 */
export function RespreadTool({ clientId, platforms, existingRunsByPlatform = {} }: Props) {
  // 撒き直しは件数を変えないので、登録量 vs 消化能力はそのまま出す。
  const dailyCapacity = computeDailyCapacity({}, existingRunsByPlatform);
  const [previewState, previewAction, previewing] = useActionState(
    previewRespread,
    initialRespreadState,
  );
  const [applyState, applyAction, applying] = useActionState(
    applyRespread,
    initialRespreadState,
  );

  const defaultMode: RespreadPlatformMode = platforms.includes("google")
    ? "google"
    : platforms.includes("yahoo")
      ? "yahoo"
      : "both";
  const [mode, setMode] = useState<RespreadPlatformMode>(defaultMode);
  const [maxPerSlot, setMaxPerSlot] = useState<number>(
    recommendedPerSlot(defaultMode === "both" ? "google" : defaultMode),
  );
  const [spreadStart, setSpreadStart] = useState("06:00");
  const [spreadEnd, setSpreadEnd] = useState("23:00");

  // 適用が成功したら、古いプレビューは見せない（データが変わっているため）。
  const [seenApply, setSeenApply] = useState(applyState);
  const [previewHidden, setPreviewHidden] = useState(false);
  if (seenApply !== applyState) {
    setSeenApply(applyState);
    if (applyState.applied) setPreviewHidden(true);
  }
  const [seenPreview, setSeenPreview] = useState(previewState);
  if (seenPreview !== previewState) {
    setSeenPreview(previewState);
    setPreviewHidden(false);
  }

  const preview = previewHidden ? null : previewState.preview;
  const paramFields = (
    <>
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="platform_mode" value={mode} />
      <input type="hidden" name="max_per_slot" value={maxPerSlot} />
      <input type="hidden" name="spread_start" value={spreadStart} />
      <input type="hidden" name="spread_end" value={spreadEnd} />
    </>
  );

  function changeMode(next: RespreadPlatformMode) {
    setMode(next);
    setMaxPerSlot(recommendedPerSlot(next === "both" ? "google" : next));
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-subtle">
        登録済みスケジュールの時刻を、1枠あたりの件数が上限以内になるよう振り直します。
        各スケジュールの1日の実行回数（時刻の数）は変えません。実行履歴（runs）には触れません。
        先にドライランで各枠の件数を確認してから適用してください。
      </p>

      {dailyCapacity.platforms.length > 0 ? <CapacityNotice capacity={dailyCapacity} /> : null}

      <form action={previewAction} className="grid gap-3 sm:grid-cols-4 sm:items-end">
        {paramFields}
        <div>
          <label htmlFor="respread-mode" className={labelClass}>
            対象
          </label>
          <select
            id="respread-mode"
            value={mode}
            onChange={(event) => changeMode(event.target.value as RespreadPlatformMode)}
            className={inputClass}
          >
            {(["google", "yahoo", "both"] as const).map((value) => (
              <option
                key={value}
                value={value}
                disabled={value !== "both" && !platforms.includes(value)}
              >
                {MODE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="respread-max" className={labelClass}>
            1枠あたりの上限（件）
          </label>
          <input
            id="respread-max"
            type="number"
            min={1}
            max={200}
            value={maxPerSlot}
            onChange={(event) => setMaxPerSlot(Number(event.target.value))}
            className={`${inputClass} tabular-nums`}
          />
          <p className="mt-1 text-xs text-subtle">
            推奨: Google {recommendedPerSlot("google")} / Yahoo! {recommendedPerSlot("yahoo")}
          </p>
        </div>
        <div>
          <span className={labelClass}>時間帯（15分刻み）</span>
          <div className="flex items-center gap-1">
            <select
              value={spreadStart}
              onChange={(event) => setSpreadStart(event.target.value)}
              aria-label="開始時刻"
              className={inputClass}
            >
              {TIME_OPTIONS.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
            <span className="text-xs text-subtle">〜</span>
            <select
              value={spreadEnd}
              onChange={(event) => setSpreadEnd(event.target.value)}
              aria-label="終了時刻"
              className={inputClass}
            >
              {TIME_OPTIONS.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <button type="submit" disabled={previewing} className={subtleButtonClass}>
            {previewing ? "計算中…" : "ドライラン（プレビュー）"}
          </button>
        </div>
      </form>
      <FormError message={previewState.error} />

      {applyState.applied ? (
        <p role="status" className="rounded-md border border-ok-line bg-ok-soft px-3 py-2 text-sm text-ok">
          適用しました: {applyState.applied.updated} 件の時刻を更新
          {applyState.applied.unchanged > 0 ? `（${applyState.applied.unchanged} 件は変更なし）` : ""}
          。当日すでに実行済みの枠の記録は変わりません。新しい時刻が本日の残り時間にあたる分は、本日からその時刻に実行されます。
        </p>
      ) : null}
      <FormError message={applyState.error} />

      {preview ? (
        <div className="rounded-md border border-line bg-inset p-4">
          <p className="text-sm font-semibold tracking-tight text-fg">
            ドライラン: {preview.params.platforms.map(label).join(" / ")} を{" "}
            {preview.params.spreadStart}〜{preview.params.spreadEnd} に、1枠あたり{" "}
            {preview.params.maxPerSlot} 件以内で撒き直した場合
          </p>
          <p className="mt-1 text-xs text-muted">
            変更されるスケジュール {preview.changed} 件 ／ 対象 {preview.assignments.length} 件
            {Object.entries(preview.capacity).map(([platform, entry]) => (
              <span key={platform} className="ml-2">
                {label(platform)}: 1日 {entry.demand} 回を {entry.slots} 枠 × {preview.params.maxPerSlot} 件 = 容量 {entry.capacity}
              </span>
            ))}
          </p>

          {preview.insufficient ? (
            <p className="mt-2 text-sm font-semibold text-danger">
              容量が足りないため上限以内に収まりません。時間帯を広げるか、上限を上げてください。
            </p>
          ) : preview.overCap.length > 0 ? (
            <p className="mt-2 text-sm font-semibold text-warn">
              上限を超える枠があります: {preview.overCap.map((entry) => `${entry.slot} ${label(entry.platform)} ${entry.count} 件`).join("、")}
            </p>
          ) : (
            <p className="mt-2 text-sm font-semibold text-ok">
              どの枠も上限以内です（最も混む枠: {Math.max(0, ...preview.after.map((load) => load.total))} 件）。
            </p>
          )}

          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <SlotTable title="撒き直し前" loads={preview.before} max={preview.params.maxPerSlot} />
            <SlotTable title="撒き直し後" loads={preview.after} max={preview.params.maxPerSlot} />
          </div>

          <form
            action={applyAction}
            onSubmit={(event) => {
              if (
                !window.confirm(
                  `${preview.changed} 件のスケジュールの時刻を更新します。よろしいですか？`,
                )
              ) {
                event.preventDefault();
              }
            }}
            className="mt-4 flex flex-wrap items-center gap-3"
          >
            {paramFields}
            <input
              type="hidden"
              name="assignments"
              value={JSON.stringify(
                preview.assignments
                  .filter((assignment) => assignment.changed)
                  .map((assignment) => ({ id: assignment.id, times: assignment.after })),
              )}
            />
            <button
              type="submit"
              disabled={applying || preview.changed === 0}
              className={primaryButtonClass}
            >
              {applying ? "適用中…" : `この内容で適用（${preview.changed} 件）`}
            </button>
            <span className="text-xs text-subtle">
              適用後に本日の残り時間へ移った枠は本日から実行されます。実行済みの記録は変わりません。
            </span>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function SlotTable({
  title,
  loads,
  max,
}: {
  title: string;
  loads: { slot: string; counts: Record<string, number>; total: number }[];
  max: number;
}) {
  const busiest = Math.max(0, ...loads.map((load) => load.total));
  return (
    <div>
      <p className="text-xs font-medium text-muted">
        {title}（{loads.length} 枠・最も混む枠 {busiest} 件）
      </p>
      {loads.length === 0 ? (
        <p className="mt-1 text-xs text-subtle">時刻の入った枠がありません。</p>
      ) : (
        <div className="mt-1 max-h-72 overflow-y-auto rounded-md border border-line bg-surface">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-subtle">
                <th className="px-2 py-1 font-medium">枠</th>
                <th className="px-2 py-1 font-medium">件数</th>
                <th className="px-2 py-1 font-medium">内訳</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loads.map((load) => {
                const over = Object.values(load.counts).some((count) => count > max);
                return (
                  <tr key={load.slot} className={over ? "text-danger" : undefined}>
                    <td className="px-2 py-1 tabular-nums">{load.slot}</td>
                    <td className="px-2 py-1 tabular-nums font-semibold">{load.total}</td>
                    <td className="px-2 py-1 text-muted">
                      {Object.entries(load.counts)
                        .map(([platform, count]) => `${label(platform)} ${count}`)
                        .join(" / ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
