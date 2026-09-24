export type Platform = "google" | "yahoo";
export type Device = "pc" | "mobile";

export const PLATFORM_LABELS: Record<Platform, string> = {
  google: "Google",
  yahoo: "Yahoo!",
};

export const DEVICE_LABELS: Record<Device, string> = {
  pc: "PC",
  mobile: "モバイル",
};

export type Client = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
};

export type Keyword = {
  id: string;
  client_id: string;
  keyword: string;
  platform: Platform;
  created_at: string;
};

export type Region = {
  id: string;
  client_id: string;
  label: string;
  prefecture: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
};

export type Schedule = {
  id: string;
  keyword_id: string;
  region_id: string;
  times: string[];
  device: Device;
  enabled: boolean;
  created_at: string;
};

export type RunStatus = "ok" | "blocked" | "error";

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  ok: "成功",
  blocked: "検知",
  error: "エラー",
};

/** バッジの title などに出す補足。blocked と error を混同しないための説明。 */
export const RUN_STATUS_DESCRIPTIONS: Record<RunStatus, string> = {
  ok: "検索結果を取得できた",
  blocked: "ボット検知でブロックされた（プロキシや間隔の見直し対象）",
  error: "取得中にエラーが起きた（タイムアウトや例外）",
};

export const RUN_STATUSES: RunStatus[] = ["ok", "blocked", "error"];

export type Run = {
  id: string;
  schedule_id: string;
  run_at: string;
  status: RunStatus;
  exit_ip: string | null;
};
