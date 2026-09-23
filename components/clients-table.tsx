"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { removeClient } from "@/server/clients/actions";
import type { ClientOverviewRow } from "@/server/clients/queries";
import { formatRunAt } from "@/lib/runs";
import { ClientNameEditor } from "./client-name-editor";
import { DeleteButton } from "./delete-button";
import { RunStatusBadge } from "./run-status-badge";
import { inputClass } from "./ui";

type Props = {
  rows: ClientOverviewRow[];
  /** 「直近実行」を探した日数。範囲外は「-」になる。 */
  runWindowDays: number;
};

export function ClientsTable({ rows, runWindowDays }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => row.client.name.toLowerCase().includes(needle));
  }, [rows, query]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="顧客名で絞り込む"
          aria-label="顧客名で絞り込む"
          className={`${inputClass} max-w-xs`}
        />
        <p className="text-xs text-neutral-500">
          {filtered.length} / {rows.length} 件
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">
          {rows.length === 0
            ? "まだ顧客が登録されていません。"
            : "条件に合う顧客がありません。"}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-xs text-neutral-500">
                <th className="py-2 pr-4 font-medium">顧客名</th>
                <th className="py-2 pr-4 font-medium">キーワード</th>
                <th className="py-2 pr-4 font-medium">地域</th>
                <th className="py-2 pr-4 font-medium">スケジュール</th>
                <th className="py-2 pr-4 font-medium">
                  直近実行
                  <span className="ml-1 font-normal">（{runWindowDays}日以内）</span>
                </th>
                <th className="py-2 pr-4 font-medium">本日の実行</th>
                <th className="py-2 font-medium">アクション</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {filtered.map((row) => (
                <tr key={row.client.id}>
                  <td className="py-3 pr-4">
                    <ClientNameEditor id={row.client.id} name={row.client.name}>
                      <Link
                        href={`/clients/${row.client.id}`}
                        className="font-medium text-neutral-900 underline-offset-4 hover:underline"
                      >
                        {row.client.name}
                      </Link>
                    </ClientNameEditor>
                  </td>

                  <td className="whitespace-nowrap py-3 pr-4 text-neutral-900">
                    {row.keywordCount}
                    <span className="ml-1 text-xs text-neutral-500">
                      （G {row.googleKeywords} / Y {row.yahooKeywords}）
                    </span>
                  </td>

                  <td className="whitespace-nowrap py-3 pr-4 text-neutral-900">
                    {row.regionCount}
                  </td>

                  <td className="whitespace-nowrap py-3 pr-4 text-neutral-900">
                    {row.enabledScheduleCount}
                    <span className="text-neutral-500"> / {row.scheduleCount}</span>
                  </td>

                  <td className="whitespace-nowrap py-3 pr-4">
                    {row.lastRunAt && row.lastRunStatus ? (
                      <span className="flex flex-col gap-1">
                        <RunStatusBadge status={row.lastRunStatus} />
                        <span className="text-xs text-neutral-500">
                          {formatRunAt(row.lastRunAt)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-neutral-400">-</span>
                    )}
                  </td>

                  <td className="whitespace-nowrap py-3 pr-4 text-neutral-900">
                    {row.todayRuns === 0 ? (
                      <span className="text-neutral-400">-</span>
                    ) : (
                      <>
                        {row.todayRuns} 件
                        {row.todayBlocked > 0 ? (
                          <span className="ml-1 text-xs font-medium text-red-600">
                            （ブロック {row.todayBlocked}）
                          </span>
                        ) : null}
                      </>
                    )}
                  </td>

                  <td className="py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Link
                        href={`/clients/${row.client.id}`}
                        className="text-xs text-neutral-700 underline-offset-4 hover:underline"
                      >
                        詳細
                      </Link>
                      <Link
                        href={`/clients/${row.client.id}/setup`}
                        className="text-xs text-neutral-700 underline-offset-4 hover:underline"
                      >
                        まとめて登録
                      </Link>
                      <DeleteButton
                        action={removeClient}
                        id={row.client.id}
                        confirmMessage={`「${row.client.name}」を削除します。よろしいですか？`}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
