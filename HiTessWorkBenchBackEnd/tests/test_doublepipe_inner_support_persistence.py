"""DoublePipe Tab 1 (Inner Support) My Projects persistence tests."""

from __future__ import annotations

from app import database, models
from app.services import doublepipe_service as service


class _FakeResultFrame:
    columns = ["id", "type"]

    def fillna(self, _value):
        return self

    def to_dict(self, orient):
        assert orient == "records"
        return [{"id": 1, "type": "TUBI"}, {"id": 2, "type": "UBOLT"}]

    def __len__(self):
        return 2


class _FakeTransformModule:
    @staticmethod
    def run_transform(input_csv_path, config, *, output_csv_path):
        assert input_csv_path.endswith("outer.csv")
        assert config["inner_pipe"]["outDia"] == 88.9
        with open(output_csv_path, "w", encoding="utf-8") as output_file:
            output_file.write("id,type\n1,TUBI\n2,UBOLT\n")
        print("inner support transform complete")
        return _FakeResultFrame()


def test_tab1_inner_support_persists_running_then_success(monkeypatch, tmp_path):
    config = {
        "inner_pipe": {"outDia": 88.9, "thick": 5.49},
        "ubolt": {"mass": 0.2485},
        "load_conditions": {"Pref": 15.3},
    }
    captured = []

    monkeypatch.setattr(service, "_USER_CONNECTION_DIR", str(tmp_path))
    monkeypatch.setattr(service, "_load_transform_module", lambda: _FakeTransformModule())
    monkeypatch.setattr(service, "_pdf_supported", lambda: True)
    monkeypatch.setattr(
        service,
        "record_analysis",
        lambda **kwargs: (captured.append(kwargs) or ({"id": 41}, None)),
    )

    result = service.run_inner_pipe_preview(
        config,
        b"id,type\n1,TUBI\n",
        "outer.csv",
        "E100",
    )

    assert [snapshot["status"] for snapshot in captured] == ["Running", "Success"]
    running, completed = captured
    assert running["job_id"] == completed["job_id"]
    assert running["project_name"] == completed["project_name"]
    assert running["program_name"] == "DoublePipeFuelLine"
    assert running["input_info"]["workflow_step"] == "inner_support"
    assert running["input_info"]["inner_support_config"] == config
    assert completed["result_info"]["workflow_step"] == "inner_support"
    assert completed["result_info"]["result_csv"].endswith("outer_Y-15000.csv")
    assert completed["result_info"]["row_count"] == 2
    assert completed["result_info"]["logs"] == ["inner support transform complete"]
    assert result["jobId"] == completed["job_id"]
    assert result["analysisId"] == 41


def test_tab1_inner_support_creates_one_completed_database_record(monkeypatch, tmp_path, db_session):
    config = {
        "inner_pipe": {"outDia": 88.9, "thick": 5.49},
        "ubolt": {"mass": 0.2485},
        "load_conditions": {"Pref": 15.3},
    }
    monkeypatch.setattr(service, "_USER_CONNECTION_DIR", str(tmp_path))
    monkeypatch.setattr(service, "_load_transform_module", lambda: _FakeTransformModule())
    monkeypatch.setattr(service, "_pdf_supported", lambda: False)
    monkeypatch.setattr(database, "SessionLocal", lambda: db_session)

    result = service.run_inner_pipe_preview(
        config,
        b"id,type\n1,TUBI\n",
        "outer.csv",
        "E100",
    )

    row = db_session.query(models.Analysis).filter_by(job_id=result["jobId"]).one()
    assert row.id == result["analysisId"]
    assert row.status == "Success"
    assert row.project_name.startswith("Inner Support 설계_")
    assert row.input_info["workflow_step"] == "inner_support"
    assert row.input_info["inner_support_config"] == config
    assert row.result_info["row_count"] == 2
    assert row.result_info["result_csv"].endswith("outer_Y-15000.csv")
    assert db_session.query(models.Analysis).count() == 1
    assert db_session.query(models.ActivityLog).count() == 1
