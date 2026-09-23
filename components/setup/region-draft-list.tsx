"use client";

import {
  RegionPicker,
  emptyRegionDraft,
  isRegionDraftFilled,
  regionDraftLabel,
  type RegionDraft,
} from "../region-picker";
import { subtleButtonClass } from "../ui";

type Props = {
  drafts: RegionDraft[];
  onChange: (drafts: RegionDraft[]) => void;
  addLabel?: string;
};

/**
 * 新しく追加する地域のリスト。都道府県→市区町村の2段プルダウンを並べる。
 * 送信用の hidden（new_regions）もここで出す。
 */
export function RegionDraftList({
  drafts,
  onChange,
  addLabel = "+ 地域を追加",
}: Props) {
  const filled = drafts.filter(isRegionDraftFilled);

  function update(key: string, patch: Partial<RegionDraft>) {
    onChange(
      drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)),
    );
  }

  return (
    <>
      <input
        type="hidden"
        name="new_regions"
        value={JSON.stringify(
          filled.map(({ prefecture, city, label }) => ({
            prefecture,
            city,
            label,
          })),
        )}
      />

      {drafts.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-4">
          {drafts.map((draft) => (
            <li
              key={draft.key}
              className="rounded border border-dashed border-neutral-300 p-3"
            >
              <RegionPicker
                draft={draft}
                onChange={(patch) => update(draft.key, patch)}
                idPrefix={`new-region-${draft.key}`}
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-neutral-500">
                  {isRegionDraftFilled(draft)
                    ? `登録名: ${regionDraftLabel(draft)}`
                    : "都道府県と市区町村を選んでください。"}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    onChange(drafts.filter((item) => item.key !== draft.key))
                  }
                  className={subtleButtonClass}
                >
                  この行を削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4">
        <button
          type="button"
          onClick={() => onChange([...drafts, emptyRegionDraft()])}
          className={subtleButtonClass}
        >
          {addLabel}
        </button>
      </div>
    </>
  );
}
