"""単発実行（run_once.py）とスケジューラ（scheduler.py）で共有する処理。

検索レシピそのものには手を触れない。ここにあるのは
「どのエンジンを呼ぶか」「結果をどう表示するか」「runs にどう記録するか」だけ。
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import device as dev
import search_google
import search_yahoo
from db import ScheduleTarget, record_run

# times は JST として扱う。サーバーの TZ 設定には依存させない。
JST = timezone(timedelta(hours=9))

ENGINES = {
    search_google.PLATFORM: search_google.search,
    search_yahoo.PLATFORM: search_yahoo.search,
}

STATUS_LABELS = {
    "ok": "成功",
    "blocked": "ボット検知（ブロック）",
    "error": "失敗",
}

ERROR_LABELS = {
    "not_searched": "検索結果ページに到達しませんでした（検索が成立していない）",
    "no_results": "検索結果ページには着いたが結果要素が見つかりませんでした",
    "search_box_not_found": "検索窓が見つかりませんでした（同意画面・別レイアウト・sorry 亜種の疑い）",
}

# 新しい exit IP を引き直せば通る見込みがあるもの。
RETRYABLE_ERRORS = ("search_box_not_found",)


def force_utf8_stdout() -> None:
    """Windows の既定コンソールだと日本語出力が化けるため UTF-8 に寄せる。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError, OSError):
            pass


def enable_system_trust_store() -> None:
    """OS の証明書ストアで TLS 検証する。

    社内プロキシやセキュリティソフトが TLS を差し替える環境だと、
    certifi のバンドルに無いルート証明書で Supabase への接続が
    CERTIFICATE_VERIFY_FAILED になる。Windows / macOS の証明書ストアを
    見るようにして回避する。truststore が無ければ何もしない。
    """
    try:
        import truststore

        truststore.inject_into_ssl()
    except Exception:  # noqa: BLE001 - 証明書設定で起動を止めない
        pass


def setup_runtime() -> None:
    """エントリポイントの先頭で呼ぶ初期化。"""
    force_utf8_stdout()
    enable_system_trust_store()


def now_jst() -> datetime:
    return datetime.now(JST)


# 日本のおおよその範囲。桁の打ち間違いに気づくための目安。
JAPAN_LAT_RANGE = (20.0, 46.0)
JAPAN_LNG_RANGE = (122.0, 154.0)


def japan_range_warning(target: ScheduleTarget) -> Optional[str]:
    """座標が日本の範囲外なら警告文を返す。

    経度 135.5023 を 35.5023 と打ち間違えても気づけなかった実例があるため、
    実行時にもログへ出す。実行自体は止めない（止めると原因が見えにくくなる）。
    """
    issues = []
    if target.lat is not None and not (
        JAPAN_LAT_RANGE[0] <= target.lat <= JAPAN_LAT_RANGE[1]
    ):
        issues.append(f"緯度 {target.lat}")
    if target.lng is not None and not (
        JAPAN_LNG_RANGE[0] <= target.lng <= JAPAN_LNG_RANGE[1]
    ):
        issues.append(f"経度 {target.lng}")
    if not issues:
        return None
    return (
        f"地域「{target.region_label}」の座標が日本の範囲外です"
        f"（{' / '.join(issues)}）。桁の打ち間違いの可能性があります。"
    )


def region_text(target: ScheduleTarget) -> str:
    text = target.region_label
    parts = [part for part in (target.prefecture, target.city) if part]
    if parts:
        text += f"（{' '.join(parts)}）"
    if target.has_coordinates:
        text += f" {target.lat}, {target.lng}"
    return text


def describe_target(target: ScheduleTarget) -> str:
    """ログ1行に収まる「KW × 地域 × デバイス × PF」表記。"""
    return (
        f"{target.keyword} × {target.region_label} × "
        f"{target.device} × {target.platform}"
    )


async def _search(
    *,
    platform: str,
    keyword: str,
    lat: Optional[float],
    lng: Optional[float],
    device: str,
    prefecture: Optional[str],
    use_proxy: bool,
    headless: bool,
    screenshot_path: Optional[Path],
    quiet: bool = False,
) -> dev.SearchOutcome:
    engine = ENGINES.get(platform)
    if engine is None:
        raise dev.SearchError(f"未対応の platform です: {platform}")

    proxy = dev.build_proxy_config(prefecture, platform=platform) if use_proxy else None
    if use_proxy and proxy is None and not quiet:
        print("  ! SOAX の環境変数が未設定のため、プロキシ無しで実行します。")

    return await engine(
        keyword=keyword,
        lat=lat,
        lng=lng,
        device=device,
        proxy=proxy,
        headless=headless,
        screenshot_path=screenshot_path,
    )


def should_retry(outcome: dev.SearchOutcome) -> bool:
    """IP を変えれば通るかもしれない結果か。"""
    if outcome.status == "blocked":
        return True
    return outcome.status == "error" and outcome.error in RETRYABLE_ERRORS


def run_search(
    *,
    platform: str,
    keyword: str,
    lat: Optional[float],
    lng: Optional[float],
    device: str,
    prefecture: Optional[str],
    use_proxy: bool,
    headless: bool,
    screenshot_path: Optional[Path] = None,
    quiet: bool = False,
    allow_retry: bool = True,
) -> dev.SearchOutcome:
    """検索を1回実行する（同期呼び出し）。Chrome は1プロセスずつ。

    blocked / 検索窓不明のときだけ、セッション ID を変えて新しい exit IP で
    1回だけ自動リトライする（session は build_proxy_config が毎回作り直す）。
    """
    kwargs = dict(
        platform=platform,
        keyword=keyword,
        lat=lat,
        lng=lng,
        device=device,
        prefecture=prefecture,
        use_proxy=use_proxy,
        headless=headless,
        screenshot_path=screenshot_path,
        quiet=quiet,
    )
    outcome = asyncio.run(_search(**kwargs))

    if not allow_retry or not use_proxy or not should_retry(outcome):
        return outcome
    if dev.soax_session_pinned():
        outcome.note("SOAX_SESSION_ID が固定されているためリトライしません（同じ IP になる）。")
        return outcome

    first_status = outcome.status
    first_error = outcome.error
    first_ip = outcome.exit_ip
    reason = first_status if first_status != "error" else (first_error or "error")
    print(
        f"  ! {reason} のため、セッションを変えて1回だけリトライします"
        f"（1回目の exit IP: {first_ip or '-'}）"
    )

    retry = asyncio.run(_search(**kwargs))
    retry.attempts = 2
    retry.note(
        f"リトライ: 1回目 status={first_status}"
        + (f"/{first_error}" if first_error else "")
        + f" exit IP {first_ip or '-'} → 2回目 status={retry.status} exit IP {retry.exit_ip or '-'}"
    )
    return retry


def run_search_for_target(
    target: ScheduleTarget,
    *,
    use_proxy: bool,
    headless: bool,
    screenshot_path: Optional[Path] = None,
    quiet: bool = False,
    allow_retry: bool = True,
) -> dev.SearchOutcome:
    return run_search(
        allow_retry=allow_retry,
        platform=target.platform,
        keyword=target.keyword,
        lat=target.lat,
        lng=target.lng,
        device=target.device,
        prefecture=target.prefecture,
        use_proxy=use_proxy,
        headless=headless,
        screenshot_path=screenshot_path,
        quiet=quiet,
    )


def print_header(
    *, keyword: str, region: str, device: str, platform: str, use_proxy: bool
) -> None:
    print("これから検索します:")
    print(f"  キーワード : {keyword}")
    print(f"  地域       : {region}")
    print(f"  デバイス   : {device}")
    print(f"  検索エンジン: {platform}")
    print(f"  プロキシ   : {'SOAX 経由' if use_proxy else '直結（--no-proxy）'}")


def print_outcome(outcome: dev.SearchOutcome, *, indent: str = "  ") -> None:
    label = STATUS_LABELS.get(outcome.status, outcome.status)
    print("結果:")
    print(f"{indent}判定       : {outcome.status}（{label}）")
    print(f"{indent}結果件数   : {outcome.result_count} 件")
    print(f"{indent}最終 URL   : {outcome.final_url[:120] or '-'}")
    print(f"{indent}exit IP    : {outcome.exit_ip or '-（--no-proxy では null）'}")
    if outcome.attempts > 1:
        print(f"{indent}試行回数   : {outcome.attempts}（セッションを変えてリトライ済み）")
    if outcome.error:
        print(f"{indent}エラー     : {ERROR_LABELS.get(outcome.error, outcome.error)}")
    if outcome.screenshot_path:
        print(f"{indent}スクショ   : {outcome.screenshot_path}（デバッグ用・未保存）")
    for note in outcome.notes:
        print(f"{indent}メモ       : {note}")


def record_outcome(
    sb,
    target: ScheduleTarget,
    run_at: datetime,
    outcome: dev.SearchOutcome,
) -> str:
    """runs に1行入れて id を返す。"""
    return record_run(
        sb,
        schedule_id=target.schedule_id,
        run_at=run_at,
        status=outcome.status,
        exit_ip=outcome.exit_ip,
    )
