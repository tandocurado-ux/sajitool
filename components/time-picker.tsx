"use client";

import { useState } from "react";
import { TIME_OPTIONS } from "@/lib/parse";
import { inputClass, labelClass, subtleButtonClass } from "./ui";

type Props = {
  /** 送信名。親が持つ値を "09:00, 18:00" 形式の hidden input にして出す。 */
  name: string;
  times: string[];
  onChange: (times: string[]) => void;
  label?: string;
};

/** 15分刻みの時刻を複数選ぶ。選択済みはチップで個別に消せる。 */
export function TimePicker({
  name,
  times,
  onChange,
  label = "計測時刻",
}: Props) {
  const [draft, setDraft] = useState("09:00");

  const available = TIME_OPTIONS.filter((time) => !times.includes(time));
  const canAdd = available.includes(draft);

  function addTime() {
    if (!canAdd) return;
    onChange([...times, draft].sort());
  }

  function removeTime(time: string) {
    onChange(times.filter((value) => value !== time));
  }

  return (
    <div>
      <input type="hidden" name={name} value={times.join(", ")} />
      <span className={labelClass}>{label}（15分刻み・複数可）</span>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="追加する時刻"
          className={`${inputClass} w-32`}
        >
          {TIME_OPTIONS.map((time) => (
            <option key={time} value={time} disabled={times.includes(time)}>
              {time}
              {times.includes(time) ? "（追加済み）" : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addTime}
          disabled={!canAdd}
          className={subtleButtonClass}
        >
          + 時刻を追加
        </button>
      </div>

      {times.length === 0 ? (
        <p className="mt-2 text-xs text-red-600">
          時刻を1つ以上追加してください。
        </p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {times.map((time) => (
            <li key={time}>
              <span className="inline-flex items-center gap-1 rounded border border-neutral-300 bg-neutral-50 py-1 pl-2 pr-1 text-sm text-neutral-800">
                {time}
                <button
                  type="button"
                  onClick={() => removeTime(time)}
                  aria-label={`${time} を削除`}
                  className="rounded px-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
