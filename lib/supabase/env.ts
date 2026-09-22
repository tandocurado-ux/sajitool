// NEXT_PUBLIC_* はビルド時にインライン展開されるため、
// process.env.X をそのままの式として参照する必要がある。
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** プレースホルダのままの .env.local も「未設定」として扱う。 */
export function isSupabaseConfigured(): boolean {
  return isHttpUrl(SUPABASE_URL) && Boolean(SUPABASE_ANON_KEY);
}

/**
 * クライアント生成時に呼ぶ。未設定ならモジュール読み込み時ではなく
 * 実行時に落ちるので、ビルド自体は環境変数なしでも通る。
 */
export function requireSupabaseEnv(): { url: string; anonKey: string } {
  if (!isHttpUrl(SUPABASE_URL) || !SUPABASE_ANON_KEY) {
    throw new Error(
      ".env.local の NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を、Supabase プロジェクトの実際の値に設定してください。",
    );
  }
  return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
}
