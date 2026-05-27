"""collect_artifacts() — MooringFitting out/ 폴더 산출물 수집 동작."""
import os

import pytest

from app.services.mooring_fitting_service import collect_artifacts


def _touch(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("{}")


def test_collect_artifacts_missing_out_dir(tmp_path):
    """out/ 폴더 자체가 없으면 _artifacts_missing=True 만 표시."""
    work_dir = str(tmp_path)
    out_dir = os.path.join(work_dir, "out")
    result = collect_artifacts(out_dir, work_dir)
    assert result["_artifacts_missing"] is True
    assert result["out_dir"] == out_dir


def test_collect_artifacts_full_case(tmp_path):
    """8단계 산출물 + 핵심 5개 + LINEAGE/Report 가 모두 있으면 분류해서 반환."""
    work_dir = str(tmp_path)
    out_dir = os.path.join(work_dir, "out")
    # STAGE 00 ~ 07 산출물 (json + bdf + bdf.verification.json) — 모의 빈 파일
    stages = [
        ("STAGE_00_BuildRaw",          "STAGE_00.raw.json"),
        ("STAGE_01_CollinearOverlap",  None),
        ("STAGE_02_ElementSplit",      None),
        ("STAGE_03_DuplicatePolicy",   None),
        ("STAGE_04_Connectivity",      None),
        ("STAGE_05_MeshRefinement",    None),
        ("STAGE_06_LoadGen",           None),
        ("STAGE_07_FinalValidation",   "STAGE_07_FinalValidation.validation.json"),
    ]
    for stem, extra in stages:
        _touch(os.path.join(out_dir, f"{stem}.json"))
        _touch(os.path.join(out_dir, f"{stem}.bdf"))
        _touch(os.path.join(out_dir, f"{stem}.bdf.verification.json"))
        if extra:
            _touch(os.path.join(out_dir, extra))
    _touch(os.path.join(out_dir, "STAGE_00.initial.json"))
    _touch(os.path.join(out_dir, "LINEAGE.json"))
    _touch(os.path.join(out_dir, "Report_LoadCalculation_MF.csv"))
    _touch(os.path.join(out_dir, "Report_LoadCalculation_Winch.csv"))

    result = collect_artifacts(out_dir, work_dir)

    # 부재 flag 없어야 한다
    assert "_artifacts_missing" not in result
    # 핵심 5개
    assert result["final_bdf"].endswith("STAGE_07_FinalValidation.bdf")
    assert result["validation_json"].endswith("STAGE_07_FinalValidation.validation.json")
    assert result["lineage_json"].endswith("LINEAGE.json")
    assert result["report_mf_csv"].endswith("Report_LoadCalculation_MF.csv")
    assert result["report_winch_csv"].endswith("Report_LoadCalculation_Winch.csv")
    # 보조 — stage_jsons 는 8개 STAGE_NN_*.json (verification 제외, raw/initial 별도)
    assert len(result["stage_jsons"]) == 8
    assert all(p.endswith(".json") and ".verification." not in p for p in result["stage_jsons"])
    assert len(result["stage_bdfs"]) == 8
    assert len(result["stage_verifications"]) == 8
    assert result["raw_json"].endswith("STAGE_00.raw.json")
    assert result["initial_json"].endswith("STAGE_00.initial.json")


def test_collect_artifacts_partial(tmp_path):
    """일부 산출물만 있으면 핵심 키는 None, stage 리스트는 존재하는 것만."""
    work_dir = str(tmp_path)
    out_dir = os.path.join(work_dir, "out")
    _touch(os.path.join(out_dir, "STAGE_00_BuildRaw.json"))
    _touch(os.path.join(out_dir, "STAGE_00_BuildRaw.bdf"))
    # STAGE_07 등 핵심 파일 없음

    result = collect_artifacts(out_dir, work_dir)
    assert result["final_bdf"] is None
    assert result["validation_json"] is None
    assert result["lineage_json"] is None
    assert result["report_mf_csv"] is None
    assert result["report_winch_csv"] is None
    assert len(result["stage_jsons"]) == 1
    assert len(result["stage_bdfs"]) == 1
    assert result["stage_verifications"] == []
