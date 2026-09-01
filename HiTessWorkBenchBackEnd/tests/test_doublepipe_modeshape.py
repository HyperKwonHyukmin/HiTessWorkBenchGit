"""Mode Shape 뷰어(Streamlit) 온디맨드 기동 서비스 테스트.

프로세스를 띄우는 코드이므로 '언제 띄우지 않는가'를 특히 단단히 고정한다.
실제 spawn 은 하지 않는다 — Popen 을 대체해 호출 여부만 관찰한다.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.services import doublepipe_modeshape_service as ms


@pytest.fixture(autouse=True)
def _reset_state():
    def _clear():
        with ms._lock:
            ms._process = None
            ms._last_start_at = 0.0
            ms._loaded_json = None
    _clear()
    yield
    _clear()


class _SpawnSpy:
    """Popen 대체 — 호출 인자를 기록하고 '살아있는 프로세스'인 척한다."""

    def __init__(self):
        self.calls = []

    def __call__(self, args, **kwargs):
        self.calls.append((args, kwargs))
        return self

    def poll(self):
        return None          # 아직 실행 중

    pid = 4242


def _stub_viewer(monkeypatch, tmp_path, *, port_open=False, port=8501):
    exe = tmp_path / ms._VIEWER_EXE_NAME
    exe.write_bytes(b"MZ")
    monkeypatch.setattr(ms, "_resolve_viewer", lambda: (str(exe), str(tmp_path)))
    monkeypatch.setattr(ms, "_configured_port", lambda _d: port)
    monkeypatch.setattr(ms, "_port_is_open", lambda _p: port_open)
    spy = _SpawnSpy()
    monkeypatch.setattr(ms.subprocess, "Popen", spy)
    return spy


# ── exe 부재 ────────────────────────────────────────────────────────────────

def test_status_reports_unavailable_when_exe_missing(monkeypatch):
    monkeypatch.setattr(ms, "_resolve_viewer", lambda: None)
    status = ms.get_status()
    assert status["available"] is False
    assert status["running"] is False
    assert ms._VIEWER_EXE_NAME in status["detail"]


def test_start_raises_503_when_exe_missing(monkeypatch):
    monkeypatch.setattr(ms, "_resolve_viewer", lambda: None)
    with pytest.raises(HTTPException) as exc:
        ms.start_viewer()
    assert exc.value.status_code == 503


# ── 중복 기동 방지 ──────────────────────────────────────────────────────────

def test_start_does_not_spawn_when_port_already_open(monkeypatch, tmp_path):
    """사람이 손으로 띄워 둔 인스턴스가 있으면 건드리지 않는다."""
    spy = _stub_viewer(monkeypatch, tmp_path, port_open=True)
    result = ms.start_viewer()
    assert result["running"] is True
    assert spy.calls == []          # spawn 하지 않았다


def test_second_start_while_booting_does_not_spawn_again(monkeypatch, tmp_path):
    """기동 중 재요청 — 두 번 띄우면 Streamlit 이 'Port is already in use' 로 죽는다."""
    spy = _stub_viewer(monkeypatch, tmp_path, port_open=False)

    first = ms.start_viewer()
    assert first["starting"] is True
    assert len(spy.calls) == 1

    second = ms.start_viewer()
    assert second["starting"] is True
    assert len(spy.calls) == 1      # 여전히 1회


# ── 기동 인자 ───────────────────────────────────────────────────────────────

def test_spawn_uses_viewer_dir_as_cwd_and_never_pipes_stdout(monkeypatch, tmp_path):
    """cwd 를 안 주면 Streamlit 이 .streamlit/config.toml 을 못 읽어 0.0.0.0 바인드가 풀린다.
    stdout 을 PIPE 로 물면 버퍼가 차서 뷰어가 멈춘다."""
    spy = _stub_viewer(monkeypatch, tmp_path, port_open=False)
    ms.start_viewer()

    args, kwargs = spy.calls[0]
    assert args == [str(tmp_path / ms._VIEWER_EXE_NAME)]
    assert kwargs["cwd"] == str(tmp_path)
    assert kwargs["stdout"] is not ms.subprocess.PIPE
    assert kwargs["stderr"] is ms.subprocess.STDOUT
    assert kwargs["stdin"] is ms.subprocess.DEVNULL


# ── 포트 ────────────────────────────────────────────────────────────────────

def test_configured_port_follows_streamlit_config(tmp_path):
    """연구원이 config.toml 의 포트를 바꾸면 백엔드/프론트가 따라가야 한다."""
    cfg_dir = tmp_path / ".streamlit"
    cfg_dir.mkdir()
    (cfg_dir / "config.toml").write_text(
        "[server]\nheadless = true\naddress = \"0.0.0.0\"\nport = 8899\n", encoding="utf-8",
    )
    assert ms._configured_port(str(tmp_path)) == 8899


def test_configured_port_falls_back_without_config(tmp_path):
    assert ms._configured_port(str(tmp_path)) == ms._DEFAULT_PORT


# ── 결과 JSON 자동 로드 ─────────────────────────────────────────────────────

def _job_json(monkeypatch, tmp_path, name):
    """userConnection 하위로 인정되는 결과 JSON 을 만든다(경로 검증 통과용)."""
    root = tmp_path / "userConnection" / "job"
    root.mkdir(parents=True, exist_ok=True)
    path = root / name
    path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(ms, "_BACKEND_DIR", str(tmp_path))
    return str(path)


def test_start_passes_json_path_as_launch_argument(monkeypatch, tmp_path):
    """뷰어는 sys.argv[1] 을 결과 JSON 으로 읽는다 — 인자로 넘겨야 자동으로 열린다."""
    spy = _stub_viewer(monkeypatch, tmp_path, port_open=False)
    json_path = _job_json(monkeypatch, tmp_path, "A_Modal_ModeShapeData.json")

    ms.start_viewer(json_path)

    args, _kwargs = spy.calls[0]
    assert args == [str(tmp_path / ms._VIEWER_EXE_NAME), json_path]


def test_same_json_does_not_restart_the_viewer(monkeypatch, tmp_path):
    """이미 그 결과가 열려 있으면 건드리지 않는다(재기동은 10~30초 낭비다)."""
    spy = _stub_viewer(monkeypatch, tmp_path, port_open=True)
    json_path = _job_json(monkeypatch, tmp_path, "A_Modal_ModeShapeData.json")
    with ms._lock:
        ms._loaded_json = json_path

    result = ms.start_viewer(json_path)

    assert result["matches"] is True
    assert spy.calls == []


def test_different_json_restarts_the_viewer(monkeypatch, tmp_path):
    """인자는 기동 시점에만 정해지므로, 다른 결과를 열려면 재기동뿐이다."""
    spy = _stub_viewer(monkeypatch, tmp_path, port_open=True)
    stopped = []
    monkeypatch.setattr(ms, "_stop_running_viewer", lambda exe: stopped.append(exe))
    old = _job_json(monkeypatch, tmp_path, "A_Modal_ModeShapeData.json")
    new = _job_json(monkeypatch, tmp_path, "B_Modal_ModeShapeData.json")
    with ms._lock:
        ms._loaded_json = old

    result = ms.start_viewer(new)

    assert stopped == [str(tmp_path / ms._VIEWER_EXE_NAME)]
    assert spy.calls[0][0] == [str(tmp_path / ms._VIEWER_EXE_NAME), new]
    assert result["loadedJson"] == new
    assert result["matches"] is False       # 아직 기동 중


def test_status_matches_only_for_the_requested_result(monkeypatch, tmp_path):
    """단순히 '떠 있음'으로 준비 완료를 판정하면 이전 결과가 잠깐 보인다."""
    _stub_viewer(monkeypatch, tmp_path, port_open=True)
    a = _job_json(monkeypatch, tmp_path, "A_Modal_ModeShapeData.json")
    b = _job_json(monkeypatch, tmp_path, "B_Modal_ModeShapeData.json")
    with ms._lock:
        ms._loaded_json = a

    assert ms.get_status(a)["matches"] is True
    assert ms.get_status(b)["matches"] is False
    assert ms.get_status(None)["matches"] is True   # 안 물어보면 떠 있으면 OK


# ── 경로 검증 ───────────────────────────────────────────────────────────────

def test_json_path_outside_userconnection_is_rejected(monkeypatch, tmp_path):
    """뷰어에 넘기는 인자다 — 임의 경로를 열어주면 안 된다."""
    _stub_viewer(monkeypatch, tmp_path, port_open=False)
    monkeypatch.setattr(ms, "_BACKEND_DIR", str(tmp_path))
    outside = tmp_path / "secret.json"
    outside.write_text("{}", encoding="utf-8")

    with pytest.raises(HTTPException) as exc:
        ms.start_viewer(str(outside))
    assert exc.value.status_code == 400


def test_missing_json_file_is_rejected(monkeypatch, tmp_path):
    _stub_viewer(monkeypatch, tmp_path, port_open=False)
    monkeypatch.setattr(ms, "_BACKEND_DIR", str(tmp_path))
    missing = tmp_path / "userConnection" / "job" / "nope.json"

    with pytest.raises(HTTPException) as exc:
        ms.start_viewer(str(missing))
    assert exc.value.status_code == 404
