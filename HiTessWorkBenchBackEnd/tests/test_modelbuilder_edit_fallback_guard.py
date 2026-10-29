"""옛 엔진이 편집을 모르면 실패하고 교체를 안내한다 — MB 경로 bridge fallback 제거(2026-10-29).

예전엔 옛 엔진이 deleteRigid·addNode 를 몰라 exit 65 를 내면 nastran_bridge 가 전체 편집을 대신 적용했다.
145 엔진 교체 후 fallback 을 걷어냈다 — 이제 어떤 kind 든 편집 BDF 를 만들지 않고 실패한다.
"""
import json
import subprocess
from types import SimpleNamespace

import pytest

from app.services import hitess_modelflow_service as mf


def _write_edit(tmp_path, kinds):
    path = tmp_path / "06_Validation_edit.json"
    path.write_text(json.dumps({"schemaVersion": "1.0", "intents": [{"id": k, "kind": k, "params": {}} for k in kinds]}),
                    encoding="utf-8")
    exe = tmp_path / "Cmb.Cli.exe"
    exe.write_bytes(b"")
    return str(path), str(exe)


@pytest.fixture()
def old_engine(monkeypatch):
    """옛 엔진 흉내 — 모르는 kind 라 exit 65."""
    def fake_run(cmd, **kwargs):
        return SimpleNamespace(returncode=65, stdout=b"", stderr="[오류] apply failed: unsupported intent kind: x".encode("utf-8"))
    monkeypatch.setattr(subprocess, "run", fake_run)


@pytest.mark.parametrize("kinds", [["deleteRigid", "addRigid"], ["deleteRigid", "deleteElements"]])
def test_old_engine_fails_with_replace_notice(tmp_path, old_engine, kinds):
    edit, exe = _write_edit(tmp_path, kinds)
    status, log, edited = mf.apply_edit_intents(str(tmp_path), exe, edit)
    assert status == "Failed"
    assert "엔진을 새 빌드로 교체" in log
    assert edited == {}
    assert not (tmp_path / "edited").exists()      # bridge 로 대신 만들지 않았다


def test_other_engine_failure_has_no_replace_notice(tmp_path, monkeypatch):
    monkeypatch.setattr(subprocess, "run", lambda cmd, **kw: SimpleNamespace(returncode=65, stdout=b"", stderr=b"[error] node 5 missing"))
    edit, exe = _write_edit(tmp_path, ["addRigid"])
    status, log, _ = mf.apply_edit_intents(str(tmp_path), exe, edit)
    assert status == "Failed"
    assert "[Exit code: 65]" in log and "교체" not in log
