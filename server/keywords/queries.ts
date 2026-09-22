import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Keyword } from "@/lib/types";

export async function listKeywords(clientId: string): Promise<Keyword[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("keywords")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`キーワードの取得に失敗しました: ${error.message}`);
  return data ?? [];
}

/** ダッシュボード用。複数顧客分をまとめて引く。 */
export async function listKeywordsByClientIds(
  clientIds: string[],
): Promise<Keyword[]> {
  if (clientIds.length === 0) return [];

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("keywords")
    .select("*")
    .in("client_id", clientIds)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`キーワードの取得に失敗しました: ${error.message}`);
  return data ?? [];
}
