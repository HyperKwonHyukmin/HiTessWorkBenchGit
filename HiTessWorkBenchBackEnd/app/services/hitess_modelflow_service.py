"""HiTess Model Builder 파이프라인 단계별 백그라운드 실행 로직.

stop_mode (API 값):
  'load' → --stage 1  (CSV 파싱 + FE 초기 모델 빌드, BDF 미생성)
  '7'    → --stage 3  (지오메트리 힐링 + 메시 균등화 + 무결성 검사, BDF 생성)
             → BDF 생성 후 BdfScanner.exe 실행 → Three.js 호환 JSON 변환
  (Nastran은 --stage 3에 내장되지 않고 별도 요청으로 실행)

ubolt:
  False (기본) → U-bolt RBE2 DOF를 설계값(Rest)으로 유지 (해제)
  True         → U-bolt RBE2 DOF를 123456으로 강제 고정 (강체)
"""
import os
import glob
import json
import logging
import subprocess
from datetime import datetime
from .. import models, database
from .job_manager import job_status_store

# 서비스 파일 기준 백엔드 루트 경로 (app/services/ → app/ → backend root)
_SERVICE_DIR  = os.path.dirname(os.path.abspath(__file__))
_BACKEND_ROOT = os.path.dirname(os.path.dirname(_SERVICE_DIR))
_BDFSCANNER_EXE = os.path.join(_BACKEND_ROOT, "InHouseProgram", "BdfScanner", "BdfScanner.exe")

logger = logging.getLogger(__name__)

_STAGE_MESSAGES = {
    "load": {"start": "CSV 파일 검증 시작...",    "done": "CSV 검증 완료",      "fail": "CSV 검증 실패"},
    "7":    {"start": "모델 알고리즘 적용 시작...", "done": "알고리즘 적용 완료", "fail": "알고리즘 적용 실패"},
}

# API stop_mode 값 → 신규 엔진 --stage 번호 매핑
_STOP_TO_STAGE = {
    "load": "1",
    "7":    "3",
}


# ── BdfScanner JSON → Three.js FEM 포맷 변환 ────────────────────────────────

def _transform_bdfscanner_to_fem(data: dict, stage_data: dict | None = None) -> dict:
    """BdfScanner 출력 JSON을 Three.js FemModelViewer 호환 포맷으로 변환한다.

    stage_data가 제공되면 STAGE_07 JSON의 Rigids[]를 merge하여 U-bolt 메타데이터를
    rigids 딕셔너리에 추가하고, BDF에서 누락된 orphan U-bolt를 복원한다.

    Three.js 기대 구조:
      nodes       : {id: {x, y, z}}
      elements    : {id: {nodeIds, classification}}  — RBE2/CONM2 제외
      rigids      : {id: {independentNodeId, dependentNodeIds[], isUbolt, source}}
      pointMasses : {id: {nodeId, mass}}
      boundaryConditions: {spcNodeIds: [...]}
    """
    # 1. nodes: grids 배열 → {id: {x,y,z}} dict
    nodes = {}
    for g in data.get("grids", []):
        nodes[str(g["id"])] = {"x": g.get("x", 0.0), "y": g.get("y", 0.0), "z": g.get("z", 0.0)}

    # 2. U-bolt 메타데이터 인덱스 (STAGE_07 Rigids[])
    ubolt_meta: dict[int, dict] = {}
    if stage_data:
        for r in stage_data.get("Rigids", []):
            rid = int(r.get("Id", 0))
            if rid > 0:
                ubolt_meta[rid] = {
                    "isUbolt":    bool(r.get("IsUbolt", False)),
                    "source":     r.get("Source", ""),
                    "independent": r.get("Independent"),
                    "dependents": list(r.get("Dependents") or []),
                }

    # 3. elements 분류
    RIGID_TYPES  = {"RBE2"}
    MASS_TYPES   = {"CONM2"}
    BEAM_TYPES   = {"CBEAM", "CBAR", "CROD", "CQUAD4", "CTRIA3", "CTETRA", "CHEXA"}

    elements     = {}
    rigids       = {}
    point_masses = {}

    for elem in data.get("elements", []):
        card_type = elem.get("cardType", "")
        eid_int   = int(elem.get("id", 0))
        eid       = str(eid_int)

        if card_type in RIGID_TYPES:
            meta = ubolt_meta.get(eid_int, {})
            rigids[eid] = {
                "independentNodeId": elem.get("independentNodeId"),
                "dependentNodeIds":  elem.get("dependentNodeIds", []),
                "isUbolt":           meta.get("isUbolt", False),
                "source":            meta.get("source", ""),
            }
        elif card_type in MASS_TYPES:
            point_masses[eid] = {
                "nodeId": elem.get("nodeId"),
                "mass":   elem.get("mass", 0.0),
            }
        elif card_type in BEAM_TYPES:
            elements[eid] = {
                "nodeIds":        elem.get("nodeIds", []),
                "classification": "Stru",
            }

    # 4. Orphan U-bolt 복원 — BDF에서 drop된 미연결 U-bolt를 시각화 목적으로 rigids에 추가
    if ubolt_meta:
        bdf_rigid_ids = {int(k) for k in rigids}
        for rid_int, meta in ubolt_meta.items():
            if rid_int in bdf_rigid_ids:
                continue
            if not meta.get("isUbolt"):
                continue
            indep = meta.get("independent")
            if indep is None or str(indep) not in nodes:
                continue
            rigids[str(rid_int)] = {
                "independentNodeId": indep,
                "dependentNodeIds":  [],
                "isUbolt":           True,
                "source":            meta.get("source", ""),
            }

    # 5. boundaryConditions: SPC/SPC1 nodeIds 합산 → spcNodeIds 플랫 리스트
    spc_node_ids: set[int] = set()
    for bc in data.get("boundaryConditions", []):
        card_type = bc.get("cardType", "")
        if card_type == "SPC1":
            for nid in bc.get("nodeIds", []):
                spc_node_ids.add(nid)
        elif card_type == "SPC":
            if "nodeId" in bc:
                spc_node_ids.add(bc["nodeId"])

    return {
        "nodes":               nodes,
        "elements":            elements,
        "rigids":              rigids,
        "pointMasses":         point_masses,
        "boundaryConditions":  {"spcNodeIds": sorted(spc_node_ids)},
    }


def _compute_connectivity_groups(fem_data: dict) -> dict:
    """FEM 데이터(nodes/elements/rigids/pointMasses)에서 연결 성분을 계산해
    HiTessModelBuilder.exe가 생성하는 ConnectivityGroups.json과 동일한 포맷으로 반환.

    BdfScanner.exe는 ConnectivityGroups를 생성하지 않으므로, group-delete / rbe-retry
    플로우에서 BDF 재스캔 후 Python이 직접 연결 성분 분석을 수행한다.
    """
    nodes        = fem_data.get("nodes", {}) or {}
    elements     = fem_data.get("elements", {}) or {}
    rigids       = fem_data.get("rigids", {}) or {}
    point_masses = fem_data.get("pointMasses", {}) or {}

    parent: dict = {}

    def find(x):
        root = x
        while parent.get(root, root) != root:
            root = parent[root]
        while parent.get(x, x) != root:
            parent[x], x = root, parent[x]
        return root

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for nid_str in nodes.keys():
        try:
            parent[int(nid_str)] = int(nid_str)
        except (TypeError, ValueError):
            continue

    for elem in elements.values():
        nids = elem.get("nodeIds", []) or []
        if len(nids) >= 2:
            base = int(nids[0])
            for n in nids[1:]:
                try:
                    union(base, int(n))
                except (TypeError, ValueError):
                    continue

    for r in rigids.values():
        indep = r.get("independentNodeId")
        if indep is None:
            continue
        try:
            indep = int(indep)
        except (TypeError, ValueError):
            continue
        for dep in r.get("dependentNodeIds", []) or []:
            try:
                union(indep, int(dep))
            except (TypeError, ValueError):
                continue

    comps: dict = {}

    def bucket(root):
        if root not in comps:
            comps[root] = {"nodes": [], "elements": [], "rigids": [], "pms": []}
        return comps[root]

    for nid_str in nodes.keys():
        try:
            nid = int(nid_str)
        except (TypeError, ValueError):
            continue
        bucket(find(nid))["nodes"].append(nid)

    for eid_str, elem in elements.items():
        nids = elem.get("nodeIds", []) or []
        if not nids:
            continue
        try:
            eid = int(eid_str)
            bucket(find(int(nids[0])))["elements"].append(eid)
        except (TypeError, ValueError):
            continue

    for rid_str, r in rigids.items():
        indep = r.get("independentNodeId")
        if indep is None:
            continue
        try:
            rid = int(rid_str)
            bucket(find(int(indep)))["rigids"].append(rid)
        except (TypeError, ValueError):
            continue

    for pmid_str, pm in point_masses.items():
        nid = pm.get("nodeId")
        if nid is None:
            continue
        try:
            pmid = int(pmid_str)
            bucket(find(int(nid)))["pms"].append(pmid)
        except (TypeError, ValueError):
            continue

    # orphan 노드만 있는 연결 성분(element/rigid/pointmass 모두 0)은 제외
    meaningful = [c for c in comps.values()
                  if len(c["elements"]) + len(c["rigids"]) + len(c["pms"]) > 0]
    sorted_comps = sorted(meaningful, key=lambda c: -len(c["elements"]))
    groups = []
    for i, c in enumerate(sorted_comps, start=1):
        xs, ys, zs = [], [], []
        for n in c["nodes"]:
            pt = nodes.get(str(n))
            if not pt:
                continue
            xs.append(pt.get("x", 0.0))
            ys.append(pt.get("y", 0.0))
            zs.append(pt.get("z", 0.0))
        if xs:
            bbox = {
                "Min": {"X": min(xs), "Y": min(ys), "Z": min(zs)},
                "Max": {"X": max(xs), "Y": max(ys), "Z": max(zs)},
            }
        else:
            bbox = {"Min": {"X": 0, "Y": 0, "Z": 0}, "Max": {"X": 0, "Y": 0, "Z": 0}}
        groups.append({
            "Id":             i,
            "NodeCount":      len(c["nodes"]),
            "ElementCount":   len(c["elements"]),
            "RigidCount":     len(c["rigids"]),
            "PointMassCount": len(c["pms"]),
            "BBox":           bbox,
            "NodeIds":        sorted(c["nodes"]),
            "ElementIds":     sorted(c["elements"]),
            "RigidIds":       sorted(c["rigids"]),
            "PointMassIds":   sorted(c["pms"]),
        })

    return {
        "SchemaVersion": "1.0",
        "Meta":          {"generatedBy": "hitess_modelflow_service._compute_connectivity_groups"},
        "Summary":       {"GroupCount": len(groups)},
        "Groups":        groups,
    }


def append_rbe2_to_bdf(bdf_path: str, pairs: list) -> None:
    """ENDDATA 직전에 RBE2 카드를 삽입한다.
    EID는 기존 BDF 내 최대 EID + 1부터 순차 발급하여 충돌을 방지한다."""
    with open(bdf_path, "r", encoding="utf-8", errors="replace") as f:
        lines = f.readlines()

    max_eid = 0
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("$"):
            continue
        parts = stripped.split()
        if len(parts) >= 2:
            try:
                eid = int(parts[1])
                if eid > max_eid:
                    max_eid = eid
            except ValueError:
                pass

    new_cards = []
    for i, p in enumerate(pairs):
        eid  = max_eid + 1 + i
        gn   = int(p["indep"])
        dep  = int(p["dep"])
        dof  = p.get("dof", "123456")
        card = f"RBE2    {eid:<8d}{gn:<8d}{dof:<8s}{dep:<8d}\n"
        new_cards.append(card)
        new_cards.append(f"$--- User RBE2 pair {i+1}: Node {gn} <-> Node {dep}\n")

    for i in range(len(lines) - 1, -1, -1):
        if lines[i].strip().upper() == "ENDDATA":
            lines[i:i] = new_cards
            break
    else:
        lines.extend(new_cards)

    with open(bdf_path, "w", encoding="utf-8") as f:
        f.writelines(lines)


_ELEMENT_CARDS = frozenset({
    "CBAR",  "CBEAM", "CROD",   "CTUBE",
    "CQUAD4","CQUAD8","CTRIA3", "CTRIA6",
    "CHEXA", "CPENTA","CTETRA",
    "CBUSH", "CONM2",
    "RBE2",  "RBE3",
})


def remove_elements_from_bdf(bdf_path: str, element_ids) -> int:
    """Nastran BDF에서 지정한 EID를 가진 element 카드를 제거한다.
    반환값: 실제로 삭제된 element 개수.
    - 카드 본문 뒤에 오는 continuation(+/* prefix 또는 첫 8칸 공백) 라인도 함께 제거.
    - GRID/SPC/LOAD/property 카드는 건드리지 않는다 (orphan node 허용).
    - 파싱 실패 라인은 보존 — append_rbe2_to_bdf와 동일한 방어 스타일."""
    target = {int(e) for e in element_ids}
    if not target:
        return 0

    with open(bdf_path, "r", encoding="utf-8", errors="replace") as f:
        lines = f.readlines()

    out: list[str] = []
    skip_continuation = False
    removed = 0
    for line in lines:
        stripped = line.strip()

        if skip_continuation:
            if line.startswith(("+", "*")) or (len(line) >= 8 and line[:8] == "        "):
                continue
            skip_continuation = False

        if not stripped or stripped.startswith("$"):
            out.append(line)
            continue

        parts = stripped.split()
        card = parts[0].upper()
        if card in _ELEMENT_CARDS and len(parts) >= 2:
            try:
                eid = int(parts[1])
            except ValueError:
                out.append(line)
                continue
            if eid in target:
                removed += 1
                skip_continuation = True
                continue

        out.append(line)

    with open(bdf_path, "w", encoding="utf-8") as f:
        f.writelines(out)
    return removed


def task_execute_modelflow(
    job_id: str,
    stru_path: str,
    pipe_path: str | None,
    equip_path: str | None,
    work_dir: str,
    exe_path: str,
    employee_id: str,
    timestamp: str,
    source: str,
    stop_mode: str = "7",         # 항상 --stage 3 (전체 파이프라인)
    ubolt: bool = False,          # U-bolt RBE2 강체 고정 여부
    mesh_size: float = 500.0,     # 목표 메시 크기 (mm)
    verbose: bool = False,        # 요소별 세부 처리 로그 출력
    csvdebug: bool = True,        # CSV 파싱 디버그 출력
    femodeldebug: bool = True,    # 초기 FE 모델 디버그 출력
    pipelinedebug: bool = True,   # 파이프라인 스테이지 배너 및 통계 출력
    spc_z_band: float = -1.0,     # Z-band SPC 필터 (mm). -1이면 비활성
    debug_stages: bool = False,   # 힐링 단계별 BDF 스냅샷 저장
    stop_at: int = 0,             # 0=전체 실행, 1~5=지정 단계까지
):
    msgs = _STAGE_MESSAGES.get(stop_mode, _STAGE_MESSAGES["load"])
    job_status_store.update_job(job_id, {"status": "Running", "progress": 10, "message": msgs["start"]})

    input_data = {"stru_csv": stru_path, "pipe_csv": pipe_path, "equip_csv": equip_path}
    result_data: dict = {}
    process_log_data = None
    status_msg = "Success"
    engine_output = ""
    log_content = ""
    log_path = None
    bdf_path = None
    json_path = None
    project_data = None

    db = database.SessionLocal()

    try:
        if not os.path.exists(exe_path):
            status_msg = "Failed"
            engine_output = f"실행 파일을 찾을 수 없습니다: {exe_path}"
        else:
            job_status_store.update_job(job_id, {"progress": 30, "message": "HiTessModelBuilder.exe 실행 중..."})

            cmd_args = [exe_path, "--stru", stru_path]
            if pipe_path:
                cmd_args += ["--pipe", pipe_path]
            if equip_path:
                cmd_args += ["--equip", equip_path]
            # Nastran 검증은 별도 요청으로 처리하므로 내장 Nastran 비활성화
            cmd_args += ["--nastran", "false"]
            # 목표 메시 크기 (mm)
            cmd_args += ["--mesh", str(int(mesh_size))]
            if ubolt:
                cmd_args += ["--ubolt", "true"]
            if verbose:
                cmd_args += ["--verbose", "true"]
            if not csvdebug:
                cmd_args += ["--csvdebug", "false"]
            if not femodeldebug:
                cmd_args += ["--femodeldebug", "false"]
            if not pipelinedebug:
                cmd_args += ["--pipelinedebug", "false"]
            if spc_z_band >= 0:
                cmd_args += ["--spc-z-band", str(int(spc_z_band))]
            if debug_stages:
                cmd_args += ["--debug-stages", "true"]
            if stop_at and 1 <= stop_at <= 5:
                cmd_args += ["--stopat", str(stop_at)]

            try:
                # 전체 파이프라인 실행 → 타임아웃 600초
                timeout_sec = 600
                result = subprocess.run(
                    cmd_args,
                    cwd=work_dir,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=timeout_sec,
                )
                engine_output = result.stdout
                if result.stderr and result.stderr.strip():
                    engine_output += f"\n[stderr]\n{result.stderr}"

                job_status_store.update_job(job_id, {"progress": 70, "message": "결과 파일 수집 중..."})

                # 프로세스 로그 파일 수집
                log_files = glob.glob(os.path.join(work_dir, "**", "*_ProcessLog_*.txt"), recursive=True)
                if log_files:
                    log_files.sort(key=os.path.getmtime, reverse=True)
                    log_path = log_files[0]
                    with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                        log_content = f.read()
                    result_data["log_path"] = log_path
                else:
                    log_content = engine_output

                # JSON ProcessLog 파싱
                json_log_files = glob.glob(os.path.join(work_dir, "**", "*_ProcessLog_*.json"), recursive=True)
                if json_log_files:
                    json_log_files.sort(key=os.path.getmtime, reverse=True)
                    try:
                        with open(json_log_files[0], "r", encoding="utf-8", errors="replace") as f:
                            raw_plog = json.load(f)
                        if raw_plog.get("SchemaVersion") == 1:
                            run_info = raw_plog.get("Run", {})
                            process_log_data = {
                                "exitReason":   run_info.get("ExitReason"),
                                "startedAt":    run_info.get("StartedAt"),
                                "finishedAt":   run_info.get("FinishedAt"),
                                "stopAtStage":  run_info.get("StopAtStage", 0),
                                "errorStage":   run_info.get("ErrorStage"),
                                "errorMessage": run_info.get("ErrorMessage"),
                                "stages": [
                                    {
                                        "id":        s.get("Id"),
                                        "name":      s.get("Name"),
                                        "status":    s.get("Status"),
                                        "elapsedMs": s.get("ElapsedMs"),
                                        "summary":   s.get("Summary"),
                                    }
                                    for s in raw_plog.get("Stages", [])
                                ],
                            }
                            if run_info.get("ExitReason") == "Error":
                                status_msg = "Failed"
                    except Exception as plog_e:
                        logger.warning("ProcessLog JSON 파싱 오류: %s", str(plog_e))

                # BDF 수집: <struName>.bdf (Verification/Material/STAGE 제외)
                if stop_mode == "7":
                    bdf_files = [
                        f for f in glob.glob(os.path.join(work_dir, "**", "*.bdf"), recursive=True)
                        if not any(kw in os.path.basename(f) for kw in ("Material", "Verification", "STAGE_"))
                    ]
                    if bdf_files:
                        bdf_files.sort(key=os.path.getmtime, reverse=True)
                        bdf_path = bdf_files[0]
                        result_data["bdf_path"] = bdf_path
                    if bdf_path:
                        # BdfScanner.exe 실행: BDF → JSON
                        job_status_store.update_job(job_id, {"progress": 80, "message": "BdfScanner로 모델 JSON 변환 중..."})

                        if os.path.exists(_BDFSCANNER_EXE):
                            try:
                                # bytes 모드로 실행: .NET 콘솔 인코딩(OEM) 문제 회피
                                # bdf_path는 절대경로 → C# Path.GetDirectoryName()이 BDF 폴더에 JSON 출력
                                _scanner_cmd = [_BDFSCANNER_EXE, bdf_path]
                                logger.info("[ModelBuilder/BdfScanner] exe : %s", _BDFSCANNER_EXE)
                                logger.info("[ModelBuilder/BdfScanner] bdf : %s (exists=%s)", bdf_path, os.path.exists(bdf_path))
                                logger.info("[ModelBuilder/BdfScanner] cwd : %s", work_dir)
                                logger.info("[ModelBuilder/BdfScanner] cmd : %s", " ".join(_scanner_cmd))
                                scanner_result = subprocess.run(
                                    _scanner_cmd,
                                    cwd=work_dir,
                                    stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE,
                                    timeout=120,
                                )
                                stdout_text = scanner_result.stdout.decode("utf-8", errors="replace")
                                stderr_text = scanner_result.stderr.decode("utf-8", errors="replace")
                                logger.info("[ModelBuilder/BdfScanner] exit: %d", scanner_result.returncode)
                                logger.info("[ModelBuilder/BdfScanner] stdout: %s", stdout_text[:500] if stdout_text.strip() else "(empty)")
                                if stderr_text.strip():
                                    logger.warning("[ModelBuilder/BdfScanner] stderr: %s", stderr_text[:500])
                                engine_output += f"\n[BdfScanner] exit={scanner_result.returncode}"
                                if stdout_text.strip():
                                    engine_output += f"\n{stdout_text.strip()}"
                                if stderr_text.strip():
                                    engine_output += f"\n[BdfScanner stderr] {stderr_text.strip()}"

                                # 출력 JSON 위치: BDF와 동일한 폴더, <stem>.json
                                bdf_dir  = os.path.dirname(os.path.abspath(bdf_path))
                                bdf_stem = os.path.splitext(os.path.basename(bdf_path))[0]
                                scanner_json_path = os.path.join(bdf_dir, f"{bdf_stem}.json")
                                logger.info("[ModelBuilder/BdfScanner] 기대 JSON: %s", scanner_json_path)

                                # work_dir 내 모든 파일 목록 (디버깅용)
                                try:
                                    _dir_files = os.listdir(bdf_dir)
                                    logger.info("[ModelBuilder/BdfScanner] bdf_dir 파일 목록: %s", _dir_files)
                                except Exception:
                                    pass

                                if os.path.exists(scanner_json_path):
                                    logger.info("[ModelBuilder/BdfScanner] JSON 발견 — 변환 중")
                                    with open(scanner_json_path, "r", encoding="utf-8-sig", errors="replace") as f:
                                        scanner_data = json.load(f)

                                    # STAGE_07 JSON 탐색 — U-bolt 메타데이터 merge용
                                    stage_data = None
                                    stage07_files = glob.glob(
                                        os.path.join(work_dir, "**", "*_STAGE_07_*.json"),
                                        recursive=True,
                                    )
                                    if stage07_files:
                                        stage07_files.sort(key=os.path.getmtime, reverse=True)
                                        try:
                                            with open(stage07_files[0], "r", encoding="utf-8-sig", errors="replace") as f:
                                                stage_data = json.load(f)
                                            logger.info("[ModelBuilder] STAGE_07 로드 완료: %s", stage07_files[0])
                                        except Exception as e:
                                            logger.warning("[ModelBuilder] STAGE_07 로드 실패: %s", e)

                                    fem_data = _transform_bdfscanner_to_fem(scanner_data, stage_data=stage_data)

                                    # Three.js 호환 JSON 저장
                                    fem_json_path = os.path.join(work_dir, f"{timestamp}_FemModel.json")
                                    with open(fem_json_path, "w", encoding="utf-8") as f:
                                        json.dump(fem_data, f, ensure_ascii=False)

                                    json_path = fem_json_path
                                    result_data["json_path"] = json_path
                                    logger.info("[ModelBuilder/BdfScanner] FemModel JSON 저장 완료: %s", fem_json_path)

                                    # ConnectivityGroups JSON 탐지 (work_dir 하위 재귀 검색)
                                    cg_files = glob.glob(os.path.join(work_dir, "**", "*ConnectivityGroups*.json"), recursive=True)
                                    if cg_files:
                                        cg_files.sort(key=os.path.getmtime, reverse=True)
                                        result_data["connectivity_path"] = cg_files[0]
                                        logger.info("[ModelBuilder/BdfScanner] ConnectivityGroups: %s", cg_files[0])
                                else:
                                    logger.warning("[ModelBuilder/BdfScanner] JSON 미생성: %s", scanner_json_path)
                                    engine_output += f"\n[경고] BdfScanner JSON 미생성: {scanner_json_path}"

                            except subprocess.TimeoutExpired:
                                logger.warning("BdfScanner timeout for %s", bdf_path)
                                engine_output += "\n[경고] BdfScanner 실행 시간 초과 (2분)"
                            except Exception as e:
                                logger.warning("BdfScanner error: %s", str(e))
                                engine_output += f"\n[경고] BdfScanner 오류: {str(e)}"
                        else:
                            logger.warning("BdfScanner.exe not found: %s", _BDFSCANNER_EXE)
                            engine_output += f"\n[경고] BdfScanner.exe를 찾을 수 없습니다: {_BDFSCANNER_EXE}"

                if result.returncode != 0 and not log_content.strip():
                    status_msg = "Failed"
                    engine_output += f"\n[Exit code: {result.returncode}]\n{result.stderr}"

            except subprocess.TimeoutExpired:
                status_msg = "Failed"
                engine_output = "실행 시간 초과 (10분). 입력 파일을 확인하세요."
            except Exception as e:
                status_msg = "Failed"
                logger.error("HiTessModelBuilder subprocess error: %s", str(e), exc_info=True)
                engine_output = f"실행 오류: {str(e)}"

        job_status_store.update_job(job_id, {"progress": 90, "message": "DB 저장 중..."})

        try:
            new_analysis = models.Analysis(
                project_name=f"HiTessModelBuilder_{timestamp}",
                program_name="HiTessModelBuilder",
                employee_id=employee_id,
                status=status_msg,
                input_info=input_data,
                result_info=result_data if status_msg == "Success" else None,
                source=source,
            )
            db.add(new_analysis)
            db.commit()
            db.refresh(new_analysis)

            project_data = {
                "id": new_analysis.id,
                "project_name": new_analysis.project_name,
                "program_name": new_analysis.program_name,
                "employee_id": new_analysis.employee_id,
                "status": new_analysis.status,
                "created_at": (
                    new_analysis.created_at.isoformat()
                    if new_analysis.created_at
                    else datetime.now().isoformat()
                ),
            }
        except Exception as db_e:
            logger.error("DB save error: %s", str(db_e))
            engine_output += f"\nDB 기록 오류: {str(db_e)}"

        job_status_store.update_job(job_id, {
            "status": status_msg,
            "progress": 100,
            "message": msgs["done"] if status_msg == "Success" else msgs["fail"],
            "engine_log": engine_output,
            "log_content": log_content,
            "log_path": log_path,
            "bdf_path": bdf_path,
            "json_path": json_path,
            "connectivity_path": result_data.get("connectivity_path"),
            "stop_mode": stop_mode,
            "ubolt": ubolt,
            "stru_path": stru_path,
            "pipe_path": pipe_path,
            "equip_path": equip_path,
            "work_dir": work_dir,
            "project": project_data,
            "process_log":  process_log_data,
            "spc_z_band":   spc_z_band,
            "debug_stages": debug_stages,
            "stop_at":      stop_at,
        })

    finally:
        db.close()


def task_execute_rbe_retry(
    job_id: str,
    bdf_path: str,
    work_dir: str,
    employee_id: str,
    timestamp: str,
    source: str,
):
    """사용자 RBE2가 이미 append된 BDF에 BdfScanner를 실행하고 FemModel JSON으로 변환한다.
    top-level bdf_path/json_path/connectivity_path/work_dir을 job_status_store에 저장.
    Nastran은 실행하지 않음 — 프론트가 useNastran 플래그로 별도 체이닝."""
    job_status_store.update_job(job_id, {
        "status": "Running", "progress": 20, "message": "BDF 재스캔 중...",
    })

    engine_output = ""
    json_path = None
    status_msg = "Success"
    project_data = None
    result_data: dict = {"bdf_path": bdf_path}

    db = database.SessionLocal()
    try:
        if not os.path.exists(_BDFSCANNER_EXE):
            status_msg = "Failed"
            engine_output = f"BdfScanner.exe를 찾을 수 없습니다: {_BDFSCANNER_EXE}"
        else:
            job_status_store.update_job(job_id, {"progress": 40, "message": "BdfScanner 실행 중..."})
            scanner_result = subprocess.run(
                [_BDFSCANNER_EXE, bdf_path],
                cwd=work_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=120,
            )
            stdout_text = scanner_result.stdout.decode("utf-8", errors="replace")
            stderr_text = scanner_result.stderr.decode("utf-8", errors="replace")
            engine_output = stdout_text + (f"\n[stderr] {stderr_text}" if stderr_text.strip() else "")
            logger.info("[RbeRetry/BdfScanner] exit=%d", scanner_result.returncode)

            bdf_dir  = os.path.dirname(os.path.abspath(bdf_path))
            bdf_stem = os.path.splitext(os.path.basename(bdf_path))[0]
            scanner_json = os.path.join(bdf_dir, f"{bdf_stem}.json")

            job_status_store.update_job(job_id, {"progress": 70, "message": "FemModel JSON 변환 중..."})

            if os.path.exists(scanner_json):
                with open(scanner_json, "r", encoding="utf-8-sig", errors="replace") as f:
                    scanner_data = json.load(f)

                # STAGE_07은 상위 폴더(원본 work_dir)에서 탐색
                stage_data = None
                parent_work = os.path.dirname(work_dir)
                stage07_files = glob.glob(
                    os.path.join(parent_work, "**", "*_STAGE_07_*.json"),
                    recursive=True,
                )
                if stage07_files:
                    stage07_files.sort(key=os.path.getmtime, reverse=True)
                    try:
                        with open(stage07_files[0], "r", encoding="utf-8-sig", errors="replace") as f:
                            stage_data = json.load(f)
                    except Exception as e:
                        logger.warning("[RbeRetry] STAGE_07 로드 실패: %s", e)

                fem_data = _transform_bdfscanner_to_fem(scanner_data, stage_data=stage_data)
                fem_json_path = os.path.join(work_dir, f"{timestamp}_FemModel.json")
                with open(fem_json_path, "w", encoding="utf-8") as f:
                    json.dump(fem_data, f, ensure_ascii=False)
                json_path = fem_json_path
                result_data["json_path"] = json_path
                logger.info("[RbeRetry/BdfScanner] FemModel JSON 저장: %s", fem_json_path)

                cg_files = glob.glob(os.path.join(work_dir, "**", "*ConnectivityGroups*.json"), recursive=True)
                if cg_files:
                    cg_files.sort(key=os.path.getmtime, reverse=True)
                    result_data["connectivity_path"] = cg_files[0]
                else:
                    # BdfScanner는 ConnectivityGroups를 생성하지 않음 → Python으로 계산
                    cg_data = _compute_connectivity_groups(fem_data)
                    cg_path = os.path.join(work_dir, f"{bdf_stem}_ConnectivityGroups_{timestamp}.json")
                    with open(cg_path, "w", encoding="utf-8") as f:
                        json.dump(cg_data, f, ensure_ascii=False)
                    result_data["connectivity_path"] = cg_path
                    logger.info("[RbeRetry] ConnectivityGroups 계산 저장: %s (groups=%d)",
                                cg_path, cg_data["Summary"]["GroupCount"])
            else:
                status_msg = "Failed"
                engine_output += f"\n[경고] BdfScanner JSON 미생성: {scanner_json}"
                logger.warning("[RbeRetry/BdfScanner] JSON 미생성: %s", scanner_json)

        job_status_store.update_job(job_id, {"progress": 90, "message": "DB 저장 중..."})
        try:
            new_analysis = models.Analysis(
                project_name=f"HiTessModelBuilder_RBE_{timestamp}",
                program_name="HiTessModelBuilder",
                employee_id=employee_id,
                status=status_msg,
                input_info={"bdf_model": bdf_path, "mode": "rbe_retry"},
                result_info=result_data if status_msg == "Success" else None,
                source=source,
            )
            db.add(new_analysis)
            db.commit()
            db.refresh(new_analysis)
            project_data = {
                "id":           new_analysis.id,
                "project_name": new_analysis.project_name,
                "program_name": new_analysis.program_name,
                "employee_id":  new_analysis.employee_id,
                "status":       new_analysis.status,
                "created_at":   (
                    new_analysis.created_at.isoformat()
                    if new_analysis.created_at
                    else datetime.now().isoformat()
                ),
            }
        except Exception as db_e:
            logger.error("[RbeRetry] DB 저장 오류: %s", str(db_e))
            engine_output += f"\nDB 오류: {str(db_e)}"
    except subprocess.TimeoutExpired:
        status_msg = "Failed"
        engine_output += "\nBdfScanner 실행 시간 초과 (2분)"
    except Exception as e:
        status_msg = "Failed"
        logger.error("[RbeRetry] 오류: %s", str(e), exc_info=True)
        engine_output += f"\nRBE retry 오류: {str(e)}"
    finally:
        db.close()

    job_status_store.update_job(job_id, {
        "status":            status_msg,
        "progress":          100,
        "message":           "RBE2 반영 완료" if status_msg == "Success" else "RBE2 반영 실패",
        "engine_log":        engine_output,
        "bdf_path":          bdf_path,
        "json_path":         json_path,
        "connectivity_path": result_data.get("connectivity_path"),
        "work_dir":          work_dir,
        "project":           project_data,
    })


def task_execute_group_delete(
    job_id: str,
    bdf_path: str,        # 이미 라우터가 remove_elements_from_bdf 완료한 BDF
    work_dir: str,        # group_delete_{ts}/ 서브폴더
    employee_id: str,
    timestamp: str,
    source: str,
    group_id,             # int | None — DB 로깅용 메타
    deleted_count: int,
):
    """그룹 element가 제거된 BDF에 BdfScanner를 실행하고 FemModel JSON으로 변환한다.
    top-level bdf_path/json_path/connectivity_path/work_dir을 job_status_store에 저장.
    Nastran은 실행하지 않음 — 프론트가 useNastran 플래그로 별도 체이닝."""
    job_status_store.update_job(job_id, {
        "status": "Running", "progress": 20, "message": "BDF 재스캔 중...",
    })

    engine_output = ""
    json_path = None
    status_msg = "Success"
    project_data = None
    result_data: dict = {"bdf_path": bdf_path}

    db = database.SessionLocal()
    try:
        if not os.path.exists(_BDFSCANNER_EXE):
            status_msg = "Failed"
            engine_output = f"BdfScanner.exe를 찾을 수 없습니다: {_BDFSCANNER_EXE}"
        else:
            job_status_store.update_job(job_id, {"progress": 40, "message": "BdfScanner 실행 중..."})
            scanner_result = subprocess.run(
                [_BDFSCANNER_EXE, bdf_path],
                cwd=work_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=120,
            )
            stdout_text = scanner_result.stdout.decode("utf-8", errors="replace")
            stderr_text = scanner_result.stderr.decode("utf-8", errors="replace")
            engine_output = stdout_text + (f"\n[stderr] {stderr_text}" if stderr_text.strip() else "")
            logger.info("[GroupDelete/BdfScanner] exit=%d", scanner_result.returncode)

            bdf_dir  = os.path.dirname(os.path.abspath(bdf_path))
            bdf_stem = os.path.splitext(os.path.basename(bdf_path))[0]
            scanner_json = os.path.join(bdf_dir, f"{bdf_stem}.json")

            job_status_store.update_job(job_id, {"progress": 70, "message": "FemModel JSON 변환 중..."})

            if os.path.exists(scanner_json):
                with open(scanner_json, "r", encoding="utf-8-sig", errors="replace") as f:
                    scanner_data = json.load(f)

                # STAGE_07은 상위 폴더(원본 work_dir)에서 탐색
                stage_data = None
                parent_work = os.path.dirname(work_dir)
                stage07_files = glob.glob(
                    os.path.join(parent_work, "**", "*_STAGE_07_*.json"),
                    recursive=True,
                )
                if stage07_files:
                    stage07_files.sort(key=os.path.getmtime, reverse=True)
                    try:
                        with open(stage07_files[0], "r", encoding="utf-8-sig", errors="replace") as f:
                            stage_data = json.load(f)
                    except Exception as e:
                        logger.warning("[GroupDelete] STAGE_07 로드 실패: %s", e)

                fem_data = _transform_bdfscanner_to_fem(scanner_data, stage_data=stage_data)
                fem_json_path = os.path.join(work_dir, f"{timestamp}_FemModel.json")
                with open(fem_json_path, "w", encoding="utf-8") as f:
                    json.dump(fem_data, f, ensure_ascii=False)
                json_path = fem_json_path
                result_data["json_path"] = json_path
                logger.info("[GroupDelete/BdfScanner] FemModel JSON 저장: %s", fem_json_path)

                cg_files = glob.glob(os.path.join(work_dir, "**", "*ConnectivityGroups*.json"), recursive=True)
                if cg_files:
                    cg_files.sort(key=os.path.getmtime, reverse=True)
                    result_data["connectivity_path"] = cg_files[0]
                else:
                    # BdfScanner는 ConnectivityGroups를 생성하지 않음 → Python으로 계산
                    cg_data = _compute_connectivity_groups(fem_data)
                    cg_path = os.path.join(work_dir, f"{bdf_stem}_ConnectivityGroups_{timestamp}.json")
                    with open(cg_path, "w", encoding="utf-8") as f:
                        json.dump(cg_data, f, ensure_ascii=False)
                    result_data["connectivity_path"] = cg_path
                    logger.info("[GroupDelete] ConnectivityGroups 계산 저장: %s (groups=%d)",
                                cg_path, cg_data["Summary"]["GroupCount"])
            else:
                status_msg = "Failed"
                engine_output += f"\n[경고] BdfScanner JSON 미생성: {scanner_json}"
                logger.warning("[GroupDelete/BdfScanner] JSON 미생성: %s", scanner_json)

        job_status_store.update_job(job_id, {"progress": 90, "message": "DB 저장 중..."})
        try:
            new_analysis = models.Analysis(
                project_name=f"HiTessModelBuilder_GROUPDEL_{timestamp}",
                program_name="HiTessModelBuilder",
                employee_id=employee_id,
                status=status_msg,
                input_info={
                    "bdf_model":     bdf_path,
                    "mode":          "group_delete",
                    "group_id":      group_id,
                    "deleted_count": deleted_count,
                },
                result_info=result_data if status_msg == "Success" else None,
                source=source,
            )
            db.add(new_analysis)
            db.commit()
            db.refresh(new_analysis)
            project_data = {
                "id":           new_analysis.id,
                "project_name": new_analysis.project_name,
                "program_name": new_analysis.program_name,
                "employee_id":  new_analysis.employee_id,
                "status":       new_analysis.status,
                "created_at":   (
                    new_analysis.created_at.isoformat()
                    if new_analysis.created_at
                    else datetime.now().isoformat()
                ),
            }
        except Exception as db_e:
            logger.error("[GroupDelete] DB 저장 오류: %s", str(db_e))
            engine_output += f"\nDB 오류: {str(db_e)}"
    except subprocess.TimeoutExpired:
        status_msg = "Failed"
        engine_output += "\nBdfScanner 실행 시간 초과 (2분)"
    except Exception as e:
        status_msg = "Failed"
        logger.error("[GroupDelete] 오류: %s", str(e), exc_info=True)
        engine_output += f"\n그룹 삭제 오류: {str(e)}"
    finally:
        db.close()

    job_status_store.update_job(job_id, {
        "status":            status_msg,
        "progress":          100,
        "message":           "그룹 삭제 반영 완료" if status_msg == "Success" else "그룹 삭제 반영 실패",
        "engine_log":        engine_output,
        "bdf_path":          bdf_path,
        "json_path":         json_path,
        "connectivity_path": result_data.get("connectivity_path"),
        "work_dir":          work_dir,
        "project":           project_data,
    })
