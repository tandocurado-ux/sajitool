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
