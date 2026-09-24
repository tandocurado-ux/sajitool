"use client";

import type { KeyboardEvent, RefObject } from "react";
import {
  PREFECTURES,
  buildRegionLabel,
  findMunicipality,
  municipalitiesOf,
} from "@/lib/japan";
import { inputClass, labelClass } from "./ui";

export type RegionDraft = {
  key: string;
  prefecture: string;
  city: string;
  /** 空なら「都道府県名+市区町村名」を自動生成して使う。 */
  label: string;
};

export function emptyRegionDraft(): RegionDraft {
  return {
    key: Math.random().toString(36).slice(2),
    prefecture: "",
    city: "",
    label: "",
  };
}

/** 入力として成立しているか（都道府県と市区町村が両方選ばれているか）。 */
export function isRegionDraftFilled(draft: RegionDraft): boolean {
  return draft.prefecture !== "" && draft.city !== "";
}

export function regionDraftLabel(draft: RegionDraft): string {
  const custom = draft.label.trim();
  if (custom) return custom;
  if (!isRegionDraftFilled(draft)) return "";
  return buildRegionLabel(draft.prefecture, draft.city);
}

type Props = {
  draft: RegionDraft;
  onChange: (patch: Partial<RegionDraft>) => void;
  idPrefix: string;
  /** 市区町村のプルダウンにフォーカスを戻すための参照（連続入力用）。 */
  cityRef?: RefObject<HTMLSelectElement | null>;
  /** 市区町村・ラベルで Enter を押したときに呼ぶ（「追加」と同じ動き）。 */
  onSubmitIntent?: () => void;
};

/**
 * 都道府県 → 市区町村 の2段プルダウン。
 * 緯度経度は市区町村の代表点から自動で決まるので編集させない
 * （手入力していた頃に経度の桁を打ち間違えて気づけない事故があったため）。
 */
export function RegionPicker({
  draft,
  onChange,
  idPrefix,
  cityRef,
  onSubmitIntent,
}: Props) {
  const cities = municipalitiesOf(draft.prefecture);
  const municipality = isRegionDraftFilled(draft)
    ? findMunicipality(draft.prefecture, draft.city)
    : null;

  function handleEnter(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" || !onSubmitIntent) return;
    // Enter でフォーム全体が送信されないようにして「追加」に回す。
    event.preventDefault();
    onSubmitIntent();
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor={`${idPrefix}-prefecture`} className={labelClass}>
          都道府県
        </label>
        <select
          id={`${idPrefix}-prefecture`}
          value={draft.prefecture}
          onChange={(event) =>
            // 都道府県が変わったら市区町村は選び直し。
            onChange({ prefecture: event.target.value, city: "" })
          }
          className={inputClass}
        >
          <option value="">選択してください</option>
          {PREFECTURES.map((prefecture) => (
            <option key={prefecture} value={prefecture}>
              {prefecture}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-city`} className={labelClass}>
          市区町村
        </label>
        <select
          id={`${idPrefix}-city`}
          ref={cityRef}
          value={draft.city}
          onChange={(event) => onChange({ city: event.target.value })}
          onKeyDown={handleEnter}
          disabled={cities.length === 0}
          className={inputClass}
        >
          <option value="">
            {draft.prefecture ? "選択してください" : "先に都道府県を選択"}
          </option>
          {cities.map((city) => (
            <option key={city.name} value={city.name}>
              {city.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-label`} className={labelClass}>
          ラベル（任意・省略時は自動生成）
        </label>
        <input
          id={`${idPrefix}-label`}
          type="text"
          value={draft.label}
          onChange={(event) => onChange({ label: event.target.value })}
          onKeyDown={handleEnter}
          placeholder={
            isRegionDraftFilled(draft)
              ? buildRegionLabel(draft.prefecture, draft.city)
              : "例: 名古屋市中区"
          }
          className={inputClass}
        />
      </div>

      <div>
        <span className={labelClass}>緯度・経度（自動）</span>
        <p
          data-numeric
          className="rounded-md border border-line bg-inset px-3 py-2 font-mono text-sm text-muted"
        >
          {municipality
            ? `${municipality.lat}, ${municipality.lng}`
            : "市区町村を選ぶと自動で設定されます"}
        </p>
      </div>
    </div>
  );
}
