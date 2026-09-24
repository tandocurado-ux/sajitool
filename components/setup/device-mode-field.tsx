"use client";

import {
  DEVICE_MODES,
  DEVICE_MODE_LABELS,
  type DeviceMode,
} from "@/server/setup/schema";
import { labelClass } from "../ui";

type Props = {
  value: DeviceMode;
  onChange: (mode: DeviceMode) => void;
};

export function DeviceModeField({ value, onChange }: Props) {
  return (
    <fieldset>
      <legend className={labelClass}>デバイス</legend>
      <div className="flex flex-wrap gap-4">
        {DEVICE_MODES.map((mode) => (
          <label key={mode} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="device_mode"
              value={mode}
              checked={value === mode}
              onChange={() => onChange(mode)}
            />
            {DEVICE_MODE_LABELS[mode]}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-subtle">
        「両方」を選ぶと PC とモバイルで2件ずつ作成します。
      </p>
    </fieldset>
  );
}
