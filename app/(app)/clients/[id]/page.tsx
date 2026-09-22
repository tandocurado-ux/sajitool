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
import { cardClass } from "@/components/ui";
import { formatTime } from "@/lib/parse";
import { DEVICE_LABELS, PLATFORM_LABELS } from "@/lib/types";

const TABS = ["keywords", "regions", "schedules"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  keywords: "キーワード",
  regions: "地域",
  schedules: "スケジュール",
};

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

  const keywordById = new Map(keywords.map((keyword) => [keyword.id, keyword]));
  const regionById = new Map(regions.map((region) => [region.id, region]));

  const counts: Record<Tab, number> = {
    keywords: keywords.length,
    regions: regions.length,
    schedules: schedules.length,
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
    </div>
  );
}
