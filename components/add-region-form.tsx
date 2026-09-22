"use client";

import { useActionState, useEffect, useRef } from "react";
import { addRegion } from "@/server/regions/actions";
import { initialActionState } from "@/lib/action-state";
import { FormError } from "./form-error";
import { inputClass, labelClass, primaryButtonClass } from "./ui";

export function AddRegionForm({ clientId }: { clientId: string }) {
  const [state, formAction, pending] = useActionState(addRegion, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.error) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="client_id" value={clientId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <label htmlFor="label" className={labelClass}>
            ラベル（必須）
          </label>
          <input
            id="label"
            name="label"
            type="text"
            required
            maxLength={100}
            placeholder="例: 名古屋市中区"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="prefecture" className={labelClass}>
            都道府県
          </label>
          <input
            id="prefecture"
            name="prefecture"
            type="text"
            placeholder="愛知県"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="city" className={labelClass}>
            市区町村
          </label>
          <input id="city" name="city" type="text" placeholder="名古屋市中区" className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="lat" className={labelClass}>
              緯度
            </label>
            <input
              id="lat"
              name="lat"
              type="text"
              inputMode="decimal"
              placeholder="35.1681"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="lng" className={labelClass}>
              経度
            </label>
            <input
              id="lng"
              name="lng"
              type="text"
              inputMode="decimal"
              placeholder="136.9066"
              className={inputClass}
            />
          </div>
        </div>
      </div>
      <div>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "追加中…" : "地域を追加"}
        </button>
      </div>
      <FormError message={state.error} />
    </form>
  );
}
