"""Model Builder 편집 계약 테스트 — 같은 _edit.json 을 C# 엔진(Cmb.Cli)과 nastran_bridge 가 같은 모델로 만드는가.

배경(2026-10-02 정합성 검토): Studio 미리보기·C# 엔진·bridge fallback·해석 실행이 같은 편집을 서로 다르게
적용했지만(회전 pivot, 무게중심 공식, 종속 중복 처리 등) 각자 단위 테스트만 통과해 드러나지 않았다.
이 테스트가 두 엔진의 산출 모델(노드 좌표·요소·RBE·재질·질량)을 직접 비교한다.

편집은 Studio 가 만드는 모양 그대로다: 회전에는 pivot, 무게중심 RBE 에는 미리 거른 종속 노드와
independentCoord(회전된 좌표계의 산술 평균)가 들어 있다.

실행 대상 바꾸기(새 빌드를 InHouseProgram 에 넣기 전에 검증할 때):
  CMB_CLI_EXE=<새 Cmb.Cli.exe>   NASTRAN_BRIDGE_PY=<새 nastran_bridge.py>
엔진 exe 가 없으면(CI 등) 건너뛴다.
"""
import importlib.util
import json
import math
import os
import shutil
import subprocess
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
FIXTURE = BACKEND / "tests" / "fixtures" / "modelbuilder_edit_contract"
BASE = "06_Validation"
CMB_EXE = Path(os.environ.get("CMB_CLI_EXE") or BACKEND / "InHouseProgram" / "HiTessModeBuilder" / "Cmb.Cli.exe")
BRIDGE_PY = Path(os.environ.get("NASTRAN_BRIDGE_PY") or BACKEND / "InHouseProgram" / "NastranBridge" / "nastran_bridge.py")

PIVOT = {"x": 85000.0, "y": 6000.0, "z": 38000.0}
ANGLE = 30.0
CENTROID_DEPS = [27, 28, 30]


def _load_bridge():
    spec = importlib.util.spec_from_file_location("contract_nastran_bridge", BRIDGE_PY)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _rot_z(x, y, z):
    r = math.radians(ANGLE)
    dx, dy = x - PIVOT["x"], y - PIVOT["y"]
    return PIVOT["x"] + dx * math.cos(r) - dy * math.sin(r), PIVOT["y"] + dx * math.sin(r) + dy * math.cos(r), z


def _edit_document(base):
    nodes = {n["id"]: n for n in base["nodes"]}
    rotated = [_rot_z(nodes[d]["x"], nodes[d]["y"], nodes[d]["z"]) for d in CENTROID_DEPS]
    coord = {k: sum(p[i] for p in rotated) / len(rotated) for i, k in enumerate(("x", "y", "z"))}
    ok = {"status": "ok", "warnings": [], "errors": []}
    meta = base["meta"]
    return {
        "schemaVersion": "1.0",
        "stageRef": {"phase": meta["phase"], "stageName": meta["stageName"], "sourceTimestamp": meta["timestamp"]},
        "createdAt": "2026-10-02T00:00:00Z",
        "createdBy": "contract-test",
        "intents": [
            {"id": "rot", "kind": "rotateModel", "params": {"axis": "Z", "angleDeg": ANGLE, "pivot": PIVOT}, "validation": ok},
            {"id": "grp", "kind": "deleteGroup", "params": {"groupId": 4, "memberNodeCount": 2}, "validation": ok},
            {"id": "fluid", "kind": "emptyPipeFluid", "params": {"materialIds": [2, 3, 4, 5], "targetRho": 7.85e-9}, "validation": ok},
            {"id": "rbe", "kind": "addRigid", "params": {"independentNode": 13, "dependentNodes": [9], "cm": "123456"}, "validation": ok},
            {"id": "cog", "kind": "addRigid", "params": {
                "independentNode": None, "dependentNodes": CENTROID_DEPS, "createIndependentAtCentroid": True,
                "independentCoord": coord, "cm": "123456"}, "validation": ok},
        ],
    }


def _run_engine(work: Path):
    proc = subprocess.run([str(CMB_EXE), "apply-edit-intent", str(work)], cwd=work, capture_output=True, timeout=300)
    assert proc.returncode == 0, proc.stdout.decode("utf-8", "replace") + proc.stderr.decode("utf-8", "replace")
    return json.loads((work / "edited" / f"{BASE}.json").read_text(encoding="utf-8"))


def _run_bridge(work: Path):
    nb = _load_bridge()
    out_json = work / "bridge" / f"{BASE}.json"
    nb.write_edited_model_outputs(work / f"{BASE}_edit.json", out_json, work / "bridge" / f"{BASE}.bdf",
                                  base_json_path=work / f"{BASE}.json")
    return json.loads(out_json.read_text(encoding="utf-8"))


def _summary(model):
    """ID 채번이 엔진마다 달라도 비교되게 새 노드(NodeA)는 좌표로, RBE 는 (독립 좌표, 종속 집합)으로 본다."""
    nodes = {n["id"]: (float(n["x"]), float(n["y"]), float(n["z"])) for n in model["nodes"]}
    rigids = sorted(
        (tuple(round(v, 3) for v in nodes[r["independentNode"]]), tuple(sorted(r["dependentNodes"])))
        for r in model["rigids"]
    )
    return {
        "nodes": nodes,
        "elements": sorted(e["id"] for e in model["elements"]),
        "rigids": rigids,
        "rho": {m["id"]: float(m["rho"]) for m in model["materials"]},
        "masses": sorted((pm["nodeId"], float(pm["mass"])) for pm in model.get("pointMasses", [])),
        "orient": {e["id"]: tuple(round(float(v), 6) for v in e["orientation"]) for e in model["elements"] if e.get("orientation")},
    }


@pytest.mark.skipif(not CMB_EXE.is_file(), reason="Cmb.Cli.exe 없음")
def test_engine_and_bridge_produce_same_model(tmp_path):
    for name in (f"{BASE}.json", f"{BASE}.bdf"):
        shutil.copy2(FIXTURE / name, tmp_path / name)
    base = json.loads((tmp_path / f"{BASE}.json").read_text(encoding="utf-8"))
    (tmp_path / f"{BASE}_edit.json").write_text(json.dumps(_edit_document(base)), encoding="utf-8")

    engine = _summary(_run_engine(tmp_path))
    bridge = _summary(_run_bridge(tmp_path))

    # 원본 노드: 같은 집합, 같은 좌표(회전 pivot 이 같아야 한다)
    original = {n["id"] for n in base["nodes"]}
    assert {i for i in engine["nodes"] if i in original} == {i for i in bridge["nodes"] if i in original}
    for nid in original & engine["nodes"].keys():
        assert engine["nodes"][nid] == pytest.approx(bridge["nodes"][nid], abs=1e-3), f"node {nid}"
    assert 11 not in engine["nodes"] and 12 not in engine["nodes"]           # 그룹 4 삭제
    assert engine["nodes"][1] == pytest.approx(_rot_z(90072, 4908, 38610), abs=1e-3)   # pivot 기준 회전

    assert engine["elements"] == bridge["elements"]
    assert engine["orient"] == pytest.approx(bridge["orient"]) if engine["orient"].keys() == bridge["orient"].keys() else engine["orient"] == bridge["orient"]
    assert engine["rigids"] == bridge["rigids"]                               # 무게중심 NodeA 좌표·종속 포함
    assert engine["rho"] == pytest.approx(bridge["rho"])
    assert engine["masses"] == bridge["masses"]


HULL_COMMENT = "$ HiTessModelBuilder: HullNo=3454"


@pytest.mark.skipif(not CMB_EXE.is_file(), reason="Cmb.Cli.exe 없음")
@pytest.mark.parametrize("hull_in", ["json", "bdf"])
def test_engine_and_bridge_keep_hull_no(tmp_path, hull_in):
    """편집 적용 두 경로(엔진 기본 · bridge fallback) 모두 호선 주석을 편집 BDF 첫 줄에 다시 쓴다(2026-10-20).

    hull_in='json' = 이 기능 이후 빌드(meta.hullNo 가 원본) / 'bdf' = base JSON 에 없고 base BDF 주석에만 있는 경우.
    엔진이 호선 기능 이전 빌드면(--hull-no 미지원) 건너뛴다.
    """
    helped = subprocess.run([str(CMB_EXE), "build-full", "--help"], capture_output=True, timeout=60)
    if b"--hull-no" not in helped.stdout + helped.stderr:
        pytest.skip("호선 기록 이전 엔진")
    base = json.loads((FIXTURE / f"{BASE}.json").read_text(encoding="utf-8"))
    bdf_text = (FIXTURE / f"{BASE}.bdf").read_text(encoding="utf-8")
    if hull_in == "json":
        base["meta"]["hullNo"] = "3454"
    else:
        bdf_text = HULL_COMMENT + "\n" + bdf_text
    (tmp_path / f"{BASE}.json").write_text(json.dumps(base), encoding="utf-8")
    (tmp_path / f"{BASE}.bdf").write_text(bdf_text, encoding="utf-8")
    (tmp_path / f"{BASE}_edit.json").write_text(json.dumps(_edit_document(base)), encoding="utf-8")

    engine_json = _run_engine(tmp_path)
    assert engine_json["meta"]["hullNo"] == "3454"
    engine_bdf = (tmp_path / "edited" / f"{BASE}.bdf").read_text(encoding="utf-8")
    assert engine_bdf.splitlines()[0] == HULL_COMMENT

    if hull_in == "json":   # bridge fallback 은 base JSON 만 본다
        bridge_json = _run_bridge(tmp_path)
        assert bridge_json["meta"]["hullNo"] == "3454"
        bridge_bdf = (tmp_path / "bridge" / f"{BASE}.bdf").read_text(encoding="utf-8")
        assert bridge_bdf.splitlines()[0] == HULL_COMMENT
