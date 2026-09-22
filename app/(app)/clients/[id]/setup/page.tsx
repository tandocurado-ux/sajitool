import Link from "next/link";
import { notFound } from "next/navigation";
import { getClientById } from "@/server/clients/queries";
import { listKeywords } from "@/server/keywords/queries";
import { listRegions } from "@/server/regions/queries";
import { listSchedulesByKeywordIds } from "@/server/schedules/queries";
import { BulkSetupForm } from "@/components/bulk-setup-form";

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/clients/${id}`}
          className="text-xs text-neutral-500 underline-offset-4 hover:underline"
        >
          ← {client.name} の登録内容へ戻る
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-neutral-900">
          まとめて登録 — {client.name}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          キーワード × 検索エンジン × 地域 × デバイスの組み合わせを、
          このページだけでまとめて作成できます。
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
      />
    </div>
  );
}
