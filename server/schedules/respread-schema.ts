import type { ParseResult } from "@/lib/parse";
import { TIME_OPTIONS } from "@/lib/parse";
import { isValidSlot, type RespreadResult } from "@/lib/respread";

export const RESPREAD_PLATFORM_MODES = ["google", "yahoo", "both"] as const;
export type RespreadPlatformMode = (typeof RESPREAD_PLATFORM_MODES)[number];

export type RespreadParams = {
  clientId: string;
  platformMode: RespreadPlatformMode;
  platforms: string[];
  maxPerSlot: number;
  spreadStart: string;
  spreadEnd: string;
};

export type RespreadState = {
  error: string | null;
  /** ドライランの結果。適用前に必ずこれを見せる。 */
  preview: (RespreadResult & { params: RespreadParams }) | null;
  /** 適用結果。 */
  applied: { updated: number; unchanged: number } | null;
};

export const initialRespreadState: RespreadState = {
  error: null,
  preview: null,
  applied: null,
};

export function platformsForMode(mode: RespreadPlatformMode): string[] {
  return mode === "both" ? ["google", "yahoo"] : [mode];
}

export function parseRespreadParams(formData: FormData): ParseResult<RespreadParams> {
  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!clientId) return { ok: false, error: "顧客が指定されていません。" };

  const platformMode = String(formData.get("platform_mode") ?? "google") as RespreadPlatformMode;
  if (!RESPREAD_PLATFORM_MODES.includes(platformMode)) {
    return { ok: false, error: "対象の検索エンジンが不正です。" };
  }

  const maxPerSlot = Number(String(formData.get("max_per_slot") ?? "").trim());
  if (!Number.isInteger(maxPerSlot) || maxPerSlot < 1 || maxPerSlot > 200) {
    return { ok: false, error: "1枠あたりの上限は 1〜200 の整数で入力してください。" };
  }

  const spreadStart = String(formData.get("spread_start") ?? "06:00");
  const spreadEnd = String(formData.get("spread_end") ?? "23:00");
  if (!TIME_OPTIONS.includes(spreadStart) || !TIME_OPTIONS.includes(spreadEnd)) {
    return { ok: false, error: "時間帯は 15 分刻みの時刻で指定してください。" };
  }
  if (spreadEnd < spreadStart) {
    return { ok: false, error: "終了時刻は開始時刻と同じか、それより後にしてください。" };
  }

  return {
    ok: true,
    data: {
      clientId,
      platformMode,
      platforms: platformsForMode(platformMode),
      maxPerSlot,
      spreadStart,
      spreadEnd,
    },
  };
}

export type AssignmentInput = { id: string; times: string[] };

/**
 * 画面が持っていたドライランの割り当て（schedule_id → times）を読む。
 * 適用は「見せたものと同じ内容」だけを書くためのもの。
 */
export function parseAssignments(raw: string): ParseResult<AssignmentInput[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "ドライランの内容を読み取れませんでした。もう一度プレビューしてください。" };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "ドライランの内容を読み取れませんでした。もう一度プレビューしてください。" };
  }
  const assignments: AssignmentInput[] = [];
  for (const entry of parsed as { id?: unknown; times?: unknown }[]) {
    const id = String(entry?.id ?? "").trim();
    const times = Array.isArray(entry?.times) ? entry.times.map((value) => String(value)) : [];
    if (!id || times.length === 0 || !times.every(isValidSlot)) {
      return { ok: false, error: "割り当てに不正な時刻が含まれています。もう一度プレビューしてください。" };
    }
    assignments.push({ id, times: [...new Set(times)].sort() });
  }
  if (assignments.length === 0) {
    return { ok: false, error: "適用する変更がありません。" };
  }
  return { ok: true, data: assignments };
}
