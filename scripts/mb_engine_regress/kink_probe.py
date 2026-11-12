"""꺾인 U-bolt RBE 원인 조사 (계획서 B8).

결과 폴더(regress.py run 산출)의 phase JSON 을 차례로 읽어, 최종 모델에서 꺾인 U-bolt RBE 가
어느 phase 에서 처음 꺾였는지, 꺾임 모양이 어떤지(구조 쪽 점이 부재 끝에 걸림 / 배관 쪽 점이 배관 요소 끝에 걸림)
를 센다.

한계: 단계마다 (RBE id, 종속 노드 id) 로 맞추므로, 뒤 단계의 RBE 병합·노드 병합으로 id 가 바뀐 것은
더 앞 단계부터 꺾여 있었어도 'final-only' 나 뒤 단계로 셀 수 있다(첫 단계 수는 하한).

사용: python -X utf8 kink_probe.py <label> [--limit N]
"""
import collections
import glob
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from regress import final_json_path  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "outputs", "mb-engine-regress")
SIN10 = math.sin(math.radians(10))


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def kinked(d):
    P = {n["id"]: np.array([n["x"], n["y"], n["z"]], float) for n in d["nodes"]}
    axis = collections.defaultdict(list)
    cat = collections.defaultdict(set)
    elems_at = collections.defaultdict(list)
    for e in d["elements"]:
        a, b = e["startNode"], e["endNode"]
        cat[a].add(e["category"]); cat[b].add(e["category"])
        elems_at[a].append(e); elems_at[b].append(e)
        if e["category"] == "Pipe" and a in P and b in P:
            v = P[b] - P[a]
            L = np.linalg.norm(v)
            if L > 1e-6:
                axis[a].append(v / L); axis[b].append(v / L)
    out = {}
    for r in d["rigids"]:
        if not (r.get("remark") or "").upper().startswith("UBOLT"):
            continue
        ind = r["independentNode"]
        for n in r["dependentNodes"]:
            ax = axis.get(ind) or axis.get(n)
            if not ax or ind not in P or n not in P:
                continue
            v = P[n] - P[ind]
            L = float(np.linalg.norm(v))
            if L <= 1.0:
                continue
            s = min(abs(float(np.dot(v / L, a))) for a in ax)
            if s > SIN10:
                out[(r["id"], n)] = {
                    "deg": math.degrees(math.asin(min(1.0, s))), "len": L,
                    "indCats": sorted(cat[ind]), "depCats": sorted(cat[n]),
                    "indPipeElems": sum(1 for e in elems_at[ind] if e["category"] == "Pipe"),
                    "depStruElems": sum(1 for e in elems_at[n] if e["category"] == "Structure"),
                    "ind": ind, "dep": n,
                }
    return out


def main():
    label = sys.argv[1]
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else 10**9
    first_phase = collections.Counter()
    shapes = collections.Counter()
    deg_hist = collections.Counter()
    total = 0
    examples = []
    for case in sorted(glob.glob(os.path.join(ROOT, label, "*", "*", "")))[:limit]:
        phases = sorted(glob.glob(os.path.join(case, "[0-9][0-9]_*.json")))
        phases = [p for p in phases if not os.path.basename(p).startswith("00_")]
        final = final_json_path(case)
        if not final:
            continue
        fin = kinked(load(final))
        if not fin:
            continue
        per_phase = [(os.path.basename(p), kinked(load(p))) for p in phases]
        for key, info in fin.items():
            total += 1
            fp = next((name for name, k in per_phase if key in k), "final-only")
            first_phase[fp] += 1
            shape = (f"ind {'+'.join(info['indCats'])} pipeElems={info['indPipeElems']} | "
                     f"dep {'+'.join(info['depCats']) or '-'} struElems={info['depStruElems']}")
            shapes[shape] += 1
            deg_hist[min(90, int(info["deg"] // 10) * 10)] += 1
            if len(examples) < 12:
                examples.append((case.split(os.sep)[-3], key, round(info["deg"]), round(info["len"]), fp, shape))
    print("꺾인 U-bolt RBE", total)
    print("처음 꺾인 phase:", dict(first_phase))
    print("각도(10° 구간):", dict(sorted(deg_hist.items())))
    print("모양:")
    for s, c in shapes.most_common(15):
        print(f"  {c:5d}  {s}")
    print("예:")
    for e in examples:
        print("  ", e)


if __name__ == "__main__":
    main()
