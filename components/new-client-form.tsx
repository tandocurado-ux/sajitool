"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { createClientWithSetup } from "@/server/clients/actions";
import { initialNewClientState } from "@/server/clients/schema";
import {
  devicesFor,
  platformsFor,
  type DeviceMode,
  type PlatformMode,
} from "@/server/setup/schema";
import { computeSchedulePlan, type SpreadSuggestion } from "@/lib/schedule-plan";
import { FormError } from "./form-error";
import { isRegionDraftFilled, type RegionDraft } from "./region-picker";
import { DeviceModeField } from "./setup/device-mode-field";
import { KeywordListInput } from "./setup/keyword-list-input";
import { PlatformModeField } from "./setup/platform-mode-field";
import { RegionDraftList } from "./setup/region-draft-list";
import { SchedulePreview } from "./setup/schedule-preview";
import {
  ScheduleTimingFields,
  defaultTimingFor,
  describeTiming,
  isTimingReady,
  type TimingValue,
} from "./setup/schedule-timing-fields";
import { cardClass, inputClass, labelClass, primaryButtonClass, subtleButtonClass } from "./ui";

export function NewClientForm() {
  const [state, formAction, pending] = useActionState(
    createClientWithSetup,
    initialNewClientState,
  );

  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [platformMode, setPlatformMode] = useState<PlatformMode>("google");
  const [regionDrafts, setRegionDrafts] = useState<RegionDraft[]>([]);
  // 新規登録の既定は Google なので、時刻は自動分散が既定になる。
  const [timing, setTiming] = useState<TimingValue>(() =>
    defaultTimingFor(platformsFor("google")),
  );
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("pc");

  const platforms = platformsFor(platformMode);
  const devices = devicesFor(deviceMode);
  const filledRegions = regionDrafts.filter(isRegionDraftFilled);

  // 新規顧客なので既存との重複は無い。組み合わせがそのまま作成件数になる。
  const toCreate =
    keywords.length * platforms.length * filledRegions.length * devices.length;

  // 新規顧客は platform ごとの件数が等しい。
  const toCreateByPlatform = useMemo(
    () =>
      Object.fromEntries(
        platforms.map((platform) => [
          platform,
          keywords.length * filledRegions.length * devices.length,
        ]),
      ),
    [platforms, keywords.length, filledRegions.length, devices.length],
  );

  const plan = useMemo(
    () =>
      computeSchedulePlan({
        toCreate,
        toCreateByPlatform,
        timeMode: timing.timeMode,
        times: timing.times,
        spreadStart: timing.spreadStart,
        spreadEnd: timing.spreadEnd,
        rotations: timing.rotations,
        platforms,
      }),
    [toCreate, toCreateByPlatform, timing, platforms],
  );

  const recommendSpread = platforms.includes("google");

  function applySuggestion(suggestion: SpreadSuggestion) {
    setTiming((current) => ({
      ...current,
      timeMode: "spread",
      spreadStart: suggestion.spreadStart,
      spreadEnd: suggestion.spreadEnd,
      rotations: suggestion.rotations,
    }));
  }

  const nameReady = name.trim() !== "";
  const scheduleReady = toCreate === 0 || isTimingReady(timing);
  const canSubmit = nameReady && scheduleReady;

  function updateTiming(patch: Partial<TimingValue>) {
    setTiming((current) => ({ ...current, ...patch }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const lines = [`「${name.trim()}」を登録します。`];

    if (toCreate === 0) {
      lines.push(
        "",
        "キーワードまたは検索地点が未入力のため、顧客だけを作成します。",
        "（登録後に「まとめて登録」から追加できます）",
      );
    } else {
      lines.push(
        `キーワード ${keywords.length} 件 × 検索エンジン ${platforms.length} × 検索地点 ${filledRegions.length} 件 × デバイス ${devices.length}`,
        `= スケジュール ${toCreate} 件`,
        describeTiming(timing),
        `1枠あたり最大 ${plan.perSlot} 件、消化見込み 約 ${Math.round(plan.drainSeconds / 60)} 分`,
        ...plan.platformLoads.map(
          (load) =>
            `${load.platform}: 1枠あたり最大 ${load.perSlot} 件（推奨 ${load.recommended} 件以下）${load.over ? " ⚠ 推奨超過" : ""}`,
        ),
      );
      if (plan.overRecommended) {
        lines.push("", "⚠ 1枠あたりの件数が推奨上限を超えています。自動分散で散らすことを推奨します。");
      }
      if (plan.overCapacity) {
        lines.push(
          "",
          "⚠ 1枠(60分)で消化しきれません。次の枠に食い込み、超過分は実行されません。",
        );
      }
    }
    lines.push("", "よろしいですか？");

    if (!window.confirm(lines.join("\n"))) {
      event.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* 1. 基本情報 */}
      <section className={cardClass}>
        <h2 className="text-sm font-semibold tracking-tight text-fg">1. 基本情報</h2>
        <div className="mt-3">
          <label htmlFor="client-name" className={labelClass}>
            店舗名（必須）
          </label>
          <input
            id="client-name"
            name="name"
            type="text"
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例: 株式会社サンプル 名古屋店"
            className={`${inputClass} max-w-md`}
          />
        </div>
      </section>

      {/* 2. キーワード */}
      <section className={cardClass}>
        <h2 className="text-sm font-semibold tracking-tight text-fg">2. キーワード</h2>
        <p className="mt-1 text-xs text-subtle">
          計測したい検索語を1つずつ追加します。あとから追加もできます。
        </p>

        <div className="mt-3">
          <KeywordListInput keywords={keywords} onChange={setKeywords} />
        </div>

        <div className="mt-4">
          <PlatformModeField
            value={platformMode}
            onChange={setPlatformMode}
            hint="「両方」を選ぶと、1キーワードにつき Google と Yahoo! の2件を登録します。"
          />
        </div>
      </section>

      {/* 3. 検索地点 */}
      <section className={cardClass}>
        <h2 className="text-sm font-semibold tracking-tight text-fg">3. 検索地点</h2>
        <p className="mt-1 text-xs text-subtle">
          都道府県と市区町村を選ぶと、緯度経度と地域名が自動で決まります。
        </p>

        <RegionDraftList
          drafts={regionDrafts}
          onChange={setRegionDrafts}
          addLabel="検索地点を追加"
        />
      </section>

      {/* 4. 検索時間 */}
      <section className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold tracking-tight text-fg">4. 検索時間</h2>

        <ScheduleTimingFields
          value={timing}
          onChange={updateTiming}
          recommendSpread={recommendSpread}
        />

        <div className="mt-4">
          <DeviceModeField value={deviceMode} onChange={setDeviceMode} />
        </div>
      </section>

      {/* 5. 確認して登録 */}
      <section className={cardClass}>
        <h2 className="text-sm font-semibold tracking-tight text-fg">確認して登録</h2>

        {toCreate === 0 ? (
          <p className="mt-2 text-sm text-muted">
            キーワードまたは検索地点が未入力です。このまま登録すると
            <span className="font-semibold text-fg"> 顧客だけ </span>
            を作成します（登録後に「まとめて登録」から追加できます）。
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">
              キーワード {keywords.length} 件 × 検索エンジン {platforms.length} ×
              検索地点 {filledRegions.length} 件 × デバイス {devices.length} ={" "}
              <span className="text-lg font-semibold tracking-tight tabular-nums text-fg">
                {toCreate} 件
              </span>{" "}
              のスケジュールを作成します。
            </p>
            <p className="mt-1 text-sm text-subtle">{describeTiming(timing)}</p>
            <SchedulePreview
              plan={plan}
              toCreate={toCreate}
              onApplySuggestion={applySuggestion}
            />
          </>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending || !canSubmit}
            className={primaryButtonClass}
          >
            {pending ? "登録中…" : "登録する"}
          </button>
          {toCreate > 0 ? (
            <button
              type="submit"
              name="immediate_test"
              value="1"
              disabled={pending || !canSubmit}
              className={subtleButtonClass}
              title="登録後、先頭のキーワード × 検索地点 × デバイスを1件だけ今すぐ実行し、顧客ページで結果を表示します"
            >
              登録して今すぐ1件テスト実行
            </button>
          ) : null}
        </div>

        <FormError message={state.error} />
        {state.progress ? (
          <p className="mt-2 text-sm text-muted">{state.progress}</p>
        ) : null}
        {state.createdClientId ? (
          <p className="mt-2 text-sm">
            顧客は作成されています。
            <Link
              href={`/clients/${state.createdClientId}`}
              className="ml-1 text-accent underline-offset-4 hover:underline"
            >
              顧客ページを開く
            </Link>
          </p>
        ) : null}
        {state.warnings.length > 0 ? (
          <ul className="mt-2 list-disc pl-5 text-sm text-warn">
            {state.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </section>
    </form>
  );
}
