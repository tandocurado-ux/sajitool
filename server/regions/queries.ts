import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Region } from "@/lib/types";

export async function listRegions(clientId: string): Promise<Region[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("regions")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`地域の取得に失敗しました: ${error.message}`);
  return data ?? [];
}

/** ダッシュボード用。複数顧客分をまとめて引く。 */
export async function listRegionsByClientIds(
  clientIds: string[],
): Promise<Region[]> {
  if (clientIds.length === 0) return [];

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("regions")
    .select("*")
    .in("client_id", clientIds)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`地域の取得に失敗しました: ${error.message}`);
  return data ?? [];
}
