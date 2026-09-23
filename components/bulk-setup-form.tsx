"use client";

import { useActionState, useMemo, useState } from "react";
import { bulkCreateSchedules } from "@/server/setup/actions";
import {
  DEVICE_MODES,
  DEVICE_MODE_LABELS,
  PLATFORM_MODES,
  PLATFORM_MODE_LABELS,
  TIME_MODES,
  TIME_MODE_LABELS,
  devicesFor,
  initialBulkSetupState,
  platformsFor,
  type DeviceMode,
  type PlatformMode,
  type TimeMode,
} from "@/server/setup/schema";
import { TIME_OPTIONS, parseKeywordLines, timeSlotsBetween } from "@/lib/parse";
import type { Keyword, Region } from "@/lib/types";
import { FormError } from "./form-error";
import {
  RegionPicker,
  emptyRegionDraft,
  isRegionDraftFilled,
  regionDraftLabel,
  type RegionDraft,
} from "./region-picker";
import { TimePicker } from "./time-picker";
import {
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  subtleButtonClass,
} from "./ui";

type Props = {
  clientId: string;
  regions: Region[];
  existingKeywords: Pick<Keyword, "id" | "keyword" | "platform">[];
  /** `keywordId|regionId|device` の一覧。既存スケジュールの判定に使う。 */
  existingScheduleKeys: string[];
};

const SEP = "\u0000";

export function BulkSetupForm({
  clientId,
  regions,
  existingKeywords,
  existingScheduleKeys,
}: Props) {
  const [state, formAction, pending] = useActionState(
    bulkCreateSchedules,
    initialBulkSetupState,
  );

  const [keywordsText, setKeywordsText] = useState("");
  const [platformMode, setPlatformMode] = useState<PlatformMode>("google");
  const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>([]);
  const [newRegions, setNewRegions] = useState<RegionDraft[]>([]);
  const [timeMode, setTimeMode] = useState<TimeMode>("fixed");
  const [times, setTimes] = useState<string[]>(["09:00"]);
  const [spreadStart, setSpreadStart] = useState("06:00");
  const [spreadEnd, setSpreadEnd] = useState("22:00");
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("pc");

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

  const keywords = useMemo(() => parseKeywordLines(keywordsText), [keywordsText]);
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

  const spreadSlots = useMemo(
    () => timeSlotsBetween(spreadStart, spreadEnd),
    [spreadStart, spreadEnd],
  );
  // 1枠あたり何件になるか。偏りの目安として出す。
  const perSlot =
    spreadSlots.length > 0 ? Math.ceil(toCreate / spreadSlots.length) : 0;

  const timesReady = timeMode === "fixed" ? times.length > 0 : spreadSlots.length > 0;

  const regionCount = selectedRegionIds.length + filledNewRegions.length;
  const canSubmit =
    keywords.length > 0 && regionCount > 0 && timesReady && toCreate > 0;

  function updateDraft(key: string, patch: Partial<RegionDraft>) {
    setNewRegions((drafts) =>
      drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)),
    );
  }

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
      timeMode === "fixed"
        ? `時刻: ${times.join(", ")}（全件同じ）`
        : `時刻: ${spreadStart}〜${spreadEnd} の ${spreadSlots.length} 枠に分散（1枠あたり最大 ${perSlot} 件）`,
    ];
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
      <input
        type="hidden"
        name="new_regions"
        value={JSON.stringify(
          filledNewRegions.map(({ prefecture, city, label }) => ({
            prefecture,
            city,
            label,
          })),
        )}
      />

      {/* 1. キーワード */}
      <section className={cardClass}>
        <h2 className="text-sm font-semibold text-neutral-900">1. キーワード</h2>
        <p className="mt-1 text-xs text-neutral-500">
          1行に1キーワード。まとめて貼り付けできます。
        </p>

        <textarea
          name="keywords"
          rows={8}
          value={keywordsText}
          onChange={(event) => setKeywordsText(event.target.value)}
          placeholder={"不用品回収 名古屋\n不用品回収 名古屋市中区\n粗大ごみ 回収 愛知"}
          className={`${inputClass} mt-3 font-mono`}
        />
        <p className="mt-1 text-xs text-neutral-500">
          {keywords.length} 件のキーワードを認識しました。
        </p>

        <fieldset className="mt-4">
          <legend className={labelClass}>検索エンジン</legend>
          <div className="flex flex-wrap gap-4">
            {PLATFORM_MODES.map((mode) => (
              <label key={mode} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="platform_mode"
                  value={mode}
                  checked={platformMode === mode}
                  onChange={() => setPlatformMode(mode)}
                />
                {PLATFORM_MODE_LABELS[mode]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            「両方」を選ぶと、1キーワードにつき Google と Yahoo! の2件を登録します。
            登録済みのキーワードはスキップされます。
          </p>
        </fieldset>
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
            <p className="mt-1 text-xs text-neutral-500">
              登録済みの地域から選べます（複数可）。
            </p>
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

        {newRegions.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-4">
            {newRegions.map((draft) => (
              <li
                key={draft.key}
                className="rounded border border-dashed border-neutral-300 p-3"
              >
                <RegionPicker
                  draft={draft}
                  onChange={(patch) => updateDraft(draft.key, patch)}
                  idPrefix={`new-region-${draft.key}`}
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-neutral-500">
                    {isRegionDraftFilled(draft)
                      ? `登録名: ${regionDraftLabel(draft)}`
                      : "都道府県と市区町村を選んでください。"}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setNewRegions((drafts) =>
                        drafts.filter((item) => item.key !== draft.key),
                      )
                    }
                    className={subtleButtonClass}
                  >
                    この行を削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4">
          <button
            type="button"
            onClick={() => setNewRegions((drafts) => [...drafts, emptyRegionDraft()])}
            className={subtleButtonClass}
          >
            + 地域を追加
          </button>
        </div>
      </section>

      {/* 3. スケジュール設定 */}
      <section className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">
          3. スケジュール設定
        </h2>

        <fieldset>
          <legend className={labelClass}>時刻の決め方</legend>
          <div className="flex flex-wrap gap-4">
            {TIME_MODES.map((mode) => (
              <label key={mode} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="time_mode"
                  value={mode}
                  checked={timeMode === mode}
                  onChange={() => setTimeMode(mode)}
                />
                {TIME_MODE_LABELS[mode]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-4">
          {timeMode === "fixed" ? (
            <>
              <TimePicker name="times" times={times} onChange={setTimes} />
              <p className="mt-1 text-xs text-neutral-500">
                作成するスケジュールすべてに同じ時刻が入ります。件数が多いと
                同じ時刻に集中して、計測が後ろにずれ込みます。
              </p>
            </>
          ) : (
            <>
              <span className={labelClass}>分散する時間帯（15分刻み）</span>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  name="spread_start"
                  value={spreadStart}
                  onChange={(event) => setSpreadStart(event.target.value)}
                  aria-label="開始時刻"
                  className={`${inputClass} w-32`}
                >
                  {TIME_OPTIONS.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
                <span className="text-sm text-neutral-500">〜</span>
                <select
                  name="spread_end"
                  value={spreadEnd}
                  onChange={(event) => setSpreadEnd(event.target.value)}
                  aria-label="終了時刻"
                  className={`${inputClass} w-32`}
                >
                  {TIME_OPTIONS.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </div>
              {spreadSlots.length === 0 ? (
                <p className="mt-1 text-sm text-red-600">
                  終了時刻は開始時刻と同じか、それより後にしてください。
                </p>
              ) : (
                <p className="mt-1 text-xs text-neutral-500">
                  {spreadSlots.length} 枠（{spreadSlots[0]} 〜{" "}
                  {spreadSlots[spreadSlots.length - 1]}）に均等に割り振ります。
                  {toCreate > 0 ? ` 1枠あたり最大 ${perSlot} 件。` : ""}
                </p>
              )}
            </>
          )}
        </div>

        <fieldset className="mt-4">
          <legend className={labelClass}>デバイス</legend>
          <div className="flex flex-wrap gap-4">
            {DEVICE_MODES.map((mode) => (
              <label key={mode} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="device_mode"
                  value={mode}
                  checked={deviceMode === mode}
                  onChange={() => setDeviceMode(mode)}
                />
                {DEVICE_MODE_LABELS[mode]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            「両方」を選ぶと PC とモバイルで2件ずつ作成します。
          </p>
        </fieldset>
      </section>

      {/* 4. 確認と登録 */}
      <section className={cardClass}>
        <h2 className="text-sm font-semibold text-neutral-900">4. 確認して登録</h2>

        <p className="mt-2 text-sm text-neutral-700">
          キーワード {keywords.length} 件 × 検索エンジン {platforms.length} × 地域{" "}
          {regionCount} 件 × デバイス {devices.length} ={" "}
          <span className="text-lg font-semibold text-neutral-900">
            {toCreate} 件
          </span>{" "}
          のスケジュールを作成します。
        </p>
        {toSkip > 0 ? (
          <p className="mt-1 text-sm text-neutral-500">
            うち {toSkip} 件は既に登録済みのためスキップします。
          </p>
        ) : null}
        <p className="mt-1 text-sm text-neutral-500">
          {timeMode === "fixed"
            ? `時刻: ${times.join(", ") || "未設定"}（全件同じ）`
            : `時刻: ${spreadStart}〜${spreadEnd} の ${spreadSlots.length} 枠に分散`}
        </p>

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
