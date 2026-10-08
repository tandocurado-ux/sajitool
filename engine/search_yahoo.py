"""Yahoo! 検索の実行。

2つのナビゲーション方式があり、SAJI_YAHOO_NAV_MODE で切り替える（既定 direct）。

direct（既定）
  検索結果 URL（search.yahoo.co.jp/search?p=<KW>）へ直接 goto する。トップページの
  取得・リロード・検索窓への手打ちが無いぶん、1 run の転送量が小さい。
  地点指定は、about:blank の時点で権限付与と override を済ませてから検索 URL を開く
  （結果ページの地域判定が最初の描画から効くように、goto より前に固定する）。

searchbox（旧方式・切り戻し用）
  Google のレシピと同じ順序・同じ作法。トップ → 必ずリロード → 検索窓に人間速度で
  タイプ → Enter。コードは残してあり、SAJI_YAHOO_NAV_MODE=searchbox で即座に戻せる。

  地点指定の順序（Google と同じ）
    1. about:blank を開く
    2. geolocation 権限を yahoo.co.jp と search.yahoo.co.jp の両方に付与
    3. Emulation.setGeolocationOverride(lat, lng, accuracy=100)
    4. yahoo.co.jp トップを開く
    5. 必ずリロード
    6. それから検索窓にタイプ

結果の判定（blocked / not_searched / no_results / ok）と、セッションを変えてのリトライ
（runner 側）はどちらの方式でも同じ。想定外の挙動は SearchOutcome.notes に残して落とさない。
"""

from __future__ import annotations

import random
from pathlib import Path
from typing import Optional
from urllib.parse import urlencode

import device as dev

PLATFORM = "yahoo"
HOME_URL = "https://www.yahoo.co.jp"
# direct 方式で開く検索 URL。クエリは p=、文字コードは ei=UTF-8 で明示する
# （トップの検索フォームが送るものと同じ）。
SEARCH_URL = "https://search.yahoo.co.jp/search"
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

# 結果のセレクタは方式に依らず同じ（direct でも同じ SERP が返る）。
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


def build_search_url(keyword: str) -> str:
    """direct 方式で開く検索結果 URL。"""
    return f"{SEARCH_URL}?{urlencode({'p': keyword, 'ei': 'UTF-8'})}"


async def _navigate_direct(
    browser, tab, *, keyword: str, lat: Optional[float], lng: Optional[float], outcome: dev.SearchOutcome
) -> None:
    """direct 方式: 地点を固定してから検索 URL へ直接 goto する。"""
    await tab.get("about:blank")
    if lat is not None and lng is not None:
        await dev.grant_geolocation(browser, tab, GEO_ORIGINS, lat, lng)
    else:
        outcome.note("regions に lat/lng が無いため地点指定なしで実行しました。")

    url = build_search_url(keyword)
    dev.stage("検索URLへ直接移動", url[:160])
    await tab.get(url)
    # 遅い IP でも遷移が終わってから結果を数える（readyState を待つ）。
    await dev.wait_for_ready(tab, label="検索結果到達待ち")
    dev.stage("最初のページ到達", await dev.current_url(tab) or url)


async def _navigate_searchbox(
    browser, tab, *, keyword: str, lat: Optional[float], lng: Optional[float], device: str,
    profile: dev.DeviceProfile, outcome: dev.SearchOutcome,
) -> None:
    """searchbox 方式（旧方式）: トップ → 必ずリロード → 検索窓に手打ち → Enter。"""
    # --- 地点指定シーケンス（Google と同じ順序）---
    await tab.get("about:blank")
    if lat is not None and lng is not None:
        await dev.grant_geolocation(browser, tab, GEO_ORIGINS, lat, lng)
    else:
        outcome.note("regions に lat/lng が無いため地点指定なしで実行しました。")
    await tab.get(HOME_URL)
    # 遅い IP だと遷移が終わる前に reload を送って CDP が切れるので、
    # 完了を待ってから必ずリロードする（順序は get → reload のまま）。
    await dev.wait_for_ready(tab, label="トップ到達待ち")
    await dev.reload_with_retry(tab, HOME_URL)
    await tab.sleep(1.0)
    await dev.wait_for_ready(tab, label="リロード後待ち")
    dev.stage("最初のページ到達", await dev.current_url(tab) or HOME_URL)

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
    nav_mode = dev.yahoo_nav_mode()
    outcome = dev.SearchOutcome(status="error", platform=PLATFORM, device=device, nav_mode=nav_mode)

    browser = await dev.start_browser(proxy=proxy, headless=headless)
    tab = None
    try:
        tab = await browser.get("about:blank")
        await dev.setup_request_interception(tab, proxy)
        dev.set_nav_mode(tab, nav_mode)
        await dev.apply_device_profile(tab, profile)

        if proxy is not None:
            outcome.exit_ip = await dev.read_exit_ip(tab)
            if outcome.exit_ip is None:
                outcome.note("exit IP を取得できませんでした。")

        dev.stage(
            "ナビゲーション方式",
            f"{nav_mode}（{'検索 URL へ直接 goto' if nav_mode == dev.NAV_MODE_DIRECT else 'トップ → リロード → 検索窓に手打ち'}。"
            f"{dev.YAHOO_NAV_MODE_ENV} で切替）",
        )
        if nav_mode == dev.NAV_MODE_DIRECT:
            await _navigate_direct(browser, tab, keyword=keyword, lat=lat, lng=lng, outcome=outcome)
        else:
            await _navigate_searchbox(
                browser, tab, keyword=keyword, lat=lat, lng=lng, device=device,
                profile=profile, outcome=outcome,
            )

        outcome.result_count = await dev.wait_for_results(
            tab, RESULT_SELECTORS[device], max_seconds=result_timeout
        )
        outcome.final_url = await dev.current_url(tab)

        if any(marker in outcome.final_url for marker in BLOCKED_URL_MARKERS):
            outcome.status = "blocked"
        elif SEARCH_URL_MARKER not in outcome.final_url:
            # 検索窓に文字が入っただけ／検索 URL から別の場所へ飛ばされた、の誤成功を防ぐ
            # not_searched ガード
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

        if SEARCH_QUERY_PARAM not in outcome.final_url and outcome.status == "ok":
            # 判定は通ったがクエリ形式が想定と違う。落とさず記録だけする。
            outcome.note(
                f"検索結果 URL に {SEARCH_QUERY_PARAM} が見当たりません: {outcome.final_url[:120]}"
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
        # CDP 切断（protocol_error）はセッション変更リトライの対象にするため分類する。
        outcome.error = dev.classify_error(caught)
        if outcome.error == dev.PROTOCOL_ERROR:
            outcome.note(f"CDP 通信エラー: {type(caught).__name__}: {caught}")
        dev.log_exception(caught, context="検索フローの例外で error 判定")
        if tab is not None:
            outcome.final_url = outcome.final_url or await dev.current_url(tab)
            outcome.screenshot_path = await dev.capture_screenshot(tab, screenshot_path)
    finally:
        # ok / error を問わず、プロセスが消えたことを確認してから戻る
        # （次の Chrome を起動する前に必ず終わっている状態にする）。
        await dev.close_browser(browser)

    return outcome
