"""単発実行（run_once.py）とスケジューラ（scheduler.py）で共有する処理。

検索レシピそのものには手を触れない。ここにあるのは
「どのエンジンを呼ぶか」「結果をどう表示するか」「runs にどう記録するか」だけ。
"""

from __future__ import annotations

import asyncio
import os
import random
import sys
import time
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
    "protocol_error": "ブラウザとの CDP 通信が切れました（遅い IP でページ遷移中にコマンドを送った等）",
}

# 新しい exit IP を引き直せば通る見込みがあるもの。
RETRYABLE_ERRORS = ("search_box_not_found", dev.PROTOCOL_ERROR)

# Google だけ: 判定不能（最終 URL が SERP でない / SERP の DOM 未到達）も
# BOT の疑いとしてリトライ対象にする。Yahoo! は従来どおり対象外。
GOOGLE_INDETERMINATE_ERRORS = ("not_searched", "no_results")

# Google の op 間ジッター（ヤマアラシ MEASURE_OP_WAIT 3〜8 秒）。リトライも新しい op なので
# リトライ前に必ず挟む。一様乱数で等間隔にしない。
GOOGLE_RETRY_JITTER_SECONDS = (3.0, 8.0)


def _env_int(name: str, default: int, *, minimum: int = 0, maximum: int = 20) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        print(f"! {name} が整数ではありません（{raw}）。既定の {default} を使います。")
        return default
    return max(minimum, min(maximum, value))


def google_retry_max() -> int:
    """Google の BOT 検知／判定不能時の最大リトライ回数（ヤマアラシ MEASURE_RETRY_MAX=3）。"""
    return _env_int("GOOGLE_RETRY_MAX", 3, minimum=0, maximum=10)


def google_retry_delay_seconds() -> float:
    """リトライ前の待ち（ヤマアラシ PROXYHAT_RETRY_DELAY_MS=1500 に ±50% のジッター）。"""
    base_ms = _env_int("GOOGLE_RETRY_DELAY_MS", 1500, minimum=0, maximum=60000)
    return random.uniform(base_ms * 0.5, base_ms * 1.5) / 1000.0


def _run_google_with_retries(kwargs: dict, *, keyword: str, use_proxy: bool, allow_retry: bool) -> dev.SearchOutcome:
    """Google 経路: BOT 検知（/sorry/）または判定不能なら、session を完全に振り直して
    別 IP プールに移り、最大 google_retry_max() 回までやり直す。

    各リトライの前に op 間ジッター（3〜8 秒）とリトライ遅延（1.5 秒 ±50%）を挟む。
    1回目の _search は finally で Chrome の停止を確認してから戻るので、
    同時に2つの Chrome は動かない。
    """
    retry_max = google_retry_max() if allow_retry and use_proxy else 0
    history: list[str] = []
    outcome = asyncio.run(_search(**kwargs))
    attempt = 1

    while attempt <= retry_max and should_retry(outcome, "google"):
        if dev.soax_session_pinned():
            outcome.note("SOAX_SESSION_ID が固定されているためリトライしません（同じ IP になる）。")
            break

        reason = outcome.status if outcome.status != "error" else (outcome.error or "error")
        history.append(f"{attempt}回目 status={outcome.status}" + (f"/{outcome.error}" if outcome.error else "") + f" exit IP {outcome.exit_ip or '-'}")

        # 焼けた session は捨てて別 IP プールへ。
        new_session = dev.rotate_google_session(keyword)
        op_wait = random.uniform(*GOOGLE_RETRY_JITTER_SECONDS)
        delay = google_retry_delay_seconds()
        print(
            f"  ! Google: {reason} のためリトライします（{attempt + 1}/{retry_max + 1} 回目、"
            f"新 session={new_session}、op 間 {op_wait:.1f} 秒 + リトライ遅延 {delay:.2f} 秒）"
        )
        time.sleep(op_wait + delay)

        outcome = asyncio.run(_search(**kwargs))
        attempt += 1

    outcome.attempts = attempt
    if use_proxy and outcome.status == "blocked":
        # 最後も /sorry/ なら、その session も焼けたので次回に持ち越さない。
        dev.rotate_google_session(keyword)
    if history:
        outcome.note(
            "リトライ: " + " → ".join(history)
            + f" → {attempt}回目 status={outcome.status} exit IP {outcome.exit_ip or '-'}"
        )
        if should_retry(outcome, "google"):
            outcome.note(f"リトライ上限（GOOGLE_RETRY_MAX={retry_max}）に達しました。")
    return outcome


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


def print_environment() -> None:
    """起動時に1回、Chrome・nodriver・環境変数の有無をログに出す。"""
    print("実行環境:")
    for line in dev.environment_lines():
        print(f"  {line}")


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

    proxy = (
        dev.build_proxy_config(prefecture, platform=platform, keyword=keyword)
        if use_proxy
        else None
    )
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


def should_retry(outcome: dev.SearchOutcome, platform: Optional[str] = None) -> bool:
    """IP を変えれば通るかもしれない結果か。"""
    if outcome.status == "blocked":
        return True
    if outcome.status != "error":
        return False
    if outcome.error in RETRYABLE_ERRORS:
        return True
    if platform == "google":
        # 判定不能も BOT 扱い（最終 URL が空のケースを含む）。
        return outcome.error in GOOGLE_INDETERMINATE_ERRORS or outcome.final_url == ""
    return False


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

    if platform == "google":
        # Google だけ最大 GOOGLE_RETRY_MAX 回（既定 3）のリトライ。
        # Yahoo! は下の従来どおりの経路（1回だけ）で、挙動は変えない。
        return _run_google_with_retries(
            kwargs, keyword=keyword, use_proxy=use_proxy, allow_retry=allow_retry
        )

    outcome = asyncio.run(_search(**kwargs))

    if not allow_retry or not use_proxy or not should_retry(outcome, platform):
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
        f"（1回目の exit IP: {first_ip or '-'}。1回目の Chrome は停止確認済み）"
    )

    # 1回目の _search は finally で close_browser を await してから戻るので、
    # ここに来た時点で前の Chrome プロセスは終了している（同時に2つは動かさない）。
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
    if outcome.status != "ok":
        print(f"{indent}最終段階   : {dev.last_stage()}")
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
