import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** 認可判定は必ず getUser()（auth サーバー往復）で行う。getSession() は使わない。 */
export async function getUserFrom(
  supabase: SupabaseClient,
): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}

export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  return getUserFrom(supabase);
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
