"""schedules の times どおりに計測を自動実行する常駐プロセス。

  python engine/scheduler.py [--no-proxy]

検索処理は run_once.py と同じ実装（search_google / search_yahoo / db）を
runner.py 経由でそのまま呼ぶ。検索レシピ自体には一切手を触れない。

動作:
  - 起動時と毎分、enabled=true の schedules を読み直す
  - times（JST）が現在の「分」と一致したものをキューに積む
  - キューは直列に1件ずつ実行する（Chrome を同時に複数立ち上げない）
  - 実行と実行の間に 30〜90 秒のランダム間隔を空ける
  - 同じ schedule × 時刻 は同じ日に二度実行しない
    （再起動時は runs の当日分を読んで復元する）
  - 1件が失敗してもプロセスは死なない。runs に error で記録して次へ進む
  - Ctrl+C は実行中の1件を終えてから停止する
"""

from __future__ import annotations

import argparse
import random
import signal
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
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
    list_enabled_schedule_targets,
    list_runs_since,
)

# 毎時0分に全件が固まって連射されるのを避けるための間隔。
MIN_GAP_SECONDS = 30
MAX_GAP_SECONDS = 90

# 起動時に表示する「今日の残り予定」の最大行数。
MAX_PLAN_LINES = 20


@dataclass(frozen=True)
class Job:
    target: ScheduleTarget
    slot: str  # "HH:MM"
    key: str


def done_key(date_text: str, schedule_id: str, slot: str) -> str:
    return f"{date_text}|{schedule_id}|{slot}"


def parse_run_at(value: str) -> Optional[datetime]:
    """runs.run_at を aware な datetime にする。

    timestamptz ならオフセット付き、timestamp ならオフセット無しで返るため、
    無い場合は UTC とみなす（エンジンは UTC で書き込んでいる）。
    """
    text = str(value).strip()
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def slot_for(times: list[str], hhmm: str) -> Optional[str]:
    """その時刻に対応する予定枠（hhmm 以下で最も遅いもの）を返す。"""
    candidates = [slot for slot in times if slot <= hhmm]
    return max(candidates) if candidates else None


class Scheduler:
    def __init__(self, sb, *, use_proxy: bool, headless: bool) -> None:
        self.sb = sb
        self.use_proxy = use_proxy
        self.headless = headless

        self.targets: list[ScheduleTarget] = []
        self.done: set[str] = set()
        self.queue: list[Job] = []
        self.history: list[tuple[datetime, str]] = []

        self.stopping = False
        self.next_allowed_at = 0.0  # time.monotonic() ベース
        self.last_scanned_minute: Optional[str] = None
        self.last_summary_hour: Optional[str] = None

    # ------------------------------------------------------------------
    # スケジュールの読み込み
    # ------------------------------------------------------------------

    def refresh(self, now: datetime) -> None:
        try:
            self.targets = list_enabled_schedule_targets(self.sb)
        except Exception as caught:  # noqa: BLE001 - 読めなくても常駐は続ける
            print(
                f"[{now:%H:%M}] ! スケジュールの読み込みに失敗しました（前回の内容で続行）: {caught}"
            )

    def restore_from_runs(self, now: datetime) -> int:
        """当日すでに実行済みの枠を runs から復元する。"""
        midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
        try:
            rows = list_runs_since(self.sb, midnight)
        except Exception as caught:  # noqa: BLE001
            print(f"! 当日の runs を読めませんでした（復元をスキップ）: {caught}")
            return 0

        by_schedule = {target.schedule_id: target for target in self.targets}
        restored = 0
        for row in rows:
            target = by_schedule.get(str(row.get("schedule_id")))
            if target is None:
                continue
            run_at = parse_run_at(row.get("run_at", ""))
            if run_at is None:
                continue
            local = run_at.astimezone(runner.JST)
            if local.date() != now.date():
                continue
            slot = slot_for(target.times, local.strftime("%H:%M"))
            if slot is None:
                continue
            key = done_key(now.strftime("%Y-%m-%d"), target.schedule_id, slot)
            if key not in self.done:
                self.done.add(key)
                restored += 1
        return restored

    def bootstrap(self, now: datetime) -> int:
        self.refresh(now)

        # 起動前に過ぎている枠は実行しない（過去分のバックフィルはしない）。
        today = now.strftime("%Y-%m-%d")
        current = now.strftime("%H:%M")
        for target in self.targets:
            for slot in target.times:
                if slot < current:
                    self.done.add(done_key(today, target.schedule_id, slot))

        restored = self.restore_from_runs(now)
        self.last_scanned_minute = current
        self.enqueue_due(now)
        return restored

    # ------------------------------------------------------------------
    # キュー
    # ------------------------------------------------------------------

    def enqueue_due(self, now: datetime) -> None:
        today = now.strftime("%Y-%m-%d")
        current = now.strftime("%H:%M")

        for target in self.targets:
            for slot in target.times:
                if slot > current:
                    continue
                key = done_key(today, target.schedule_id, slot)
                if key in self.done:
                    continue
                # 積んだ時点で済み扱いにして、再読み込みでの二重積みを防ぐ。
                self.done.add(key)
                self.queue.append(Job(target=target, slot=slot, key=key))
                print(
                    f"[{now:%H:%M}] 実行予定に追加: {slot} {runner.describe_target(target)}"
                )

    def remaining_today(self, now: datetime) -> list[tuple[str, ScheduleTarget]]:
        current = now.strftime("%H:%M")
        plan = [
            (slot, target)
            for target in self.targets
            for slot in target.times
            if slot > current
        ]
        plan.sort(key=lambda item: (item[0], item[1].keyword))
        return plan

    # ------------------------------------------------------------------
    # 実行
    # ------------------------------------------------------------------

    def execute(self, job: Job) -> None:
        run_at = runner.now_jst()
        print("")
        print(f"[{run_at:%H:%M:%S}] 実行開始（予定 {job.slot}）")
        runner.print_header(
            keyword=job.target.keyword,
            region=runner.region_text(job.target),
            device=job.target.device,
            platform=job.target.platform,
            use_proxy=self.use_proxy,
        )
        range_warning = runner.japan_range_warning(job.target)
        if range_warning:
            print(f"  ! {range_warning}")

        try:
            outcome = runner.run_search_for_target(
                job.target,
                use_proxy=self.use_proxy,
                headless=self.headless,
                quiet=True,
            )
        except Exception as caught:  # noqa: BLE001 - 1件の失敗で常駐を止めない
            outcome = dev.SearchOutcome(
                status="error",
                platform=job.target.platform,
                device=job.target.device,
                error=f"{type(caught).__name__}: {caught}",
            )

        runner.print_outcome(outcome)

        try:
            run_id = runner.record_outcome(self.sb, job.target, run_at, outcome)
            print(f"  runs.id    : {run_id}（status={outcome.status} で記録）")
        except Exception as caught:  # noqa: BLE001 - 記録に失敗しても続行する
            print(f"  ! runs への記録に失敗しました: {caught}")

        self.history.append((run_at, outcome.status))

    # ------------------------------------------------------------------
    # 集計ログ
    # ------------------------------------------------------------------

    def maybe_hourly_summary(self, now: datetime) -> None:
        hour_key = now.strftime("%Y-%m-%d %H")
        if self.last_summary_hour is None:
            self.last_summary_hour = hour_key
            return
        if hour_key == self.last_summary_hour:
            return
        self.last_summary_hour = hour_key

        cutoff = now - timedelta(hours=1)
        recent = [status for (at, status) in self.history if at >= cutoff]
        counts = {"ok": 0, "blocked": 0, "error": 0}
        for status in recent:
            if status in counts:
                counts[status] += 1

        print(
            f"[{now:%m/%d %H:%M}] 直近1時間: 実行 {len(recent)} 件 / "
            f"ok {counts['ok']} / blocked {counts['blocked']} / error {counts['error']}"
        )

        # 2時間より古い履歴は捨てる。
        keep_from = now - timedelta(hours=2)
        self.history = [item for item in self.history if item[0] >= keep_from]

    # ------------------------------------------------------------------
    # メインループ
    # ------------------------------------------------------------------

    def print_startup(self, now: datetime, restored: int) -> None:
        print("スケジューラを起動しました（時刻はすべて JST）。")
        print(f"  現在時刻   : {now:%Y-%m-%d %H:%M:%S}")
        print(f"  スケジュール: {len(self.targets)} 件（enabled=true）")
        print(f"  プロキシ   : {'SOAX 経由' if self.use_proxy else '直結（--no-proxy）'}")
        if restored > 0:
            print(f"  当日実行済み: {restored} 件を runs から復元（再実行しません）")

        plan = self.remaining_today(now)
        print(f"  今日の残り予定: {len(plan)} 件")
        for slot, target in plan[:MAX_PLAN_LINES]:
            print(f"    {slot}  {runner.describe_target(target)}")
        if len(plan) > MAX_PLAN_LINES:
            print(f"    … 他 {len(plan) - MAX_PLAN_LINES} 件")
        print("")
        print("停止するには Ctrl+C を押してください。")

    def run(self) -> int:
        now = runner.now_jst()
        restored = self.bootstrap(now)
        self.print_startup(now, restored)

        while not self.stopping:
            now = runner.now_jst()
            minute = now.strftime("%H:%M")

            if minute != self.last_scanned_minute:
                self.last_scanned_minute = minute
                self.refresh(now)
                self.enqueue_due(now)

            self.maybe_hourly_summary(now)

            if self.queue and time.monotonic() >= self.next_allowed_at:
                job = self.queue.pop(0)
                self.execute(job)
                if self.stopping:
                    break
                gap = random.uniform(MIN_GAP_SECONDS, MAX_GAP_SECONDS)
                self.next_allowed_at = time.monotonic() + gap
                if self.queue:
                    print(
                        f"  次の実行まで {gap:.0f} 秒待機します（キュー残り {len(self.queue)} 件）"
                    )
                continue

            time.sleep(1)

        print("")
        print("停止しました。")
        return 0


def install_signal_handlers(scheduler: Scheduler) -> None:
    def handler(_signum, _frame):
        if scheduler.stopping:
            print("")
            print("強制終了します。")
            raise KeyboardInterrupt
        scheduler.stopping = True
        print("")
        print(
            "停止要求を受けました。実行中の1件を終えてから停止します"
            "（もう一度 Ctrl+C で強制終了）。"
        )

    signal.signal(signal.SIGINT, handler)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, handler)


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="schedules の times どおりに計測を自動実行する"
    )
    parser.add_argument(
        "--no-proxy",
        action="store_true",
        help="SOAX を使わず直結で実行する（exit_ip は null になる）",
    )
    parser.add_argument("--headless", action="store_true", help="ヘッドレスで起動する")
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    runner.setup_runtime()
    load_dotenv(ENGINE_DIR / ".env")
    args = parse_args(argv)

    try:
        sb = create_supabase()
    except DatabaseError as caught:
        print(f"エラー: {caught}", file=sys.stderr)
        return 2

    scheduler = Scheduler(sb, use_proxy=not args.no_proxy, headless=args.headless)
    install_signal_handlers(scheduler)

    try:
        return scheduler.run()
    except KeyboardInterrupt:
        print("")
        print("強制終了しました。")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
