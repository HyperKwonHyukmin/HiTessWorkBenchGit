"""run_cleanup 이 pinned / retain_until / 폴더 나이 순서로 판정하는지 검증한다.

- _USER_CONN_DIR 를 tmp_path 로 monkeypatch 해 실제 폴더를 만들고 지운다.
- database.SessionLocal 을 conftest 의 인메모리 세션으로 바꿔 retention_service 가
  같은 세션을 보게 한다.
- 만료 임박은 알림으로 알리지 않는다(사용자 결정 2026-09-22). run_cleanup 은 알림을
  만들지 않으며, 남은 일수는 My Projects 화면에서만 보여 준다.
"""
from datetime import datetime, timedelta
from pathlib import Path

from app import database, models
from app.services import cleanup_service


def _make_folder(root: Path, folder: str) -> Path:
    p = root / folder
    p.mkdir()
    (p / "marker.txt").write_text("x", encoding="utf-8")
    return p


def _seed(db, employee_id, folder_name, program, work_root, **overrides):
    """work_folder_of 가 잡을 수 있는 input_info 경로를 넣어 준다."""
    bdf_path = str(Path(work_root) / folder_name / "input.bdf")
    rec = models.Analysis(
        employee_id=employee_id, program_name=program,
        project_name="proj", status="Success",
        input_info={"bdf_file": bdf_path},
        created_at=overrides.get("created_at", datetime.now() - timedelta(days=25)),
        retain_until=overrides.get("retain_until"),
        pinned=overrides.get("pinned", False),
    )
    db.add(rec)
    db.commit()
    return rec


def test_pinned_folder_is_skipped_even_when_60_days_old(
    tmp_path, db_session, monkeypatch
):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))

    # 폴더는 60일 전 이름을 갖는다.
    stamp = (datetime.now() - timedelta(days=60)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_TrussAssessment"
    _make_folder(tmp_path, folder)
    _seed(db_session, "EMP001", folder, "Truss Assessment", tmp_path,
          created_at=datetime.now() - timedelta(days=60), pinned=True)

    result = cleanup_service.run_cleanup()

    assert result["deleted"] == []
    assert result["pinned"] == 1
    assert (tmp_path / folder).is_dir()


def test_retain_until_in_future_is_kept(tmp_path, db_session, monkeypatch):
    """extended 로 분류돼 실제 폴더는 보존된다."""
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))

    stamp = (datetime.now() - timedelta(days=45)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_TrussAssessment"
    _make_folder(tmp_path, folder)
    _seed(db_session, "EMP001", folder, "Truss Assessment", tmp_path,
          created_at=datetime.now() - timedelta(days=45),
          retain_until=datetime.now() + timedelta(days=30))

    result = cleanup_service.run_cleanup()
    assert result["deleted"] == []
    assert result["extended"] == 1
    assert (tmp_path / folder).is_dir()


def test_retain_until_in_past_is_deleted(tmp_path, db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))

    stamp = (datetime.now() - timedelta(days=45)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_TrussAssessment"
    _make_folder(tmp_path, folder)
    _seed(db_session, "EMP001", folder, "Truss Assessment", tmp_path,
          created_at=datetime.now() - timedelta(days=45),
          retain_until=datetime.now() - timedelta(days=1))

    result = cleanup_service.run_cleanup()
    assert [d["folder"] for d in result["deleted"]] == [folder]
    assert not (tmp_path / folder).exists()


def test_ordinary_folder_over_30_days_is_deleted(tmp_path, db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))

    stamp = (datetime.now() - timedelta(days=40)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_TrussAssessment"
    _make_folder(tmp_path, folder)
    # 기록을 심지 않아도 (인덱스에 안 나와도) 폴더 나이가 30일을 넘으면 삭제된다.

    result = cleanup_service.run_cleanup()
    assert [d["folder"] for d in result["deleted"]] == [folder]
    assert not (tmp_path / folder).exists()


def test_folder_age_uses_folder_timestamp_over_stat(tmp_path, db_session, monkeypatch):
    """폴더명이 60일 전이지만 폴더 stat 은 방금 만든 것 — 새 파서는 폴더명을 우선한다."""
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))

    stamp = (datetime.now() - timedelta(days=60)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_TrussAssessment"
    _make_folder(tmp_path, folder)

    result = cleanup_service.run_cleanup()
    assert [d["folder"] for d in result["deleted"]] == [folder]


def test_dry_run_does_not_delete(tmp_path, db_session, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))

    stamp = (datetime.now() - timedelta(days=40)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_TrussAssessment"
    _make_folder(tmp_path, folder)

    result = cleanup_service.run_cleanup(dry_run=True)
    assert [d["folder"] for d in result["deleted"]] == [folder]
    assert (tmp_path / folder).is_dir()


def test_db_failure_deletes_nothing(tmp_path, monkeypatch):
    """D6: 보호 인덱스를 못 읽으면 그 회차는 아무 폴더도 지우지 않는다.

    핀 데이터 삭제는 비가역이라 하루 건너뛰는 편이 안전하다.
    """
    monkeypatch.setattr(cleanup_service, "_USER_CONN_DIR", str(tmp_path))

    def _boom():
        raise RuntimeError("mysql-down")
    monkeypatch.setattr(database, "SessionLocal", _boom)

    stamp = (datetime.now() - timedelta(days=60)).strftime("%Y%m%d_%H%M%S")
    folder = f"{stamp}_EMP001_TrussAssessment"
    _make_folder(tmp_path, folder)

    result = cleanup_service.run_cleanup()
    assert result["deleted"] == []
    assert result["errors"] == [{"error": "retention_index_unavailable"}]
    assert (tmp_path / folder).is_dir()
