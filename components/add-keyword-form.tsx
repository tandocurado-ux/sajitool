"use client";

import { useActionState, useEffect, useRef } from "react";
import { addKeyword } from "@/server/keywords/actions";
import { initialStartMeasurementState } from "@/server/setup/schema";
import { allowedDevicesFor } from "@/lib/device-policy";
import { DEVICE_LABELS, PLATFORM_LABELS, type Platform } from "@/lib/types";
import { FormError } from "./form-error";
import { MeasurementResult } from "./measurement-result";
import { inputClass, labelClass, primaryButtonClass } from "./ui";

type Props = {
  clientId: string;
  /** この顧客の登録済み地域の数。0 ならスケジュールは作れない。 */
  regionCount: number;
  /** 実験モード（SAJI_GOOGLE_PC_ENABLED=1）。Google × pc も作る。 */
  googlePc?: boolean;
};

const PLATFORMS: Platform[] = ["google", "yahoo"];

export function AddKeywordForm({ clientId, regionCount, googlePc = false }: Props) {
  const [state, formAction, pending] = useActionState(addKeyword, initialStartMeasurementState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.error) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="client_id" value={clientId} />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <label htmlFor="keyword" className={labelClass}>
            キーワード
          </label>
          <input
            id="keyword"
            name="keyword"
            type="text"
            required
            maxLength={200}
            placeholder="例: 不用品回収 名古屋"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="platform" className={labelClass}>
            検索エンジン
          </label>
          <select id="platform" name="platform" defaultValue="google" className={inputClass}>
            <option value="google">Google</option>
            <option value="yahoo">Yahoo!</option>
          </select>
        </div>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "追加中…" : "追加"}
        </button>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" name="start_measurement" value="1" defaultChecked />
          登録と同時に計測を開始する
        </label>
        {regionCount === 0 ? (
          <p className="mt-1 text-xs font-medium text-warn">
            地域が未登録のため、キーワードだけを登録します。先に「地域」タブで地域を登録してください。
          </p>
        ) : (
          <p className="mt-1 text-xs text-subtle">
            登録済みの地域 {regionCount} 件 × 計測対象のデバイスでスケジュールを作り、時間帯に自動分散します（
            {PLATFORMS.map((platform) => {
              const devices = allowedDevicesFor(platform, { googlePc });
              return `${PLATFORM_LABELS[platform]}: ${devices
                .map((device) => DEVICE_LABELS[device])
                .join("・")} で ${regionCount * devices.length} 件`;
            }).join(" / ")}
            ）。1日の消化能力を超える分は作りません。
          </p>
        )}
      </div>

      <FormError message={state.error} />
      <MeasurementResult state={state} />
    </form>
  );
}
