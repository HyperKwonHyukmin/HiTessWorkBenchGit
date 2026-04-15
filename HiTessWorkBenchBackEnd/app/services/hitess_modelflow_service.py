"""HiTess ModelFlow 파이프라인 단계별 백그라운드 실행 로직.

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

def _transform_bdfscanner_to_fem(data: dict) -> dict:
    """BdfScanner 출력 JSON을 Three.js FemModelViewer 호환 포맷으로 변환한다.

    Three.js 기대 구조:
      nodes       : {id: {x, y, z}}
      elements    : {id: {nodeIds, classification}}  — RBE2/CONM2 제외
      rigids      : {id: {independentNodeId, dependentNodeIds[]}}
      pointMasses : {id: {nodeId, mass}}
      boundaryConditions: {spcNodeIds: [...]}

    BdfScanner 출력 구조 (README 기준):
      grids[]            — GRID 카드
      elements[]         — 모든 요소 (cardType 구분)
      boundaryConditions[] — SPC/SPC1/MPC
    """
    # 1. nodes: grids 배열 → {id: {x,y,z}} dict
    nodes = {}
    for g in data.get("grids", []):
        nodes[str(g["id"])] = {"x": g.get("x", 0.0), "y": g.get("y", 0.0), "z": g.get("z", 0.0)}

    # 2. elements 분류
    RIGID_TYPES     = {"RBE2"}
    MASS_TYPES      = {"CONM2"}
    BEAM_TYPES      = {"CBEAM", "CBAR", "CROD", "CQUAD4", "CTRIA3", "CTETRA", "CHEXA"}

    elements    = {}
    rigids      = {}
    point_masses = {}

    for elem in data.get("elements", []):
        card_type = elem.get("cardType", "")
        eid       = str(elem.get("id", ""))

        if card_type in RIGID_TYPES:
            rigids[eid] = {
                "independentNodeId": elem.get("independentNodeId"),
                "dependentNodeIds":  elem.get("dependentNodeIds", []),
            }
        elif card_type in MASS_TYPES:
            point_masses[eid] = {
                "nodeId": elem.get("nodeId"),
                "mass":   elem.get("mass", 0.0),
            }
        elif card_type in BEAM_TYPES:
            # BdfScanner는 Pipe/Stru 분류 정보를 포함하지 않으므로 기본값 'Stru'
            elements[eid] = {
                "nodeIds":        elem.get("nodeIds", []),
                "classification": "Stru",
            }

    # 3. boundaryConditions: SPC/SPC1 nodeIds 합산 → spcNodeIds 플랫 리스트
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
):
    msgs = _STAGE_MESSAGES.get(stop_mode, _STAGE_MESSAGES["load"])
    job_status_store.update_job(job_id, {"status": "Running", "progress": 10, "message": msgs["start"]})

    input_data = {"stru_csv": stru_path, "pipe_csv": pipe_path, "equip_csv": equip_path}
    result_data: dict = {}
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

                job_status_store.update_job(job_id, {"progress": 70, "message": "결과 파일 수집 중..."})

                # 프로세스 로그 파일 수집
                log_files = glob.glob(os.path.join(work_dir, "*_ProcessLog_*.txt"))
                if log_files:
                    log_files.sort(key=os.path.getmtime, reverse=True)
                    log_path = log_files[0]
                    with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                        log_content = f.read()
                    result_data["log_path"] = log_path
                else:
                    log_content = engine_output

                # BDF 수집: <struName>.bdf (Verification/Material/STAGE 제외)
                if stop_mode == "7":
                    bdf_files = [
                        f for f in glob.glob(os.path.join(work_dir, "*.bdf"))
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
                                logger.info("[ModelFlow/BdfScanner] exe : %s", _BDFSCANNER_EXE)
                                logger.info("[ModelFlow/BdfScanner] bdf : %s (exists=%s)", bdf_path, os.path.exists(bdf_path))
                                logger.info("[ModelFlow/BdfScanner] cwd : %s", work_dir)
                                logger.info("[ModelFlow/BdfScanner] cmd : %s", " ".join(_scanner_cmd))
                                scanner_result = subprocess.run(
                                    _scanner_cmd,
                                    cwd=work_dir,
                                    stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE,
                                    timeout=120,
                                )
                                stdout_text = scanner_result.stdout.decode("utf-8", errors="replace")
                                stderr_text = scanner_result.stderr.decode("utf-8", errors="replace")
                                logger.info("[ModelFlow/BdfScanner] exit: %d", scanner_result.returncode)
                                logger.info("[ModelFlow/BdfScanner] stdout: %s", stdout_text[:500] if stdout_text.strip() else "(empty)")
                                if stderr_text.strip():
                                    logger.warning("[ModelFlow/BdfScanner] stderr: %s", stderr_text[:500])
                                engine_output += f"\n[BdfScanner] exit={scanner_result.returncode}"
                                if stdout_text.strip():
                                    engine_output += f"\n{stdout_text.strip()}"
                                if stderr_text.strip():
                                    engine_output += f"\n[BdfScanner stderr] {stderr_text.strip()}"

                                # 출력 JSON 위치: BDF와 동일한 폴더, <stem>.json
                                bdf_dir  = os.path.dirname(os.path.abspath(bdf_path))
                                bdf_stem = os.path.splitext(os.path.basename(bdf_path))[0]
                                scanner_json_path = os.path.join(bdf_dir, f"{bdf_stem}.json")
                                logger.info("[ModelFlow/BdfScanner] 기대 JSON: %s", scanner_json_path)

                                # work_dir 내 모든 파일 목록 (디버깅용)
                                try:
                                    _dir_files = os.listdir(bdf_dir)
                                    logger.info("[ModelFlow/BdfScanner] bdf_dir 파일 목록: %s", _dir_files)
                                except Exception:
                                    pass

                                if os.path.exists(scanner_json_path):
                                    logger.info("[ModelFlow/BdfScanner] JSON 발견 — 변환 중")
                                    with open(scanner_json_path, "r", encoding="utf-8-sig", errors="replace") as f:
                                        scanner_data = json.load(f)

                                    fem_data = _transform_bdfscanner_to_fem(scanner_data)

                                    # Three.js 호환 JSON 저장
                                    fem_json_path = os.path.join(work_dir, f"{timestamp}_FemModel.json")
                                    with open(fem_json_path, "w", encoding="utf-8") as f:
                                        json.dump(fem_data, f, ensure_ascii=False)

                                    json_path = fem_json_path
                                    result_data["json_path"] = json_path
                                    logger.info("[ModelFlow/BdfScanner] FemModel JSON 저장 완료: %s", fem_json_path)
                                else:
                                    logger.warning("[ModelFlow/BdfScanner] JSON 미생성: %s", scanner_json_path)
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
                logger.error("HiTessModelFlow subprocess error: %s", str(e), exc_info=True)
                engine_output = f"실행 오류: {str(e)}"

        job_status_store.update_job(job_id, {"progress": 90, "message": "DB 저장 중..."})

        try:
            new_analysis = models.Analysis(
                project_name=f"HiTessModelFlow_{timestamp}",
                program_name="HiTessModelFlow",
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
            "stop_mode": stop_mode,
            "ubolt": ubolt,
            "stru_path": stru_path,
            "pipe_path": pipe_path,
            "equip_path": equip_path,
            "work_dir": work_dir,
            "project": project_data,
        })

    finally:
        db.close()
