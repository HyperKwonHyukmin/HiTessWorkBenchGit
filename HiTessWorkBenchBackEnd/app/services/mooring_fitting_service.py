"""Mooring Fitting Assessment 서비스 — CSV 2종 → MooringFitting.exe build-full 실행 + 산출물 수집."""
import logging
import os
import subprocess

from .analysis_runner import (
    get_backend_dir,
    mark_complete,
    mark_running,
    record_analysis,
    update_progress,
)

logger = logging.getLogger(__name__)

PROGRAM_NAME = "MooringFitting"
TIMEOUT_SECONDS = 600


def collect_artifacts(out_dir: str, work_dir: str) -> dict:
    """
    MooringFitting.exe 가 생성한 out/ 폴더 산출물을 분류·수집한다.

    핵심 5개(페이지 기본 노출):
        final_bdf, validation_json, lineage_json, report_mf_csv, report_winch_csv
    보조(Phase 2 뷰어용 펼치기 영역):
        stage_jsons, stage_bdfs, stage_verifications, raw_json, initial_json

        stage_jsons 는 STAGE_NN_<phase>.json 만 수집한다 — STAGE_NN.raw.json,
        STAGE_NN.initial.json, *.validation.json, *.bdf.verification.json 은
        별도 키로 분리되므로 제외한다.

    out/ 폴더 자체가 없으면 {_artifacts_missing: True, out_dir} 만 반환.
    """
    if not os.path.isdir(out_dir):
        return {
            "case_dir": work_dir,
            "out_dir": out_dir,
            "_artifacts_missing": True,
        }

    files = os.listdir(out_dir)
    file_set = set(files)

    def _pick(name: str) -> str | None:
        return os.path.join(out_dir, name) if name in file_set else None

    stage_jsons = sorted(
        os.path.join(out_dir, f) for f in files
        if f.startswith("STAGE_") and f.endswith(".json")
        and ".verification." not in f
        and not f.endswith(".raw.json")
        and not f.endswith(".initial.json")
        and not f.endswith(".validation.json")
    )
    stage_bdfs = sorted(
        os.path.join(out_dir, f) for f in files
        if f.startswith("STAGE_") and f.endswith(".bdf")
    )
    stage_verifications = sorted(
        os.path.join(out_dir, f) for f in files
        if f.endswith(".bdf.verification.json")
    )

    return {
        "case_dir": work_dir,
        "out_dir": out_dir,
        "final_bdf":         _pick("STAGE_07_FinalValidation.bdf"),
        "validation_json":   _pick("STAGE_07_FinalValidation.validation.json"),
        "lineage_json":      _pick("LINEAGE.json"),
        "report_mf_csv":     _pick("Report_LoadCalculation_MF.csv"),
        "report_winch_csv":  _pick("Report_LoadCalculation_Winch.csv"),
        "stage_jsons":          stage_jsons,
        "stage_bdfs":           stage_bdfs,
        "stage_verifications":  stage_verifications,
        "raw_json":             _pick("STAGE_00.raw.json"),
        "initial_json":         _pick("STAGE_00.initial.json"),
    }
