"use client";

import {
  ROTATION_OPTIONS,
  TIME_MODES,
  TIME_MODE_LABELS,
  type TimeMode,
} from "@/server/setup/schema";
import { TIME_OPTIONS, timeSlotsBetween } from "@/lib/parse";
import { TimePicker } from "../time-picker";
import { inputClass, labelClass } from "../ui";

export type TimingValue = {
  timeMode: TimeMode;
  times: string[];
  spreadStart: string;
  spreadEnd: string;
  rotations: number;
};

export const DEFAULT_TIMING: TimingValue = {
  timeMode: "fixed",
  times: ["09:00"],
  spreadStart: "06:00",
  spreadEnd: "23:00",
  rotations: 1,
};

export function timingSlots(value: TimingValue): string[] {
  return timeSlotsBetween(value.spreadStart, value.spreadEnd);
}

/** 時刻の指定として成立しているか。 */
export function isTimingReady(value: TimingValue): boolean {
  return value.timeMode === "fixed"
    ? value.times.length > 0
    : timingSlots(value).length > 0;
}

/** 確認ダイアログに出す1行。 */
export function describeTiming(value: TimingValue): string {
  if (value.timeMode === "fixed") {
    return `時刻: ${value.times.join(", ")}（全件同じ）`;
  }
  return (
    `時刻: ${value.spreadStart}〜${value.spreadEnd} の ` +
    `${timingSlots(value).length} 枠に分散 / 1日 ${value.rotations} 回`
  );
}

type Props = {
  value: TimingValue;
  onChange: (patch: Partial<TimingValue>) => void;
};

/**
 * 時刻の決め方（全件同じ / 時間帯に自動分散）とデバイス以外の時刻設定。
 * まとめて登録と新規登録で共有する。
 */
export function ScheduleTimingFields({ value, onChange }: Props) {
  const slots = timingSlots(value);

  return (
    <>
      <fieldset>
        <legend className={labelClass}>時刻の決め方</legend>
        <div className="flex flex-wrap gap-4">
          {TIME_MODES.map((mode) => (
            <label key={mode} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="time_mode"
                value={mode}
                checked={value.timeMode === mode}
                onChange={() => onChange({ timeMode: mode })}
              />
              {TIME_MODE_LABELS[mode]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        {value.timeMode === "fixed" ? (
          <>
            <TimePicker
              name="times"
              times={value.times}
              onChange={(times) => onChange({ times })}
            />
            <p className="mt-1 text-xs text-neutral-500">
              作成するスケジュールすべてに同じ時刻が入ります。件数が多いと
              同じ時刻に集中して、計測が後ろにずれ込みます。
            </p>
          </>
        ) : (
          <>
            <div className="mb-3">
              <label htmlFor="spread-rotations" className={labelClass}>
                1日の回転数（1スケジュールあたりの計測回数）
              </label>
              <select
                id="spread-rotations"
                name="spread_rotations"
                value={value.rotations}
                onChange={(event) =>
                  onChange({ rotations: Number(event.target.value) })
                }
                className={`${inputClass} w-32`}
              >
                {ROTATION_OPTIONS.map((count) => (
                  <option key={count} value={count}>
                    1日 {count} 回
                  </option>
                ))}
              </select>
            </div>

            <span className={labelClass}>分散する時間帯（15分刻み）</span>
            <div className="flex flex-wrap items-center gap-2">
              <select
                name="spread_start"
                value={value.spreadStart}
                onChange={(event) => onChange({ spreadStart: event.target.value })}
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
                value={value.spreadEnd}
                onChange={(event) => onChange({ spreadEnd: event.target.value })}
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
            {slots.length === 0 ? (
              <p className="mt-1 text-sm text-red-600">
                終了時刻は開始時刻と同じか、それより後にしてください。
              </p>
            ) : (
              <p className="mt-1 text-xs text-neutral-500">
                {slots.length} 枠（{slots[0]} 〜 {slots[slots.length - 1]}）に
                均等に割り振ります。1スケジュールあたり {value.rotations} 個の時刻が入ります。
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
