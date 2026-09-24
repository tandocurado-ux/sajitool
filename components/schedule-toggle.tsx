"use client";

import { useActionState } from "react";
import { toggleSchedule } from "@/server/schedules/actions";
import { initialActionState } from "@/lib/action-state";
import { subtleButtonClass } from "./ui";

type Props = {
  scheduleId: string;
  clientId: string;
  enabled: boolean;
};

export function ScheduleToggle({ scheduleId, clientId, enabled }: Props) {
  const [state, formAction, pending] = useActionState(
    toggleSchedule,
    initialActionState,
  );

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="id" value={scheduleId} />
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <button type="submit" disabled={pending} className={subtleButtonClass}>
        {pending ? "更新中…" : enabled ? "無効にする" : "有効にする"}
      </button>
      {state.error ? (
        <span role="alert" className="text-xs text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
