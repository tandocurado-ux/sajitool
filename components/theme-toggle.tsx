"use client";

import { useSyncExternalStore } from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "theme";

function readTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

/** <html data-theme> の変化を購読する。初期化スクリプトや他タブの変更にも追従する。 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // プライベートモード等で保存できなくても切り替え自体は効かせる。
  }
}

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "dark", label: "ダーク" },
  { value: "light", label: "ライト" },
];

/**
 * ダーク／ライトの切り替え。選択は localStorage に保存し、
 * 初回訪問時は OS 設定（prefers-color-scheme）に従う（app/layout.tsx の初期化）。
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "dark" as Theme);

  return (
    <div
      role="group"
      aria-label="表示テーマ"
      className="grid grid-cols-2 gap-0.5 rounded-md border border-line bg-inset p-0.5"
    >
      {OPTIONS.map((option) => {
        const active = option.value === theme;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => applyTheme(option.value)}
            aria-pressed={active}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-surface text-fg shadow-sm ring-1 ring-line"
                : "text-subtle hover:text-fg"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
