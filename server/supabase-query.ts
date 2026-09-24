import type { PostgrestError } from "@supabase/supabase-js";

/**
 * `.in("col", ids)` に渡す ID の1回あたりの上限。
 *
 * PostgREST は `col=in.(id1,id2,...)` をクエリ文字列に展開するため、
 * ID を数百件まとめて渡すと URL が長すぎて 400（Bad Request）になる
 * （本番で schedules 614 件ぶんの runs 取得が落ちた）。
 * UUID 1件は約37文字なので、100件でも 4KB 弱に収まり、一般的な
 * URL 上限（8KB）を超えない。スケジュールや runs が数千件になっても、
 * 件数に応じてリクエスト回数が増えるだけで URL 長は一定に保たれる。
 */
export const IN_CHUNK_SIZE = 100;

/** 同時に投げるチャンク数。多すぎると PostgREST 側の接続を食う。 */
const CHUNK_CONCURRENCY = 4;

export function chunk<T>(items: readonly T[], size: number = IN_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * ID の配列をチャンクに分けて fetch を呼び、結果を連結して返す。
 *
 * 重複 ID は先に落とす（同じ行が複数チャンクから返らないように）。
 * 並び順はチャンク順になるので、呼び出し側で必要な順に並べ直すこと。
 */
export async function fetchInChunks<Id, Row>(
  ids: readonly Id[],
  fetch: (ids: Id[]) => Promise<Row[]>,
): Promise<Row[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const chunks = chunk(unique);
  const results: Row[][] = new Array(chunks.length);
  let cursor = 0;

  async function worker() {
    while (cursor < chunks.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fetch(chunks[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, worker),
  );
  return results.flat();
}

/** PostgREST の error を、原因が分かる1行にする（message だけで包まない）。 */
export function describeQueryError(error: PostgrestError): string {
  const parts = [error.message || "(message なし)"];
  if (error.code) parts.push(`code=${error.code}`);
  if (error.details) parts.push(`details=${error.details}`);
  if (error.hint) parts.push(`hint=${error.hint}`);
  return parts.join(" / ");
}

/**
 * クエリ失敗時に使う。サーバーログに message / code / details / hint を
 * すべて出してから、同じ情報を含んだ Error を返す（呼び出し側で throw する）。
 */
export function queryFailure(context: string, error: PostgrestError): Error {
  const described = describeQueryError(error);
  console.error(`[supabase] ${context}: ${described}`, {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  });
  return new Error(`${context}: ${described}`);
}

/** PostgREST の `order(col, { ascending: true })` と同じ並び（null は最後）。 */
export function compareAsc(a: string | null | undefined, b: string | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** PostgREST の `order(col, { ascending: false })` と同じ並び（null は最後）。 */
export function compareDesc(a: string | null | undefined, b: string | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a > b ? -1 : a < b ? 1 : 0;
}
