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
import { RespreadTool } from "@/components/respread-tool";
import { ScheduleToggle } from "@/components/schedule-toggle";
import { ClientNameEditor } from "@/components/client-name-editor";
import { DeleteButton } from "@/components/delete-button";
import { RunStatusBadge } from "@/components/run-status-badge";
import { DailyProgressSummary } from "@/components/daily-progress";
import { cardClass, primaryButtonClass } from "@/components/ui";
import {
  groupRunsByScheduleId,
  listRunsByScheduleIds,
  mergeRuns,
} from "@/server/runs/queries";
import { formatTime } from "@/lib/parse";
import {
  buildDailyProgress,
  countDueSlots,
  formatRate,
  formatRunAt,
  formatRunAtShort,
  hoursAgo,
  isSince,
  jstDateKey,
  summarizeRuns,
} from "@/lib/runs";
import {
  DEVICE_LABELS,
  PLATFORM_LABELS,
  RUN_STATUS_LABELS,
  type Device,
  type Platform,
} from "@/lib/types";

const TABS = ["keywords", "regions", "schedules", "runs", "matrix"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  keywords: "キーワード",
  regions: "地域",
  schedules: "スケジュール",
  runs: "実行履歴",
  matrix: "地域比較",
};

const PLATFORM_FILTERS: Platform[] = ["google", "yahoo"];
const DEVICE_FILTERS: Device[] = ["pc", "mobile"];

function normalizePlatform(raw: string | string[] | undefined): Platform {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return PLATFORM_FILTERS.includes(value as Platform)
    ? (value as Platform)
    : "google";
}

function normalizeDevice(raw: string | string[] | undefined): Device {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return DEVICE_FILTERS.includes(value as Device) ? (value as Device) : "pc";
}

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
  const searchParams = await props.searchParams;
  const activeTab = normalizeTab(searchParams.tab);
  const platformFilter = normalizePlatform(searchParams.platform);
  const deviceFilter = normalizeDevice(searchParams.device);

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
    listRunsByScheduleIds(scheduleIds, { limit: 300 }),
  ]);
  const runsBySchedule = groupRunsByScheduleId(mergeRuns(weekRuns, recentRuns));

  // 本日（JST）の成功率と、現在時刻までの予定枠に対する消化状況。
  // 7日分の runs に当日分も含まれているので、追加のクエリは要らない。
  const now = new Date();
  const today = jstDateKey(now);
  const todayProgress = buildDailyProgress(
    summarizeRuns(weekRuns.filter((run) => jstDateKey(run.run_at) === today)),
    schedules.reduce((sum, schedule) => sum + countDueSlots(schedule, now), 0),
  );

  const keywordById = new Map(keywords.map((keyword) => [keyword.id, keyword]));
  const regionById = new Map(regions.map((region) => [region.id, region]));

  // サマリと「未使用」バッジのために、キーワード／地域ごとのスケジュール数を数える。
  const schedulesByKeyword = new Map<string, number>();
  const schedulesByRegion = new Map<string, number>();
  const usedTimes = new Set<string>();
  let enabledSchedules = 0;

  for (const schedule of schedules) {
    schedulesByKeyword.set(
      schedule.keyword_id,
      (schedulesByKeyword.get(schedule.keyword_id) ?? 0) + 1,
    );
    schedulesByRegion.set(
      schedule.region_id,
      (schedulesByRegion.get(schedule.region_id) ?? 0) + 1,
    );
    for (const time of schedule.times ?? []) usedTimes.add(formatTime(time));
    if (schedule.enabled) enabledSchedules += 1;
  }

  const keywordsByPlatform = new Map<string, number>();
  for (const keyword of keywords) {
    keywordsByPlatform.set(
      keyword.platform,
      (keywordsByPlatform.get(keyword.platform) ?? 0) + 1,
    );
  }

  const sortedTimes = [...usedTimes].sort();
  const unusedKeywords = keywords.filter(
    (keyword) => !schedulesByKeyword.has(keyword.id),
  ).length;
  const unusedRegions = regions.filter(
    (region) => !schedulesByRegion.has(region.id),
  ).length;

  const counts: Partial<Record<Tab, number>> = {
    keywords: keywords.length,
    regions: regions.length,
    schedules: schedules.length,
    runs: weekRuns.length,
  };

  // 地域比較タブ: 行=キーワード、列=地域。platform と device で1枚に絞る。
  const matrixKeywords = keywords.filter(
    (keyword) => keyword.platform === platformFilter,
  );
  const scheduleByPair = new Map(
    schedules
      .filter((schedule) => schedule.device === deviceFilter)
      .map((schedule) => [
        `${schedule.keyword_id}|${schedule.region_id}`,
        schedule,
      ]),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/clients"
          className="text-xs text-subtle underline-offset-4 hover:underline"
        >
          ← 顧客一覧へ戻る
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <ClientNameEditor id={id} name={client.name}>
            <h1 className="text-2xl font-semibold tracking-tight text-fg">{client.name}</h1>
          </ClientNameEditor>
          <Link href={`/clients/${id}/setup`} className={primaryButtonClass}>
            まとめて登録
          </Link>
        </div>
      </div>

      <section className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold tracking-tight text-fg">登録内容</h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-line px-3 py-2">
            <dt className="text-xs text-subtle">キーワード</dt>
            <dd className="text-lg font-semibold tracking-tight tabular-nums text-fg">
              {keywords.length}
              <span className="ml-2 text-xs font-normal text-subtle">
                {PLATFORM_LABELS.google} {keywordsByPlatform.get("google") ?? 0} /{" "}
                {PLATFORM_LABELS.yahoo} {keywordsByPlatform.get("yahoo") ?? 0}
              </span>
            </dd>
            {unusedKeywords > 0 ? (
              <dd className="mt-1 text-xs text-warn">
                未使用 {unusedKeywords} 件
              </dd>
            ) : null}
          </div>
          <div className="rounded-md border border-line px-3 py-2">
            <dt className="text-xs text-subtle">地域</dt>
            <dd className="text-lg font-semibold tracking-tight tabular-nums text-fg">{regions.length}</dd>
            {unusedRegions > 0 ? (
              <dd className="mt-1 text-xs text-warn">
                未使用 {unusedRegions} 件
              </dd>
            ) : null}
          </div>
          <div className="rounded-md border border-line px-3 py-2">
            <dt className="text-xs text-subtle">スケジュール</dt>
            <dd className="text-lg font-semibold tracking-tight tabular-nums text-fg">
              {schedules.length}
              <span className="ml-2 text-xs font-normal text-subtle">
                有効 {enabledSchedules} / 無効 {schedules.length - enabledSchedules}
              </span>
            </dd>
          </div>
          <div className="rounded-md border border-line px-3 py-2">
            <dt className="text-xs text-subtle">本日の実行（JST）</dt>
            <dd className="mt-1 text-sm">
              <DailyProgressSummary progress={todayProgress} />
            </dd>
          </div>
        </dl>
        <div className="mt-3">
          <p className="text-xs text-subtle">設定時刻（{sortedTimes.length} 種類）</p>
          <p className="mt-1 text-sm text-fg">
            {sortedTimes.length === 0 ? "まだありません" : sortedTimes.join(" / ")}
          </p>
        </div>
      </section>

      <nav className="flex gap-1 border-b border-line">
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={`/clients/${id}?tab=${tab}`}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === activeTab
                ? "border-accent text-fg"
                : "border-transparent text-subtle hover:text-fg"
            }`}
          >
            {TAB_LABELS[tab]}
            {counts[tab] === undefined ? "" : `（${counts[tab]}）`}
          </Link>
        ))}
      </nav>

      {activeTab === "keywords" ? (
        <>
          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold tracking-tight text-fg">
              キーワードを追加
            </h2>
            <AddKeywordForm clientId={id} />
          </section>

          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold tracking-tight text-fg">
              登録済みキーワード
            </h2>
            {keywords.length === 0 ? (
              <p className="text-sm text-subtle">
                まだキーワードが登録されていません。
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {keywords.map((keyword) => (
                  <li
                    key={keyword.id}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-fg">
                        {keyword.keyword}
                      </p>
                      <p className="text-xs text-subtle">
                        {PLATFORM_LABELS[keyword.platform] ?? keyword.platform}
                        {" ・ "}
                        スケジュール {schedulesByKeyword.get(keyword.id) ?? 0} 件
                      </p>
                      {schedulesByKeyword.has(keyword.id) ? null : (
                        <span className="mt-1 inline-block rounded-md border border-warn-line bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">
                          未使用
                        </span>
                      )}
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
            <h2 className="mb-3 text-sm font-semibold tracking-tight text-fg">
              地域を追加
            </h2>
            <AddRegionForm clientId={id} />
          </section>

          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold tracking-tight text-fg">
              登録済み地域
            </h2>
            {regions.length === 0 ? (
              <p className="text-sm text-subtle">
                まだ地域が登録されていません。
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {regions.map((region) => (
                  <li
                    key={region.id}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-fg">
                        {region.label}
                      </p>
                      <p className="text-xs text-subtle">
                        {[region.prefecture, region.city]
                          .filter(Boolean)
                          .join(" ") || "所在地未設定"}
                        {region.lat !== null && region.lng !== null
                          ? ` / ${region.lat}, ${region.lng}`
                          : ""}
                        {" ・ "}
                        スケジュール {schedulesByRegion.get(region.id) ?? 0} 件
                      </p>
                      {schedulesByRegion.has(region.id) ? null : (
                        <span className="mt-1 inline-block rounded-md border border-warn-line bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">
                          未使用
                        </span>
                      )}
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
            <h2 className="mb-3 text-sm font-semibold tracking-tight text-fg">
              スケジュールを追加
            </h2>
            <AddScheduleForm keywords={keywords} regions={regions} />
          </section>

          <section className={cardClass}>
            <h2 className="mb-1 text-sm font-semibold tracking-tight text-fg">
              時刻を撒き直す（再分散）
            </h2>
            <RespreadTool
              clientId={id}
              platforms={[...new Set(keywords.map((keyword) => keyword.platform))]}
            />
          </section>

          <section className={cardClass}>
            <h2 className="mb-3 text-sm font-semibold tracking-tight text-fg">
              登録済みスケジュール
            </h2>
            {schedules.length === 0 ? (
              <p className="text-sm text-subtle">
                まだスケジュールが登録されていません。
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {schedules.map((schedule) => {
                  const keyword = keywordById.get(schedule.keyword_id);
                  const region = regionById.get(schedule.region_id);

                  return (
                    <li
                      key={schedule.id}
                      className="flex flex-wrap items-center justify-between gap-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-fg">
                          {keyword?.keyword ?? "(削除済みキーワード)"} ×{" "}
                          {region?.label ?? "(削除済み地域)"}
                        </p>
                        <p className="text-xs text-subtle">
                          {(schedule.times ?? []).map(formatTime).join(" / ") ||
                            "時刻未設定"}
                          {" ・ "}
                          {DEVICE_LABELS[schedule.device] ?? schedule.device}
                          {" ・ "}
                          <span
                            className={
                              schedule.enabled
                                ? "text-ok"
                                : "text-subtle"
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
          <h2 className="mb-1 text-sm font-semibold tracking-tight text-fg">
            スケジュール別の実行結果
          </h2>
          <p className="mb-4 text-xs text-subtle">
            成功率は過去7日間、実行履歴は直近{RECENT_RUNS_PER_SCHEDULE}件です。
          </p>

          {schedules.length === 0 ? (
            <p className="text-sm text-subtle">
              まだスケジュールが登録されていないため、実行がありません。
            </p>
          ) : (
            <ul className="divide-y divide-line">
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
                      <p className="text-sm font-medium text-fg">
                        {keyword?.keyword ?? "(削除済みキーワード)"} ×{" "}
                        {region?.label ?? "(削除済み地域)"}
                      </p>
                      <p className="text-xs text-subtle">
                        {keyword
                          ? PLATFORM_LABELS[keyword.platform] ?? keyword.platform
                          : "-"}
                        {" ・ "}
                        {DEVICE_LABELS[schedule.device] ?? schedule.device}
                        {" ・ "}
                        <span
                          className={
                            schedule.enabled ? "text-ok" : "text-subtle"
                          }
                        >
                          {schedule.enabled ? "有効" : "無効"}
                        </span>
                      </p>
                    </div>

                    <p className="mt-2 text-xs text-muted">
                      過去7日の成功率:{" "}
                      {weekSummary.total === 0 ? (
                        <span className="text-subtle">実行なし</span>
                      ) : (
                        <>
                          <span className="font-medium text-fg">
                            {formatRate(weekSummary.successRate)}
                          </span>
                          <span className="text-subtle">
                            {" "}
                            （{weekSummary.counts.ok}/{weekSummary.total} 件・
                            {RUN_STATUS_LABELS.blocked} {weekSummary.counts.blocked}・
                            {RUN_STATUS_LABELS.error} {weekSummary.counts.error}）
                          </span>
                        </>
                      )}
                    </p>

                    {latestRuns.length === 0 ? (
                      <p className="mt-2 text-xs text-subtle">
                        まだ実行がありません。
                      </p>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-1">
                        {latestRuns.map((run) => (
                          <li
                            key={run.id}
                            className="flex flex-wrap items-center gap-2 text-xs text-muted"
                          >
                            <RunStatusBadge status={run.status} />
                            <span>{formatRunAt(run.run_at)}</span>
                            <span className="text-subtle">
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

      {activeTab === "matrix" ? (
        <section className={cardClass}>
          <h2 className="text-sm font-semibold tracking-tight text-fg">
            キーワード × 地域
          </h2>
          <p className="mt-1 text-xs text-subtle">
            セルは直近の実行結果です。どの地域が未実行・ブロックかを一覧できます。
          </p>

          <div className="mt-3 flex flex-wrap gap-6">
            <div>
              <span className="mb-1 block text-xs font-medium text-muted">
                検索エンジン
              </span>
              <div className="flex gap-1">
                {PLATFORM_FILTERS.map((platform) => (
                  <Link
                    key={platform}
                    href={`/clients/${id}?tab=matrix&platform=${platform}&device=${deviceFilter}`}
                    className={`rounded-md border px-3 py-1 text-xs font-medium ${
                      platform === platformFilter
                        ? "border-accent bg-accent text-accent-fg"
                        : "border-line-strong text-muted hover:bg-hover"
                    }`}
                  >
                    {PLATFORM_LABELS[platform]}
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-muted">
                デバイス
              </span>
              <div className="flex gap-1">
                {DEVICE_FILTERS.map((device) => (
                  <Link
                    key={device}
                    href={`/clients/${id}?tab=matrix&platform=${platformFilter}&device=${device}`}
                    className={`rounded-md border px-3 py-1 text-xs font-medium ${
                      device === deviceFilter
                        ? "border-accent bg-accent text-accent-fg"
                        : "border-line-strong text-muted hover:bg-hover"
                    }`}
                  >
                    {DEVICE_LABELS[device]}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {matrixKeywords.length === 0 || regions.length === 0 ? (
            <p className="mt-4 text-sm text-subtle">
              {PLATFORM_LABELS[platformFilter]} のキーワードと地域が揃うと表示されます。
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 border-b border-line bg-surface py-2 pr-4 text-xs font-medium text-subtle">
                      キーワード
                    </th>
                    {regions.map((region) => (
                      <th
                        key={region.id}
                        className="border-b border-line px-3 py-2 text-xs font-medium text-subtle"
                      >
                        {region.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {matrixKeywords.map((keyword) => (
                    <tr key={keyword.id} className="transition-colors hover:bg-hover">
                      <th className="sticky left-0 z-10 bg-surface py-2 pr-4 text-left text-sm font-medium text-fg">
                        {keyword.keyword}
                      </th>
                      {regions.map((region) => {
                        const schedule = scheduleByPair.get(
                          `${keyword.id}|${region.id}`,
                        );
                        const latestRun = schedule
                          ? (runsBySchedule.get(schedule.id) ?? [])[0]
                          : undefined;

                        return (
                          <td
                            key={region.id}
                            className="whitespace-nowrap px-3 py-2 align-top"
                          >
                            {!schedule ? (
                              <span className="text-xs text-subtle">
                                未登録
                              </span>
                            ) : !latestRun ? (
                              <span className="text-xs text-subtle">
                                未実行
                              </span>
                            ) : (
                              <span className="flex flex-col gap-1">
                                <RunStatusBadge status={latestRun.status} />
                                <span className="text-xs text-subtle">
                                  {formatRunAtShort(latestRun.run_at)}
                                </span>
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
