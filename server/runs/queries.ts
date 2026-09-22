import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Device, Platform, Run } from "@/lib/types";
import {
  BLOCKED_RATE_THRESHOLD,
  hoursAgo,
  isSince,
  parseRunAt,
  summarizeRuns,
  type RunSummary,
} from "@/lib/runs";
import { listClients } from "@/server/clients/queries";
import { listKeywordsByClientIds } from "@/server/keywords/queries";
import { listRegionsByClientIds } from "@/server/regions/queries";
import { listSchedulesByKeywordIds } from "@/server/schedules/queries";

type ListOptions = {
  /** この日時以降の実行だけを取る。 */
  since?: Date;
  limit?: number;
};

/**
 * runs には client_id が無いため、顧客配下のスケジュール id で絞り込む。
 * RLS に加えて、呼び出し側が自分の顧客から辿った id だけを渡している。
 */
export async function listRunsByScheduleIds(
  scheduleIds: string[],
  { since, limit }: ListOptions = {},
): Promise<Run[]> {
  if (scheduleIds.length === 0) return [];

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("runs")
    .select("*")
    .in("schedule_id", scheduleIds)
    .order("run_at", { ascending: false });

  if (since) query = query.gte("run_at", since.toISOString());
  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(`実行履歴の取得に失敗しました: ${error.message}`);
  return data ?? [];
}

/** 期間指定と件数指定の結果をまとめ、id の重複を除いて新しい順に並べる。 */
export function mergeRuns(...groups: Run[][]): Run[] {
  const byId = new Map<string, Run>();
  for (const group of groups) {
    for (const run of group) byId.set(run.id, run);
  }
  return [...byId.values()].sort(
    (a, b) => parseRunAt(b.run_at).getTime() - parseRunAt(a.run_at).getTime(),
  );
}

export function groupRunsByScheduleId(runs: Run[]): Map<string, Run[]> {
  const grouped = new Map<string, Run[]>();
  for (const run of runs) {
    const list = grouped.get(run.schedule_id);
    if (list) list.push(run);
    else grouped.set(run.schedule_id, [run]);
  }
  return grouped;
}

// --------------------------------------------------------------------------
// ダッシュボード用の組み立て
// --------------------------------------------------------------------------

export type DashboardRow = {
  run: Run;
  clientId: string;
  clientName: string;
  keyword: string;
  platform: Platform;
  regionLabel: string;
  device: Device;
};

export type DashboardOverview = {
  /** スケジュールが1つも無いのか、実行がまだ無いだけなのかを区別する。 */
  hasSchedules: boolean;
  day: RunSummary;
  week: RunSummary;
  recentRows: DashboardRow[];
  /** blocked 率がしきい値を超えている期間。問題なければ null。 */
  warning: { window: string; rate: number; blocked: number; total: number } | null;
};

const EMPTY_SUMMARY: RunSummary = {
  total: 0,
  counts: { ok: 0, blocked: 0, error: 0 },
  blockedRate: 0,
  successRate: 0,
};

function buildWarning(
  day: RunSummary,
  week: RunSummary,
): DashboardOverview["warning"] {
  // 直近24時間に実行があればそれを見る。無ければ7日間で判断する。
  const target = day.total > 0 ? { label: "直近24時間", summary: day } : { label: "直近7日間", summary: week };
  if (target.summary.total === 0) return null;
  if (target.summary.blockedRate <= BLOCKED_RATE_THRESHOLD) return null;
  return {
    window: target.label,
    rate: target.summary.blockedRate,
    blocked: target.summary.counts.blocked,
    total: target.summary.total,
  };
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const clients = await listClients();
  if (clients.length === 0) {
    return { hasSchedules: false, day: EMPTY_SUMMARY, week: EMPTY_SUMMARY, recentRows: [], warning: null };
  }

  const clientIds = clients.map((client) => client.id);
  const [keywords, regions] = await Promise.all([
    listKeywordsByClientIds(clientIds),
    listRegionsByClientIds(clientIds),
  ]);
  const schedules = await listSchedulesByKeywordIds(
    keywords.map((keyword) => keyword.id),
  );
  const scheduleIds = schedules.map((schedule) => schedule.id);

  if (scheduleIds.length === 0) {
    return { hasSchedules: false, day: EMPTY_SUMMARY, week: EMPTY_SUMMARY, recentRows: [], warning: null };
  }

  const [weekRuns, recentRuns] = await Promise.all([
    listRunsByScheduleIds(scheduleIds, { since: hoursAgo(24 * 7) }),
    listRunsByScheduleIds(scheduleIds, { limit: 20 }),
  ]);

  const since24h = hoursAgo(24);
  const day = summarizeRuns(weekRuns.filter((run) => isSince(run, since24h)));
  const week = summarizeRuns(weekRuns);

  const clientById = new Map(clients.map((client) => [client.id, client]));
  const keywordById = new Map(keywords.map((keyword) => [keyword.id, keyword]));
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));

  const recentRows: DashboardRow[] = recentRuns.map((run) => {
    const schedule = scheduleById.get(run.schedule_id);
    const keyword = schedule ? keywordById.get(schedule.keyword_id) : undefined;
    const region = schedule ? regionById.get(schedule.region_id) : undefined;
    const client = keyword ? clientById.get(keyword.client_id) : undefined;

    return {
      run,
      clientId: client?.id ?? "",
      clientName: client?.name ?? "(削除済み顧客)",
      keyword: keyword?.keyword ?? "(削除済みキーワード)",
      platform: keyword?.platform ?? "google",
      regionLabel: region?.label ?? "(削除済み地域)",
      device: schedule?.device ?? "pc",
    };
  });

  return {
    hasSchedules: true,
    day,
    week,
    recentRows,
    warning: buildWarning(day, week),
  };
}
