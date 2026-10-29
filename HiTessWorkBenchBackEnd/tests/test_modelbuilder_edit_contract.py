"""Model Builder 편집 계약 테스트 — 같은 _edit.json 을 C# 엔진(Cmb.Cli)과 nastran_bridge 가 같은 모델로 만드는가.

배경(2026-10-02 정합성 검토): Studio 미리보기·C# 엔진·bridge fallback·해석 실행이 같은 편집을 서로 다르게
적용했지만(회전 pivot, 무게중심 공식, 종속 중복 처리 등) 각자 단위 테스트만 통과해 드러나지 않았다.
이 테스트가 두 엔진의 산출 모델(노드 좌표·요소·RBE·재질·질량)을 직접 비교한다.

2026-10-29 MB 경로의 bridge fallback 을 걷어내 MB 편집은 C# 엔진 하나가 적용한다. 아래 C# ↔ bridge 비교 2건은
옛 kind(회전·무게중심 RBE·유체 비움 등)의 독립 기준으로 남겼다 — bridge 는 Mooring·SP 의 편집 엔진이고,
Studio 미리보기 스크립트는 회전·재질을 다루지 않는다. 새 kind 는 C# ↔ Studio 미리보기로만 비교한다.

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
import re
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


@pytest.mark.skipif(not CMB_EXE.is_file(), reason="Cmb.Cli.exe 없음")
def test_engine_applies_delete_rigid_and_add_node_like_bridge(tmp_path):
    """deleteRigid(removeMass)·addNode 를 엔진이 직접 적용해도 bridge 와 같은 모델인가(2026-10-28 엔진 단일화).

    예전엔 이 두 kind 가 섞이면 엔진이 exit 65 를 내고 bridge 가 전체를 대신 적용했다.
    addRigid 를 addNode 보다 앞에 기록해도 노드가 먼저 생겨야 한다. 옛 엔진(두 kind 미지원)이면 건너뛴다.
    """
    for name in (f"{BASE}.json", f"{BASE}.bdf"):
        shutil.copy2(FIXTURE / name, tmp_path / name)
    base = json.loads((tmp_path / f"{BASE}.json").read_text(encoding="utf-8"))
    ok = {"status": "ok", "warnings": [], "errors": []}
    meta = base["meta"]
    doc = {
        "schemaVersion": "1.0",
        "stageRef": {"phase": meta["phase"], "stageName": meta["stageName"], "sourceTimestamp": meta["timestamp"]},
        "createdAt": "2026-10-28T00:00:00Z",
        "createdBy": "contract-test",
        "intents": [
            {"id": "rot", "kind": "rotateModel", "params": {"axis": "Z", "angleDeg": ANGLE, "pivot": PIVOT}, "validation": ok},
            {"id": "rbe", "kind": "addRigid", "params": {"independentNode": 900, "dependentNodes": [1], "cm": "123456"}, "validation": ok},
            {"id": "node", "kind": "addNode", "params": {"nodeId": 900, "x": 90100.0, "y": 4900.0, "z": 38700.0}, "validation": ok},
            {"id": "cogfar", "kind": "deleteRigid", "params": {"rigidId": 13, "reason": "equipmentCogFar", "removeMass": True}, "validation": ok},
        ],
    }
    (tmp_path / f"{BASE}_edit.json").write_text(json.dumps(doc), encoding="utf-8")

    if not _engine_knows(tmp_path, "addNode", {"nodeId": 901, "x": 0.0, "y": 0.0, "z": 0.0}):
        pytest.skip("deleteRigid·addNode 이전 엔진")
    proc = subprocess.run([str(CMB_EXE), "apply-edit-intent", str(tmp_path)], cwd=tmp_path, capture_output=True, timeout=300)
    log = proc.stdout.decode("utf-8", "replace") + proc.stderr.decode("utf-8", "replace")
    assert proc.returncode == 0, log
    engine = _summary(json.loads((tmp_path / "edited" / f"{BASE}.json").read_text(encoding="utf-8")))
    bridge = _summary(_run_bridge(tmp_path))

    assert engine["nodes"].keys() == bridge["nodes"].keys()
    for nid in engine["nodes"]:
        assert engine["nodes"][nid] == pytest.approx(bridge["nodes"][nid], abs=1e-3), f"node {nid}"
    assert engine["nodes"][900] == pytest.approx((90100.0, 4900.0, 38700.0))   # 회전된 좌표계로 기록 → 다시 돌리지 않음
    assert 22 not in engine["nodes"]                                          # 질량·RBE 빠진 COG 노드 정리
    assert engine["elements"] == bridge["elements"]
    assert engine["rigids"] == bridge["rigids"]
    assert engine["masses"] == bridge["masses"]
    assert all(node != 22 for node, _ in engine["masses"])


HULL_COMMENT = "$ HiTessModelBuilder: HullNo=3454"


@pytest.mark.skipif(not CMB_EXE.is_file(), reason="Cmb.Cli.exe 없음")
@pytest.mark.parametrize("hull_in", ["json", "bdf"])
def test_engine_keeps_hull_no(tmp_path, hull_in):
    """편집 적용이 호선 주석을 편집 BDF 첫 줄에 다시 쓴다(2026-10-20). MB 경로 bridge fallback 은 2026-10-29 제거.

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


# ── C# ↔ Studio 미리보기 (2026-10-28 기본 모델 편집 ②단계) ─────────────────────────────
# MB 경로 엔진을 C# 하나로 통일하면서 계약 비교 대상이 bridge 에서 Studio 미리보기(computeDeleteMask)로 바뀐다.
# 미리보기는 Studio 저장소의 scripts/previewEditedModel.mjs 로 돌린다(node + Studio node_modules 필요).
STUDIO_DIR = Path(os.environ.get("MB_STUDIO_DIR")
                  or BACKEND.parents[1] / "WorkBenchSubModule" / "ModelBuilderStudio" / "apps" / "model-studio")
PREVIEW_SCRIPT = STUDIO_DIR / "scripts" / "previewEditedModel.mjs"


def _delete_edit_intents(reverse=False):
    ok = {"status": "ok", "warnings": [], "errors": []}
    intents = [
        {"id": "grp", "kind": "deleteGroup", "params": {"groupId": 4, "memberNodeCount": 2}},
        {"id": "els", "kind": "deleteElements", "params": {"elementIds": [2, 25], "removeOrphanNodes": True}},
        {"id": "mass", "kind": "deleteMasses", "params": {"massIds": [16]}},
        {"id": "rbedel", "kind": "deleteRigid", "params": {"rigidId": 13}},
        {"id": "orph", "kind": "deleteOrphanNodes", "params": {"nodeIds": [6, 7, 8, 22]}},
        {"id": "rbe", "kind": "addRigid", "params": {"independentNode": 4, "dependentNodes": [9], "cm": "123456"}},
        {"id": "node", "kind": "addNode", "params": {"nodeId": 900, "x": 90100.0, "y": 4900.0, "z": 38700.0}},
        {"id": "rbe2", "kind": "addRigid", "params": {"independentNode": 900, "dependentNodes": [1], "cm": "123456"}},
    ]
    if reverse:
        intents = intents[::-1]
    return [{**i, "validation": ok} for i in intents]


def _engine_knows(tmp_path, kind, params):
    """엔진이 그 kind 를 아는지 한 건짜리 편집으로 확인한다 — 옛 엔진은 다른 검증에서 먼저 실패해 메시지로는 못 가른다."""
    probe = tmp_path / "probe"
    probe.mkdir()
    for name in (f"{BASE}.json", f"{BASE}.bdf"):
        shutil.copy2(FIXTURE / name, probe / name)
    meta = json.loads((probe / f"{BASE}.json").read_text(encoding="utf-8"))["meta"]
    (probe / f"{BASE}_edit.json").write_text(json.dumps({
        "schemaVersion": "1.0",
        "stageRef": {"phase": meta["phase"], "stageName": meta["stageName"], "sourceTimestamp": meta["timestamp"]},
        "intents": [{"id": "p", "kind": kind, "params": params, "validation": {"status": "ok", "warnings": [], "errors": []}}],
    }), encoding="utf-8")
    proc = subprocess.run([str(CMB_EXE), "apply-edit-intent", str(probe)], cwd=probe, capture_output=True, timeout=120)
    return b"unsupported intent kind" not in proc.stdout + proc.stderr


@pytest.mark.skipif(not CMB_EXE.is_file(), reason="Cmb.Cli.exe 없음")
@pytest.mark.skipif(shutil.which("node") is None or not PREVIEW_SCRIPT.is_file(), reason="node 또는 Studio 미리보기 스크립트 없음")
@pytest.mark.parametrize("reverse", [False, True], ids=["recorded", "reversed"])
def test_engine_matches_studio_preview_for_delete_edits(tmp_path, reverse):
    """요소·질량 삭제·고립 노드 정리를 섞어도 C# 산출 모델 = Studio 미리보기(기록 순서와 무관)."""
    for name in (f"{BASE}.json", f"{BASE}.bdf"):
        shutil.copy2(FIXTURE / name, tmp_path / name)
    base = json.loads((tmp_path / f"{BASE}.json").read_text(encoding="utf-8"))
    meta = base["meta"]
    doc = {
        "schemaVersion": "1.0",
        "stageRef": {"phase": meta["phase"], "stageName": meta["stageName"], "sourceTimestamp": meta["timestamp"]},
        "createdAt": "2026-10-28T00:00:00Z",
        "createdBy": "contract-test",
        "intents": _delete_edit_intents(reverse),
    }
    edit_path = tmp_path / f"{BASE}_edit.json"
    edit_path.write_text(json.dumps(doc), encoding="utf-8")

    if not _engine_knows(tmp_path, "deleteOrphanNodes", {"nodeIds": [4]}):
        pytest.skip("삭제 3종 이전 엔진")
    proc = subprocess.run([str(CMB_EXE), "apply-edit-intent", str(tmp_path)], cwd=tmp_path, capture_output=True, timeout=300)
    log = proc.stdout.decode("utf-8", "replace") + proc.stderr.decode("utf-8", "replace")
    assert proc.returncode == 0, log
    engine = json.loads((tmp_path / "edited" / f"{BASE}.json").read_text(encoding="utf-8"))

    pv = subprocess.run(["node", str(PREVIEW_SCRIPT), str(tmp_path / f"{BASE}.json"), str(edit_path)],
                        cwd=STUDIO_DIR, capture_output=True, timeout=120)
    assert pv.returncode == 0, pv.stderr.decode("utf-8", "replace")
    preview = json.loads(pv.stdout.decode("utf-8"))

    base_nodes = {n["id"] for n in base["nodes"]} | {900}
    engine_nodes = {n["id"] for n in engine["nodes"]}
    assert sorted(engine_nodes & base_nodes) == preview["nodeIds"]
    assert len(engine_nodes - base_nodes) == preview["centroidRigidCount"]   # 무게중심 RBE 가 만든 노드만 남는다
    assert sorted(e["id"] for e in engine["elements"]) == preview["elementIds"]

    base_masses = {pm["id"] for pm in base.get("pointMasses", [])}
    assert sorted(pm["id"] for pm in engine.get("pointMasses", []) if pm["id"] in base_masses) == preview["massIds"]

    base_rigids = {r["id"]: r["independentNode"] for r in base["rigids"]}
    kept = sorted(r["id"] for r in engine["rigids"] if base_rigids.get(r["id"]) == r["independentNode"])
    assert kept == preview["baseRigidIds"]
    assert len(engine["rigids"]) - len(kept) == preview["addedRigidCount"]

    # 이 편집에서 기대하는 결과 자체도 고정한다(두 쪽이 같이 틀리는 것 방지).
    assert 4 in engine_nodes            # E2 를 지워도 새 RBE 가 쓴다
    assert 26 in engine_nodes           # 질량만 지움 — 요소에 걸린 노드
    assert 22 in engine_nodes           # RBE 13 을 지워도 질량 M14 가 붙어 있어 고립이 아니다
    assert 11 not in engine_nodes and 12 not in engine_nodes   # 그룹 4 삭제


@pytest.mark.skipif(not CMB_EXE.is_file(), reason="Cmb.Cli.exe 없음")
@pytest.mark.skipif(shutil.which("node") is None or not PREVIEW_SCRIPT.is_file(), reason="node 또는 Studio 미리보기 스크립트 없음")
def test_engine_matches_studio_preview_for_move_and_add_element(tmp_path):
    """노드 이동·부재 추가(새 단면 포함)를 무게중심 RBE·요소 삭제와 섞어도 C# 산출 모델 = Studio 미리보기."""
    for name in (f"{BASE}.json", f"{BASE}.bdf"):
        shutil.copy2(FIXTURE / name, tmp_path / name)
    base = json.loads((tmp_path / f"{BASE}.json").read_text(encoding="utf-8"))
    if not _engine_knows(tmp_path, "addElement", {"elementId": 90001, "startNode": 4, "endNode": 9, "propertyId": base["elements"][0]["propertyId"]}):
        pytest.skip("노드 이동·부재 추가 이전 엔진")
    meta = base["meta"]
    next_eid = max(x["id"] for k in ("elements", "rigids", "pointMasses") for x in base[k]) + 1
    # 새 구조 단면은 구조 구간(배관 PID·101 미만) 안 — 전체 최대 + 1 은 배관 구간이라 엔진이 65 로 거부한다(2026-10-29)
    pipe_pids = {e["propertyId"] for e in base["elements"] if e["category"] == "Pipe"}
    next_pid = max(p["id"] for p in base["properties"] if p["id"] < min([101, *pipe_pids])) + 1
    mid = base["materials"][0]["id"]
    ok = {"status": "ok", "warnings": [], "errors": []}
    intents = [
        {"id": "cog", "kind": "addRigid", "params": {"independentNode": None, "dependentNodes": CENTROID_DEPS,
                                                     "createIndependentAtCentroid": True, "cm": "123456"}},
        {"id": "mv", "kind": "moveNodes", "params": {"moves": [{"nodeId": 4, "x": 90050.0, "y": 4950.0, "z": 38650.0}]}},
        {"id": "del", "kind": "deleteElements", "params": {"elementIds": [2], "removeOrphanNodes": True}},
        {"id": "el1", "kind": "addElement", "params": {"elementId": next_eid, "startNode": 4, "endNode": 9,
                                                       "propertyId": base["elements"][0]["propertyId"]}},
        {"id": "el2", "kind": "addElement", "params": {"elementId": next_eid + 1, "startNode": 9, "endNode": 13,
                                                       "propertyId": next_pid,
                                                       "newProperty": {"id": next_pid, "kind": "L", "dims": [75.0, 75.0, 9.0, 9.0], "materialId": mid}}},
    ]
    doc = {"schemaVersion": "1.0",
           "stageRef": {"phase": meta["phase"], "stageName": meta["stageName"], "sourceTimestamp": meta["timestamp"]},
           "createdAt": "2026-10-28T00:00:00Z", "createdBy": "contract-test",
           "intents": [{**i, "validation": ok} for i in intents]}
    edit_path = tmp_path / f"{BASE}_edit.json"
    edit_path.write_text(json.dumps(doc), encoding="utf-8")

    proc = subprocess.run([str(CMB_EXE), "apply-edit-intent", str(tmp_path)], cwd=tmp_path, capture_output=True, timeout=300)
    assert proc.returncode == 0, proc.stdout.decode("utf-8", "replace") + proc.stderr.decode("utf-8", "replace")
    engine = json.loads((tmp_path / "edited" / f"{BASE}.json").read_text(encoding="utf-8"))
    pv = subprocess.run(["node", str(PREVIEW_SCRIPT), str(tmp_path / f"{BASE}.json"), str(edit_path)],
                        cwd=STUDIO_DIR, capture_output=True, timeout=120)
    assert pv.returncode == 0, pv.stderr.decode("utf-8", "replace")
    preview = json.loads(pv.stdout.decode("utf-8"))

    base_nodes = {n["id"] for n in base["nodes"]}
    engine_nodes = {n["id"]: (n["x"], n["y"], n["z"]) for n in engine["nodes"]}
    assert sorted(set(engine_nodes) & base_nodes) == preview["nodeIds"]
    assert sorted(e["id"] for e in engine["elements"]) == preview["elementIds"]
    for nid, xyz in preview["movedNodes"].items():
        assert engine_nodes[int(nid)] == pytest.approx(tuple(xyz))
    # 엔진이 무게중심 RBE 에 Studio 번호를 주지 않았다(addElement 가 먼저 적용)
    assert {next_eid, next_eid + 1} <= {e["id"] for e in engine["elements"]}
    assert not {next_eid, next_eid + 1} & {r["id"] for r in engine["rigids"]}
    assert 4 in engine_nodes                      # E2 를 지워도 새 부재가 쓴다
    bdf = (tmp_path / "edited" / f"{BASE}.bdf").read_text(encoding="utf-8")
    assert re.search(rf"(?m)^PBEAML\s+{next_pid}\s+{mid}\s+L", bdf)


@pytest.mark.skipif(not CMB_EXE.is_file(), reason="Cmb.Cli.exe 없음")
@pytest.mark.skipif(shutil.which("node") is None or not PREVIEW_SCRIPT.is_file(), reason="node 또는 Studio 미리보기 스크립트 없음")
def test_engine_matches_studio_preview_for_change_section(tmp_path):
    """단면 변경(2026-10-29) — 원본 부재 changeSection(기존 PID · 새 PBEAML) + 추가 부재의 새 단면을 섞어도 부재별 PID 가 같다."""
    for name in (f"{BASE}.json", f"{BASE}.bdf"):
        shutil.copy2(FIXTURE / name, tmp_path / name)
    base = json.loads((tmp_path / f"{BASE}.json").read_text(encoding="utf-8"))
    if not _engine_knows(tmp_path, "changeSection", {"elementIds": [2], "propertyId": 5}):
        pytest.skip("단면 변경 이전 엔진")
    meta = base["meta"]
    next_eid = max(x["id"] for k in ("elements", "rigids", "pointMasses") for x in base[k]) + 1
    # Studio suggestNextPropertyId 와 같은 기준 — 구조 구간(배관 PID·101 미만) 안 최대 + 1
    pipe_pids = {e["propertyId"] for e in base["elements"] if e["category"] == "Pipe"}
    new_pid = max(p["id"] for p in base["properties"] if p["id"] < min([101, *pipe_pids])) + 1
    mid = base["materials"][0]["id"]
    ok = {"status": "ok", "warnings": [], "errors": []}
    intents = [
        {"id": "el", "kind": "addElement", "params": {"elementId": next_eid, "startNode": 4, "endNode": 9, "propertyId": new_pid + 1,
                                                      "newProperty": {"id": new_pid + 1, "kind": "L", "dims": [90.0, 90.0, 10.0, 10.0], "materialId": mid}}},
        {"id": "cs1", "kind": "changeSection", "params": {"elementIds": [2, 21], "propertyId": 5}},
        {"id": "cs2", "kind": "changeSection", "params": {"elementIds": [22, 25], "propertyId": new_pid,
                                                         "newProperty": {"id": new_pid, "kind": "L", "dims": [130.0, 130.0, 12.0, 12.0], "materialId": mid}}},
        {"id": "del", "kind": "deleteElements", "params": {"elementIds": [26], "removeOrphanNodes": True}},
    ]
    doc = {"schemaVersion": "1.0",
           "stageRef": {"phase": meta["phase"], "stageName": meta["stageName"], "sourceTimestamp": meta["timestamp"]},
           "createdAt": "2026-10-29T00:00:00Z", "createdBy": "contract-test",
           "intents": [{**i, "validation": ok} for i in intents]}
    edit_path = tmp_path / f"{BASE}_edit.json"
    edit_path.write_text(json.dumps(doc), encoding="utf-8")

    proc = subprocess.run([str(CMB_EXE), "apply-edit-intent", str(tmp_path)], cwd=tmp_path, capture_output=True, timeout=300)
    assert proc.returncode == 0, proc.stdout.decode("utf-8", "replace") + proc.stderr.decode("utf-8", "replace")
    engine = json.loads((tmp_path / "edited" / f"{BASE}.json").read_text(encoding="utf-8"))
    pv = subprocess.run(["node", str(PREVIEW_SCRIPT), str(tmp_path / f"{BASE}.json"), str(edit_path)],
                        cwd=STUDIO_DIR, capture_output=True, timeout=120)
    assert pv.returncode == 0, pv.stderr.decode("utf-8", "replace")
    preview = json.loads(pv.stdout.decode("utf-8"))

    assert sorted(e["id"] for e in engine["elements"]) == preview["elementIds"]
    assert {str(e["id"]): e["propertyId"] for e in engine["elements"]} == preview["elementPropertyIds"]
    by_id = {e["id"]: e for e in engine["elements"]}
    base_by_id = {e["id"]: e for e in base["elements"]}
    assert by_id[2]["propertyId"] == 5 and by_id[21]["propertyId"] == 5
    assert by_id[22]["propertyId"] == new_pid and by_id[25]["propertyId"] == new_pid
    assert by_id[next_eid]["propertyId"] == new_pid + 1
    assert by_id[8]["propertyId"] == base_by_id[8]["propertyId"]                  # 배관은 그대로
    assert by_id[22].get("orientation") == base_by_id[22].get("orientation")      # 방향 벡터 유지
    bdf = (tmp_path / "edited" / f"{BASE}.bdf").read_text(encoding="utf-8")
    assert re.search(rf"(?m)^PBEAML\s+{new_pid}\s+{mid}\s+L", bdf)
    assert re.search(rf"(?m)^PBEAML\s+{new_pid + 1}\s+{mid}\s+L", bdf)


@pytest.mark.skipif(not CMB_EXE.is_file(), reason="Cmb.Cli.exe 없음")
@pytest.mark.skipif(shutil.which("node") is None or not PREVIEW_SCRIPT.is_file(), reason="node 또는 Studio 미리보기 스크립트 없음")
def test_engine_matches_studio_preview_for_mass_edits(tmp_path):
    """질량 편집(2026-10-29) — addMasses(원본·새 노드) + changeMasses + deleteMasses 를 무게중심 RBE 와 섞어도 질량 (노드, ton) 이 같다."""
    for name in (f"{BASE}.json", f"{BASE}.bdf"):
        shutil.copy2(FIXTURE / name, tmp_path / name)
    base = json.loads((tmp_path / f"{BASE}.json").read_text(encoding="utf-8"))
    if not _engine_knows(tmp_path, "changeMasses", {"changes": [{"massId": 14, "mass": 0.5}]}):
        pytest.skip("질량 편집 이전 엔진")
    meta = base["meta"]
    next_eid = max(x["id"] for k in ("elements", "rigids", "pointMasses") for x in base[k]) + 1
    ok = {"status": "ok", "warnings": [], "errors": []}
    # 무게중심 RBE 를 질량 추가보다 먼저 기록 — 엔진이 RBE 에 Studio 가 정한 질량 번호를 주면 안 된다.
    intents = [
        {"id": "cog", "kind": "addRigid", "params": {"independentNode": None, "dependentNodes": CENTROID_DEPS,
                                                     "createIndependentAtCentroid": True, "cm": "123456"}},
        {"id": "node", "kind": "addNode", "params": {"nodeId": 900, "x": 90100.0, "y": 4900.0, "z": 38700.0}},
        {"id": "rbe", "kind": "addRigid", "params": {"independentNode": 900, "dependentNodes": [1], "cm": "123456"}},
        {"id": "add", "kind": "addMasses", "params": {"masses": [
            {"massId": next_eid, "nodeId": 4, "mass": 0.8},
            {"massId": next_eid + 1, "nodeId": 900, "mass": 1.25}]}},
        {"id": "chg", "kind": "changeMasses", "params": {"changes": [{"massId": 14, "mass": 0.5}]}},
        {"id": "del", "kind": "deleteMasses", "params": {"massIds": [16]}},
    ]
    doc = {"schemaVersion": "1.0",
           "stageRef": {"phase": meta["phase"], "stageName": meta["stageName"], "sourceTimestamp": meta["timestamp"]},
           "createdAt": "2026-10-29T00:00:00Z", "createdBy": "contract-test",
           "intents": [{**i, "validation": ok} for i in intents]}
    edit_path = tmp_path / f"{BASE}_edit.json"
    edit_path.write_text(json.dumps(doc), encoding="utf-8")

    proc = subprocess.run([str(CMB_EXE), "apply-edit-intent", str(tmp_path)], cwd=tmp_path, capture_output=True, timeout=300)
    assert proc.returncode == 0, proc.stdout.decode("utf-8", "replace") + proc.stderr.decode("utf-8", "replace")
    engine = json.loads((tmp_path / "edited" / f"{BASE}.json").read_text(encoding="utf-8"))
    pv = subprocess.run(["node", str(PREVIEW_SCRIPT), str(tmp_path / f"{BASE}.json"), str(edit_path)],
                        cwd=STUDIO_DIR, capture_output=True, timeout=120)
    assert pv.returncode == 0, pv.stderr.decode("utf-8", "replace")
    preview = json.loads(pv.stdout.decode("utf-8"))

    engine_masses = {str(pm["id"]): [pm["nodeId"], pytest.approx(pm["mass"])] for pm in engine.get("pointMasses", [])}
    assert engine_masses == preview["masses"]
    assert sorted(int(k) for k in engine_masses) == preview["massIds"]
    # 기대 결과 자체도 고정한다(두 쪽이 같이 틀리는 것 방지)
    assert preview["masses"] == {"14": [22, 0.5], str(next_eid): [4, 0.8], str(next_eid + 1): [900, 1.25]}
    assert not {next_eid, next_eid + 1} & {r["id"] for r in engine["rigids"]}   # 무게중심 RBE 가 질량 번호를 가져가지 않았다
    assert 26 in {n["id"] for n in engine["nodes"]}                            # 질량만 지움 — 요소에 걸린 노드
    bdf = (tmp_path / "edited" / f"{BASE}.bdf").read_text(encoding="utf-8")
    assert re.search(rf"(?m)^CONM2\s+{next_eid}\s+4\s", bdf)
    assert re.search(rf"(?m)^CONM2\s+{next_eid + 1}\s+900\s", bdf)
    assert not re.search(r"(?m)^CONM2\s+16\s", bdf)
