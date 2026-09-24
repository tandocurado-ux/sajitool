import Link from "next/link";
import { getDashboardOverview } from "@/server/runs/queries";
import { getClientsOverview } from "@/server/clients/queries";
import { RunStatusBadge } from "@/components/run-status-badge";
import { SuccessRate } from "@/components/daily-progress";
import { cardClass } from "@/components/ui";
import { formatRate, formatRunAt, type RunSummary } from "@/lib/runs";
import {
  DEVICE_LABELS,
  PLATFORM_LABELS,
  RUN_STATUS_LABELS,
  RUN_STATUSES,
  type RunStatus,
} from "@/lib/types";

export const metadata = {
  title: "ダッシュボード | サジェツール",
};

/** 内訳タイルの見出し色。blocked と error を色でも見分けられるようにする。 */
const STATUS_LABEL_CLASSES: Record<RunStatus, string> = {
  ok: "text-ok",
  blocked: "text-danger",
  error: "text-warn",
};

function SummaryCard({ title, summary }: { title: string; summary: RunSummary }) {
  return (
    <section className={cardClass}>
      <h2 className="text-sm font-semibold tracking-tight text-fg">{title}</h2>

      {summary.total === 0 ? (
        <>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-subtle">-</p>
          <p className="mt-3 text-sm text-subtle">この期間の実行はありません。</p>
        </>
      ) : (
        <>
          <p className="mt-2 flex items-baseline gap-2">
            <SuccessRate rate={summary.successRate} className="text-2xl tracking-tight tabular-nums" />
            <span className="text-sm text-subtle">成功率</span>
          </p>
          <p className="mt-1 text-sm text-muted">
            成功 {summary.counts.ok} / 実行 {summary.total} 件
          </p>

          <dl className="mt-3 grid grid-cols-3 gap-2">
            {RUN_STATUSES.map((status) => (
              <div key={status} className="rounded-md border border-line px-3 py-2">
                <dt className={`text-xs font-medium ${STATUS_LABEL_CLASSES[status]}`}>
                  {RUN_STATUS_LABELS[status]}
                  <span className="ml-1 font-normal text-subtle">{status}</span>
                </dt>
                <dd className="text-lg font-semibold tracking-tight tabular-nums text-fg">
                  {summary.counts[status]}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-subtle">
            ブロック率{" "}
            <span
              className={
                summary.blockedRate > 0 ? "font-medium text-danger" : undefined
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

const TABS = ["summary", "matrix"] as const;
type DashboardTab = (typeof TABS)[number];

const TAB_LABELS: Record<DashboardTab, string> = {
  summary: "ホーム",
  matrix: "地域比較",
};

function normalizeTab(raw: string | string[] | undefined): DashboardTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return TABS.includes(value as DashboardTab) ? (value as DashboardTab) : "summary";
}

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const tab = normalizeTab((await props.searchParams).tab);

  if (tab === "matrix") {
    // 地域比較は顧客ごとの表なので、ここでは顧客を選ばせる。
    const clients = await getClientsOverview();
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">地域比較</h1>
          <p className="mt-1 text-sm text-subtle">
            キーワード × 地域の実行状況を見る顧客を選んでください。
          </p>
        </div>

        <nav className="flex gap-1 border-b border-line">
          {TABS.map((name) => (
            <Link
              key={name}
              href={name === "summary" ? "/dashboard" : `/dashboard?tab=${name}`}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                name === tab
                  ? "border-accent text-fg"
                  : "border-transparent text-subtle hover:text-fg"
              }`}
            >
              {TAB_LABELS[name]}
            </Link>
          ))}
        </nav>

        <section className={cardClass}>
          {clients.length === 0 ? (
            <p className="text-sm text-subtle">まだ顧客が登録されていません。</p>
          ) : (
            <ul className="divide-y divide-line">
              {clients.map((row) => (
                <li
                  key={row.client.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-fg">
                      {row.client.name}
                    </p>
                    <p className="text-xs text-subtle">
                      キーワード {row.keywordCount} 件 ／ 地域 {row.regionCount} 件 ／
                      スケジュール {row.enabledScheduleCount} / {row.scheduleCount}
                    </p>
                  </div>
                  <Link
                    href={`/clients/${row.client.id}?tab=matrix`}
                    className="text-sm text-accent underline-offset-4 hover:underline"
                  >
                    地域比較を開く
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  const overview = await getDashboardOverview();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">ホーム</h1>
        <p className="mt-1 text-sm text-subtle">
          計測エンジンの実行状況をまとめて確認できます。
        </p>
      </div>

      <nav className="flex gap-1 border-b border-line">
        {TABS.map((name) => (
          <Link
            key={name}
            href={name === "summary" ? "/dashboard" : `/dashboard?tab=${name}`}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              name === tab
                ? "border-accent text-fg"
                : "border-transparent text-subtle hover:text-fg"
            }`}
          >
            {TAB_LABELS[name]}
          </Link>
        ))}
      </nav>

      {overview.warning ? (
        <div
          role="alert"
          className="rounded-lg border border-danger-line bg-danger-soft px-5 py-4"
        >
          <p className="text-sm font-semibold text-danger">
            ブロック率が高くなっています（{overview.warning.window}:{" "}
            {formatRate(overview.warning.rate)}）
          </p>
          <p className="mt-1 text-sm text-danger">
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
        <h2 className="mb-3 text-sm font-semibold tracking-tight text-fg">
          直近の実行（最大20件）
        </h2>

        {overview.recentRows.length === 0 ? (
          <p className="text-sm text-subtle">
            {overview.hasSchedules
              ? "まだ実行がありません。"
              : "まだスケジュールが登録されていないため、実行がありません。"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs font-medium tracking-wide text-subtle">
                  <th className="whitespace-nowrap py-2 pr-4 font-medium">日時</th>
                  <th className="whitespace-nowrap py-2 pr-4 font-medium">顧客</th>
                  <th className="whitespace-nowrap py-2 pr-4 font-medium">キーワード</th>
                  <th className="whitespace-nowrap py-2 pr-4 font-medium">地域</th>
                  <th className="whitespace-nowrap py-2 pr-4 font-medium">デバイス</th>
                  <th className="whitespace-nowrap py-2 pr-4 font-medium">結果</th>
                  <th className="whitespace-nowrap py-2 font-medium">exit IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
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
                    <tr key={run.id} className="transition-colors hover:bg-hover">
                      <td className="whitespace-nowrap py-2 pr-4 text-muted">
                        {formatRunAt(run.run_at)}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4">
                        {clientId ? (
                          <Link
                            href={`/clients/${clientId}?tab=runs`}
                            className="text-fg underline-offset-4 hover:text-accent hover:underline"
                          >
                            {clientName}
                          </Link>
                        ) : (
                          <span className="text-subtle">{clientName}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-fg">
                        {keyword}
                        <span className="ml-1 text-xs text-subtle">
                          （{PLATFORM_LABELS[platform] ?? platform}）
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4 text-muted">{regionLabel}</td>
                      <td className="whitespace-nowrap py-2 pr-4 text-muted">
                        {DEVICE_LABELS[device] ?? device}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4">
                        <RunStatusBadge status={run.status} />
                      </td>
                      <td className="whitespace-nowrap py-2 text-muted">
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
