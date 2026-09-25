/**
 * 一括登録の画面で「消化できる設定か」を見積もるための定数。
 *
 * 実際の実行間隔は計測エンジン側の環境変数で決まる。ここにあるのは
 * engine/scheduler.py の PLATFORM_INTERVAL_DEFAULTS と揃えた既定値で、
 * あくまで画面に出す目安。engine 側を変えたらここも合わせること。
 */
export const PLATFORM_INTERVAL_SECONDS: Record<string, { min: number; max: number }> = {
  google: { min: 60, max: 180 },
  yahoo: { min: 20, max: 45 },
};

/** 1つの時刻枠で消化してほしい秒数（engine の SLOT_CAPACITY_SECONDS と同じ）。 */
export const SLOT_CAPACITY_SECONDS = 3600;

export function averageIntervalSeconds(platform: string): number {
  const range = PLATFORM_INTERVAL_SECONDS[platform];
  if (!range) return 120;
  return (range.min + range.max) / 2;
}

/** 選んだ検索エンジンの平均実行間隔（秒）。 */
export function averageIntervalFor(platforms: readonly string[]): number {
  if (platforms.length === 0) return 120;
  const total = platforms.reduce(
    (sum, platform) => sum + averageIntervalSeconds(platform),
    0,
  );
  return total / platforms.length;
}

function envPositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * 1つの時刻枠（60分）に入れてよい件数の推奨上限（platform 別）。
 *
 * 消化できる上限（枠 ÷ 平均間隔。Google は 60〜180 秒間隔で約 20〜60 件）ではなく
 * 「安全に回せる」目安。Google は検知リスクがあるので 1枠あたり少なめ（既定 4 件）、
 * Yahoo! は検知されないので多めに置く。
 * 環境変数（NEXT_PUBLIC_GOOGLE_SLOT_MAX / NEXT_PUBLIC_YAHOO_SLOT_MAX）で変えられる。
 */
export const PLATFORM_SLOT_RECOMMENDED_MAX: Record<string, number> = {
  google: envPositiveInt(process.env.NEXT_PUBLIC_GOOGLE_SLOT_MAX, 4),
  yahoo: envPositiveInt(process.env.NEXT_PUBLIC_YAHOO_SLOT_MAX, 60),
};

/** platform の推奨上限。未定義の platform は消化上限の半分を目安にする。 */
export function recommendedPerSlot(platform: string): number {
  const configured = PLATFORM_SLOT_RECOMMENDED_MAX[platform];
  if (configured) return configured;
  return Math.max(
    1,
    Math.floor(SLOT_CAPACITY_SECONDS / averageIntervalSeconds(platform) / 2),
  );
}
