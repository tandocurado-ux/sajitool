import Link from "next/link";
import {
  CLIENT_RUN_WINDOW_DAYS,
  getClientsOverview,
} from "@/server/clients/queries";
import { ClientsTable } from "@/components/clients-table";
import { cardClass, primaryButtonClass } from "@/components/ui";

export const metadata = {
  title: "顧客管理 | サジェツール",
};

export default async function ClientsPage() {
  const rows = await getClientsOverview();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">顧客管理</h1>
          <p className="mt-1 text-sm text-neutral-500">
            顧客をクリックすると、キーワード・地域・スケジュールを登録できます。
          </p>
        </div>
        <Link href="/clients/new" className={primaryButtonClass}>
          顧客を追加
        </Link>
      </div>

      <section className={cardClass}>
        <ClientsTable rows={rows} runWindowDays={CLIENT_RUN_WINDOW_DAYS} />
      </section>
    </div>
  );
}
