"""retention_service — 폴더명 파싱·만료 계산·연장 상한·decide_folder·load_retention_index."""
from datetime import datetime, timedelta

import pytest

from app import models
from app.services import retention_service as rs
from app.services.retention_service import (
    EXPIRING_SOON_DAYS,
    EXTEND_CHOICES,
    EXTENSION_MAX_DAYS,
    RETENTION_DAYS,
    RetentionLimitError,
    apply_retention_change,
    base_expiry,
    classify,
    days_left,
    decide_folder,
    effective_expiry,
    extension_used_days,
    folder_created_at,
    load_retention_index,
    primary_record,
    retention_state,
    work_folder_of,
)


# ── 상수 ────────────────────────────────────────────────────────────────────

def test_constants_match_spec():
    """마스터 §2.3 확정값 — 다른 plan 이 이 상수를 읽는다."""
    assert RETENTION_DAYS == 30
    assert EXTENSION_MAX_DAYS == 180
    assert EXPIRING_SOON_DAYS == 7
    assert EXTEND_CHOICES == (30, 90)


# ── 폴더명 → 생성 시각 ─────────────────────────────────────────────────────

def test_folder_created_at_parses_workspace_pattern():
    """`YYYYMMDD_HHMMSS_<eid>_<prog>` — workspace.py 가 만드는 표준 이름."""
    got = folder_created_at("20260918_085221_A476854_SidePassage")
    assert got == datetime(2026, 9, 18, 8, 52, 21)


def test_folder_created_at_parses_underscore_variants():
    """이름에 언더스코어가 여러 개여도 앞 15자만 본다."""
    got = folder_created_at("20260918_085221_A476854_HiTess_Model_Builder_something")
    assert got == datetime(2026, 9, 18, 8, 52, 21)


def test_folder_created_at_returns_none_for_non_matching():
    assert folder_created_at("random_folder") is None
    assert folder_created_at("20260918-085221_EMP") is None  # 하이픈
    assert folder_created_at("20261332_085221_EMP_SidePassage") is None  # 13월


# ── 기록 → work_folder ─────────────────────────────────────────────────────

def _record(program="Truss Assessment", employee="EMP001",
            input_info=None, result_info=None, retain_until=None, pinned=False,
            created_at=datetime(2026, 8, 20, 9, 0, 0), rid=1):
    a = models.Analysis(
        id=rid, program_name=program, employee_id=employee,
        project_name="proj", status="Success",
        input_info=input_info or {}, result_info=result_info or {},
        created_at=created_at, retain_until=retain_until, pinned=pinned,
    )
    return a


def test_work_folder_of_prefers_input_info_first_path():
    base = r"C:\Coding\WorkBench\HiTessWorkBenchBackEnd\userConnection"
    rec = _record(input_info={
        "bdf_file": rf"{base}\20260820_090000_EMP001_TrussAssessment\model.bdf",
    })
    assert work_folder_of(rec, base) == "20260820_090000_EMP001_TrussAssessment"


def test_work_folder_of_falls_back_to_result_info():
    base = r"C:\Coding\WorkBench\HiTessWorkBenchBackEnd\userConnection"
    rec = _record(
        input_info={"note": "no path"},
        result_info={"f06": rf"{base}\20260820_090000_EMP001_TrussAssessment\out.f06"},
    )
    assert work_folder_of(rec, base) == "20260820_090000_EMP001_TrussAssessment"


def test_work_folder_of_returns_none_when_no_userconnection_path():
    base = r"C:\Coding\WorkBench\HiTessWorkBenchBackEnd\userConnection"
    rec = _record(input_info={"note": "text"}, result_info={"other": r"C:\other\file.txt"})
    assert work_folder_of(rec, base) is None


# ── 만료 계산 ──────────────────────────────────────────────────────────────

def test_base_expiry_uses_folder_timestamp_when_available():
    rec = _record(created_at=datetime(2026, 8, 20, 10, 0, 0))
    got = base_expiry(rec, "20260818_090000_EMP001_TrussAssessment")
    assert got == datetime(2026, 8, 18, 9, 0, 0) + timedelta(days=RETENTION_DAYS)


def test_base_expiry_falls_back_to_created_at_when_folder_missing():
    rec = _record(created_at=datetime(2026, 8, 20, 10, 0, 0))
    got = base_expiry(rec, None)
    assert got == datetime(2026, 8, 20, 10, 0, 0) + timedelta(days=RETENTION_DAYS)


def test_effective_expiry_priority_pinned_over_retain_until():
    """D1: pinned > retain_until > base."""
    later = datetime(2026, 12, 25, 0, 0, 0)
    rec = _record(pinned=True, retain_until=later)
    assert effective_expiry(rec, "20260820_090000_EMP001_TA") is None  # 영구


def test_effective_expiry_uses_retain_until_when_set():
    rec = _record(pinned=False, retain_until=datetime(2026, 10, 20, 0, 0, 0))
    assert effective_expiry(rec, "20260820_090000_EMP001_TA") == datetime(2026, 10, 20, 0, 0, 0)


def test_effective_expiry_falls_through_to_base():
    # 폴더명 타임스탬프가 base 의 기준이므로 created_at 과 같은 시각(00:00:00)으로 둔다.
    rec = _record(pinned=False, retain_until=None,
                  created_at=datetime(2026, 8, 20, 0, 0, 0))
    assert effective_expiry(rec, "20260820_000000_EMP001_TA") == datetime(2026, 9, 19, 0, 0, 0)


def test_extension_used_days_measures_from_base():
    rec = _record(
        retain_until=datetime(2026, 8, 20, 0, 0, 0) + timedelta(days=RETENTION_DAYS + 45),
        created_at=datetime(2026, 8, 20, 0, 0, 0),
    )
    assert extension_used_days(rec, "20260820_000000_EMP001_TA") == 45


def test_extension_used_days_zero_when_no_retain_until():
    rec = _record(retain_until=None)
    assert extension_used_days(rec, "20260820_090000_EMP001_TA") == 0


def test_days_left_returns_none_for_none_expiry():
    assert days_left(None, datetime(2026, 9, 18)) is None


def test_days_left_rounds_up():
    now = datetime(2026, 9, 18, 12, 0, 0)
    # 만료가 3.5일 남으면 4일로 표시 — UI 는 남은 "일"을 하루 단위로 보여줘야 오해가 없다.
    assert days_left(now + timedelta(days=3, hours=12), now) == 4
    assert days_left(now, now) == 0
    assert days_left(now - timedelta(days=1), now) == -1


# ── classify ──────────────────────────────────────────────────────────────

def test_classify_expired_takes_precedence_over_pinned():
    """파일이 이미 없으면 무엇이든 expired — 되돌릴 수 없는 상태."""
    rec = _record(pinned=True)
    got = classify(rec, "20260820_090000_EMP001_TA",
                   files_available=False, now=datetime(2026, 9, 18))
    assert got == "expired"


def test_classify_pinned_shows_pinned_when_files_present():
    rec = _record(pinned=True)
    got = classify(rec, "20260820_090000_EMP001_TA",
                   files_available=True, now=datetime(2026, 9, 18))
    assert got == "pinned"


def test_classify_expiring_within_seven_days():
    now = datetime(2026, 9, 18)
    rec = _record(created_at=now - timedelta(days=25))  # 만료 5일 남음
    got = classify(rec, "20260824_090000_EMP001_TA", files_available=True, now=now)
    assert got == "expiring"


def test_classify_available_when_far_from_expiry():
    now = datetime(2026, 9, 18)
    rec = _record(created_at=now - timedelta(days=10))
    got = classify(rec, "20260908_090000_EMP001_TA", files_available=True, now=now)
    assert got == "available"


# ── retention_state (직렬화) ───────────────────────────────────────────────

def test_retention_state_shape_for_available():
    now = datetime(2026, 9, 18)
    rec = _record(created_at=now - timedelta(days=10))
    # base 는 폴더명 타임스탬프에서 나오므로 created_at 과 같은 시각으로 맞춘다.
    state = retention_state(rec, "20260908_000000_EMP001_TA",
                            files_available=True, now=now)
    assert state["status"] == "available"
    assert state["pinned"] is False
    assert state["retain_until"] is None
    assert state["base_expires_at"] == (now - timedelta(days=10) + timedelta(days=30)).isoformat()
    assert state["expires_at"] == state["base_expires_at"]
    assert state["days_left"] == 20
    assert state["extension_used_days"] == 0
    assert state["extension_remaining_days"] == EXTENSION_MAX_DAYS


def test_retention_state_shape_for_pinned():
    now = datetime(2026, 9, 18)
    rec = _record(created_at=now - timedelta(days=10), pinned=True)
    state = retention_state(rec, "20260908_090000_EMP001_TA",
                            files_available=True, now=now)
    assert state["status"] == "pinned"
    assert state["pinned"] is True
    assert state["expires_at"] is None
    assert state["days_left"] is None


# ── apply_retention_change ─────────────────────────────────────────────────

def test_apply_retention_change_extends_from_current_expiry():
    now = datetime(2026, 9, 18)
    rec = _record(created_at=datetime(2026, 8, 20))  # 기본 만료 2026-09-19
    apply_retention_change(rec, "20260820_000000_EMP001_TA",
                           extend_days=30, pinned=None, now=now)
    assert rec.retain_until == datetime(2026, 9, 19) + timedelta(days=30)


def test_apply_retention_change_from_expired_uses_now_as_base():
    """이미 만료된 시각을 기준으로 잡으면 '지금부터 30일' 이 아니라 '과거+30일'이 돼 즉시 재만료된다."""
    now = datetime(2026, 10, 15)  # 기본 만료(2026-09-19) 이후
    rec = _record(created_at=datetime(2026, 8, 20))
    apply_retention_change(rec, "20260820_000000_EMP001_TA",
                           extend_days=30, pinned=None, now=now)
    assert rec.retain_until == now + timedelta(days=30)


def test_apply_retention_change_raises_when_cumulative_exceeds_180():
    now = datetime(2026, 9, 18)
    rec = _record(created_at=datetime(2026, 8, 20),
                  retain_until=datetime(2026, 9, 19) + timedelta(days=160))
    with pytest.raises(RetentionLimitError):
        apply_retention_change(rec, "20260820_000000_EMP001_TA",
                               extend_days=30, pinned=None, now=now)


def test_apply_retention_change_at_exactly_180_is_ok():
    now = datetime(2026, 9, 18)
    rec = _record(created_at=datetime(2026, 8, 20),
                  retain_until=datetime(2026, 9, 19) + timedelta(days=150))
    apply_retention_change(rec, "20260820_000000_EMP001_TA",
                           extend_days=30, pinned=None, now=now)
    assert extension_used_days(rec, "20260820_000000_EMP001_TA") == 180


def test_apply_retention_change_toggles_pinned_only_when_bool():
    now = datetime(2026, 9, 18)
    rec = _record()
    apply_retention_change(rec, "20260820_000000_EMP001_TA",
                           extend_days=None, pinned=True, now=now)
    assert rec.pinned is True
    apply_retention_change(rec, "20260820_000000_EMP001_TA",
                           extend_days=None, pinned=None, now=now)
    assert rec.pinned is True   # None 은 유지
    apply_retention_change(rec, "20260820_000000_EMP001_TA",
                           extend_days=None, pinned=False, now=now)
    assert rec.pinned is False


# ── primary_record / decide_folder (D5·D7) ────────────────────────────────

def test_primary_record_prefers_non_internal_substep():
    """SidePassage/GroupModuleUnit 하나의 폴더에 부모+하위단계가 섞일 수 있다."""
    parent = _record(program="SidePassage", rid=100)
    substep = _record(program="ModuleStability", rid=101)
    # 하위 단계가 id 가 더 커도 부모가 대표.
    assert primary_record([substep, parent]).id == 100


def test_primary_record_falls_back_to_min_id_when_all_internal():
    substep_a = _record(program="ModuleStability", rid=50)
    substep_b = _record(program="ModuleHoistOptimize", rid=51)
    assert primary_record([substep_b, substep_a]).id == 50


def test_decide_folder_keep_pinned():
    rec = _record(pinned=True)
    d = decide_folder("20260820_090000_EMP001_TA", [rec],
                      folder_age_days=100.0, now=datetime(2026, 12, 1))
    assert d.action == "keep_pinned"
    assert d.expires_at is None
    assert d.record is rec


def test_decide_folder_keep_extended_when_retain_until_in_future():
    rec = _record(retain_until=datetime(2027, 1, 1))
    d = decide_folder("20260820_090000_EMP001_TA", [rec],
                      folder_age_days=60.0, now=datetime(2026, 12, 1))
    assert d.action == "keep_extended"
    assert d.expires_at == datetime(2027, 1, 1)


def test_decide_folder_delete_when_retain_until_in_past():
    rec = _record(retain_until=datetime(2026, 11, 20))
    d = decide_folder("20260820_090000_EMP001_TA", [rec],
                      folder_age_days=100.0, now=datetime(2026, 12, 1))
    assert d.action == "delete"


def test_decide_folder_delete_when_no_records_and_age_over_30():
    d = decide_folder("20260820_090000_EMP001_TA", [],
                      folder_age_days=45.0, now=datetime(2026, 10, 5))
    assert d.action == "delete"


def test_decide_folder_keep_when_no_records_and_age_under_30():
    d = decide_folder("20260820_090000_EMP001_TA", [],
                      folder_age_days=10.0, now=datetime(2026, 8, 30))
    assert d.action == "keep"


def test_decide_folder_uses_max_retain_until_across_records():
    """D5: 한 폴더에 여러 기록이면 만료는 그 최대치."""
    parent = _record(rid=100, retain_until=datetime(2026, 10, 1))
    child = _record(rid=101, retain_until=datetime(2026, 11, 1), program="ModuleStability")
    d = decide_folder("20260820_090000_EMP001_TA", [parent, child],
                      folder_age_days=45.0, now=datetime(2026, 10, 15))
    assert d.action == "keep_extended"
    assert d.expires_at == datetime(2026, 11, 1)
    # 대표는 부모(하위 단계가 아닌 기록)
    assert d.record is parent


# ── load_retention_index ───────────────────────────────────────────────────

def test_load_retention_index_groups_by_work_folder(db_session, make_analysis):
    now = datetime(2026, 9, 18)
    base = r"C:\test\userConnection"
    a = make_analysis("EMP001", "SidePassage", now - timedelta(days=25))
    a.input_info = {"bdf": rf"{base}\20260824_090000_EMP001_SidePassage\struData.bdf"}
    a.pinned = False
    b = make_analysis("EMP001", "ModuleStability", now - timedelta(days=25))
    b.input_info = {"bdf": rf"{base}\20260824_090000_EMP001_SidePassage\struData.bdf"}
    # 무관 폴더(핀 or retain_until 도 없고 D-7 창도 아님) — 인덱스에 안 나온다.
    make_analysis("EMP001", "Truss Assessment", now - timedelta(days=1))
    db_session.commit()

    idx = load_retention_index(db_session, base, now=now)
    assert set(idx) == {"20260824_090000_EMP001_SidePassage"}
    assert {r.id for r in idx["20260824_090000_EMP001_SidePassage"]} == {a.id, b.id}
