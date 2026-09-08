"""실측 결과 폴더를 테스트용으로 축소 복사한다. (1회 실행, 산출 JSON 을 커밋)

python tests/fixtures/unit_lifting_report/build_fixture.py <결과폴더> <stem>
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
KEEP_MEMBERS, KEEP_DISP, KEEP_ELEMENTS = 60, 80, 300


def _load(folder, name):
    with open(os.path.join(folder, name), encoding="utf-8") as fh:
        return json.load(fh)


def _dump(name, obj):
    with open(os.path.join(HERE, name), "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1)


def _relativize(obj):
    """절대 경로 문자열을 basename 으로 바꾼다(fixture 는 폴더 위치와 무관해야 한다)."""
    if isinstance(obj, dict):
        return {k: _relativize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_relativize(v) for v in obj]
    if isinstance(obj, str) and ("\\userConnection\\" in obj or "/userConnection/" in obj):
        return os.path.basename(obj.replace("\\", "/"))
    return obj


def main(folder, stem):
    result = _load(folder, f"{stem}_lifting_nastranResult.json")
    edited = _load(folder, f"{stem}_edited.json")
    original = _load(folder, f"{stem}.json")

    members = sorted(result["members"], key=lambda m: -(m.get("utilization") or 0))[:KEEP_MEMBERS]
    keep_elem = {m["elementId"] for m in members}
    lug_nodes = {w["lugNodeId"] for w in result["wires"]}
    for el in edited["elements"]:
        if len(keep_elem) >= KEEP_ELEMENTS:
            break
        if el["startNode"] in lug_nodes or el["endNode"] in lug_nodes:
            keep_elem.add(el["id"])
    for el in edited["elements"]:
        if len(keep_elem) >= KEEP_ELEMENTS:
            break
        keep_elem.add(el["id"])
    elements = [el for el in edited["elements"] if el["id"] in keep_elem]
    keep_nodes = {n for el in elements for n in (el["startNode"], el["endNode"])} | lug_nodes
    nodes = [n for n in edited["nodes"] if n["id"] in keep_nodes]
    disp = sorted(result["displacements"], key=lambda d: -d["magnitude"])
    disp = [d for d in disp if d["nodeId"] in keep_nodes][:KEEP_DISP]

    result["members"] = members
    result["displacements"] = disp
    edited["elements"] = elements
    edited["nodes"] = nodes
    edited["rigids"] = [r for r in edited["rigids"] if r["independentNode"] in keep_nodes][:20]
    edited["pointMasses"] = [p for p in edited["pointMasses"] if p["nodeId"] in keep_nodes]
    # 원본은 편집 비교용: 축소본 요소 + '삭제됐다고 가정할' 요소 3개를 더 넣어 차이를 만든다.
    orig_extra = [el for el in original["elements"] if el["id"] not in keep_elem][:3]
    original["elements"] = elements + orig_extra
    original["nodes"] = nodes
    original["rigids"] = edited["rigids"] + [r for r in original["rigids"] if r["independentNode"] in keep_nodes][20:22]
    original["pointMasses"] = edited["pointMasses"]

    _dump(f"{stem}_lifting_nastranResult.json", _relativize(result))
    _dump(f"{stem}_edited.json", _relativize(edited))
    _dump(f"{stem}.json", _relativize(original))
    for name in ("_stability.json", "_lifting_meta.json", "_posture.json",
                 "_hoist_optimization.json", "_validation_step1.json"):
        _dump(f"{stem}{name}", _relativize(_load(folder, f"{stem}{name}")))
    print("fixture written:", HERE)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
