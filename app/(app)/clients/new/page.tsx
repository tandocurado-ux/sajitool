import Link from "next/link";
import { NewClientForm } from "@/components/new-client-form";
import { getDailyRunsByPlatform } from "@/server/schedules/capacity";

export const metadata = {
  title: "顧客を追加 | サジェツール",
};

export default async function NewClientPage() {
  const existingRunsByPlatform = await getDailyRunsByPlatform();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/clients"
          className="text-xs text-subtle underline-offset-4 hover:underline"
        >
          ← 顧客一覧へ戻る
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">顧客を追加</h1>
        <p className="mt-1 text-sm text-subtle">
          店舗名・キーワード・検索地点・検索時間をこのページで登録します。
          店舗名だけでも登録でき、残りはあとから「まとめて登録」で追加できます。
        </p>
      </div>

      <NewClientForm existingRunsByPlatform={existingRunsByPlatform} />
    </div>
  );
}
