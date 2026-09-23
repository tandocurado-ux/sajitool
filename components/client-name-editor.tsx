"use client";

import { useActionState, useState, type ReactNode } from "react";
import { renameClient } from "@/server/clients/actions";
import { initialActionState } from "@/lib/action-state";
import { inputClass, primaryButtonClass, subtleButtonClass } from "./ui";

type Props = {
  id: string;
  name: string;
  /** 通常表示。編集中はこれを入力欄に差し替える。 */
  children: ReactNode;
};

export function ClientNameEditor({ id, name, children }: Props) {
  const [state, formAction, pending] = useActionState(
    renameClient,
    initialActionState,
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  // 保存に成功したら表示に戻す。effect ではなくレンダー中に前回値と比べる。
  const [handledState, setHandledState] = useState(state);
  if (handledState !== state) {
    setHandledState(state);
    if (!state.error) setEditing(false);
  }

  if (!editing) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        {children}
        <button
          type="button"
          onClick={() => {
            setDraft(name);
            setEditing(true);
          }}
          className="text-xs text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline"
        >
          名前を編集
        </button>
        {state.error ? (
          <span role="alert" className="text-xs text-red-600">
            {state.error}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input
        name="name"
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={100}
        autoFocus
        aria-label="顧客名"
        className={`${inputClass} w-64`}
      />
      <button
        type="submit"
        disabled={pending || draft.trim() === ""}
        className={primaryButtonClass}
      >
        {pending ? "保存中…" : "保存"}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className={subtleButtonClass}
      >
        キャンセル
      </button>
      {state.error ? (
        <span role="alert" className="text-xs text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
