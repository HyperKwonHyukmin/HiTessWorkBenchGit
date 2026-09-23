"""서비스가 subprocess 를 부르기 전에 취소 사전 체크를 하는지 정적 검사.

각 서비스 파일에 아래 두 문자열이 함께 있는지만 확인한다(구현 형태는 서비스별로 다르다):
  - "is_cancel_requested" 참조
  - "subprocess.run" 또는 "run_subprocess_killtree" 참조
동시에 등장하면 사전 체크가 있다고 본다.

Popen 서비스는 `register_process` 를 부르는지도 확인한다.

정적 검사만으로는 "job_id 가 없을 때 오작동하지 않는가" 를 못 잡으므로, 파일 끝에
사전 체크 헬퍼의 실제 동작(취소 요청 시 차단 / job_id 없으면 항상 통과)을 함께 검증한다.
"""
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent / "app" / "services"

SUBPROCESS_GATE_SERVICES = [
    "unit_structural_service.py",
    "module_ocean_structural_service.py",
    "groupmoduleunit_service.py",
    "plate_structure_service.py",
    "modelbuilder_solve_service.py",
    "hitess_modelflow_service.py",
    "module_stability_service.py",
    "bdfscanner_service.py",
    "hpscr_service.py",
    # drawing_to_analysis_service 는 2,400줄이라 파일 단위 가드에서 제외(spec §1.4 마지막 문단)
]

POPEN_REGISTER_SERVICES = [
    "analysis_runner.py",
    "mooring_fitting_service.py",
    "doublepipe_psa_service.py",
]


@pytest.mark.parametrize("service", SUBPROCESS_GATE_SERVICES)
def test_service_calls_is_cancel_requested(service):
    src = (BACKEND / service).read_text(encoding="utf-8")
    assert "is_cancel_requested" in src, (
        f"{service} 에 취소 사전 체크가 없다. "
        "각 subprocess.run 앞에 job_manager.job_status_store.is_cancel_requested(job_id) 를 추가하라."
    )
    assert ("subprocess.run" in src) or ("run_subprocess_killtree" in src), (
        f"{service} 가 더 이상 subprocess 를 부르지 않는다면 이 가드 목록에서 빼라."
    )


@pytest.mark.parametrize("service", POPEN_REGISTER_SERVICES)
def test_popen_service_calls_register_process(service):
    src = (BACKEND / service).read_text(encoding="utf-8")
    assert "register_process" in src, (
        f"{service} 의 Popen 생성 직후 job_status_store.register_process 를 부르지 않는다."
    )


# ── 사전 체크 헬퍼의 실제 동작 ────────────────────────────────────────────

def test_cancel_gate_blocks_only_when_cancel_requested():
    """가드 헬퍼는 취소 요청된 job_id 에만 True 를 돌려준다."""
    from app.services import job_manager

    store = job_manager.job_status_store
    try:
        assert store.is_cancel_requested("guard-job-1") is False
        store.cancel_requested.add("guard-job-1")
        assert store.is_cancel_requested("guard-job-1") is True
        # 다른 job 은 영향을 받지 않는다.
        assert store.is_cancel_requested("guard-job-2") is False
    finally:
        store.cancel_requested.discard("guard-job-1")


def test_cancel_gate_is_false_without_job_id():
    """job_id 가 없는 레거시·내부 단계 호출에서는 절대 차단되면 안 된다."""
    from app.services import job_manager

    assert job_manager.job_status_store.is_cancel_requested(None) is False
    assert job_manager.job_status_store.is_cancel_requested("") is False
    # worker 컨텍스트 밖에서는 current_job_id() 가 None 이라 폴백도 안전하다.
    assert job_manager.current_job_id() is None
