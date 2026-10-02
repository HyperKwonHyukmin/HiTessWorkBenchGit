"""해석 오류·경고 수집기(nastran_diagnostics) + 관리자 조회 API.

핵심 규약(사용자 결정 2026-10-02):
- 같은 유형(지문)은 횟수만 센다. **처음 보는 오류일 때만** 입력 BDF 를 따로 보관한다.
- 처리(handled) 표시한 유형이 다시 나오면 regressed 로 되돌리고 그 사례를 다시 보관한다.
- 경고는 세기만 하고 보관하지 않는다.
"""
import io
import os
import zipfile
from datetime import datetime, timedelta

import pytest
from sqlalchemy.orm import sessionmaker

from app import models
from app.services import nastran_diagnostics as nd

F06_FATAL = """\
1    MSC.NASTRAN JOB CREATED ON 02-OCT-26 AT 11:38:58                           PAGE     1
 *** USER FATAL MESSAGE 9994 (BULKIN)
     First Field Violation near line {line}
     First Field Parent identification string "SOL {sol}" must be contiguous, check start of field two.

 *** USER WARNING MESSAGE 4698 (DCMPD)
     STATISTICS FOR DECOMPOSITION OF MATRIX KLL  .
     THE FOLLOWING DEGREES OF FREEDOM HAVE FACTOR DIAGONAL RATIOS GREATER THAN   1.00000E+07

 *** USER FATAL MESSAGE 6498 (API Internals, End Group Processing)
     file c:/scratch/run{line}.T1_53.SCRATCH could not be opened
"""

F06_WARN_ONLY = """\
 *** USER WARNING MESSAGE 4698 (DCMPD)
     STATISTICS FOR DECOMPOSITION OF MATRIX KLL  .
     THE FOLLOWING DEGREES OF FREEDOM HAVE FACTOR DIAGONAL RATIOS GREATER THAN   1.00000E+07
"""


# ── 순수 함수 ──────────────────────────────────────────────────────────

def test_parse_f06_reads_head_and_detail_lines(tmp_path):
    f06 = tmp_path / "a.f06"
    f06.write_text(F06_FATAL.format(line=16, sol=101), encoding="latin-1")
    msgs = nd.parse_f06(str(f06))
    assert [(m["level"], m["code"]) for m in msgs] == [("fatal", "9994"), ("warning", "4698"), ("fatal", "6498")]
    assert "near line 16" in msgs[0]["message"]
    assert "must be contiguous" in msgs[0]["message"]


def test_same_error_with_different_numbers_and_paths_has_same_fingerprint(tmp_path):
    a, b = tmp_path / "a.f06", tmp_path / "b.f06"
    a.write_text(F06_FATAL.format(line=16, sol=101), encoding="latin-1")
    b.write_text(F06_FATAL.format(line=2391, sol=103), encoding="latin-1")
    fa = [nd.fingerprint(m["level"], m["code"], m["module"]) for m in nd.parse_f06(str(a))]
    fb = [nd.fingerprint(m["level"], m["code"], m["module"]) for m in nd.parse_f06(str(b))]
    assert fa == fb
    assert "<PATH>" in nd.normalize(nd.parse_f06(str(a))[2]["message"])
    assert "#" in nd.normalize("First Field Violation near line 16")


def test_engine_failure_prefers_error_line_and_ignores_cancel():
    log = "progress 10\nlift-run prepare exit code 1\n[Error] lift-run prepare exit code 1. 로그:\nTraceback ...\nKeyError: 'x'"
    assert nd.engine_failure(log).startswith("lift-run prepare exit code 1")
    assert nd.engine_failure("[Error] 사용자가 작업을 취소했습니다.") is None
    assert nd.engine_failure("") is None


# ── 수집 본체 ──────────────────────────────────────────────────────────

@pytest.fixture()
def env(tmp_path, monkeypatch, db_session):
    uc = tmp_path / "userConnection"
    archive = tmp_path / "archive"
    uc.mkdir()
    monkeypatch.setattr(nd, "USER_CONNECTION_DIR", str(uc))
    monkeypatch.setattr(nd, "ARCHIVE_ROOT", str(archive))
    Session = sessionmaker(bind=db_session.get_bind(), autocommit=False, autoflush=False)
    monkeypatch.setattr(nd.database, "SessionLocal", Session)
    counter = {"n": 0}

    def run(f06_text=None, status="Failed", engine_log="", fallback=None, program="GroupModuleUnit", f06_age=None):
        counter["n"] += 1
        n = counter["n"]
        work = uc / f"20261002_1200{n:02d}_A476854_{program}"
        work.mkdir()
        bdf = work / "Model_A.bdf"
        bdf.write_text("SOL 101\nCEND\nGRID,1,,0.,0.,0.\n", encoding="latin-1")
        if f06_text is not None:
            f06 = work / "model_a.f06"            # Nastran 은 소문자 파일명으로 쓴다
            f06.write_text(f06_text, encoding="latin-1")
            if f06_age:
                old = (datetime.now() - f06_age).timestamp()
                os.utime(f06, (old, old))
        rec = models.Analysis(
            job_id=f"job-{n}", program_name=program, project_name="p", employee_id="A476854",
            status=status, input_info={"bdf_model": str(bdf)}, result_info={"bdf": str(bdf)},
            started_at=datetime.now() - timedelta(seconds=5), created_at=datetime.now(),
        )
        db_session.add(rec)
        db_session.commit()
        return nd.collect_job_diagnostics(f"job-{n}", engine_log, fallback)

    run.db = db_session
    run.archive = archive
    return run


def sigs(db):
    db.expire_all()
    return {(s.level, s.code): s for s in db.query(models.DiagnosticSignature).all()}


def test_first_occurrence_is_archived_and_repeats_only_count(env):
    first = env(F06_FATAL.format(line=16, sol=101))
    assert first["new"] == 1                      # 9994 만 — 6498 은 연쇄라 빠지고 경고 4698 은 보관 대상 아님
    case = env.archive / first["archive"]
    files = set(os.listdir(case))
    assert {"Model_A.bdf", "model_a.f06.excerpt.txt", "meta.json"} <= files
    assert "near line 16" in (case / "model_a.f06.excerpt.txt").read_text(encoding="utf-8")

    second = env(F06_FATAL.format(line=2391, sol=103))
    assert second["new"] == 0 and second["archive"] is None
    s = sigs(env.db)
    assert s[("fatal", "9994")].occurrence_count == 2
    assert s[("warning", "4698")].archive_dir is None
    occ = env.db.query(models.DiagnosticOccurrence).filter_by(job_id="job-2").all()
    assert len(occ) == 2 and not any(o.archived for o in occ)   # 9994 + 경고 4698


def test_handled_signature_that_recurs_becomes_regressed_and_is_archived_again(env):
    env(F06_FATAL.format(line=16, sol=101))
    sig = sigs(env.db)[("fatal", "9994")]
    sig.status = "handled"
    env.db.commit()
    again = env(F06_FATAL.format(line=99, sol=101))
    assert again["new"] == 1
    sig = sigs(env.db)[("fatal", "9994")]
    assert sig.status == "regressed"
    assert sig.archive_dir == again["archive"]


def test_failure_before_nastran_records_engine_reason(env):
    r = env(None, engine_log="[Error] lift-run prepare exit code 1. 로그:\nboom", program="UnitStructuralAnalysis")
    assert r["new"] == 1
    sig = sigs(env.db)[("engine", None)]
    assert sig.programs == ["UnitStructuralAnalysis"]
    assert "exit code #" in sig.template
    assert "Model_A.bdf" in os.listdir(env.archive / r["archive"])


def test_engine_reason_falls_back_to_specific_failure_message_but_not_generic(env):
    assert env(None, engine_log="", fallback="Analysis Failed") == {"events": 0}
    assert env(None, engine_log="", fallback="서버 재시작으로 작업 상태가 중단되었습니다.") == {"events": 0}
    r = env(None, engine_log="", fallback="Nastran 해석 오류 — FATAL 3건(코드 9050)")
    assert r["new"] == 1


def test_warning_only_success_is_counted_not_archived(env):
    r = env(F06_WARN_ONLY, status="Success")
    assert r["events"] == 1 and r["new"] == 0
    assert not env.archive.exists()


def test_old_f06_from_earlier_run_in_same_folder_is_ignored(env):
    assert env(F06_FATAL.format(line=1, sol=1), status="Success", f06_age=timedelta(hours=3)) == {"events": 0}


# ── 관리자 API ─────────────────────────────────────────────────────────

def test_admin_api_list_detail_archive_and_status(env, admin_client):
    first = env(F06_FATAL.format(line=16, sol=101))
    items = admin_client.get("/api/admin/diagnostics", params={"level": "fatal"}).json()["items"]
    assert {i["code"] for i in items} == {"9994"}
    fp = next(i["fingerprint"] for i in items if i["code"] == "9994")

    detail = admin_client.get(f"/api/admin/diagnostics/{fp}").json()
    assert detail["occurrences"][0]["programName"] == "GroupModuleUnit"
    assert detail["archiveDir"] == first["archive"]

    res = admin_client.get(f"/api/admin/diagnostics/{fp}/archive")
    assert res.status_code == 200
    names = zipfile.ZipFile(io.BytesIO(res.content)).namelist()
    assert "Model_A.bdf" in names and "meta.json" in names

    assert admin_client.patch(f"/api/admin/diagnostics/{fp}", json={"status": "bogus"}).status_code == 400
    done = admin_client.patch(f"/api/admin/diagnostics/{fp}", json={"status": "handled", "note": "bdf_deck_check"}).json()
    assert done["status"] == "handled" and done["handledNote"] == "bdf_deck_check"
    open_items = admin_client.get("/api/admin/diagnostics", params={"status": "new,regressed"}).json()["items"]
    assert fp not in {i["fingerprint"] for i in open_items}


def test_non_admin_is_rejected(switchable_client):
    switchable_client.as_user()
    assert switchable_client.get("/api/admin/diagnostics").status_code == 403


def test_same_code_different_card_names_is_one_type_and_cascade_dropped(env):
    """한 원인(Bulk 안 해석 설정 줄)이 카드 이름마다 307 을 내도 유형은 하나, 연쇄 6498 은 빠진다."""
    text = (
        " *** USER FATAL MESSAGE 307 (IFPDRV)\n     ILLEGAL NAME FOR BULK DATA ENTRY CEND\n\n"
        " *** USER FATAL MESSAGE 307 (IFPDRV)\n     ILLEGAL NAME FOR BULK DATA ENTRY SUBCASE\n\n"
        " *** USER FATAL MESSAGE 6498 (API Internals, End Group Processing)\n     No Such Group defined. Group: ML0\n"
    )
    r = env(text)
    assert r["events"] == 1 and r["new"] == 1
    assert set(sigs(env.db)) == {("fatal", "307")}


def test_only_cascade_fatals_are_still_recorded(env):
    r = env(" *** USER FATAL MESSAGE 6498 (API Internals, End Group Processing)\n     boom\n")
    assert r["new"] == 1


def test_f06_outside_job_window_is_not_counted():
    """같은 폴더를 쓰는 앞선 작업(자세안정성 등)이 뒤에 생긴 구조 해석 F06 을 가져가지 않는다."""
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        f06 = os.path.join(d, "x.f06")
        open(f06, "w").close()
        now = datetime.now()
        assert nd.recent_f06([d], now - timedelta(hours=2), now - timedelta(hours=1)) == []
        assert nd.recent_f06([d], now - timedelta(hours=2), now) == [os.path.abspath(f06)]
        assert nd.recent_f06([d], now - timedelta(hours=2), None) == [os.path.abspath(f06)]


def test_child_record_without_paths_follows_parent_folder(env, db_session, tmp_path):
    """권상 구조 해석 실패 기록에는 parent_analysis_id 만 남는다 — 부모 GMU 폴더의 F06·BDF 를 찾아야 한다."""
    env(None, status="Success")                     # 부모(GMU 검증) — 폴더와 BDF 를 만든다
    parent = db_session.query(models.Analysis).filter_by(job_id="job-1").one()
    folder = os.path.dirname(parent.input_info["bdf_model"])
    with open(os.path.join(folder, "model_a_lifting.f06"), "w", encoding="latin-1") as f:
        f.write(F06_FATAL.format(line=16, sol=101))
    child = models.Analysis(
        job_id="child", program_name="UnitStructuralAnalysis", project_name="p", employee_id="A476854",
        status="Failed", input_info={"parent_analysis_id": parent.id}, result_info={"engineLog": "x"},
        started_at=datetime.now() - timedelta(seconds=5), created_at=datetime.now(),
    )
    db_session.add(child)
    db_session.commit()
    r = nd.collect_job_diagnostics("child", "")
    assert r["new"] == 1
    assert "Model_A.bdf" in os.listdir(env.archive / r["archive"])


def test_job_without_paths_uses_folder_given_by_caller(env, db_session):
    """Model Builder 편집 적용 — 기록은 input/result 가 비어 있고 상태도 아직 Running 이다."""
    env(None, status="Success")
    folder = os.path.dirname(db_session.query(models.Analysis).filter_by(job_id="job-1").one().input_info["bdf_model"])
    edited = os.path.join(folder, "20261002_120000", "edited")
    os.makedirs(edited)
    with open(os.path.join(edited, "model.f06"), "w", encoding="latin-1") as f:
        f.write(" *** USER FATAL MESSAGE 9050 (SEKRRS)\n     RUN TERMINATED DUE TO EXCESSIVE PIVOT RATIOS IN MATRIX KLL.\n")
    db_session.add(models.Analysis(
        job_id="edit", program_name="HiTessModelBuilder", project_name="p", employee_id="A476854",
        status="Running", input_info={}, result_info={},
        started_at=datetime.now() - timedelta(seconds=5), created_at=datetime.now(),
        updated_at=datetime.now() - timedelta(seconds=5),   # DB 기록이 아직 안 갱신됨 — 실시간 수집은 이 값을 상한으로 쓰지 않는다
    ))
    db_session.commit()
    assert nd.collect_job_diagnostics("edit", "", status="Success") == {"events": 0}   # 폴더를 모르면 못 찾는다
    db_session.query(models.DiagnosticOccurrence).delete()
    db_session.commit()
    r = nd.collect_job_diagnostics("edit", "", status="Success", extra_dirs=[os.path.join(folder, "20261002_120000")])
    assert r["new"] == 1
    assert set(sigs(env.db)) == {("fatal", "9050")}
