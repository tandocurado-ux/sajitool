"""Supabase の読み書き（schedules 読み込みと runs への記録のみ）。

service_role キーを使うため、このモジュールは計測エンジン（サーバー側）
からのみ呼ぶこと。フロントエンドからは絶対に読み込まない。

フェーズ2a では results テーブルには触らない。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from supabase import Client, create_client


class DatabaseError(RuntimeError):
    pass


@dataclass(frozen=True)
class ScheduleTarget:
    """schedules 1件と、それが指すキーワード・地域をまとめたもの。"""

    schedule_id: str
    device: str
    enabled: bool
    times: list[str]
    keyword_id: str
    keyword: str
    platform: str
    client_id: str
    region_id: str
    region_label: str
    prefecture: Optional[str]
    city: Optional[str]
    lat: Optional[float]
    lng: Optional[float]

    @property
    def has_coordinates(self) -> bool:
        return self.lat is not None and self.lng is not None


def create_supabase() -> Client:
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise DatabaseError(
            "engine/.env の SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。"
        )
    return create_client(url, key)


def _one(rows: Any, what: str, identifier: str) -> dict[str, Any]:
    if not rows:
        raise DatabaseError(f"{what} が見つかりません: {identifier}")
    return rows[0]


def fetch_schedule_target(sb: Client, schedule_id: str) -> ScheduleTarget:
    """schedules → keywords → regions を個別に引く。

    PostgREST の埋め込みに頼らないので、FK 定義の有無に左右されない。
    """
    schedule = _one(
        sb.table("schedules").select("*").eq("id", schedule_id).limit(1).execute().data,
        "schedule",
        schedule_id,
    )
    keyword = _one(
        sb.table("keywords")
        .select("*")
        .eq("id", schedule["keyword_id"])
        .limit(1)
        .execute()
        .data,
        "keyword",
        str(schedule["keyword_id"]),
    )
    region = _one(
        sb.table("regions")
        .select("*")
        .eq("id", schedule["region_id"])
        .limit(1)
        .execute()
        .data,
        "region",
        str(schedule["region_id"]),
    )

    times = schedule.get("times") or []
    if isinstance(times, str):
        times = [t.strip() for t in times.strip("{}").split(",") if t.strip()]

    return ScheduleTarget(
        schedule_id=str(schedule["id"]),
        device=str(schedule["device"]),
        enabled=bool(schedule.get("enabled", True)),
        times=[str(t) for t in times],
        keyword_id=str(keyword["id"]),
        keyword=str(keyword["keyword"]),
        platform=str(keyword["platform"]),
        client_id=str(keyword["client_id"]),
        region_id=str(region["id"]),
        region_label=str(region["label"]),
        prefecture=region.get("prefecture"),
        city=region.get("city"),
        lat=float(region["lat"]) if region.get("lat") is not None else None,
        lng=float(region["lng"]) if region.get("lng") is not None else None,
    )


def record_run(
    sb: Client,
    *,
    schedule_id: str,
    run_at: datetime,
    status: str,
    exit_ip: Optional[str],
) -> str:
    """runs に1行入れて id を返す。

    runs.status は 'ok' | 'blocked' | 'error' しか取れないため、
    実行開始時ではなく結果が出てから挿入する（run_at には開始時刻を入れる）。
    撃ったのに実は全部 blocked だった、をここで検知できるようにするのが目的。
    """
    payload: dict[str, Any] = {
        "schedule_id": schedule_id,
        "run_at": run_at.astimezone(timezone.utc).isoformat(),
        "status": status,
    }
    # --no-proxy のときは exit_ip を null のままにする。
    if exit_ip:
        payload["exit_ip"] = exit_ip

    rows = sb.table("runs").insert(payload).execute().data
    if not rows:
        raise DatabaseError("runs への挿入に失敗しました。")
    return str(rows[0]["id"])
