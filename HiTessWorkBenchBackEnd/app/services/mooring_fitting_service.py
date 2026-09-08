"""Mooring Fitting Assessment 서비스 — CSV 2종 → MooringFitting.exe build-full 실행 + 산출물 수집."""
import json
import logging
import os
import re
import subprocess

from .analysis_runner import (
    mark_complete,
    mark_running,
    record_analysis,
    update_progress,
)
from .mooring_diagnosis import diagnose

logger = logging.getLogger(__name__)

PROGRAM_NAME = "MooringFitting"
TIMEOUT_SECONDS = 600

# 구조해석(solve-bdf)은 SOL 101 + 다중 SUBCASE 라 build-full 보다 길 수 있어 별도 타임아웃.
SOLVE_TIMEOUT_SECONDS = 1800

# 보고서(report)는 그림 렌더 + xlsx 조립이라 build-full 보다 짧다(실측 ~5초).
# 그래도 첫 실행은 figures 를 전부 그리므로 여유를 둔다.
REPORT_TIMEOUT_SECONDS = 300

# 계류 의장품(MF) 하중 규정 안전계수. 엔진 BuildFullCommand.DefaultMfSafetyFactor 와 같은 값이며,
# 라우터가 값을 주지 않았을 때 1.0(미적용)으로 떨어지지 않게 하는 두 번째 방어선이다.
MF_SAFETY_FACTOR_CODE = 1.25

REPORT_FILE_NAME = "MooringFitting_Report.xlsx"
REPORT_PLAN_FILE_NAME = "REPORT_PLAN.json"


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


def _decode_engine_output(raw: bytes) -> str:
    """
    MooringFitting.exe 의 stdout/stderr 를 문자열로 디코딩한다.

    왜 폴백이 필요한가 — Windows 콘솔 기본 출력 인코딩은 OEM 코드페이지(한국어 환경 CP949)다.
    엔진은 2026-09-01 부터 Console.OutputEncoding 을 UTF-8 로 고정하지만,
    InHouseProgram 의 exe 는 git 미추적이라 서버 교체가 수동이므로 한동안 구 버전(CP949)이
    함께 돌아간다. UTF-8 로만 디코딩하면 그 기간 동안 한글 경고문이 전부 깨져 보인다(실측).
    엄격 디코딩을 순서대로 시도해 성공하는 인코딩을 쓴다.
    """
    if not raw:
        return ""
    for enc in ("utf-8", "cp949"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    # 둘 다 실패하면 손실을 감수하고 복원 (로그가 통째로 사라지는 것보다 낫다)
    return raw.decode("utf-8", errors="replace")

def collect_artifacts(out_dir: str, work_dir: str) -> dict:
    """
    MooringFitting.exe 가 생성한 out/ 폴더 산출물을 분류·수집한다.

    핵심 7개(페이지 기본 노출):
        final_bdf, validation_json, lineage_json, report_mf_csv, report_winch_csv,
        transform_summary_json, parse_skips_csv

    transform_summary_json / parse_skips_csv 를 추가한 이유:
        validation.json 은 07단계 검사 5건(연결성/길이0/SPC존재/하중존재/roller각도)만 담아
        "입력이 얼마나 누락됐는가", "자동 정리가 원 도면을 얼마나 바꿨는가" 를 보여주지 못한다.
        이 둘이 없으면 사용자는 부재가 자동 제거되거나 MF 행이 통째로 빠진 사실을 알 수 없다.
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
        # 원 도면 대비 위상 변형 총량 + 입력 실질 누락 건수 (엔진이 생성)
        "transform_summary_json": _pick("MODEL_TRANSFORM_SUMMARY.json"),
        # 파싱에서 제외된 CSV 행의 사유·행번호·원문
        "parse_skips_csv":        _pick("CSV_Parse_Skips.csv"),
        # 부재 출신 조인 원본(진단 근거) / 해당 근거로 산출한 진단 문장
        "model_evidence_json":  _pick("MODEL_EVIDENCE.json"),
        "diagnosis_json":       _pick("DIAGNOSIS.json"),
        # phase 별 구조적 로그 (진단 원문)
        "engine_log_file":        _pick("engine.log"),
        "stage_jsons":          stage_jsons,
        "stage_bdfs":           stage_bdfs,
        "stage_verifications":  stage_verifications,
        "raw_json":             _pick("STAGE_00.raw.json"),
        "initial_json":         _pick("STAGE_00.initial.json"),
    }


def write_diagnosis_file(out_dir: str, result_json_path: str | None) -> str | None:
    """
    out/MODEL_EVIDENCE.json (+ 결과 JSON + EQUILIBRIUM.json) 으로 진단해 out/DIAGNOSIS.json 을 쓴다.

    - MODEL_EVIDENCE.json 이 없으면(엔진이 아직 진단 근거를 내지 않는 구버전 등) 즉시 None —
      아무것도 쓰지 않는다.
    - result_json_path 가 없거나 파일이 없으면 result=None 으로 진행한다(해석 전 진단 — 케이스
      단위 규칙만 평가되고 elementFindings 는 빈 리스트가 된다).
    - 같은 폴더의 EQUILIBRIUM.json 이 있으면 읽어서 함께 넘긴다.
    - 진단 실패가 해석·보고서 생성을 막아서는 안 되므로 예외는 잡아 로그만 남기고 None 을 돌려준다.
    """
    evidence_path = os.path.join(out_dir, "MODEL_EVIDENCE.json")
    if not os.path.isfile(evidence_path):
        return None

    try:
        with open(evidence_path, "r", encoding="utf-8") as fh:
            evidence = json.load(fh)

        result = None
        if result_json_path and os.path.isfile(result_json_path):
            with open(result_json_path, "r", encoding="utf-8") as fh:
                result = json.load(fh)

        equilibrium = None
        equilibrium_path = os.path.join(out_dir, "EQUILIBRIUM.json")
        if os.path.isfile(equilibrium_path):
            with open(equilibrium_path, "r", encoding="utf-8") as fh:
                equilibrium = json.load(fh)

        report = diagnose(evidence, result, equilibrium, None)

        diagnosis_path = os.path.join(out_dir, "DIAGNOSIS.json")
        with open(diagnosis_path, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=2)
        return diagnosis_path
    except Exception:  # noqa: BLE001 — 진단 실패가 해석/보고서 흐름을 막지 않게 흡수
        logger.warning("[MooringFitting] DIAGNOSIS.json 생성 실패(무시하고 계속 진행)", exc_info=True)
        return None


def task_execute_mooring_fitting(
    job_id: str,
    structure_path: str,
    load_path: str,
    work_dir: str,
    exe_path: str,
    employee_id: str,
    timestamp: str,
    source: str,
    mf_safety_factor: float = MF_SAFETY_FACTOR_CODE,
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
        engine_output = _decode_engine_output(stdout_b)
        stderr_text = _decode_engine_output(stderr_b)
        if stderr_text.strip():
            engine_output += f"\n[stderr] {stderr_text.strip()}"
        if returncode != 0:
            status_msg = "Failed"
            engine_output += f"\n[Exit code: {returncode}]"

        update_progress(job_id, 80, "결과 파일 수집 중...")
        out_dir = os.path.join(work_dir, "out")

        # 해석 전 진단 — Studio 는 build-full 직후에 열리므로, 여기서 만들어 두지 않으면
        # 입력 누락·하중 0건 같은 케이스 진단이 화면에 못 간다(결과 진단은 solve 후 갱신).
        write_diagnosis_file(out_dir, None)

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
    exe 가 von Mises 기준으로 내보낸 결과 JSON 을 '정응력 / 전단 분리' 평가로 재계산한다.

    DNV 3D Beam(Nauticus Hull)의 절차를 그대로 옮긴 것이다. exe 수정 없이 이미 출력된
    성분(nx/my/mz = σNx/σMy/σMz, qy/qz/mx = τQy/τQz/τMx)으로 재계산한다:
      - 정응력 σN = |σNx + σMz|  (축력 + 강축=연직면 굽힘, 부호 유지)  ≤ 허용(σy/γM)
      - 전단  τ  = max(|τQy|, |τQz|, |τMx|)                          ≤ 0.6·허용
      - Usage = max(σN/허용, τ/전단허용),  OK if ≤ 1

    ★ 축 이름 주의 — DNV 와 NASTRAN 의 국부축 규약이 정반대다.
        DNV 3D Beam : local z = up = 웹 방향  →  My 가 강축, 판정값이 Sig-Ny = Nx + My
        NASTRAN     : local y = up = 웹 방향  →  Mz 가 강축
      따라서 DNV 매뉴얼의 Sig-Ny 를 NASTRAN 성분으로 옮기면 |σNx + σMz| 다.
      (근거: 3D Beam User Manual p.16/17/83/99, NASTRAN 쪽은 AxisTest.bdf/f06 실측)

    약축 조합응력(σNx + σMy)은 화면·보고서 표에 그대로 표시하되 합/불에는 쓰지 않는다 —
    실제 구조는 상판 판구조이고 면내 수평력은 판이 막응력으로 받으므로, 1D 보로 이상화하며
    생긴 약축 굽힘은 실제 파괴 모드가 아니다. 보고서(ReportStressEvaluator)와 같은 기준이라
    두 값이 일치해야 한다.

    exe 가 sigmaNStrong 을 실어 보내면 그 값을 그대로 쓴다(exe 가 최악 station 을 고른다).
    구버전 결과 JSON 에는 그 필드가 없으므로 성분에서 |σNx + σMz| 로 되계산한다.
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

    def _signed(v):
        try:
            return float(v or 0)
        except (TypeError, ValueError):
            return 0.0

    g_max_n = g_max_t = g_max_u = 0.0
    overall_ok = True
    for case in payload.get("cases", []):
        c_max_n = c_max_t = c_max_u = 0.0
        for e in case.get("elements", []):
            mx, qy, qz = _abs(e.get("mx")), _abs(e.get("qy")), _abs(e.get("qz"))
            # 판정 정응력 = 축력 + 강축(연직면) 굽힘 = |σNx + σMz|.
            # NASTRAN 국부축에서 Mz 가 강축이다(AxisTest 실측). DNV 3D Beam 의 Sig-Ny 와
            # 같은 값 — 두 문서의 y/z 규약이 반대라 이름만 다르다.
            # exe 가 실어 보낸 값을 우선 쓰고, 구버전 결과는 성분에서 되계산한다.
            if e.get("sigmaNStrong") is not None:
                sigma_n = _abs(e.get("sigmaNStrong"))
            else:
                sigma_n = abs(_signed(e.get("nx")) + _signed(e.get("mz")))
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

    payload["quantity"] = "sigmaNStrongNormalShear"
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
        engine_output = _decode_engine_output(stdout_b)
        stderr_text = _decode_engine_output(stderr_b)
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
            diagnosis_path = write_diagnosis_file(work_dir, result_json_path)
            result_data = {"nastranResultJson": result_json_path, "summary": summary}
            if diagnosis_path:
                result_data["diagnosisJson"] = diagnosis_path
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


# ==================== 보고서(report / report-plan) ====================

class ReportEngineError(RuntimeError):
    """report 계열 verb 가 비정상 종료했을 때. exit code 를 보존해 라우터가 상태코드를 고른다.

    엔진 규약: 2 = 선행 조건 미충족(예: 응력 결과 CSV 없음), 그 외 = 실제 실패.
    """

    def __init__(self, message: str, returncode: int):
        super().__init__(message)
        self.returncode = returncode


def _report_common_args(case_dir: str, exe_path: str, verb: str,
                        top: int, yield_strength: float, gamma_m: float) -> list[str]:
    """report / report-plan 이 공유하는 앞부분 인자."""
    if not os.path.isfile(exe_path):
        raise FileNotFoundError(f"실행 파일을 찾을 수 없습니다: {exe_path}")
    if not os.path.isdir(case_dir):
        raise FileNotFoundError(f"케이스 폴더가 없습니다: {case_dir}")
    # --gamma 는 Studio 화면 판정과 같은 허용응력(σy/γM)을 보고서에도 강제하기 위한 것.
    return [exe_path, verb, case_dir,
            f"--top={top}", f"--yield={yield_strength}", f"--gamma={gamma_m}"]


def _run_report_verb(cmd: list[str], case_dir: str, verb: str) -> str:
    """report 계열 verb 를 실행하고 stdout+stderr 를 합친 로그를 돌려준다."""
    returncode, stdout_b, stderr_b = _run_capture(
        cmd, cwd=case_dir, timeout=REPORT_TIMEOUT_SECONDS,
    )
    log = _decode_engine_output(stdout_b)
    stderr_text = _decode_engine_output(stderr_b)
    if stderr_text.strip():
        log += f"\n[stderr] {stderr_text.strip()}"
    if returncode != 0:
        raise ReportEngineError(f"{verb} 실패 (exit {returncode})\n{log.strip()}", returncode)
    return log


def build_report(
    case_dir: str,
    exe_path: str,
    *,
    figures_dir: str | None = None,
    top: int = 20,
    yield_strength: float = 315.0,
    gamma_m: float = 1.0,
    hull_no: str = "",
    dwg_no: str = "",
    report_date: str = "",
    title: str = "",
    fitting: str = "",
) -> dict:
    """
    MooringFitting.exe report <case-folder> ... 로 강도검토 보고서 xlsx 를 만든다.

    case_dir 은 out/ 의 '부모'다 — 엔진의 report verb 는 케이스 폴더를 받고
    스스로 out/ 안을 읽는다. 라우터가 out_dir 을 받으면 부모로 올려서 넘겨야 한다.

    표제 항목(hull/dwg/date/title/fitting)은 값이 비면 인자를 아예 넘기지 않는다.
    빈 문자열을 넘기면 엔진의 기본값(예: 오늘 날짜, 기본 제목)을 덮어써 버리기 때문이다.

    figures_dir 이 있으면 --figures 로 넘어가 Studio 캡쳐가 엔진 렌더보다 우선한다.

    실패(비정상 종료 또는 xlsx 미생성)는 엔진 로그를 담은 RuntimeError 로 올린다.
    """
    cmd = _report_common_args(case_dir, exe_path, "report", top, yield_strength, gamma_m)

    out_path = os.path.join(case_dir, "out", REPORT_FILE_NAME)
    cmd += ["-o", out_path]

    if figures_dir and os.path.isdir(figures_dir):
        cmd.append(f"--figures={figures_dir}")

    for flag, value in (("hull", hull_no), ("dwg", dwg_no), ("date", report_date),
                        ("title", title), ("fitting", fitting)):
        if value and value.strip():
            cmd.append(f"--{flag}={value.strip()}")

    log = _run_report_verb(cmd, case_dir, "report")

    if not os.path.isfile(out_path):
        raise RuntimeError(f"보고서 파일이 생성되지 않았습니다: {out_path}\n{log.strip()}")

    return {
        "xlsx_path": out_path,
        "log": log,
        "pages": _parse_report_pages(log),
        "warnings": _parse_report_warnings(log),
    }


def build_report_plan(
    case_dir: str,
    exe_path: str,
    *,
    top: int = 20,
    yield_strength: float = 315.0,
    gamma_m: float = 1.0,
) -> dict:
    """
    MooringFitting.exe report-plan 으로 out/REPORT_PLAN.json 을 만든다.

    Studio 가 이 파일을 읽어 '어느 부재에 라벨을 달고 무엇을 캡쳐할지' 정한다.
    보고서 그림을 Studio 캡쳐로 채우려면 report 보다 먼저 호출해야 한다.
    """
    cmd = _report_common_args(case_dir, exe_path, "report-plan", top, yield_strength, gamma_m)
    log = _run_report_verb(cmd, case_dir, "report-plan")

    plan_path = os.path.join(case_dir, "out", REPORT_PLAN_FILE_NAME)
    if not os.path.isfile(plan_path):
        raise RuntimeError(f"보고서 계획 파일이 생성되지 않았습니다: {plan_path}\n{log.strip()}")

    return {"plan_path": plan_path, "log": log}


def _parse_report_pages(log: str) -> int | None:
    """'[report] <path>  (33 pages)' 에서 페이지 수만 뽑는다. 못 찾으면 None."""
    m = re.search(r"\((\d+)\s+pages?\)", log)
    return int(m.group(1)) if m else None


def _parse_report_warnings(log: str) -> list[str]:
    """엔진이 '   [Warning] ...' 로 내보낸 줄만 모은다(결과 최신성 경고 등)."""
    return [
        line.split("[Warning]", 1)[1].strip()
        for line in log.splitlines()
        if "[Warning]" in line
    ]
