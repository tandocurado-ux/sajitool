import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Keyword } from "@/lib/types";
import { compareAsc, fetchInChunks, queryFailure } from "@/server/supabase-query";

export async function listKeywords(clientId: string): Promise<Keyword[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("keywords")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });

  if (error) throw queryFailure("キーワードの取得に失敗しました", error);
  return data ?? [];
}

/**
 * ダッシュボード用。複数顧客分をまとめて引く。
 *
 * client_id は IN_CHUNK_SIZE 件ずつに分けて投げるので、顧客が何百件に
 * なっても URL 長で 400 にならない。結果は created_at 昇順に並べ直す
 * （1回で引いたときと同じ順序）。
 */
export async function listKeywordsByClientIds(
  clientIds: string[],
): Promise<Keyword[]> {
  if (clientIds.length === 0) return [];

  const supabase = await createSupabaseServerClient();
  const rows = await fetchInChunks(clientIds, async (ids) => {
    const { data, error } = await supabase
      .from("keywords")
      .select("*")
      .in("client_id", ids)
      .order("created_at", { ascending: true });
    if (error) throw queryFailure("キーワードの取得に失敗しました", error);
    return (data ?? []) as Keyword[];
  });
  return rows.sort((a, b) => compareAsc(a.created_at, b.created_at));
}
