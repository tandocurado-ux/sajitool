import Link from "next/link";
import { listClients } from "@/server/clients/queries";
import { removeClient } from "@/server/clients/actions";
import { AddClientForm } from "@/components/add-client-form";
import { DeleteButton } from "@/components/delete-button";
import { cardClass, subtleButtonClass } from "@/components/ui";

export const metadata = {
  title: "顧客一覧 | サジェツール",
};

export default async function ClientsPage() {
  const clients = await listClients();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">顧客</h1>
        <p className="mt-1 text-sm text-neutral-500">
          顧客を選ぶと、キーワード・地域・スケジュールを登録できます。
        </p>
      </div>

      <section className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">新規顧客を追加</h2>
        <AddClientForm />
      </section>

      <section className={cardClass}>
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">
          登録済みの顧客（{clients.length}件）
        </h2>
        {clients.length === 0 ? (
          <p className="text-sm text-neutral-500">まだ顧客が登録されていません。</p>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {clients.map((client) => (
              <li
                key={client.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <Link
                  href={`/clients/${client.id}`}
                  className="text-sm font-medium text-neutral-900 underline-offset-4 hover:underline"
                >
                  {client.name}
                </Link>
                <div className="flex items-center gap-2">
                  <Link href={`/clients/${client.id}/setup`} className={subtleButtonClass}>
                    まとめて登録
                  </Link>
                  <DeleteButton
                    action={removeClient}
                    id={client.id}
                    confirmMessage={`「${client.name}」を削除します。よろしいですか？`}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
