import {
  MUNICIPALITIES_BY_PREFECTURE,
  type MunicipalityEntry,
} from "./municipalities";

/**
 * 47都道府県。全国地方公共団体コード順。
 * 市区町村データのキーから作るので、データと必ず一致する。
 */
export const PREFECTURES: string[] = Object.keys(MUNICIPALITIES_BY_PREFECTURE);

export type Municipality = {
  name: string;
  lat: number;
  lng: number;
};

function toMunicipality(entry: MunicipalityEntry): Municipality {
  return { name: entry[0], lat: entry[1], lng: entry[2] };
}

export function municipalitiesOf(prefecture: string): Municipality[] {
  const entries = MUNICIPALITIES_BY_PREFECTURE[prefecture];
  return entries ? entries.map(toMunicipality) : [];
}

export function findMunicipality(
  prefecture: string,
  city: string,
): Municipality | null {
  const entries = MUNICIPALITIES_BY_PREFECTURE[prefecture];
  if (!entries) return null;
  const found = entries.find((entry) => entry[0] === city);
  return found ? toMunicipality(found) : null;
}

/** 「大阪府大阪市中央区」のように都道府県名と市区町村名をつなぐ。 */
export function buildRegionLabel(prefecture: string, city: string): string {
  return `${prefecture}${city}`;
}

/** 日本のおおよその範囲。桁の打ち間違いを気づけるようにするための目安。 */
export const JAPAN_LAT_RANGE = { min: 20, max: 46 } as const;
export const JAPAN_LNG_RANGE = { min: 122, max: 154 } as const;

export function isLatInJapan(lat: number): boolean {
  return lat >= JAPAN_LAT_RANGE.min && lat <= JAPAN_LAT_RANGE.max;
}

export function isLngInJapan(lng: number): boolean {
  return lng >= JAPAN_LNG_RANGE.min && lng <= JAPAN_LNG_RANGE.max;
}

/**
 * 日本の範囲外なら警告文を返す。範囲内・未入力なら null。
 *
 * 市区町村プルダウンから座標を入れる今は出ないはずだが、
 * 経度 135.5023 を 35.5023 と打ち間違えて気づけなかった実例があるため、
 * サーバー側の最終チェックとして残している。
 */
export function japanRangeWarning(
  lat: number | null,
  lng: number | null,
): string | null {
  const issues: string[] = [];
  if (lat !== null && !isLatInJapan(lat)) {
    issues.push(
      `緯度 ${lat}（日本は ${JAPAN_LAT_RANGE.min}〜${JAPAN_LAT_RANGE.max} 程度）`,
    );
  }
  if (lng !== null && !isLngInJapan(lng)) {
    issues.push(
      `経度 ${lng}（日本は ${JAPAN_LNG_RANGE.min}〜${JAPAN_LNG_RANGE.max} 程度）`,
    );
  }
  return issues.length > 0 ? `日本の範囲外です: ${issues.join(" / ")}` : null;
}
