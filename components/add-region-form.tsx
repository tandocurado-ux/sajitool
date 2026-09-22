"use client";

import { useActionState, useState } from "react";
import { addRegion } from "@/server/regions/actions";
import { initialActionState } from "@/lib/action-state";
import { FormError } from "./form-error";
import {
  RegionPicker,
  emptyRegionDraft,
  isRegionDraftFilled,
  type RegionDraft,
} from "./region-picker";
import { primaryButtonClass } from "./ui";

export function AddRegionForm({ clientId }: { clientId: string }) {
  const [state, formAction, pending] = useActionState(addRegion, initialActionState);
  const [draft, setDraft] = useState<RegionDraft>(emptyRegionDraft());

  // 登録に成功したら入力を空に戻す。
  // effect ではなくレンダー中に前回値と比べて調整する（余計な再レンダーを挟まない）。
  const [handledState, setHandledState] = useState(state);
  if (handledState !== state) {
    setHandledState(state);
    if (!state.error) setDraft(emptyRegionDraft());
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="prefecture" value={draft.prefecture} />
      <input type="hidden" name="city" value={draft.city} />
      <input type="hidden" name="label" value={draft.label} />

      <RegionPicker
        draft={draft}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        idPrefix="add-region"
      />

      <div>
        <button
          type="submit"
          disabled={pending || !isRegionDraftFilled(draft)}
          className={primaryButtonClass}
        >
          {pending ? "追加中…" : "地域を追加"}
        </button>
      </div>
      <FormError message={state.error} />
    </form>
  );
}
