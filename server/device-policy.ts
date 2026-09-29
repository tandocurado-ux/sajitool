import type { DevicePolicyOptions } from "@/lib/device-policy";

/**
 * Google × pc の実験モード（SAJI_GOOGLE_PC_ENABLED=1。engine 側と同じ名前の env）。
 *
 * サーバーでしか読めない値なので、画面には props で渡す。
 * まとめて登録・新規登録・単発追加の登録ガードはこの値では変わらない。
 * 「計測を開始」とキーワード登録時の自動スケジュール化、即時実行だけが見る。
 */
export function googlePcExperimentEnabled(): boolean {
  return process.env.SAJI_GOOGLE_PC_ENABLED === "1";
}

export function devicePolicyOptions(): DevicePolicyOptions {
  return { googlePc: googlePcExperimentEnabled() };
}
