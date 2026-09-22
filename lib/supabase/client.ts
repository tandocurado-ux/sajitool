"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "./env";

/** ブラウザ（Client Component）用の Supabase クライアント。 */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = requireSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
