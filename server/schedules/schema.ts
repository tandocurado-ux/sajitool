import { parseTimes, type ParseResult } from "@/lib/parse";
import type { Device } from "@/lib/types";

export type ScheduleInput = {
  keyword_id: string;
  region_id: string;
  times: string[];
  device: Device;
};

const DEVICES: Device[] = ["pc", "mobile"];

export function parseScheduleInput(
  formData: FormData,
): ParseResult<ScheduleInput> {
  const keywordId = String(formData.get("keyword_id") ?? "").trim();
  if (!keywordId) return { ok: false, error: "キーワードを選択してください。" };

  const regionId = String(formData.get("region_id") ?? "").trim();
  if (!regionId) return { ok: false, error: "地域を選択してください。" };

  const times = parseTimes(String(formData.get("times") ?? ""));
  if (!times.ok) return times;

  const device = String(formData.get("device") ?? "") as Device;
  if (!DEVICES.includes(device)) {
    return { ok: false, error: "デバイスを選択してください。" };
  }

  return {
    ok: true,
    data: {
      keyword_id: keywordId,
      region_id: regionId,
      times: times.data,
      device,
    },
  };
}
