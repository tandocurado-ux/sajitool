/**
 * lib/municipalities.ts の網羅性チェック。
 *
 * 過去に政令指定都市の行政区が欠けたことがあるため、
 * 20政令市の区数と東京23区を機械的に検証する。
 *
 *   node scripts/check-municipalities.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "lib", "municipalities.ts"), "utf8");

/** 政令指定都市20市と、あるべき行政区の数。 */
const DESIGNATED_CITIES = [
  ["札幌市", 10],
  ["仙台市", 5],
  ["さいたま市", 10],
  ["千葉市", 6],
  ["横浜市", 18],
  ["川崎市", 7],
  ["相模原市", 3],
  ["新潟市", 8],
  ["静岡市", 3],
  ["浜松市", 7],
  ["名古屋市", 16],
  ["京都市", 11],
  ["大阪市", 24],
  ["堺市", 7],
  ["神戸市", 9],
  ["岡山市", 4],
  ["広島市", 8],
  ["北九州市", 7],
  ["福岡市", 7],
  ["熊本市", 5],
];

const TOKYO_SPECIAL_WARD_COUNT = 23;

function parse(text) {
  const byPrefecture = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const prefMatch = line.match(/^ {2}"(.+?)": \[$/);
    if (prefMatch) {
      current = prefMatch[1];
      byPrefecture.set(current, []);
      continue;
    }
    const entryMatch = line.match(/^ {4}\["(.+?)", (-?[\d.]+), (-?[\d.]+)\],$/);
    if (entryMatch && current) {
      byPrefecture.get(current).push({
        name: entryMatch[1],
        lat: Number(entryMatch[2]),
        lng: Number(entryMatch[3]),
      });
    }
  }
  return byPrefecture;
}

const byPrefecture = parse(source);
const problems = [];

// --- 都道府県数 ---
if (byPrefecture.size !== 47) {
  problems.push(`都道府県が ${byPrefecture.size} 件しかありません（47 件必要）。`);
}

const all = [...byPrefecture.entries()].flatMap(([prefecture, list]) =>
  list.map((entry) => ({ prefecture, ...entry })),
);

// --- 座標の妥当性 ---
for (const entry of all) {
  if (!(entry.lat >= 20 && entry.lat <= 46 && entry.lng >= 122 && entry.lng <= 154)) {
    problems.push(
      `座標が日本の範囲外: ${entry.prefecture}${entry.name} (${entry.lat}, ${entry.lng})`,
    );
  }
}

// --- 重複チェック ---
const seen = new Set();
for (const entry of all) {
  const key = `${entry.prefecture}/${entry.name}`;
  if (seen.has(key)) problems.push(`重複: ${key}`);
  seen.add(key);
}

// --- 政令指定都市の行政区 ---
console.log("政令指定都市の行政区");
console.log("--------------------------------------");
let wardTotal = 0;
for (const [city, expected] of DESIGNATED_CITIES) {
  const wards = all.filter(
    (entry) => entry.name.startsWith(city) && entry.name.endsWith("区"),
  );
  wardTotal += wards.length;
  const ok = wards.length === expected;
  console.log(
    `${ok ? "OK " : "NG "} ${city.padEnd(8, "　")} ${String(wards.length).padStart(2)} 区 / 期待 ${expected} 区`,
  );
  if (!ok) {
    problems.push(
      `${city} の区が ${wards.length} 件です（${expected} 件必要）: ${wards.map((w) => w.name).join(", ")}`,
    );
  }
  // 政令市は「市」単体の行を持たない（区単位で持つ）。
  const bare = all.find((entry) => entry.name === city);
  if (bare) {
    problems.push(`${city} が区なしの行として入っています（区単位で持つこと）。`);
  }
}
console.log(`政令市の区 合計: ${wardTotal} 区`);

// --- 東京23区 ---
const tokyoWards = (byPrefecture.get("東京都") ?? []).filter(
  (entry) => entry.name.endsWith("区"),
);
console.log(`東京都の特別区: ${tokyoWards.length} 区 / 期待 ${TOKYO_SPECIAL_WARD_COUNT} 区`);
if (tokyoWards.length !== TOKYO_SPECIAL_WARD_COUNT) {
  problems.push(
    `東京都の特別区が ${tokyoWards.length} 件です（${TOKYO_SPECIAL_WARD_COUNT} 件必要）。`,
  );
}

// --- 都道府県別件数 ---
console.log("");
console.log("都道府県別件数");
console.log("--------------------------------------");
for (const [prefecture, list] of byPrefecture) {
  console.log(`${prefecture.padEnd(5, "　")} ${String(list.length).padStart(4)} 件`);
}
console.log("--------------------------------------");
console.log(`合計 ${all.length} 件 / ${byPrefecture.size} 都道府県`);

// 市町村 1718 + 特別区 23 - 政令市 20 + 行政区 175 = 1896
const EXPECTED_TOTAL = 1896;
if (all.length !== EXPECTED_TOTAL) {
  problems.push(`合計が ${all.length} 件です（${EXPECTED_TOTAL} 件必要）。`);
}

if (problems.length > 0) {
  console.error("");
  console.error("問題あり:");
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}

console.log("");
console.log("チェック通過");
