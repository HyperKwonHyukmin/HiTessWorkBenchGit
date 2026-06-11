"""Carling Free 리포트 생성 — Excel COM filler subprocess 브리지.

DRM 암호화된 .xlsm 템플릿은 Excel.exe(인가 프로세스)로만 열린다.
Excel COM 은 장수명 FastAPI 워커에서 직접 돌리지 않고 report_filler.py 를
단기 subprocess 로 격리 실행한다(코드베이스의 EXE 호출 관례와 동일, timeout-kill 가능).

출력은 .xlsx 로 저장한다(.xlsm 으로 저장하면 HHI DRM 이 자동 재암호화하여 사용자가
열 수 없는 DRM 블롭이 된다 — report_filler.py 참고). 생성된 .xlsx 는 userConnection
작업폴더에 저장되고, 평문 bytes 로 읽혀 라우터가 반환한다.
"""
import json
import logging
import os
import subprocess
import sys
import threading
from datetime import datetime

from fastapi import HTTPException

logger = logging.getLogger(__name__)

_SERVICES_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_SERVICES_DIR)
_BACKEND_DIR = os.path.dirname(_APP_DIR)
_USER_CONNECTION_DIR = os.path.join(_BACKEND_DIR, "userConnection")
_REPORT_DIR = os.path.join(_BACKEND_DIR, "InHouseProgram", "CarlingCalculator", "Report")
_FILLER = os.path.join(_REPORT_DIR, "report_filler.py")

# mode → load_type → 템플릿 파일명
_TEMPLATES = {
    "free": {
        "concentrated": "Carling Free Calculator Report_Concentrated.xlsm",
        "distributed": "Carling Free Calculator Report_Distributed.xlsm",
    },
    "optimization": {
        "concentrated": "Carling Design Optimization_Concentrated.xlsm",
        "distributed": "Carling Design Optimization_Distributed.xlsm",
    },
}

# mode → 작업폴더/파일명에 쓸 라벨
_MODE_LABEL = {"free": "Free", "optimization": "Optimization"}

# Excel COM 인스턴스 난립 방지 — 리포트 생성을 직렬화한다.
_EXCEL_LOCK = threading.Lock()


def _is_within_userconnection(path: str) -> bool:
    """path 가 userConnection/ 디렉터리 하위인지 검증(경로 탈출 차단)."""
    try:
        base = os.path.abspath(_USER_CONNECTION_DIR)
        cand = os.path.abspath(path)
        return os.path.commonpath([base, cand]) == base
    except (ValueError, TypeError):
        return False


def generate_report(result: dict, employee_id: str) -> tuple[str, bytes]:
    """solver 전체 결과(dict)로 Carling 리포트 .xlsx 를 생성한다(free/optimization 공통).

    Args:
        result: solver 출력 전체. mode 키로 free/optimization 분기.
        employee_id: 요청 사번 (작업폴더 이름용).

    Returns:
        (파일명, 파일 bytes).

    Raises:
        HTTPException: 템플릿 부재·Excel/DRM 사용 불가·타임아웃 등.
    """
    mode = (result.get("mode") or "free").lower()
    templates = _TEMPLATES.get(mode) or _TEMPLATES["free"]
    mode_label = _MODE_LABEL.get(mode, "Free")

    inputs = result.get("inputs") or {}
    load_type = (inputs.get("load", {}).get("type") or "concentrated").lower()
    if load_type not in templates:
        load_type = "concentrated"
    template_path = os.path.join(_REPORT_DIR, templates[load_type])

    if not os.path.exists(template_path):
        logger.error("Carling report template not found: %s", template_path)
        raise HTTPException(status_code=503, detail="리포트 템플릿을 찾을 수 없습니다.")
    if not os.path.exists(_FILLER):
        logger.error("report_filler.py not found: %s", _FILLER)
        raise HTTPException(status_code=503, detail="리포트 생성 스크립트를 찾을 수 없습니다.")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # 계산 시 생성된 작업폴더(run_carling 이 동봉) 하위에 Report/ 를 만든다.
    # 폴더 정보가 없거나(구버전 result) 유효하지 않으면 별도 폴더로 폴백.
    calc_dir = result.get("_work_dir")
    if isinstance(calc_dir, str) and _is_within_userconnection(calc_dir) and os.path.isdir(calc_dir):
        report_dir = os.path.join(os.path.abspath(calc_dir), "Report")
    else:
        safe_id = (employee_id or "unknown").replace(os.sep, "_")
        report_dir = os.path.join(
            _USER_CONNECTION_DIR, f"{timestamp}_{safe_id}_Carling{mode_label}Report"
        )
    report_dir = os.path.abspath(report_dir)
    os.makedirs(report_dir, exist_ok=True)

    input_json = os.path.join(report_dir, "report_input.json")
    output_name = f"Carling_{mode_label}_Report_{load_type}_{timestamp}.xlsx"
    output_path = os.path.join(report_dir, output_name)

    # filler 입력에는 내부 키(_work_dir)를 제외한 순수 결과만 기록
    filler_payload = {k: v for k, v in result.items() if not k.startswith("_")}
    with open(input_json, "w", encoding="utf-8") as f:
        json.dump(filler_payload, f, ensure_ascii=False, indent=2)

    cmd = [sys.executable, _FILLER, input_json, template_path, output_path]
    logger.info("Running Carling report filler: %s", " ".join(cmd))

    with _EXCEL_LOCK:
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=120,
                cwd=_REPORT_DIR,
            )
        except subprocess.TimeoutExpired as exc:
            logger.error("Carling report filler timed out")
            raise HTTPException(status_code=500, detail="리포트 생성 시간이 초과되었습니다.") from exc

    # report_filler 는 평문 bytes 를 <output>.bin 으로 흘려준다(HHI DRM 회피).
    # 디스크의 .xlsx 자체는 프로세스 종료 후 DRM 이 암호화하므로 백엔드가 직접 읽으면 안 된다.
    clean_path = output_path + ".bin"
    if proc.returncode != 0 or not os.path.exists(clean_path):
        logger.error(
            "filler failed rc=%s stderr=%s stdout=%s",
            proc.returncode, proc.stderr, proc.stdout,
        )
        raise HTTPException(
            status_code=503,
            detail="리포트 생성 환경(Excel/DRM)을 사용할 수 없습니다. 서버 관리자에게 문의하세요.",
        )

    with open(clean_path, "rb") as f:
        data = f.read()

    # 잔여물 정리: 평문 .bin 과 DRM 암호화된 .xlsx 를 모두 제거(디스크 평문 문서 최소화).
    for leftover in (clean_path, output_path):
        try:
            if os.path.exists(leftover):
                os.remove(leftover)
        except OSError:
            pass

    return output_name, data


# 하위 호환 alias (기존 free 엔드포인트용)
generate_free_report = generate_report
