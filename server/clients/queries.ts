import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Client } from "@/lib/types";

export async function listClients(): Promise<Client[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`顧客一覧の取得に失敗しました: ${error.message}`);
  return data ?? [];
}

export async function getClientById(id: string): Promise<Client | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`顧客の取得に失敗しました: ${error.message}`);
  return data;
}

/**
 * RLS により自分の顧客しか select できないので、
 * 行が取れること自体が所有権の証明になる。
 */
export async function isClientOwned(
  supabase: SupabaseClient,
  clientId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();
  return Boolean(data);
}
