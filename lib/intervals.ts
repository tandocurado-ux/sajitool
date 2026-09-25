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

/**
 * 1件の検索そのものにかかる見込み秒数（間隔とは別。Google はリトライ込みの目安）。
 * engine/scheduler.py の SEARCH_SECONDS_ESTIMATE と同じ値。
 */
export const SEARCH_SECONDS_ESTIMATE: Record<string, number> = {
  google: 40,
  yahoo: 15,
};

/** 1日の実行可能時間（時間）。既定 06:00〜23:00 の 17 時間。 */
export const DAILY_WINDOW_HOURS = (() => {
  const value = Number(process.env.NEXT_PUBLIC_DAILY_WINDOW_HOURS);
  return Number.isFinite(value) && value > 0 && value <= 24 ? value : 17;
})();

/** 理論値に掛ける安全係数（リトライ・blocked・再起動を見込む）。 */
export const DAILY_CAPACITY_SAFETY = 0.8;

/** 1件あたりの所要秒数（間隔の平均 + 検索そのものの見込み）。 */
export function secondsPerItem(platform: string): number {
  return averageIntervalSeconds(platform) + (SEARCH_SECONDS_ESTIMATE[platform] ?? 30);
}

const DAILY_MAX_OVERRIDE: Record<string, number> = {
  google: envPositiveInt(process.env.NEXT_PUBLIC_GOOGLE_DAILY_MAX, 0),
  yahoo: envPositiveInt(process.env.NEXT_PUBLIC_YAHOO_DAILY_MAX, 0),
};

/**
 * platform ごとの「1日に消化できる件数」の上限。
 *
 * 計測エンジンは Google と Yahoo! を逐次に実行するので、これは platform 単体で
 * 1日を使い切ったときの上限。NEXT_PUBLIC_GOOGLE_DAILY_MAX / NEXT_PUBLIC_YAHOO_DAILY_MAX
 * で固定値にできる（engine 側の GOOGLE_DAILY_MAX / YAHOO_DAILY_MAX と揃えること）。
 * 既定は 実行可能時間 ÷ 1件あたり所要 × 安全係数（Google 約 300 件、Yahoo! 約 1,000 件）。
 */
export function dailyMaxFor(platform: string): number {
  const override = DAILY_MAX_OVERRIDE[platform];
  if (override) return override;
  return Math.max(
    1,
    Math.floor((DAILY_WINDOW_HOURS * 3600) / secondsPerItem(platform) * DAILY_CAPACITY_SAFETY),
  );
}
