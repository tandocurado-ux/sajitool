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
