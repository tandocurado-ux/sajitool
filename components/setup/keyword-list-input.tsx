"use client";

import { useState } from "react";
import { inputClass, labelClass, subtleButtonClass } from "../ui";

type Props = {
  keywords: string[];
  onChange: (keywords: string[]) => void;
};

/**
 * 入力欄＋「追加」でキーワードを1つずつ積むリスト。
 * 送信用の hidden（keywords、改行区切り）もここで出す。
 */
export function KeywordListInput({ keywords, onChange }: Props) {
  const [draft, setDraft] = useState("");

  const trimmed = draft.trim();
  const duplicate = trimmed !== "" && keywords.includes(trimmed);
  const canAdd = trimmed !== "" && !duplicate;

  function add() {
    if (!canAdd) return;
    onChange([...keywords, trimmed]);
    setDraft("");
  }

  return (
    <div>
      <input type="hidden" name="keywords" value={keywords.join("\n")} />

      <label htmlFor="keyword-draft" className={labelClass}>
        キーワード
      </label>
      <div className="flex flex-wrap items-start gap-2">
        <input
          id="keyword-draft"
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter でフォーム全体が送信されないようにする。
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          maxLength={200}
          placeholder="例: 不用品回収 名古屋"
          className={`${inputClass} max-w-md flex-1`}
        />
        <button
          type="button"
          onClick={add}
          disabled={!canAdd}
          className={subtleButtonClass}
        >
          追加
        </button>
      </div>
      {duplicate ? (
        <p className="mt-1 text-xs text-warn">
          「{trimmed}」はすでに追加されています。
        </p>
      ) : null}

      {keywords.length === 0 ? (
        <p className="mt-2 text-sm text-subtle">
          まだ追加されていません。あとから追加することもできます。
        </p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-line rounded-md border border-line">
          {keywords.map((keyword, index) => (
            <li
              key={keyword}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate text-fg">
                <span className="mr-2 text-xs text-subtle">{index + 1}</span>
                {keyword}
              </span>
              <button
                type="button"
                onClick={() => onChange(keywords.filter((item) => item !== keyword))}
                className="rounded-md px-2 py-0.5 text-xs text-subtle hover:bg-hover hover:text-fg"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
