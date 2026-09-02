"""HiTESS Beam 배포 exe(레거시 클라이언트) 호출 계약 회귀 테스트.

`ModuleUnitAnalysis.exe`(= MU_Client.py 의 PyInstaller 빌드본)와 HiTESS Beam 의
CSV→BDF 클라이언트는 **Authorization 헤더를 보내지 않는다**. 사용자 PC 에 이미
배포된 실행 파일이라 헤더를 붙이도록 고칠 수 없다.

2026-07-28 인증 도입 커밋(9851097)이 이 창구까지 require_auth 로 닫는 바람에
사내 배포본이 `401 인증이 필요합니다.` 로 즉시 죽었다. 아래 테스트가 그 회귀를
고정한다.

고정하는 계약:
  - 헤더가 없으면 예전처럼 동작한다(익명 허용).
  - 헤더가 있으면 끝까지 검증한다 — 잘못된 토큰 401, 신원이 다른 userID 403,
    남의 작업 폴더 다운로드 403.
  - 익명 요청의 userID 는 작업 폴더 이름에 그대로 들어가므로 경로를 탈출하지 못한다.
"""
import io
import os
import pickle
import subprocess
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app import database, models, sessions
from app.routers import hitessbeam


def _mini_app(db_session):
    """hitessbeam 라우터만 올린 앱 — require_auth 를 덮어쓰지 않아 실제 인증 경로를 탄다."""
    app = FastAPI()
    app.include_router(hitessbeam.router)

    def _override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = _override_db
    return app


@pytest.fixture()
def module_unit_env(tmp_path, monkeypatch):
    """ModuleUnit exe 를 가짜 subprocess 로 대체하고 작업 경로를 tmp 로 옮긴다."""
    backend_dir = tmp_path / "backend"
    executable = backend_dir / "ModuleUnit_HiTESS.exe"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"placeholder")
    user_conn = backend_dir / "userConnection"
    user_conn.mkdir()

    def fake_subprocess_run(cmd_args, **_kwargs):
        with open(cmd_args[2], "w", encoding="utf-8") as output:
            output.write("ENDDATA\n")
        return subprocess.CompletedProcess(cmd_args, 0, stdout="", stderr="")

    monkeypatch.setattr(hitessbeam, "_BACKEND_DIR", str(backend_dir))
    monkeypatch.setattr(hitessbeam, "_MODULE_UNIT_EXE", str(executable))
    monkeypatch.setattr(hitessbeam, "_USER_CONN_DIR", str(user_conn))
    monkeypatch.setattr(hitessbeam.subprocess, "run", fake_subprocess_run)
    return user_conn


def _upload(client, user_id="A552244", headers=None):
    return client.post(
        "/hitessbeam/moduleUnit",
        data={"userID": user_id, "programName": "ModuleUnit"},
        files={"file": ("input.bdf", io.BytesIO(b"BEGIN BULK\nENDDATA\n"))},
        headers=headers or {},
    )


def _seed_session(db_session, monkeypatch, token, employee_id, is_active=True):
    SessionFactory = sessionmaker(
        bind=db_session.get_bind(), autocommit=False, autoflush=False
    )
    monkeypatch.setattr(sessions, "SessionLocal", SessionFactory)
    db_session.add(models.User(
        employee_id=employee_id, name="사용자", company="HHI", is_active=is_active,
    ))
    db_session.add(models.UserSession(
        token=token,
        employee_id=employee_id,
        created_at=datetime.now(),
        expires_at=datetime.now() + timedelta(hours=1),
    ))
    db_session.commit()


# ── 업로드: 레거시(헤더 없음) ────────────────────────────────────────────────

def test_module_unit_upload_without_authorization_is_accepted(db_session, module_unit_env):
    """배포 exe 가 보내는 그대로의 요청 — 헤더 없이 200 이어야 한다."""
    response = _upload(TestClient(_mini_app(db_session)))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["bdf_filename"] == "input_r.bdf"
    assert body["f06_filename"] == "input_r.f06"
    assert body["txt_filename"] == "input_r.txt"
    assert "_A552244_ModuleUnit_" in body["userFolder"]


def test_csv_to_bdf_upload_without_authorization_is_accepted(
    db_session, tmp_path, monkeypatch
):
    """배포 클라이언트의 절대경로 pickle과 무인증 요청을 그대로 지원한다."""
    backend_dir = tmp_path / "backend"
    executable = backend_dir / "CsvToBdf_HiTESS.exe"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"placeholder")

    def fake_subprocess_run(cmd_args, **_kwargs):
        with open(cmd_args[-1], "w", encoding="utf-8") as output:
            output.write("ENDDATA\n")
        return subprocess.CompletedProcess(cmd_args, 0)

    monkeypatch.setattr(hitessbeam, "_BACKEND_DIR", str(backend_dir))
    monkeypatch.setattr(hitessbeam, "_EXE_PATH", str(executable))
    monkeypatch.setattr(hitessbeam.subprocess, "run", fake_subprocess_run)

    response = TestClient(_mini_app(db_session)).post(
        "/hitessbeam/csvToBdf",
        data={"userID": "A552244"},
        files=[
            (
                "file",
                (
                    "input.pkl",
                    io.BytesIO(pickle.dumps([
                        r"C:\Engineering\CsvToBdf\structure.csv",
                        "None",
                        "None",
                    ])),
                ),
            ),
            ("file", ("structure.csv", io.BytesIO(b"node,x,y,z\n"))),
        ],
    )

    assert response.status_code == 200, response.text
    assert response.json()["bdfFilename"] == "structure.bdf"


def test_legacy_user_id_cannot_escape_user_connection_directory(
    db_session, module_unit_env
):
    """익명 userID 는 폴더명에 들어간다 — 경로 탈출 문자는 폴더를 만들지 못한다."""
    response = _upload(TestClient(_mini_app(db_session)), user_id="../../evil")

    assert response.status_code == 200, response.text
    folder = response.json()["userFolder"]
    assert ".." not in folder and "/" not in folder and "\\" not in folder
    created = os.path.abspath(os.path.join(str(module_unit_env), folder))
    assert created.startswith(os.path.abspath(str(module_unit_env)) + os.sep)
    assert os.path.isdir(created)


def test_legacy_javascript_false_user_id_keeps_undefined_fallback(
    db_session, module_unit_env
):
    """예전 클라이언트가 보내던 문자열 'false' 는 undefined 로 정규화된다(기존 동작)."""
    response = _upload(TestClient(_mini_app(db_session)), user_id="false")

    assert response.status_code == 200, response.text
    assert "_undefined_ModuleUnit_" in response.json()["userFolder"]


# ── 업로드: 토큰이 있으면 끝까지 검증 ────────────────────────────────────────

def test_invalid_bearer_token_is_still_rejected(db_session, module_unit_env, monkeypatch):
    """헤더가 '있는데 잘못된' 경우는 익명으로 강등하지 않고 401 로 거부한다."""
    _seed_session(db_session, monkeypatch, "good-token", "A552244")

    response = _upload(
        TestClient(_mini_app(db_session)),
        headers={"Authorization": "Bearer bogus-token"},
    )

    assert response.status_code == 401


def test_token_identity_conflicting_with_user_id_is_rejected(
    db_session, module_unit_env, monkeypatch
):
    """인증된 요청은 남의 사번을 주장할 수 없다."""
    _seed_session(db_session, monkeypatch, "good-token", "A552244")

    response = _upload(
        TestClient(_mini_app(db_session)),
        user_id="A000001",
        headers={"Authorization": "Bearer good-token"},
    )

    assert response.status_code == 403


def test_token_identity_matches_user_id_case_insensitively(
    db_session, module_unit_env, monkeypatch
):
    """로그인은 사번을 대문자로 정규화한다 — 소문자로 보낸 userID 가 403 이면 안 된다."""
    _seed_session(db_session, monkeypatch, "good-token", "A552244")

    response = _upload(
        TestClient(_mini_app(db_session)),
        user_id="a552244",
        headers={"Authorization": "Bearer good-token"},
    )

    assert response.status_code == 200, response.text
    assert "_A552244_ModuleUnit_" in response.json()["userFolder"]


# ── 다운로드 ────────────────────────────────────────────────────────────────

def _seed_result_file(user_conn, folder_name):
    folder = user_conn / folder_name
    folder.mkdir(parents=True)
    (folder / "input_r.txt").write_text("PASS\n", encoding="utf-8")
    return folder


def test_module_unit_download_without_authorization_is_accepted(
    db_session, module_unit_env
):
    """업로드만 열고 다운로드를 닫으면 클라이언트는 결과를 못 받는다 — 셋 다 열려야 한다."""
    _seed_result_file(module_unit_env, "20260729_101500_A552244_ModuleUnit_abcd1234")

    response = TestClient(_mini_app(db_session)).get(
        "/hitessbeam/moduleUnit/download/20260729_101500_A552244_ModuleUnit_abcd1234/input_r.txt"
    )

    assert response.status_code == 200, response.text
    assert response.content.strip() == b"PASS"


def test_module_unit_download_with_token_still_enforces_owner_check(
    db_session, module_unit_env, monkeypatch
):
    """토큰을 보낸 요청은 남의 작업 폴더를 열 수 없다."""
    _seed_session(db_session, monkeypatch, "good-token", "A000001")
    _seed_result_file(module_unit_env, "20260729_101500_A552244_ModuleUnit_abcd1234")

    response = TestClient(_mini_app(db_session)).get(
        "/hitessbeam/moduleUnit/download/20260729_101500_A552244_ModuleUnit_abcd1234/input_r.txt",
        headers={"Authorization": "Bearer good-token"},
    )

    assert response.status_code == 403


def test_download_path_escape_is_still_blocked(db_session, module_unit_env):
    """익명 허용이 경로 탈출까지 허용한다는 뜻은 아니다."""
    outside = os.path.dirname(str(module_unit_env))
    with open(os.path.join(outside, "secret.txt"), "w", encoding="utf-8") as handle:
        handle.write("secret")

    response = TestClient(_mini_app(db_session)).get(
        "/hitessbeam/moduleUnit/download/../secret.txt"
    )

    assert response.status_code in (400, 404)
    assert b"secret" not in response.content
