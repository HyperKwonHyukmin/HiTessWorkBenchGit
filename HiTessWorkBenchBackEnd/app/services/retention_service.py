"""결과 파일 보관 정책 순수 로직 — 라우터와 cleanup_service 가 같은 판정을 쓴다.

FastAPI·파일 삭제·알림에 의존하지 않는다. 그래서 어느 쪽에서 import 해도 순환이 없고,
테스트도 인메모리 datetime 만으로 검증한다.

용어
----
- work_folder      : ``userConnection/<YYYYMMDD_HHMMSS_<eid>_<program>>``. 실제 작업 파일이 사는 폴더.
- base_expiry      : 폴더 생성 시각 + 30일. 폴더명을 못 읽으면 record.created_at 로 폴백.
- effective_expiry : pinned → None, retain_until 있으면 그 값, 아니면 base_expiry.
- 판정 우선순위    : pinned > retain_until > 폴더 나이(30일).  — spec §2 D1
"""
from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models
from .program_registry import internal_substep_programs

# ── 상수(마스터 §2.3 확정값) ────────────────────────────────────────────
RETENTION_DAYS = 30            # 기본 보관 기간(cleanup_service.RETENTION_DAYS 와 같은 값을 유지)
EXTENSION_MAX_DAYS = 180       # 누적 연장 상한 — base_expiry 로부터의 최대 추가 일수
EXPIRING_SOON_DAYS = 7         # 만료 D-7 창(자정 스캔 알림 대상)
EXTEND_CHOICES = (30, 90)      # UI 라디오 선택지

# workspace.create_analysis_workspace 규약: YYYYMMDD_HHMMSS_<eid>_<program>
_FOLDER_TS_RE = re.compile(r"^(\d{8})_(\d{6})_")


class RetentionLimitError(ValueError):
    """연장 누적이 EXTENSION_MAX_DAYS 를 넘으면 발생. 라우터가 400 으로 매핑한다."""


# ── 폴더명 → 생성 시각 ─────────────────────────────────────────────────
def folder_created_at(folder_name: str) -> datetime | None:
    """`YYYYMMDD_HHMMSS_<eid>_<program>` → datetime. 실패 시 None.

    cleanup_service._get_folder_age_days 의 기존 파서 결함(prefix.split('_')[0] 이 8자리라
    len==14 검사에 걸려 stat 폴백으로 떨어짐)을 보완한 정확 구현이다.
    """
    if not isinstance(folder_name, str):
        return None
    match = _FOLDER_TS_RE.match(folder_name)
    if not match:
        return None
    stamp = f"{match.group(1)}_{match.group(2)}"
    try:
        return datetime.strptime(stamp, "%Y%m%d_%H%M%S")
    except ValueError:
        return None


# ── 기록 → work_folder ─────────────────────────────────────────────────
def work_folder_of(record: models.Analysis, user_connection_dir: str) -> str | None:
    """input_info→result_info 순으로 첫 번째 userConnection 하위 경로의 최상위 폴더명."""
    base_abs = os.path.abspath(user_connection_dir)
    base_norm = os.path.normcase(base_abs)
    for info in (record.input_info, record.result_info):
        if not isinstance(info, dict):
            continue
        for value in info.values():
            if not isinstance(value, str) or not value:
                continue
            path_abs = os.path.abspath(value)
            path_norm = os.path.normcase(path_abs)
            if not path_norm.startswith(base_norm + os.sep):
                continue
            rel = os.path.relpath(path_abs, base_abs)
            first = rel.split(os.sep, 1)[0]
            if first and first not in (".", ".."):
                return first
    return None


# ── 만료 계산 ──────────────────────────────────────────────────────────
def _naive(dt: datetime | None) -> datetime | None:
    """MySQL DATETIME 은 naive 로 저장되며, 라우터도 replace(tzinfo=None) 로 벗겨 쓴다.
    라우터·cleanup·판정이 같은 시간축을 쓰도록 여기서 tzinfo 를 제거한다."""
    if dt is None:
        return None
    return dt.replace(tzinfo=None) if getattr(dt, "tzinfo", None) else dt


def base_expiry(record: models.Analysis, folder_name: str | None) -> datetime:
    created = folder_created_at(folder_name) if folder_name else None
    if created is None:
        created = _naive(record.created_at) or datetime.now()
    return created + timedelta(days=RETENTION_DAYS)


def effective_expiry(record: models.Analysis, folder_name: str | None) -> datetime | None:
    if record.pinned:
        return None
    if record.retain_until is not None:
        return _naive(record.retain_until)
    return base_expiry(record, folder_name)


def extension_used_days(record: models.Analysis, folder_name: str | None) -> int:
    if record.retain_until is None:
        return 0
    delta = _naive(record.retain_until) - base_expiry(record, folder_name)
    return max(0, math.ceil(delta.total_seconds() / 86400))


def days_left(expiry: datetime | None, now: datetime) -> int | None:
    if expiry is None:
        return None
    return math.ceil((expiry - now).total_seconds() / 86400)


# ── classify / retention_state ─────────────────────────────────────────
def classify(record, folder_name, *, files_available, now):
    if not files_available:
        return "expired"
    if record.pinned:
        return "pinned"
    left = days_left(effective_expiry(record, folder_name), now)
    if left is not None and left <= EXPIRING_SOON_DAYS:
        return "expiring"
    return "available"


def retention_state(record, folder_name, *, files_available, now) -> dict:
    status = classify(record, folder_name, files_available=files_available, now=now)
    base = base_expiry(record, folder_name)
    expires = effective_expiry(record, folder_name)
    used = extension_used_days(record, folder_name)
    return {
        "status": status,
        "pinned": bool(record.pinned),
        "retain_until": record.retain_until.isoformat() if record.retain_until else None,
        "base_expires_at": base.isoformat(),
        "expires_at": expires.isoformat() if expires else None,
        "days_left": days_left(expires, now),
        "extension_used_days": used,
        "extension_remaining_days": max(0, EXTENSION_MAX_DAYS - used),
    }


# ── apply_retention_change ─────────────────────────────────────────────
def apply_retention_change(record, folder_name, *, extend_days, pinned, now) -> None:
    """record 를 in-place 로 갱신한다. commit 은 호출자 책임.

    - extend_days=None → 연장 없음. 정수면 1~180 범위여야 하고 누적 상한을 넘으면 RetentionLimitError.
    - pinned=None → 변경 없음. True/False 면 그 값으로 설정.
    - 이미 만료된 시각을 기준으로 잡으면 즉시 재만료되므로 max(현재 만료, now) + extend_days 로 계산한다.
    """
    if extend_days is not None:
        if not isinstance(extend_days, int) or extend_days < 1 or extend_days > EXTENSION_MAX_DAYS:
            raise ValueError(f"extend_days out of range: {extend_days!r}")
        current = effective_expiry(record, folder_name) or now
        anchor = max(current, now)
        record.retain_until = anchor + timedelta(days=extend_days)
        used = extension_used_days(record, folder_name)
        if used > EXTENSION_MAX_DAYS:
            # 이 요청 시도가 상한을 넘겼다 — 이전 값 복원은 호출자가 rollback 으로 처리.
            raise RetentionLimitError(
                f"누적 연장이 {EXTENSION_MAX_DAYS}일을 초과합니다 (요청 후 {used}일)."
            )
    if pinned is not None:
        record.pinned = bool(pinned)


# ── primary_record / decide_folder ─────────────────────────────────────
@dataclass(frozen=True)
class FolderDecision:
    action: str                  # "keep_pinned" | "keep_extended" | "keep" | "delete"
    expires_at: datetime | None
    days_left: int | None
    record: models.Analysis | None


def primary_record(records):
    """spec §2 D5·D7: 하위 단계가 아닌 기록 우선, 그중 id 최소.

    ModuleStability/ModuleHoistOptimize/UnitStructuralAnalysis 같은 내부 단계는 부모
    (SidePassage/GroupModuleUnit) 폴더의 경로를 그대로 가리키므로 알림을 이들 각각에
    보내면 같은 폴더에 여러 개가 쌓인다. 사용자에게 보이는 기록에만 보낸다.
    """
    internal = frozenset(internal_substep_programs())
    non_internal = [r for r in records if r.program_name not in internal]
    pool = non_internal if non_internal else list(records)
    if not pool:
        return None
    return min(pool, key=lambda r: r.id)


def decide_folder(folder_name, records, *, folder_age_days, now) -> FolderDecision:
    """폴더 하나에 대한 삭제/보존 판정. spec §2 D1·D5·D6 구현."""
    if records:
        if any(r.pinned for r in records):
            pinned_rec = next(r for r in records if r.pinned)
            return FolderDecision("keep_pinned", None, None, pinned_rec)
        with_retain = [r for r in records if r.retain_until is not None]
        if with_retain:
            expires = max(_naive(r.retain_until) for r in with_retain)
            left = days_left(expires, now)
            rep = primary_record(records)
            if expires > now:
                return FolderDecision("keep_extended", expires, left, rep)
            return FolderDecision("delete", expires, left, rep)
    # 폴더 나이 규칙 (records 가 없거나, 있어도 pinned/retain_until 모두 없음)
    if folder_age_days < RETENTION_DAYS:
        rep = primary_record(records) if records else None
        # 대표 기록의 base_expiry 로 days_left 를 계산해 D-7 알림 판정에 쓸 수 있게 한다.
        if rep is not None:
            expires = base_expiry(rep, folder_name)
            return FolderDecision("keep", expires, days_left(expires, now), rep)
        return FolderDecision("keep", None, None, None)
    return FolderDecision("delete", None, None, primary_record(records) if records else None)


# ── load_retention_index ───────────────────────────────────────────────
def load_retention_index(db: Session, user_connection_dir: str, *, now) -> dict:
    """보호(pinned/retain_until) 또는 D-7 창(기본 만료 7일 이내)에 든 기록만 폴더명으로 묶는다.

    무관한 오래된 기록까지 읽지 않도록 3-way OR 로 한 번에 조회한다. `created_at BETWEEN
    now−31일 AND now−22일` 은 폴더 생성이 record.created_at 과 초 단위 차이라 근사로 충분하고,
    폴더명이 있으면 decide_folder 가 정확한 시각으로 재판정한다.
    """
    from_dt = now - timedelta(days=RETENTION_DAYS + 1)
    to_dt = now - timedelta(days=RETENTION_DAYS - EXPIRING_SOON_DAYS - 1)
    q = db.query(models.Analysis).filter(
        or_(
            models.Analysis.pinned.is_(True),
            models.Analysis.retain_until.isnot(None),
            models.Analysis.created_at.between(from_dt, to_dt),
        )
    )
    index: dict[str, list[models.Analysis]] = {}
    for record in q.all():
        folder = work_folder_of(record, user_connection_dir)
        if folder is None:
            continue
        index.setdefault(folder, []).append(record)
    return index
