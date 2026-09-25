"use client";

import type { DailyCapacity } from "@/lib/schedule-plan";
import { PLATFORM_LABELS, type Platform } from "@/lib/types";

function label(platform: string): string {
  return PLATFORM_LABELS[platform as Platform] ?? platform;
}

/**
 * platform 別の「登録件数 / 1日の消化見込み / 充足率」。
 * 登録件数はアカウント全体（既存 + 今回の追加）。エンジンは逐次実行なので合計も見る。
 */
export function CapacityNotice({ capacity }: { capacity: DailyCapacity }) {
  if (capacity.platforms.length === 0) return null;
  const tone = capacity.over
    ? "border-danger-line bg-danger-soft text-danger"
    : "border-line bg-inset text-muted";

  return (
    <div className={`mt-3 rounded-md border px-4 py-3 text-sm ${tone}`}>
      <p className="text-xs font-medium">
        1日の消化能力（アカウント全体、実行可能 {capacity.windowHours} 時間、逐次実行）
      </p>
      <ul className="mt-1 flex flex-col gap-0.5 text-xs">
        {capacity.platforms.map((entry) => (
          <li key={entry.platform} className={entry.over ? "font-semibold" : undefined}>
            {label(entry.platform)}: 登録{" "}
            <span className="tabular-nums">{entry.registered}</span> 件/日
            {entry.added > 0 ? (
              <span className="tabular-nums">（既存 {entry.existing} + 今回 {entry.added}）</span>
            ) : null}{" "}
            / 消化見込み <span className="tabular-nums">{entry.capacity}</span> 件/日 / 充足率{" "}
            <span className="tabular-nums">{Math.round(entry.ratio * 100)}%</span>
            {entry.over ? ` ← ${label(entry.platform)} の登録数が1日の消化能力を超えています` : ""}
          </li>
        ))}
        <li className={capacity.combined.over ? "font-semibold" : undefined}>
          合計: 所要 約 <span className="tabular-nums">{Math.round(capacity.combined.neededMinutes)}</span> 分 / 実行可能{" "}
          <span className="tabular-nums">{Math.round(capacity.combined.windowMinutes)}</span> 分 / 充足率{" "}
          <span className="tabular-nums">{Math.round(capacity.combined.ratio * 100)}%</span>
          {capacity.combined.over ? " ← Google と Yahoo! は逐次に実行するため、合計でも1日に収まりません" : ""}
        </li>
      </ul>
      {capacity.over ? (
        <p className="mt-2 text-xs font-semibold">
          このまま登録すると1日で消化しきれず、時刻枠の超過分はスケジューラがスキップします。
          Google の登録数を減らすか、時刻の自動分散を広げてください。
        </p>
      ) : null}
    </div>
  );
}
