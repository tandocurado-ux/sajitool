"use client";

import { useActionState, useEffect, useRef } from "react";
import { addKeyword } from "@/server/keywords/actions";
import { initialActionState } from "@/lib/action-state";
import { FormError } from "./form-error";
import { inputClass, labelClass, primaryButtonClass } from "./ui";

export function AddKeywordForm({ clientId }: { clientId: string }) {
  const [state, formAction, pending] = useActionState(addKeyword, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.error) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="client_id" value={clientId} />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <label htmlFor="keyword" className={labelClass}>
            キーワード
          </label>
          <input
            id="keyword"
            name="keyword"
            type="text"
            required
            maxLength={200}
            placeholder="例: 不用品回収 名古屋"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="platform" className={labelClass}>
            検索エンジン
          </label>
          <select id="platform" name="platform" defaultValue="google" className={inputClass}>
            <option value="google">Google</option>
            <option value="yahoo">Yahoo!</option>
          </select>
        </div>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "追加中…" : "追加"}
        </button>
      </div>
      <FormError message={state.error} />
    </form>
  );
}
