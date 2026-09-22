"""Yahoo! 検索の実行（未実証。Google と同じ作法で実装した初版）。

Google のレシピと同じ順序・同じ作法で組んである。Yahoo! 側の実挙動は
未確認なので、判定に使う文字列とセレクタはすべて定数にしてあり、
実測しながら調整できるようにしている。

想定外の挙動は SearchOutcome.notes に残して落とさない。

地点指定の順序（Google と同じ）
  1. about:blank を開く
  2. geolocation 権限を yahoo.co.jp と search.yahoo.co.jp の両方に付与
  3. Emulation.setGeolocationOverride(lat, lng, accuracy=100)
  4. yahoo.co.jp トップを開く
  5. 必ずリロード
  6. それから検索窓にタイプ
"""

from __future__ import annotations

import random
from pathlib import Path
from typing import Optional

import device as dev

PLATFORM = "yahoo"
HOME_URL = "https://www.yahoo.co.jp"
GEO_ORIGINS = ("https://www.yahoo.co.jp", "https://search.yahoo.co.jp")

# 検索結果 URL の印。Yahoo! のクエリは q= ではなく p=。
SEARCH_URL_MARKER = "search.yahoo.co.jp/search"
SEARCH_QUERY_PARAM = "p="

# CAPTCHA・認証まわりに飛ばされたときの印。実測で足す前提。
BLOCKED_URL_MARKERS = (
    "/captcha",
    "captcha.yahoo",
    "login.yahoo.co.jp",
    "ipblock",
    "/notice/",
)

SEARCH_BOX_SELECTORS: dict[str, tuple[str, ...]] = {
    "pc": (
        "input[name=p]",
        "#srchtxt",
        "input[role=combobox]",
        "form[role=search] input[type=text]",
    ),
    "mobile": (
        "input[name=p]",
        "#srchtxt",
        "input[role=combobox]",
        "form[role=search] input[type=text]",
        "input[type=search]",
    ),
}
SEARCH_INPUT_NAMES = ("p",)

RESULT_SELECTORS: dict[str, tuple[str, ...]] = {
    "pc": (
        "#contents .Algo .Algo__title a",
        "#web .Algo a h3",
        "#contents a h3",
        ".sw-Card__title a",
    ),
    "mobile": (
        "#contents .Algo .Algo__title a",
        "#contents a h3",
        ".sw-Card__title a",
        "#web li a h3",
    ),
}


async def search(
    *,
    keyword: str,
    lat: Optional[float],
    lng: Optional[float],
    device: str,
    proxy: Optional[dev.ProxyConfig] = None,
    headless: bool = False,
    result_timeout: float = 10.0,
    screenshot_path: Optional[Path] = None,
) -> dev.SearchOutcome:
    profile = dev.resolve_device(device)
    outcome = dev.SearchOutcome(status="error", platform=PLATFORM, device=device)

    browser = await dev.start_browser(proxy=proxy, headless=headless)
    tab = None
    try:
        tab = await browser.get("about:blank")
        await dev.setup_request_interception(tab, proxy)
        await dev.apply_device_profile(tab, profile)

        if proxy is not None:
            outcome.exit_ip = await dev.read_exit_ip(tab)
            if outcome.exit_ip is None:
                outcome.note("exit IP を取得できませんでした。")

        # --- 地点指定シーケンス（Google と同じ順序）---
        await tab.get("about:blank")
        if lat is not None and lng is not None:
            await dev.grant_geolocation(browser, tab, GEO_ORIGINS, lat, lng)
        else:
            outcome.note("regions に lat/lng が無いため地点指定なしで実行しました。")
        await tab.get(HOME_URL)
        await tab.reload()
        await tab.sleep(1.0)

        # --- 検索 ---
        selector = await dev.focus_search_box(
            tab, profile, SEARCH_BOX_SELECTORS[device], SEARCH_INPUT_NAMES
        )
        outcome.note(f"検索窓セレクタ: {selector}")
        await tab.sleep(random.uniform(0.3, 0.7))
        await dev.type_like_human(tab, keyword)
        await tab.sleep(random.uniform(0.2, 0.5))

        typed = await dev.typed_value(tab)
        if typed.strip() != keyword.strip():
            raise dev.SearchError(f"検索窓に入力が反映されていません（値: {typed!r}）。")

        await dev.press_enter(tab)

        outcome.result_count = await dev.wait_for_results(
            tab, RESULT_SELECTORS[device], max_seconds=result_timeout
        )
        outcome.final_url = await dev.current_url(tab)

        if any(marker in outcome.final_url for marker in BLOCKED_URL_MARKERS):
            outcome.status = "blocked"
        elif SEARCH_URL_MARKER not in outcome.final_url:
            # 検索窓に文字が入っただけの誤成功を防ぐ not_searched ガード
            outcome.status = "error"
            outcome.error = "not_searched"
        elif outcome.result_count == 0:
            outcome.status = "error"
            outcome.error = "no_results"
        else:
            outcome.status = "ok"

        if SEARCH_QUERY_PARAM not in outcome.final_url and outcome.status == "ok":
            # 判定は通ったがクエリ形式が想定と違う。落とさず記録だけする。
            outcome.note(
                f"検索結果 URL に {SEARCH_QUERY_PARAM} が見当たりません: {outcome.final_url[:120]}"
            )

        outcome.screenshot_path = await dev.capture_screenshot(tab, screenshot_path)

    except Exception as caught:  # noqa: BLE001 - runs に error として残すため握る
        outcome.status = "error"
        outcome.error = f"{type(caught).__name__}: {caught}"
        if tab is not None:
            outcome.final_url = outcome.final_url or await dev.current_url(tab)
            outcome.screenshot_path = await dev.capture_screenshot(tab, screenshot_path)
    finally:
        try:
            browser.stop()
        except Exception:
            pass

    return outcome
