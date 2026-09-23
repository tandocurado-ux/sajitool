export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function parseId(formData: FormData, key = "id"): ParseResult<string> {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) return { ok: false, error: "対象が指定されていません。" };
  return { ok: true, data: value };
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "09:00, 12:30" のような入力を ["09:00", "12:30"] に正規化する。 */
export function parseTimes(raw: string): ParseResult<string[]> {
  const parts = raw
    .split(/[,、\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return { ok: false, error: "時刻を1つ以上入力してください。（例: 09:00, 18:00）" };
  }

  const times: string[] = [];
  for (const part of parts) {
    if (!TIME_PATTERN.test(part)) {
      return {
        ok: false,
        error: `時刻の形式が正しくありません: ${part}（HH:MM 形式で入力してください）`,
      };
    }
    if (!times.includes(part)) times.push(part);
  }
  times.sort();
  return { ok: true, data: times };
}

/** Postgres の time 型は "09:00:00" で返るので HH:MM に詰める。 */
export function formatTime(value: string): string {
  return value.slice(0, 5);
}

/** テキストエリアの1行1キーワードを配列にする。空行と重複は落とす。 */
export function parseKeywordLines(raw: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const keyword = line.trim();
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    keywords.push(keyword);
  }
  return keywords;
}

/** 空文字なら null、数値でなければエラー。 */
export function parseOptionalNumber(
  raw: string,
  fieldLabel: string,
): ParseResult<number | null> {
  const value = raw.trim();
  if (!value) return { ok: true, data: null };

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: `${fieldLabel}は数値で入力してください。` };
  }
  return { ok: true, data: parsed };
}

/** 00:00〜23:45 の15分刻み（96択）。 */
export const TIME_OPTIONS: string[] = Array.from({ length: 96 }, (_, index) => {
  const hour = Math.floor(index / 4);
  const minute = (index % 4) * 15;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
});

/** start〜end（どちらも TIME_OPTIONS の値）の15分刻み枠を返す。 */
export function timeSlotsBetween(start: string, end: string): string[] {
  const from = TIME_OPTIONS.indexOf(start);
  const to = TIME_OPTIONS.indexOf(end);
  if (from < 0 || to < 0 || to < from) return [];
  return TIME_OPTIONS.slice(from, to + 1);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * 枠を1つずつ順に使うと、同じキーワードの数パターンが隣り合う枠に固まる。
 * 枠数と互いに素な歩幅で飛ばすと、全枠を均等に使いつつ離して配置できる。
 */
export function spreadStride(slotCount: number, groupSize = 4): number {
  if (slotCount <= 2) return 1;
  let stride = Math.max(1, Math.round(slotCount / groupSize));
  while (stride > 1 && gcd(stride, slotCount) !== 1) stride -= 1;
  return Math.max(1, stride);
}

/** index 番目のスケジュールに割り当てる時刻枠。 */
export function assignSpreadSlot(index: number, slots: string[]): string {
  if (slots.length === 0) return "";
  return slots[(index * spreadStride(slots.length)) % slots.length];
}

/**
 * index 番目のスケジュールに割り当てる時刻。rotations 回ぶん返す。
 *
 * 基準の枠は互いに素な歩幅で選び、そこから枠数 ÷ 回転数ずつ離す。
 * 1日3回なら朝・昼・夜のように散る。
 */
export function assignSpreadTimes(
  index: number,
  slots: string[],
  rotations: number,
): string[] {
  if (slots.length === 0) return [];
  const count = Math.max(1, Math.min(Math.trunc(rotations), slots.length));
  const base = (index * spreadStride(slots.length)) % slots.length;
  const step = Math.floor(slots.length / count);

  const times = new Set<string>();
  for (let turn = 0; turn < count; turn += 1) {
    times.add(slots[(base + turn * step) % slots.length]);
  }
  return [...times].sort();
}
