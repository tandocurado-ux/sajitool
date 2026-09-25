"use client";

import { useActionState, useEffect, useState } from "react";
import {
  getImmediateRunStatus,
  requestImmediateRun,
  type ImmediateRequestState,
} from "@/server/immediate/actions";
import { isImmediateRunFinished, type ImmediateRun } from "@/lib/immediate";
import { RUN_STATUSES, type RunStatus } from "@/lib/types";
import { RunStatusBadge } from "./run-status-badge";
import { subtleButtonClass } from "./ui";

/** ポーリング間隔。完了したら止める。 */
const POLL_INTERVAL_MS = 3000;
/** これ以上待っても進捗が来なければ「エンジンが動いていない可能性」を出す。 */
const STALE_AFTER_MS = 5 * 60 * 1000;

const initialState: ImmediateRequestState = { error: null, requestId: null, scheduleId: null };

/**
 * 依頼 id の進捗をポーリングして、その場に結果を出す。
 * 完了（done / failed）で止まる。
 */
export function ImmediateRunStatus({
  requestId,
  onFinished,
}: {
  requestId: string;
  onFinished?: (run: ImmediateRun | null) => void;
}) {
  const [run, setRun] = useState<ImmediateRun | null>(null);
  const [startedAt] = useState(() => Date.now());
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const next = await getImmediateRunStatus(requestId);
        if (cancelled) return;
        setRun(next);
        if (isImmediateRunFinished(next)) {
          onFinished?.(next);
          return;
        }
        if (Date.now() - startedAt > STALE_AFTER_MS) setStale(true);
      } catch {
        // 一時的な失敗は次のポーリングで拾う。
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    timer = setTimeout(poll, 500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [requestId, startedAt, onFinished]);

  if (!run) {
    return <p className="text-xs text-subtle">実行待ちに登録しました…</p>;
  }

  if (run.status === "queued" || run.status === "running") {
    return (
      <p className="text-xs text-muted" role="status">
        <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-accent align-middle" aria-hidden />
        {run.status === "queued" ? "実行待ち…（エンジンが次の確認で拾います）" : "実行中…"}
        {stale ? (
          <span className="ml-2 text-warn">
            5分以上進んでいません。計測エンジンが動いているか確認してください。
          </span>
        ) : null}
      </p>
    );
  }

  if (run.status === "failed") {
    return (
      <p className="text-xs text-danger" role="alert">
        実行できませんでした: {run.error ?? "不明なエラー"}
      </p>
    );
  }

  const result = run.result;
  const status: RunStatus | null =
    result && RUN_STATUSES.includes(result.status as RunStatus) ? (result.status as RunStatus) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" role="status">
      {status ? <RunStatusBadge status={status} /> : <span>{result?.status ?? "-"}</span>}
      <span>
        取得 <span className="tabular-nums">{result?.result_count ?? 0}</span> 件
      </span>
      <span>exit IP: {result?.exit_ip ?? "-"}</span>
      {result?.attempts && result.attempts > 1 ? <span>試行 {result.attempts} 回</span> : null}
      {result?.error ? <span className="text-warn">{result.error}</span> : null}
      {result?.final_url ? (
        <span className="max-w-full truncate" title={result.final_url}>
          URL: {result.final_url.slice(0, 80)}
          {result.final_url.length > 80 ? "…" : ""}
        </span>
      ) : null}
      {result?.run_id ? <span className="text-subtle">runs に記録済み</span> : null}
    </div>
  );
}

/**
 * スケジュール1件の「今すぐ実行」。押すとキューに積み、完了まで無効化する。
 */
export function ImmediateRunButton({ scheduleId }: { scheduleId: string }) {
  const [state, formAction, pending] = useActionState(requestImmediateRun, initialState);
  const [finished, setFinished] = useState<string | null>(null);

  const requestId = state.requestId;
  const inProgress = pending || (requestId !== null && finished !== requestId);

  return (
    <div className="flex flex-col items-start gap-1">
      <form action={formAction}>
        <input type="hidden" name="schedule_id" value={scheduleId} />
        <button
          type="submit"
          disabled={inProgress}
          className={subtleButtonClass}
          title="スケジュールの時刻を待たずに、この1件を今すぐ実行します"
        >
          {inProgress ? "実行中…" : "今すぐ実行"}
        </button>
      </form>
      {state.error ? (
        <span role="alert" className="text-xs text-danger">
          {state.error}
        </span>
      ) : null}
      {requestId ? (
        <ImmediateRunStatus
          key={requestId}
          requestId={requestId}
          onFinished={() => setFinished(requestId)}
        />
      ) : null}
    </div>
  );
}
