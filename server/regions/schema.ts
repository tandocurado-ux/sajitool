import type { ParseResult } from "@/lib/parse";
import { buildRegionLabel, findMunicipality, japanRangeWarning } from "@/lib/japan";

export type RegionInput = {
  client_id: string;
  label: string;
  prefecture: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
};

/**
 * 都道府県 + 市区町村から地域を1件組み立てる。
 *
 * 緯度経度は市区町村の代表点から引くので手入力を受け付けない。
 * 手入力だった頃に経度の桁を打ち間違えても気づけない事故があったため。
 */
export function buildRegionInput(
  clientId: string,
  prefecture: string,
  city: string,
  label: string,
): ParseResult<RegionInput> {
  if (!prefecture) return { ok: false, error: "都道府県を選択してください。" };
  if (!city) return { ok: false, error: "市区町村を選択してください。" };

  const municipality = findMunicipality(prefecture, city);
  if (!municipality) {
    return {
      ok: false,
      error: `市区町村が見つかりません: ${prefecture} ${city}`,
    };
  }

  const resolvedLabel = label.trim() || buildRegionLabel(prefecture, city);
  if (resolvedLabel.length > 100) {
    return { ok: false, error: "地域名は100文字以内で入力してください。" };
  }

  // 代表点データ由来なので通常は出ない。データ生成ミスに備えた最終チェック。
  const warning = japanRangeWarning(municipality.lat, municipality.lng);
  if (warning) {
    return { ok: false, error: `${resolvedLabel}: ${warning}` };
  }

  return {
    ok: true,
    data: {
      client_id: clientId,
      label: resolvedLabel,
      prefecture,
      city,
      lat: municipality.lat,
      lng: municipality.lng,
    },
  };
}

export function parseRegionInput(formData: FormData): ParseResult<RegionInput> {
  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!clientId) return { ok: false, error: "顧客が指定されていません。" };

  return buildRegionInput(
    clientId,
    String(formData.get("prefecture") ?? "").trim(),
    String(formData.get("city") ?? "").trim(),
    String(formData.get("label") ?? ""),
  );
}
