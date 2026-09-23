import {
  TIME_OPTIONS,
  parseKeywordLines,
  parseTimes,
  timeSlotsBetween,
  type ParseResult,
} from "@/lib/parse";
import {
  buildRegionLabel,
  findMunicipality,
  japanRangeWarning,
} from "@/lib/japan";
import type { Device, Platform } from "@/lib/types";

export type PlatformMode = "google" | "yahoo" | "both";
export type DeviceMode = "pc" | "mobile" | "both";

export const PLATFORM_MODES: PlatformMode[] = ["google", "yahoo", "both"];
export const DEVICE_MODES: DeviceMode[] = ["pc", "mobile", "both"];

export const PLATFORM_MODE_LABELS: Record<PlatformMode, string> = {
  google: "Google",
  yahoo: "Yahoo!",
  both: "両方",
};

export const DEVICE_MODE_LABELS: Record<DeviceMode, string> = {
  pc: "PC",
  mobile: "モバイル",
  both: "両方",
};

export function platformsFor(mode: PlatformMode): Platform[] {
  return mode === "both" ? ["google", "yahoo"] : [mode];
}

export function devicesFor(mode: DeviceMode): Device[] {
  return mode === "both" ? ["pc", "mobile"] : [mode];
}

export type TimeMode = "fixed" | "spread";

export const TIME_MODES: TimeMode[] = ["fixed", "spread"];

export const TIME_MODE_LABELS: Record<TimeMode, string> = {
  fixed: "全件同じ時刻",
  spread: "時間帯に自動分散",
};

export type NewRegionDraft = {
  label: string;
  prefecture: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
};

export type BulkSetupInput = {
  client_id: string;
  keywords: string[];
  platforms: Platform[];
  regionIds: string[];
  newRegions: NewRegionDraft[];
  timeMode: TimeMode;
  /** timeMode === "fixed" のとき、全スケジュールに入れる時刻。 */
  times: string[];
  /** timeMode === "spread" のとき、均等に割り振る15分刻みの枠。 */
  spreadSlots: string[];
  devices: Device[];
};

export type BulkSetupParsed = {
  input: BulkSetupInput;
  /** 緯度経度が日本の範囲外など、止めはしないが伝えたいこと。 */
  warnings: string[];
};

/** 作られるスケジュール件数。画面の件数表示と同じ式を使う。 */
export function scheduleCount(input: {
  keywords: number;
  platforms: number;
  regions: number;
  devices: number;
}): number {
  return input.keywords * input.platforms * input.regions * input.devices;
}

type RawNewRegion = {
  label?: unknown;
  prefecture?: unknown;
  city?: unknown;
};

/**
 * 画面から来るのは都道府県・市区町村・任意のラベルだけ。
 * 緯度経度はサーバー側で市区町村データから引き直すので、
 * 画面から送られた座標は一切信用しない。
 */
function parseNewRegions(
  raw: string,
): ParseResult<{ regions: NewRegionDraft[]; warnings: string[] }> {
  if (!raw.trim()) return { ok: true, data: { regions: [], warnings: [] } };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "新規地域の入力を読み取れませんでした。" };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "新規地域の入力を読み取れませんでした。" };
  }

  const regions: NewRegionDraft[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const entry of parsed as RawNewRegion[]) {
    const prefecture = String(entry?.prefecture ?? "").trim();
    const city = String(entry?.city ?? "").trim();
    // 選択途中の空行は無視する。
    if (!prefecture && !city) continue;
    if (!prefecture) return { ok: false, error: "都道府県を選択してください。" };
    if (!city) {
      return { ok: false, error: `市区町村を選択してください（${prefecture}）。` };
    }

    const key = `${prefecture}/${city}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const municipality = findMunicipality(prefecture, city);
    if (!municipality) {
      return { ok: false, error: `市区町村が見つかりません: ${prefecture} ${city}` };
    }

    const label =
      String(entry?.label ?? "").trim() || buildRegionLabel(prefecture, city);
    if (label.length > 100) {
      return { ok: false, error: `地域名は100文字以内で入力してください: ${label}` };
    }

    // 代表点データ由来なので通常は出ない。データ生成ミスに備えた最終チェック。
    const warning = japanRangeWarning(municipality.lat, municipality.lng);
    if (warning) warnings.push(`「${label}」: ${warning}`);

    regions.push({
      label,
      prefecture,
      city,
      lat: municipality.lat,
      lng: municipality.lng,
    });
  }

  return { ok: true, data: { regions, warnings } };
}

export function parseBulkSetupInput(
  formData: FormData,
): ParseResult<BulkSetupParsed> {
  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!clientId) return { ok: false, error: "顧客が指定されていません。" };

  const keywords = parseKeywordLines(String(formData.get("keywords") ?? ""));
  if (keywords.length === 0) {
    return { ok: false, error: "キーワードを1行に1つずつ入力してください。" };
  }
  const tooLong = keywords.find((keyword) => keyword.length > 200);
  if (tooLong) {
    return {
      ok: false,
      error: `キーワードは200文字以内で入力してください: ${tooLong.slice(0, 30)}…`,
    };
  }

  const platformMode = String(formData.get("platform_mode") ?? "") as PlatformMode;
  if (!PLATFORM_MODES.includes(platformMode)) {
    return { ok: false, error: "検索エンジンを選択してください。" };
  }

  const deviceMode = String(formData.get("device_mode") ?? "") as DeviceMode;
  if (!DEVICE_MODES.includes(deviceMode)) {
    return { ok: false, error: "デバイスを選択してください。" };
  }

  const timeMode = String(formData.get("time_mode") ?? "fixed") as TimeMode;
  if (!TIME_MODES.includes(timeMode)) {
    return { ok: false, error: "時刻の指定方法を選択してください。" };
  }

  let times: string[] = [];
  let spreadSlots: string[] = [];

  if (timeMode === "fixed") {
    const parsed = parseTimes(String(formData.get("times") ?? ""));
    if (!parsed.ok) return parsed;
    times = parsed.data;
  } else {
    const start = String(formData.get("spread_start") ?? "").trim();
    const end = String(formData.get("spread_end") ?? "").trim();
    if (!TIME_OPTIONS.includes(start) || !TIME_OPTIONS.includes(end)) {
      return { ok: false, error: "分散する時間帯の開始・終了を選んでください。" };
    }
    spreadSlots = timeSlotsBetween(start, end);
    if (spreadSlots.length === 0) {
      return { ok: false, error: "終了時刻は開始時刻と同じか、それより後にしてください。" };
    }
  }

  const regionIds = formData
    .getAll("region_ids")
    .map((value) => String(value).trim())
    .filter(Boolean);

  const newRegions = parseNewRegions(String(formData.get("new_regions") ?? ""));
  if (!newRegions.ok) return newRegions;

  if (regionIds.length === 0 && newRegions.data.regions.length === 0) {
    return {
      ok: false,
      error: "地域を1つ以上選ぶか、新しい地域を追加してください。",
    };
  }

  return {
    ok: true,
    data: {
      input: {
        client_id: clientId,
        keywords,
        platforms: platformsFor(platformMode),
        regionIds,
        newRegions: newRegions.data.regions,
        timeMode,
        times,
        spreadSlots,
        devices: devicesFor(deviceMode),
      },
      warnings: newRegions.data.warnings,
    },
  };
}

// --------------------------------------------------------------------------
// 一括登録の実行結果
// --------------------------------------------------------------------------
//
// これらは Client Component からも読むので、必ず "use server" ではない
// このファイルに置く。"use server" ファイルは async 関数しかエクスポートできず、
// 定数を置くと Server Reference（関数）に化けてしまう。

export type BulkSetupSummary = {
  keywordsCreated: number;
  keywordsSkipped: number;
  regionsCreated: number;
  schedulesCreated: number;
  schedulesSkipped: number;
};

export type BulkSetupState = {
  error: string | null;
  warnings: string[];
  summary: BulkSetupSummary | null;
  /** 途中で失敗したとき、どこまで作られたかを伝える。 */
  progress: string | null;
};

export const initialBulkSetupState: BulkSetupState = {
  error: null,
  warnings: [],
  summary: null,
  progress: null,
};
