"""異常の早期検知と通知。

検知が遅れて3週間分の計測を失った経験があるため、
「止まっている」「ブロックされ続けている」を能動的に知らせる。

通知先は ALERT_WEBHOOK_URL（Slack / Discord 互換の incoming webhook）。
未設定でも判定は動き、標準出力には必ず残す。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Callable, Optional, Sequence

# 判定のしきい値
WINDOW_HOURS = 3
BLOCKED_RATE_THRESHOLD = 0.30
BLOCKED_RATE_MIN_RUNS = 5
CONSECUTIVE_ERROR_THRESHOLD = 3

# 同じ条件の通知は6時間に1回まで（連打防止）
THROTTLE_HOURS = 6.0

# 日次サマリを流す時刻（JST）
DAILY_SUMMARY_HOUR = 21


@dataclass(frozen=True)
class ExecutionRecord:
    at: datetime
    schedule_id: str
    status: str


@dataclass(frozen=True)
class Alert:
    key: str
    message: str


def evaluate_alerts(
    *,
    now: datetime,
    history: Sequence[ExecutionRecord],
    expected_in_window: int,
    consecutive_errors: dict[str, int],
    describe: Optional[Callable[[str], str]] = None,
    window_hours: int = WINDOW_HOURS,
) -> list[Alert]:
    """直近の実行状況から通知すべき異常を洗い出す。

    expected_in_window は「その窓に実行予定が何件あったか」。
    起動直後に過去分で誤検知しないよう、呼び出し側で起動時刻以降に絞る。
    """
    cutoff = now - timedelta(hours=window_hours)
    recent = [record for record in history if record.at >= cutoff]
    alerts: list[Alert] = []

    # a. ブロック率が高い
    if len(recent) >= BLOCKED_RATE_MIN_RUNS:
        blocked = sum(1 for record in recent if record.status == "blocked")
        rate = blocked / len(recent)
        if rate > BLOCKED_RATE_THRESHOLD:
            alerts.append(
                Alert(
                    key="blocked_rate",
                    message=(
                        f"直近{window_hours}時間のブロック率が {rate * 100:.0f}% です"
                        f"（{len(recent)} 件中 {blocked} 件）。"
                        "プロキシの exit IP や実行間隔を確認してください。"
                    ),
                )
            )

    # b. 実行予定があったのに1件も動いていない（停止・詰まりの検知）
    if expected_in_window > 0 and len(recent) == 0:
        alerts.append(
            Alert(
                key="no_execution",
                message=(
                    f"直近{window_hours}時間、実行予定が {expected_in_window} 件あったのに"
                    "1件も実行されていません。スケジューラが停止または詰まっている可能性があります。"
                ),
            )
        )

    # c. 同じスケジュールが連続で失敗している
    for schedule_id, count in sorted(consecutive_errors.items()):
        if count < CONSECUTIVE_ERROR_THRESHOLD:
            continue
        label = describe(schedule_id) if describe else schedule_id
        alerts.append(
            Alert(
                key=f"consecutive_error:{schedule_id}",
                message=f"{count} 回連続で失敗しています: {label}",
            )
        )

    return alerts


class Notifier:
    """webhook への通知と、同一条件の連打防止。"""

    def __init__(
        self,
        webhook_url: Optional[str] = None,
        *,
        throttle_hours: float = THROTTLE_HOURS,
    ) -> None:
        self.webhook_url = (webhook_url or "").strip()
        self.throttle = timedelta(hours=throttle_hours)
        self.last_sent: dict[str, datetime] = {}

    @property
    def enabled(self) -> bool:
        return bool(self.webhook_url)

    def _post(self, message: str) -> None:
        if not self.webhook_url:
            return
        try:
            import httpx

            # Slack は text、Discord は content を見る。両方入れておけばどちらでも届く。
            httpx.post(
                self.webhook_url,
                json={"text": message, "content": message},
                timeout=10,
            )
        except Exception as caught:  # noqa: BLE001 - 通知失敗で常駐を止めない
            print(f"  ! アラート通知に失敗しました: {caught}")

    def alert(self, key: str, message: str, *, now: datetime) -> bool:
        """同じ key は throttle_hours に1回だけ送る。送ったら True。"""
        last = self.last_sent.get(key)
        if last is not None and now - last < self.throttle:
            return False
        self.last_sent[key] = now
        print(f"[{now:%m/%d %H:%M}] ⚠ アラート: {message}")
        self._post(f"⚠ サジェツール計測エンジン: {message}")
        return True

    def info(self, message: str, *, now: datetime) -> None:
        """日次サマリなど、抑制せずに流すもの。"""
        print(f"[{now:%m/%d %H:%M}] {message}")
        self._post(f"サジェツール計測エンジン: {message}")


def daily_summary_message(now: datetime, counts: dict[str, int]) -> str:
    total = sum(counts.values())
    return (
        f"{now:%m/%d} の実行サマリ: 実行 {total} 件 / "
        f"ok {counts.get('ok', 0)} / blocked {counts.get('blocked', 0)} / "
        f"error {counts.get('error', 0)}"
    )
