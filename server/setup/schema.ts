import {
  TIME_OPTIONS,
  formatTime,
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
import { parseClientInput } from "@/server/clients/schema";

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

/** 1日の回転数（1スケジュールあたり何回計測するか）。 */
export const ROTATION_OPTIONS = [1, 2, 3] as const;
export const DEFAULT_ROTATIONS = 1;

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
  /** timeMode === "spread" のとき、1スケジュールあたりの計測回数。 */
  rotations: number;
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

export type ScheduleSettings = {
  platforms: Platform[];
  devices: Device[];
  timeMode: TimeMode;
  times: string[];
  spreadSlots: string[];
  rotations: number;
};

/** 検索エンジン・デバイス・時刻の設定。2つの画面で同じ入力欄を使う。 */
export function parseScheduleSettings(
  formData: FormData,
): ParseResult<ScheduleSettings> {
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
  let rotations = DEFAULT_ROTATIONS;

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

    rotations = Number(formData.get("spread_rotations") ?? DEFAULT_ROTATIONS);
    if (!ROTATION_OPTIONS.includes(rotations as (typeof ROTATION_OPTIONS)[number])) {
      return { ok: false, error: "1日の回転数を選んでください。" };
    }
  }

  return {
    ok: true,
    data: {
      platforms: platformsFor(platformMode),
      devices: devicesFor(deviceMode),
      timeMode,
      times,
      spreadSlots,
      rotations,
    },
  };
}

/** キーワード欄。空を許すかは呼び出し側が決める。 */
export function parseKeywordsField(formData: FormData): ParseResult<string[]> {
  const keywords = parseKeywordLines(String(formData.get("keywords") ?? ""));
  const tooLong = keywords.find((keyword) => keyword.length > 200);
  if (tooLong) {
    return {
      ok: false,
      error: `キーワードは200文字以内で入力してください: ${tooLong.slice(0, 30)}…`,
    };
  }
  return { ok: true, data: keywords };
}

export type RegionsField = {
  regionIds: string[];
  newRegions: NewRegionDraft[];
  warnings: string[];
};

/** 既存地域の選択と、新しく足す地域。空を許すかは呼び出し側が決める。 */
export function parseRegionsField(formData: FormData): ParseResult<RegionsField> {
  const regionIds = formData
    .getAll("region_ids")
    .map((value) => String(value).trim())
    .filter(Boolean);

  const newRegions = parseNewRegions(String(formData.get("new_regions") ?? ""));
  if (!newRegions.ok) return newRegions;

  return {
    ok: true,
    data: {
      regionIds,
      newRegions: newRegions.data.regions,
      warnings: newRegions.data.warnings,
    },
  };
}

export function parseBulkSetupInput(
  formData: FormData,
): ParseResult<BulkSetupParsed> {
  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!clientId) return { ok: false, error: "顧客が指定されていません。" };

  const keywords = parseKeywordsField(formData);
  if (!keywords.ok) return keywords;
  if (keywords.data.length === 0) {
    return { ok: false, error: "キーワードを1行に1つずつ入力してください。" };
  }

  const settings = parseScheduleSettings(formData);
  if (!settings.ok) return settings;

  const regions = parseRegionsField(formData);
  if (!regions.ok) return regions;
  if (regions.data.regionIds.length === 0 && regions.data.newRegions.length === 0) {
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
        keywords: keywords.data,
        platforms: settings.data.platforms,
        regionIds: regions.data.regionIds,
        newRegions: regions.data.newRegions,
        timeMode: settings.data.timeMode,
        times: settings.data.times,
        spreadSlots: settings.data.spreadSlots,
        rotations: settings.data.rotations,
        devices: settings.data.devices,
      },
      warnings: regions.data.warnings,
    },
  };
}

export type NewClientParsed = {
  name: string;
  /** キーワードも地域も無ければ null（顧客だけ作る）。 */
  setup: Omit<BulkSetupInput, "client_id"> | null;
  warnings: string[];
};

/**
 * 新規顧客ページの入力。店舗名だけでも成立する。
 *
 * 時刻・デバイスの設定はキーワードか地域がある場合だけ見る
 * （何も足さないなら時刻を選ぶ意味がないため）。
 */
export function parseNewClientSetup(
  formData: FormData,
): ParseResult<NewClientParsed> {
  const client = parseClientInput(formData);
  if (!client.ok) return client;

  const keywords = parseKeywordsField(formData);
  if (!keywords.ok) return keywords;

  const regions = parseRegionsField(formData);
  if (!regions.ok) return regions;

  const hasAnything =
    keywords.data.length > 0 ||
    regions.data.regionIds.length > 0 ||
    regions.data.newRegions.length > 0;

  if (!hasAnything) {
    return {
      ok: true,
      data: { name: client.data.name, setup: null, warnings: [] },
    };
  }

  const settings = parseScheduleSettings(formData);
  if (!settings.ok) return settings;

  return {
    ok: true,
    data: {
      name: client.data.name,
      setup: {
        keywords: keywords.data,
        platforms: settings.data.platforms,
        regionIds: regions.data.regionIds,
        newRegions: regions.data.newRegions,
        timeMode: settings.data.timeMode,
        times: settings.data.times,
        spreadSlots: settings.data.spreadSlots,
        rotations: settings.data.rotations,
        devices: settings.data.devices,
      },
      warnings: regions.data.warnings,
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

// --------------------------------------------------------------------------
// 既存スケジュールからの設定の引き継ぎ
// --------------------------------------------------------------------------

export type PreviousSettings = {
  platformMode: PlatformMode;
  deviceMode: DeviceMode;
  timeMode: TimeMode;
  times: string[];
  spreadStart: string;
  spreadEnd: string;
  rotations: number;
  /** 何件のスケジュールから推定したか。 */
  scheduleCount: number;
};

type KeywordLike = { id: string; platform: string };
type ScheduleLike = { keyword_id: string; device: string; times: string[] };

function modeFromValues<T extends string>(
  values: Set<string>,
  first: T,
  second: T,
  both: T,
): T {
  if (values.has(first) && values.has(second)) return both;
  if (values.has(second)) return second;
  return first;
}

/**
 * 既存のスケジュールから「前回どう登録したか」を推定する。
 *
 * 時刻がすべて同じなら「全件同じ時刻」、バラけていれば
 * その範囲での自動分散だったとみなす。
 */
export function derivePreviousSettings(
  keywords: KeywordLike[],
  schedules: ScheduleLike[],
): PreviousSettings | null {
  if (schedules.length === 0) return null;

  const platformById = new Map(keywords.map((k) => [k.id, k.platform]));
  const platforms = new Set<string>();
  const devices = new Set<string>();
  const signatures = new Set<string>();
  const allTimes = new Set<string>();
  const rotationCounts = new Map<number, number>();

  for (const schedule of schedules) {
    const platform = platformById.get(schedule.keyword_id);
    if (platform) platforms.add(platform);
    devices.add(schedule.device);

    const times = (schedule.times ?? []).map(formatTime).sort();
    for (const time of times) allTimes.add(time);
    signatures.add(times.join(","));
    rotationCounts.set(times.length, (rotationCounts.get(times.length) ?? 0) + 1);
  }

  const sortedTimes = [...allTimes].sort();
  const sameTimes = signatures.size === 1;

  let rotations = 1;
  let best = -1;
  for (const [count, times] of rotationCounts) {
    if (times > best && count >= 1) {
      best = times;
      rotations = Math.min(3, Math.max(1, count));
    }
  }

  return {
    platformMode: modeFromValues(platforms, "google", "yahoo", "both"),
    deviceMode: modeFromValues(devices, "pc", "mobile", "both"),
    timeMode: sameTimes ? "fixed" : "spread",
    times: sameTimes ? [...(signatures.values().next().value ?? "").split(",")].filter(Boolean) : sortedTimes,
    spreadStart: sortedTimes[0] ?? "06:00",
    spreadEnd: sortedTimes[sortedTimes.length - 1] ?? "23:00",
    rotations,
    scheduleCount: schedules.length,
  };
}
