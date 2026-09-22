"""lib/municipalities.ts を生成する。

Geolonia 住所データ（町丁目レベル、CC BY 4.0）から市区町村ごとの代表点を作る。
代表点は町丁目座標の中央値。平均だと飛び地や離島に引っ張られるため。

使い方:
    curl -o latest.csv \\
      https://raw.githubusercontent.com/geolonia/japanese-addresses/master/data/latest.csv
    python scripts/generate_municipalities.py latest.csv

生成後は必ず `npm run check:data` で網羅性（政令市の区・総数）を確認すること。
"""

from __future__ import annotations

import csv
import io
import statistics
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "latest.csv"
OUT = REPO_ROOT / "lib" / "municipalities.ts"

PREF_CODE, PREF_NAME, CITY_CODE, CITY_NAME, LAT, LNG = 0, 1, 4, 5, 12, 13

# Geolonia 住所データに町丁目が1件も無く欠落する市区町村。
# OpenStreetMap の行政界ポリゴン重心（Nominatim）で補う。
# (都道府県コード+市区町村コード, 都道府県名, 市区町村名, 緯度, 経度)
SUPPLEMENTS = [
    ("1336100", "東京都", "利島村", 34.5291, 139.2818),
    ("4345200", "熊本県", "球磨郡湯前町", 32.2762, 130.9809),
]


def main() -> None:
    points: dict[tuple[str, str, str, str], list[tuple[float, float]]] = defaultdict(list)

    with io.open(SRC, encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        next(reader)
        for row in reader:
            if len(row) <= LNG:
                continue
            lat_raw, lng_raw = row[LAT].strip(), row[LNG].strip()
            if not lat_raw or not lng_raw:
                continue
            try:
                lat, lng = float(lat_raw), float(lng_raw)
            except ValueError:
                continue
            if not (20 <= lat <= 46 and 122 <= lng <= 154):
                continue
            key = (row[PREF_CODE], row[PREF_NAME], row[CITY_CODE], row[CITY_NAME])
            points[key].append((lat, lng))

    by_pref: dict[str, list[tuple[str, str, float, float]]] = defaultdict(list)
    for (pref_code, pref_name, city_code, city_name), coords in points.items():
        lat = round(statistics.median(c[0] for c in coords), 4)
        lng = round(statistics.median(c[1] for c in coords), 4)
        by_pref[pref_name].append((pref_code + city_code, city_name, lat, lng))

    for code, pref_name, city_name, lat, lng in SUPPLEMENTS:
        existing = {row[1] for row in by_pref[pref_name]}
        if city_name not in existing:
            by_pref[pref_name].append((code, city_name, lat, lng))

    pref_order = sorted(by_pref, key=lambda name: min(x[0] for x in by_pref[name]))

    lines: list[str] = []
    lines.append('/**')
    lines.append(' * 全国の市区町村（政令市の区を含む）と代表点の緯度経度。')
    lines.append(' *')
    lines.append(' * 自動生成ファイル。手で編集しないこと。')
    lines.append(' * 出典: Geolonia 住所データ（CC BY 4.0）')
    lines.append(' *   https://github.com/geolonia/japanese-addresses')
    lines.append(' *   国土交通省「位置参照情報」および総務省統計局「国勢調査町丁・字等別境界データ」に由来。')
    lines.append(' * 代表点は町丁目レベル座標の中央値。')
    lines.append(' */')
    lines.append('')
    lines.append('/** [市区町村名, 緯度, 経度] */')
    lines.append('export type MunicipalityEntry = readonly [string, number, number];')
    lines.append('')
    lines.append(
        'export const MUNICIPALITIES_BY_PREFECTURE: Record<string, readonly MunicipalityEntry[]> = {'
    )

    total = 0
    for pref_name in pref_order:
        rows = sorted(by_pref[pref_name], key=lambda x: x[0])
        total += len(rows)
        lines.append(f'  "{pref_name}": [')
        for _, city_name, lat, lng in rows:
            lines.append(f'    ["{city_name}", {lat}, {lng}],')
        lines.append('  ],')
    lines.append('};')
    lines.append('')

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"都道府県 {len(pref_order)} / 市区町村 {total} 件")
    print(f"生成: {OUT} ({OUT.stat().st_size // 1024} KB)")
    for pref_name in pref_order[:3]:
        print(pref_name, len(by_pref[pref_name]), by_pref[pref_name][0])


if __name__ == "__main__":
    main()
