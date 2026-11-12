# -*- coding: utf-8 -*-
"""1단계 원인 확정용 사례 그림 — 사례마다 노드 주변을 입체 + 평면 3방향으로 그린다.

  python -X utf8 case_figures.py [--label base_v0]
결과: outputs/mb-engine-regress/<label>/stage1_cases/index.html (로컬에서 연다, 사내 좌표라 외부에 올리지 않는다)
"""
import argparse
import collections
import glob
import html
import json
import os
import re

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from regress import final_json_path

plt.rcParams["font.family"] = "Malgun Gothic"
plt.rcParams["axes.unicode_minus"] = False

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_ROOT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "outputs", "mb-engine-regress")

# (번호, 유형, 묶음, 노드) — 계획서 1단계 검토 사례 표와 같다
CASES = [
    (1, "A 구조, 반경 안인데 안 이어짐", "3596-161b76b9", 1590),
    (2, "A 구조, 반경 안인데 안 이어짐", "3469-1b41eb0c", 738),
    (3, "B 구조, 서포트(SUPP) 조립품", "3596-161b76b9", 1460),
    (4, "B 구조, 서포트(SUPP) 조립품", "3476-4b652283", 6401),
    (5, "C 구조, 의장(OUTF) 조립품", "3454-98e6df58", 299),
    (6, "C 구조, 의장(OUTF) 조립품", "3476-4b652283", 4066),
    (7, "D 구조, GENSEC(division 빈칸)", "3476-c74d65be", 2738),
    (8, "D 구조, GENSEC(division 빈칸)", "3476-c74d65be", 10749),
    (9, "E 구조, 1 m 넘게 떨어짐", "3596-785bda43", 37),
    (10, "E 구조, 1 m 넘게 떨어짐", "3596-ab4b8793", 721),
    (11, "F 배관, 다른 배관과 100 mm 안에서 끊김", "3596-29bb039c", 130),
    (12, "F 배관, 다른 배관과 100 mm 안에서 끊김", "3615-66923046", 1663),
    (13, "G 배관, 받칠 구조가 멂", "3615-7c2e5547", 285),
    (14, "G 배관, 받칠 구조가 멂", "3476-4b652283", 10417),
    (15, "H 배관, 구조와 100~600 mm", "3596-ab4b8793", 406),
    (16, "꺾인 U-bolt RBE", "8242-fa993eaa", 397),
]

C_MAIN_S, C_MAIN_P, C_FLOAT, C_OTHER = "#7a8597", "#4a90d9", "#e03131", "#f2a541"
C_RBE, C_UBOLT = "#2f9e44", "#0b7285"


def load_model(set_dir):
    od = sorted(x for x in os.listdir(set_dir) if re.match(r"^\d{8}_\d{6}$", x))[-1]
    od = os.path.join(set_dir, od)
    fp = final_json_path(od)
    f = json.load(open(fp, encoding="utf-8"))
    audit = json.load(open(os.path.join(od, "00_InputAudit.json"), encoding="utf-8"))
    return f, audit


def seg_point(p, a, b):
    ab = b - a
    t = np.clip(np.dot(p - a, ab) / max(np.dot(ab, ab), 1e-9), 0, 1)
    return a + t * ab


def draw_case(no, kind, sid, node, out_dir, label):
    set_dir = os.path.join(OUT_ROOT, label, sid)
    f, audit = load_model(set_dir)
    P = {n["id"]: np.array([n["x"], n["y"], n["z"]], float) for n in f["nodes"]}
    el = {e["id"]: e for e in f["elements"]}
    groups = sorted(f["connectivity"]["groups"], key=lambda g: -g["elementCount"])
    gid = {}
    for i, g in enumerate(groups):
        for n in g["nodeIds"]:
            gid[n] = i
    c = P[node]
    my = gid.get(node, 0)

    # 가장 가까운 주 구조 지점(떠 있는 그룹일 때)
    near, near_el = None, None
    if my != 0:
        best = 1e18
        mine = set(groups[my]["nodeIds"])
        for e in (el[x] for x in groups[0]["elementIds"] if x in el):
            for n in mine:
                q = seg_point(P[n], P[e["startNode"]], P[e["endNode"]])
                d = float(np.linalg.norm(q - P[n]))
                if d < best:
                    best, near, near_el, c_node = d, q, e, n
        node, c = c_node, P[c_node]
    gap = float(np.linalg.norm(near - c)) if near is not None else 0.0

    # 사례 16: 꺾인 U-bolt RBE 를 보여 준다
    focus_rbe = None
    if kind.startswith("꺾인"):
        for r in f["rigids"]:
            if r["independentNode"] == node:
                focus_rbe = r
                break

    R = max(1500.0, gap * 2.5) if gap < 3000 else gap * 1.3
    if focus_rbe:
        R = 900.0
    lo, hi = c - R, c + R

    def inside(p):
        return np.all(p >= lo) and np.all(p <= hi)

    segs = []   # (p, q, color, lw, ls, zorder)
    for e in f["elements"]:
        a, b = P[e["startNode"]], P[e["endNode"]]
        if not (inside(a) or inside(b)):
            continue
        g = gid.get(e["startNode"], -1)
        if g == my and my != 0:
            col, lw, z = C_FLOAT, 2.6, 5
        elif g == 0:
            col, lw, z = (C_MAIN_P if e["category"] == "Pipe" else C_MAIN_S), 1.4, 3
        else:
            col, lw, z = C_OTHER, 1.6, 4
        segs.append((a, b, col, lw, "-", z))
    for r in f["rigids"]:
        ind = r["independentNode"]
        if ind not in P:
            continue
        is_u = (r.get("remark") or "").upper().startswith("UBOLT")
        for d in r["dependentNodes"]:
            if d in P and (inside(P[ind]) or inside(P[d])):
                hl = focus_rbe is not None and r["id"] == focus_rbe["id"]
                segs.append((P[ind], P[d], "#d6336c" if hl else (C_UBOLT if is_u else C_RBE), 2.4 if hl else 1.1, "-", 6 if hl else 4))

    fig = plt.figure(figsize=(15, 11))
    views = [("입체", None), ("위에서 (X-Y)", (0, 1)), ("옆에서 (X-Z)", (0, 2)), ("앞에서 (Y-Z)", (1, 2))]
    for i, (title, axes) in enumerate(views):
        if axes is None:
            ax = fig.add_subplot(2, 2, 1, projection="3d")
            for a, b, col, lw, ls, z in segs:
                ax.plot([a[0], b[0]], [a[1], b[1]], [a[2], b[2]], color=col, lw=lw, ls=ls)
            ax.scatter(*c, color=C_FLOAT, s=50, depthshade=False)
            if near is not None:
                ax.plot([c[0], near[0]], [c[1], near[1]], [c[2], near[2]], color="k", lw=1.5, ls="--")
                ax.scatter(*near, color="k", marker="x", s=60, depthshade=False)
            ax.set_xlim(lo[0], hi[0]); ax.set_ylim(lo[1], hi[1]); ax.set_zlim(lo[2], hi[2])
            ax.set_box_aspect((1, 1, 1))
            ax.view_init(elev=25, azim=-60)
            ax.set_xlabel("X"); ax.set_ylabel("Y"); ax.set_zlabel("Z")
            ax.tick_params(labelsize=7)
        else:
            ax = fig.add_subplot(2, 2, i + 1)
            u, v = axes
            for a, b, col, lw, ls, z in segs:
                ax.plot([a[u], b[u]], [a[v], b[v]], color=col, lw=lw, ls=ls, zorder=z)
            ax.scatter([c[u]], [c[v]], color=C_FLOAT, s=40, zorder=8)
            if near is not None:
                ax.plot([c[u], near[u]], [c[v], near[v]], color="k", lw=1.4, ls="--", zorder=9)
                ax.scatter([near[u]], [near[v]], color="k", marker="x", s=50, zorder=9)
            ax.set_xlim(lo[u], hi[u]); ax.set_ylim(lo[v], hi[v])
            ax.set_aspect("equal")
            ax.set_xlabel("XYZ"[u] + " (mm)"); ax.set_ylabel("XYZ"[v] + " (mm)")
            ax.tick_params(labelsize=7)
            ax.grid(alpha=0.25)
        ax.set_title(title, fontsize=11)
    from matplotlib.lines import Line2D
    leg = [Line2D([], [], color=C_FLOAT, lw=2.6, label="이 사례의 떠 있는 그룹"),
           Line2D([], [], color=C_MAIN_S, lw=1.4, label="주 구조(구조)"),
           Line2D([], [], color=C_MAIN_P, lw=1.4, label="주 구조(배관)"),
           Line2D([], [], color=C_OTHER, lw=1.6, label="다른 떠 있는 그룹"),
           Line2D([], [], color=C_UBOLT, lw=1.1, label="U-bolt RBE"),
           Line2D([], [], color=C_RBE, lw=1.1, label="그 밖 RBE"),
           Line2D([], [], color="k", lw=1.4, ls="--", label=f"간극 {gap:.0f} mm")]
    if focus_rbe:
        leg.append(Line2D([], [], color="#d6336c", lw=2.4, label=f"이 사례의 U-bolt RBE {focus_rbe['id']}"))
    fig.legend(handles=leg, loc="lower center", ncol=4, fontsize=10, frameon=False)
    fig.suptitle(f"사례 {no}. {kind} — {sid}, N{node}, 보는 범위 ±{R:.0f} mm", fontsize=14)
    fig.tight_layout(rect=(0, 0.05, 1, 0.96))
    png = f"case{no:02d}.png"
    fig.savefig(os.path.join(out_dir, png), dpi=95)
    plt.close(fig)

    # 원인 CSV 줄: 떠 있는 그룹 부재들의 출처 + 가장 가까운 주 구조 부재의 출처
    rows_by_name = collections.defaultdict(list)
    for x in audit["rowAudit"]:
        rows_by_name[x["name"].strip()].append(x)
    names = []
    if my != 0:
        for e in groups[my]["elementIds"]:
            s = (el[e].get("sourceName") or "").strip() if e in el else ""
            if s and s not in names:
                names.append(s)
    if focus_rbe and focus_rbe.get("sourceName"):
        names.append(focus_rbe["sourceName"].strip())
    tgt = (near_el.get("sourceName") or "").strip() if near_el else ""
    lines = []
    for s in names[:8]:
        for x in rows_by_name.get(s, [])[:2]:
            lines.append(("떠 있는 쪽", x["kind"], x["physicalLineNumber"], x["rawLine"]))
    if tgt:
        for x in rows_by_name.get(tgt, [])[:2]:
            lines.append(("가장 가까운 주 구조", x["kind"], x["physicalLineNumber"], x["rawLine"]))
    info = {"no": no, "kind": kind, "sid": sid, "node": node, "gap": round(gap), "png": png,
            "floatElems": groups[my]["elementCount"] if my != 0 else 0, "moreNames": max(0, len(names) - 8),
            "lines": lines, "inputs": None}
    return info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="base_v0")
    a = ap.parse_args()
    out_dir = os.path.join(OUT_ROOT, a.label, "stage1_cases")
    os.makedirs(out_dir, exist_ok=True)
    res = json.load(open(os.path.join(OUT_ROOT, a.label, "result.json"), encoding="utf-8"))
    inputs = {r["id"]: r["inputs"] for r in res["sets"]}
    infos = []
    for no, kind, sid, node in CASES:
        info = draw_case(no, kind, sid, node, out_dir, a.label)
        info["inputs"] = inputs.get(sid, {})
        infos.append(info)
        print(f"사례 {no} 완료 (간극 {info['gap']} mm)", flush=True)

    H = ["<!doctype html><html lang='ko'><head><meta charset='utf-8'><title>MB 엔진 1단계 사례</title>",
         "<style>body{font-family:'Malgun Gothic',sans-serif;max-width:1500px;margin:20px auto;padding:0 16px;color:#1f2937}"
         "section{border-top:2px solid #cbd5e1;padding:18px 0 28px}h2{margin:0 0 6px;font-size:20px}"
         "img{width:100%;border:1px solid #e2e8f0}table{border-collapse:collapse;font-size:12px;width:100%;margin-top:8px}"
         "td,th{border:1px solid #e2e8f0;padding:4px 6px;text-align:left;vertical-align:top}td.raw{font-family:Consolas,monospace;word-break:break-all}"
         ".meta{color:#475569;font-size:14px}.ask{background:#fff7ed;border:1px solid #fdba74;padding:8px 12px;margin-top:8px;font-size:14px}"
         "nav a{margin-right:10px}</style></head><body>",
         "<h1>Model Builder 엔진 1단계 — 떠 있는 그룹 원인 확정 사례 16개</h1>",
         f"<p class='meta'>기준선 {html.escape(a.label)}. 빨강 = 주 구조와 이어지지 않은 그룹, 회색 = 주 구조, 파랑 = 주 구조의 배관, 검은 점선 = 가장 가까운 주 구조 지점까지의 간극. "
         "사례마다 <b>편심 / 판 누락 / CSV 행 누락 / 엔진 버그 / 원래 따로인 것</b> 중 하나로 판정해 주세요.</p><nav>"]
    H += [f"<a href='#c{i['no']}'>{i['no']}</a>" for i in infos]
    H.append("</nav>")
    for i in infos:
        inp = ", ".join(f"{k}: {html.escape(v)}" for k, v in i["inputs"].items())
        H.append(f"<section id='c{i['no']}'><h2>사례 {i['no']}. {html.escape(i['kind'])}</h2>")
        H.append(f"<div class='meta'>묶음 {i['sid']} · 입력 {inp}<br>노드 N{i['node']} · 떠 있는 그룹 요소 {i['floatElems']}개 · 간극 {i['gap']} mm</div>")
        H.append(f"<img src='{i['png']}' alt='사례 {i['no']}'>")
        H.append("<table><tr><th>구분</th><th>CSV</th><th>줄</th><th>원문</th></tr>")
        for side, kind, ln, raw in i["lines"]:
            H.append(f"<tr><td>{side}</td><td>{kind}</td><td>{ln}</td><td class='raw'>{html.escape(raw)}</td></tr>")
        H.append("</table>")
        if i["moreNames"]:
            H.append(f"<div class='meta'>떠 있는 그룹의 다른 CSV name {i['moreNames']}개 생략</div>")
        H.append("<div class='ask'>판정: 편심 / 판 누락 / CSV 행 누락 / 엔진 버그 / 원래 따로인 것 / 기타 — </div></section>")
    H.append("</body></html>")
    page = os.path.join(out_dir, "index.html")
    open(page, "w", encoding="utf-8").write("\n".join(H).replace(" · ", ", "))
    print(page)


if __name__ == "__main__":
    main()
