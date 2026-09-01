"""이중관 고유진동(Normal Mode) 해석 — Run_ModalAnalysis.exe 연동 회귀 테스트.

Abaqus 가 없는 개발 PC 에서도 검증 가능한 범위를 덮는다:
CLI 인자 규약, 옵션 검증, 결과 txt 파싱, PSA 와의 Abaqus 라이센스 공유, 로그 인코딩 선택.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.services import doublepipe_psa_service as service


@pytest.fixture(autouse=True)
def _isolated_job_state():
    with service._jobs_lock:
        service._jobs.clear()
        service._active_job_id = None
    yield
    with service._jobs_lock:
        service._jobs.clear()
        service._active_job_id = None


class _DeferredThread:
    """스레드를 실제로 띄우지 않고 _launch_job 의 등록 결과만 관찰한다."""

    def __init__(self, *args, **kwargs):
        self.args = kwargs.get("args", ())

    def start(self):
        return None


def _stub_launch(monkeypatch, tmp_path):
    """exe 존재/DB 기록/스레드를 대체해 _launch_job 을 순수 검증 가능하게 만든다."""
    exe = tmp_path / "Run_ModalAnalysis.exe"
    exe.write_bytes(b"MZ")
    monkeypatch.setattr(service, "_resolve_modal_exe", lambda: str(exe))
    monkeypatch.setattr(service, "_record_psa_analysis", lambda job: None)
    monkeypatch.setattr(service.threading, "Thread", _DeferredThread)
    return exe


def _write_csv(tmp_path):
    csv_path = tmp_path / "pipe.csv"
    csv_path.write_text("id,type\n1,TUBI\n", encoding="utf-8")
    return csv_path


# ── CLI 인자 규약 ────────────────────────────────────────────────────────────

def test_modal_command_always_passes_no_viewer_and_options(monkeypatch, tmp_path):
    """--no-viewer 가 빠지면 exe 가 streamlit 뷰어를 띄워 프로세스가 끝나지 않는다."""
    exe = _stub_launch(monkeypatch, tmp_path)
    csv_path = _write_csv(tmp_path)

    result = service._launch_job(
        str(csv_path), "E001", kind="modal", modal_opts=(8, 2.5),
    )
    job = service.get_psa_job(result["jobId"])

    assert job["kind"] == "modal"
    # 표시용 command 문자열은 공백이 든 토큰만 따옴표로 감싼다(경로에 공백이 없으면 그대로).
    assert job["command"] == f"{exe} {csv_path} --no-viewer --modes 8 --min-freq 2.5"
    # 고유진동 해석은 xlsx 보고서를 만들지 않는다.
    assert job["reportPath"] is None
    assert job["modalModes"] == 8
    assert job["modalMinFreq"] == 2.5


def test_psa_command_is_unchanged_by_modal_support(monkeypatch, tmp_path):
    """kind 도입이 기존 PSA 인자 규약을 건드리지 않아야 한다."""
    exe = tmp_path / "PSA_AllLoadCases.exe"
    exe.write_bytes(b"MZ")
    monkeypatch.setattr(service, "_resolve_psa_exe", lambda: str(exe))
    monkeypatch.setattr(service, "_record_psa_analysis", lambda job: None)
    monkeypatch.setattr(service.threading, "Thread", _DeferredThread)
    csv_path = _write_csv(tmp_path)

    result = service._launch_job(str(csv_path), "E001", load_cases=["L17", "L18"])
    job = service.get_psa_job(result["jobId"])

    assert job["kind"] == "psa"
    assert job["command"] == f"{exe} {csv_path} --load-cases L17,L18"
    assert job["reportPath"].endswith(service._REPORT_NAME)


# ── 옵션 검증 ────────────────────────────────────────────────────────────────

def test_modal_options_default_to_engine_defaults():
    assert service._normalize_modal_options(None, None) == (
        service._MODAL_DEFAULT_MODES,
        service._MODAL_DEFAULT_MIN_FREQ,
    )
    # 멀티파트 폼의 빈 문자열도 '미지정'으로 취급한다.
    assert service._normalize_modal_options("", "") == (10, 1.0)


@pytest.mark.parametrize(
    "modes, min_freq",
    [
        (0, None),          # 모드 개수 하한 미만
        (51, None),         # 상한 초과
        ("abc", None),      # 숫자 아님
        (None, -1),         # 음수 진동수
        (None, "x"),        # 숫자 아님
    ],
)
def test_modal_options_reject_out_of_range(modes, min_freq):
    with pytest.raises(HTTPException) as exc:
        service._normalize_modal_options(modes, min_freq)
    assert exc.value.status_code == 400


# ── 결과 파싱 ────────────────────────────────────────────────────────────────

def test_collect_modal_result_parses_frequencies(tmp_path):
    """SaveNaturalFrequencies 가 쓰는 실제 형식을 그대로 파싱해야 한다."""
    csv_path = tmp_path / "pipe.csv"
    csv_path.write_text("x", encoding="utf-8")
    (tmp_path / "pipe_Modal_NaturalFrequencies.txt").write_text(
        "Natural Frequency Result (>= 1.0 Hz, max 10 modes)\n"
        "MODE NO      FREQUENCY (Hz)\n"
        "      1      12.3456\n"
        "      2      18.9012\n",
        encoding="utf-8",
    )
    (tmp_path / "pipe_Modal_ModeShapeData.json").write_text("{}", encoding="utf-8")

    collected = service._collect_modal_result(str(tmp_path), ["exe", str(csv_path)])

    assert collected["modes"] == [
        {"modeNo": 1, "freqHz": 12.3456},
        {"modeNo": 2, "freqHz": 18.9012},
    ]
    assert collected["resultPath"].endswith("pipe_Modal_NaturalFrequencies.txt")
    assert collected["shapeDataPath"].endswith("pipe_Modal_ModeShapeData.json")
    assert collected["shapeImageDir"] is None   # 이미지 폴더는 없다


def test_collect_modal_result_returns_none_without_result_file(tmp_path):
    csv_path = tmp_path / "pipe.csv"
    csv_path.write_text("x", encoding="utf-8")
    assert service._collect_modal_result(str(tmp_path), ["exe", str(csv_path)]) is None


def test_finish_publishes_modal_result_on_job(monkeypatch, tmp_path):
    _stub_launch(monkeypatch, tmp_path)
    csv_path = _write_csv(tmp_path)
    job_id = service._launch_job(str(csv_path), "E001", kind="modal")["jobId"]

    service._finish(
        job_id,
        status="done",
        returncode=0,
        report_ready=True,
        modal_result={
            "resultPath": "C:/x/pipe_Modal_NaturalFrequencies.txt",
            "modes": [{"modeNo": 1, "freqHz": 9.5}],
            "shapeDataPath": None,
            "shapeImageDir": None,
        },
    )

    job = service.get_psa_job(job_id)
    assert job["status"] == "done"
    assert job["modes"] == [{"modeNo": 1, "freqHz": 9.5}]
    assert job["resultPath"].endswith("pipe_Modal_NaturalFrequencies.txt")


# ── Abaqus 라이센스 공유 ──────────────────────────────────────────────────────

def test_modal_and_psa_share_the_single_abaqus_licence(monkeypatch, tmp_path):
    """Abaqus 는 서버 1대 = 라이센스 1개다. 두 해석이 동시에 돌면 안 된다."""
    _stub_launch(monkeypatch, tmp_path)
    psa_exe = tmp_path / "PSA_AllLoadCases.exe"
    psa_exe.write_bytes(b"MZ")
    monkeypatch.setattr(service, "_resolve_psa_exe", lambda: str(psa_exe))
    csv_path = _write_csv(tmp_path)

    service._launch_job(str(csv_path), "E001", kind="modal")

    with pytest.raises(HTTPException) as exc:
        service._ensure_license_available()
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "license_busy"

    # 반대 방향(PSA 점유 중 고유진동 요청)도 같은 슬롯에서 막힌다.
    with service._jobs_lock:
        service._jobs[service._active_job_id]["kind"] = "psa"
    with pytest.raises(HTTPException) as exc2:
        service._ensure_license_available()
    assert exc2.value.status_code == 409


def test_active_status_exposes_job_kind(monkeypatch, tmp_path):
    """프론트가 재연결 시 어느 탭으로 복귀할지 판정하는 데 쓴다."""
    _stub_launch(monkeypatch, tmp_path)
    csv_path = _write_csv(tmp_path)
    service._launch_job(str(csv_path), "E001", kind="modal")

    assert service.get_active_status()["kind"] == "modal"


# ── 로그 인코딩 ──────────────────────────────────────────────────────────────

def test_child_output_encoding_differs_per_program():
    """PSA 는 어댑터 console shim 이 stdout 을 UTF-8 로 고정하지만,
    Run_ModalAnalysis.exe 는 그 shim 이 없어 콘솔 로케일(cp949)로 쓴다 — 읽는 쪽을 맞춰야
    한글 로그가 깨지지 않는다. PYTHONIOENCODING 은 PyInstaller 가 무시해 쓸 수 없다."""
    import locale

    assert service._child_output_encoding("psa") == "utf-8"
    assert service._child_output_encoding("modal") == (
        locale.getpreferredencoding(False) or "utf-8"
    )


def test_modal_encoding_crash_reports_abaqus_not_found_when_launcher_missing(monkeypatch, tmp_path):
    """abaqus 가 없어서 죽은 경우, 인코딩 오류로 원인이 지워져도 진짜 원인을 말해야 한다."""
    _stub_launch(monkeypatch, tmp_path)
    csv_path = _write_csv(tmp_path)
    job_id = service._launch_job(str(csv_path), "E001", kind="modal")["jobId"]

    with service._jobs_lock:
        job = service._jobs[job_id]
        job["_abaqusResolved"] = False          # 실행 직전 abaqus 를 찾지 못했다
        job["logs"].append("UnicodeEncodeError: 'cp949' codec can't encode character")

    service._finish(job_id, status="failed", returncode=1)

    assert service.get_psa_job(job_id)["diagnostic"] == "abaqus_not_found"


def test_modal_encoding_crash_kept_when_abaqus_was_available(monkeypatch, tmp_path):
    """abaqus 는 찾았는데도 인코딩으로 죽었다면 그건 별개의 콘솔 인코딩 문제다."""
    _stub_launch(monkeypatch, tmp_path)
    csv_path = _write_csv(tmp_path)
    job_id = service._launch_job(str(csv_path), "E001", kind="modal")["jobId"]

    with service._jobs_lock:
        job = service._jobs[job_id]
        job["_abaqusResolved"] = True
        job["logs"].append("UnicodeEncodeError: 'cp949' codec can't encode character")

    service._finish(job_id, status="failed", returncode=1)

    assert service.get_psa_job(job_id)["diagnostic"] == "modal_console_encoding"
