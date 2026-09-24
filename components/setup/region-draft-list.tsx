"use client";

import { useRef, useState } from "react";
import { findMunicipality } from "@/lib/japan";
import {
  RegionPicker,
  emptyRegionDraft,
  isRegionDraftFilled,
  regionDraftLabel,
  type RegionDraft,
} from "../region-picker";
import { primaryButtonClass, subtleButtonClass } from "../ui";

type Props = {
  drafts: RegionDraft[];
  onChange: (drafts: RegionDraft[]) => void;
  /** 「追加」ボタンの文言。 */
  addLabel?: string;
  /**
   * すでに登録済みの地域（`都道府県/市区町村`）。
   * まとめて登録では既存地域と同じものを弾くために渡す。
   */
  existingKeys?: string[];
};

/** この件数を超えたらリスト側だけをスクロールさせる。 */
const SCROLL_THRESHOLD = 10;

function draftKey(draft: Pick<RegionDraft, "prefecture" | "city">): string {
  return `${draft.prefecture}/${draft.city}`;
}

/**
 * 新しく追加する地域のリスト。
 *
 * 追加フォームは常に最上部に固定（sticky）し、追加した地域は下に
 * 追加順で積まれていく。追加後は都道府県を保持したまま市区町村だけを
 * 戻してフォーカスを市区町村に置く（大阪市の複数区を連続で入れる、が主用途）。
 * 送信用の hidden（new_regions）の形式は従来どおり。
 */
export function RegionDraftList({
  drafts,
  onChange,
  addLabel = "追加",
  existingKeys = [],
}: Props) {
  const [draft, setDraft] = useState<RegionDraft>(emptyRegionDraft());
  const [notice, setNotice] = useState<string | null>(null);
  const cityRef = useRef<HTMLSelectElement>(null);

  const filled = drafts.filter(isRegionDraftFilled);
  const existing = new Set(existingKeys);

  function update(patch: Partial<RegionDraft>) {
    setNotice(null);
    setDraft((current) => ({ ...current, ...patch }));
  }

  function add() {
    if (!isRegionDraftFilled(draft)) {
      setNotice("都道府県と市区町村を選んでください。");
      cityRef.current?.focus();
      return;
    }

    const key = draftKey(draft);
    const label = regionDraftLabel(draft);
    if (existing.has(key)) {
      setNotice(`「${label}」はすでに登録されています。`);
      return;
    }
    if (drafts.some((item) => draftKey(item) === key)) {
      setNotice(`「${label}」は追加済みです。`);
      return;
    }

    onChange([...drafts, { ...draft, key: emptyRegionDraft().key }]);
    // 都道府県は保持し、市区町村とラベルだけ戻して次の入力へ。
    setDraft({ ...emptyRegionDraft(), prefecture: draft.prefecture });
    setNotice(null);
    cityRef.current?.focus();
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

      {/* 追加フォーム。リストが長くなっても画面上部に見え続ける。 */}
      <div className="sticky top-0 z-10 -mx-5 border-b border-line bg-surface px-5 pb-4 pt-3">
        <RegionPicker
          draft={draft}
          onChange={update}
          idPrefix="new-region"
          cityRef={cityRef}
          onSubmitIntent={add}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={add}
            disabled={!isRegionDraftFilled(draft)}
            className={primaryButtonClass}
          >
            {addLabel}
          </button>
          <p className="text-xs text-subtle">
            市区町村を選んで Enter でも追加できます。都道府県は追加後も保持されます。
          </p>
        </div>
        {notice ? (
          <p role="status" className="mt-2 text-xs font-medium text-warn">
            {notice}
          </p>
        ) : null}
      </div>

      {filled.length === 0 ? (
        <p className="mt-3 text-sm text-subtle">まだ追加されていません。</p>
      ) : (
        <div
          className={`mt-3 rounded-md border border-line ${
            filled.length > SCROLL_THRESHOLD ? "max-h-[26rem] overflow-y-auto" : ""
          }`}
        >
          <div className="sticky top-0 flex items-center justify-between border-b border-line bg-inset px-3 py-1.5 text-xs text-subtle">
            <span>
              追加する地域 <span className="tabular-nums">{filled.length}</span> 件
            </span>
            <span>追加順</span>
          </div>
          <ol className="divide-y divide-line">
            {drafts.map((item, index) => {
              const municipality = findMunicipality(item.prefecture, item.city);
              return (
                <li
                  key={item.key}
                  className="flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-hover"
                >
                  <span className="w-6 shrink-0 text-xs tabular-nums text-subtle">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-fg">
                    {regionDraftLabel(item)}
                  </span>
                  <span
                    data-numeric
                    className="hidden shrink-0 font-mono text-xs text-muted sm:inline"
                  >
                    {municipality ? `${municipality.lat}, ${municipality.lng}` : "-"}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onChange(drafts.filter((other) => other.key !== item.key))
                    }
                    className={subtleButtonClass}
                  >
                    削除
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </>
  );
}
