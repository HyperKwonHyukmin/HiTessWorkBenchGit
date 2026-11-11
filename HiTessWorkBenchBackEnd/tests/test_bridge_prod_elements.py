"""편집 JSON → BDF: PROD 를 참조하는 요소는 CROD 로 써야 한다.

회귀(2026-11-11, 3469 M02): MU Studio 는 선 요소의 type 을 'BEAM' 으로 통일하고 원래 카드는 cardType 에만
남긴다. bridge 가 type 만 보고 CBEAM 을 써서 'CBEAM → PROD 132' 가 되어 Nastran FATAL 2010 이 났다.
"""
import pytest

# analysis import 가 nastran_bridge 디렉터리를 sys.path 에 추가 → 그 뒤 nastran_bridge import.
from app.routers import analysis as _an  # noqa: F401

try:
    import nastran_bridge as _nb
    _NB = True
except Exception:  # pragma: no cover - nastran_bridge 미가용 환경
    _NB = False

pytestmark = pytest.mark.skipif(not _NB, reason="nastran_bridge 모듈 미가용")


def _model():
    return {
        "nodes": [
            {"id": 1, "x": 0.0, "y": 0.0, "z": 0.0},
            {"id": 2, "x": 1000.0, "y": 0.0, "z": 0.0},
            {"id": 3, "x": 0.0, "y": 0.0, "z": 5000.0},
        ],
        "elements": [
            {"id": 10, "type": "BEAM", "cardType": "CBEAM", "startNode": 1, "endNode": 2, "propertyId": 1,
             "orientation": [0.0, 0.0, 1.0]},
            {"id": 11, "type": "BEAM", "cardType": "CROD", "startNode": 1, "endNode": 3, "propertyId": 132},
        ],
        "properties": [
            {"id": 1, "card": "PBEAML", "kind": "L", "dims": [100, 100, 10], "materialId": 1},
            {"id": 132, "card": "PROD", "kind": "PROD", "dims": [1257, 251327], "materialId": 2},
        ],
        "materials": [
            {"id": 1, "E": 206000.0, "nu": 0.3, "rho": 7.85e-9},
            {"id": 2, "E": 206000.0, "nu": 0.3},
        ],
    }


def _element_lines(text):
    return {line[8:16].strip(): line for line in text.splitlines() if line.startswith(("CBEAM", "CROD", "CBAR"))}


def test_element_on_prod_is_written_as_crod():
    lines = _element_lines(_nb.convert_json_to_bdf(_model()))
    assert lines["11"].startswith("CROD")
    assert lines["11"][16:24].strip() == "132"
    assert lines["10"].startswith("CBEAM")
