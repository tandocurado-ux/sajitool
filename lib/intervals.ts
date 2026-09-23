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
