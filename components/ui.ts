// 共通のクラス定義。色は globals.css のトークン（bg-surface / text-muted など）
// だけを参照し、ここにも各コンポーネントにも生の色コードは書かない。

export const inputClass =
  "w-full rounded-md border border-line bg-inset px-3 py-2 text-sm text-fg placeholder:text-subtle transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60";

export const labelClass = "mb-1 block text-xs font-medium text-muted";

export const primaryButtonClass =
  "rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50";

export const subtleButtonClass =
  "rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50";

export const dangerButtonClass =
  "rounded-md border border-danger-line px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:cursor-not-allowed disabled:opacity-50";

export const cardClass = "rounded-lg border border-line bg-surface p-5";

export const errorTextClass = "mt-2 text-sm text-danger";

/** ページタイトル（h1）。サイズは text-2xl 固定で、太さと字詰めで階層を出す。 */
export const pageTitleClass = "text-2xl font-semibold tracking-tight text-fg";

/** カード内の見出し（h2）。 */
export const sectionTitleClass = "text-sm font-semibold tracking-tight text-fg";

/** テーブルのヘッダー行。小さく・弱い色で「見出し」感を出す。 */
export const tableHeadRowClass =
  "border-b border-line text-xs font-medium tracking-wide text-subtle";

/** テーブルの本体。ゼブラではなく hover で行を示す。 */
export const tableBodyClass = "divide-y divide-line";

export const tableRowClass = "transition-colors hover:bg-hover";

/** 大きな数値。等幅数字で桁を揃える。 */
export const statValueClass =
  "text-2xl font-semibold tracking-tight tabular-nums text-fg";
