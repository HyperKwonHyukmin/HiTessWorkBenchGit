# -*- coding: utf-8 -*-
"""떠 있는 그룹이 왜 안 이어졌는지 두 가설을 확인한다.

가설 1(사용자, 사례 1, 2): 두 부재의 최단 거리 지점에 노드가 없어서 엔진이 못 잡는다.
  → 떠 있는 그룹과 주 구조 사이 최단 거리를 '선분 대 선분'으로 재고, 양쪽 가장 가까운 점이
    부재 끝(노드)인지 중간인지 본다. 엔진의 연결 규칙은 대부분 '자유단 노드'에서 출발한다.
가설 2(사용자, 사례 3): 잇는 부재가 CSV 에 있었는데 양식이 맞지 않아 제외됐다.
  → 간극 근처(최단 선분 둘레)에 제외(ignored, error) 행의 좌표가 있는지 본다.

  python -X utf8 gap_probe.py [--label base_v0]
"""
import argparse
import collections
import glob
import json
import os
import re

import numpy as np

from regress import final_json_path

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_ROOT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "outputs", "mb-engine-regress")
COORD = re.compile(r"X\s*(-?[\d.]+)mm\s*Y\s*(-?[\d.]+)mm\s*Z\s*(-?[\d.]+)mm")
END_TOL = 1.0    # 가장 가까운 점이 끝에서 이 길이(mm) 안이면 '끝(노드)'


def seg_seg(p1, q1, p2, q2):
    """두 선분 사이 최단 거리와 각 선분 위 매개변수 s, t (0..1)."""
    d1, d2, r = q1 - p1, q2 - p2, p1 - p2
    a, e, f = d1 @ d1, d2 @ d2, d2 @ r
    if a <= 1e-9 and e <= 1e-9:
        return float(np.linalg.norm(r)), 0.0, 0.0
    if a <= 1e-9:
        s, t = 0.0, np.clip(f / e, 0, 1)
    else:
        c = d1 @ r
        if e <= 1e-9:
            t, s = 0.0, np.clip(-c / a, 0, 1)
        else:
            b = d1 @ d2
            den = a * e - b * b
            s = np.clip((b * f - c * e) / den, 0, 1) if den > 1e-9 else 0.0
            t = (b * s + f) / e
            if t < 0:
                t, s = 0.0, np.clip(-c / a, 0, 1)
            elif t > 1:
                t, s = 1.0, np.clip((b - c) / a, 0, 1)
    c1, c2 = p1 + s * d1, p2 + t * d2
    return float(np.linalg.norm(c1 - c2)), float(s), float(t)


def where(s, L):
    return "끝" if min(s, 1 - s) * L <= END_TOL else "중간"


def probe(label):
    res = json.load(open(os.path.join(OUT_ROOT, label, "result.json"), encoding="utf-8"))
    out = []
    for r in res["sets"]:
        sid = r["id"]
        d = os.path.join(OUT_ROOT, label, sid)
        m = json.load(open(os.path.join(d, "metrics.json"), encoding="utf-8"))
        fl = m.get("floating") or []
        if not fl:
            continue
        od = sorted(x for x in os.listdir(d) if re.match(r"^\d{8}_\d{6}$", x))[-1]
        od = os.path.join(d, od)
        f = json.load(open(final_json_path(od), encoding="utf-8"))
        audit = json.load(open(os.path.join(od, "00_InputAudit.json"), encoding="utf-8"))
        P = {n["id"]: np.array([n["x"], n["y"], n["z"]], float) for n in f["nodes"]}
        el = {e["id"]: e for e in f["elements"]}
        deg = collections.Counter()
        for e in f["elements"]:
            deg[e["startNode"]] += 1
            deg[e["endNode"]] += 1
        groups = sorted(f["connectivity"]["groups"], key=lambda g: -g["elementCount"])
        gof = {}
        for i, g in enumerate(groups):
            for n in g["nodeIds"]:
                gof[n] = i
        main = [el[x] for x in groups[0]["elementIds"] if x in el]
        MA = np.array([P[e["startNode"]] for e in main])
        MB = np.array([P[e["endNode"]] for e in main])
        # 제외된 행의 좌표들(가설 2)
        excl = []
        for x in audit["rowAudit"]:
            if x["status"] in ("converted",) or x["reasonCode"] in ("blank_line",):
                continue
            pts = [np.array(list(map(float, c))) for c in COORD.findall(x["rawLine"])]
            if pts:
                excl.append((x["reasonCode"], x["kind"], x["physicalLineNumber"], pts))
        for g in fl:
            gi = gof.get(g["node"])
            if gi is None or gi == 0:
                continue
            best = (1e18,)
            for eid in groups[gi]["elementIds"]:
                e = el.get(eid)
                if not e:
                    continue
                a, b = P[e["startNode"]], P[e["endNode"]]
                # 후보를 줄이려고 선분 중점 거리로 가까운 주 구조 40개만 정밀 계산
                mid = (a + b) / 2
                dm = np.linalg.norm((MA + MB) / 2 - mid, axis=1) - np.linalg.norm(MB - MA, axis=1) / 2
                for j in np.argsort(dm)[:40]:
                    dist, s, t = seg_seg(a, b, MA[j], MB[j])
                    if dist < best[0]:
                        best = (dist, e, s, main[j], t)
            dist, e, s, me, t = best
            La = float(np.linalg.norm(P[e["endNode"]] - P[e["startNode"]]))
            Lb = float(np.linalg.norm(P[me["endNode"]] - P[me["startNode"]]))
            wa, wb = where(s, La), where(t, Lb)
            na = e["startNode"] if s < 0.5 else e["endNode"]
            free = (wa == "끝" and deg[na] == 1)
            ca = P[e["startNode"]] + s * (P[e["endNode"]] - P[e["startNode"]])
            cb = P[me["startNode"]] + t * (P[me["endNode"]] - P[me["startNode"]])
            # 간극 둘레(최단 선분 중점에서 간극 + 300 mm 안)에 제외 행 좌표가 있나
            mid = (ca + cb) / 2
            rad = dist / 2 + 300
            near_ex = sorted({(rc, k, ln) for rc, k, ln, pts in excl if any(np.linalg.norm(p - mid) <= rad for p in pts)})
            out.append({"set": sid, "cat": g["cat"], "division": g.get("division"), "elements": g["elements"],
                        "nodeGap": g["gap"], "segGap": round(dist), "floatSide": wa, "mainSide": wb,
                        "floatSideFreeEnd": free, "within": dist <= g["radius"], "radius": g["radius"],
                        "excludedNear": near_ex[:6], "node": g["node"],
                        "floatSource": e.get("sourceName"), "mainSource": me.get("sourceName")})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="base_v0")
    a = ap.parse_args()
    rows = probe(a.label)
    json.dump(rows, open(os.path.join(OUT_ROOT, a.label, "gap_probe.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    c = collections.Counter()
    for r in rows:
        key = f"{r['cat']}: 떠 있는 쪽 {r['floatSide']}{'(자유단)' if r['floatSideFreeEnd'] else ''} / 주 구조 쪽 {r['mainSide']}"
        c[key] += 1
        if r["cat"] == "구조" and r["segGap"] <= r["radius"]:
            c["구조: 선분 거리로 반경 안"] += 1
        if r["excludedNear"]:
            c[f"{r['cat']}: 간극 둘레에 제외 행 있음"] += 1
            for rc, _, _ in r["excludedNear"]:
                c[f"   제외 사유 {rc}"] += 1
        if r["segGap"] + 20 < r["nodeGap"]:
            c[f"{r['cat']}: 선분 거리가 노드 거리보다 20 mm 넘게 짧음"] += 1
    for k, v in sorted(c.items()):
        print(f"{v:5d}  {k}")
    print("전체", len(rows))


if __name__ == "__main__":
    main()
