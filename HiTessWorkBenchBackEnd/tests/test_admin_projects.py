"""관리자 All Projects(`/api/admin/projects*`) — 전체 이력·작업 폴더 파일·LogBook 보내기.

LogBook 서버는 httpx.MockTransport 로 대신한다 — 실제 9095 나 DB 에는 붙지 않는다. 합성 데이터만.
"""
import json
from datetime import datetime
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app import models
from app.routers import analysis as analysis_router
from app.services import admin_projects as svc

SECRET = "test-shared-secret"


@pytest.fixture()
def user_conn(tmp_path, monkeypatch):
    base = tmp_path / "userConnection"
    base.mkdir()
    monkeypatch.setattr(analysis_router, "_USER_CONNECTION_DIR", str(base))
    monkeypatch.setattr(analysis_router, "_ALLOWED_DOWNLOAD_BASE", str(base))
    return base


@pytest.fixture()
def enabled(monkeypatch):
    monkeypatch.setenv("LOGBOOK_INTEGRATION_SECRET", SECRET)
    monkeypatch.setenv("LOGBOOK_INTERNAL_URL", "http://lb.test:9095")


def _work(base, folder, files: dict[str, bytes]):
    root = base / folder
    for rel, data in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    return root


def _analysis(db, *, eid="EMP001", program="GroupModuleUnit", input_info=None, result_info=None,
              created_at=None, project="9999 권상", status="Success"):
    a = models.Analysis(employee_id=eid, program_name=program, project_name=project, status=status,
                        input_info=input_info or {}, result_info=result_info or {},
                        created_at=created_at or datetime(2026, 10, 1, 9, 0, 0))
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


def _gmu(db, base):
    root = _work(base, "20261001_090000_EMP001_GroupModuleUnit", {
        "9999_m01.bdf": b"SOL 101\nCEND\nBEGIN BULK\nENDDATA\n",
        "step1.json": b"{}",
        "sub/extra.f06": b"F06",
    })
    return _analysis(db, input_info={"bdf_model": str(root / "9999_m01.bdf")},
                     result_info={"step1": str(root / "step1.json")})


# ── 목록 ──────────────────────────────────────────────────────────────────────

def test_list_requires_admin(switchable_client):
    switchable_client.as_user()
    assert switchable_client.get("/api/admin/projects").status_code == 403


def test_list_all_users_and_filters(switchable_client, db_session, user_conn):
    db_session.add(models.User(employee_id="EMP002", name="홍길동", company="HHI", department="구조연구실",
                               is_active=True, is_admin=False, is_developer=False))
    db_session.commit()
    _gmu(db_session, user_conn)
    _analysis(db_session, eid="EMP002", program="TrussAssessment", created_at=datetime(2026, 10, 2))
    _analysis(db_session, eid="EMP002", program="UnitStructuralAnalysis")      # 세부 검토 — 숨김
    db_session.add(models.Analysis(employee_id="EMP001", program_name="GroupModuleUnit", status="Success",
                                   source=analysis_router.SAMPLE_SOURCE_TAG, created_at=datetime(2026, 10, 3)))
    db_session.commit()

    r = switchable_client.get("/api/admin/projects")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 2
    assert [i["employee_id"] for i in body["items"]] == ["EMP002", "EMP001"]
    assert body["items"][0]["userName"] == "홍길동" and body["items"][0]["department"] == "구조연구실"
    assert "UnitStructuralAnalysis" not in body["programs"]

    # 이름·부서로 검색
    assert switchable_client.get("/api/admin/projects", params={"search": "홍길"}).json()["total"] == 1
    assert switchable_client.get("/api/admin/projects", params={"search": "구조연구"}).json()["total"] == 1
    # 사번(대소문자 무시)·App·파일 상태
    assert switchable_client.get("/api/admin/projects", params={"employee_id": "emp001"}).json()["total"] == 1
    assert switchable_client.get("/api/admin/projects", params={"program_name": "TrussAssessment"}).json()["total"] == 1
    avail = switchable_client.get("/api/admin/projects", params={"file_status": "available"}).json()
    assert [i["program_name"] for i in avail["items"]] == ["GroupModuleUnit"]
    assert switchable_client.get("/api/admin/projects", params={"file_status": "expired"}).json()["total"] == 1


# ── 파일 목록 ─────────────────────────────────────────────────────────────────

def test_files_lists_whole_work_folder_with_roles(switchable_client, db_session, user_conn):
    a = _gmu(db_session, user_conn)
    r = switchable_client.get(f"/api/admin/projects/{a.id}/files")
    assert r.status_code == 200, r.text
    body = r.json()
    roles = {f["rel"]: f["role"] for f in body["files"]}
    assert roles == {"9999_m01.bdf": "input", "step1.json": "result", "sub/extra.f06": "other"}
    assert body["folders"] == [{"name": "20261001_090000_EMP001_GroupModuleUnit", "exists": True}]
    assert body["exports"] == [] and body["truncated"] is False


def test_files_include_substep_child_folder_and_nested_paths(switchable_client, db_session, user_conn):
    parent = _gmu(db_session, user_conn)
    child_root = _work(user_conn, "20261001_100000_EMP001_UnitStructural", {"out.op2": b"OP2"})
    _analysis(db_session, program="UnitStructuralAnalysis", created_at=datetime(2026, 10, 1, 10),
              input_info={"parent_analysis_id": parent.id},
              result_info={"nested": {"op2": [str(child_root / "out.op2")]}})
    body = switchable_client.get(f"/api/admin/projects/{parent.id}/files").json()
    assert {f["folder"] for f in body["files"]} == {
        "20261001_090000_EMP001_GroupModuleUnit", "20261001_100000_EMP001_UnitStructural"}
    assert next(f for f in body["files"] if f["rel"] == "out.op2")["role"] == "result"


def test_files_marks_drm(switchable_client, db_session, user_conn):
    root = _work(user_conn, "20261001_090000_EMP001_TrussAssessment", {"a.bdf": b"HHIDRMC" + b"x" * 10})
    a = _analysis(db_session, program="TrussAssessment", input_info={"bdf": str(root / "a.bdf")})
    files = switchable_client.get(f"/api/admin/projects/{a.id}/files").json()["files"]
    assert files[0]["drm"] is True


def test_files_ignores_paths_outside_user_connection(switchable_client, db_session, user_conn, tmp_path):
    outside = tmp_path / "secret.txt"
    outside.write_text("x")
    a = _analysis(db_session, input_info={"x": str(outside), "y": "../../etc/passwd"})
    body = switchable_client.get(f"/api/admin/projects/{a.id}/files").json()
    assert body["files"] == [] and body["folders"] == []


# ── LogBook 보내기 ────────────────────────────────────────────────────────────

class FakeLogbook:
    def __init__(self, drm_paths=(), finish_status=200, begin_status=201, blocked=None):
        self.calls = []
        self.chunks: dict[str, bytes] = {}
        self.drm_paths = set(drm_paths)
        self.finish_status = finish_status
        self.begin_status = begin_status
        self.blocked = blocked or []
        self.cancelled = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = urlparse(str(request.url))
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        self.calls.append((request.method, url.path, q))
        assert request.headers.get("X-HiTESS-Integration") == SECRET
        assert q.get("as") == "ADMIN001"
        if request.method == "POST" and url.path == "/api/integration/uploads":
            if self.begin_status != 201:
                return httpx.Response(self.begin_status, json={"detail": "sender_not_admin"})
            self.begin_body = json.loads(request.content)
            return httpx.Response(201, json={"key": "20261013-1-abcd", "state": "uploading"})
        if request.method == "PUT" and url.path.endswith("/chunk"):
            path = q["path"]
            if path in self.drm_paths:
                return httpx.Response(422, json={"detail": "drm_encrypted"})
            assert int(q["offset"]) == len(self.chunks.get(path, b""))
            self.chunks[path] = self.chunks.get(path, b"") + request.content
            return httpx.Response(200, json={"size": len(self.chunks[path])})
        if request.method == "POST" and url.path.endswith("/finish"):
            self.finish_body = json.loads(request.content)
            if self.finish_status != 200:
                return httpx.Response(self.finish_status, json={"detail": "storage_unreachable"})
            return httpx.Response(200, json={"key": "20261013-1-abcd", "state": "staged",
                                             "blocked": self.blocked, "deferred": 0})
        if request.method == "DELETE":
            self.cancelled = True
            return httpx.Response(204)
        return httpx.Response(404, json={"detail": "not_found"})


@pytest.fixture()
def fake_lb(monkeypatch):
    def _install(**kw):
        fake = FakeLogbook(**kw)
        monkeypatch.setattr(svc, "_http_transport", httpx.MockTransport(fake))
        return fake
    return _install


def _paths(client, aid):
    return [f["path"] for f in client.get(f"/api/admin/projects/{aid}/files").json()["files"]]


def test_export_sends_files_and_records(switchable_client, db_session, user_conn, enabled, fake_lb):
    fake = fake_lb()
    a = _gmu(db_session, user_conn)
    paths = _paths(switchable_client, a.id)
    r = switchable_client.post(f"/api/admin/projects/{a.id}/logbook",
                               json={"paths": paths, "note": "좋은 권상 모델"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == "staged" and body["file_count"] == 3 and body["key"] == "20261013-1-abcd"
    folder = "20261001_090000_EMP001_GroupModuleUnit"
    assert fake.chunks[f"{folder}/9999_m01.bdf"].startswith(b"SOL 101")
    assert fake.chunks[f"{folder}/sub/extra.f06"] == b"F06"
    assert fake.begin_body["name"] == f"WB #{a.id} · GroupModuleUnit · EMP001"
    assert fake.begin_body["origin"]["owner"] == "EMP001" and fake.begin_body["origin"]["note"] == "좋은 권상 모델"
    assert {f["rel_path"]: f["size"] for f in fake.finish_body["files"]}[f"{folder}/step1.json"] == 2

    row = db_session.query(models.LogbookExport).one()
    assert row.sent_by == "ADMIN001" and row.batch_key == "20261013-1-abcd" and row.file_count == 3
    listing = switchable_client.get("/api/admin/projects").json()["items"][0]
    assert listing["logbook"]["count"] == 1
    assert switchable_client.get(f"/api/admin/projects/{a.id}/files").json()["exports"][0]["state"] == "staged"


def test_export_large_file_in_chunks(switchable_client, db_session, user_conn, enabled, fake_lb, monkeypatch):
    monkeypatch.setattr(svc, "CHUNK_SIZE", 4)
    fake = fake_lb()
    root = _work(user_conn, "20261001_090000_EMP001_TrussAssessment", {"big.bdf": b"0123456789", "empty.txt": b""})
    a = _analysis(db_session, program="TrussAssessment", input_info={"bdf": str(root / "big.bdf")})
    r = switchable_client.post(f"/api/admin/projects/{a.id}/logbook", json={"paths": _paths(switchable_client, a.id)})
    assert r.status_code == 200, r.text
    folder = "20261001_090000_EMP001_TrussAssessment"
    assert fake.chunks[f"{folder}/big.bdf"] == b"0123456789"
    assert fake.chunks[f"{folder}/empty.txt"] == b""
    assert sorted(f["size"] for f in fake.finish_body["files"]) == [0, 10]


def test_export_drm_file_reported_as_rejected(switchable_client, db_session, user_conn, enabled, fake_lb):
    folder = "20261001_090000_EMP001_GroupModuleUnit"
    fake = fake_lb(drm_paths={f"{folder}/step1.json"})
    a = _gmu(db_session, user_conn)
    body = switchable_client.post(f"/api/admin/projects/{a.id}/logbook",
                                  json={"paths": _paths(switchable_client, a.id)}).json()
    assert body["file_count"] == 2
    assert body["rejected"] == [{"rel_path": f"{folder}/step1.json", "reason": "drm"}]
    assert fake.finish_body["rejected"] == body["rejected"]


def test_export_rejects_path_outside_work_folder(switchable_client, db_session, user_conn, enabled, fake_lb,
                                                 tmp_path):
    fake_lb()
    a = _gmu(db_session, user_conn)
    other = _work(user_conn, "20261001_090000_EMP009_Other", {"x.bdf": b"x"})
    for bad in (str(other / "x.bdf"), str(tmp_path / "nope.txt"),
                str(user_conn / "20261001_090000_EMP001_GroupModuleUnit" / ".." / "20261001_090000_EMP009_Other" / "x.bdf")):
        r = switchable_client.post(f"/api/admin/projects/{a.id}/logbook", json={"paths": [bad]})
        assert r.status_code == 422, bad
    assert db_session.query(models.LogbookExport).count() == 0


def test_export_requires_admin(switchable_client, db_session, user_conn, enabled, fake_lb):
    fake_lb()
    a = _gmu(db_session, user_conn)
    switchable_client.as_user()
    assert switchable_client.post(f"/api/admin/projects/{a.id}/logbook", json={"paths": ["x"]}).status_code == 403


def test_export_disabled_without_secret(switchable_client, db_session, user_conn, monkeypatch):
    monkeypatch.delenv("LOGBOOK_INTEGRATION_SECRET", raising=False)
    a = _gmu(db_session, user_conn)
    r = switchable_client.post(f"/api/admin/projects/{a.id}/logbook", json={"paths": _paths(switchable_client, a.id)})
    assert r.status_code == 503 and "꺼져" in r.json()["detail"]
    assert db_session.query(models.LogbookExport).one().state == "failed"


def test_export_logbook_error_cancels_batch(switchable_client, db_session, user_conn, enabled, fake_lb):
    fake = fake_lb(finish_status=503)
    a = _gmu(db_session, user_conn)
    r = switchable_client.post(f"/api/admin/projects/{a.id}/logbook", json={"paths": _paths(switchable_client, a.id)})
    assert r.status_code == 502 and "공유 폴더" in r.json()["detail"]
    assert fake.cancelled is True
    row = db_session.query(models.LogbookExport).one()
    assert row.state == "failed" and "공유 폴더" in row.error


def test_export_sender_not_admin_message(switchable_client, db_session, user_conn, enabled, fake_lb):
    fake_lb(begin_status=403)
    a = _gmu(db_session, user_conn)
    r = switchable_client.post(f"/api/admin/projects/{a.id}/logbook", json={"paths": _paths(switchable_client, a.id)})
    assert r.status_code == 502 and "관리자로 확인하지 못했습니다" in r.json()["detail"]


def test_export_unreachable_logbook(switchable_client, db_session, user_conn, enabled, monkeypatch):
    def boom(request):
        raise httpx.ConnectError("refused", request=request)
    monkeypatch.setattr(svc, "_http_transport", httpx.MockTransport(boom))
    a = _gmu(db_session, user_conn)
    r = switchable_client.post(f"/api/admin/projects/{a.id}/logbook", json={"paths": _paths(switchable_client, a.id)})
    assert r.status_code == 502 and "연결할 수 없습니다" in r.json()["detail"]


def test_export_blocked_duplicates_returned(switchable_client, db_session, user_conn, enabled, fake_lb):
    fake_lb(blocked=[{"name": "9999_m01.bdf", "same_as": "E-0001"}])
    a = _gmu(db_session, user_conn)
    body = switchable_client.post(f"/api/admin/projects/{a.id}/logbook",
                                  json={"paths": _paths(switchable_client, a.id)}).json()
    assert body["blocked"] == [{"name": "9999_m01.bdf", "same_as": "E-0001"}]
    assert db_session.query(models.LogbookExport).one().blocked == body["blocked"]


# ── Hi-TESS Core 1단계: 해석 여권 함께 보내기(LOGBOOK_SEND_PASSPORT) ─────────────────

def test_export_without_passport_key_sends_same_origin(switchable_client, db_session, user_conn, enabled, fake_lb,
                                                       monkeypatch):
    monkeypatch.delenv("LOGBOOK_SEND_PASSPORT", raising=False)
    fake = fake_lb()
    a = _gmu(db_session, user_conn)
    r = switchable_client.post(f"/api/admin/projects/{a.id}/logbook", json={"paths": _paths(switchable_client, a.id)})
    assert r.status_code == 200, r.text
    assert set(fake.begin_body["origin"]) == {"analysis_id", "owner", "program", "project", "created_at", "note"}


def test_export_with_passport_key_adds_verified_artifacts(switchable_client, db_session, user_conn, enabled, fake_lb,
                                                          monkeypatch):
    import hashlib
    monkeypatch.setenv("LOGBOOK_SEND_PASSPORT", "1")
    fake = fake_lb()
    a = _gmu(db_session, user_conn)
    r = switchable_client.post(f"/api/admin/projects/{a.id}/logbook", json={"paths": _paths(switchable_client, a.id)})
    assert r.status_code == 200, r.text
    arts = {x["name"]: x for x in fake.begin_body["origin"]["passport"]["artifacts"]}
    bdf = b"SOL 101\nCEND\nBEGIN BULK\nENDDATA\n"
    assert arts["9999_m01.bdf"]["sha256"] == hashlib.sha256(bdf).hexdigest()
    assert arts["9999_m01.bdf"]["size"] == len(bdf) and arts["9999_m01.bdf"]["role"]


def test_export_passport_failure_still_sends(switchable_client, db_session, user_conn, enabled, fake_lb, monkeypatch):
    from app.services import analysis_passport
    monkeypatch.setenv("LOGBOOK_SEND_PASSPORT", "1")
    monkeypatch.setattr(analysis_passport, "build_analysis_passport",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    fake = fake_lb()
    a = _gmu(db_session, user_conn)
    r = switchable_client.post(f"/api/admin/projects/{a.id}/logbook", json={"paths": _paths(switchable_client, a.id)})
    assert r.status_code == 200, r.text
    assert "passport" not in fake.begin_body["origin"]
