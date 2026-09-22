"""schedules を1件読んで検索を1回実行し、runs に実行ログを1行残す。

  python engine/run_once.py --schedule-id <uuid>
  python engine/run_once.py --schedule-id <uuid> --no-proxy

フェーズ2a は「撃つだけ」。スクリーンショット・順位・SERP は保存せず、
results テーブルにも触らない。runs への記録だけは必ず行う。

DB を触らずにブラウザのレシピだけ確認したいときは --dry-run を使う
（service_role キーが無いローカル環境での動作確認用）。
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

ENGINE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ENGINE_DIR))

import device as dev  # noqa: E402
import search_google  # noqa: E402
import search_yahoo  # noqa: E402
from db import (  # noqa: E402
    DatabaseError,
    ScheduleTarget,
    create_supabase,
    fetch_schedule_target,
    record_run,
)

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
}


def _force_utf8_stdout() -> None:
    """Windows の既定コンソールだと日本語出力が化けるため UTF-8 に寄せる。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError, OSError):
            pass


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="検索を1回だけ実行して runs に記録する")
    parser.add_argument("--schedule-id", help="schedules.id")
    parser.add_argument(
        "--no-proxy",
        action="store_true",
        help="SOAX を使わず直結で実行する（exit_ip は null になる）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="DB を触らずブラウザのレシピだけ実行する",
    )
    parser.add_argument("--keyword", help="--dry-run 時の検索語")
    parser.add_argument(
        "--platform",
        choices=sorted(ENGINES),
        default="google",
        help="--dry-run 時の検索エンジン",
    )
    parser.add_argument(
        "--device",
        choices=sorted(dev.DEVICE_PROFILES),
        default="pc",
        help="--dry-run 時のデバイス",
    )
    parser.add_argument("--lat", type=float, help="--dry-run 時の緯度")
    parser.add_argument("--lng", type=float, help="--dry-run 時の経度")
    parser.add_argument("--prefecture", help="--dry-run 時の SOAX exit 地域指定用")
    parser.add_argument("--headless", action="store_true", help="ヘッドレスで起動する")
    parser.add_argument(
        "--debug-screenshot",
        metavar="DIR",
        help="デバッグ用にスクショをローカル保存する（DB / Storage には上げない）",
    )

    args = parser.parse_args(argv)
    if args.dry_run:
        if not args.keyword:
            parser.error("--dry-run には --keyword が必要です。")
    elif not args.schedule_id:
        parser.error("--schedule-id を指定してください。")
    return args


def _screenshot_path(args: argparse.Namespace, label: str) -> Optional[Path]:
    if not args.debug_screenshot:
        return None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return Path(args.debug_screenshot) / f"{label}-{stamp}.png"


async def _run_search(
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
) -> dev.SearchOutcome:
    engine = ENGINES.get(platform)
    if engine is None:
        raise dev.SearchError(f"未対応の platform です: {platform}")

    proxy = dev.build_proxy_config(prefecture) if use_proxy else None
    if use_proxy and proxy is None:
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


def _print_header(
    *, keyword: str, region: str, device: str, platform: str, use_proxy: bool
) -> None:
    print("これから検索します:")
    print(f"  キーワード : {keyword}")
    print(f"  地域       : {region}")
    print(f"  デバイス   : {device}")
    print(f"  検索エンジン: {platform}")
    print(f"  プロキシ   : {'SOAX 経由' if use_proxy else '直結（--no-proxy）'}")


def _print_outcome(outcome: dev.SearchOutcome) -> None:
    label = STATUS_LABELS.get(outcome.status, outcome.status)
    print("結果:")
    print(f"  判定       : {outcome.status}（{label}）")
    print(f"  結果件数   : {outcome.result_count} 件")
    print(f"  最終 URL   : {outcome.final_url[:120] or '-'}")
    print(f"  exit IP    : {outcome.exit_ip or '-（--no-proxy では null）'}")
    if outcome.error:
        print(f"  エラー     : {ERROR_LABELS.get(outcome.error, outcome.error)}")
    if outcome.screenshot_path:
        print(f"  スクショ   : {outcome.screenshot_path}（デバッグ用・未保存）")
    for note in outcome.notes:
        print(f"  メモ       : {note}")


def run_dry(args: argparse.Namespace) -> int:
    _print_header(
        keyword=args.keyword,
        region=f"({args.lat}, {args.lng}) {args.prefecture or ''}".strip(),
        device=args.device,
        platform=args.platform,
        use_proxy=not args.no_proxy,
    )
    print("  ※ --dry-run のため runs には記録しません。")

    outcome = asyncio.run(
        _run_search(
            platform=args.platform,
            keyword=args.keyword,
            lat=args.lat,
            lng=args.lng,
            device=args.device,
            prefecture=args.prefecture,
            use_proxy=not args.no_proxy,
            headless=args.headless,
            screenshot_path=_screenshot_path(
                args, f"dryrun-{args.platform}-{args.device}"
            ),
        )
    )
    _print_outcome(outcome)
    return 0 if outcome.status == "ok" else 1


def run_scheduled(args: argparse.Namespace) -> int:
    sb = create_supabase()
    target: ScheduleTarget = fetch_schedule_target(sb, args.schedule_id)

    region = target.region_label
    if target.prefecture or target.city:
        region += f"（{' '.join(x for x in (target.prefecture, target.city) if x)}）"
    if target.has_coordinates:
        region += f" {target.lat}, {target.lng}"

    print(f"[schedule] {target.schedule_id}")
    _print_header(
        keyword=target.keyword,
        region=region,
        device=target.device,
        platform=target.platform,
        use_proxy=not args.no_proxy,
    )
    if not target.enabled:
        print("  ! このスケジュールは enabled=false です（単発実行なので続行します）。")
    if not target.has_coordinates:
        print("  ! この地域には lat/lng がありません（地点指定なしで実行します）。")

    run_at = datetime.now(timezone.utc)
    outcome = asyncio.run(
        _run_search(
            platform=target.platform,
            keyword=target.keyword,
            lat=target.lat,
            lng=target.lng,
            device=target.device,
            prefecture=target.prefecture,
            use_proxy=not args.no_proxy,
            headless=args.headless,
            screenshot_path=_screenshot_path(
                args, f"{target.schedule_id}-{target.platform}-{target.device}"
            ),
        )
    )
    _print_outcome(outcome)

    run_id = record_run(
        sb,
        schedule_id=target.schedule_id,
        run_at=run_at,
        status=outcome.status,
        exit_ip=outcome.exit_ip,
    )
    print(f"  runs.id    : {run_id}（status={outcome.status} で記録しました）")
    return 0 if outcome.status == "ok" else 1


def main(argv: Optional[list[str]] = None) -> int:
    _force_utf8_stdout()
    load_dotenv(ENGINE_DIR / ".env")
    args = parse_args(argv)

    try:
        return run_dry(args) if args.dry_run else run_scheduled(args)
    except (DatabaseError, dev.SearchError) as caught:
        print(f"エラー: {caught}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
