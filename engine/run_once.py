"""schedules を1件読んで検索を1回実行し、runs に実行ログを1行残す。

  python engine/run_once.py --schedule-id <uuid>
  python engine/run_once.py --schedule-id <uuid> --no-proxy

定時実行は scheduler.py が行う。こちらは単発実行・動作確認用として残している。
検索処理・表示・runs への記録は runner.py で共通化してある。

DB を触らずにブラウザのレシピだけ確認したいときは --dry-run を使う
（service_role キーが無いローカル環境での動作確認用）。
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

ENGINE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ENGINE_DIR))

import device as dev  # noqa: E402
import runner  # noqa: E402
from db import (  # noqa: E402
    DatabaseError,
    ScheduleTarget,
    create_supabase,
    fetch_schedule_target,
)


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
        choices=sorted(runner.ENGINES),
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
    parser.add_argument(
        "--headless",
        action="store_true",
        help="ヘッドレスで起動する（環境変数 ENGINE_HEADLESS=1 でも有効）",
    )
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


def headless_from_env() -> bool:
    return os.environ.get("ENGINE_HEADLESS", "").strip().lower() in ("1", "true", "yes")


def _screenshot_path(args: argparse.Namespace, label: str) -> Optional[Path]:
    if not args.debug_screenshot:
        return None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return Path(args.debug_screenshot) / f"{label}-{stamp}.png"


def run_dry(args: argparse.Namespace) -> int:
    runner.print_header(
        keyword=args.keyword,
        region=f"({args.lat}, {args.lng}) {args.prefecture or ''}".strip(),
        device=args.device,
        platform=args.platform,
        use_proxy=not args.no_proxy,
    )
    print("  ※ --dry-run のため runs には記録しません。")

    outcome = runner.run_search(
        platform=args.platform,
        keyword=args.keyword,
        lat=args.lat,
        lng=args.lng,
        device=args.device,
        prefecture=args.prefecture,
        use_proxy=not args.no_proxy,
        headless=args.headless or headless_from_env(),
        screenshot_path=_screenshot_path(
            args, f"dryrun-{args.platform}-{args.device}"
        ),
    )
    runner.print_outcome(outcome)
    return 0 if outcome.status == "ok" else 1


def run_scheduled(args: argparse.Namespace) -> int:
    sb = create_supabase()
    target: ScheduleTarget = fetch_schedule_target(sb, args.schedule_id)

    print(f"[schedule] {target.schedule_id}")
    runner.print_header(
        keyword=target.keyword,
        region=runner.region_text(target),
        device=target.device,
        platform=target.platform,
        use_proxy=not args.no_proxy,
    )
    if not target.enabled:
        print("  ! このスケジュールは enabled=false です（単発実行なので続行します）。")
    if not target.has_coordinates:
        print("  ! この地域には lat/lng がありません（地点指定なしで実行します）。")
    range_warning = runner.japan_range_warning(target)
    if range_warning:
        print(f"  ! {range_warning}")

    run_at = runner.now_jst()
    outcome = runner.run_search_for_target(
        target,
        use_proxy=not args.no_proxy,
        headless=args.headless or headless_from_env(),
        screenshot_path=_screenshot_path(
            args, f"{target.schedule_id}-{target.platform}-{target.device}"
        ),
    )
    runner.print_outcome(outcome)

    run_id = runner.record_outcome(sb, target, run_at, outcome)
    print(f"  runs.id    : {run_id}（status={outcome.status} で記録しました）")
    return 0 if outcome.status == "ok" else 1


def main(argv: Optional[list[str]] = None) -> int:
    runner.setup_runtime()
    load_dotenv(ENGINE_DIR / ".env")
    args = parse_args(argv)

    try:
        return run_dry(args) if args.dry_run else run_scheduled(args)
    except (DatabaseError, dev.SearchError) as caught:
        print(f"エラー: {caught}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
