import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  RUN_STATUSES,
  type Client,
  type Keyword,
  type Region,
  type Run,
  type RunStatus,
  type Schedule,
} from "@/lib/types";
import {
  buildDailyProgress,
  countDueSlots,
  emptyRunCounts,
  hoursAgo,
  jstDateKey,
  summaryFromCounts,
  type DailyProgress,
} from "@/lib/runs";
import { listKeywordsByClientIds } from "@/server/keywords/queries";
import { listRegionsByClientIds } from "@/server/regions/queries";
import { listSchedulesByKeywordIds } from "@/server/schedules/queries";
import { listRunsByScheduleIds } from "@/server/runs/queries";

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

// --------------------------------------------------------------------------
// 顧客一覧の集計
// --------------------------------------------------------------------------

/** 「直近実行」を探す範囲。これより古い実行は「-」になる。 */
export const CLIENT_RUN_WINDOW_DAYS = 7;

export type ClientOverviewRow = {
  client: Client;
  keywordCount: number;
  googleKeywords: number;
  yahooKeywords: number;
  regionCount: number;
  scheduleCount: number;
  enabledScheduleCount: number;
  lastRunAt: string | null;
  lastRunStatus: RunStatus | null;
  /** 当日（JST）の実行内訳と、現在時刻までの予定枠に対する消化状況。 */
  today: DailyProgress;
};

/** 集計中だけ使う作業用の行。today は最後に率へ直す。 */
type OverviewDraft = Omit<ClientOverviewRow, "today"> & {
  todayCounts: Record<RunStatus, number>;
  todayPlanned: number;
};

/**
 * 顧客一覧に出す集計をまとめて取る。
 *
 * 顧客ごとにクエリを投げると件数ぶん往復するので、
 * clients / keywords / regions / schedules / runs をそれぞれ1回だけ引いて
 * メモリ上で突き合わせる（顧客が何百件でもクエリ数は変わらない）。
 */
export async function getClientsOverview(): Promise<ClientOverviewRow[]> {
  const clients = await listClients();
  if (clients.length === 0) return [];

  const clientIds = clients.map((client) => client.id);
  const [keywords, regions] = await Promise.all([
    listKeywordsByClientIds(clientIds),
    listRegionsByClientIds(clientIds),
  ]);

  const schedules = await listSchedulesByKeywordIds(
    keywords.map((keyword) => keyword.id),
  );
  const runs = await listRunsByScheduleIds(
    schedules.map((schedule) => schedule.id),
    { since: hoursAgo(24 * CLIENT_RUN_WINDOW_DAYS) },
  );

  return aggregateClientsOverview(
    { clients, keywords, regions, schedules, runs },
    new Date(),
  );
}

export type ClientsOverviewSource = {
  clients: Client[];
  keywords: Keyword[];
  regions: Region[];
  schedules: Schedule[];
  /** run_at の降順で並んでいること（最初に見たものを直近実行とみなす）。 */
  runs: Run[];
};

/**
 * 取得済みの行を顧客ごとに集計する純粋関数（DB には触らない）。
 *
 * 実行履歴が0件の顧客、created_at や times が null の行、status が想定外の
 * run が混ざっていても例外にしない。ここで落ちると顧客一覧ページごと
 * 表示できなくなる（本番で「A server error occurred」になった）。
 */
export function aggregateClientsOverview(
  source: ClientsOverviewSource,
  now: Date,
): ClientOverviewRow[] {
  const { clients, keywords, regions, schedules, runs } = source;

  const clientIdByKeyword = new Map(
    keywords.map((keyword) => [keyword.id, keyword.client_id]),
  );
  const clientIdBySchedule = new Map<string, string>();
  for (const schedule of schedules) {
    const clientId = clientIdByKeyword.get(schedule.keyword_id);
    if (clientId) clientIdBySchedule.set(schedule.id, clientId);
  }

  const today = jstDateKey(now);

  const rows = new Map<string, OverviewDraft>(
    clients.map((client) => [
      client.id,
      {
        client,
        keywordCount: 0,
        googleKeywords: 0,
        yahooKeywords: 0,
        regionCount: 0,
        scheduleCount: 0,
        enabledScheduleCount: 0,
        lastRunAt: null,
        lastRunStatus: null,
        todayCounts: emptyRunCounts(),
        todayPlanned: 0,
      },
    ]),
  );

  for (const keyword of keywords) {
    const row = rows.get(keyword.client_id);
    if (!row) continue;
    row.keywordCount += 1;
    if (keyword.platform === "google") row.googleKeywords += 1;
    if (keyword.platform === "yahoo") row.yahooKeywords += 1;
  }

  for (const region of regions) {
    const row = rows.get(region.client_id);
    if (row) row.regionCount += 1;
  }

  for (const schedule of schedules) {
    const clientId = clientIdBySchedule.get(schedule.id);
    const row = clientId ? rows.get(clientId) : undefined;
    if (!row) continue;
    row.scheduleCount += 1;
    if (schedule.enabled) row.enabledScheduleCount += 1;
    // 「予定」は現在時刻までに来ているはずの枠数（有効なスケジュールのみ）。
    row.todayPlanned += countDueSlots(schedule, now);
  }

  // runs は run_at の降順で返るので、最初に見たものがその顧客の直近実行。
  for (const run of runs) {
    const clientId = clientIdBySchedule.get(run.schedule_id);
    const row = clientId ? rows.get(clientId) : undefined;
    if (!row) continue;

    const status = RUN_STATUSES.includes(run.status) ? run.status : null;
    if (row.lastRunAt === null && typeof run.run_at === "string") {
      row.lastRunAt = run.run_at;
      row.lastRunStatus = status;
    }
    if (status && today !== "" && jstDateKey(run.run_at) === today) {
      row.todayCounts[status] += 1;
    }
  }

  return clients.map((client) => {
    const { todayCounts, todayPlanned, ...rest } = rows.get(client.id)!;
    return {
      ...rest,
      today: buildDailyProgress(summaryFromCounts(todayCounts), todayPlanned),
    };
  });
}
