"""Mooring CSV 행 단위 편집 — 대상 요소·새 단면·등급 덮어쓰기·해석 BDF 반영."""
import json

import pytest

from app.routers import analysis as _an
from app.services.mooring_row_edit import (
    annotate_row_sections, apply_row_edits, is_row_edit, read_csv_lines, read_csv_rows, write_grade_overrides,
)

try:
    import nastran_bridge  # noqa: F401
    _NB = True
except Exception:  # pragma: no cover - nastran_bridge 미가용 환경
    _NB = False

ANGLE = ("ANGLE,A1,250,10,90,15,A,0,0,0,1000,0,0,0,-300,0,0,300,0,0,300,0,0,-300,0,12.5,AH")
FLATBAR = ("FLATBAR,F1,150,12,0,0,AH,0,0,0,1000,0,0,0,-300,0,0,300,0,0,300,0,0,-300,0,12.5,AH")
BELOW = "PLATE,P1,below,789.0,200.0,12,A,0,0,0,800,0,0"
ABOVE = "PLATE,P2,above,0,0,0,800,0,0,800,0,150,0,0,150,18,DH,"
HEADER = "//3496,A418366,2026-05-20 14:51:20"


@pytest.fixture
def case(tmp_path):
    (tmp_path / "MooringFittingData.csv").write_text(
        "﻿" + "\r\n".join([HEADER, "corrosion,1", ANGLE, FLATBAR, BELOW, ABOVE]) + "\r\n",
        encoding="utf-8")
    out = tmp_path / "out"
    out.mkdir()
    (out / "MODEL_EVIDENCE.json").write_text(json.dumps({"elements": [
        {"elementId": 1, "origin": {"kind": "derived", "csvLine": 3}},
        {"elementId": 2, "origin": {"kind": "derived", "csvLine": 3}},
        {"elementId": 3, "origin": {"kind": "derived", "csvLine": 4}},
        {"elementId": 4, "origin": {"kind": "derived", "csvLine": 5}},
        {"elementId": 5, "origin": {"kind": "derived", "csvLine": 6}},
        {"elementId": 6, "origin": {"kind": "fabricated"}},
    ]}), encoding="utf-8")
    return out


def _model():
    i_prop = {"id": 10, "card": "PBEAML", "kind": "I", "materialId": 1,
              "dims": [260.0, 90.0, 750.0, 10.0, 15.0, 10.0]}
    t_prop = {"id": 20, "card": "PBEAML", "kind": "T", "materialId": 1,
              "dims": [750.0, 160.0, 10.0, 12.0]}
    plate_i = {"id": 30, "card": "PBEAML", "kind": "I", "materialId": 1,
               "dims": [220.0, 90.0, 850.0, 12.0, 10.0, 10.0]}
    plate_t = {"id": 40, "card": "PBEAML", "kind": "T", "materialId": 1,
               "dims": [850.0, 160.0, 10.0, 18.0]}
    return {
        "properties": [i_prop, t_prop, plate_i, plate_t],
        "elements": [
            {"id": 1, "propertyId": 10}, {"id": 2, "propertyId": 10},
            {"id": 3, "propertyId": 20}, {"id": 4, "propertyId": 30},
            {"id": 5, "propertyId": 40}, {"id": 6, "propertyId": 10},
        ],
    }


def _edit(line, **cells):
    return {"kind": "editCsvRow", "params": {
        "csvLine": line, "cells": {k.lstrip("c"): v for k, v in cells.items()}}}


def _prop(model, element_id):
    pid = next(e for e in model["elements"] if e["id"] == element_id)["propertyId"]
    return next(p for p in model["properties"] if p["id"] == pid)


def test_read_rows_matches_engine_line_numbers_and_cells(case):
    rows = read_csv_rows(str(case.parent))
    assert sorted(rows) == [3, 4, 5, 6]       # BOM 은 벗기고 메타 행은 뺀다
    assert rows[3]["name"] == "A1"
    assert [c["cell"] for c in rows[3]["gradeCells"]] == [6, 26]
    assert [c["cell"] for c in rows[5]["gradeCells"]] == [6]     # below
    assert [c["cell"] for c in rows[6]["gradeCells"]] == [16]    # above 의 6 칸은 좌표


def test_read_lines_keeps_every_line_with_excel_row_numbers(case):
    lines = read_csv_lines(str(case.parent))
    assert len(lines) == 6                      # 끝 빈 줄은 빼고 머리글·corrosion 은 남긴다
    assert lines[0][0] == HEADER.split(",")[0]  # BOM 없음
    assert lines[1] == ["corrosion", "1"]
    assert lines[2][:2] == ["ANGLE", "A1"]      # 3행 = read_csv_rows 의 3 과 같은 줄


def test_angle_size_edit_changes_every_piece_of_the_row_only(case):
    m = _model()
    apply_row_edits(m, [_edit(3, c2="300", c3="12", c4="100", c5="18")], str(case))
    assert _prop(m, 1)["dims"] == [310.0, 100.0, 750.0, 12.0, 18.0, 10.0]   # 유효폭·갑판 유지
    assert _prop(m, 2)["id"] == _prop(m, 1)["id"]                          # 한 행 = 한 단면
    assert _prop(m, 6)["id"] == 10                                         # 다른 부재는 그대로


@pytest.mark.parametrize("line,cells,element,expected", [
    (4, {"c2": "200", "c3": "14"}, 3, [750.0, 210.0, 10.0, 14.0]),           # FLATBAR
    (5, {"c4": "250", "c5": "15"}, 4, [270.0, 90.0, 850.0, 15.0, 10.0, 10.0]),  # below
    (6, {"c15": "20"}, 5, [850.0, 160.0, 10.0, 20.0]),                       # above
])
def test_section_mapping_per_row_format(case, line, cells, element, expected):
    m = _model()
    apply_row_edits(m, [_edit(line, **cells)], str(case))
    assert _prop(m, element)["dims"] == expected


def test_grade_only_edit_keeps_section(case):
    m = _model()
    r = apply_row_edits(m, [_edit(3, c6="AH", c26="AH")], str(case))
    assert _prop(m, 1)["id"] == 10
    assert r["gradeOverrides"] == {"1": ["AH", "AH"], "2": ["AH", "AH"]}


def test_same_section_reused_for_two_rows(case):
    m = _model()
    apply_row_edits(m, [_edit(3, c3="11")], str(case))
    first = _prop(m, 1)["id"]
    m["elements"].append({"id": 7, "propertyId": 10})
    (case / "MODEL_EVIDENCE.json").write_text(json.dumps({"elements": [
        {"elementId": 7, "origin": {"kind": "derived", "csvLine": 3}}]}), encoding="utf-8")
    apply_row_edits(m, [_edit(3, c3="11")], str(case))
    assert _prop(m, 7)["id"] == first


def test_reinforcement_clone_follows_source_only_when_same_section(case):
    m = _model()
    m["elements"] += [{"id": 900001, "propertyId": 10, "reinforceOf": 1},
                      {"id": 900002, "propertyId": 20, "reinforceOf": 1}]
    r = apply_row_edits(m, [_edit(3, c3="11", c6="AH")], str(case))
    assert _prop(m, 900001)["id"] == _prop(m, 1)["id"]
    assert _prop(m, 900002)["id"] == 20
    assert "900001" in r["gradeOverrides"]


def test_merged_section_from_another_row_is_left_alone(case):
    """겹친 부재 병합으로 다른 행 단면을 쓰는 요소 — 이 행 칸을 대입하면 쓰레기 단면이 된다."""
    m = _model()
    m["properties"].append({"id": 50, "card": "PBEAML", "kind": "I", "materialId": 1,
                            "dims": [400.0, 100.0, 750.0, 13.0, 18.0, 10.0]})
    next(e for e in m["elements"] if e["id"] == 2)["propertyId"] = 50

    r = apply_row_edits(m, [_edit(3, c3="12", c6="AH")], str(case))

    assert _prop(m, 1)["dims"][3] == 12.0
    assert _prop(m, 2)["id"] == 50                # 다른 행 단면은 그대로
    assert r["skippedElements"] == 1
    assert "2" in r["gradeOverrides"]             # 등급은 출신 행을 따른다


@pytest.mark.parametrize("line,element,other", [
    (5, 4, {"id": 60, "card": "PBEAML", "kind": "T", "materialId": 1, "dims": [750.0, 160.0, 10.0, 12.0]}),
    (6, 5, {"id": 60, "card": "PBEAML", "kind": "I", "materialId": 1,
            "dims": [260.0, 90.0, 750.0, 10.0, 15.0, 10.0]}),
])
def test_plate_row_with_other_format_section_is_rejected_not_crashed(case, line, element, other):
    """13칸 below 행 + T 단면(IndexError) · above 행 + I 단면(좌표를 치수로 읽음)."""
    m = _model()
    m["properties"].append(other)
    next(e for e in m["elements"] if e["id"] == element)["propertyId"] = 60
    cell = {5: {"c5": "15"}, 6: {"c15": "22"}}[line]
    with pytest.raises(ValueError, match="합쳐진 단면"):
        apply_row_edits(m, [_edit(line, **cell)], str(case))


def test_annotate_counts_editable_elements(case):
    m = _model()
    m["properties"].append({"id": 50, "card": "PBEAML", "kind": "I", "materialId": 1,
                            "dims": [400.0, 100.0, 750.0, 13.0, 18.0, 10.0]})
    next(e for e in m["elements"] if e["id"] == 2)["propertyId"] = 50
    rows = read_csv_rows(str(case.parent))
    annotate_row_sections(rows, str(case), m)
    assert (rows[3]["ownElements"], rows[3]["foreignElements"]) == (1, 1)


def test_missing_evidence_is_a_clear_error(case):
    (case / "MODEL_EVIDENCE.json").unlink()
    with pytest.raises(ValueError, match="다시 생성"):
        apply_row_edits(_model(), [_edit(3, c3="11")], str(case))


@pytest.mark.parametrize("edit", [
    _edit(1, c2="1"),            # 메타 행
    _edit(99, c2="1"),           # 없는 행
    _edit(3, c7="1"),            # 좌표 칸
    _edit(3, c2="abc"),          # 숫자 아님
    _edit(3, c2="0"),            # 0 이하
])
def test_invalid_edit_is_rejected(case, edit):
    with pytest.raises(ValueError):
        apply_row_edits(_model(), [edit], str(case))


def test_deleted_row_is_reported(case):
    m = _model()
    m["elements"] = [e for e in m["elements"] if e["id"] not in (1, 2)]
    with pytest.raises(ValueError, match="남아 있지 않습니다"):
        apply_row_edits(m, [_edit(3, c3="11")], str(case))


def test_write_grade_overrides_and_clear_stale(tmp_path):
    bdf = str(tmp_path / "mooring_solve.bdf")
    write_grade_overrides(bdf, {"1": ["AH"]})
    written = tmp_path / "mooring_solve.grades.json"
    assert json.loads(written.read_text(encoding="utf-8")) == {"overrides": {"1": ["AH"]}}
    write_grade_overrides(bdf, {})
    assert not written.exists()


def test_is_row_edit():
    assert is_row_edit({"kind": "editCsvRow"})
    assert not is_row_edit({"kind": "deleteGroup"})


@pytest.mark.skipif(not _NB, reason="nastran_bridge 모듈 미가용")
def test_new_section_reaches_solvable_bdf(case):
    def card(*fields):
        return "".join(str(f).ljust(8)[:8] for f in fields)

    deck = "\n".join([
        "SOL 101", "CEND", "SPC = 1", "LOAD = 1", "SUBCASE 1", "BEGIN BULK",
        card("MAT1", 1, 206000.0, "", 0.3),
        card("PBEAML", 10, 1, "", "I"),
        card("", 260.0, 90.0, 750.0, 10.0, 15.0, 10.0),
        card("GRID", 1, "", 0.0, 0.0, 0.0),
        card("GRID", 2, "", 1000.0, 0.0, 0.0),
        card("CBEAM", 1, 10, 1, 2, 0.0, 0.0, 1.0),
        "ENDDATA",
    ]) + "\n"
    edited = {
        "nodes": [{"id": 1, "x": 0, "y": 0, "z": 0}, {"id": 2, "x": 1000, "y": 0, "z": 0}],
        "rigids": [],
        "properties": [{"id": 10, "card": "PBEAML", "kind": "I", "materialId": 1,
                        "dims": [260.0, 90.0, 750.0, 10.0, 15.0, 10.0]}],
        "elements": [{"id": 1, "propertyId": 10, "startNode": 1, "endNode": 2}],
    }
    apply_row_edits(edited, [_edit(3, c3="12")], str(case))

    text = _an._build_solvable_edited_bdf(deck, edited)

    lines = text.splitlines()
    cbeam = next(l for l in lines if l.startswith("CBEAM"))
    assert cbeam[16:24].strip() == "11"                    # 새 PID 로 패치
    head = next(i for i, l in enumerate(lines) if l.startswith("PBEAML") and l[8:16].strip() == "11")
    assert lines[head][24:].split()[-1] == "I"
    assert "12." in lines[head + 1]                        # 새 웹 두께
    assert sum(1 for l in lines if l.startswith("PBEAML")) == 2
    assert text.index("PBEAML") < text.index("ENDDATA")


# ── 라우터 실제 호출 ─────────────────────────────────────────────────

MINI_DECK = "\n".join([
    "SOL 101", "CEND", "SPC = 1", "LOAD = 1", "SUBCASE 1", "BEGIN BULK",
    "".join(str(f).ljust(8)[:8] for f in ("MAT1", 1, 206000.0, "", 0.3)),
    "".join(str(f).ljust(8)[:8] for f in ("PBEAML", 10, 1, "", "I")),
    "".join(str(f).ljust(8)[:8] for f in ("", 260.0, 90.0, 750.0, 10.0, 15.0, 10.0)),
    "".join(str(f).ljust(8)[:8] for f in ("GRID", 1, "", 0.0, 0.0, 0.0)),
    "".join(str(f).ljust(8)[:8] for f in ("GRID", 2, "", 1000.0, 0.0, 0.0)),
    "".join(str(f).ljust(8)[:8] for f in ("CBEAM", 1, 10, 1, 2, 0.0, 0.0, 1.0)),
    "ENDDATA",
]) + "\n"


@pytest.fixture
def api(tmp_path, monkeypatch, db_session):
    """userConnection 을 임시 폴더로 격리한 인증 클라이언트와 작업 out 폴더."""
    from fastapi.testclient import TestClient
    from app import database, models
    from app.dependencies import require_auth
    from app.main import app

    root = tmp_path / "userConnection"
    out = root / "20261103_101010_HHI123_MooringFitting" / "out"
    out.mkdir(parents=True)
    monkeypatch.setattr(_an, "_USER_CONNECTION_DIR", str(root))
    monkeypatch.setattr(_an, "_ALLOWED_DOWNLOAD_BASE", str(root))

    (out.parent / "MooringFittingData.csv").write_text(
        "\r\n".join([HEADER, "corrosion,1", ANGLE]) + "\r\n", encoding="utf-8")
    (out / "STAGE_07_FinalValidation.bdf").write_text(MINI_DECK, encoding="utf-8")
    (out / "MODEL_EVIDENCE.json").write_text(json.dumps({"elements": [
        {"elementId": 1, "origin": {"kind": "derived", "csvLine": 3, "rawId": "A1", "rawKind": "Angle"}},
    ]}), encoding="utf-8")
    (out / "MEMBER_MATERIAL.json").write_text(json.dumps({"elements": {
        "1": {"grade": "A", "yieldMPa": 235, "known": True}}}), encoding="utf-8")

    app.dependency_overrides[database.get_db] = lambda: db_session
    app.dependency_overrides[require_auth] = lambda: "HHI123"
    db_session.add(models.User(employee_id="HHI123", name="시험", company="HHI",
                               is_active=True, is_admin=False, is_developer=False))
    db_session.commit()
    try:
        yield TestClient(app), out
    finally:
        app.dependency_overrides.clear()


@pytest.mark.skipif(not _NB, reason="nastran_bridge 모듈 미가용")
def test_viewer_zip_carries_rows_and_engine_origin(api):
    import io
    import zipfile

    client, out = api
    res = client.get("/api/analysis/mooring-fitting/viewer-zip", params={"output_dir": str(out)})
    assert res.status_code == 200, res.text
    with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
        rows = json.loads(zf.read("csv_rows.json"))["rows"]
        names = json.loads(zf.read("element_names.json"))["names"]
    assert rows["3"]["name"] == "A1"
    assert rows["3"]["ownElements"] == 1
    assert names["1"] == {"name": "A1", "line": 3, "kind": "Angle",
                          "grade": "A", "yieldMPa": 235, "gradeKnown": True}


@pytest.mark.skipif(not _NB, reason="nastran_bridge 모듈 미가용")
def test_solve_route_applies_row_edit_and_writes_grades(api, monkeypatch):
    client, out = api
    monkeypatch.setattr(_an, "submit_analysis_job", lambda *a, **k: "job-1")

    res = client.post("/api/analysis/mooring-fitting/solve", json={
        "output_dir": str(out),
        "intents": [{"kind": "editCsvRow", "params": {"csvLine": 3, "cells": {"3": "12", "6": "AH"}}}],
    })

    assert res.status_code == 200, res.text
    assert res.json()["editSummary"]["csvRows"] == 1
    bdf = (out / "mooring_solve.bdf").read_text(encoding="utf-8")
    assert "12." in bdf and bdf.count("PBEAML") == 2
    assert json.loads((out / "mooring_solve.grades.json").read_text(encoding="utf-8")) == {
        "overrides": {"1": ["AH", "AH"]}}


@pytest.mark.skipif(not _NB, reason="nastran_bridge 모듈 미가용")
def test_solve_route_rejects_bad_row_edit_with_reason(api):
    client, out = api
    res = client.post("/api/analysis/mooring-fitting/solve", json={
        "output_dir": str(out),
        "intents": [{"kind": "editCsvRow", "params": {"csvLine": 3, "cells": {"7": "1"}}}],
    })
    assert res.status_code == 400
    assert "편집할 수 없습니다" in res.json()["detail"]


@pytest.mark.skipif(not _NB, reason="nastran_bridge 모듈 미가용")
def test_viewer_zip_omits_rows_without_engine_origin(api):
    import io
    import zipfile

    client, out = api
    (out / "MODEL_EVIDENCE.json").unlink()
    res = client.get("/api/analysis/mooring-fitting/viewer-zip", params={"output_dir": str(out)})
    assert res.status_code == 200, res.text
    with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
        assert "csv_rows.json" not in zf.namelist()


@pytest.mark.skipif(not _NB, reason="nastran_bridge 모듈 미가용")
def test_apply_edit_route_exports_row_edit_section(api):
    client, out = api
    res = client.post("/api/analysis/mooring-fitting/apply-edit", json={
        "folderPath": str(out),
        "intents": [{"kind": "editCsvRow", "params": {"csvLine": 3, "cells": {"3": "12"}}}],
    })
    assert res.status_code == 200, res.text


def test_duplicate_row_is_marked_from_engine_skips(case):
    """엔진이 통째로 복사된 행을 빼면(DuplicateRow) 표가 '중복 행' 으로 보이게 앞 행 번호를 싣는다."""
    (case / "CSV_Parse_Skips.csv").write_text(
        "\ufeffKind,SourceFile,Disposition,RowType,Count,LineNumbers,Identifiers,Reason,ExampleRawLine\n"
        "Structure,MooringFittingData.csv,Duplicate,DuplicateRow,2,4;6,F1,"
        "3행과 모든 칸이 같은 행 — 같은 부재가 두 번 들어가 강성이 2배가 되지 않게 뺐습니다.,x\n",
        encoding="utf-8")
    rows = read_csv_rows(str(case.parent))
    annotate_row_sections(rows, str(case), _model())
    assert rows[4]["duplicateOf"] == 3 and rows[6]["duplicateOf"] == 3
    assert "duplicateOf" not in rows[3]


def test_duplicate_rows_become_a_diagnosis_finding():
    from app.services.mooring_diagnosis import _case_findings
    found = _case_findings({"caseFacts": {"duplicateRows": 75, "mfInputCount": 1, "forceLoadCount": 2}}, None, None)
    assert any(f["code"] == "INPUT_ROW_DUPLICATE" and "75" in f["message"] for f in found)
    assert not any(f["code"] == "INPUT_ROW_DROPPED" for f in found)


def test_plate_below_t_section_new_engine(case):
    """2026-11-03 부터 PLATE below 는 면재 없는 T — 높이·두께 칸이 H(갑판+높이)·웹 두께를 바꾼다."""
    from app.services.mooring_row_edit import _new_dims
    rows = read_csv_rows(str(case.parent))
    prop = {"id": 50, "card": "PBEAML", "kind": "T", "materialId": 1, "dims": [850.0, 210.0, 10.0, 12.0]}
    cells = list(rows[5]["cells"]); cells[4] = "250"; cells[5] = "14"
    assert _new_dims(rows[5], prop, cells) == [850.0, 260.0, 10.0, 14.0]
