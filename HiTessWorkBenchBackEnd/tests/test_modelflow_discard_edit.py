"""Model Builder '수정 내역 0건' 저장 — 이전 회차 편집본을 걷어내는 discard-edit 회귀 테스트."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import database
from app.dependencies import require_auth
from app.routers import analysis


def _client(db_session, employee_id: str) -> TestClient:
    app = FastAPI()
    app.include_router(analysis.router)

    def override_db():
        yield db_session

    app.dependency_overrides[database.get_db] = override_db
    app.dependency_overrides[require_auth] = lambda: employee_id
    return TestClient(app)


def _output_dir(tmp_path, monkeypatch, owner="OWNER01"):
    base = tmp_path / "userConnection"
    out = base / f"20260930_090000_{owner}_HiTessModelBuilder" / "20260930_090010"
    out.mkdir(parents=True)
    (out / "Design.bdf").write_text("CEND\nBEGIN BULK\nENDDATA\n", encoding="utf-8")
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(base))
    monkeypatch.setattr(analysis, "_ALLOWED_DOWNLOAD_BASE", str(base))
    return out


def test_discard_edit_moves_stale_edit_state_aside(db_session, tmp_path, monkeypatch):
    out = _output_dir(tmp_path, monkeypatch)
    (out / "06_Validation_edit.json").write_text('{"intents":[{"kind":"emptyPipeFluid"}]}', encoding="utf-8")
    (out / "edited").mkdir()
    (out / "edited" / "Design.bdf").write_text("EDITED", encoding="utf-8")
    client = _client(db_session, "OWNER01")

    before = client.get("/api/analysis/modelflow/edit-status", params={"output_dir": str(out)}).json()
    assert before["has_edited"] and before["has_edit_json"]

    r = client.post("/api/analysis/modelflow/discard-edit", json={"output_dir": str(out)})
    assert r.status_code == 200, r.text
    assert sorted(r.json()["moved"]) == ["06_Validation_edit.json", "edited"]

    after = client.get("/api/analysis/modelflow/edit-status", params={"output_dir": str(out)}).json()
    assert not after["has_edited"] and not after["has_edit_json"]
    # 지우지 않고 옮겨 둔다(되살릴 수 있어야 한다). 원본 BDF 는 그대로.
    kept = list((out / "_superseded").glob("*/edited/Design.bdf"))
    assert len(kept) == 1 and kept[0].read_text(encoding="utf-8") == "EDITED"
    assert (out / "Design.bdf").is_file()


def test_discard_edit_is_noop_without_edit_state(db_session, tmp_path, monkeypatch):
    out = _output_dir(tmp_path, monkeypatch)
    r = _client(db_session, "OWNER01").post("/api/analysis/modelflow/discard-edit", json={"output_dir": str(out)})
    assert r.status_code == 200
    assert r.json() == {"moved": [], "superseded_dir": None}
    assert not (out / "_superseded").exists()


def test_discard_edit_blocks_other_users_folder(db_session, tmp_path, monkeypatch):
    out = _output_dir(tmp_path, monkeypatch, owner="OWNER01")
    (out / "edited").mkdir()
    r = _client(db_session, "INTRUDER").post("/api/analysis/modelflow/discard-edit", json={"output_dir": str(out)})
    assert r.status_code in (403, 404)
    assert (out / "edited").is_dir()
