import Link from "next/link";
import { notFound } from "next/navigation";
import { getClientById } from "@/server/clients/queries";
import { listKeywords } from "@/server/keywords/queries";
import { listRegions } from "@/server/regions/queries";
import { listSchedulesByKeywordIds } from "@/server/schedules/queries";
import { BulkSetupForm } from "@/components/bulk-setup-form";
import { derivePreviousSettings } from "@/server/setup/schema";
import { formatTime } from "@/lib/parse";

export const metadata = {
  title: "まとめて登録 | サジェツール",
};

export default async function ClientSetupPage(
  props: PageProps<"/clients/[id]/setup">,
) {
  const { id } = await props.params;

  const client = await getClientById(id);
  if (!client) notFound();

  const [keywords, regions] = await Promise.all([
    listKeywords(id),
    listRegions(id),
  ]);
  const schedules = await listSchedulesByKeywordIds(
    keywords.map((keyword) => keyword.id),
  );

  // 既存スケジュールから「前回どう登録したか」を推定して、そのまま使えるようにする。
  const previousSettings = derivePreviousSettings(keywords, schedules);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/clients/${id}`}
          className="text-xs text-subtle underline-offset-4 hover:underline"
        >
          ← {client.name} の登録内容へ戻る
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
          まとめて登録 — {client.name}
        </h1>
        <p className="mt-1 text-sm text-subtle">
          登録済みのキーワードと地域は最初から選択済みです。増やしたぶんだけ足せば、
          不足しているスケジュールだけが作られます（重複はスキップ）。
        </p>
      </div>

      <BulkSetupForm
        clientId={id}
        regions={regions}
        existingKeywords={keywords.map(({ id: keywordId, keyword, platform }) => ({
          id: keywordId,
          keyword,
          platform,
        }))}
        existingScheduleKeys={schedules.map(
          (schedule) =>
            `${schedule.keyword_id}|${schedule.region_id}|${schedule.device}`,
        )}
        scheduleCountByKeyword={keywords.map((keyword) => ({
          keyword: keyword.keyword,
          count: schedules.filter(
            (schedule) => schedule.keyword_id === keyword.id,
          ).length,
          times: [
            ...new Set(
              schedules
                .filter((schedule) => schedule.keyword_id === keyword.id)
                .flatMap((schedule) => (schedule.times ?? []).map(formatTime)),
            ),
          ].sort(),
        }))}
        previousSettings={previousSettings}
      />
    </div>
  );
}
