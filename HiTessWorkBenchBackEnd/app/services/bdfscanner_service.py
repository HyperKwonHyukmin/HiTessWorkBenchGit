"""BDF Scanner 서비스 — BDF 파일 유효성 검증 및 Nastran F06 요약 추출."""
import os
import subprocess
import logging
from datetime import datetime
from .. import models, database
from ..services.job_manager import job_status_store

logger = logging.getLogger(__name__)


def task_execute_bdfscanner(
    job_id: str,
    bdf_path: str,
    work_dir: str,
    employee_id: str,
    timestamp: str,
    source: str,
    use_nastran: bool,
):
    """
    FemScanner.exe를 호출하여 BDF 유효성 검증 및 (선택) Nastran F06 요약을 수행합니다.
    출력 파일:
      - {BdfName}.json                  : BDF 모델 전체 (grids, elements 등)
      - {BdfName}_validation_step1.json : Step1 BDF 기본 검토 결과
      - {BdfName}_validation_step2.json : Step2 Nastran 해석 검토 결과 (--nastran 시에만)
    """
    job_status_store.update_job(job_id, {
        "status": "Running",
        "progress": 10,
        "message": "BDF Scanner 초기화 중...",
    })

    db = database.SessionLocal()
    status_msg = "Success"
    engine_output = ""
    result_data = {}
    project_data = None

    # EXE 경로 동적 생성
    base_dir = os.path.dirname(os.path.abspath(__file__))  # app/services
    app_dir = os.path.dirname(base_dir)                    # app
    backend_dir = os.path.dirname(app_dir)                 # HiTessWorkBenchBackEnd

    exe_dir = os.path.join(backend_dir, "InHouseProgram", "BdfScanner")
    exe_path = os.path.join(exe_dir, "FemScanner.exe")

    try:
        if not os.path.exists(exe_path):
            raise FileNotFoundError(f"실행 파일을 찾을 수 없습니다: {exe_path}")

        # BDF가 work_dir의 하위 폴더에 있을 수 있으므로 실제 BDF 위치 기준으로 cwd 설정
        # FemScanner.exe는 입력 BDF와 동일한 디렉터리에 JSON/F06 파일을 출력함
        bdf_dir = os.path.dirname(os.path.abspath(bdf_path))
        bdf_filename = os.path.basename(bdf_path)
        if use_nastran:
            cmd_args = [exe_path, bdf_filename, "--nastran"]
            progress_msg = "BDF 검증 및 Nastran 해석 실행 중..."
        else:
            cmd_args = [exe_path, bdf_filename]
            progress_msg = "BDF 유효성 검증 실행 중..."

        job_status_store.update_job(job_id, {
            "progress": 40,
            "message": progress_msg,
        })

        # ── 디버그: 실행 환경 로그 ──────────────────────────────────────
        logger.info("[BdfScanner] exe   : %s (exists=%s)", exe_path, os.path.exists(exe_path))
        logger.info("[BdfScanner] bdf   : %s (exists=%s)", bdf_path, os.path.exists(bdf_path))
        logger.info("[BdfScanner] bdf_dir: %s", bdf_dir)
        logger.info("[BdfScanner] cmd   : %s", " ".join(cmd_args))
        # ───────────────────────────────────────────────────────────────

        # bytes 모드로 실행: .NET 콘솔 인코딩(OEM) 문제 회피
        result = subprocess.run(
            cmd_args,
            cwd=bdf_dir,   # BDF 파일이 있는 디렉터리에서 실행
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=360,   # exe 내부 Nastran 타임아웃 300초 + 여유 60초
        )
        engine_output = result.stdout.decode("utf-8", errors="replace")
        stderr_text = result.stderr.decode("utf-8", errors="replace")

        # ── 디버그: 실행 결과 로그 ──────────────────────────────────────
        logger.info("[BdfScanner] exit  : %d", result.returncode)
        logger.info("[BdfScanner] stdout: %s", engine_output[:500] if engine_output.strip() else "(empty)")
        if stderr_text.strip():
            logger.warning("[BdfScanner] stderr: %s", stderr_text[:500])
        # ───────────────────────────────────────────────────────────────

        if stderr_text.strip():
            engine_output += f"\n[stderr] {stderr_text.strip()}"
        if result.returncode != 0:
            logger.warning("BdfScanner exited with code %d", result.returncode)
            engine_output += f"\n[Exit code: {result.returncode}]"

        job_status_store.update_job(job_id, {
            "progress": 80,
            "message": "결과 파일 수집 중...",
        })

        # 출력 파일 수집 — BDF와 동일한 디렉터리(bdf_dir)에서 탐색
        bdf_stem = os.path.splitext(bdf_filename)[0]

        expected_files = {
            f"{bdf_stem}.json":                  "JSON_ModelInfo",
            f"{bdf_stem}_validation_step1.json": "JSON_Validation",
            f"{bdf_stem}_validation_step2.json": "JSON_F06Summary",
        }

        # 디버깅: 실행 후 bdf_dir 파일 목록
        try:
            _dir_files = os.listdir(bdf_dir)
            logger.info("[BdfScanner] bdf_dir 파일 목록: %s", _dir_files)
        except Exception:
            pass
        logger.info("[BdfScanner] 탐색 대상 파일: %s", list(expected_files.keys()))

        found_count = 0
        for filename, key in expected_files.items():
            for f in os.listdir(bdf_dir):
                if f.lower() == filename.lower():
                    result_data[key] = os.path.join(bdf_dir, f)
                    found_count += 1
                    break

        # BDF 원본 경로도 함께 포함
        result_data["bdf"] = bdf_path
        result_data["use_nastran"] = use_nastran

        if found_count == 0:
            engine_output += "\n[Warning] JSON 결과 파일이 생성되지 않았습니다. EXE 출력 경로를 확인하세요."

        # Nastran 요청 시 F06 파일 존재 여부 검증 및 경로 저장
        if use_nastran:
            f06_candidates = [f for f in os.listdir(bdf_dir) if f.lower().endswith("_check.f06")]
            if f06_candidates:
                result_data["f06"] = os.path.join(bdf_dir, f06_candidates[0])
            else:
                status_msg = "Failed"
                engine_output += "\n[Error] Nastran 해석 후 F06 파일이 생성되지 않았습니다. Nastran이 정상 실행되지 않았습니다."

        # step2.json 유효성 검증:
        # 저작권 배너만 있는 경우 실질적 결과 없으므로 제외
        if "JSON_F06Summary" in result_data:
            import json as _json
            try:
                with open(result_data["JSON_F06Summary"], "r", encoding="utf-8") as _f:
                    _s2 = _json.load(_f)
                _f06 = _s2.get("f06Summary") or {}
                _msgs = _f06.get("messages") or []
                # 저작권 배너를 제외한 실질적 메시지만 확인
                _real_msgs = [m for m in _msgs if "copyright law" not in (m.get("message") or "").lower()]
                _has_content = len(_real_msgs) > 0 or _s2.get("status") == "pass"
                if not _has_content:
                    engine_output += "\n[Warning] Nastran이 실행되었으나 유의미한 해석 결과가 없습니다. 모델을 확인하세요."
                    del result_data["JSON_F06Summary"]
            except Exception:
                pass  # 파일 읽기 실패 시 그냥 포함

    except subprocess.TimeoutExpired:
        status_msg = "Failed"
        engine_output = "Nastran 해석 시간이 초과되었습니다 (6분). 모델 크기 또는 Nastran 설정을 확인하세요."
    except Exception as e:
        status_msg = "Failed"
        logger.error("BdfScanner 예기치 않은 오류: %s", str(e), exc_info=True)
        engine_output = f"예기치 않은 오류가 발생했습니다: {str(e)}"

    job_status_store.update_job(job_id, {"progress": 95, "message": "데이터베이스 저장 중..."})

    # DB 기록 및 상태 동기화
    try:
        new_analysis = models.Analysis(
            project_name=f"BdfScanner_{timestamp}",
            program_name="BDF Scanner",
            employee_id=employee_id,
            status=status_msg,
            input_info={"bdf_model": bdf_path, "use_nastran": use_nastran},
            result_info=result_data if result_data else None,
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
            "input_info": new_analysis.input_info,
            "result_info": new_analysis.result_info,
            "created_at": new_analysis.created_at.isoformat() if new_analysis.created_at else datetime.now().isoformat(),
        }
    except Exception as db_e:
        status_msg = "Failed"
        engine_output += f"\nDB Error: {str(db_e)}"
    finally:
        db.close()

    job_status_store.update_job(job_id, {
        "status": status_msg,
        "progress": 100,
        "message": "스캔 완료" if status_msg == "Success" else "스캔 실패",
        "engine_log": engine_output,
        "project": project_data,
    })
