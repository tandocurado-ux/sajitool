/**
 * "use server" ファイルのエクスポート規約チェック。
 *
 * "use server" を付けたファイルは async 関数しかエクスポートできない。
 * 定数を置くと Client Component 側では Server Reference（関数）に化け、
 * ビルドは通るのに実行時だけ落ちる（本番で /clients/[id]/setup が
 * "This page couldn't load" になった原因がこれ）。
 *
 *   node scripts/check-server-actions.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const searchDirs = ["app", "components", "lib", "server"];
const problems = [];
let checked = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mts)$/.test(entry)) continue;
    check(full);
  }
}

function check(file) {
  const source = readFileSync(file, "utf8");
  // ファイル先頭の "use server" のみ対象（関数内インラインは別扱い）。
  const head = source.slice(0, 200);
  if (!/^\s*["']use server["'];/.test(head)) return;

  checked += 1;
  const rel = relative(repoRoot, file).replace(/\\/g, "/");

  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^export\s+(?!type\b|interface\b)(\S+)/);
    if (!match) continue;
    // 許されるのは `export async function` だけ。
    if (/^export\s+async\s+function\s/.test(line)) continue;
    problems.push(
      `${rel}: "use server" では async 関数以外をエクスポートできません -> ${line.trim()}`,
    );
  }
}

for (const dir of searchDirs) {
  const full = join(repoRoot, dir);
  try {
    if (statSync(full).isDirectory()) walk(full);
  } catch {
    // ディレクトリが無ければ飛ばす
  }
}

console.log(`"use server" ファイル ${checked} 件をチェックしました。`);

if (problems.length > 0) {
  console.error("");
  console.error("問題あり:");
  for (const problem of problems) console.error(` - ${problem}`);
  console.error("");
  console.error("型と定数は同じドメインの schema.ts など、通常のモジュールに移してください。");
  process.exit(1);
}

console.log("チェック通過");
