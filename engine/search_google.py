"""Google 検索の実行（本番実証済みレシピ）。

手順と順序に意味がある。1つでも欠けると /sorry/ に飛ぶため変更しないこと。

絶対条件
  - URL 直行禁止。google.co.jp トップから検索窓に人間速度でタイプする
  - Enter は CDP の Input.dispatchKeyEvent で送る（send_keys 相当では拾われない）
  - Google Chrome の実バイナリを使う（Chromium では通らない）
  - TZ=Asia/Tokyo / Accept-Language: ja-JP,ja;q=0.9 / 起動オプション --lang=ja

地点指定の順序（厳守）
  1. about:blank を開く
  2. geolocation 権限を google.co.jp と google.com の両方に付与
  3. Emulation.setGeolocationOverride(lat, lng, accuracy=100)
  4. google.co.jp を開く
  5. 必ずリロード
  6. それから検索窓にタイプ
"""

from __future__ import annotations

import random
from pathlib import Path
from typing import Optional

import device as dev

PLATFORM = "google"
HOME_URL = "https://www.google.co.jp"
GEO_ORIGINS = ("https://www.google.co.jp", "https://www.google.com")

# 検索結果 URL に必ず含まれる印
SEARCH_URL_MARKER = "/search?"
# ボット検知ページの印
BLOCKED_URL_MARKERS = ("/sorry/",)

# 検索窓は platform × device で DOM が違いうるので候補を順に試す。
SEARCH_BOX_SELECTORS: dict[str, tuple[str, ...]] = {
    "pc": ("textarea[name=q]", "input[name=q]", "#APjFqb"),
    "mobile": ("textarea[name=q]", "input[name=q]", "#APjFqb", "form textarea"),
}
SEARCH_INPUT_NAMES = ("q",)

RESULT_SELECTORS: dict[str, tuple[str, ...]] = {
    "pc": ("#rso a h3", "#search a h3", "div.g a h3"),
    "mobile": ("#rso a h3", "#search a h3", "div[data-hveid] a h3"),
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

        # --- 地点指定シーケンス（順序厳守）---
        await tab.get("about:blank")
        if lat is not None and lng is not None:
            await dev.grant_geolocation(browser, tab, GEO_ORIGINS, lat, lng)
        else:
            outcome.note("regions に lat/lng が無いため地点指定なしで実行しました。")
        await tab.get(HOME_URL)
        await tab.reload()
        await tab.sleep(1.0)
        dev.stage("最初のページ到達", await dev.current_url(tab) or HOME_URL)

        # 同意画面が挟まると検索窓が出てこない。出ていれば押してから進む。
        if await dev.looks_like_consent(tab):
            consent = await dev.try_accept_consent(tab)
            if consent:
                outcome.note(f"同意画面を処理しました（{consent}）")
                await tab.sleep(1.5)

        # --- 検索 ---
        try:
            await dev.focus_search_box(
                tab, profile, SEARCH_BOX_SELECTORS[device], SEARCH_INPUT_NAMES
            )
        except dev.SearchBoxNotFound:
            # 同意画面が遅れて出ることがあるので、一度だけ押し直して再挑戦する。
            consent = await dev.try_accept_consent(tab)
            if not consent:
                raise
            outcome.note(f"検索窓が無かったので同意画面を処理しました（{consent}）")
            await tab.sleep(1.5)
            await dev.focus_search_box(
                tab, profile, SEARCH_BOX_SELECTORS[device], SEARCH_INPUT_NAMES
            )
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
        dev.stage(
            "判定",
            f"status={outcome.status} error={outcome.error or '-'} "
            f"results={outcome.result_count} url={outcome.final_url[:120] or '-'}",
        )

        outcome.screenshot_path = await dev.capture_screenshot(tab, screenshot_path)

    except dev.SearchBoxNotFound as caught:
        # どの画面で見失ったのかを runs の注記と Render のログに残す。
        outcome.status = "error"
        outcome.error = "search_box_not_found"
        dev.log_exception(caught, context="検索窓が見つからず error 判定")
        for line in dev.format_diagnostics(caught.diagnostics):
            outcome.note(line)
        if tab is not None:
            outcome.final_url = outcome.final_url or await dev.current_url(tab)
            outcome.screenshot_path = await dev.capture_screenshot(tab, screenshot_path)
    except Exception as caught:  # noqa: BLE001 - runs に error として残すため握る
        outcome.status = "error"
        outcome.error = f"{type(caught).__name__}: {caught}"
        dev.log_exception(caught, context="検索フローの例外で error 判定")
        if tab is not None:
            outcome.final_url = outcome.final_url or await dev.current_url(tab)
            outcome.screenshot_path = await dev.capture_screenshot(tab, screenshot_path)
    finally:
        # ok / error を問わず、プロセスが消えたことを確認してから戻る
        # （次の Chrome を起動する前に必ず終わっている状態にする）。
        await dev.close_browser(browser)

    return outcome
