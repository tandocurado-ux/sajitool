import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Schedule } from "@/lib/types";

/**
 * schedules には client_id が無いため、顧客配下のキーワード id で絞り込む。
 * PostgREST の埋め込み（!inner）に頼らないので FK 定義の有無に左右されない。
 */
export async function listSchedulesByKeywordIds(
  keywordIds: string[],
): Promise<Schedule[]> {
  if (keywordIds.length === 0) return [];

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("schedules")
    .select("*")
    .in("keyword_id", keywordIds)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`スケジュールの取得に失敗しました: ${error.message}`);
  return data ?? [];
}
