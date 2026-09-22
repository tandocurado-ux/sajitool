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
