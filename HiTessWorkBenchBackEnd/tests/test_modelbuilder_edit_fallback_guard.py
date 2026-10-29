"""옛 엔진 + bridge 가 모르는 편집이 섞이면 fallback 하지 않는다(2026-10-28 기본 모델 편집 ②단계).

nastran_bridge 는 모르는 kind 를 경고만 남기고 건너뛴다. 서버 엔진이 옛 빌드인 채로 '요소 삭제 + COG RBE 삭제'
를 적용하면 예전 규칙(deleteRigid 가 있으면 bridge fallback)으로는 요소 삭제가 빠진 BDF 가 '성공' 으로 나갔다.
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
    calls = []
    monkeypatch.setattr(mf, "_apply_edit_with_nastran_bridge", lambda *a, **k: calls.append(a) or ({"edited_bdf_path": "x"}, "bridge"))
    return calls


def test_unknown_kind_blocks_bridge_fallback(tmp_path, old_engine):
    edit, exe = _write_edit(tmp_path, ["deleteRigid", "deleteElements"])
    status, log, _ = mf.apply_edit_intents(str(tmp_path), exe, edit)
    assert status == "Failed"
    assert "deleteElements" in log and "엔진을 새 빌드로 교체" in log
    assert old_engine == []          # bridge 를 부르지 않았다


def test_bridge_only_kinds_still_fall_back(tmp_path, old_engine):
    edit, exe = _write_edit(tmp_path, ["deleteRigid", "addRigid"])
    status, log, _ = mf.apply_edit_intents(str(tmp_path), exe, edit)
    assert status == "Success"
    assert len(old_engine) == 1
