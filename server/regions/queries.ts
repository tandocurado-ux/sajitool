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
