import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Region } from "@/lib/types";
import { compareAsc, fetchInChunks, queryFailure } from "@/server/supabase-query";

export async function listRegions(clientId: string): Promise<Region[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("regions")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });

  if (error) throw queryFailure("地域の取得に失敗しました", error);
  return data ?? [];
}

/**
 * ダッシュボード用。複数顧客分をまとめて引く。
 *
 * client_id は IN_CHUNK_SIZE 件ずつに分けて投げるので、顧客が何百件に
 * なっても URL 長で 400 にならない。結果は created_at 昇順に並べ直す。
 */
export async function listRegionsByClientIds(
  clientIds: string[],
): Promise<Region[]> {
  if (clientIds.length === 0) return [];

  const supabase = await createSupabaseServerClient();
  const rows = await fetchInChunks(clientIds, async (ids) => {
    const { data, error } = await supabase
      .from("regions")
      .select("*")
      .in("client_id", ids)
      .order("created_at", { ascending: true });
    if (error) throw queryFailure("地域の取得に失敗しました", error);
    return (data ?? []) as Region[];
  });
  return rows.sort((a, b) => compareAsc(a.created_at, b.created_at));
}
