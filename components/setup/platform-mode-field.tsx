"use client";

import {
  PLATFORM_MODES,
  PLATFORM_MODE_LABELS,
  type PlatformMode,
} from "@/server/setup/schema";
import { labelClass } from "../ui";

type Props = {
  value: PlatformMode;
  onChange: (mode: PlatformMode) => void;
  /** 補足文。追加モードと新規登録で説明が違うので差し替えられるようにする。 */
  hint?: string;
};

export function PlatformModeField({ value, onChange, hint }: Props) {
  return (
    <fieldset>
      <legend className={labelClass}>検索エンジン</legend>
      <div className="flex flex-wrap gap-4">
        {PLATFORM_MODES.map((mode) => (
          <label key={mode} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="platform_mode"
              value={mode}
              checked={value === mode}
              onChange={() => onChange(mode)}
            />
            {PLATFORM_MODE_LABELS[mode]}
          </label>
        ))}
      </div>
      {hint ? <p className="mt-1 text-xs text-subtle">{hint}</p> : null}
    </fieldset>
  );
}
