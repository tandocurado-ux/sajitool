"use client";

import {
  DEVICE_MODES,
  DEVICE_MODE_LABELS,
  type DeviceMode,
} from "@/server/setup/schema";
import { GOOGLE_DEVICE_NOTE, includesGoogle } from "@/lib/device-policy";
import type { Platform } from "@/lib/types";
import { labelClass } from "../ui";

type Props = {
  value: DeviceMode;
  onChange: (mode: DeviceMode) => void;
  /** 選択中の検索エンジン。Google を含むなら pc は選べない。 */
  platforms?: readonly Platform[];
};

export function DeviceModeField({ value, onChange, platforms = [] }: Props) {
  const googleSelected = includesGoogle(platforms);

  return (
    <fieldset>
      <legend className={labelClass}>デバイス</legend>
      <div className="flex flex-wrap gap-4">
        {DEVICE_MODES.map((mode) => {
          // Google を含む登録では pc 単独は作れない（Google 側は何も作られない）。
          const disabled = googleSelected && mode === "pc";
          return (
            <label
              key={mode}
              className={`flex items-center gap-2 text-sm ${disabled ? "text-subtle" : ""}`}
              title={disabled ? GOOGLE_DEVICE_NOTE : undefined}
            >
              <input
                type="radio"
                name="device_mode"
                value={mode}
                checked={value === mode}
                disabled={disabled}
                onChange={() => onChange(mode)}
              />
              {DEVICE_MODE_LABELS[mode]}
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-subtle">
        「両方」を選ぶと PC とモバイルで2件ずつ作成します。
      </p>
      {googleSelected ? (
        <p className="mt-1 text-xs font-medium text-warn">
          {GOOGLE_DEVICE_NOTE}。
          {value === "both" ? "「両方」でも Google は mobile だけ作成されます。" : ""}
        </p>
      ) : null}
    </fieldset>
  );
}
