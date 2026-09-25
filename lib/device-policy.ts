import type { Device, Platform } from "./types";

/**
 * platform ごとに計測してよいデバイス。
 *
 * Google は mobile のみ。実測で Google × mobile は通り（exit IP 133.106 帯で ok が続く）、
 * Google × pc は BOT 検知（/sorry/）が続くため、pc は登録も実行もしない。
 * Yahoo! は従来どおり pc / mobile の両方。
 *
 * 画面（まとめて登録・新規登録・単発追加）、サーバーアクション（作成・即時実行）、
 * 計測エンジン（engine/runner.py の同じ表）の3か所で同じ判定を使う。
 */
export const ALLOWED_DEVICES: Record<Platform, readonly Device[]> = {
  google: ["mobile"],
  yahoo: ["pc", "mobile"],
};

export const GOOGLE_DEVICE_NOTE =
  "Google は mobile のみ計測します（pc は BOT 検知されやすいため）";

export function allowedDevicesFor(platform: Platform): readonly Device[] {
  return ALLOWED_DEVICES[platform] ?? ["pc", "mobile"];
}

export function isAllowedCombination(platform: Platform, device: Device): boolean {
  return allowedDevicesFor(platform).includes(device);
}

/** 選んだデバイスのうち、その platform で作ってよいものだけを返す。 */
export function devicesForPlatform(
  platform: Platform,
  devices: readonly Device[],
): Device[] {
  return devices.filter((device) => isAllowedCombination(platform, device));
}

/** 選んだ platform の中に Google が含まれるか（pc を無効化する判定）。 */
export function includesGoogle(platforms: readonly Platform[]): boolean {
  return platforms.includes("google");
}
