import type { Device, Platform } from "./types";

/**
 * platform ごとに計測してよいデバイス。
 *
 * Google は pc のみ。UA と UA-CH を揃えた後の実測で、Google × mobile はモバイル版の HTML が
 * 返り、結果セレクタ（#rso a h3 系）が合わず no_results になる。Google × pc は
 * デスクトップ版の HTML で結果を拾える。Yahoo! は従来どおり pc / mobile の両方。
 *
 * 画面（まとめて登録・新規登録・単発追加・計測を開始）、サーバーアクション（作成・即時実行）、
 * 計測エンジン（engine/runner.py の同じ表）で同じ判定を使う。
 */
export const ALLOWED_DEVICES: Record<Platform, readonly Device[]> = {
  google: ["pc"],
  yahoo: ["pc", "mobile"],
};

/** Google で計測するデバイス。選べない指定だったときの寄せ先にも使う。 */
export const GOOGLE_DEVICE: Device = "pc";

export const GOOGLE_DEVICE_NOTE =
  "Google は PC のみ計測します（モバイルは検索結果を取得できないため）";

/**
 * 切り戻し用（SAJI_GOOGLE_ALLOW_MOBILE=1）のときだけ googleMobile: true を渡す。
 * env はサーバーでしか読めないので、値は server/device-policy.ts から受け取る。
 * 省略時は Google は pc のみ。
 */
export type DevicePolicyOptions = { googleMobile?: boolean };

const ALL_DEVICES: readonly Device[] = ["pc", "mobile"];

export function allowedDevicesFor(
  platform: Platform,
  options: DevicePolicyOptions = {},
): readonly Device[] {
  if (platform === "google" && options.googleMobile) return ALL_DEVICES;
  return ALLOWED_DEVICES[platform] ?? ALL_DEVICES;
}

export function isAllowedCombination(
  platform: Platform,
  device: Device,
  options: DevicePolicyOptions = {},
): boolean {
  return allowedDevicesFor(platform, options).includes(device);
}

/** 選んだデバイスのうち、その platform で作ってよいものだけを返す。 */
export function devicesForPlatform(
  platform: Platform,
  devices: readonly Device[],
  options: DevicePolicyOptions = {},
): Device[] {
  return devices.filter((device) => isAllowedCombination(platform, device, options));
}

/** 選んだ platform の中に Google が含まれるか。 */
export function includesGoogle(platforms: readonly Platform[]): boolean {
  return platforms.includes("google");
}

/**
 * Google を含む登録で、単独では選べないデバイス（Google 側が何も作られなくなる指定）。
 * 制限が無ければ null。
 */
export function blockedDeviceFor(
  platforms: readonly Platform[],
  options: DevicePolicyOptions = {},
): Device | null {
  if (!includesGoogle(platforms)) return null;
  const allowed = allowedDevicesFor("google", options);
  return ALL_DEVICES.find((device) => !allowed.includes(device)) ?? null;
}
