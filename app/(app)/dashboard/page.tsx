import Link from "next/link";
import { getDashboardOverview } from "@/server/runs/queries";
import { RunStatusBadge } from "@/components/run-status-badge";
import { cardClass } from "@/components/ui";
import { formatRate, formatRunAt, type RunSummary } from "@/lib/runs";
import {
  DEVICE_LABELS,
  PLATFORM_LABELS,
  RUN_STATUS_LABELS,
  RUN_STATUSES,
} from "@/lib/types";

export const metadata = {
  title: "ダッシュボード | サジェツール",
};

function SummaryCard({ title, summary }: { title: string; summary: RunSummary }) {
  return (
    <section className={cardClass}>
      <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
      <p className="mt-2 text-3xl font-semibold text-neutral-900">
        {summary.total}
        <span className="ml-1 text-sm font-normal text-neutral-500">件</span>
      </p>

      {summary.total === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">この期間の実行はありません。</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-3 gap-2">
            {RUN_STATUSES.map((status) => (
              <div key={status} className="rounded border border-neutral-200 px-3 py-2">
                <dt className="text-xs text-neutral-500">
                  {RUN_STATUS_LABELS[status]}
                </dt>
                <dd className="text-lg font-semibold text-neutral-900">
                  {summary.counts[status]}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-neutral-500">
            成功率 {formatRate(summary.successRate)} ／ ブロック率{" "}
            <span
              className={
                summary.blockedRate > 0 ? "font-medium text-red-600" : undefined
              }
            >
              {formatRate(summary.blockedRate)}
            </span>
          </p>
        </>
      )}
    </section>
  );
}

export default async function DashboardPage() {
  const overview = await getDashboardOverview();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">ダッシュボード</h1>
        <p className="mt-1 text-sm text-neutral-500">
          計測エンジンの実行状況をまとめて確認できます。
        </p>
      </div>

      {overview.warning ? (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-5 py-4"
        >
          <p className="text-sm font-semibold text-red-700">
            ブロック率が高くなっています（{overview.warning.window}:{" "}
            {formatRate(overview.warning.rate)}）
          </p>
          <p className="mt-1 text-sm text-red-700">
            {overview.warning.total} 件中 {overview.warning.blocked}{" "}
            件がボット検知でブロックされました。プロキシの exit IP
            や実行間隔を見直してください。
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <SummaryCard title="直近24時間" summary={overview.day} />
        <SummaryCard title="直近7日間" summary={overview.week} />
      </div>

      <section className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">
          直近の実行（最大20件）
        </h2>

        {overview.recentRows.length === 0 ? (
          <p className="text-sm text-neutral-500">
            {overview.hasSchedules
              ? "まだ実行がありません。"
              : "まだスケジュールが登録されていないため、実行がありません。"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-xs text-neutral-500">
                  <th className="py-2 pr-4 font-medium">日時</th>
                  <th className="py-2 pr-4 font-medium">顧客</th>
                  <th className="py-2 pr-4 font-medium">キーワード</th>
                  <th className="py-2 pr-4 font-medium">地域</th>
                  <th className="py-2 pr-4 font-medium">デバイス</th>
                  <th className="py-2 pr-4 font-medium">結果</th>
                  <th className="py-2 font-medium">exit IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {overview.recentRows.map(
                  ({
                    run,
                    clientId,
                    clientName,
                    keyword,
                    platform,
                    regionLabel,
                    device,
                  }) => (
                    <tr key={run.id}>
                      <td className="whitespace-nowrap py-2 pr-4 text-neutral-600">
                        {formatRunAt(run.run_at)}
                      </td>
                      <td className="py-2 pr-4">
                        {clientId ? (
                          <Link
                            href={`/clients/${clientId}?tab=runs`}
                            className="text-neutral-900 underline-offset-4 hover:underline"
                          >
                            {clientName}
                          </Link>
                        ) : (
                          <span className="text-neutral-500">{clientName}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-neutral-900">
                        {keyword}
                        <span className="ml-1 text-xs text-neutral-500">
                          （{PLATFORM_LABELS[platform] ?? platform}）
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-neutral-600">{regionLabel}</td>
                      <td className="py-2 pr-4 text-neutral-600">
                        {DEVICE_LABELS[device] ?? device}
                      </td>
                      <td className="py-2 pr-4">
                        <RunStatusBadge status={run.status} />
                      </td>
                      <td className="whitespace-nowrap py-2 text-neutral-600">
                        {run.exit_ip ?? "-"}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
