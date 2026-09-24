import {
  RUN_STATUS_DESCRIPTIONS,
  RUN_STATUS_LABELS,
  type RunStatus,
} from "@/lib/types";

const STATUS_CLASSES: Record<RunStatus, string> = {
  ok: "border-green-200 bg-green-50 text-green-700",
  blocked: "border-red-200 bg-red-50 text-red-700",
  error: "border-amber-200 bg-amber-50 text-amber-700",
};

/**
 * 実行結果のバッジ。blocked（検知・赤）と error（エラー・黄）は
 * 原因も対処も違うので、ひとくくりの「失敗」にはせず必ず分けて出す。
 */
export function RunStatusBadge({ status }: { status: RunStatus }) {
  const className =
    STATUS_CLASSES[status] ?? "border-neutral-200 bg-neutral-50 text-neutral-600";
  const label = RUN_STATUS_LABELS[status] ?? status;
  const description = RUN_STATUS_DESCRIPTIONS[status];
  return (
    <span
      title={description ? `${status}: ${description}` : status}
      className={`inline-flex items-baseline gap-1 rounded border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
      {label !== status ? (
        <span className="font-normal opacity-70">{status}</span>
      ) : null}
    </span>
  );
}
