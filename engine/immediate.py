"""即時計測（スケジュールの時刻枠を待たずに1件だけ撃つ）のキュー処理。

スキーマを変えない制約のため、キューは Supabase Auth のユーザー metadata に置く。

  - 依頼:  user_metadata.immediate_queue  … 画面（本人）が積む
  - 進捗:  app_metadata.immediate_runs    … ここ（service_role）だけが書く

scheduler.py が数十秒ごとに process_immediate_requests() を呼び、
依頼があれば定時のキューより先に1件ずつ実行する。検索そのものと runs への
記録は定時実行とまったく同じ経路（runner）で、検索レシピには触らない。
即時実行は定時のキュー・done・circuit breaker には一切関与しない。
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Optional

import device as dev
import runner
from db import fetch_schedule_target

QUEUE_KEY = "immediate_queue"
RUNS_KEY = "immediate_runs"
HISTORY_LIMIT = 20
# 1回の呼び出しで消化する最大件数（定時のキューを長く待たせない）。
MAX_PER_CALL = 3
# scheduler が確認する間隔（秒）。
POLL_SECONDS = float(os.environ.get("IMMEDIATE_POLL_SECONDS", "15") or 15)
USERS_PER_PAGE = 200


def enabled() -> bool:
    return os.environ.get("IMMEDIATE_RUNS_ENABLED", "1").strip().lower() not in ("0", "false", "no", "off")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _list_users(sb) -> list[Any]:
    users: list[Any] = []
    page = 1
    while True:
        batch = sb.auth.admin.list_users(page=page, per_page=USERS_PER_PAGE) or []
        users.extend(batch)
        if len(batch) < USERS_PER_PAGE:
            return users
        page += 1


def _queue_of(user) -> list[dict[str, Any]]:
    raw = (getattr(user, "user_metadata", None) or {}).get(QUEUE_KEY)
    if not isinstance(raw, list):
        return []
    return [entry for entry in raw if isinstance(entry, dict) and entry.get("id") and entry.get("schedule_id")]


def _runs_of(user) -> dict[str, Any]:
    raw = (getattr(user, "app_metadata", None) or {}).get(RUNS_KEY)
    return dict(raw) if isinstance(raw, dict) else {}


def _prune(runs: dict[str, Any]) -> dict[str, Any]:
    """古い進捗から落として HISTORY_LIMIT 件に収める。"""
    if len(runs) <= HISTORY_LIMIT:
        return runs
    ordered = sorted(runs.items(), key=lambda item: str(item[1].get("requested_at", "")))
    return dict(ordered[-HISTORY_LIMIT:])


def _write(sb, user_id: str, *, user_metadata: Optional[dict[str, Any]] = None, app_metadata: Optional[dict[str, Any]] = None) -> None:
    attributes: dict[str, Any] = {}
    if user_metadata is not None:
        attributes["user_metadata"] = user_metadata
    if app_metadata is not None:
        attributes["app_metadata"] = app_metadata
    sb.auth.admin.update_user_by_id(user_id, attributes)


def take_next_request(sb) -> Optional[tuple[str, dict[str, Any]]]:
    """全ユーザーの依頼から最も古い1件を取り出し、running として記録する。"""
    candidates: list[tuple[str, dict[str, Any], Any]] = []
    for user in _list_users(sb):
        for entry in _queue_of(user):
            candidates.append((str(entry.get("requested_at", "")), entry, user))
    if not candidates:
        return None

    candidates.sort(key=lambda item: item[0])
    _, request, user = candidates[0]
    remaining = [entry for entry in _queue_of(user) if entry.get("id") != request["id"]]
    runs = _runs_of(user)
    runs[str(request["id"])] = {
        "schedule_id": str(request["schedule_id"]),
        "status": "running",
        "requested_at": str(request.get("requested_at", "")),
        "started_at": _now_iso(),
        "finished_at": None,
        "result": None,
        "error": None,
    }
    _write(sb, str(user.id), user_metadata={QUEUE_KEY: remaining}, app_metadata={RUNS_KEY: _prune(runs)})
    return str(user.id), request


def _finish(sb, user_id: str, request_id: str, *, result: Optional[dict[str, Any]], error: Optional[str]) -> None:
    user = sb.auth.admin.get_user_by_id(user_id).user
    runs = _runs_of(user)
    entry = runs.get(request_id) or {}
    entry.update(
        {
            "status": "failed" if error else "done",
            "finished_at": _now_iso(),
            "result": result,
            "error": error,
        }
    )
    runs[request_id] = entry
    _write(sb, user_id, app_metadata={RUNS_KEY: _prune(runs)})


def _run_one(sb, user_id: str, request: dict[str, Any], *, use_proxy: bool, headless: bool) -> None:
    request_id = str(request["id"])
    schedule_id = str(request["schedule_id"])
    run_at = runner.now_jst()
    print("")
    print(f"[{run_at:%H:%M:%S}] ⚡ 即時実行（依頼 {request_id[:8]}… schedule {schedule_id}）")

    try:
        target = fetch_schedule_target(sb, schedule_id)
    except Exception as caught:  # noqa: BLE001 - 依頼が不正でも常駐は止めない
        dev.log_exception(caught, context="即時実行: スケジュールの取得")
        _finish(sb, user_id, request_id, result=None, error=f"スケジュールを取得できません: {caught}")
        return

    runner.print_header(
        keyword=target.keyword,
        region=runner.region_text(target),
        device=target.device,
        platform=target.platform,
        use_proxy=use_proxy,
    )

    try:
        outcome = runner.run_search_for_target(target, use_proxy=use_proxy, headless=headless, quiet=True)
    except Exception as caught:  # noqa: BLE001
        dev.log_exception(caught, context="即時実行: 検索の呼び出し自体が例外")
        outcome = dev.SearchOutcome(
            status="error",
            platform=target.platform,
            device=target.device,
            error=dev.classify_error(caught),
        )

    runner.print_outcome(outcome)

    run_id: Optional[str] = None
    try:
        run_id = runner.record_outcome(sb, target, run_at, outcome)
        print(f"  runs.id    : {run_id}（status={outcome.status} で記録・即時実行）")
    except Exception as caught:  # noqa: BLE001
        print(f"  ! runs への記録に失敗しました: {caught}")
        dev.log_exception(caught, context="即時実行: runs への記録")

    _finish(
        sb,
        user_id,
        request_id,
        result={
            "status": outcome.status,
            "result_count": outcome.result_count,
            "exit_ip": outcome.exit_ip,
            "final_url": (outcome.final_url or "")[:300],
            "error": outcome.error,
            "run_id": run_id,
            "attempts": outcome.attempts,
        },
        error=None,
    )


def process_immediate_requests(sb, *, use_proxy: bool, headless: bool) -> int:
    """依頼があれば最大 MAX_PER_CALL 件を実行して件数を返す。無ければ 0。"""
    if not enabled():
        return 0
    handled = 0
    while handled < MAX_PER_CALL:
        try:
            taken = take_next_request(sb)
        except Exception as caught:  # noqa: BLE001 - Auth API が落ちていても常駐は続ける
            print(f"  ! 即時実行キューの確認に失敗（続行）: {type(caught).__name__}: {caught}")
            return handled
        if taken is None:
            return handled
        user_id, request = taken
        try:
            _run_one(sb, user_id, request, use_proxy=use_proxy, headless=headless)
        except Exception as caught:  # noqa: BLE001
            dev.log_exception(caught, context="即時実行")
            try:
                _finish(sb, user_id, str(request["id"]), result=None, error=f"{type(caught).__name__}: {caught}")
            except Exception as inner:  # noqa: BLE001
                print(f"  ! 即時実行の結果書き込みに失敗: {inner}")
        handled += 1
    return handled
