import Link from "next/link";
import { notFound } from "next/navigation";
import { getClientById } from "@/server/clients/queries";
import { listKeywords } from "@/server/keywords/queries";
import { listRegions } from "@/server/regions/queries";
import { listSchedulesByKeywordIds } from "@/server/schedules/queries";
import { removeKeyword } from "@/server/keywords/actions";
import { removeRegion } from "@/server/regions/actions";
import { removeSchedule } from "@/server/schedules/actions";
import { AddKeywordForm } from "@/components/add-keyword-form";
import { AddRegionForm } from "@/components/add-region-form";
import { AddScheduleForm } from "@/components/add-schedule-form";
import { ScheduleToggle } from "@/components/schedule-toggle";
import { DeleteButton } from "@/components/delete-button";
import { RunStatusBadge } from "@/components/run-status-badge";
import { cardClass } from "@/components/ui";
import {
  groupRunsByScheduleId,
  listRunsByScheduleIds,
  mergeRuns,
} from "@/server/runs/queries";
import { formatTime } from "@/lib/parse";
import {
  formatRate,
  formatRunAt,
  hoursAgo,
  isSince,
  summarizeRuns,
} from "@/lib/runs";
import { DEVICE_LABELS, PLATFORM_LABELS } from "@/lib/types";

const TABS = ["keywords", "regions", "schedules", "runs"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  keywords: "キーワード",
  regions: "地域",
  schedules: "スケジュール",
  runs: "実行履歴",
};

/** 実行履歴タブで各スケジュールに出す直近実行の件数。 */
const RECENT_RUNS_PER_SCHEDULE = 5;

function normalizeTab(raw: string | string[] | undefined): Tab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return TABS.includes(value as Tab) ? (value as Tab) : "keywords";
}

export default async function ClientDetailPage(
  props: PageProps<"/clients/[id]">,
) {
  const { id } = await props.params;
  const activeTab = normalizeTab((await props.searchParams).tab);

  const client = await getClientById(id);
  if (!client) notFound();

  const [keywords, regions] = await Promise.all([
    listKeywords(id),
    listRegions(id),
  ]);
  const schedules = await listSchedulesByKeywordIds(
    keywords.map((keyword) => keyword.id),
  );

  const scheduleIds = schedules.map((schedule) => schedule.id);
  const since7d = hoursAgo(24 * 7);
  // 7日分は成功率の計算用、直近分は「最後にいつ何が起きたか」を出すため。
  const [weekRuns, recentRuns] = await Promise.all([
    listRunsByScheduleIds(scheduleIds, { since: since7d }),
    listRunsByScheduleIds(scheduleIds, { limit: 60 }),
  ]);
  const runsBySchedule = groupRunsByScheduleId(mergeRuns(weekRuns, recentRuns));

  const keywordById = new Map(keywords.map((keyword) => [keyword.id, keyword]));
  const regionById = new Map(regions.map((region) => [region.id, region]));

  const counts: Record<Tab, number> = {
    keywords: keywords.length,
    regions: regions.length,
    schedules: schedules.length,
    runs: weekRuns.length,
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/clients"
          className="text-xs text-neutral-500 underline-offset-4 hover:underline"
        >
          ← 顧客一覧へ戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">
          {client.name}
        </h1>
      </div>

      <nav className="flex gap-1 border-b border-neutral-200">
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={`/clients/${id}?tab=${tab}`}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === activeTab
                ? "border-neutral-900 text-neutral-900"
                : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {TAB_LABELS[tab]}（{counts[tab]}）
          </Link>
        ))}
      </nav>

      {activeTab === "keywords" ? (
        <>
          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">
              キーワードを追加
            </h2>
            <AddKeywordForm clientId={id} />
          </section>

          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">
              登録済みキーワード
            </h2>
            {keywords.length === 0 ? (
              <p className="text-sm text-neutral-500">
                まだキーワードが登録されていません。
              </p>
            ) : (
              <ul className="divide-y divide-neutral-200">
                {keywords.map((keyword) => (
                  <li
                    key={keyword.id}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-neutral-900">
                        {keyword.keyword}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {PLATFORM_LABELS[keyword.platform] ?? keyword.platform}
                      </p>
                    </div>
                    <DeleteButton
                      action={removeKeyword}
                      id={keyword.id}
                      clientId={id}
                      confirmMessage={`「${keyword.keyword}」を削除します。よろしいですか？`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      {activeTab === "regions" ? (
        <>
          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">
              地域を追加
            </h2>
            <AddRegionForm clientId={id} />
          </section>

          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">
              登録済み地域
            </h2>
            {regions.length === 0 ? (
              <p className="text-sm text-neutral-500">
                まだ地域が登録されていません。
              </p>
            ) : (
              <ul className="divide-y divide-neutral-200">
                {regions.map((region) => (
                  <li
                    key={region.id}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-neutral-900">
                        {region.label}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {[region.prefecture, region.city]
                          .filter(Boolean)
                          .join(" ") || "所在地未設定"}
                        {region.lat !== null && region.lng !== null
                          ? ` / ${region.lat}, ${region.lng}`
                          : ""}
                      </p>
                    </div>
                    <DeleteButton
                      action={removeRegion}
                      id={region.id}
                      clientId={id}
                      confirmMessage={`「${region.label}」を削除します。よろしいですか？`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      {activeTab === "schedules" ? (
        <>
          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">
              スケジュールを追加
            </h2>
            <AddScheduleForm keywords={keywords} regions={regions} />
          </section>

          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">
              登録済みスケジュール
            </h2>
            {schedules.length === 0 ? (
              <p className="text-sm text-neutral-500">
                まだスケジュールが登録されていません。
              </p>
            ) : (
              <ul className="divide-y divide-neutral-200">
                {schedules.map((schedule) => {
                  const keyword = keywordById.get(schedule.keyword_id);
                  const region = regionById.get(schedule.region_id);

                  return (
                    <li
                      key={schedule.id}
                      className="flex flex-wrap items-center justify-between gap-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-neutral-900">
                          {keyword?.keyword ?? "(削除済みキーワード)"} ×{" "}
                          {region?.label ?? "(削除済み地域)"}
                        </p>
                        <p className="text-xs text-neutral-500">
                          {(schedule.times ?? []).map(formatTime).join(" / ") ||
                            "時刻未設定"}
                          {" ・ "}
                          {DEVICE_LABELS[schedule.device] ?? schedule.device}
                          {" ・ "}
                          <span
                            className={
                              schedule.enabled
                                ? "text-green-700"
                                : "text-neutral-400"
                            }
                          >
                            {schedule.enabled ? "有効" : "無効"}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <ScheduleToggle
                          scheduleId={schedule.id}
                          clientId={id}
                          enabled={schedule.enabled}
                        />
                        <DeleteButton
                          action={removeSchedule}
                          id={schedule.id}
                          clientId={id}
                          confirmMessage="このスケジュールを削除します。よろしいですか？"
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : null}

      {activeTab === "runs" ? (
        <section className={cardClass}>
          <h2 className="mb-1 text-sm font-semibold text-neutral-900">
            スケジュール別の実行結果
          </h2>
          <p className="mb-4 text-xs text-neutral-500">
            成功率は過去7日間、実行履歴は直近{RECENT_RUNS_PER_SCHEDULE}件です。
          </p>

          {schedules.length === 0 ? (
            <p className="text-sm text-neutral-500">
              まだスケジュールが登録されていないため、実行がありません。
            </p>
          ) : (
            <ul className="divide-y divide-neutral-200">
              {schedules.map((schedule) => {
                const keyword = keywordById.get(schedule.keyword_id);
                const region = regionById.get(schedule.region_id);
                const runs = runsBySchedule.get(schedule.id) ?? [];
                const weekSummary = summarizeRuns(
                  runs.filter((run) => isSince(run, since7d)),
                );
                const latestRuns = runs.slice(0, RECENT_RUNS_PER_SCHEDULE);

                return (
                  <li key={schedule.id} className="py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-neutral-900">
                        {keyword?.keyword ?? "(削除済みキーワード)"} ×{" "}
                        {region?.label ?? "(削除済み地域)"}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {keyword
                          ? PLATFORM_LABELS[keyword.platform] ?? keyword.platform
                          : "-"}
                        {" ・ "}
                        {DEVICE_LABELS[schedule.device] ?? schedule.device}
                        {" ・ "}
                        <span
                          className={
                            schedule.enabled ? "text-green-700" : "text-neutral-400"
                          }
                        >
                          {schedule.enabled ? "有効" : "無効"}
                        </span>
                      </p>
                    </div>

                    <p className="mt-2 text-xs text-neutral-600">
                      過去7日の成功率:{" "}
                      {weekSummary.total === 0 ? (
                        <span className="text-neutral-500">実行なし</span>
                      ) : (
                        <>
                          <span className="font-medium text-neutral-900">
                            {formatRate(weekSummary.successRate)}
                          </span>
                          <span className="text-neutral-500">
                            {" "}
                            （{weekSummary.counts.ok}/{weekSummary.total} 件・
                            ブロック {weekSummary.counts.blocked}・失敗{" "}
                            {weekSummary.counts.error}）
                          </span>
                        </>
                      )}
                    </p>

                    {latestRuns.length === 0 ? (
                      <p className="mt-2 text-xs text-neutral-500">
                        まだ実行がありません。
                      </p>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-1">
                        {latestRuns.map((run) => (
                          <li
                            key={run.id}
                            className="flex flex-wrap items-center gap-2 text-xs text-neutral-600"
                          >
                            <RunStatusBadge status={run.status} />
                            <span>{formatRunAt(run.run_at)}</span>
                            <span className="text-neutral-400">
                              exit IP: {run.exit_ip ?? "-"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
