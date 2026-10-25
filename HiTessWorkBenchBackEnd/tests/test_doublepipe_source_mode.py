"""이중관 PSA 소스 직접 실행 모드 테스트.

엔진 개발자가 엔진 폴더의 .py 만 고치면 다음 해석부터 반영돼야 한다:
  * 어댑터 runtime 이 실행 때 엔진 사본을 만들고 patches.py 를 적용한다(엔진이 안 바뀌면 캐시).
  * 백엔드는 DOUBLEPIPE_PSA_PYTHON 이 있으면 exe 대신 python 으로 어댑터를 실행한다.
"""
import os
import shutil
import sys

import pytest
from fastapi import HTTPException

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ADAPTER_ROOT = os.path.join(_BACKEND_DIR, "InHouseAdapters", "doublepipe_psa")
if _ADAPTER_ROOT not in sys.path:
    sys.path.insert(0, _ADAPTER_ROOT)

from hitess_adapter import engine, patches, runtime  # noqa: E402
from app.services import doublepipe_psa_service as service  # noqa: E402


# ---------------------------------------------------------------------------
# 어댑터 runtime — 실행 시점 엔진 사본 + 패치
# ---------------------------------------------------------------------------
@pytest.fixture
def engine_copy(tmp_path):
    """실제 엔진 폴더의 사본(원본은 건드리지 않는다). 엔진이 없는 PC 에서는 건너뛴다."""
    source = engine.default_engine_dir()
    if not os.path.isdir(source):
        pytest.skip("엔진 폴더(InHouseProgram, git 미추적)가 없는 PC")
    target = tmp_path / "engine"
    shutil.copytree(source, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    return target


@pytest.fixture
def restore_engine_env():
    # prepare_engine 이 os.environ 에 직접 쓰므로 monkeypatch 로는 원복이 기록되지 않는다.
    saved = os.environ.pop(engine.ENGINE_DIR_ENV, None)
    yield
    os.environ.pop(engine.ENGINE_DIR_ENV, None)
    if saved is not None:
        os.environ[engine.ENGINE_DIR_ENV] = saved


def test_prepare_engine_applies_patches_and_points_loader(engine_copy, tmp_path, restore_engine_env):
    staged = runtime.prepare_engine(str(engine_copy), str(tmp_path / "runtime"))

    assert os.environ[engine.ENGINE_DIR_ENV] == staged
    for patch in patches.PATCHES:
        with open(os.path.join(staged, patch.file), encoding="utf-8") as handle:
            assert patch.replace in handle.read()
    # 원본 엔진은 무수정
    for patch in patches.PATCHES:
        with open(engine_copy / patch.file, encoding="utf-8") as handle:
            assert patch.anchor in handle.read() or patch.replace in handle.read()


def test_prepare_engine_reuses_cache_until_engine_changes(engine_copy, tmp_path, restore_engine_env):
    root = tmp_path / "runtime"
    first = runtime.prepare_engine(str(engine_copy), str(root))
    assert runtime.prepare_engine(str(engine_copy), str(root)) == first

    # 엔진 개발자가 .py 를 고친 상황
    main_py = engine_copy / "Main.py"
    main_py.write_text(main_py.read_text(encoding="utf-8") + "\n# edited\n", encoding="utf-8")
    second = runtime.prepare_engine(str(engine_copy), str(root))

    assert second != first
    assert (open(os.path.join(second, "Main.py"), encoding="utf-8").read()).endswith("# edited\n")
    assert sorted(os.listdir(root)) == [os.path.basename(second)]  # 이전 사본 정리


def test_prepare_engine_fails_loudly_on_patch_mismatch(engine_copy, tmp_path, restore_engine_env):
    patch = patches.PATCHES[0]
    target = engine_copy / patch.file
    text = target.read_text(encoding="utf-8")
    target.write_text(text.replace(patch.anchor, "# 연구원이 다르게 고침").replace(patch.replace, ""),
                      encoding="utf-8")

    with pytest.raises(patches.PatchError):
        runtime.prepare_engine(str(engine_copy), str(tmp_path / "runtime"))
    assert engine.ENGINE_DIR_ENV not in os.environ


# ---------------------------------------------------------------------------
# 백엔드 — DOUBLEPIPE_PSA_PYTHON 스위치
# ---------------------------------------------------------------------------
class _DeferredThread:
    def __init__(self, *args, **kwargs):
        pass

    def start(self):
        pass


@pytest.fixture
def launch_env(monkeypatch, tmp_path):
    with service._jobs_lock:
        service._jobs.clear()
        service._active_job_id = None
    psa_dir = tmp_path / "psa-program"
    psa_dir.mkdir()
    (psa_dir / service._PSA_EXE_NAME).write_bytes(b"exe")
    monkeypatch.setattr(service, "_PSA_DIR", str(psa_dir))
    monkeypatch.setattr(service.threading, "Thread", _DeferredThread)
    monkeypatch.setattr(service, "_record_psa_analysis", lambda job: None)
    csv_path = tmp_path / "pipe.csv"
    csv_path.write_text("id,type\n1,TUBI\n", encoding="utf-8")
    yield csv_path
    with service._jobs_lock:
        service._jobs.clear()
        service._active_job_id = None


def test_exe_mode_when_switch_absent(monkeypatch, launch_env):
    monkeypatch.delenv(service._PSA_PYTHON_ENV, raising=False)

    launched = service._launch_job(str(launch_env), "E100", load_cases=["L1"])

    job = service._jobs[launched["jobId"]]
    assert job["sourceMode"] is False
    assert service._PSA_EXE_NAME in job["command"]


def test_source_mode_runs_adapter_with_python(monkeypatch, launch_env, tmp_path):
    python = tmp_path / "python.exe"
    python.write_bytes(b"")
    monkeypatch.setenv(service._PSA_PYTHON_ENV, str(python))

    launched = service._launch_job(str(launch_env), "E100", load_cases=["L1", "L2"])

    job = service._jobs[launched["jobId"]]
    assert job["sourceMode"] is True
    assert service._PSA_EXE_NAME not in job["command"]
    assert "psa_entry.py" in job["command"] and "-u" in job["command"]
    assert job["command"].endswith("--load-cases L1,L2")


def test_source_mode_missing_python_is_503_not_silent_exe(monkeypatch, launch_env, tmp_path):
    monkeypatch.setenv(service._PSA_PYTHON_ENV, str(tmp_path / "nope" / "python.exe"))

    with pytest.raises(HTTPException) as info:
        service._launch_job(str(launch_env), "E100")
    assert info.value.status_code == 503
    assert service._jobs == {}
