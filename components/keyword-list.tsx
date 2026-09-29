"use client";

import Link from "next/link";
import { useState } from "react";
import { removeKeyword } from "@/server/keywords/actions";
import { allowedDevicesFor } from "@/lib/device-policy";
import { PLATFORM_LABELS, type Platform } from "@/lib/types";
import { DeleteButton } from "./delete-button";
import { StartMeasurementPanel } from "./start-measurement-panel";
import { primaryButtonClass } from "./ui";

export type KeywordRow = {
  id: string;
  keyword: string;
  platform: Platform;
  /** 登録済みのスケジュール数（無効・実行対象外も含む）。 */
  scheduleCount: number;
  /** 実際に実行されるスケジュール数（有効 かつ 計測対象のデバイス）。 */
  activeCount: number;
  /** 「計測を開始」で新規に作られる件数（登録済みの地域 × 許可デバイスの不足分）。 */
  toCreate: number;
  /** そのうち登録済みでスキップされる件数。 */
  toSkip: number;
};

type Props = {
  clientId: string;
  keywords: KeywordRow[];
  regionCount: number;
  /** 実験モード（SAJI_GOOGLE_PC_ENABLED=1）。Google × pc も作る。 */
  googlePc: boolean;
  existingRunsByPlatform: Partial<Record<string, number>>;
};

const badgeClass = "inline-block rounded-md border px-2 py-0.5 text-xs font-medium";

/**
 * 登録済みキーワードの一覧。計測されているか（実行されるスケジュールがあるか）を
 * バッジで示し、未計測のものはその場で計測を開始できる。
 */
export function KeywordList({
  clientId,
  keywords,
  regionCount,
  googlePc,
  existingRunsByPlatform,
}: Props) {
  // 入力欄の id が重ならないよう、開くパネルは1つだけにする。
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <ul className="divide-y divide-line">
      {keywords.map((keyword) => {
        const measuring = keyword.activeCount > 0;
        const open = openId === keyword.id;

        return (
          <li key={keyword.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">{keyword.keyword}</p>
                <p className="text-xs text-subtle">
                  {PLATFORM_LABELS[keyword.platform] ?? keyword.platform}
                  {" ・ "}
                  スケジュール {keyword.scheduleCount} 件
                  {keyword.scheduleCount > keyword.activeCount
                    ? `（実行対象 ${keyword.activeCount} 件）`
                    : ""}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2">
                  {measuring ? (
                    <span className={`${badgeClass} border-ok-line bg-ok-soft text-ok`}>
                      計測中
                    </span>
                  ) : (
                    <span className={`${badgeClass} border-warn-line bg-warn-soft text-warn`}>
                      未計測
                    </span>
                  )}
                  {!measuring && keyword.scheduleCount > 0 ? (
                    <span className="text-xs text-warn">
                      登録済みの {keyword.scheduleCount} 件は無効か、計測対象外のデバイスです
                    </span>
                  ) : null}
                </p>
              </div>

              <div className="flex flex-wrap items-start gap-2">
                {measuring || open ? null : regionCount === 0 ? (
                  <Link
                    href={`/clients/${clientId}?tab=regions`}
                    className="text-xs text-warn underline underline-offset-4"
                  >
                    先に地域を登録してください
                  </Link>
                ) : keyword.toCreate === 0 ? (
                  <Link
                    href={`/clients/${clientId}?tab=schedules`}
                    className="text-xs text-warn underline underline-offset-4"
                  >
                    スケジュールを有効にしてください
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOpenId(keyword.id)}
                    className={primaryButtonClass}
                  >
                    計測を開始
                  </button>
                )}
                <DeleteButton
                  action={removeKeyword}
                  id={keyword.id}
                  clientId={clientId}
                  confirmMessage={`「${keyword.keyword}」を削除します。よろしいですか？`}
                />
              </div>
            </div>

            {open ? (
              <StartMeasurementPanel
                keywordId={keyword.id}
                keyword={keyword.keyword}
                platform={keyword.platform}
                regionCount={regionCount}
                devices={allowedDevicesFor(keyword.platform, { googlePc })}
                toCreate={keyword.toCreate}
                toSkip={keyword.toSkip}
                existingRunsByPlatform={existingRunsByPlatform}
                onClose={() => setOpenId(null)}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
