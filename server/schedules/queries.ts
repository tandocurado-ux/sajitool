import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Schedule } from "@/lib/types";
import { compareAsc, fetchInChunks, queryFailure } from "@/server/supabase-query";

/**
 * schedules には client_id が無いため、顧客配下のキーワード id で絞り込む。
 * PostgREST の埋め込み（!inner）に頼らないので FK 定義の有無に左右されない。
 *
 * keyword_id は IN_CHUNK_SIZE 件ずつに分けて投げるので、キーワードが
 * 数千件になっても URL 長で 400 にならない。結果は created_at 昇順に
 * 並べ直す（1回で引いたときと同じ順序）。
 */
export async function listSchedulesByKeywordIds(
  keywordIds: string[],
): Promise<Schedule[]> {
  if (keywordIds.length === 0) return [];

  const supabase = await createSupabaseServerClient();
  const rows = await fetchInChunks(keywordIds, async (ids) => {
    const { data, error } = await supabase
      .from("schedules")
      .select("*")
      .in("keyword_id", ids)
      .order("created_at", { ascending: true });
    if (error) throw queryFailure("スケジュールの取得に失敗しました", error);
    return (data ?? []) as Schedule[];
  });
  return rows.sort((a, b) => compareAsc(a.created_at, b.created_at));
}
