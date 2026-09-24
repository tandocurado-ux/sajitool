"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addSchedule } from "@/server/schedules/actions";
import { initialActionState } from "@/lib/action-state";
import { PLATFORM_LABELS, type Keyword, type Region } from "@/lib/types";
import { FormError } from "./form-error";
import { TimePicker } from "./time-picker";
import { inputClass, labelClass, primaryButtonClass } from "./ui";

type Props = {
  keywords: Keyword[];
  regions: Region[];
};

export function AddScheduleForm({ keywords, regions }: Props) {
  const [state, formAction, pending] = useActionState(addSchedule, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const [times, setTimes] = useState<string[]>(["09:00"]);

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

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="keyword_id" className={labelClass}>
            キーワード
          </label>
          <select id="keyword_id" name="keyword_id" required className={inputClass}>
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
          <select id="device" name="device" defaultValue="pc" className={inputClass}>
            <option value="pc">PC</option>
            <option value="mobile">モバイル</option>
          </select>
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
