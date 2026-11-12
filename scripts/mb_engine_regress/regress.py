# -*- coding: utf-8 -*-
"""Model Builder 엔진 회귀 측정 장치.

수집한 실제 CSV 묶음마다 엔진(build-full)을 돌리고, 사용자가 받는 BDF 그대로 Nastran 을 돌려
'바로 해석되는 모델인가'를 숫자로 낸다. 두 실행 결과를 비교해 무엇이 바뀌었는지도 보여 준다.

  python -X utf8 regress.py run --exe <Cmb.Cli.exe> --label <이름> [--no-nastran] [--only id,id]
  python -X utf8 regress.py compare <기준 폴더> <새 폴더>
  python -X utf8 regress.py remeasure --label <이름>     (엔진, Nastran 을 다시 돌리지 않고 지표만 다시 계산)

계획서: docs/plans/2026-11-12-modelbuilder-engine-overhaul-plan.md (4절 지표, 5절 0단계)
시험 자료(CSV)는 저장소에 넣지 않는다 — --corpus 또는 환경 변수 MB_CSV_CORPUS 로 가리킨다.
"""
import argparse
import collections
import csv
import datetime
import glob
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DEFAULT_CORPUS = os.environ.get("MB_CSV_CORPUS", r"E:\HiTESS\ModelBuilderCsv")
DEFAULT_EXE = os.path.join(REPO, "HiTessWorkBenchBackEnd", "InHouseProgram", "HiTessModeBuilder", "Cmb.Cli.exe")
DEFAULT_OUT = os.path.join(REPO, "outputs", "mb-engine-regress")
NASTRAN = r"C:\MSC.Software\MSC_Nastran\20131\bin\nastran.exe"
KINDS = ("stru", "pipe", "equip")

# 화면 기본값과 같은 엔진 옵션. --run-nastran 은 쓰지 않는다: 그 옵션은 떨어진 그룹마다 SPC 를 덧붙여
# 떨어진 모델도 해석이 되게 만든다. 여기서는 사용자가 받는 BDF 를 그대로 푼다.
ENGINE_OPTS = ["--mesh-size", "500", "--ubolt-full-fix"]
OVER_DISP_MM = 500      # 자중 최대 변위가 이보다 크면 '과대 변위'(사람 검토에서 U-bolt 누락 모델이 2,574~7,800 mm)
ZERO_HZ = 1e-3          # 이보다 낮으면 강체(또는 기구) 모드로 센다
FREEFREE_MODES = 12     # 6개가 정상. 12개를 다 채우면 '12개 이상'
GAP_BUCKETS = ((50, "≤50"), (100, "≤100"), (300, "≤300"), (1000, "≤1000"))
VANISH_TOL_MM = 5.0     # CSV 행 축선 위 표본점이 이 거리 안에 모델 부재가 없으면 '없음'
COORD = re.compile(r"X\s*(-?[\d.]+)mm\s*Y\s*(-?[\d.]+)mm\s*Z\s*(-?[\d.]+)mm")


# ───────────────────────── 시험 자료 ─────────────────────────

def load_sets(corpus):
    """manifest.csv 의 실행(source_folder)마다 파일 묶음을 만들고 내용이 같은 묶음은 하나로 줄인다."""
    rows = list(csv.DictReader(open(os.path.join(corpus, "manifest.csv"), encoding="utf-8-sig")))
    stored = {r["sha256"]: os.path.join(corpus, r["stored_path"]) for r in rows if r["stored_path"]}
    runs = collections.defaultdict(list)
    for r in rows:
        runs[r["source_folder"]].append(r)
    sets, skipped = {}, 0
    for folder, rs in sorted(runs.items()):
        files, ok = {}, True
        for r in rs:
            if r["kind"] not in KINDS:
                continue
            p = stored.get(r["sha256"])
            if not p or not os.path.isfile(p):
                ok = False
                break
            files[r["kind"]] = {"path": p, "name": r["original_name"], "sha": r["sha256"]}
        if not ok:
            skipped += 1
            continue
        if "stru" not in files and "pipe" not in files:
            continue
        hull = next((r["hull_no"] for r in rs if r["hull_no"]), "") or "nohull"
        sig = "|".join(f"{k}:{files[k]['sha']}" for k in sorted(files))
        sid = f"{hull}-{hashlib.sha256(sig.encode()).hexdigest()[:8]}"
        sets.setdefault(sid, {"id": sid, "hull": hull, "files": files, "firstRun": folder})
    return list(sets.values()), skipped


# ───────────────────────── 기하 ─────────────────────────

def seg_dist(P, A, B):
    """점들 P 에서 선분들 A-B 까지 가장 가까운 거리와 그 선분 번호."""
    AB = B - A
    L2 = np.maximum((AB * AB).sum(1), 1e-9)
    best = np.full(len(P), 1e18)
    arg = np.zeros(len(P), dtype=int)
    for i in range(0, len(P), 256):
        p = P[i:i + 256][:, None, :]
        t = np.clip(((p - A[None]) * AB[None]).sum(2) / L2[None], 0, 1)
        d = np.linalg.norm(p - (A[None] + t[..., None] * AB[None]), axis=2)
        j = d.argmin(1)
        best[i:i + 256] = d[np.arange(len(j)), j]
        arg[i:i + 256] = j
    return best, arg


def max_dim(prop):
    """단면에서 가장 큰 치수(mm). Tube, Rod 의 첫 치수는 반지름이라 지름으로 바꾼다."""
    if not prop:
        return 0.0
    dims = [x for x in (prop.get("dims") or []) if isinstance(x, (int, float))]
    if not dims:
        return 0.0
    if (prop.get("kind") or "").upper() in ("TUBE", "ROD"):
        return 2 * dims[0]
    return max(dims)


def bucket(gap):
    for lim, name in GAP_BUCKETS:
        if gap <= lim:
            return name
    return ">1000"


# ───────────────────────── 엔진 결과 → 지표 ─────────────────────────

def final_json_path(outdir):
    """최종 모델 JSON = 이름이 숫자로 시작하지 않고, 같은 이름의 BDF 가 있는 JSON(엔진 최종 산출물 쌍)."""
    bdf_stems = {os.path.splitext(os.path.basename(x))[0]
                 for x in glob.glob(os.path.join(outdir, "*.bdf")) if not os.path.basename(x)[0].isdigit()}
    c = [x for x in sorted(glob.glob(os.path.join(outdir, "*.json")))
         if not os.path.basename(x)[0].isdigit() and os.path.splitext(os.path.basename(x))[0] in bdf_stems]
    return c[0] if c else None


def bdf_hash(path):
    h = hashlib.sha1()
    for line in open(path, encoding="latin-1"):
        if not line.startswith("$"):
            h.update(line.rstrip().encode("latin-1"))
            h.update(b"\n")
    return h.hexdigest()[:16]


def fnum(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def vanished_structure_rows(audit, A, B):
    """'converted' 로 기록된 구조 행 중 형상이 최종 모델에 통째로 없는 행.

    행의 poss→pose 축선 위 5점(10~90%)이 모두 모델 부재에서 VANISH_TOL_MM 넘게 떨어져 있으면 '없음'.
    이름이 아니라 형상으로 본다 — 같은 선 위 부재를 합칠 때 다른 이름 하나만 남는 경우가 있어서.
    """
    out = []
    if len(A) == 0:
        return out
    for x in audit["rowAudit"]:
        if x["status"] != "converted" or x["kind"] != "Structure":
            continue
        pts = [np.array(list(map(float, m))) for m in COORD.findall(x["rawLine"])]
        if len(pts) < 3:
            continue
        p0, p1 = pts[1], pts[2]
        samples = np.array([p0 + (p1 - p0) * t for t in (0.1, 0.3, 0.5, 0.7, 0.9)])
        d, _ = seg_dist(samples, A, B)
        if float(d.min()) > VANISH_TOL_MM:
            out.append({"line": x["physicalLineNumber"], "name": x["name"].strip(),
                        "lengthMm": round(float(np.linalg.norm(p1 - p0))),
                        "size": (x["rawFields"].get("size") or "").strip(),
                        "division": (x["rawFields"].get("division") or "").strip()})
    return out


def model_metrics(outdir):
    """엔진 산출 폴더 하나에서 지표와 상세(떠 있는 그룹, RBE 목록)를 뽑는다."""
    m, detail = {}, {"floating": [], "rigids": []}
    audit = json.load(open(os.path.join(outdir, "00_InputAudit.json"), encoding="utf-8"))
    s = audit["summary"]
    m["rows"] = s["totalDataRows"]
    m["ignoredByReason"] = s.get("ignoredByReason", {})
    err = collections.Counter()
    dropped_kg, dropped_rows = 0.0, 0
    struct_row = {}
    for x in audit["rowAudit"]:
        if x["status"] not in ("converted", "ignored"):
            err[x["reasonCode"]] += 1
        if x["reasonCode"] == "equipment_mass_not_attached":
            dropped_rows += 1
            dropped_kg += fnum(x["rawFields"].get("mass"))
        if x["kind"] == "Structure":
            rf = x["rawFields"]
            struct_row.setdefault(x["name"].strip(), ((rf.get("division") or "").strip() or "(빈칸)", (rf.get("stru") or "").strip()))
    m["errorByReason"] = dict(err)
    m["errorRows"] = sum(err.values())
    m["droppedMassRows"] = dropped_rows
    m["droppedMassKg"] = round(dropped_kg, 1)

    ss = json.load(open(os.path.join(outdir, "00_StageSummary.json"), encoding="utf-8"))
    m["totalMassTon"] = round((ss["summary"].get("massProperties") or {}).get("totalMassTon") or 0.0, 4)

    # 단계별 진단에서 '노이즈 제거' 로 지운 요소 수
    noise = 0
    for fp in glob.glob(os.path.join(outdir, "0[1-9]_*.json")):
        try:
            for g in json.load(open(fp, encoding="utf-8")).get("diagnostics", []):
                if g.get("code") == "NOISE_REMOVED":
                    mm = re.match(r"(\d+)", g.get("message") or "")
                    noise += int(mm.group(1)) if mm else 0
        except (OSError, ValueError):
            pass
    m["noiseRemovedElements"] = noise

    fp = final_json_path(outdir)
    if not fp:
        m["noFinalModel"] = True
        return m, detail
    f = json.load(open(fp, encoding="utf-8"))
    bdf = os.path.splitext(fp)[0] + ".bdf"
    m["finalBdf"] = bdf if os.path.isfile(bdf) else None
    m["bdfHash"] = bdf_hash(bdf) if os.path.isfile(bdf) else None

    P = {n["id"]: np.array([n["x"], n["y"], n["z"]], float) for n in f["nodes"]}
    el = {e["id"]: e for e in f["elements"]}
    prop = {p["id"]: p for p in f["properties"]}
    m["nodes"], m["elements"], m["rigids"] = len(P), len(el), len(f["rigids"])
    m["pointMasses"] = len(f.get("pointMasses") or [])
    m["boundaryNodes"] = sum(1 for n in f["nodes"] if "Boundary" in (n.get("tags") or []))
    m["orphanNodes"] = sum(1 for n in f["nodes"] if "Orphan" in (n.get("tags") or []))
    dc = collections.Counter(f"{d['severity']}:{d['code']}" for d in f["diagnostics"])
    m["diag"] = dict(dc)
    m["enginePassed"] = (f.get("validationResult") or {}).get("passed")

    # 사라진 구조 행(형상 기준)
    EA = np.array([P[e["startNode"]] for e in f["elements"]]) if f["elements"] else np.zeros((0, 3))
    EB = np.array([P[e["endNode"]] for e in f["elements"]]) if f["elements"] else np.zeros((0, 3))
    vanished = vanished_structure_rows(audit, EA, EB)
    m["vanishedStructureRows"] = len(vanished)
    detail["vanished"] = vanished

    # 노드가 어느 종류 부재에 붙어 있는지
    ncat = collections.defaultdict(set)
    deg = collections.Counter()
    pipe_axis = {}            # 노드 → 그 노드에 붙은 배관 요소 축들(단위 벡터, 굽힘 노드는 여럿)
    elem_pairs = set()
    for e in f["elements"]:
        a, b = e["startNode"], e["endNode"]
        elem_pairs.add(frozenset((a, b)))
        for n in (a, b):
            ncat[n].add(e["category"])
            deg[n] += 1
        if e["category"] == "Pipe" and a in P and b in P:
            v = P[b] - P[a]
            L = float(np.linalg.norm(v))
            if L > 1e-6:
                pipe_axis.setdefault(a, []).append(v / L)
                pipe_axis.setdefault(b, []).append(v / L)

    # 사람 검토 지적(Equivalence 안 됨): 1 mm 안에 겹친 별개 노드 쌍
    ids = list(P)
    if len(ids) > 1:
        from scipy.spatial import cKDTree
        pairs = cKDTree(np.array([P[i] for i in ids])).query_pairs(1.0)
        m["coincidentNodePairs"] = len(pairs)
        detail["coincident"] = [[ids[i], ids[j]] for i, j in list(pairs)[:200]]
    else:
        m["coincidentNodePairs"] = 0

    # RBE 지표
    by_remark, span_max = collections.Counter(), collections.defaultdict(float)
    on_rbe, max_dep, pipe_stru_non_ubolt = set(), 0, 0
    ubolt_nodes = set()
    rbe_on_element, kinked_ubolt = 0, 0
    for r in f["rigids"]:
        remark = r.get("remark") or "?"
        ind, deps = r["independentNode"], list(r["dependentNodes"])
        ns = [ind] + deps
        on_rbe.update(ns)
        # 사람 검토 지적: 같은 두 노드를 요소와 RBE 가 함께 잇는다
        rbe_on_element += sum(1 for n in deps if frozenset((ind, n)) in elem_pairs)
        # 사람 검토 지적: 꺾인 U-bolt RBE — 배관 축에 수직이 아니다(10° 넘게 기욺)
        if remark.upper().startswith("UBOLT") and ind in P:
            for n in deps:
                axes = pipe_axis.get(ind) or pipe_axis.get(n)
                if not axes or n not in P:
                    continue
                v = P[n] - P[ind]
                L = float(np.linalg.norm(v))
                if L > 1.0 and min(abs(float(np.dot(v / L, ax))) for ax in axes) > math.sin(math.radians(10)):
                    kinked_ubolt += 1
        max_dep = max(max_dep, len(deps))
        p0 = P.get(ind)
        span = max((float(np.linalg.norm(P[n] - p0)) for n in deps if n in P), default=0.0) if p0 is not None else 0.0
        by_remark[remark] += 1
        span_max[remark] = max(span_max[remark], span)
        cats = set().union(*(ncat[n] for n in ns)) if ns else set()
        is_ubolt = remark.upper().startswith("UBOLT")
        if is_ubolt:
            ubolt_nodes.update(ns)
        elif "Pipe" in cats and "Structure" in cats:
            pipe_stru_non_ubolt += 1
        key = [remark, [round(v) for v in (p0.tolist() if p0 is not None else [])],
               sorted([round(v) for v in P[n].tolist()] for n in deps if n in P)]
        detail["rigids"].append({"sig": hashlib.sha1(json.dumps(key).encode()).hexdigest()[:12], "remark": remark,
                                 "span": round(span), "nDep": len(deps), "cm": r.get("cm"), "indep": ind,
                                 "at": key[1], "source": r.get("sourceName")})
    m["rigidByRemark"] = dict(by_remark)
    m["rigidSpanMax"] = {k: round(v) for k, v in span_max.items()}
    m["rigidSpanMaxAll"] = round(max(span_max.values(), default=0))
    m["rigidMaxDependents"] = max_dep
    m["nodesOnRbeRatio"] = round(len(on_rbe) / max(len(P), 1), 3)
    m["pipeStruNonUboltRbe"] = pipe_stru_non_ubolt
    m["rbeOnElementPairs"] = rbe_on_element
    m["kinkedUboltRbe"] = kinked_ubolt

    # 연결 그룹: 가장 큰 그룹을 주 구조로 보고 나머지를 '떠 있는 그룹'으로 분류
    groups = sorted(f["connectivity"]["groups"], key=lambda g: -g["elementCount"])
    m["groups"] = len(groups)
    fl = collections.Counter()
    if len(groups) > 1:
        me = [el[e] for e in groups[0]["elementIds"] if e in el]
        if me:
            A = np.array([P[e["startNode"]] for e in me])
            B = np.array([P[e["endNode"]] for e in me])
            mdim = [max_dim(prop.get(e["propertyId"])) for e in me]
            for g in groups[1:]:
                eids = [e for e in g["elementIds"] if e in el]
                nids = [n for n in g["nodeIds"] if n in P]
                if not eids or not nids:
                    fl["요소없음"] += 1
                    continue
                cats = collections.Counter(el[e]["category"] for e in eids)
                cat = "배관" if cats.get("Pipe") and not cats.get("Structure") else "구조" if cats.get("Structure") and not cats.get("Pipe") else "섞임"
                d, j = seg_dist(np.array([P[n] for n in nids]), A, B)
                k = int(d.argmin())
                gap, nid, tgt = float(d[k]), nids[k], me[int(j[k])]
                own = max(max_dim(prop.get(el[e]["propertyId"])) for e in eids)
                radius = max(own, mdim[int(j[k])]) + 50   # 지금 엔진 연결 반경의 대략값
                divs, strus = collections.Counter(), set()
                for e in eids:
                    ri = struct_row.get((el[e].get("sourceName") or "").strip())
                    if ri:
                        divs[ri[0]] += 1
                        strus.add(ri[1])
                item = {"cat": cat, "elements": len(eids), "gap": round(gap), "radius": round(radius),
                        "within": gap <= radius, "freeEnd": deg[nid] == 1, "node": nid,
                        "at": [round(v) for v in P[nid].tolist()], "target": tgt["id"], "targetCat": tgt["category"],
                        "division": divs.most_common(1)[0][0] if divs else None, "assemblies": len(strus),
                        "hasUbolt": any(n in ubolt_nodes for n in nids),
                        "source": el[eids[0]].get("sourceName")}
                detail["floating"].append(item)
                fl[f"{cat}:{bucket(gap)}"] += 1
                fl[f"{cat}:전체"] += 1
                if cat == "구조" and item["within"]:
                    fl["구조:반경안인데안이어짐"] += 1
                if cat != "구조" and not item["hasUbolt"]:
                    fl["배관:U볼트없음"] += 1
    m["floating"] = dict(fl)
    m["floatingGroups"] = len(detail["floating"])
    return m, detail


# ───────────────────────── Nastran ─────────────────────────

def run_nastran(bdf, timeout=1500, retries=1):
    """Nastran 을 돌려 F06 글을 돌려준다. F06 이 끝나지 않았으면(END OF JOB 도 FATAL 도 없음) 한 번 더 돌린다.
    동시 실행 중 가끔 F06 이 빈 채로 끝나는 일이 있었다(2026-11-12, 3468 자유-자유 해석)."""
    f06 = os.path.splitext(bdf)[0] + ".f06"
    txt = None
    for attempt in range(retries + 1):
        if os.path.isfile(f06):
            os.remove(f06)          # 앞 시도의 끝나지 않은 F06 을 다시 읽지 않게
        txt = _run_nastran_once(bdf, timeout)
        if txt is None:             # 시간 초과는 다시 돌리지 않는다(한 묶음이 최악 50분 걸림)
            return None
        if "END OF JOB" in txt or "FATAL" in txt:
            return txt
    return txt


def _run_nastran_once(bdf, timeout):
    d, name = os.path.dirname(bdf), os.path.basename(bdf)
    exe = NASTRAN if os.path.isfile(NASTRAN) else "nastran"
    f06 = os.path.splitext(bdf)[0] + ".f06"
    try:
        subprocess.run([exe, name, "scr=yes", "old=no"], cwd=d, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None
    t0 = time.time()
    while time.time() - t0 < 60:      # 명령이 먼저 돌아오는 경우를 위해 F06 끝을 기다린다
        if os.path.isfile(f06):
            txt = open(f06, encoding="latin-1").read()
            if "END OF JOB" in txt or "FATAL" in txt:
                return txt
        time.sleep(2)
    return open(f06, encoding="latin-1").read() if os.path.isfile(f06) else None


def clean_nastran_dir(d):
    for f in os.listdir(d):
        if f.lower().endswith((".op2", ".dball", ".master", ".ifpdat", ".f04", ".log", ".xdb", ".plt")):
            try:
                os.remove(os.path.join(d, f))
            except OSError:
                pass


FATAL_RE = re.compile(r"\*\*\*\s*(?:USER|SYSTEM)\s+FATAL MESSAGE\s+(\d+)")
AUTOSPC_RE = re.compile(r"^\s+\d+\s+G\s+\d\s+\S+\s+B", re.M)      # 엔진 NastranRunner 와 같은 규칙
DISP_RE = re.compile(r"^\s+\d+\s+G\s+(-?\d\.\d+E[+-]\d+)\s+(-?\d\.\d+E[+-]\d+)\s+(-?\d\.\d+E[+-]\d+)\s+-?\d\.\d+E", re.M)
EIG_RE = re.compile(r"^\s+\d+\s+\d+\s+(-?\d\.\d+E[+-]\d+)\s+(-?\d\.\d+E[+-]\d+)\s+(-?\d\.\d+E[+-]\d+)\s+", re.M)


def max_disp_from_f06(txt):
    # 변위 표가 있는 쪽만 읽는다(다른 표의 같은 모양 줄을 섞어 읽으면 엉뚱한 최대값이 나온다)
    pages = [p for p in txt.split("\n1 ") if "D I S P L A C E M E N T   V E C T O R" in p]
    disp = [max(abs(float(a)), abs(float(b)), abs(float(c))) for p in pages for a, b, c in DISP_RE.findall(p)]
    return round(max(disp), 2) if disp else None


def static_check(bdf, workdir):
    """사용자가 받는 BDF 그대로(엔진이 고른 받침만) 자중 해석."""
    os.makedirs(workdir, exist_ok=True)
    dst = os.path.join(workdir, "static.bdf")
    shutil.copyfile(bdf, dst)
    txt = run_nastran(dst)
    clean_nastran_dir(workdir)
    if not txt or ("END OF JOB" not in txt and "FATAL" not in txt):
        return {"ran": False, "incomplete": True}
    return {"ran": True, "fatal": sorted(set(FATAL_RE.findall(txt))), "autospc": len(AUTOSPC_RE.findall(txt)),
            "maxDispMm": max_disp_from_f06(txt), "finished": "END OF JOB" in txt}


def freefree_check(bdf, workdir):
    """받침 없이 고유치 해석. 한 덩어리이고 기구가 없으면 0 Hz 모드가 정확히 6개다."""
    os.makedirs(workdir, exist_ok=True)
    out = []
    for line in open(bdf, encoding="latin-1").read().splitlines():
        u = line.strip().upper()
        if u.startswith("SOL "):
            out.append("SOL 103")
        elif u.startswith(("SPC =", "LOAD =", "ANALYSIS", "FORCE =", "STRESS =", "SPCFORCES", "MPCFORCES", "DISPLACEMENT", "PARAM,POST")):
            continue
        elif u.startswith("LABEL"):
            out.append("  METHOD = 10")
        elif u == "BEGIN BULK":
            out.append(line)
            out.append(f"EIGRL         10                {FREEFREE_MODES:8d}")
        else:
            out.append(line)
    dst = os.path.join(workdir, "freefree.bdf")
    open(dst, "w", encoding="latin-1").write("\n".join(out) + "\n")
    txt = run_nastran(dst)
    clean_nastran_dir(workdir)
    if not txt or ("END OF JOB" not in txt and "FATAL" not in txt):
        return {"ran": False, "incomplete": True}
    hz = []
    k = txt.find("R E A L   E I G E N V A L U E S")
    if k >= 0:
        hz = [abs(float(c)) for _, _, c in EIG_RE.findall(txt[k:k + 6000])]
    zero = sum(1 for h in hz if h < ZERO_HZ)
    elastic = [h for h in hz if h >= ZERO_HZ]
    return {"ran": True, "fatal": sorted(set(FATAL_RE.findall(txt))), "modes": len(hz), "zeroModes": zero,
            "firstElasticHz": round(elastic[0], 3) if elastic else None}


# ───────────────────────── 판정 ─────────────────────────

def judge(m):
    """완성 기준 초안(계획서 4절). 엔진이 00_Verdict.json 을 내기 전까지 장치가 대신 판정한다."""
    why = []
    if m.get("exit") != 0:
        why.append(f"엔진 종료 코드 {m.get('exit')}")
    if m.get("noFinalModel"):
        why.append("최종 모델 없음")
    if m.get("errorRows"):
        why.append(f"입력 오류 행 {m['errorRows']}")
    if (m.get("groups") or 0) > 1:
        why.append(f"연결 그룹 {m['groups']}개")
    st = m.get("static") or {}
    if st.get("ran"):
        if st.get("fatal"):
            why.append("자중 해석 FATAL " + ",".join(st["fatal"]))
        if st.get("autospc"):
            why.append(f"자동 구속 {st['autospc']}개")
    for key, label in (("static", "자중 해석"), ("freefree", "자유-자유 해석")):
        if (m.get(key) or {}).get("incomplete"):
            why.append(f"측정 실패: {label} F06 미완료(다시 돌릴 것)")
    ff = m.get("freefree") or {}
    if ff.get("ran") and (ff.get("fatal") or ff.get("zeroModes") != 6):
        why.append(f"자유-자유 0 Hz 모드 {ff.get('zeroModes')}개" + (" FATAL " + ",".join(ff["fatal"]) if ff.get("fatal") else ""))
    return (not why), why


def warnings(m):
    """판정에는 넣지 않고 보고만 하는 항목(사람 검토 지적에서 옴). 판정 편입은 사용자 결정(D10)."""
    w = []
    st = m.get("static") or {}
    if (st.get("maxDispMm") or 0) > OVER_DISP_MM:
        w.append(f"과대 변위 {st['maxDispMm']:.0f} mm")
    if m.get("vanishedStructureRows"):
        w.append(f"사라진 구조 행 {m['vanishedStructureRows']}")
    if m.get("coincidentNodePairs"):
        w.append(f"겹친 노드 {m['coincidentNodePairs']}쌍")
    if m.get("rbeOnElementPairs"):
        w.append(f"요소와 겹친 RBE {m['rbeOnElementPairs']}")
    if m.get("kinkedUboltRbe"):
        w.append(f"꺾인 U-bolt RBE {m['kinkedUboltRbe']}")
    return w


# ───────────────────────── 실행 ─────────────────────────

def run_one(s, exe, out, nastran):
    d = os.path.join(out, s["id"])
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    cmd = [exe, "build-full"]
    for k, f in s["files"].items():
        dst = os.path.join(d, f"in_{k}.csv")     # 영문 이름으로 복사(Nastran 은 한글 경로에서 실패)
        shutil.copyfile(f["path"], dst)
        cmd += ["--" + k, dst]
    cmd += ENGINE_OPTS
    m = {"id": s["id"], "hull": s["hull"], "inputs": {k: f["name"] for k, f in s["files"].items()}}
    t0 = time.time()
    try:
        cp = subprocess.run(cmd, cwd=d, capture_output=True, timeout=1500)
        m["exit"] = cp.returncode
        so = cp.stdout.decode("utf-8", "replace") + cp.stderr.decode("utf-8", "replace")
    except subprocess.TimeoutExpired:
        m["exit"], so = "timeout", ""
    m["engineSec"] = round(time.time() - t0, 1)
    open(os.path.join(d, "engine_stdout.txt"), "w", encoding="utf-8").write(so)
    outs = sorted(x for x in os.listdir(d) if re.match(r"^\d{8}_\d{6}$", x))
    detail = {}
    if outs:
        try:
            mm, detail = model_metrics(os.path.join(d, outs[-1]))
            m.update(mm)
        except Exception as ex:   # 지표 계산 실패도 결과로 남긴다
            m["metricsError"] = repr(ex)
    else:
        m["noFinalModel"] = True
    if nastran and m.get("finalBdf"):
        m["static"] = static_check(m["finalBdf"], os.path.join(d, "nas_static"))
        if m.get("groups") == 1:                 # 그룹이 여럿이면 고유치 해석 자체가 실패한다
            m["freefree"] = freefree_check(m["finalBdf"], os.path.join(d, "nas_freefree"))
    m.pop("finalBdf", None)
    m["pass"], m["why"] = judge(m)
    m["warn"] = warnings(m)
    json.dump({"metrics": m, **detail}, open(os.path.join(d, "metrics.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"[{s['id']}] {'통과' if m['pass'] else '미달'} 그룹={m.get('groups')} {'; '.join(m['why'])[:90]}", flush=True)
    return m


def summarize(res):
    rows = res["sets"]
    L = [f"# 엔진 회귀 결과 — {res['label']}", "",
         f"- 엔진 `{res['exe']}` sha256 {res['exeSha'][:16]}, 옵션 `{' '.join(res['engineOpts'])}`, {res['when']}",
         f"- 묶음 {len(rows)} (파일이 보관되지 않아 뺀 실행 {res['skippedRuns']}), Nastran {'함' if res['nastran'] else '안 함'}", ""]
    tot = collections.Counter()
    for r in rows:
        tot["통과"] += bool(r["pass"])
        tot["연결 그룹 2개 이상"] += (r.get("groups") or 0) > 1
        tot["떠 있는 그룹"] += r.get("floatingGroups") or 0
        tot["입력 오류 행"] += r.get("errorRows") or 0
        tot["질량 누락 행"] += r.get("droppedMassRows") or 0
        tot["질량 누락 kg"] += r.get("droppedMassKg") or 0
        tot["사라진 구조 행(형상 기준)"] += r.get("vanishedStructureRows") or 0
        tot["노이즈 제거로 지운 요소"] += r.get("noiseRemovedElements") or 0
        tot["받칠 구조 없는 U-bolt 노드"] += r.get("boundaryNodes") or 0
        tot["U-bolt 아닌 배관–구조 RBE"] += r.get("pipeStruNonUboltRbe") or 0
        tot["RBE 수"] += r.get("rigids") or 0
        st, ff = r.get("static") or {}, r.get("freefree") or {}
        tot["자중 해석 FATAL 묶음"] += bool(st.get("fatal"))
        tot["자동 구속 있는 묶음"] += bool(st.get("autospc"))
        tot["자유-자유 6개 아님"] += bool(ff.get("ran") and ff.get("zeroModes") != 6)
        tot[f"과대 변위(>{OVER_DISP_MM} mm) 묶음"] += (st.get("maxDispMm") or 0) > OVER_DISP_MM
        tot["겹친 노드 쌍"] += r.get("coincidentNodePairs") or 0
        tot["요소와 겹친 RBE"] += r.get("rbeOnElementPairs") or 0
        tot["꺾인 U-bolt RBE"] += r.get("kinkedUboltRbe") or 0
        for k, v in (r.get("floating") or {}).items():
            tot["떠 있는 그룹 / " + k] += v
    L += ["| 지표 | 값 |", "|---|---|"] + [f"| {k} | {round(v, 1) if isinstance(v, float) else v} |" for k, v in tot.items()]
    L += ["", f"가장 긴 RBE {max((r.get('rigidSpanMaxAll') or 0) for r in rows)} mm, 종속 가장 많은 RBE {max((r.get('rigidMaxDependents') or 0) for r in rows)}개", "",
          "| 묶음 | 판정 | 그룹 | 떠 있음 | 오류 행 | 누락 kg | 자중 FATAL | 자동 구속 | 최대 변위 mm | 0 Hz | 첫 탄성 Hz | 미달 사유 | 참고 |",
          "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        st, ff = r.get("static") or {}, r.get("freefree") or {}
        L.append(f"| {r['id']} | {'통과' if r['pass'] else '미달'} | {r.get('groups')} | {r.get('floatingGroups')} | {r.get('errorRows')} | {r.get('droppedMassKg')} | "
                 f"{','.join(st.get('fatal') or []) or '-'} | {st.get('autospc', '-')} | {st.get('maxDispMm', '-')} | {ff.get('zeroModes', '-')} | {ff.get('firstElasticHz', '-')} | "
                 f"{'; '.join(r['why'])} | {'; '.join(r.get('warn') or [])} |")
    res["totals"] = {k: (round(v, 1) if isinstance(v, float) else v) for k, v in tot.items()}
    return "\n".join(L) + "\n"


def write_result(out, res):
    md = summarize(res)
    json.dump(res, open(os.path.join(out, "result.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    open(os.path.join(out, "summary.md"), "w", encoding="utf-8").write(md)
    return md


def cmd_run(a):
    sets, skipped = load_sets(a.corpus)
    if a.only:
        want = set(a.only.split(","))
        sets = [s for s in sets if s["id"] in want]
    out = os.path.join(a.out, a.label)
    if a.merge:
        old = json.load(open(os.path.join(out, "result.json"), encoding="utf-8"))
        sha = hashlib.sha256(open(a.exe, "rb").read()).hexdigest()
        if sha != old.get("exeSha"):
            sys.exit(f"--merge 는 같은 엔진으로만 — '{a.label}' 은 sha {old.get('exeSha', '')[:16]}, 지금 exe 는 {sha[:16]}.")
        unknown = sorted({s["id"] for s in sets} - {r["id"] for r in old["sets"]})
        if unknown:
            sys.exit(f"--merge: 기존 결과에 없는 묶음 {unknown} — 새 이름으로 run 하라.")
        with ThreadPoolExecutor(max_workers=a.workers) as ex:
            new = {r["id"]: r for r in ex.map(lambda s: run_one(s, a.exe, out, not a.no_nastran), sets)}
        old["sets"] = [new.get(r["id"], r) for r in old["sets"]]
        md = write_result(out, old)
        print(f"{len(new)}개 묶음을 다시 돌려 '{a.label}' 에 끼워 넣음")
        return
    if os.path.isfile(os.path.join(out, "result.json")) and not a.force:
        sys.exit(f"'{a.label}' 결과가 이미 있다({out}). 기준 결과를 덮어쓰지 않으려고 멈춘다 — 새 이름을 쓰거나 --force.")
    os.makedirs(out, exist_ok=True)
    print(f"묶음 {len(sets)} → {out}", flush=True)
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        rows = list(ex.map(lambda s: run_one(s, a.exe, out, not a.no_nastran), sets))
    res = {"label": a.label, "exe": a.exe, "exeSha": hashlib.sha256(open(a.exe, "rb").read()).hexdigest(),
           "engineOpts": ENGINE_OPTS, "nastran": not a.no_nastran, "corpus": a.corpus, "skippedRuns": skipped,
           "when": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), "sets": rows}
    md = write_result(out, res)
    print("\n".join(md.splitlines()[:45]))


def cmd_remeasure(a):
    """엔진을 다시 돌리지 않고, 이미 있는 산출물로 지표만 다시 계산한다(지표를 고쳤을 때)."""
    out = os.path.join(a.out, a.label)
    res = json.load(open(os.path.join(out, "result.json"), encoding="utf-8"))
    rows = []
    for old in res["sets"]:
        d = os.path.join(out, old["id"])
        outs = sorted(x for x in os.listdir(d) if re.match(r"^\d{8}_\d{6}$", x))
        m = {k: old[k] for k in ("id", "hull", "inputs", "exit", "engineSec") if k in old}
        for k in ("static", "freefree"):
            if k in old:
                m[k] = old[k]
        detail = {}
        if outs:
            mm, detail = model_metrics(os.path.join(d, outs[-1]))
            m.update(mm)
        else:
            m["noFinalModel"] = True
        if (m.get("static") or {}).get("ran"):     # 예전 실행의 변위 읽기 오류를 F06 에서 다시 읽어 바로잡는다
            f06 = os.path.join(d, "nas_static", "static.f06")
            if os.path.isfile(f06):
                m["static"]["maxDispMm"] = max_disp_from_f06(open(f06, encoding="latin-1").read())
        m.pop("finalBdf", None)
        m["pass"], m["why"] = judge(m)
        m["warn"] = warnings(m)
        json.dump({"metrics": m, **detail}, open(os.path.join(d, "metrics.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        rows.append(m)
    res["sets"] = rows
    md = write_result(out, res)
    print("\n".join(md.splitlines()[:45]))


# ───────────────────────── 비교 ─────────────────────────

# (이름, 값 꺼내기, 커지면 나쁨인가)
WATCH = [
    ("그룹", lambda r: r.get("groups"), True),
    ("떠 있는 그룹", lambda r: r.get("floatingGroups"), True),
    ("입력 오류 행", lambda r: r.get("errorRows"), True),
    ("질량 누락 kg", lambda r: r.get("droppedMassKg"), True),
    ("사라진 구조 행", lambda r: r.get("vanishedStructureRows"), True),
    ("노이즈 제거로 지운 요소", lambda r: r.get("noiseRemovedElements"), True),
    ("RBE 수", lambda r: r.get("rigids"), None),
    ("가장 긴 RBE", lambda r: r.get("rigidSpanMaxAll"), True),
    ("종속 가장 많은 RBE", lambda r: r.get("rigidMaxDependents"), True),
    ("RBE 에 걸린 노드 비율", lambda r: r.get("nodesOnRbeRatio"), True),
    ("U-bolt 아닌 배관–구조 RBE", lambda r: r.get("pipeStruNonUboltRbe"), True),
    ("요소와 겹친 RBE", lambda r: r.get("rbeOnElementPairs"), True),
    ("꺾인 U-bolt RBE", lambda r: r.get("kinkedUboltRbe"), True),
    ("자동 구속", lambda r: (r.get("static") or {}).get("autospc"), True),
    ("자중 FATAL", lambda r: ",".join((r.get("static") or {}).get("fatal") or []), None),
    ("최대 변위 mm", lambda r: (r.get("static") or {}).get("maxDispMm"), True),
    ("0 Hz 모드", lambda r: (r.get("freefree") or {}).get("zeroModes"), None),
    ("총 질량 t", lambda r: r.get("totalMassTon"), None),
]


def cmd_compare(a):
    A = json.load(open(os.path.join(a.base, "result.json"), encoding="utf-8"))
    B = json.load(open(os.path.join(a.new, "result.json"), encoding="utf-8"))
    ra, rb = {r["id"]: r for r in A["sets"]}, {r["id"]: r for r in B["sets"]}
    common = [k for k in ra if k in rb]
    L = [f"# 비교: {A['label']} → {B['label']}", "",
         f"- 기준 엔진 sha {A['exeSha'][:16]}, 새 엔진 sha {B['exeSha'][:16]}",
         f"- 공통 묶음 {len(common)}, 기준에만 {len(ra) - len(common)}, 새 쪽에만 {len(rb) - len(common)}", ""]
    changed = [k for k in common if ra[k].get("bdfHash") != rb[k].get("bdfHash")]
    L.append(f"**BDF 가 바뀐 묶음 {len(changed)} / {len(common)}**")
    gained = [k for k in common if rb[k]["pass"] and not ra[k]["pass"]]
    lost = [k for k in common if ra[k]["pass"] and not rb[k]["pass"]]
    L += [f"- 통과 {sum(ra[k]['pass'] for k in common)} → {sum(rb[k]['pass'] for k in common)} (새로 통과 {len(gained)}, 통과였다가 미달 {len(lost)}: {', '.join(lost) or '없음'})", ""]
    # 합계 비교
    L += ["| 합계 | 기준 | 새 |", "|---|---|---|"]
    for name, get, _ in WATCH:
        va = [get(ra[k]) for k in common]
        vb = [get(rb[k]) for k in common]
        if all(isinstance(x, (int, float)) or x is None for x in va + vb):
            sa = sum(x or 0 for x in va)
            sb = sum(x or 0 for x in vb)
            if sa != sb:
                L.append(f"| {name} | {round(sa, 2)} | {round(sb, 2)} |")
    L.append("")
    worse = []
    for k in changed:
        L.append(f"## {k}  ({'; '.join(rb[k]['why']) or '통과'})")
        for name, get, bad_up in WATCH:
            va, vb = get(ra[k]), get(rb[k])
            if va != vb:
                flag = ""
                if bad_up and isinstance(va, (int, float)) and isinstance(vb, (int, float)) and vb > va:
                    flag = "  ⚠ 나빠짐"
                    worse.append((k, name, va, vb))
                L.append(f"- {name}: {va} → {vb}{flag}")
        try:
            da = json.load(open(os.path.join(a.base, k, "metrics.json"), encoding="utf-8"))["rigids"]
            db = json.load(open(os.path.join(a.new, k, "metrics.json"), encoding="utf-8"))["rigids"]
            sa, sb = {x["sig"] for x in da}, {x["sig"] for x in db}
            add = [x for x in db if x["sig"] not in sa]
            rem = [x for x in da if x["sig"] not in sb]
            L.append(f"- RBE 새로 생김 {len(add)}, 없어짐 {len(rem)}")
            for x in sorted(add, key=lambda x: -x["span"])[:a.list]:
                L.append(f"  - 새 RBE {x['remark']} 길이 {x['span']} mm, 종속 {x['nDep']}, 독립 노드 {x['indep']} 위치 {x['at']}, 출처 {x.get('source')}")
        except (OSError, KeyError):
            pass
        L.append("")
    if worse:
        L += ["## 나빠진 지표 모음", ""] + [f"- {k}: {n} {va} → {vb}" for k, n, va, vb in worse]
    md = "\n".join(L) + "\n"
    out = os.path.join(a.new, f"compare_to_{A['label']}.md")
    open(out, "w", encoding="utf-8").write(md)
    print("\n".join(md.splitlines()[:40]))
    print(f"\n전체: {out}")


def main():
    ap = argparse.ArgumentParser(description="Model Builder 엔진 회귀 측정")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--exe", default=DEFAULT_EXE)
    r.add_argument("--corpus", default=DEFAULT_CORPUS)
    r.add_argument("--out", default=DEFAULT_OUT)
    r.add_argument("--label", required=True)
    r.add_argument("--workers", type=int, default=3)
    r.add_argument("--no-nastran", action="store_true")
    r.add_argument("--only", default="")
    r.add_argument("--force", action="store_true", help="같은 이름의 결과가 있어도 덮어쓴다")
    r.add_argument("--merge", action="store_true", help="--only 묶음만 다시 돌려 기존 결과에 끼워 넣는다(같은 --exe 로)")
    r.set_defaults(fn=cmd_run)
    rm = sub.add_parser("remeasure")
    rm.add_argument("--out", default=DEFAULT_OUT)
    rm.add_argument("--label", required=True)
    rm.set_defaults(fn=cmd_remeasure)
    c = sub.add_parser("compare")
    c.add_argument("base")
    c.add_argument("new")
    c.add_argument("--list", type=int, default=10, help="묶음마다 보여 줄 새 RBE 수")
    c.set_defaults(fn=cmd_compare)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
