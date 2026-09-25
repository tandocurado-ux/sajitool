import type { User } from "@supabase/supabase-js";
import type { RunStatus } from "./types";

/**
 * 即時計測（スケジュールの時刻枠を待たずに1件だけ撃つ）の受け渡し。
 *
 * スキーマを変えない制約のため、キューは DB のテーブルではなく Supabase Auth の
 * ユーザー metadata に置く。
 *
 *   - 依頼:   user_metadata.immediate_queue  … 画面（本人）が積む。
 *   - 進捗:   app_metadata.immediate_runs    … 計測エンジン（service_role）だけが書く。
 *
 * app_metadata は本人には書けないので、結果を画面側から偽装できない。
 * 実行そのものと runs への記録は定時実行と同じ経路（runner）を使う。
 */

export const IMMEDIATE_QUEUE_KEY = "immediate_queue";
export const IMMEDIATE_RUNS_KEY = "immediate_runs";

/** 1ユーザーが同時に積める依頼の上限（連打・濫用防止）。 */
export const IMMEDIATE_QUEUE_LIMIT = 5;
/** app_metadata に残す進捗の件数。古いものから消える。 */
export const IMMEDIATE_HISTORY_LIMIT = 20;

export type ImmediateRequest = {
  id: string;
  schedule_id: string;
  requested_at: string;
};

export type ImmediateRunResult = {
  status: RunStatus | string;
  result_count: number;
  exit_ip: string | null;
  final_url: string;
  error: string | null;
  run_id: string | null;
  attempts: number;
};

export type ImmediateRunPhase = "queued" | "running" | "done" | "failed";

export type ImmediateRun = {
  id: string;
  schedule_id: string;
  status: ImmediateRunPhase;
  requested_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  result?: ImmediateRunResult | null;
  /** failed のときの理由。 */
  error?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readImmediateQueue(user: User | null | undefined): ImmediateRequest[] {
  const raw = asRecord(user?.user_metadata)[IMMEDIATE_QUEUE_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => asRecord(entry))
    .filter((entry) => typeof entry.id === "string" && typeof entry.schedule_id === "string")
    .map((entry) => ({
      id: String(entry.id),
      schedule_id: String(entry.schedule_id),
      requested_at: String(entry.requested_at ?? ""),
    }));
}

export function readImmediateRuns(user: User | null | undefined): Record<string, ImmediateRun> {
  const raw = asRecord(asRecord(user?.app_metadata)[IMMEDIATE_RUNS_KEY]);
  const runs: Record<string, ImmediateRun> = {};
  for (const [id, value] of Object.entries(raw)) {
    const entry = asRecord(value);
    if (typeof entry.schedule_id !== "string") continue;
    runs[id] = {
      id,
      schedule_id: entry.schedule_id,
      status: (["queued", "running", "done", "failed"].includes(String(entry.status))
        ? String(entry.status)
        : "running") as ImmediateRunPhase,
      requested_at: String(entry.requested_at ?? ""),
      started_at: entry.started_at ? String(entry.started_at) : null,
      finished_at: entry.finished_at ? String(entry.finished_at) : null,
      result: entry.result ? (entry.result as ImmediateRunResult) : null,
      error: entry.error ? String(entry.error) : null,
    };
  }
  return runs;
}

/** 依頼 id の現在の状態。まだキューにあれば queued、無ければ null。 */
export function findImmediateRun(user: User | null | undefined, requestId: string): ImmediateRun | null {
  const runs = readImmediateRuns(user);
  if (runs[requestId]) return runs[requestId];
  const queued = readImmediateQueue(user).find((entry) => entry.id === requestId);
  if (queued) {
    return { id: queued.id, schedule_id: queued.schedule_id, status: "queued", requested_at: queued.requested_at };
  }
  return null;
}

/** そのスケジュールに実行待ち／実行中の依頼があれば返す（連打防止）。 */
export function activeImmediateRunFor(
  user: User | null | undefined,
  scheduleId: string,
): ImmediateRun | null {
  const queued = readImmediateQueue(user).find((entry) => entry.schedule_id === scheduleId);
  if (queued) {
    return { id: queued.id, schedule_id: scheduleId, status: "queued", requested_at: queued.requested_at };
  }
  for (const run of Object.values(readImmediateRuns(user))) {
    if (run.schedule_id === scheduleId && run.status === "running") return run;
  }
  return null;
}

export function isImmediateRunFinished(run: ImmediateRun | null): boolean {
  return run !== null && (run.status === "done" || run.status === "failed");
}
