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

    return build_target(schedule, keyword, region)


def normalize_times(raw: Any) -> list[str]:
    """Postgres の time[] を "HH:MM" の配列に揃える。

    PostgREST は ["09:00:00"] のような配列で返すが、
    ドライバによっては "{09:00:00,18:00:00}" の文字列で来ることもある。
    """
    times = raw or []
    if isinstance(times, str):
        times = [t.strip() for t in times.strip("{}").split(",") if t.strip()]
    normalized = []
    for value in times:
        text = str(value).strip().strip('"')
        if len(text) >= 5:
            text = text[:5]
        if text:
            normalized.append(text)
    return sorted(set(normalized))


def build_target(
    schedule: dict[str, Any], keyword: dict[str, Any], region: dict[str, Any]
) -> ScheduleTarget:
    return ScheduleTarget(
        schedule_id=str(schedule["id"]),
        device=str(schedule["device"]),
        enabled=bool(schedule.get("enabled", True)),
        times=normalize_times(schedule.get("times")),
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


def _chunked(values: list[str], size: int = 200):
    for index in range(0, len(values), size):
        yield values[index : index + size]


def list_enabled_schedule_targets(sb: Client) -> list[ScheduleTarget]:
    """enabled=true のスケジュールを、実行に必要な情報を揃えて返す。

    PostgREST の埋め込みに頼らず3回に分けて引く（FK 定義の有無に依存しない）。
    service_role で読むので全ユーザー分が対象になる。
    """
    schedules = (
        sb.table("schedules").select("*").eq("enabled", True).execute().data or []
    )
    if not schedules:
        return []

    keyword_ids = sorted({str(row["keyword_id"]) for row in schedules})
    region_ids = sorted({str(row["region_id"]) for row in schedules})

    keywords: dict[str, dict[str, Any]] = {}
    for chunk in _chunked(keyword_ids):
        rows = sb.table("keywords").select("*").in_("id", chunk).execute().data or []
        for row in rows:
            keywords[str(row["id"])] = row

    regions: dict[str, dict[str, Any]] = {}
    for chunk in _chunked(region_ids):
        rows = sb.table("regions").select("*").in_("id", chunk).execute().data or []
        for row in rows:
            regions[str(row["id"])] = row

    targets: list[ScheduleTarget] = []
    for schedule in schedules:
        keyword = keywords.get(str(schedule["keyword_id"]))
        region = regions.get(str(schedule["region_id"]))
        # キーワードや地域が消えているスケジュールは実行しようがないので飛ばす。
        if keyword is None or region is None:
            continue
        targets.append(build_target(schedule, keyword, region))
    return targets


def list_runs_since(sb: Client, since: datetime) -> list[dict[str, Any]]:
    """指定時刻以降の runs を返す。再起動時の二重実行防止に使う。"""
    rows = (
        sb.table("runs")
        .select("schedule_id, run_at, status")
        .gte("run_at", since.astimezone(timezone.utc).isoformat())
        .order("run_at", desc=False)
        .execute()
        .data
    )
    return rows or []


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
