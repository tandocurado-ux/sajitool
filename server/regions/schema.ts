import type { ParseResult } from "@/lib/parse";

export type RegionInput = {
  client_id: string;
  label: string;
  prefecture: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
};

function parseCoordinate(
  raw: string,
  fieldLabel: string,
  min: number,
  max: number,
): ParseResult<number | null> {
  const value = raw.trim();
  if (!value) return { ok: true, data: null };

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: `${fieldLabel}は数値で入力してください。` };
  }
  if (parsed < min || parsed > max) {
    return { ok: false, error: `${fieldLabel}は ${min} 〜 ${max} の範囲で入力してください。` };
  }
  return { ok: true, data: parsed };
}

export function parseRegionInput(formData: FormData): ParseResult<RegionInput> {
  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!clientId) return { ok: false, error: "顧客が指定されていません。" };

  const label = String(formData.get("label") ?? "").trim();
  if (!label) return { ok: false, error: "地域名（ラベル）を入力してください。" };
  if (label.length > 100) {
    return { ok: false, error: "地域名は100文字以内で入力してください。" };
  }

  const lat = parseCoordinate(String(formData.get("lat") ?? ""), "緯度", -90, 90);
  if (!lat.ok) return lat;

  const lng = parseCoordinate(String(formData.get("lng") ?? ""), "経度", -180, 180);
  if (!lng.ok) return lng;

  const prefecture = String(formData.get("prefecture") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();

  return {
    ok: true,
    data: {
      client_id: clientId,
      label,
      prefecture: prefecture || null,
      city: city || null,
      lat: lat.data,
      lng: lng.data,
    },
  };
}
