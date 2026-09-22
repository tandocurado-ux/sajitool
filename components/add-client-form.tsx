"use client";

import { useActionState, useEffect, useRef } from "react";
import { addClient } from "@/server/clients/actions";
import { initialActionState } from "@/lib/action-state";
import { FormError } from "./form-error";
import { inputClass, labelClass, primaryButtonClass } from "./ui";

export function AddClientForm() {
  const [state, formAction, pending] = useActionState(addClient, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.error) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <div>
        <label htmlFor="client-name" className={labelClass}>
          顧客名
        </label>
        <div className="flex gap-2">
          <input
            id="client-name"
            name="name"
            type="text"
            required
            maxLength={100}
            placeholder="例: 株式会社サンプル"
            className={inputClass}
          />
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? "追加中…" : "追加"}
          </button>
        </div>
      </div>
      <FormError message={state.error} />
    </form>
  );
}
