"""schedules の times どおりに計測を自動実行する常駐プロセス。

  python engine/scheduler.py [--no-proxy]

検索処理は run_once.py と同じ実装（search_google / search_yahoo / db）を
runner.py 経由でそのまま呼ぶ。検索レシピ自体には一切手を触れない。

動作:
  - 起動時と毎分、enabled=true の schedules を読み直す
  - times（JST）が現在の「分」と一致したものを platform 別のレーンに積む
  - 実行は逐次（Chrome は常に1本。並列化はヤマアラシが回線の奪い合いで revert
    したため採用しない）。ただし取り出しは Yahoo! と Google のラウンドロビンで、
    重い Google が前を占有して軽い Yahoo! を待たせない。各レーンは自分の実行間隔を持つ
  - 枠の上限判定（1枠で消化できない分はスキップ）と、1日の消化能力の見込みはレーンごと
  - 同じ schedule × 時刻 は同じ日に二度実行しない
    （再起動時は runs の当日分を読んで復元する）
  - 1件が失敗してもプロセスは死なない。runs に error で記録して次へ進む
  - Ctrl+C は実行中の1件を終えてから停止する
"""

from __future__ import annotations

import argparse
import json
import os
import random
import signal
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, Sequence

from dotenv import load_dotenv

ENGINE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ENGINE_DIR))

import alerts  # noqa: E402
import device as dev  # noqa: E402
import immediate  # noqa: E402
import runner  # noqa: E402
from db import (  # noqa: E402
    DatabaseError,
    ScheduleTarget,
    create_supabase,
    list_enabled_schedule_targets,
    list_runs_since,
)

# 実行と実行の間に空ける秒数。検知のきつさが違うので platform ごとに持つ。
# Google は弾かれやすいので長く、Yahoo! は検知されないので短くてよい。
PLATFORM_INTERVAL_DEFAULTS: dict[str, tuple[float, float]] = {
    "google": (60.0, 180.0),
    "yahoo": (20.0, 45.0),
}
PLATFORM_INTERVAL_ENV: dict[str, tuple[str, str]] = {
    "google": ("GOOGLE_INTERVAL_MIN_SECONDS", "GOOGLE_INTERVAL_MAX_SECONDS"),
    "yahoo": ("YAHOO_INTERVAL_MIN_SECONDS", "YAHOO_INTERVAL_MAX_SECONDS"),
}

# 上記に無い platform 用のフォールバック（RUN_INTERVAL_MIN/MAX_SECONDS）。
DEFAULT_RUN_INTERVAL_MIN_SECONDS = 60.0
DEFAULT_RUN_INTERVAL_MAX_SECONDS = 180.0

# 1つの時刻枠に収まってほしい時間。超えると次の枠に食い込む。
SLOT_CAPACITY_SECONDS = 3600

# 件数の絶対上限。0 なら無効で、枠の消化見込みだけで判断する。
DEFAULT_QUEUE_MAX_ITEMS = 0

# 実行が長引いて分をまたいだときに遡ってよい分数。
# これを超える取りこぼしは積まない（過去分のバックフィルはしない）。
MAX_CATCHUP_MINUTES = 5

# 起動時に表示する「今日の残り予定」の最大行数。
MAX_PLAN_LINES = 20

# 1回の追加でログに並べる最大行数。
MAX_BATCH_LINES = 10

# アラート判定のためにメモリへ残す実行履歴の長さ。
HISTORY_HOURS = 25

# Google の BOT circuit breaker でスキップしたペアの記録先（JSONL）。
# 環境変数 GOOGLE_SKIP_LOG で変更できる。
DEFAULT_GOOGLE_SKIP_LOG = ENGINE_DIR / "skipped_google.jsonl"

# circuit breaker を発動させる Google の連続 blocked 数（既定 3）。
DEFAULT_GOOGLE_BREAKER_THRESHOLD = 3

# メイン loop の周期（秒）。レーンの待ち時間判定と即時実行の確認に使う。
LOOP_TICK_SECONDS = 0.5

# 1件の検索そのものにかかる見込み秒数（間隔とは別。Google はリトライ込みの目安）。
# lib/intervals.ts の SEARCH_SECONDS_ESTIMATE と同じ値にしておく。
SEARCH_SECONDS_ESTIMATE: dict[str, float] = {"google": 40.0, "yahoo": 15.0}
# 1日の実行可能時間（時間）。DAILY_WINDOW_HOURS で変更可（既定 06:00〜23:00 の 17 時間）。
DEFAULT_DAILY_WINDOW_HOURS = 17.0
# 理論値に掛ける安全係数（リトライ・blocked・再起動を見込む）。
DAILY_CAPACITY_SAFETY = 0.8
# 1日の登録上限の env 名（設定があれば計算値より優先）。
DAILY_MAX_ENV: dict[str, str] = {"google": "GOOGLE_DAILY_MAX", "yahoo": "YAHOO_DAILY_MAX"}


def daily_window_seconds() -> float:
    return _env_float("DAILY_WINDOW_HOURS", DEFAULT_DAILY_WINDOW_HOURS) * 3600.0


def google_breaker_threshold() -> int:
    value = int(_env_float("GOOGLE_BREAKER_THRESHOLD", float(DEFAULT_GOOGLE_BREAKER_THRESHOLD)))
    return max(1, value)


@dataclass(frozen=True)
class Job:
    target: ScheduleTarget
    slot: str  # "HH:MM"
    key: str


@dataclass
class Lane:
    """platform ごとの実行レーン。キューと「次に実行してよい時刻」を持つ。"""

    platform: str
    queue: list[Job] = field(default_factory=list)
    # time.monotonic() ベース。この時刻まで次を実行しない（レーンごとの間隔）。
    next_allowed_at: float = 0.0
    # 完了件数（起動からの累計。ログ用）。
    completed: int = 0


LANE_ORDER = ("yahoo", "google")


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


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        print(f"! {name} が数値ではありません（{raw}）。既定の {default:.0f} 秒を使います。")
        return default
    if value < 0:
        print(f"! {name} が負の値です（{raw}）。既定の {default:.0f} 秒を使います。")
        return default
    return value


def queue_max_items() -> int:
    """件数の絶対上限。0 なら無効（枠の消化見込みだけで判断する）。"""
    return int(_env_float("QUEUE_MAX_ITEMS", float(DEFAULT_QUEUE_MAX_ITEMS)))


def _interval_range(
    min_name: str, max_name: str, defaults: tuple[float, float]
) -> tuple[float, float]:
    minimum = _env_float(min_name, defaults[0])
    maximum = _env_float(max_name, defaults[1])
    if maximum < minimum:
        print(
            f"! {max_name}({maximum:.0f}) が {min_name}({minimum:.0f}) より"
            "小さいので、上限を下限に揃えます。"
        )
        maximum = minimum
    return minimum, maximum


def run_interval_range() -> tuple[float, float]:
    """platform 別の設定が無いときに使う実行間隔（秒）。"""
    return _interval_range(
        "RUN_INTERVAL_MIN_SECONDS",
        "RUN_INTERVAL_MAX_SECONDS",
        (DEFAULT_RUN_INTERVAL_MIN_SECONDS, DEFAULT_RUN_INTERVAL_MAX_SECONDS),
    )


def platform_intervals() -> dict[str, tuple[float, float]]:
    """platform ごとの実行間隔（秒）。"""
    intervals: dict[str, tuple[float, float]] = {}
    for platform, (min_name, max_name) in PLATFORM_INTERVAL_ENV.items():
        intervals[platform] = _interval_range(
            min_name, max_name, PLATFORM_INTERVAL_DEFAULTS[platform]
        )
    return intervals


def _alternate_by_platform(jobs: list[Job]) -> list[Job]:
    """1キーワード分のジョブを google / yahoo 交互に並べ替える。"""
    buckets: dict[str, list[Job]] = {}
    for job in jobs:
        buckets.setdefault(job.target.platform, []).append(job)
    if len(buckets) < 2:
        return list(jobs)

    order = sorted(buckets, key=lambda name: (-len(buckets[name]), name))
    result: list[Job] = []
    while any(buckets[name] for name in order):
        for name in order:
            if buckets[name]:
                result.append(buckets[name].pop(0))
    return result


def spread_jobs(jobs: list[Job]) -> list[Job]:
    """同じキーワードが連続しないよう、キーワード単位でラウンドロビンする。

    同一キーワードの4パターン（google/yahoo × pc/mobile）が数分間隔で
    連射されると BOT 検知のシグナルになるため、必ず別キーワードを挟む。
    あわせて platform も直前と変えて、Google への連続アクセスを減らす。

    渡された順序（＝日次シャッフル後の順序）は、同点のときの決定に使う。
    ここで名前順に並べ替えてしまうとシャッフルが無意味になる。
    """
    buckets: dict[str, list[Job]] = {}
    appeared: dict[str, int] = {}
    for index, job in enumerate(jobs):
        keyword = job.target.keyword
        buckets.setdefault(keyword, []).append(job)
        appeared.setdefault(keyword, index)

    # キーワード内でも platform を交互にして、先頭の platform が偏らないようにする。
    for keyword, items in buckets.items():
        buckets[keyword] = _alternate_by_platform(items)

    result: list[Job] = []
    last_keyword: Optional[str] = None
    last_platform: Optional[str] = None

    while any(buckets.values()):
        candidates = [name for name, items in buckets.items() if items]

        def rank(name: str):
            head = buckets[name][0]
            return (
                name == last_keyword,  # 直前と同じキーワードは後回し
                head.target.platform == last_platform,  # platform も変えたい
                -len(buckets[name]),  # 残りが多いものから消化して偏りを残さない
                appeared[name],  # 最後はシャッフル順を尊重する
            )

        chosen = min(candidates, key=rank)
        job = buckets[chosen].pop(0)
        result.append(job)
        last_keyword = chosen
        last_platform = job.target.platform

    return result


def order_jobs(jobs: list[Job], *, seed: str) -> list[Job]:
    """同じ時刻枠の順序を毎日入れ替えてから、プラットフォームを交互にする。

    毎日同じ順序・同じ間隔で同じキーワードが飛ぶパターンを崩す。
    seed は日付ベースなので、同じ日に再起動しても順序は変わらない。
    """
    shuffled = list(jobs)
    random.Random(seed).shuffle(shuffled)
    return spread_jobs(shuffled)


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
        # platform 別のレーン。未知の platform は lane_for() が作る。
        self.lanes: dict[str, Lane] = {name: Lane(name) for name in LANE_ORDER}
        # 直前に実行した platform。次はこれ以外のレーンを優先する（ラウンドロビン）。
        self.last_platform: Optional[str] = None
        self.history: list[alerts.ExecutionRecord] = []
        self.consecutive_errors: dict[str, int] = {}
        self.notifier = alerts.Notifier(os.environ.get("ALERT_WEBHOOK_URL"))
        # BOT circuit breaker でスキップした Google ジョブ（累計と一覧。後で拾う用）。
        self.google_breaker_skipped = 0
        self.google_skipped: list[Job] = []
        # Google の連続 blocked 数（リトライを尽くしても blocked だった実行で1カウント）。
        self.google_consecutive_blocked = 0
        # 計測対象外（Google × pc など）としてログ済みのスケジュール id。
        self.skipped_targets: set[str] = set()
        self.google_breaker_threshold = google_breaker_threshold()

        self.started_at: Optional[datetime] = None
        self.last_daily_date: Optional[str] = None
        self.fallback_interval = run_interval_range()
        self.intervals = platform_intervals()
        self.queue_max = queue_max_items()

        self.stopping = False
        # 即時実行キューを次に確認する時刻（time.monotonic() ベース）。
        self.next_immediate_check = 0.0
        # どの分まで見たか。起動前の枠を積まないための基準。
        self.last_scanned_minute: Optional[datetime] = None
        self.last_loop_minute: Optional[str] = None
        self.last_summary_hour: Optional[str] = None

    # ------------------------------------------------------------------
    # レーン
    # ------------------------------------------------------------------

    def lane_for(self, platform: str) -> Lane:
        lane = self.lanes.get(platform)
        if lane is None:
            lane = Lane(platform)
            self.lanes[platform] = lane
        return lane

    @property
    def queue(self) -> list[Job]:
        """全レーンのキューを並べたもの（ログ・互換用。読み取り専用）。"""
        return [job for lane in self.lanes.values() for job in lane.queue]

    @queue.setter
    def queue(self, jobs: list[Job]) -> None:
        for lane in self.lanes.values():
            lane.queue = []
        for job in jobs:
            self.lane_for(job.target.platform).queue.append(job)

    def describe_lanes(self) -> str:
        return " / ".join(
            f"{lane.platform} キュー {len(lane.queue)} 件（完了 {lane.completed}）"
            for lane in self.lanes.values()
        )

    def search_seconds(self, platform: str) -> float:
        return SEARCH_SECONDS_ESTIMATE.get(platform, 30.0)

    def seconds_per_item(self, platform: str) -> float:
        """1件あたりの所要（間隔の平均 + 検索そのものの見込み）。"""
        return self.average_interval(platform) + self.search_seconds(platform)

    def daily_max(self, platform: str) -> int:
        """1日に消化できる件数の上限。env があればそれ、無ければ理論値 × 安全係数。"""
        env_name = DAILY_MAX_ENV.get(platform)
        if env_name:
            configured = int(_env_float(env_name, 0.0))
            if configured > 0:
                return configured
        return max(1, int(daily_window_seconds() / self.seconds_per_item(platform) * DAILY_CAPACITY_SAFETY))

    # ------------------------------------------------------------------
    # 実行間隔
    # ------------------------------------------------------------------

    def interval_for(self, platform: str) -> tuple[float, float]:
        return self.intervals.get(platform, self.fallback_interval)

    def average_interval(self, platform: str) -> float:
        minimum, maximum = self.interval_for(platform)
        return (minimum + maximum) / 2

    def estimated_seconds(self, jobs: Sequence[Job]) -> float:
        """その一群を消化するのにかかる待ち時間の見込み（検索時間は別）。"""
        return sum(self.average_interval(job.target.platform) for job in jobs)

    def describe_intervals(self) -> str:
        parts = [
            f"{platform} {minimum:.0f}〜{maximum:.0f}秒"
            for platform, (minimum, maximum) in sorted(self.intervals.items())
        ]
        return " / ".join(parts)

    # ------------------------------------------------------------------
    # スケジュールの読み込み
    # ------------------------------------------------------------------

    def refresh(self, now: datetime) -> None:
        try:
            loaded = list_enabled_schedule_targets(self.sb)
        except Exception as caught:  # noqa: BLE001 - 読めなくても常駐は続ける
            print(
                f"[{now:%H:%M}] ! スケジュールの読み込みに失敗しました（前回の内容で続行）: {caught}"
            )
            dev.log_exception(caught, context="スケジュールの読み込み")
            return

        # Google × pc など計測対象外の組み合わせは、DB に残っていても積まない
        # （初めて見たものだけログに出す）。Yahoo! は pc / mobile とも対象。
        kept: list[ScheduleTarget] = []
        newly_skipped: dict[str, list[ScheduleTarget]] = {}
        for target in loaded:
            reason = runner.skip_reason(target)
            if reason is None:
                kept.append(target)
                continue
            if target.schedule_id not in self.skipped_targets:
                self.skipped_targets.add(target.schedule_id)
                newly_skipped.setdefault(reason, []).append(target)
        for reason, targets in newly_skipped.items():
            examples = ", ".join(runner.describe_target(t) for t in targets[:3])
            more = f" … 他 {len(targets) - 3} 件" if len(targets) > 3 else ""
            print(f"[{now:%H:%M}] {reason}: {len(targets)} 件（例: {examples}{more}）")
        self.targets = kept

    def restore_from_runs(self, now: datetime) -> int:
        """当日すでに実行済みの枠を runs から復元する。

        返すのは「当日の runs と対応づいた予定枠の数」。
        起動前の枠は先に done 済みなので、ここで新たに加わるのは
        同じ分に再起動したときだけだが、ログには実態を出したいので
        既に done でも数える。
        """
        midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
        try:
            rows = list_runs_since(self.sb, midnight)
        except Exception as caught:  # noqa: BLE001
            print(f"! 当日の runs を読めませんでした（復元をスキップ）: {caught}")
            return 0

        by_schedule = {target.schedule_id: target for target in self.targets}
        matched: set[str] = set()
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
            if key not in matched:
                matched.add(key)
                restored += 1
            self.done.add(key)
        return restored

    def bootstrap(self, now: datetime) -> int:
        self.refresh(now)
        restored = self.restore_from_runs(now)

        # last_scanned_minute を None のままにしておくと、
        # 最初のスキャンは現在の分だけを見る（過去分は積まない）。
        self.last_scanned_minute = None
        self.last_loop_minute = now.strftime("%H:%M")
        self.enqueue_due(now)
        return restored

    # ------------------------------------------------------------------
    # キュー
    # ------------------------------------------------------------------

    def scan_window(self, now: datetime) -> list[tuple[str, str]]:
        """今回のスキャンで見る分の一覧を返し、基準を進める。

        起動直後と通常時は現在の分だけ。実行が長引いて分をまたいだときだけ、
        取りこぼさないように前回スキャンの次の分まで遡る（最大
        MAX_CATCHUP_MINUTES 分）。起動前の枠は絶対に見ない。
        """
        current = now.replace(second=0, microsecond=0)
        previous = self.last_scanned_minute

        if previous is None:
            start = current
        else:
            start = previous + timedelta(minutes=1)
            oldest = current - timedelta(minutes=MAX_CATCHUP_MINUTES)
            if start < oldest:
                skipped = int((oldest - start).total_seconds() // 60)
                print(
                    f"[{now:%H:%M}] ! 実行が長引き {skipped} 分ぶんのスキャンを"
                    "飛ばしました。その間の枠は実行しません。"
                )
                start = oldest

        self.last_scanned_minute = current
        if start > current:
            return []

        minutes: list[tuple[str, str]] = []
        cursor = start
        while cursor <= current:
            minutes.append((cursor.strftime("%Y-%m-%d"), cursor.strftime("%H:%M")))
            cursor += timedelta(minutes=1)
        return minutes

    def enqueue_due(self, now: datetime) -> None:
        window = self.scan_window(now)
        if not window:
            return

        due: list[Job] = []
        for date_text, hhmm in window:
            for target in self.targets:
                if hhmm not in target.times:
                    continue
                key = done_key(date_text, target.schedule_id, hhmm)
                if key in self.done:
                    continue
                # 積んだ時点で済み扱いにして、再読み込みでの二重積みを防ぐ。
                self.done.add(key)
                due.append(Job(target=target, slot=hhmm, key=key))

        if not due:
            return

        ordered = order_jobs(due, seed=f"{window[0][0]}|{window[0][1]}")
        # platform 別のレーンに分けて積む（順序は order_jobs のまま）。
        # 枠の上限判定もレーンごと。Google が溢れても Yahoo! は影響を受けない。
        by_platform: dict[str, list[Job]] = {}
        for job in ordered:
            by_platform.setdefault(job.target.platform, []).append(job)
        for platform, jobs in by_platform.items():
            lane = self.lane_for(platform)
            accepted, dropped = self.apply_queue_cap(lane, jobs, now)
            lane.queue.extend(accepted)
            self.report_batch(now, lane, accepted, dropped)

    def apply_queue_cap(
        self, lane: Lane, jobs: list[Job], now: datetime
    ) -> tuple[list[Job], list[Job]]:
        """そのレーンが1つの時刻枠で消化できない量は積まない。

        上限は固定値ではなく、レーンの間隔設定から決まる。レーンは並列に動くので
        Yahoo! の枠は Yahoo! だけ、Google の枠は Google だけで判断する。
        """
        budget = SLOT_CAPACITY_SECONDS - self.estimated_seconds(lane.queue)

        accepted: list[Job] = []
        used = 0.0
        for job in jobs:
            cost = self.average_interval(job.target.platform)
            if used + cost > budget:
                break
            accepted.append(job)
            used += cost

        # 絶対上限が設定されていれば、さらにそこで切る（レーンごと）。
        if self.queue_max > 0:
            room = max(0, self.queue_max - len(lane.queue))
            accepted = accepted[:room]

        dropped = jobs[len(accepted) :]
        if not dropped:
            return accepted, []

        self.notifier.alert(
            f"queue_overflow:{lane.platform}",
            (
                f"{lane.platform} レーンが1つの時刻枠（{SLOT_CAPACITY_SECONDS // 60} 分）で"
                f"消化できないため、{len(dropped)} 件を積みませんでした。"
                "当日中の再実行はしません。一括登録の「時刻の自動分散」で"
                "時刻をばらすか、実行間隔を見直してください。"
            ),
            now=now,
        )
        return accepted, dropped

    def report_batch(
        self, now: datetime, lane: Lane, jobs: list[Job], dropped: Optional[list[Job]] = None
    ) -> None:
        """レーンに積んだ件数と消化見込みを出す。枠に収まらないなら警告する。"""
        if dropped:
            print(
                f"[{now:%H:%M}] ! {lane.platform} レーンの枠に収まらないため "
                f"{len(dropped)} 件を積みませんでした。"
            )
        if not jobs:
            return

        print(f"[{now:%H:%M}] {lane.platform} レーンに {len(jobs)} 件追加")

        for job in jobs[:MAX_BATCH_LINES]:
            print(f"    {job.slot}  {runner.describe_target(job.target)}")
        if len(jobs) > MAX_BATCH_LINES:
            print(f"    … 他 {len(jobs) - MAX_BATCH_LINES} 件")

        estimate = self.estimated_seconds(jobs)
        queued = self.estimated_seconds(lane.queue)
        print(
            f"    消化見込み: 約 {estimate / 60:.0f} 分"
            f"（{lane.platform} の平均間隔 × {len(jobs)} 件。検索そのものの時間は別）"
        )
        if queued > estimate:
            print(f"    {lane.platform} レーン全体の消化見込み: 約 {queued / 60:.0f} 分")

        if queued > SLOT_CAPACITY_SECONDS:
            slot = min(job.slot for job in jobs)
            self.notifier.alert(
                f"slot_overflow:{lane.platform}:{slot}",
                (
                    f"{slot} の時点で {lane.platform} レーンのキューが {len(lane.queue)} 件あり、"
                    f"消化に約 {queued / 60:.0f} 分かかる見込みです"
                    f"（1枠 {SLOT_CAPACITY_SECONDS // 60} 分）。次の枠に食い込みます。"
                ),
                now=now,
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
        print(f"[{run_at:%H:%M:%S}] [{job.target.platform}] 実行開始（予定 {job.slot}）")
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
            # レシピの外（Chrome 起動・プロキシ組み立て・asyncio）で落ちた場合。
            # ここで握ると原因がログに残らないので traceback ごと出す。
            dev.log_exception(caught, context="検索の呼び出し自体が例外で error 判定")
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
            dev.log_exception(caught, context="runs への記録")

        # Google の circuit breaker: リトライを尽くしても blocked だった実行を1カウントとし、
        # 連続 GOOGLE_BREAKER_THRESHOLD 件（既定 3）で初めてこのバッチの残りをスキップする。
        # 単発の外れ IP では止めない。blocked 以外の結果でカウントは戻る。Yahoo! は無関係。
        # Google の circuit breaker: リトライを尽くしても blocked だった実行を1カウントとし、
        # 連続 GOOGLE_BREAKER_THRESHOLD 件（既定 3）で Google レーンのキューだけを捨てる。
        # 単発の外れ IP では止めない。blocked 以外の結果でカウントは戻る。Yahoo! は無関係。
        if job.target.platform == "google":
            if outcome.status == "blocked":
                self.google_consecutive_blocked += 1
                print(
                    f"  Google 連続 blocked: {self.google_consecutive_blocked}/"
                    f"{self.google_breaker_threshold}"
                )
                if self.google_consecutive_blocked >= self.google_breaker_threshold:
                    self.trip_google_breaker(run_at)
                    self.google_consecutive_blocked = 0
            else:
                self.google_consecutive_blocked = 0

        self.history.append(
            alerts.ExecutionRecord(
                at=run_at,
                schedule_id=job.target.schedule_id,
                status=outcome.status,
            )
        )
        # 同じスケジュールが連続で失敗していないかを追う。
        if outcome.status == "error":
            self.consecutive_errors[job.target.schedule_id] = (
                self.consecutive_errors.get(job.target.schedule_id, 0) + 1
            )
        else:
            self.consecutive_errors.pop(job.target.schedule_id, None)

    # ------------------------------------------------------------------
    # BOT circuit breaker（Google のみ）
    # ------------------------------------------------------------------

    def trip_google_breaker(self, now: datetime) -> int:
        """キューに残っている Google のジョブをスキップする。

        1件で /sorry/ を掴んだ直後に同じ密度で叩き続けると検知が固定化するため、
        このバッチの残りは実行しない（積んだ時点で done 扱いなので当日の再実行も
        しない）。Yahoo! のジョブはそのまま残す。
        """
        lane = self.lane_for("google")
        skipped = list(lane.queue)
        lane.queue = []
        if not skipped:
            return 0
        self.google_breaker_skipped += len(skipped)
        # スキップしたペアは後で拾えるよう、メモリと JSONL の両方に残す
        # （runs には書かない＝スキーマは変えない）。
        self.google_skipped.extend(skipped)
        self.record_skipped(now, skipped)

        print(
            f"[{now:%H:%M}] ! Google の BOT 検知（/sorry/）が {self.google_breaker_threshold} 件続いたため、"
            f"このバッチの残り {len(skipped)} 件（Google）をスキップします。Yahoo! は継続します。"
        )
        for job in skipped[:MAX_BATCH_LINES]:
            print(f"    skip {job.slot}  {runner.describe_target(job.target)}")
        if len(skipped) > MAX_BATCH_LINES:
            print(f"    … 他 {len(skipped) - MAX_BATCH_LINES} 件")

        self.notifier.alert(
            "google_circuit_breaker",
            (
                f"Google がボット検知（/sorry/）を {self.google_breaker_threshold} 件連続で返したため、"
                f"このバッチの残り {len(skipped)} 件の Google 計測をスキップしました。"
                "次の時刻枠からは通常どおり実行します。"
            ),
            now=now,
        )
        return len(skipped)

    def record_skipped(self, now: datetime, jobs: list[Job]) -> None:
        """スキップしたペアを JSONL に追記する（1行1件。失敗しても常駐は続ける）。"""
        path = Path(os.environ.get("GOOGLE_SKIP_LOG", "").strip() or DEFAULT_GOOGLE_SKIP_LOG)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                for job in jobs:
                    handle.write(
                        json.dumps(
                            {
                                "skipped_at": now.isoformat(),
                                "date": now.strftime("%Y-%m-%d"),
                                "slot": job.slot,
                                "schedule_id": job.target.schedule_id,
                                "keyword": job.target.keyword,
                                "region": job.target.region_label,
                                "device": job.target.device,
                                "platform": job.target.platform,
                                "reason": "google_circuit_breaker",
                            },
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
            print(f"    スキップ一覧を追記: {path}")
        except OSError as caught:
            print(f"    ! スキップ一覧の書き込みに失敗（続行）: {caught}")

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
        recent = [record.status for record in self.history if record.at >= cutoff]
        counts = {"ok": 0, "blocked": 0, "error": 0}
        for status in recent:
            if status in counts:
                counts[status] += 1

        print(
            f"[{now:%m/%d %H:%M}] 直近1時間: 実行 {len(recent)} 件 / "
            f"ok {counts['ok']} / blocked {counts['blocked']} / error {counts['error']}"
        )
        print(f"    レーン: {self.describe_lanes()}")

        keep_from = now - timedelta(hours=HISTORY_HOURS)
        self.history = [record for record in self.history if record.at >= keep_from]

        self.check_alerts(now)

    # ------------------------------------------------------------------
    # アラート
    # ------------------------------------------------------------------

    def describe_schedule(self, schedule_id: str) -> str:
        for target in self.targets:
            if target.schedule_id == schedule_id:
                return runner.describe_target(target)
        return schedule_id

    def expected_between(self, start: datetime, end: datetime) -> int:
        """その期間に実行予定が何件あったかを数える。"""
        count = 0
        for target in self.targets:
            for slot in target.times:
                try:
                    hour, minute = int(slot[:2]), int(slot[3:5])
                except (ValueError, IndexError):
                    continue
                for day_offset in (0, -1):
                    moment = (end + timedelta(days=day_offset)).replace(
                        hour=hour, minute=minute, second=0, microsecond=0
                    )
                    if start <= moment <= end:
                        count += 1
                        break
        return count

    def check_alerts(self, now: datetime) -> None:
        window_start = now - timedelta(hours=alerts.WINDOW_HOURS)
        # 起動前の予定で「実行0件」と誤検知しないよう、窓は起動時刻以降に限る。
        if self.started_at is not None and self.started_at > window_start:
            window_start = self.started_at

        found = alerts.evaluate_alerts(
            now=now,
            history=self.history,
            expected_in_window=self.expected_between(window_start, now),
            consecutive_errors=self.consecutive_errors,
            describe=self.describe_schedule,
        )
        for alert in found:
            self.notifier.alert(alert.key, alert.message, now=now)

    def daily_counts(self, now: datetime) -> dict[str, int]:
        """当日の実行結果。再起動をまたいでも正しくなるよう runs から数える。"""
        counts = {"ok": 0, "blocked": 0, "error": 0}
        midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
        try:
            for row in list_runs_since(self.sb, midnight):
                run_at = parse_run_at(row.get("run_at", ""))
                if run_at is None:
                    continue
                if run_at.astimezone(runner.JST).date() != now.date():
                    continue
                status = str(row.get("status"))
                if status in counts:
                    counts[status] += 1
            return counts
        except Exception as caught:  # noqa: BLE001
            print(f"  ! 日次サマリの集計に失敗しました（履歴で代用）: {caught}")

        for record in self.history:
            if record.at.date() == now.date() and record.status in counts:
                counts[record.status] += 1
        return counts

    def maybe_daily_summary(self, now: datetime) -> None:
        today = now.strftime("%Y-%m-%d")
        if self.last_daily_date == today:
            return
        if now.hour < alerts.DAILY_SUMMARY_HOUR:
            return
        self.last_daily_date = today
        self.notifier.info(
            alerts.daily_summary_message(now, self.daily_counts(now)), now=now
        )

    # ------------------------------------------------------------------
    # メインループ
    # ------------------------------------------------------------------

    def print_startup(self, now: datetime, restored: int) -> None:
        print("スケジューラを起動しました（時刻はすべて JST）。")
        print(f"  現在時刻   : {now:%Y-%m-%d %H:%M:%S}")
        print(f"  スケジュール: {len(self.targets)} 件（enabled=true）")
        print(f"  プロキシ   : {'SOAX 経由' if self.use_proxy else '直結（--no-proxy）'}")
        print(f"  実行間隔   : {self.describe_intervals()}")
        print(
            "  キュー上限 : "
            + (
                f"{self.queue_max} 件"
                if self.queue_max > 0
                else f"枠の消化見込み（{SLOT_CAPACITY_SECONDS // 60} 分）で判断"
            )
        )
        print(
            f"  実行方式   : 逐次（Chrome は常に1本）。レーン {', '.join(self.lanes)} を"
            "ラウンドロビンで取り出し、Google が Yahoo! を待たせない"
        )
        print(f"  起動直後のキュー: {len(self.queue)} 件（{self.describe_lanes()}）")
        print(
            "  アラート   : "
            + ("webhook へ通知" if self.notifier.enabled else "ログのみ（ALERT_WEBHOOK_URL 未設定）")
        )
        print(
            f"  Google対策 : リトライ最大 {runner.google_retry_max()} 回 / "
            f"breaker 連続 {self.google_breaker_threshold} 件 blocked で発動"
        )
        print(
            "  即時実行   : "
            + (
                f"{immediate.POLL_SECONDS:.0f} 秒ごとに依頼を確認（定時より優先）"
                if immediate.enabled()
                else "無効（IMMEDIATE_RUNS_ENABLED=0）"
            )
        )
        if restored > 0:
            print(
                f"  当日実行済み: {restored} 件（runs から復元。この枠は再実行しません）"
            )

        plan = self.remaining_today(now)
        print(f"  今日の残り予定: {len(plan)} 件")
        for slot, target in plan[:MAX_PLAN_LINES]:
            print(f"    {slot}  {runner.describe_target(target)}")
        if len(plan) > MAX_PLAN_LINES:
            print(f"    … 他 {len(plan) - MAX_PLAN_LINES} 件")
        self.print_forecast(now, plan)
        print("")
        print("停止するには Ctrl+C を押してください。")

    def print_forecast(self, now: datetime, plan: list[tuple[str, ScheduleTarget]]) -> None:
        """platform 別に「登録件数 / 1日の消化見込み / 充足率」を出し、超過なら警告する。

        1日の登録件数は targets の times の総数（当日実行済みぶんも含む）。
        消化見込みは 1日の実行可能時間（DAILY_WINDOW_HOURS）÷ 1件あたり所要 × 安全係数、
        または GOOGLE_DAILY_MAX / YAHOO_DAILY_MAX。実行は逐次なので合計も見る。
        """
        registered = Counter(target.platform for target in self.targets for _ in target.times)
        remaining = Counter(target.platform for _slot, target in plan)
        if not registered:
            return
        window = daily_window_seconds()
        print(f"  1日の消化能力（実行可能 {window / 3600:.0f} 時間、逐次実行）:")
        total_needed = 0.0
        over_any = False
        for platform in list(LANE_ORDER) + sorted(set(registered) - set(LANE_ORDER)):
            count = registered.get(platform, 0)
            if count == 0:
                continue
            per_item = self.seconds_per_item(platform)
            capacity = self.daily_max(platform)
            ratio = count / capacity if capacity else 0.0
            total_needed += count * per_item
            line = (
                f"    {platform}: 登録 {count} 件/日（本日残り {remaining.get(platform, 0)} 件） / "
                f"消化見込み {capacity} 件/日（1件 約 {per_item / 60:.1f} 分） / 充足率 {ratio * 100:.0f}%"
            )
            if ratio > 1.0:
                over_any = True
                line += f"  ! {platform} の登録数が1日の消化能力を超えています（約 {count - capacity} 件は消化できない見込み）"
            print(line)
        total_ratio = total_needed / window if window else 0.0
        line = f"    合計: 所要 約 {total_needed / 60:.0f} 分 / 実行可能 {window / 60:.0f} 分 / 充足率 {total_ratio * 100:.0f}%"
        if total_ratio > 1.0:
            over_any = True
            line += "  ! Google と Yahoo! は逐次に実行するため、合計でも1日に収まりません"
        print(line)
        if over_any:
            self.notifier.alert(
                "daily_capacity",
                "登録件数が1日の消化能力を超えています。まとめて登録の時刻分散を広げるか、"
                "Google の登録数を減らしてください（起動ログの「1日の消化能力」参照）。",
                now=now,
            )

    # ------------------------------------------------------------------
    # 取り出し（逐次・ラウンドロビン）
    # ------------------------------------------------------------------

    def pick_lane(self) -> Optional[Lane]:
        """次に実行するレーン。待ち時間が明けたレーンのうち、直前と違う platform を優先する。

        Google が連続で前を占有して Yahoo! を待たせないための公平化。
        Yahoo! がまだ自分の間隔の途中なら Google を先に進め、遊ばせない。
        """
        ready = [
            lane
            for lane in self.lanes.values()
            if lane.queue and time.monotonic() >= lane.next_allowed_at
        ]
        if not ready:
            return None
        others = [lane for lane in ready if lane.platform != self.last_platform]
        return (others or ready)[0]

    def run_next(self, now: datetime) -> bool:
        """レーンから1件取り出して逐次実行する。実行したら True。"""
        lane = self.pick_lane()
        if lane is None:
            return False
        job = lane.queue.pop(0)
        self.last_platform = lane.platform
        self.execute(job)
        lane.completed += 1
        gap = random.uniform(*self.interval_for(lane.platform))
        lane.next_allowed_at = time.monotonic() + gap
        if lane.queue:
            print(
                f"  次の {lane.platform} まで {gap:.0f} 秒待機します"
                f"（{self.describe_lanes()}）"
            )
        return True

    def tick(self, now: datetime) -> None:
        """メイン loop の1周ぶん（テストから直接呼べるように分けてある）。"""
        minute = now.strftime("%H:%M")
        if minute != self.last_loop_minute:
            self.last_loop_minute = minute
            self.refresh(now)
            self.enqueue_due(now)

        # 即時計測の依頼はレーンより先に拾う。定時のキュー・done・
        # circuit breaker には関与しない（単発なので）。
        if time.monotonic() >= self.next_immediate_check:
            self.next_immediate_check = time.monotonic() + immediate.POLL_SECONDS
            try:
                immediate.process_immediate_requests(
                    self.sb, use_proxy=self.use_proxy, headless=self.headless
                )
            except Exception as caught:  # noqa: BLE001 - 即時実行の失敗で常駐を止めない
                dev.log_exception(caught, context="即時実行キューの処理")

        self.maybe_hourly_summary(now)
        self.maybe_daily_summary(now)
        if not self.stopping:
            self.run_next(now)

    def run(self) -> int:
        now = runner.now_jst()
        self.started_at = now
        restored = self.bootstrap(now)
        self.print_startup(now, restored)

        while not self.stopping:
            self.tick(runner.now_jst())
            if self.stopping:
                break
            time.sleep(LOOP_TICK_SECONDS)

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
    parser.add_argument(
        "--headless",
        action="store_true",
        help="ヘッドレスで起動する（環境変数 ENGINE_HEADLESS=1 でも有効）",
    )
    return parser.parse_args(argv)


def headless_from_env() -> bool:
    return os.environ.get("ENGINE_HEADLESS", "").strip().lower() in ("1", "true", "yes")


def main(argv: Optional[list[str]] = None) -> int:
    runner.setup_runtime()
    load_dotenv(ENGINE_DIR / ".env")
    args = parse_args(argv)
    runner.print_environment()
    # Chrome と nodriver が接続できるかを起動時に1回だけ確かめる。
    # NG でもここでは止めない（ログで気づける状態にするのが目的）。
    dev.chrome_self_check(headless=args.headless or headless_from_env())

    try:
        sb = create_supabase()
    except DatabaseError as caught:
        print(f"エラー: {caught}", file=sys.stderr)
        return 2

    scheduler = Scheduler(
        sb,
        use_proxy=not args.no_proxy,
        headless=args.headless or headless_from_env(),
    )
    install_signal_handlers(scheduler)

    try:
        return scheduler.run()
    except KeyboardInterrupt:
        print("")
        print("強制終了しました。")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
