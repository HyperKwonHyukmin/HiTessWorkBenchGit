"""이중관 Inner Support -> 내관 자동 생성 CSV 서비스."""
import contextlib
import importlib.util
import io
import json
import logging
import os
from datetime import datetime

from fastapi import HTTPException

logger = logging.getLogger(__name__)

# 모든 경로는 이 파일(__file__) 기준 상대로 유도한다 — dev(내 PC)와 운영 서버(145)에서
# 폴더 구조가 동일(HiTessWorkBenchBackEnd/InHouseProgram/DoublePipe/)하므로 그대로 동작한다.
_SERVICES_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_SERVICES_DIR)
_BACKEND_DIR = os.path.dirname(_APP_DIR)
_DOUBLEPIPE_DIR = os.path.join(_BACKEND_DIR, "InHouseProgram", "DoublePipe")
_TRANSFORM_MODULE_PATH = os.path.join(_DOUBLEPIPE_DIR, "Converting CSV", "inner_pipe_transform.py")
_USER_CONNECTION_DIR = os.path.join(_BACKEND_DIR, "userConnection")

# userConnection 폴더 명명에 쓰는 프로그램 이름 (다른 앱과 동일 규칙: {timestamp}_{employee_id}_{ProgramName}).
_PROGRAM_NAME = "DoublePipeFuelLine"

_transform_module = None


def _load_transform_module():
    global _transform_module
    if _transform_module is not None:
        return _transform_module
    if not os.path.exists(_TRANSFORM_MODULE_PATH):
        raise HTTPException(status_code=503, detail="이중관 변환 모듈을 찾을 수 없습니다. 서버 관리자에게 문의하세요.")
    spec = importlib.util.spec_from_file_location("inner_pipe_transform", _TRANSFORM_MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _transform_module = module
    return module


def run_inner_pipe_preview(config: dict, csv_bytes: bytes, csv_name: str, employee_id: str) -> dict:
    """
    사용자가 업로드한 외관 배관 CSV(csv_bytes)를 입력으로, Design Inner Support(Tab1)
    입력값(config)에 따라 append_offset.py 변환 로직(내관 Y-15000mm 오프셋 생성 +
    규격 스냅 + ELBO bendR 반영 + UBOLT 자동 배치 + 연결성 검사)을 실행한다.

    다른 앱과 동일하게 userConnection/{timestamp}_{employee_id}_DoublePipeFuelLine/ 작업 폴더를
    만들어 입력 CSV·설정 JSON·결과 CSV 를 저장하고, 이후 단계(Tab2/Tab3)가 이 폴더를 기준으로
    이어갈 수 있도록 폴더/결과 경로를 함께 반환한다.
    """
    module = _load_transform_module()

    # ── 작업 폴더 생성 (다른 앱과 동일 명명 규칙) ──
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    folder_name = f"{timestamp}_{employee_id}_{_PROGRAM_NAME}"
    work_dir = os.path.abspath(os.path.join(_USER_CONNECTION_DIR, folder_name))
    os.makedirs(work_dir, exist_ok=True)

    # ── 입력 CSV 저장 ──
    safe_name = os.path.basename(csv_name) or "outer_input.csv"
    if not safe_name.lower().endswith('.csv'):
        safe_name += '.csv'
    input_csv_path = os.path.join(work_dir, safe_name)
    with open(input_csv_path, "wb") as f:
        f.write(csv_bytes)

    # ── 설정 JSON 저장 (inner_pipe_config.json 스키마) ──
    with open(os.path.join(work_dir, "inner_pipe_config.json"), "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    # ── 결과 CSV 경로 (append_offset.py 출력 명명 규칙: <stem>_Y-15000.csv) ──
    stem, ext = os.path.splitext(safe_name)
    result_name = f"{stem}_Y-15000{ext or '.csv'}"
    result_csv_path = os.path.join(work_dir, result_name)

    log_buffer = io.StringIO()
    try:
        with contextlib.redirect_stdout(log_buffer):
            result_df = module.run_transform(input_csv_path, config, output_csv_path=result_csv_path)
    except Exception:
        logger.exception("이중관 변환 실패 (employee_id=%s, csv=%s)", employee_id, safe_name)
        raise HTTPException(status_code=500, detail="이중관 변환 중 오류가 발생했습니다. CSV 형식과 입력값을 확인하세요.")

    result_df = result_df.fillna('')
    logs = [line for line in log_buffer.getvalue().splitlines() if line.strip()]

    return {
        "columns": list(result_df.columns),
        "rows": result_df.to_dict('records'),
        "rowCount": len(result_df),
        "logs": logs,
        "sourceCsv": safe_name,
        "resultCsv": result_name,
        "workDir": folder_name,          # userConnection 기준 상대 폴더명 (이후 단계 진행 기준)
        "resultPath": result_csv_path,   # 서버 절대 경로 (Tab2 백엔드/다운로드 연동용)
    }
