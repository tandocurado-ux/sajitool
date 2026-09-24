"use client";

import { useActionState } from "react";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { dangerButtonClass } from "./ui";

type Props = {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  id: string;
  clientId?: string;
  confirmMessage: string;
  label?: string;
};

export function DeleteButton({
  action,
  id,
  clientId,
  confirmMessage,
  label = "削除",
}: Props) {
  const [state, formAction, pending] = useActionState(action, initialActionState);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault();
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="id" value={id} />
      {clientId ? <input type="hidden" name="client_id" value={clientId} /> : null}
      <button type="submit" disabled={pending} className={dangerButtonClass}>
        {pending ? "削除中…" : label}
      </button>
      {state.error ? (
        <span role="alert" className="text-xs text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
