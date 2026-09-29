import type { DevicePolicyOptions } from "@/lib/device-policy";

/**
 * Google × mobile を許可する切り戻し用の設定（SAJI_GOOGLE_ALLOW_MOBILE=1。
 * engine 側と同じ名前の env）。既定は OFF で、Google は pc のみ。
 *
 * サーバーでしか読めない値なので、画面には props で渡す。
 */
export function googleMobileAllowed(): boolean {
  return process.env.SAJI_GOOGLE_ALLOW_MOBILE === "1";
}

export function devicePolicyOptions(): DevicePolicyOptions {
  return { googleMobile: googleMobileAllowed() };
}
