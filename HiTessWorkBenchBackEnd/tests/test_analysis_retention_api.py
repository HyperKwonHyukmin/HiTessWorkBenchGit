"""보관 연장·핀 API + 직렬화 확장 (Plan B Task 4).

- POST /api/analysis/{id}/retention: 소유자 200, 타인 403, 관리자 200, 404, 422/400, 409.
- _serialize_analysis: retention 블록이 붙는가.
- GET /api/analysis/history/{eid}: file_status 어휘(expiring, pinned) + summary(expiringSoon, pinnedFiles).

판정 로직 자체는 tests/test_retention_service.py 가 검증한다. 여기서는 HTTP 계약만 본다.
"""
from datetime import datetime, timedelta

import pytest

from app import models


def _analysis(db, employee_id="EMP001", program="Truss Assessment",
              folder="20260820_090000_EMP001_TrussAssessment",
              base_dir=None, created_at=None, retain_until=None, pinned=False):
    """Analysis 행 하나. input_info 의 경로가 base_dir/<folder> 아래를 가리킨다."""
    base_dir = base_dir or r"C:\Coding\WorkBench\HiTessWorkBenchBackEnd\userConnection"
    rec = models.Analysis(
        job_id=None,
        employee_id=employee_id, program_name=program,
        project_name="proj", status="Success",
        input_info={"bdf_file": rf"{base_dir}\{folder}\input.bdf"},
        result_info={},
        created_at=created_at or datetime(2026, 8, 20, 9, 0, 0),
        retain_until=retain_until, pinned=pinned,
    )
    db.add(rec)
    db.commit()
    return rec


@pytest.fixture()
def work_root(tmp_path, monkeypatch):
    """userConnection 기준 폴더를 tmp_path 로 갈아끼우고, 폴더를 만드는 헬퍼를 준다.

    `_files_available` 는 모듈 전역 `_ALLOWED_DOWNLOAD_BASE` 로 경로를 검사하므로 둘 다 바꾼다.
    """
    from app.routers import analysis as ar

    monkeypatch.setattr(ar, "_USER_CONNECTION_DIR", str(tmp_path))
    monkeypatch.setattr(ar, "_ALLOWED_DOWNLOAD_BASE", str(tmp_path))

    def _make_folder(folder: str) -> str:
        (tmp_path / folder).mkdir(parents=True, exist_ok=True)
        (tmp_path / folder / "input.bdf").write_text("$", encoding="utf-8")
        return folder

    _make_folder.base_dir = str(tmp_path)
    return _make_folder


def _folder_name(created: datetime, employee_id="ADMIN001", suffix="TrussAssessment") -> str:
    return f"{created.strftime('%Y%m%d_%H%M%S')}_{employee_id}_{suffix}"


# ── _serialize_analysis retention 블록 ─────────────────────────────────

def test_get_analysis_by_id_returns_retention_block(admin_client, db_session):
    rec = _analysis(db_session, employee_id="ADMIN001")
    res = admin_client.get(f"/api/analysis/{rec.id}")
    assert res.status_code == 200
    body = res.json()
    r = body["retention"]
    assert r["status"] in ("available", "expiring", "expired")
    assert r["pinned"] is False
    assert r["retain_until"] is None
    assert r["extension_used_days"] == 0
    assert r["extension_remaining_days"] == 180
    assert "base_expires_at" in r and "expires_at" in r


def test_retention_status_pinned_when_flag_true(admin_client, db_session, work_root):
    """pinned 는 파일이 실제로 남아 있을 때만 'pinned' 로 보고된다(classify 는 fail-closed)."""
    folder = work_root(_folder_name(datetime.now() - timedelta(days=1)))
    rec = _analysis(db_session, employee_id="ADMIN001", folder=folder,
                    base_dir=work_root.base_dir, pinned=True)
    body = admin_client.get(f"/api/analysis/{rec.id}").json()
    assert body["retention"]["status"] == "pinned"
    assert body["retention"]["expires_at"] is None
    assert body["retention"]["days_left"] is None


def test_retention_status_expired_when_files_gone(admin_client, db_session):
    """핀이 걸려 있어도 파일이 없으면 expired — 존재하지 않는 폴더."""
    rec = _analysis(db_session, employee_id="ADMIN001", pinned=True)
    body = admin_client.get(f"/api/analysis/{rec.id}").json()
    assert body["retention"]["status"] == "expired"


# ── POST /analysis/{id}/retention — 권한 ────────────────────────────────

def test_extend_requires_ownership_or_admin(switchable_client, db_session, work_root):
    """EMP001 이 만든 기록은 EMP001·관리자만 만질 수 있다."""
    folder = work_root(_folder_name(datetime.now() - timedelta(days=1), "EMP001"))
    rec = _analysis(db_session, employee_id="EMP001", folder=folder,
                    base_dir=work_root.base_dir)

    switchable_client.as_user()   # EMP001
    r = switchable_client.post(f"/api/analysis/{rec.id}/retention",
                               json={"extend_days": 30})
    assert r.status_code == 200

    # 관리자도 통과
    switchable_client.as_admin()
    r = switchable_client.post(f"/api/analysis/{rec.id}/retention",
                               json={"extend_days": 30})
    assert r.status_code == 200


def test_extend_rejects_other_user(switchable_client, db_session, make_user):
    """다른 사용자는 403 — spec §2 D3."""
    other = _analysis(db_session, employee_id="OTHER01")
    make_user("OTHER01")

    switchable_client.as_user()   # EMP001
    r = switchable_client.post(f"/api/analysis/{other.id}/retention",
                               json={"extend_days": 30})
    assert r.status_code == 403


def test_extend_returns_404_when_missing(admin_client):
    r = admin_client.post("/api/analysis/999999/retention", json={"extend_days": 30})
    assert r.status_code == 404


# ── POST /analysis/{id}/retention — 검증 ───────────────────────────────

def test_extend_rejects_empty_body(admin_client, db_session):
    rec = _analysis(db_session, employee_id="ADMIN001")
    r = admin_client.post(f"/api/analysis/{rec.id}/retention",
                          json={"extend_days": None, "pinned": None})
    assert r.status_code == 400
    assert "변경" in r.json()["detail"] or "extend" in r.json()["detail"].lower()


def test_extend_rejects_out_of_range(admin_client, db_session):
    rec = _analysis(db_session, employee_id="ADMIN001")
    assert admin_client.post(f"/api/analysis/{rec.id}/retention",
                             json={"extend_days": 0}).status_code == 422
    assert admin_client.post(f"/api/analysis/{rec.id}/retention",
                             json={"extend_days": 181}).status_code == 422
    assert admin_client.post(f"/api/analysis/{rec.id}/retention",
                             json={"extend_days": "30"}).status_code == 422


def test_extend_rejects_unknown_field(admin_client, db_session):
    rec = _analysis(db_session, employee_id="ADMIN001")
    r = admin_client.post(f"/api/analysis/{rec.id}/retention",
                          json={"extend_days": 30, "forever": True})
    assert r.status_code == 422


def test_extend_rejects_cumulative_over_180(admin_client, db_session, work_root):
    """spec §2 D2: 이미 150일 연장된 기록에 60일 더 하면 상한 초과 → 400."""
    created = datetime.now() - timedelta(days=200)
    folder = work_root(_folder_name(created))
    base_expiry = created.replace(microsecond=0) + timedelta(days=30)
    rec = _analysis(
        db_session, employee_id="ADMIN001", folder=folder,
        base_dir=work_root.base_dir, created_at=created,
        retain_until=base_expiry + timedelta(days=150),
    )
    r = admin_client.post(f"/api/analysis/{rec.id}/retention",
                          json={"extend_days": 60})
    assert r.status_code == 400
    assert "180" in r.json()["detail"]
    # 거부된 요청은 기록을 바꾸지 않는다.
    db_session.refresh(rec)
    assert rec.retain_until == base_expiry + timedelta(days=150)


def test_extend_rejects_when_files_already_expired(admin_client, db_session):
    """spec §2 D4: 보호할 파일이 없으면 409 — 폴더 이름은 있지만 실제 폴더는 없다."""
    rec = _analysis(
        db_session, employee_id="ADMIN001",
        folder="20260101_090000_ADMIN001_TrussAssessment",
        created_at=datetime(2026, 1, 1, 9, 0, 0),
    )
    r = admin_client.post(f"/api/analysis/{rec.id}/retention",
                          json={"extend_days": 30})
    assert r.status_code == 409


# ── POST /analysis/{id}/retention — 정상 ───────────────────────────────

def test_extend_sets_retain_until_and_returns_record(admin_client, db_session, work_root):
    """실제 폴더가 있어야 D4 검사를 통과한다 — tmp_path 를 userConnection 으로 쓴다."""
    created = datetime.now() - timedelta(days=1)
    folder = work_root(_folder_name(created))
    rec = _analysis(db_session, employee_id="ADMIN001", folder=folder,
                    base_dir=work_root.base_dir, created_at=created)

    r = admin_client.post(f"/api/analysis/{rec.id}/retention",
                          json={"extend_days": 30})
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == rec.id
    assert body["retention"]["status"] in ("available", "expiring", "pinned")
    assert body["retention"]["extension_used_days"] == 30
    assert body["retention"]["extension_remaining_days"] == 150
    assert body["retain_until"] is not None
    db_session.refresh(rec)
    assert rec.retain_until is not None


def test_extend_accumulates(admin_client, db_session, work_root):
    """두 번 연장하면 누적된다 — 30 + 30 = 60."""
    created = datetime.now() - timedelta(days=1)
    folder = work_root(_folder_name(created))
    rec = _analysis(db_session, employee_id="ADMIN001", folder=folder,
                    base_dir=work_root.base_dir, created_at=created)

    admin_client.post(f"/api/analysis/{rec.id}/retention", json={"extend_days": 30})
    body = admin_client.post(f"/api/analysis/{rec.id}/retention",
                             json={"extend_days": 30}).json()
    assert body["retention"]["extension_used_days"] == 60


def test_pin_toggles_flag(admin_client, db_session, work_root):
    folder = work_root(_folder_name(datetime.now() - timedelta(days=1)))
    rec = _analysis(db_session, employee_id="ADMIN001", folder=folder,
                    base_dir=work_root.base_dir)

    r = admin_client.post(f"/api/analysis/{rec.id}/retention",
                          json={"pinned": True})
    assert r.status_code == 200 and r.json()["pinned"] is True
    assert r.json()["retention"]["status"] == "pinned"

    r2 = admin_client.post(f"/api/analysis/{rec.id}/retention",
                           json={"pinned": False})
    assert r2.status_code == 200 and r2.json()["pinned"] is False


# ── history — file_status 필터 확장 ────────────────────────────────────

def test_history_file_status_expiring_filters_only_expiring(
    admin_client, db_session, work_root
):
    # 5일 남은(만료 임박) 기록
    created = datetime.now() - timedelta(days=25)
    folder = work_root(_folder_name(created, suffix="TrussAssessmentA"))
    a = _analysis(db_session, employee_id="ADMIN001", folder=folder,
                  base_dir=work_root.base_dir, created_at=created)
    # 여유 있는(20일 남은) 기록
    created2 = datetime.now() - timedelta(days=10)
    folder2 = work_root(_folder_name(created2, suffix="TrussAssessmentB"))
    _analysis(db_session, employee_id="ADMIN001", folder=folder2,
              base_dir=work_root.base_dir, created_at=created2)

    r = admin_client.get("/api/analysis/history/ADMIN001",
                         params={"file_status": "expiring"})
    ids = {item["id"] for item in r.json()["items"]}
    assert ids == {a.id}


def test_history_file_status_available_keeps_legacy_meaning(
    admin_client, db_session, work_root
):
    """'available' 은 예전처럼 '파일이 남아 있는 모든 기록'(핀·임박 포함)이다."""
    created = datetime.now() - timedelta(days=25)
    expiring = _analysis(db_session, employee_id="ADMIN001",
                         folder=work_root(_folder_name(created, suffix="A")),
                         base_dir=work_root.base_dir, created_at=created)
    created2 = datetime.now() - timedelta(days=1)
    pinned = _analysis(db_session, employee_id="ADMIN001",
                       folder=work_root(_folder_name(created2, suffix="B")),
                       base_dir=work_root.base_dir, created_at=created2, pinned=True)
    gone = _analysis(db_session, employee_id="ADMIN001",
                     folder="20260101_090000_ADMIN001_Missing",
                     base_dir=work_root.base_dir,
                     created_at=datetime(2026, 1, 1, 9, 0, 0))

    body = admin_client.get("/api/analysis/history/ADMIN001",
                            params={"file_status": "available"}).json()
    ids = {item["id"] for item in body["items"]}
    assert ids == {expiring.id, pinned.id}

    body = admin_client.get("/api/analysis/history/ADMIN001",
                            params={"file_status": "expired"}).json()
    assert {item["id"] for item in body["items"]} == {gone.id}


def test_history_file_status_pinned_filters_only_pinned(
    admin_client, db_session, work_root
):
    folder = work_root("20260820_090000_ADMIN001_TrussAssessment")
    pinned_rec = _analysis(db_session, employee_id="ADMIN001", folder=folder,
                           base_dir=work_root.base_dir, pinned=True)
    folder2 = work_root("20260821_090000_ADMIN001_TrussAssessment")
    _analysis(db_session, employee_id="ADMIN001", folder=folder2,
              base_dir=work_root.base_dir)

    r = admin_client.get("/api/analysis/history/ADMIN001",
                         params={"file_status": "pinned"})
    ids = {item["id"] for item in r.json()["items"]}
    assert ids == {pinned_rec.id}


def test_history_summary_includes_expiring_and_pinned_counts(
    admin_client, db_session, work_root
):
    # 임박 1, 핀 1, 여유 1
    for label, created, pinned in [
        ("expiring", datetime.now() - timedelta(days=25), False),
        ("pinned", datetime.now() - timedelta(days=1), True),
        ("available", datetime.now() - timedelta(days=1), False),
    ]:
        folder = work_root(_folder_name(created, suffix=f"TrussAssessment{label}"))
        _analysis(db_session, employee_id="ADMIN001", folder=folder,
                  base_dir=work_root.base_dir, created_at=created, pinned=pinned)

    body = admin_client.get("/api/analysis/history/ADMIN001",
                            params={"include_summary": True}).json()
    summary = body["summary"]
    assert summary["expiringSoon"] == 1
    assert summary["pinnedFiles"] == 1
    # 기존 키는 유지
    assert "expiredFiles" in summary and "availableFiles" in summary
    assert summary["expiredFiles"] == 0
    assert summary["availableFiles"] == 3
