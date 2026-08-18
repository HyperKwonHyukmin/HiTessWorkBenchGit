"""payload 수집 — 결과 파일 로드와 경로 경계."""
import json
import os

from app import models
from app.services.report.payload import collect_payload


def _record(**kwargs) -> models.Analysis:
    defaults = {
        "employee_id": "EMP001",
        "program_name": "Column Buckling Load Calculator",
        "project_name": "p",
        "status": "Success",
        "input_info": {"length_mm": 3000},
        "result_info": {"maxWorkingLoadTon": 12.5},
    }
    defaults.update(kwargs)
    return models.Analysis(**defaults)


def test_collects_input_and_result_without_output_file():
    payload = collect_payload(_record(), user_connection_base="/base")
    assert payload["input"] == {"length_mm": 3000}
    assert payload["result"] == {"maxWorkingLoadTon": 12.5}
    assert payload["output"] is None


def test_loads_output_json_inside_user_connection(tmp_path):
    base = tmp_path / "userConnection"
    job = base / "20260818_EMP001_ColumnBuckling"
    job.mkdir(parents=True)
    out = job / "result.json"
    out.write_text(json.dumps({"result": {"assessment": 0.82}}), encoding="utf-8")

    record = _record(result_info={"output_json": str(out)})
    payload = collect_payload(record, user_connection_base=str(base))

    assert payload["output"] == {"result": {"assessment": 0.82}}


def test_skips_output_json_outside_user_connection(tmp_path):
    base = tmp_path / "userConnection"
    base.mkdir()
    outside = tmp_path / "secret.json"
    outside.write_text(json.dumps({"leak": True}), encoding="utf-8")

    record = _record(result_info={"output_json": str(outside)})
    payload = collect_payload(record, user_connection_base=str(base))

    assert payload["output"] is None


def test_missing_output_file_does_not_raise(tmp_path):
    base = tmp_path / "userConnection"
    base.mkdir()
    record = _record(result_info={"output_json": str(base / "gone.json")})

    payload = collect_payload(record, user_connection_base=str(base))

    assert payload["output"] is None


def test_null_json_columns_become_empty_dicts():
    payload = collect_payload(
        _record(input_info=None, result_info=None),
        user_connection_base="/base",
    )
    assert payload["input"] == {}
    assert payload["result"] == {}
