import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "./env";

/**
 * Server Component / Server Action / Route Handler 用のクライアント。
 * リクエストごとに必ず新しく生成すること（使い回し禁止）。
 * anon key のみを使い、認可は RLS に任せる。
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = requireSupabaseEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component からは Cookie を書けない。
          // セッション更新は proxy.ts が行うため、ここは無視してよい。
        }
      },
    },
  });
}
