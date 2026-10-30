"""AM 연동 접수 API(`POST /api/am/submissions`) — CSV 검사·저장·사용량 기록."""
import hashlib
import json
import os

import pytest
from fastapi.testclient import TestClient

from app import database, models
from app.dependencies import require_auth
from app.main import app
from app.routers import _intake
from app.routers import am_intake as am_intake_router
from app.services.hitess_modelflow_service import task_execute_modelflow
from app.services import am_intake
from app.services.app_settings import GUARDED_ROUTES
from app.services.program_registry import resolve_program

EMP = "A123456"
STRU = "name,pos,ori,size\r\nB1,0 0 0,0 0 1,ANG_100x100x10\r\nB2,1 0 0,0 0 1,ANG_100x100x10\r\n".encode("utf-8")
PIPE = "name,apos,lpos,outDia\nP1,0 0 0,1 0 0,60.5\n".encode("utf-8")
EQUIP = "name,cog,weight\n펌프,0 0 0,100\n".encode("cp949")


@pytest.fixture()
def submitted(db_session, monkeypatch):
    """빌드 작업 제출을 가짜로 바꾼다 — 넘긴 인자를 모으고, 실제처럼 Pending 기록을 남긴다."""
    calls = []

    def _fake_submit(task_fn, *args, metadata=None, **kwargs):
        calls.append({"task": task_fn, "args": args, "metadata": metadata})
        job_id = f"job-{len(calls)}"
        db_session.add(models.Analysis(
            job_id=job_id, program_name=metadata.program_name, employee_id=metadata.employee_id,
            status="Pending", source="AmToModelBuilder",
        ))
        db_session.commit()
        return job_id

    monkeypatch.setattr(am_intake_router, "submit_analysis_job", _fake_submit)
    return calls


@pytest.fixture()
def am_client(db_session, tmp_path, monkeypatch, submitted):
    monkeypatch.setattr(_intake, "USER_CONNECTION_DIR", str(tmp_path / "userConnection"))

    def _override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = _override_db
    app.dependency_overrides[require_auth] = lambda: EMP
    yield TestClient(app)
    app.dependency_overrides.clear()


def _post(http, files, **form):
    data = {"employee_id": EMP, "hull_no": "3529", **form}
    return http.post("/api/am/submissions", data=data, files=files)


# ── 순수 검사 ──────────────────────────────────────────────

def test_inspect_csv_normal_structure():
    r = am_intake.inspect_csv("stru", STRU, hashlib.sha256(STRU).hexdigest())
    assert r["issues"] == []
    assert r["rows"] == 2 and r["columns"] == 4
    assert r["encoding"] == "utf-8" and r["sha256_match"] is True
    assert r["detected_kind"] == "stru" and r["header_ok"]


def test_inspect_csv_reads_cp949_and_bom():
    assert am_intake.inspect_csv("equip", EQUIP)["encoding"] == "cp949"
    bom = b"\xef\xbb\xbf" + PIPE
    r = am_intake.inspect_csv("pipe", bom)
    assert r["encoding"] == "utf-8-sig" and r["issues"] == []


def test_inspect_csv_flags_swapped_kind():
    r = am_intake.inspect_csv("stru", PIPE)
    assert not r["header_ok"]
    assert r["detected_kind"] == "pipe"
    assert "배관 CSV 로 보입니다" in r["issues"][0]


def test_inspect_csv_flags_sha_mismatch_empty_and_header_only():
    assert "sha256 불일치" in am_intake.inspect_csv("stru", STRU, "0" * 64)["issues"][0]
    assert am_intake.inspect_csv("stru", b"")["issues"] == ["빈 파일입니다."]
    header_only = am_intake.inspect_csv("stru", b"name,ori\n")
    assert header_only["issues"] == ["헤더만 있고 데이터 행이 없습니다."]


# ── API ───────────────────────────────────────────────────

def test_submit_saves_files_and_starts_build(am_client, db_session, submitted):
    res = _post(
        am_client,
        files={
            "stru_file": ("3529-stru.csv", STRU, "text/csv"),
            "pipe_file": ("3529-pipe.csv", PIPE, "text/csv"),
            "equip_file": ("3529-equip.csv", EQUIP, "text/csv"),
        },
        stru_sha256=hashlib.sha256(STRU).hexdigest(),
        client=json.dumps({"version": "0.1.0", "hostname": "PC01", "os_user": "kim"}),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True and body["hull_no"] == "3529"
    assert [f["kind"] for f in body["files"]] == ["stru", "pipe", "equip"]

    # 검사 통과 → 빌드 작업 1건, 기록도 그 작업의 1건뿐(이중 집계 없음)
    assert body["job_id"] == "job-1"
    assert len(submitted) == 1
    call = submitted[0]
    assert call["task"] is task_execute_modelflow
    assert call["metadata"].program_name == "AmToModelBuilder"
    stru_path, pipe_path, equip_path, work_dir = call["args"][:4]
    assert call["args"][7] == "AmToModelBuilder"      # source
    assert call["args"][-2:] == ("3529", "AmToModelBuilder")  # hull_no, program_name
    assert db_session.query(models.Analysis).count() == 1
    record = db_session.get(models.Analysis, body["submission_id"])
    assert record.job_id == "job-1" and record.employee_id == EMP

    # 받은 바이트 그대로 저장
    with open(stru_path, "rb") as fh:
        assert fh.read() == STRU
    assert os.path.basename(work_dir).endswith(f"_{EMP}_AmToModelBuilder")
    with open(os.path.join(work_dir, "submission.json"), encoding="utf-8") as fh:
        saved = json.load(fh)
    assert saved["ok"] is True and saved["client"]["hostname"] == "PC01"

    log = db_session.query(models.ActivityLog).filter_by(action_type="AM_SUBMIT").one()
    assert log.employee_id == EMP and log.status == "success"


def test_submit_with_bad_content_is_recorded_as_failed(am_client, db_session, submitted):
    res = _post(am_client, files={"stru_file": ("a.csv", PIPE, "text/csv")})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is False and body["files"][0]["issues"]
    assert body["job_id"] is None and submitted == []   # 빌드하지 않는다
    record = db_session.get(models.Analysis, body["submission_id"])
    assert record.status == "Failed"
    assert record.program_name == "AmToModelBuilder" and record.source == "AmToModelBuilder"


@pytest.mark.parametrize("form, files, code", [
    ({}, {}, 400),  # 구조·배관 둘 다 없음
    ({}, {"equip_file": ("e.csv", EQUIP, "text/csv")}, 400),  # 장비만
    ({"hull_no": "35 29"}, {"stru_file": ("a.csv", STRU, "text/csv")}, 400),  # 호선 형식
    ({"employee_id": "B654321"}, {"stru_file": ("a.csv", STRU, "text/csv")}, 403),  # 남의 사번
    ({"employee_id": "kim"}, {"stru_file": ("a.csv", STRU, "text/csv")}, 400),  # 사번 형식
    ({}, {"stru_file": ("a.txt", STRU, "text/plain")}, 400),  # CSV 아님
])
def test_submit_rejects_bad_requests(am_client, db_session, form, files, code):
    res = _post(am_client, files=files or {"x": ("x", b"", "text/plain")}, **form)
    assert res.status_code == code, res.text
    assert db_session.query(models.Analysis).count() == 0


def test_lowercase_employee_id_is_accepted(am_client):
    res = _post(am_client, files={"stru_file": ("a.csv", STRU, "text/csv")}, employee_id="a123456")
    assert res.status_code == 200


def test_route_is_guarded_and_program_registered():
    assert ("/api/am/", "HiTESS Model Builder") in GUARDED_ROUTES
    spec = resolve_program("AmToModelBuilder")
    assert spec is not None and spec.history_visible
    assert resolve_program("AvevaMarineIntake") is spec  # 시험 중 쓴 옛 이름


# ── 가입 페이지 ───────────────────────────────────────────

def test_signup_page_is_served_and_posts_to_register():
    res = TestClient(app).get("/signup?employee_id=a123456")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    assert "fetch('/api/register'" in res.text


def test_signup_choices_match_workbench_register_modal():
    """가입 페이지의 회사·부서·직급 선택지는 WorkBench RegisterModal.jsx 사본이다 — 어긋나면 관리자 화면 값이 섞인다."""
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    modal = (root / "HiTessWorkBench/frontend/src/components/modals/RegisterModal.jsx").read_text(encoding="utf-8")
    html = (root / "HiTessWorkBenchBackEnd/app/static/signup/signup.html").read_text(encoding="utf-8")

    def array(name):
        body = re.search(rf"const {name} = \[(.*?)\]", modal, re.S).group(1)
        return set(re.findall(r"'([^']+)'", body))

    def datalist(list_id):
        body = re.search(rf'<datalist id="{list_id}">(.*?)</datalist>', html, re.S).group(1)
        return set(re.findall(r'<option value="([^"]+)">', body))

    assert datalist("companies") == array("BASE_COMPANIES")
    assert datalist("departments") == array("BASE_DEPARTMENTS")
    assert datalist("positions") == array("BASE_POSITIONS")


def test_same_file_name_from_different_folders_does_not_overwrite(am_client, submitted):
    res = _post(am_client, files={
        "stru_file": ("model.csv", STRU, "text/csv"),
        "pipe_file": ("model.csv", PIPE, "text/csv"),
    })
    assert res.status_code == 200 and res.json()["ok"] is True
    stru_path, pipe_path = submitted[0]["args"][:2]
    assert stru_path != pipe_path
    with open(stru_path, "rb") as fh:
        assert fh.read() == STRU
    with open(pipe_path, "rb") as fh:
        assert fh.read() == PIPE
