"""user_directory_sync 서비스와 /api/users/sync-plm-all 라우터 테스트.

핵심 안전장치가 세 가지라 각각 명시 확인:
- PLM 조회 실패자는 '유지'로 끝난다(기존 값 그대로)
- PLM 에서 특정 필드만 비어 있으면 그 필드만 유지
- MUTABLE_FIELDS 밖(is_active 등)은 어떤 경로로도 바뀌지 않는다
"""
from __future__ import annotations

import pytest

from app import models
from app.services import plm_user_directory
from app.services.user_directory_sync import (
    apply_plm_profile, sync_users,
)


def _profile(**kwargs) -> dict:
    base = {"email": None, "name": None, "company": None, "department": None, "position": None}
    base.update(kwargs)
    return base


# --- apply_plm_profile 단위 ----------------------------------------------------


def test_apply_plm_profile_updates_only_present_fields():
    user = models.User(
        employee_id="A1", name="옛이름", company="HHI", department="옛부서", position="연구원",
        email=None,
    )
    changes = apply_plm_profile(user, _profile(email="new@hhi.co.kr", name="새이름"))
    assert set(changes.keys()) == {"email", "name"}
    assert changes["email"] == (None, "new@hhi.co.kr")
    assert changes["name"] == ("옛이름", "새이름")
    assert user.company == "HHI"   # 변경 없음
    assert user.department == "옛부서"


def test_apply_plm_profile_keeps_existing_when_profile_field_is_blank():
    user = models.User(
        employee_id="A1", name="원래", company="HHI", department="원래부서", position="연구원",
        email="original@hhi.co.kr",
    )
    # 빈 문자열·None 은 모두 '유지' 처리
    changes = apply_plm_profile(user, _profile(email="", name="   ", company=None))
    assert changes == {}
    assert user.email == "original@hhi.co.kr"
    assert user.name == "원래"


def test_apply_plm_profile_returns_empty_when_profile_is_none():
    user = models.User(employee_id="A1", name="홍", company="HHI")
    assert apply_plm_profile(user, None) == {}
    assert user.name == "홍"


def test_apply_plm_profile_no_change_when_values_match():
    user = models.User(
        employee_id="A1", name="홍", company="HHI", department="구조해석팀", position="연구원",
        email="hong@hhi.co.kr",
    )
    changes = apply_plm_profile(user, _profile(
        email="hong@hhi.co.kr", name="홍", company="HHI",
        department="구조해석팀", position="연구원",
    ))
    assert changes == {}


def test_apply_plm_profile_never_touches_protected_fields():
    """사번·권한·승인 플래그는 어떤 입력에도 바뀌지 않는다(MUTABLE_FIELDS 화이트리스트)."""
    user = models.User(
        employee_id="A1", name="홍", company="HHI",
        is_active=True, is_admin=False, is_developer=False, email=None,
    )
    # 악의적/실수 입력이 들어와도 무시된다 — apply 가 보는 건 _PROFILE_COLUMNS 뿐.
    apply_plm_profile(user, {"is_active": False, "is_admin": True, "employee_id": "HACKED"})
    assert user.employee_id == "A1"
    assert user.is_active is True
    assert user.is_admin is False
    assert user.is_developer is False


# --- sync_users 집계 로직 ------------------------------------------------------


def _seed_users(db_session):
    users = [
        models.User(employee_id="A10001", name="갑", company="HHI", department="A팀", position="연구원",
                    is_active=True, is_admin=False, is_developer=False, email=None),
        models.User(employee_id="A10002", name="을", company="HHI", department="B팀", position="책임",
                    is_active=True, is_admin=False, is_developer=False, email="eul@hhi.co.kr"),
        models.User(employee_id="A10003", name="병", company="HHI", department="C팀", position="연구원",
                    is_active=True, is_admin=False, is_developer=False, email=None),
    ]
    db_session.add_all(users)
    db_session.commit()
    return users


def test_sync_users_mix_update_unchanged_missing(db_session):
    _seed_users(db_session)

    def _fetcher(eid):
        if eid == "A10001":   # 신규 반영
            return _profile(email="gap@hhi.co.kr", name="갑")
        if eid == "A10002":   # 값 동일 → unchanged
            return _profile(email="eul@hhi.co.kr", name="을", company="HHI",
                            department="B팀", position="책임")
        return None          # A10003 은 미등록 → '유지'

    plm_user_directory.set_fetcher(_fetcher)
    try:
        summary = sync_users(db_session)
        assert summary.total == 3
        assert summary.updated == 1
        assert summary.unchanged == 1
        assert summary.missing == 1
        assert summary.errors == 0
        # 반영 결과 검증
        a1001 = db_session.query(models.User).filter_by(employee_id="A10001").one()
        a1003 = db_session.query(models.User).filter_by(employee_id="A10003").one()
        assert a1001.email == "gap@hhi.co.kr"
        assert a1003.email is None  # 유지
    finally:
        plm_user_directory.set_fetcher(None)


def test_sync_users_dry_run_does_not_commit(db_session):
    _seed_users(db_session)

    plm_user_directory.set_fetcher(lambda eid: _profile(email=f"{eid.lower()}@hhi.co.kr"))
    try:
        summary = sync_users(db_session, dry_run=True)
        assert summary.updated == 3   # 3명 모두 메일 신규 반영 대상
        # 하지만 커밋 안 됨 → 실제 DB 상태 변경 없음
        for user in db_session.query(models.User).all():
            if user.employee_id == "A10002":
                assert user.email == "eul@hhi.co.kr"  # 원래 값 유지
            else:
                assert user.email is None             # 반영 안 됨
    finally:
        plm_user_directory.set_fetcher(None)


def test_sync_users_scoped_to_employee_id(db_session):
    _seed_users(db_session)
    seen = []

    def _fetcher(eid):
        seen.append(eid)
        return _profile(email=f"{eid.lower()}@hhi.co.kr")

    plm_user_directory.set_fetcher(_fetcher)
    try:
        summary = sync_users(db_session, employee_ids=["A10002"])
        assert summary.total == 1
        assert seen == ["A10002"]
    finally:
        plm_user_directory.set_fetcher(None)


# --- /api/users/sync-plm-all 라우터 통합 ---------------------------------------


def _plm_env(monkeypatch):
    monkeypatch.setenv("PLM_ORACLE_DSN", "HIPLM")
    monkeypatch.setenv("PLM_ORACLE_USER", "caduser")
    monkeypatch.setenv("PLM_ORACLE_PASSWORD", "plmcad")


def test_admin_sync_plm_all_endpoint(admin_client, db_session, monkeypatch):
    _plm_env(monkeypatch)
    _seed_users(db_session)

    def _fetcher(eid):
        if eid == "A10001": return _profile(email="gap@hhi.co.kr", name="갑")
        if eid == "A10002": return _profile(email="eul@hhi.co.kr")  # unchanged
        return None  # A10003 missing + ADMIN001(conftest 시드)

    plm_user_directory.set_fetcher(_fetcher)
    try:
        resp = admin_client.post("/api/users/sync-plm-all")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        # ADMIN001 과 A10003 은 미등록(fetcher None), A10002 는 unchanged, A10001 은 updated
        assert body["updated"] == 1
        assert body["unchanged"] == 1
        assert body["missing"] == 2
        assert body["errors"] == 0
        changed_ids = {c["employeeId"] for c in body["changed"]}
        assert changed_ids == {"A10001"}
    finally:
        plm_user_directory.set_fetcher(None)


def test_admin_sync_plm_all_503_when_plm_not_configured(admin_client, db_session, monkeypatch):
    monkeypatch.delenv("PLM_ORACLE_DSN", raising=False)
    monkeypatch.delenv("PLM_ORACLE_USER", raising=False)
    monkeypatch.delenv("PLM_ORACLE_PASSWORD", raising=False)
    resp = admin_client.post("/api/users/sync-plm-all")
    assert resp.status_code == 503
    assert resp.json()["detail"] == "plm_not_configured"
