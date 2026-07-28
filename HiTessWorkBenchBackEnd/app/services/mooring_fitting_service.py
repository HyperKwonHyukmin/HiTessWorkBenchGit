"""Mooring Fitting Assessment 서비스 — CSV 2종 → MooringFitting.exe build-full 실행 + 산출물 수집."""
import json
import logging
import os
import subprocess

from .analysis_runner import (
    mark_complete,
    mark_running,
    record_analysis,
    update_progress,
)

logger = logging.getLogger(__name__)

PROGRAM_NAME = "MooringFitting"
TIMEOUT_SECONDS = 600

# 구조해석(solve-bdf)은 SOL 101 + 다중 SUBCASE 라 build-full 보다 길 수 있어 별도 타임아웃.
SOLVE_TIMEOUT_SECONDS = 1800


def _kill_process_tree(pid: int) -> None:
    """자식 프로세스 트리 전체를 강제 종료(Windows taskkill /T /F)."""
    try:
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(pid)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
    except Exception:  # noqa: BLE001 — 정리 실패가 상위 흐름을 막지 않게 흡수
        logger.warning("[MooringFitting] taskkill 실패 (pid=%s)", pid, exc_info=True)


def _run_capture(cmd: list[str], cwd: str, timeout: int):
    """
    subprocess.run(timeout=...) 대체 — 타임아웃 시 자식 프로세스 '트리 전체'를 종료한다.

    문제: subprocess.run(timeout)은 Windows에서 직계 자식(MooringFitting.exe)만 kill하여
    cmd.exe → nastran.exe → analysis.exe 손자 프로세스가 고아(zombie)로 남고 MSC 라이선스
    seat 를 계속 점유한다(다음 job 라이선스 체크아웃 실패로 전이).
    해결: Popen + 타임아웃 시 taskkill /T /F 로 트리 전체를 정리한 뒤 TimeoutExpired 를 재전파.

    반환: (returncode, stdout_bytes, stderr_bytes)
    """
    proc = subprocess.Popen(
        cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    try:
        stdout_b, stderr_b = proc.communicate(timeout=timeout)
        return proc.returncode, stdout_b, stderr_b
    except subprocess.TimeoutExpired:
        _kill_process_tree(proc.pid)          # 손자까지 전부 종료(좀비/라이선스 누수 방지)
        try:
            proc.communicate(timeout=10)      # 파이프 drain (deadlock 방지)
        except Exception:  # noqa: BLE001
            pass
        raise                                  # 원래 TimeoutExpired 를 상위 핸들러로 재전파


def collect_artifacts(out_dir: str, work_dir: str) -> dict:
    """
    MooringFitting.exe 가 생성한 out/ 폴더 산출물을 분류·수집한다.

    핵심 5개(페이지 기본 노출):
        final_bdf, validation_json, lineage_json, report_mf_csv, report_winch_csv
    보조(Phase 2 뷰어용 펼치기 영역):
        stage_jsons, stage_bdfs, stage_verifications, raw_json, initial_json

        stage_jsons 는 STAGE_NN_<phase>.json 만 수집한다 — STAGE_NN.raw.json,
        STAGE_NN.initial.json, *.validation.json, *.bdf.verification.json 은
        별도 키로 분리되므로 제외한다.

    out/ 폴더 자체가 없으면 {_artifacts_missing: True, out_dir} 만 반환.
    """
    if not os.path.isdir(out_dir):
        return {
            "case_dir": work_dir,
            "out_dir": out_dir,
            "_artifacts_missing": True,
        }

    files = os.listdir(out_dir)
    file_set = set(files)

    def _pick(name: str) -> str | None:
        return os.path.join(out_dir, name) if name in file_set else None

    stage_jsons = sorted(
        os.path.join(out_dir, f) for f in files
        if f.startswith("STAGE_") and f.endswith(".json")
        and ".verification." not in f
        and not f.endswith(".raw.json")
        and not f.endswith(".initial.json")
        and not f.endswith(".validation.json")
    )
    stage_bdfs = sorted(
        os.path.join(out_dir, f) for f in files
        if f.startswith("STAGE_") and f.endswith(".bdf")
    )
    stage_verifications = sorted(
        os.path.join(out_dir, f) for f in files
        if f.endswith(".bdf.verification.json")
    )

    return {
        "case_dir": work_dir,
        "out_dir": out_dir,
        "final_bdf":         _pick("STAGE_07_FinalValidation.bdf"),
        "validation_json":   _pick("STAGE_07_FinalValidation.validation.json"),
        "lineage_json":      _pick("LINEAGE.json"),
        "report_mf_csv":     _pick("Report_LoadCalculation_MF.csv"),
        "report_winch_csv":  _pick("Report_LoadCalculation_Winch.csv"),
        "stage_jsons":          stage_jsons,
        "stage_bdfs":           stage_bdfs,
        "stage_verifications":  stage_verifications,
        "raw_json":             _pick("STAGE_00.raw.json"),
        "initial_json":         _pick("STAGE_00.initial.json"),
    }


def task_execute_mooring_fitting(
    job_id: str,
    structure_path: str,
    load_path: str,
    work_dir: str,
    exe_path: str,
    employee_id: str,
    timestamp: str,
    source: str,
    mf_safety_factor: float = 1.0,
):
    """
    MooringFitting.exe build-full <work_dir> --mf-sf=<sf> 를 호출한다.

    mf_safety_factor: MF 하중 전용 안전계수(라우터에서 검증된 양수). Winch 미적용.

    동작:
      - work_dir 안에 MooringFittingData.csv / MooringFittingDataLoad.csv 가 표준명으로 이미 저장되어 있다고 가정 (라우터 책임).
      - exe 는 cwd=work_dir 로 실행되며 out/ 폴더에 산출물을 생성한다.
      - exit code 0 = Success, 그 외 = Failed (stdout/stderr 통합해 engine_output 에 노출).
      - record_analysis 로 DB 기록 + mark_complete 로 job_status_store 마감.
    """
    mark_running(job_id, "MooringFitting 초기화 중...", progress=10)

    status_msg = "Success"
    engine_output = ""
    result_data = {}

    try:
        if not os.path.exists(exe_path):
            raise FileNotFoundError(f"실행 파일을 찾을 수 없습니다: {exe_path}")

        update_progress(job_id, 30, "MooringFitting 파이프라인 실행 중...")
        logger.info("[MooringFitting] exe=%s, work_dir=%s, mf_sf=%s", exe_path, work_dir, mf_safety_factor)

        returncode, stdout_b, stderr_b = _run_capture(
            [exe_path, "build-full", work_dir, f"--mf-sf={mf_safety_factor}"],
            cwd=work_dir,
            timeout=TIMEOUT_SECONDS,
        )
        engine_output = stdout_b.decode("utf-8", errors="replace")
        stderr_text = stderr_b.decode("utf-8", errors="replace")
        if stderr_text.strip():
            engine_output += f"\n[stderr] {stderr_text.strip()}"
        if returncode != 0:
            status_msg = "Failed"
            engine_output += f"\n[Exit code: {returncode}]"

        update_progress(job_id, 80, "결과 파일 수집 중...")
        out_dir = os.path.join(work_dir, "out")
        result_data = collect_artifacts(out_dir, work_dir)
        if result_data.get("_artifacts_missing"):
            status_msg = "Failed"
            engine_output += "\n[Error] out/ 폴더가 생성되지 않았습니다. exe 실행 로그를 확인하세요."

    except subprocess.TimeoutExpired:
        status_msg = "Failed"
        engine_output = f"MooringFitting 실행 시간이 초과되었습니다 ({TIMEOUT_SECONDS // 60}분)."
    except FileNotFoundError as e:
        status_msg = "Failed"
        logger.error("[MooringFitting] exe not found: %s", str(e))
        engine_output = str(e)
    except Exception as e:
        status_msg = "Failed"
        logger.error("MooringFitting unexpected error: %s", str(e), exc_info=True)
        engine_output = f"예기치 않은 오류가 발생했습니다: {str(e)}"

    update_progress(job_id, 95, "데이터베이스 저장 중...")
    project_data, db_err = record_analysis(
        job_id=job_id,
        project_name=f"{PROGRAM_NAME}_{timestamp}",
        program_name=PROGRAM_NAME,
        employee_id=employee_id,
        status=status_msg,
        input_info={
            "structure_csv": structure_path,
            "load_csv": load_path,
            "mf_safety_factor": mf_safety_factor,
        },
        result_info=result_data if result_data else None,
        source=source,
    )
    if db_err is not None:
        status_msg = "Failed"
        engine_output += f"\nDB Error: {db_err}"

    mark_complete(
        job_id, status_msg, engine_output, project_data,
        success_message="MooringFitting 해석 완료",
        failure_message="MooringFitting 해석 실패",
    )


# 전단 허용 = 정응력 허용 × SHEAR_FACTOR (0.6·σy/γM = AISC Fv). σy 315 → 전단 허용 189.
SHEAR_ALLOW_FACTOR = 0.6


def recompute_sigma_ny(payload: dict) -> dict:
    """
    exe 가 von Mises 기준으로 내보낸 결과 JSON 을 '정응력 σNy / 전단 분리' 평가로 재계산한다.

    실적 보고서 방식(닫힌 Chock 평가)에 맞춤 — exe 수정 없이 이미 출력된 성분
    (nx/my/mz=σNx/σMy/σMz, qy/qz/mx=τQy/τQz/τMx)으로 재계산한다:
      - 정응력 σN = |σNx| + max(|σMy|, |σMz|)   (= σNy, σNz 중 큰 값, 최악 섬유)  ≤ 허용(σy/γM)
      - 전단  τ  = max(|τQy|, |τQz|, |τMx|)      (최대 전단 성분)                 ≤ 0.6·허용
      - Usage = max(σN/허용, τ/전단허용),  OK if ≤ 1
    주의: exe 는 element 당 'von Mises 최악 station' 성분만 출력하므로, σNy 최악 station 이
          다른 드문 경우 근소한 차이가 있을 수 있다(정밀 일치는 exe solve-bdf 의 station 선정 변경 필요).
    """
    ys = payload.get("yieldStress") or 315.0
    gm = payload.get("gammaM") or 1.0
    allow_n = payload.get("allowable")
    if not allow_n or allow_n <= 0:
        allow_n = ys / gm
    allow_t = allow_n * SHEAR_ALLOW_FACTOR

    def _abs(v):
        try:
            return abs(float(v or 0))
        except (TypeError, ValueError):
            return 0.0

    g_max_n = g_max_t = g_max_u = 0.0
    overall_ok = True
    for case in payload.get("cases", []):
        c_max_n = c_max_t = c_max_u = 0.0
        for e in case.get("elements", []):
            nx, my, mz = _abs(e.get("nx")), _abs(e.get("my")), _abs(e.get("mz"))
            mx, qy, qz = _abs(e.get("mx")), _abs(e.get("qy")), _abs(e.get("qz"))
            sigma_n = nx + max(my, mz)          # σNy/σNz 중 큰 값
            tau = max(qy, qz, mx)               # 최대 전단 성분
            u_n = sigma_n / allow_n if allow_n else 0.0
            u_t = tau / allow_t if allow_t else 0.0
            usage = max(u_n, u_t)
            ok = usage <= 1.0
            e["sigmaN"] = round(sigma_n, 2)
            e["tau"] = round(tau, 2)
            e["usageNormal"] = round(u_n, 4)
            e["usageShear"] = round(u_t, 4)
            e["usage"] = round(usage, 4)
            e["ok"] = ok
            # 하위호환(3D 색·기존 소비 필드) — 정응력으로 채움
            e["combined"] = round(sigma_n, 2)
            e["vonMises"] = round(sigma_n, 2)
            if not ok:
                overall_ok = False
            c_max_n = max(c_max_n, sigma_n)
            c_max_t = max(c_max_t, tau)
            c_max_u = max(c_max_u, usage)
        case["max"] = round(c_max_n, 2)
        case["maxShear"] = round(c_max_t, 2)
        case["maxUsage"] = round(c_max_u, 4)
        g_max_n = max(g_max_n, c_max_n)
        g_max_t = max(g_max_t, c_max_t)
        g_max_u = max(g_max_u, c_max_u)

    payload["quantity"] = "sigmaNyNormalShear"
    payload["schemaVersion"] = "3.0"
    payload["allowable"] = round(allow_n, 2)
    payload["allowableShear"] = round(allow_t, 2)
    payload["shearFactor"] = SHEAR_ALLOW_FACTOR
    payload["globalMax"] = round(g_max_n, 2)
    payload["globalMaxShear"] = round(g_max_t, 2)
    payload["globalMaxUsage"] = round(g_max_u, 4)
    payload["ok"] = overall_ok and (g_max_u <= 1.0)
    return payload


def task_solve_mooring_fitting(
    job_id: str,
    bdf_path: str,
    model_json_path: str,
    result_json_path: str,
    exe_path: str,
    work_dir: str,
    employee_id: str,
    timestamp: str,
    source: str,
    yield_strength: float = 315.0,
    gamma_m: float = 1.0,
):
    """
    Studio 편집 모델의 구조해석: MooringFitting.exe solve-bdf <bdf> <model.json> -o <result.json>
                                  --yield <σy> --gamma <γM>.

    동작:
      - bdf_path = 편집 반영 solvable BDF (라우터가 사전 생성), model_json_path = 편집 모델 JSON.
      - exe 는 cwd=work_dir 로 실행되며 Nastran SOL 101 → F06 파싱 → von Mises σeff + Usage 판정 결과 JSON 생성.
      - yield_strength(σy)/gamma_m(γM) → Usage=σeff/(σy/γM) 평가. 기본 315 MPa(AH32) / 1.0(DNV).
      - result_json_path 가 생성되면 result_info.nastranResultJson 으로 노출 → 호스트가 /api/download 로 회수.
    """
    mark_running(job_id, "Mooring 구조해석 준비 중...", progress=10)

    status_msg = "Success"
    engine_output = ""
    result_data = {}

    try:
        if not os.path.exists(exe_path):
            raise FileNotFoundError(f"실행 파일을 찾을 수 없습니다: {exe_path}")
        if not os.path.isfile(bdf_path):
            raise FileNotFoundError(f"solve 대상 BDF 가 없습니다: {bdf_path}")

        update_progress(job_id, 30, "Nastran 구조해석 실행 중...")
        logger.info("[MooringSolve] exe=%s, bdf=%s, yield=%s, gamma=%s",
                    exe_path, bdf_path, yield_strength, gamma_m)

        returncode, stdout_b, stderr_b = _run_capture(
            [exe_path, "solve-bdf", bdf_path, model_json_path, "-o", result_json_path,
             "--yield", str(yield_strength), "--gamma", str(gamma_m)],
            cwd=work_dir,
            timeout=SOLVE_TIMEOUT_SECONDS,
        )
        engine_output = stdout_b.decode("utf-8", errors="replace")
        stderr_text = stderr_b.decode("utf-8", errors="replace")
        if stderr_text.strip():
            engine_output += f"\n[stderr] {stderr_text.strip()}"
        if returncode != 0:
            status_msg = "Failed"
            engine_output += f"\n[Exit code: {returncode}]"

        update_progress(job_id, 90, "결과 수집 중...")
        if os.path.isfile(result_json_path):
            summary = None
            try:
                with open(result_json_path, "r", encoding="utf-8") as fh:
                    payload = json.load(fh)
                # exe 의 von Mises 결과를 정응력 σNy/전단 분리 평가로 재계산 후 파일 재기록
                # (호스트 다운로드본·Studio 표시가 모두 σNy 기준이 되도록).
                try:
                    payload = recompute_sigma_ny(payload)
                    with open(result_json_path, "w", encoding="utf-8") as fh:
                        json.dump(payload, fh, ensure_ascii=False)
                except Exception as rexc:
                    logger.warning("[MooringSolve] σNy 재계산 실패(원본 유지): %s", rexc)
                summary = {
                    "quantity": payload.get("quantity"),
                    "unit": payload.get("unit"),
                    "globalMax": payload.get("globalMax"),
                    "globalMaxShear": payload.get("globalMaxShear"),
                    "globalMaxUsage": payload.get("globalMaxUsage"),
                    "yieldStress": payload.get("yieldStress"),
                    "gammaM": payload.get("gammaM"),
                    "allowable": payload.get("allowable"),
                    "allowableShear": payload.get("allowableShear"),
                    "ok": payload.get("ok"),
                    "caseCount": payload.get("caseCount"),
                }
            except Exception as exc:
                logger.warning("[MooringSolve] 결과 요약 파싱 실패: %s", exc)
            result_data = {"nastranResultJson": result_json_path, "summary": summary}
        else:
            status_msg = "Failed"
            engine_output += "\n[Error] 결과 JSON 이 생성되지 않았습니다 — Nastran FATAL 또는 solve-bdf 오류일 수 있습니다."

    except subprocess.TimeoutExpired:
        status_msg = "Failed"
        engine_output = f"Mooring 구조해석 시간이 초과되었습니다 ({SOLVE_TIMEOUT_SECONDS // 60}분)."
    except FileNotFoundError as e:
        status_msg = "Failed"
        logger.error("[MooringSolve] %s", str(e))
        engine_output = str(e)
    except Exception as e:
        status_msg = "Failed"
        logger.error("MooringSolve unexpected error: %s", str(e), exc_info=True)
        engine_output = f"예기치 않은 오류가 발생했습니다: {str(e)}"

    update_progress(job_id, 95, "데이터베이스 저장 중...")
    project_data, db_err = record_analysis(
        job_id=job_id,
        project_name=f"{PROGRAM_NAME}Solve_{timestamp}",
        program_name=f"{PROGRAM_NAME}Solve",
        employee_id=employee_id,
        status=status_msg,
        input_info={"bdf": bdf_path, "model_json": model_json_path,
                    "yieldStrength": yield_strength, "gammaM": gamma_m},
        result_info=result_data if result_data else None,
        source=source,
    )
    if db_err is not None:
        status_msg = "Failed"
        engine_output += f"\nDB Error: {db_err}"

    mark_complete(
        job_id, status_msg, engine_output, project_data,
        success_message="Mooring 구조해석 완료",
        failure_message="Mooring 구조해석 실패",
    )
