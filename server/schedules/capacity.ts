import { listClients } from "@/server/clients/queries";
import { listKeywordsByClientIds } from "@/server/keywords/queries";
import { listSchedulesByKeywordIds } from "@/server/schedules/queries";
import { isAllowedCombination } from "@/lib/device-policy";
import type { Device, Platform } from "@/lib/types";

/** platform → 1日の実行回数（有効なスケジュールの times の総数）。 */
export type DailyRunsByPlatform = Record<string, number>;

/**
 * このアカウント全体の「1日の登録量」を platform 別に数える。
 *
 * 計測エンジンは全顧客のスケジュールを1本で消化するので、消化能力との比較は
 * 顧客単位ではなくアカウント全体で見る必要がある。無効なスケジュールと、
 * 実行されない組み合わせ（Google × pc）は数えない。
 */
export async function getDailyRunsByPlatform(): Promise<DailyRunsByPlatform> {
  const clients = await listClients();
  if (clients.length === 0) return {};
  const keywords = await listKeywordsByClientIds(clients.map((client) => client.id));
  const schedules = await listSchedulesByKeywordIds(keywords.map((keyword) => keyword.id));
  const platformByKeyword = new Map(keywords.map((keyword) => [keyword.id, keyword.platform]));

  const runs: DailyRunsByPlatform = {};
  for (const schedule of schedules) {
    if (!schedule.enabled) continue;
    const platform = platformByKeyword.get(schedule.keyword_id);
    if (!platform) continue;
    if (!isAllowedCombination(platform as Platform, schedule.device as Device)) continue;
    const times = Array.isArray(schedule.times) ? schedule.times.length : 0;
    runs[platform] = (runs[platform] ?? 0) + times;
  }
  return runs;
}
