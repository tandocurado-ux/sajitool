"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addSchedule } from "@/server/schedules/actions";
import { initialActionState } from "@/lib/action-state";
import { allowedDevicesFor, GOOGLE_DEVICE_NOTE } from "@/lib/device-policy";
import {
  DEVICE_LABELS,
  PLATFORM_LABELS,
  type Device,
  type Keyword,
  type Region,
} from "@/lib/types";
import { FormError } from "./form-error";
import { TimePicker } from "./time-picker";
import { inputClass, labelClass, primaryButtonClass } from "./ui";

type Props = {
  keywords: Keyword[];
  regions: Region[];
};

const DEVICES: Device[] = ["pc", "mobile"];

export function AddScheduleForm({ keywords, regions }: Props) {
  const [state, formAction, pending] = useActionState(addSchedule, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const [times, setTimes] = useState<string[]>(["09:00"]);
  const [keywordId, setKeywordId] = useState<string>(keywords[0]?.id ?? "");

  const selectedKeyword = keywords.find((keyword) => keyword.id === keywordId) ?? keywords[0];
  const allowed = selectedKeyword ? allowedDevicesFor(selectedKeyword.platform) : DEVICES;
  const [device, setDevice] = useState<Device>(allowed[0] ?? "pc");
  // キーワードを変えて今のデバイスが選べなくなったら、選べる方に寄せる。
  const effectiveDevice: Device = allowed.includes(device) ? device : allowed[0];

  useEffect(() => {
    if (!state.error) formRef.current?.reset();
  }, [state]);

  // 時刻は制御されているので、レンダー中に前回値と比べて戻す。
  const [handledState, setHandledState] = useState(state);
  if (handledState !== state) {
    setHandledState(state);
    if (!state.error) setTimes(["09:00"]);
  }

  if (keywords.length === 0 || regions.length === 0) {
    return (
      <p className="text-sm text-subtle">
        スケジュールを作るには、先に「キーワード」と「地域」をそれぞれ1件以上登録してください。
      </p>
    );
  }

  const googleSelected = selectedKeyword?.platform === "google";

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="keyword_id" className={labelClass}>
            キーワード
          </label>
          <select
            id="keyword_id"
            name="keyword_id"
            required
            value={keywordId}
            onChange={(event) => setKeywordId(event.target.value)}
            className={inputClass}
          >
            {keywords.map((keyword) => (
              <option key={keyword.id} value={keyword.id}>
                {keyword.keyword}（{PLATFORM_LABELS[keyword.platform] ?? keyword.platform}）
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="region_id" className={labelClass}>
            地域
          </label>
          <select id="region_id" name="region_id" required className={inputClass}>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <TimePicker name="times" times={times} onChange={setTimes} />
        </div>
        <div>
          <label htmlFor="device" className={labelClass}>
            デバイス
          </label>
          <select
            id="device"
            name="device"
            value={effectiveDevice}
            onChange={(event) => setDevice(event.target.value as Device)}
            className={inputClass}
          >
            {DEVICES.map((option) => (
              <option
                key={option}
                value={option}
                disabled={!allowed.includes(option)}
                title={!allowed.includes(option) ? GOOGLE_DEVICE_NOTE : undefined}
              >
                {DEVICE_LABELS[option]}
                {!allowed.includes(option) ? "（Google では選べません）" : ""}
              </option>
            ))}
          </select>
          {googleSelected ? (
            <p className="mt-1 text-xs font-medium text-warn">{GOOGLE_DEVICE_NOTE}。</p>
          ) : null}
        </div>
      </div>
      <div>
        <button
          type="submit"
          disabled={pending || times.length === 0}
          className={primaryButtonClass}
        >
          {pending ? "追加中…" : "スケジュールを追加"}
        </button>
      </div>
      <FormError message={state.error} />
    </form>
  );
}
