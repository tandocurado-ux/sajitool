import { RUN_STATUS_LABELS, type RunStatus } from "@/lib/types";

const STATUS_CLASSES: Record<RunStatus, string> = {
  ok: "border-green-200 bg-green-50 text-green-700",
  blocked: "border-red-200 bg-red-50 text-red-700",
  error: "border-amber-200 bg-amber-50 text-amber-700",
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const className = STATUS_CLASSES[status] ?? "border-neutral-200 bg-neutral-50 text-neutral-600";
  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {RUN_STATUS_LABELS[status] ?? status}
    </span>
  );
}
