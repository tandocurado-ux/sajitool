"use client";

import { useActionState, useMemo, useState } from "react";
import { bulkCreateSchedules } from "@/server/setup/actions";
import {
  DEVICE_MODE_LABELS,
  PLATFORM_MODE_LABELS,
  devicesFor,
  initialBulkSetupState,
  platformsFor,
  type DeviceMode,
  type PlatformMode,
  type PreviousSettings,
} from "@/server/setup/schema";
import { parseKeywordLines } from "@/lib/parse";
import { computeSchedulePlan } from "@/lib/schedule-plan";
import type { Keyword, Region } from "@/lib/types";
import { FormError } from "./form-error";
import { isRegionDraftFilled, type RegionDraft } from "./region-picker";
import { DeviceModeField } from "./setup/device-mode-field";
import { PlatformModeField } from "./setup/platform-mode-field";
import { RegionDraftList } from "./setup/region-draft-list";
import { SchedulePreview } from "./setup/schedule-preview";
import {
  ScheduleTimingFields,
  describeTiming,
  isTimingReady,
  type TimingValue,
} from "./setup/schedule-timing-fields";
import { cardClass, inputClass, primaryButtonClass, subtleButtonClass } from "./ui";

type Props = {
  clientId: string;
  regions: Region[];
  existingKeywords: Pick<Keyword, "id" | "keyword" | "platform">[];
  /** `keywordId|regionId|device` の一覧。既存スケジュールの判定に使う。 */
  existingScheduleKeys: string[];
  /** 登録済みキーワードごとのスケジュール数と使われている時刻。 */
  scheduleCountByKeyword: { keyword: string; count: number; times: string[] }[];
  /** 既存スケジュールから推定した前回の設定。無ければ null。 */
  previousSettings: PreviousSettings | null;
};

const SEP = "\u0000";

/** 推定した前回設定をフォームの時刻設定に変換する。 */
function timingFrom(previous: PreviousSettings | null): TimingValue {
  return {
    timeMode: previous?.timeMode ?? "fixed",
    times:
      previous?.timeMode === "fixed" && previous.times.length > 0
        ? previous.times
        : ["09:00"],
    spreadStart: previous?.spreadStart ?? "06:00",
    spreadEnd: previous?.spreadEnd ?? "23:00",
    rotations: previous?.rotations ?? 1,
  };
}

export function BulkSetupForm({
  clientId,
  regions,
  existingKeywords,
  existingScheduleKeys,
  scheduleCountByKeyword,
  previousSettings,
}: Props) {
  const [state, formAction, pending] = useActionState(
    bulkCreateSchedules,
    initialBulkSetupState,
  );

  // 登録済みのキーワードは最初から選択済み。差分だけ足せばよい状態にする。
  const knownKeywords = useMemo(() => {
    const seen = new Map<string, { keyword: string; count: number; times: string[] }>();
    for (const entry of scheduleCountByKeyword) {
      const current = seen.get(entry.keyword);
      if (current) {
        current.count += entry.count;
        current.times = [...new Set([...current.times, ...entry.times])].sort();
      } else {
        seen.set(entry.keyword, { ...entry, times: [...entry.times] });
      }
    }
    return [...seen.values()].sort((a, b) => a.keyword.localeCompare(b.keyword, "ja"));
  }, [scheduleCountByKeyword]);

  const [keywordsText, setKeywordsText] = useState("");
  const [selectedExistingKeywords, setSelectedExistingKeywords] = useState<string[]>(
    () => knownKeywords.map((entry) => entry.keyword),
  );
  const [platformMode, setPlatformMode] = useState<PlatformMode>(
    previousSettings?.platformMode ?? "google",
  );
  const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>(() =>
    regions.map((region) => region.id),
  );
  const [newRegions, setNewRegions] = useState<RegionDraft[]>([]);
  const [timing, setTiming] = useState<TimingValue>(() => timingFrom(previousSettings));
  const [deviceMode, setDeviceMode] = useState<DeviceMode>(
    previousSettings?.deviceMode ?? "pc",
  );

  function updateTiming(patch: Partial<TimingValue>) {
    setTiming((current) => ({ ...current, ...patch }));
  }

  function applyPreviousSettings() {
    if (!previousSettings) return;
    setPlatformMode(previousSettings.platformMode);
    setDeviceMode(previousSettings.deviceMode);
    setTiming(timingFrom(previousSettings));
  }

  const keywordIdByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const keyword of existingKeywords) {
      map.set(`${keyword.keyword}${SEP}${keyword.platform}`, keyword.id);
    }
    return map;
  }, [existingKeywords]);

  const scheduleKeySet = useMemo(
    () => new Set(existingScheduleKeys),
    [existingScheduleKeys],
  );

  // 「登録済みのうち選んだもの」＋「新しく入力したもの」が対象。
  const newKeywords = useMemo(() => parseKeywordLines(keywordsText), [keywordsText]);
  const keywords = useMemo(
    () => parseKeywordLines([...selectedExistingKeywords, ...newKeywords].join("\n")),
    [selectedExistingKeywords, newKeywords],
  );
  const platforms = platformsFor(platformMode);
  const devices = devicesFor(deviceMode);
  const filledNewRegions = newRegions.filter(isRegionDraftFilled);

  /** 実際に作られる件数と、既存のためスキップされる件数を数える。 */
  const { toCreate, toSkip } = useMemo(() => {
    let create = 0;
    let skip = 0;
    for (const keyword of keywords) {
      for (const platform of platforms) {
        const keywordId = keywordIdByKey.get(`${keyword}${SEP}${platform}`);
        for (const regionId of selectedRegionIds) {
          for (const device of devices) {
            const known =
              keywordId !== undefined &&
              scheduleKeySet.has(`${keywordId}|${regionId}|${device}`);
            if (known) skip += 1;
            else create += 1;
          }
        }
        // 新規地域はまだ存在しないので必ず新規作成になる。
        create += filledNewRegions.length * devices.length;
      }
    }
    return { toCreate: create, toSkip: skip };
  }, [
    keywords,
    platforms,
    devices,
    selectedRegionIds,
    filledNewRegions.length,
    keywordIdByKey,
    scheduleKeySet,
  ]);

  // 1枠あたり何件になるか、その枠を消化しきれるかの目安。
  const plan = useMemo(
    () =>
      computeSchedulePlan({
        toCreate,
        timeMode: timing.timeMode,
        times: timing.times,
        spreadStart: timing.spreadStart,
        spreadEnd: timing.spreadEnd,
        rotations: timing.rotations,
        platforms,
      }),
    [toCreate, timing, platforms],
  );

  const regionCount = selectedRegionIds.length + filledNewRegions.length;
  const canSubmit =
    keywords.length > 0 && regionCount > 0 && isTimingReady(timing) && toCreate > 0;

  function toggleRegion(regionId: string) {
    setSelectedRegionIds((ids) =>
      ids.includes(regionId)
        ? ids.filter((id) => id !== regionId)
        : [...ids, regionId],
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const lines = [
      `この内容で ${toCreate} 件のスケジュールを作成します。`,
      `キーワード ${keywords.length} 件 × 検索エンジン ${platforms.length} × 地域 ${regionCount} 件 × デバイス ${devices.length}`,
      describeTiming(timing),
      `1枠あたり最大 ${plan.perSlot} 件、消化見込み 約 ${Math.round(plan.drainSeconds / 60)} 分`,
    ];
    if (plan.overCapacity) {
      lines.push("", "⚠ 1枠(60分)で消化しきれません。次の枠に食い込み、超過分は実行されません。");
    }
    if (toSkip > 0) lines.push(`（既に登録済みの ${toSkip} 件はスキップします）`);
    lines.push("", "よろしいですか？");

    if (!window.confirm(lines.join("\n"))) {
      event.preventDefault();
    }
  }

  const summary = state.summary;

  return (
    <form action={formAction} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="keywords" value={keywords.join("\n")} />

      {previousSettings ? (
        <section className="rounded-lg border border-neutral-300 bg-neutral-50 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-neutral-900">
                前回と同じ設定を使う
              </p>
              <p className="mt-1 text-xs text-neutral-600">
                登録済みの {previousSettings.scheduleCount} 件のスケジュールから推定:{" "}
                {PLATFORM_MODE_LABELS[previousSettings.platformMode]} ／{" "}
                {DEVICE_MODE_LABELS[previousSettings.deviceMode]} ／{" "}
                {previousSettings.timeMode === "fixed"
                  ? `${previousSettings.times.join(", ")}（全件同じ）`
                  : `${previousSettings.spreadStart}〜${previousSettings.spreadEnd} に分散 / 1日 ${previousSettings.rotations} 回`}
              </p>
            </div>
            <button
              type="button"
              onClick={applyPreviousSettings}
              className={subtleButtonClass}
            >
              この設定を適用
            </button>
          </div>
        </section>
      ) : null}

      {/* 1. キーワード */}
      <section className={cardClass}>
        <h2 className="text-sm font-semibold text-neutral-900">1. キーワード</h2>

        {knownKeywords.length > 0 ? (
          <div className="mt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-neutral-500">
                登録済み {knownKeywords.length} 件（選択中 {selectedExistingKeywords.length} 件）
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedExistingKeywords(knownKeywords.map((e) => e.keyword))
                  }
                  className="text-xs text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline"
                >
                  すべて選択
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedExistingKeywords([])}
                  className="text-xs text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline"
                >
                  すべて解除
                </button>
              </div>
            </div>
            <ul className="mt-2 grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
              {knownKeywords.map((entry) => (
                <li key={entry.keyword}>
                  <label className="flex items-start gap-2 rounded border border-neutral-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedExistingKeywords.includes(entry.keyword)}
                      onChange={() =>
                        setSelectedExistingKeywords((current) =>
                          current.includes(entry.keyword)
                            ? current.filter((value) => value !== entry.keyword)
                            : [...current, entry.keyword],
                        )
                      }
                      className="mt-1"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-neutral-900">
                        {entry.keyword}
                      </span>
                      <span className="block text-xs text-neutral-500">
                        スケジュール {entry.count} 件
                        {entry.times.length > 0 ? ` ・ ${entry.times.join(" / ")}` : ""}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="mt-4 text-xs text-neutral-500">
          新しく追加するキーワード（1行に1つ。まとめて貼り付けできます）
        </p>

        <textarea
          rows={8}
          value={keywordsText}
          onChange={(event) => setKeywordsText(event.target.value)}
          placeholder={"不用品回収 名古屋\n不用品回収 名古屋市中区\n粗大ごみ 回収 愛知"}
          className={`${inputClass} mt-3 font-mono`}
        />
        <p className="mt-1 text-xs text-neutral-500">
          対象は {keywords.length} 件
          {knownKeywords.length > 0
            ? `（登録済み ${selectedExistingKeywords.length} 件 + 新規 ${newKeywords.filter((k) => !selectedExistingKeywords.includes(k)).length} 件）`
            : ""}
          。
        </p>

        <div className="mt-4">
          <PlatformModeField
            value={platformMode}
            onChange={setPlatformMode}
            hint="「両方」を選ぶと、1キーワードにつき Google と Yahoo! の2件を登録します。登録済みのキーワードはスキップされます。"
          />
        </div>
      </section>

      {/* 2. 地域 */}
      <section className={cardClass}>
        <h2 className="text-sm font-semibold text-neutral-900">2. 地域</h2>

        {regions.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">
            登録済みの地域はまだありません。下の「+ 地域を追加」から選んでください。
          </p>
        ) : (
          <>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-neutral-500">
                登録済み {regions.length} 件（選択中 {selectedRegionIds.length} 件）。
                既存のキーワードとの組み合わせで足りないぶんだけ作られます。
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedRegionIds(regions.map((r) => r.id))}
                  className="text-xs text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline"
                >
                  すべて選択
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRegionIds([])}
                  className="text-xs text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline"
                >
                  すべて解除
                </button>
              </div>
            </div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {regions.map((region) => (
                <li key={region.id}>
                  <label className="flex items-start gap-2 rounded border border-neutral-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      name="region_ids"
                      value={region.id}
                      checked={selectedRegionIds.includes(region.id)}
                      onChange={() => toggleRegion(region.id)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-neutral-900">{region.label}</span>
                      <span className="block text-xs text-neutral-500">
                        {[region.prefecture, region.city].filter(Boolean).join(" ") ||
                          "所在地未設定"}
                        {region.lat !== null && region.lng !== null
                          ? ` / ${region.lat}, ${region.lng}`
                          : ""}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        <RegionDraftList drafts={newRegions} onChange={setNewRegions} />
      </section>

      {/* 3. スケジュール設定 */}
      <section className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">
          3. スケジュール設定
        </h2>

        <ScheduleTimingFields value={timing} onChange={updateTiming} />

        <div className="mt-4">
          <DeviceModeField value={deviceMode} onChange={setDeviceMode} />
        </div>
      </section>

      {/* 4. 確認と登録 */}
      <section className={cardClass}>
        <h2 className="text-sm font-semibold text-neutral-900">4. 確認して登録</h2>

        <p className="mt-2 text-sm text-neutral-700">
          キーワード {keywords.length} 件 × 検索エンジン {platforms.length} × 地域{" "}
          {regionCount} 件 × デバイス {devices.length} = 全 {toCreate + toSkip} 件の組み合わせ
        </p>
        <p className="mt-1 text-sm text-neutral-700">
          このうち<span className="text-lg font-semibold text-neutral-900">
            {" "}新規に作られるのは {toCreate} 件
          </span>
          {toSkip > 0 ? `（${toSkip} 件は登録済みのためスキップ）` : ""}
        </p>
        <p className="mt-1 text-sm text-neutral-500">{describeTiming(timing)}</p>

        <SchedulePreview
          plan={plan}
          toCreate={toCreate}
          toSkip={toSkip}
          existingScheduleCount={existingScheduleKeys.length}
        />

        <div className="mt-4">
          <button
            type="submit"
            disabled={pending || !canSubmit}
            className={primaryButtonClass}
          >
            {pending ? "登録中…" : `${toCreate} 件のスケジュールを作成`}
          </button>
        </div>

        <FormError message={state.error} />
        {state.progress ? (
          <p className="mt-2 text-sm text-neutral-700">{state.progress}</p>
        ) : null}

        {state.warnings.length > 0 ? (
          <ul className="mt-2 list-disc pl-5 text-sm text-amber-700">
            {state.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}

        {summary ? (
          <div className="mt-3 rounded border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            <p className="font-semibold">登録しました。</p>
            <ul className="mt-1 list-disc pl-5">
              <li>
                キーワード: {summary.keywordsCreated} 件作成
                {summary.keywordsSkipped > 0
                  ? ` / ${summary.keywordsSkipped} 件は登録済み`
                  : ""}
              </li>
              <li>地域: {summary.regionsCreated} 件作成</li>
              <li>
                スケジュール: {summary.schedulesCreated} 件作成
                {summary.schedulesSkipped > 0
                  ? ` / ${summary.schedulesSkipped} 件は登録済み`
                  : ""}
              </li>
            </ul>
          </div>
        ) : null}
      </section>
    </form>
  );
}
