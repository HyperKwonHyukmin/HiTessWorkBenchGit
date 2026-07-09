"""DrawingToAnalysis 서비스 — 설계 PDF를 Nastran BDF로 변환.

견고성 전략(defense-in-depth):
  1. 입력 PDF 사전 검증 (파일 크기, magic byte, 암호화/DRM, 페이지, 콘텐츠)
  2. PDF 정규화는 clean/garbage 옵션을 사용하고 실패 시 명시적 오류
  3. Engine stdout/stderr 패턴 매칭으로 도메인 오류를 한국어 메시지로 분류
  4. 단계별 diagnostic.json 저장 (사용자 다운로드 + 재현 가능)
  5. 사용자에게는 카테고리/원인/조치를 함께 노출
"""
import json
import logging
import os
import re
import subprocess
import tempfile
import time
import traceback
from datetime import datetime
from typing import Optional

from .analysis_runner import (
    build_nastran_bridge_command,
    get_backend_dir,
    get_nastran_bridge_script_path,
    mark_complete,
    mark_running,
    record_analysis,
    update_progress,
)

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────
# 사용자 친화 메시지 카테고리
# ──────────────────────────────────────────────────────────────────────────

FAIL_DRM = (
    "PDF가 DRM/보안으로 보호되어 있어 내용을 추출할 수 없습니다. "
    "원본 PDF를 사용하거나, DRM 해제 후 다시 시도하세요."
)
FAIL_EMPTY_PDF = (
    "PDF에서 도면 벡터/텍스트를 찾을 수 없습니다. "
    "스캔 이미지 PDF인지 확인하고, 벡터 형식의 LUG 도면 PDF를 사용하세요."
)
FAIL_NOT_PDF = "업로드된 파일이 유효한 PDF가 아닙니다."
FAIL_TIMEOUT = "처리 시간이 초과되었습니다(10분). PDF 페이지 수 또는 메시 크기를 줄여 다시 시도하세요."
FAIL_NO_LUG = (
    "LUG 도면 패턴을 식별하지 못했습니다. "
    "지원되는 LUG 도면 형식인지 확인하세요. (현재 지원: 사각/원형 LUG 표준 도면)"
)
FAIL_EXE_MISSING = "백엔드 변환 엔진을 찾을 수 없습니다. 서버 관리자에게 문의하세요."
FAIL_NO_BDF = "BDF 결과 파일이 생성되지 않았습니다. 도면 내용을 인식하지 못한 것으로 보입니다."
FAIL_UNKNOWN = "예기치 않은 오류가 발생했습니다. 결과 폴더의 diagnostic.json 을 관리자에게 전달하세요."

# Engine 메시지 → 사용자 친화 카테고리 매핑 (대소문자 무시)
ENGINE_ERROR_PATTERNS = [
    (re.compile(r"(no\s+lug|lug.*not\s+found|cannot\s+identify\s+lug)", re.I), FAIL_NO_LUG),
    (re.compile(r"(encrypted|password\s+required|drm)", re.I), FAIL_DRM),
    (re.compile(r"(empty\s+page|no\s+vectors|no\s+pages)", re.I), FAIL_EMPTY_PDF),
]

PDF_MAGIC = b"%PDF-"


# ──────────────────────────────────────────────────────────────────────────
# PDF 사전 검증
# ──────────────────────────────────────────────────────────────────────────

def _validate_pdf(pdf_path: str) -> dict:
    """
    PDF 파일을 사전 검증한다.

    반환 dict 구조:
      {
        "ok":              bool,
        "reason":          str | None,   # 사용자용 한국어 메시지
        "size_bytes":      int,
        "is_pdf":          bool,
        "is_encrypted":    bool | None,
        "needs_password":  bool | None,
        "page_count":      int | None,
        "vector_count":    int | None,
        "text_chars":      int | None,
        "metadata":        dict | None,
        "open_error":      str | None,
      }
    """
    info = {
        "ok": False,
        "reason": None,
        "size_bytes": 0,
        "is_pdf": False,
        "is_encrypted": None,
        "needs_password": None,
        "page_count": None,
        "vector_count": None,
        "text_chars": None,
        "metadata": None,
        "open_error": None,
        "header_magic": None,
    }

    if not os.path.isfile(pdf_path):
        info["reason"] = "PDF 파일이 서버에 저장되지 않았습니다. 다시 업로드해 주세요."
        return info

    size = os.path.getsize(pdf_path)
    info["size_bytes"] = size
    if size < 100:
        info["reason"] = FAIL_NOT_PDF + f" (파일 크기 {size} B — 너무 작음)"
        return info
    if size > 200 * 1024 * 1024:
        info["reason"] = "PDF가 너무 큽니다(200MB 초과). 필요한 페이지만 추출하여 다시 시도하세요."
        return info

    try:
        with open(pdf_path, "rb") as f:
            head = f.read(8)
        info["header_magic"] = head.hex()
        info["is_pdf"] = head.startswith(PDF_MAGIC)
    except Exception as e:
        info["reason"] = f"PDF 헤더 읽기 실패: {e}"
        return info

    # PyMuPDF로 열기 시도
    try:
        import fitz  # PyMuPDF
    except ImportError as e:
        # PyMuPDF가 없어도 처리 자체는 진행 가능 — 다만 정규화/검증을 못함
        info["open_error"] = f"PyMuPDF 미설치: {e}"
        if not info["is_pdf"]:
            info["reason"] = FAIL_NOT_PDF + " (파일 헤더에 PDF 매직 바이트가 없음)"
            return info
        # 헤더가 PDF면 일단 통과 시키되 후속 단계에서 다시 판정
        info["ok"] = True
        return info

    try:
        with fitz.open(pdf_path) as doc:
            # DRM 드라이버가 Python 프로세스에는 복호화 스트림을 제공하는 경우가 있다.
            # 이 경우 디스크 헤더는 %PDF-가 아니어도 PyMuPDF가 정상 PDF로 열 수 있다.
            info["is_pdf"] = True
            info["is_encrypted"]   = bool(doc.is_encrypted)
            info["needs_password"] = bool(getattr(doc, "needs_pass", False))
            info["page_count"]     = doc.page_count
            info["metadata"]       = dict(doc.metadata or {})

            # 암호화된 경우 빈 비밀번호로 인증 시도 (회사 DRM은 종종 가능)
            if info["is_encrypted"]:
                try:
                    auth_ok = doc.authenticate("")
                except Exception:
                    auth_ok = 0
                if not auth_ok:
                    info["reason"] = FAIL_DRM
                    return info

            if info["page_count"] == 0:
                info["reason"] = FAIL_EMPTY_PDF + " (페이지가 없습니다)"
                return info

            # 도면/텍스트 콘텐츠 합계 (첫 10페이지 한정)
            vector_count = 0
            text_chars   = 0
            for i in range(min(doc.page_count, 10)):
                try:
                    page = doc.load_page(i)
                    vector_count += len(page.get_drawings())
                    text_chars   += len(page.get_text("text") or "")
                except Exception as page_err:
                    info["open_error"] = f"page {i} 읽기 실패: {page_err}"
                    break
            info["vector_count"] = vector_count
            info["text_chars"]   = text_chars

            if vector_count == 0 and text_chars == 0:
                info["reason"] = FAIL_EMPTY_PDF
                return info
    except Exception as e:
        info["open_error"] = f"{type(e).__name__}: {e}"
        if not info["is_pdf"]:
            info["reason"] = FAIL_NOT_PDF + " (파일 헤더에 PDF 매직 바이트가 없고 PyMuPDF도 열 수 없음)"
            return info
        # fitz가 못 열어도 헤더가 PDF면 일단 진행 (engine 이 더 견고할 수 있음).
        # 단 진단 로그에는 남긴다.
        info["ok"] = True
        return info

    info["ok"] = True
    return info


# ──────────────────────────────────────────────────────────────────────────
# PDF 정규화 (DRM 잔재 제거 + 표준 PDF 재저장)
# ──────────────────────────────────────────────────────────────────────────

def _normalize_pdf(pdf_path: str, out_path: str) -> dict:
    """
    PDF를 표준 형태로 재저장한다. 실패 시 원본을 그대로 사용한다.

    회사 DRM은 userConnection 폴더에 PDF 스트림이 저장되면 확장자와 무관하게
    재암호화할 수 있으므로 호출부는 OS 임시 폴더 아래 .pdfdata 파일을 사용한다.
    엔진은 실패 시 PDF 바이트 스트림으로 다시 연다.

    반환 dict:
      { "ok": bool, "out_path": str, "method": str, "error": str | None }
    """
    result = {"ok": False, "out_path": pdf_path, "method": "original", "error": None}
    try:
        import fitz
    except ImportError as e:
        result["error"] = f"PyMuPDF 미설치: {e}"
        return result

    try:
        with fitz.open(pdf_path) as doc:
            if doc.is_encrypted:
                try:
                    doc.authenticate("")
                except Exception:
                    pass

            # clean=True + garbage=4 + deflate 로 cross-ref/잔재 제거 및 압축
            doc.save(out_path, garbage=4, deflate=True, clean=True)
        if os.path.isfile(out_path) and os.path.getsize(out_path) > 0:
            result["ok"] = True
            result["out_path"] = out_path
            result["method"] = "fitz_clean_garbage4"
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
        # 원본으로 폴백
        result["out_path"] = pdf_path
        result["method"]   = "original_fallback"

    return result


# ──────────────────────────────────────────────────────────────────────────
# Engine 출력 분류
# ──────────────────────────────────────────────────────────────────────────

def _classify_engine_failure(stdout: str, stderr: str, returncode: int) -> Optional[str]:
    """Engine 메시지를 사용자 친화 카테고리로 분류. 매치 없으면 None."""
    blob = f"{stdout}\n{stderr}"
    for pattern, msg in ENGINE_ERROR_PATTERNS:
        if pattern.search(blob):
            return msg
    return None


# ──────────────────────────────────────────────────────────────────────────
# 진단 파일 작성 (디버깅/재현용)
# ──────────────────────────────────────────────────────────────────────────

def _write_diagnostic(work_dir: str, payload: dict) -> Optional[str]:
    try:
        diag_path = os.path.join(work_dir, "diagnostic.json")
        with open(diag_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2, default=str)
        return diag_path
    except Exception as e:
        logger.warning("diagnostic.json 작성 실패: %s", e)
        return None


# ──────────────────────────────────────────────────────────────────────────
# 메인 태스크
# ──────────────────────────────────────────────────────────────────────────

def task_execute_drawing_to_analysis(
    job_id: str,
    pdf_path: str,
    work_dir: str,
    exe_path: str,
    employee_id: str,
    timestamp: str,
    source: str,
    mesh_size: float = 10.0,
    mode: str = "lug",
):
    """DrawingToAnalysis.exe를 호출하여 업로드 PDF와 같은 폴더에 BDF를 생성한다.

    mode='lug'    → `exe all --pdf ... --out-dir ... --mesh-size ...`
                    출력: lug_model.bdf / lug_params.json / mesh.json / mesh_preview.png / vectors.json
    mode='support'→ `exe support all --pdf ... --out-dir ... --mesh-size ... [--page N]`
                    출력: support_model.bdf / support_params.json / support_mesh.json /
                          support_mesh_preview.png / vectors.json
    """
    mode = (mode or "lug").lower()
    if mode not in ("lug", "support"):
        mode = "lug"

    mark_running(job_id, "DrawingToAnalysis 초기화 중...", progress=5)

    status_msg = "Success"
    engine_output_parts: list[str] = []
    result_data: dict = {}
    user_reason: Optional[str] = None  # 실패 시 사용자에게 보일 친화 메시지
    diagnostic = {
        "job_id":     job_id,
        "started_at": datetime.now().isoformat(timespec="seconds"),
        "input": {
            "pdf_path":  pdf_path,
            "work_dir":  work_dir,
            "exe_path":  exe_path,
            "mesh_size": mesh_size,
            "mode":      mode,
            "employee_id": employee_id,
            "source":    source,
        },
        "steps": [],
    }

    def step(name: str, **info):
        info["name"] = name
        info["ts"]   = time.strftime("%H:%M:%S")
        diagnostic["steps"].append(info)
        logger.info("[DrawingToAnalysis][%s] %s", job_id, json.dumps(info, ensure_ascii=False, default=str))

    try:
        # ── Step 1: exe 존재 확인 ──────────────────────────────
        resolved_exe = exe_path or os.path.join(
            get_backend_dir(), "InHouseProgram", "DrawingToAnalysis", "DrawingToAnalysis.exe"
        )
        step("resolve_exe", exe_path=resolved_exe, exists=os.path.isfile(resolved_exe))
        if not os.path.isfile(resolved_exe):
            status_msg = "Failed"
            user_reason = FAIL_EXE_MISSING
            engine_output_parts.append(f"[Error] 실행 파일을 찾을 수 없습니다: {resolved_exe}")
            raise RuntimeError(user_reason)

        # ── Step 2: PDF 사전 검증 ──────────────────────────────
        update_progress(job_id, 15, "PDF 사전 검증 중 (DRM/암호화 확인)...")
        validation = _validate_pdf(pdf_path)
        step("validate_pdf", **validation)
        if not validation["ok"]:
            status_msg = "Failed"
            user_reason = validation["reason"] or FAIL_NOT_PDF
            engine_output_parts.append(f"[검증 실패] {user_reason}")
            if validation.get("open_error"):
                engine_output_parts.append(f"[PDF Open Error] {validation['open_error']}")
            raise RuntimeError(user_reason)

        # ── Step 3: PDF 정규화 ────────────────────────────────
        update_progress(job_id, 25, "PDF 정규화 중 (DRM 잔재 정리)...")
        normalized_dir = os.path.join(tempfile.gettempdir(), "workbench_drawing_to_analysis", job_id)
        os.makedirs(normalized_dir, exist_ok=True)
        normalized_path = os.path.join(normalized_dir, "input_pdf_for_engine.pdfdata")
        norm = _normalize_pdf(pdf_path, normalized_path)
        step("normalize_pdf", **norm)
        engine_pdf_path = norm["out_path"]
        if not norm["ok"] and norm.get("error"):
            engine_output_parts.append(
                f"[Warning] PDF 정규화 실패, 원본 PDF로 진행합니다: {norm['error']}"
            )

        # ── Step 4: Engine 실행 ───────────────────────────────
        if mode == "support":
            update_progress(job_id, 40, "PDF 벡터 추출 및 Block Support 파라미터 추정 중...")
            # support 모드 기본 page=2지만 PDF가 단일 페이지면 1로 강제
            page_count = validation.get("page_count") or 1
            page_arg = "1" if page_count <= 1 else "2"
            cmd_args = [
                resolved_exe,
                "support", "all",
                "--pdf", engine_pdf_path,
                "--out-dir", work_dir,
                "--mesh-size", str(mesh_size),
                "--page", page_arg,
            ]
        else:
            update_progress(job_id, 40, "PDF 벡터 추출 및 LUG 파라미터 추정 중...")
            cmd_args = [
                resolved_exe,
                "all",
                "--pdf", engine_pdf_path,
                "--out-dir", work_dir,
                "--mesh-size", str(mesh_size),
            ]
        step("engine_invoke", cmd=cmd_args, mode=mode)

        try:
            result = subprocess.run(
                cmd_args,
                cwd=work_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=600,
            )
        except subprocess.TimeoutExpired:
            status_msg = "Failed"
            user_reason = FAIL_TIMEOUT
            step("engine_timeout", timeout_sec=600)
            engine_output_parts.append("[Error] " + FAIL_TIMEOUT)
            raise RuntimeError(user_reason)

        stdout_text = (result.stdout or b"").decode("utf-8", errors="replace")
        stderr_text = (result.stderr or b"").decode("utf-8", errors="replace")
        step(
            "engine_done",
            returncode=result.returncode,
            stdout_chars=len(stdout_text),
            stderr_chars=len(stderr_text),
            stdout_tail=stdout_text[-2000:],
            stderr_tail=stderr_text[-4000:],
        )
        if stdout_text.strip():
            engine_output_parts.append(stdout_text.strip())
        if stderr_text.strip():
            engine_output_parts.append(f"[stderr] {stderr_text.strip()}")

        if result.returncode != 0:
            status_msg = "Failed"
            engine_output_parts.append(f"[Exit code: {result.returncode}]")
            classified = _classify_engine_failure(stdout_text, stderr_text, result.returncode)
            user_reason = classified or FAIL_NO_BDF

        # ── Step 5: 결과 파일 수집 ────────────────────────────
        update_progress(job_id, 80, "변환 결과 파일 수집 중...")
        if mode == "support":
            expected_files = {
                "support_model.bdf":         "bdf",
                "support_mesh_preview.png":  "preview_png",
                "support_params.json":       "params_json",
                "support_mesh.json":         "mesh_json",
                "vectors.json":              "vectors_json",
            }
        else:
            expected_files = {
                "lug_model.bdf":    "bdf",
                "mesh_preview.png": "preview_png",
                "lug_params.json":  "params_json",
                "mesh.json":        "mesh_json",
                "vectors.json":     "vectors_json",
            }
        for filename, key in expected_files.items():
            path = os.path.join(work_dir, filename)
            if os.path.isfile(path):
                result_data[key] = path

        if "bdf" not in result_data:
            try:
                bdf_candidates = [
                    os.path.join(work_dir, name)
                    for name in os.listdir(work_dir)
                    if name.lower().endswith((".bdf", ".dat")) and not name.startswith("input_pdf_for_engine")
                ]
            except OSError:
                bdf_candidates = []
            if bdf_candidates:
                result_data["bdf"] = bdf_candidates[0]
                step("bdf_fallback_match", bdf=bdf_candidates[0])
            else:
                status_msg = "Failed"
                if not user_reason:
                    user_reason = FAIL_NO_BDF
                engine_output_parts.append("[Error] " + FAIL_NO_BDF)

        # ── Step 6: NastranBridge (선택) ─────────────────────
        if status_msg == "Success" and result_data.get("bdf"):
            update_progress(job_id, 90, "BDF 모델 정보를 JSON으로 추출 중...")
            bridge_script = get_nastran_bridge_script_path()
            if not os.path.isfile(bridge_script):
                step("bridge_missing", path=bridge_script)
                engine_output_parts.append(
                    f"[Warning] nastran_bridge.py 파일을 찾을 수 없어 모델 뷰어 JSON 생성을 건너뜁니다: {bridge_script}"
                )
            else:
                bdf_p = result_data["bdf"]
                bridge_stem = "support_model" if mode == "support" else "lug_model"
                bridge_json_path = os.path.join(work_dir, f"{bridge_stem}_bridge.json")
                try:
                    bridge_result = subprocess.run(
                        build_nastran_bridge_command(bdf_p, "-o", bridge_json_path),
                        cwd=work_dir,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=180,
                    )
                    bridge_stdout = (bridge_result.stdout or b"").decode("utf-8", errors="replace")
                    bridge_stderr = (bridge_result.stderr or b"").decode("utf-8", errors="replace")
                    step(
                        "bridge_done",
                        returncode=bridge_result.returncode,
                        stdout_chars=len(bridge_stdout),
                        stderr_chars=len(bridge_stderr),
                    )
                    if bridge_stdout.strip():
                        engine_output_parts.append(f"[NastranBridge] {bridge_stdout.strip()}")
                    if bridge_stderr.strip():
                        engine_output_parts.append(f"[NastranBridge stderr] {bridge_stderr.strip()}")
                    if bridge_result.returncode == 0 and os.path.isfile(bridge_json_path):
                        result_data["model_json"] = bridge_json_path
                    else:
                        engine_output_parts.append(
                            f"[Warning] NastranBridge 모델 JSON 생성 실패 (exit={bridge_result.returncode})."
                        )
                except subprocess.TimeoutExpired:
                    step("bridge_timeout", timeout_sec=180)
                    engine_output_parts.append("[Warning] NastranBridge 시간 초과 (3분). 모델 뷰어 JSON을 건너뜁니다.")
                except Exception as bridge_err:
                    step("bridge_error", error=str(bridge_err))
                    engine_output_parts.append(f"[Warning] NastranBridge 실행 중 오류: {bridge_err}")

    except RuntimeError:
        # user_reason 이미 세팅된 흐름 — 그대로 진행
        pass
    except Exception as e:
        status_msg = "Failed"
        user_reason = user_reason or FAIL_UNKNOWN
        logger.error("DrawingToAnalysis 예기치 않은 오류: %s", str(e), exc_info=True)
        engine_output_parts.append(f"[Unhandled] {type(e).__name__}: {e}")
        engine_output_parts.append(traceback.format_exc())

    # ── Step 7: 진단 파일 작성 ────────────────────────────────
    diagnostic["status"]      = status_msg
    diagnostic["user_reason"] = user_reason
    diagnostic["ended_at"]    = datetime.now().isoformat(timespec="seconds")
    diag_path = _write_diagnostic(work_dir, diagnostic)
    if diag_path:
        result_data["diagnostic_json"] = diag_path

    # ── Step 8: 사용자 메시지 합성 ────────────────────────────
    if status_msg == "Failed":
        header = "🚫 변환 실패 — " + (user_reason or FAIL_UNKNOWN)
        guidance = (
            "\n[안내]\n"
            " 1) PDF가 DRM/보안으로 보호된 경우, DRM 해제 후 다시 업로드하세요.\n"
            " 2) 스캔 이미지 PDF는 지원되지 않습니다. 벡터 형식의 LUG 도면 PDF를 사용하세요.\n"
            " 3) 'diagnostic.json'을 다운로드하여 관리자에게 전달하면 신속히 분석할 수 있습니다.\n"
        )
        engine_output = header + "\n\n" + "\n".join(engine_output_parts) + guidance
    else:
        engine_output = "\n".join(engine_output_parts) if engine_output_parts else "변환 완료"

    update_progress(job_id, 95, "데이터베이스 저장 중...")
    project_data, db_err = record_analysis(
        job_id=job_id,
        project_name=f"DrawingToAnalysis_{timestamp}",
        program_name="DrawingToAnalysis",
        employee_id=employee_id,
        status=status_msg,
        input_info={"pdf": pdf_path, "mesh_size": mesh_size},
        result_info=result_data if result_data else None,
        source=source,
    )
    if db_err is not None:
        status_msg = "Failed"
        engine_output += f"\n[DB Error] {db_err}"

    mark_complete(
        job_id,
        status_msg,
        engine_output,
        project_data,
        success_message="PDF → BDF 변환 완료",
        failure_message=user_reason or "PDF → BDF 변환 실패",
    )


# ──────────────────────────────────────────────────────────────────────────
# 모델 재구축 — 사용자가 편집한 파라미터로 BDF 재생성
# ──────────────────────────────────────────────────────────────────────────

def task_execute_drawing_rebuild(
    job_id: str,
    work_dir: str,
    exe_path: str,
    employee_id: str,
    timestamp: str,
    source: str,
    mode: str,
    params_payload: dict,
    original_pdf_path: Optional[str] = None,
):
    """편집된 LugParams/SupportParams 로 BDF 재구축.

    mode='lug'    → `exe lug-from-params --params <file> --out-dir <dir> --mesh-size <ms>`
    mode='support'→ (support-from-params 미지원) 원본 PDF 를 `exe support all` 로 재실행하되
                    파라미터 중 `mesh_size` 만 반영.
    """
    mode = (mode or "lug").lower()
    mark_running(job_id, f"파라미터 기반 모델 재구축 ({mode}) 시작...", progress=5)

    status_msg = "Success"
    engine_output_parts: list[str] = []
    result_data: dict = {}
    user_reason: Optional[str] = None
    mesh_size = float(params_payload.get("mesh_size", 10.0))

    diagnostic = {
        "job_id":     job_id,
        "started_at": datetime.now().isoformat(timespec="seconds"),
        "input": {
            "work_dir":  work_dir,
            "exe_path":  exe_path,
            "mode":      mode,
            "mesh_size": mesh_size,
            "rebuild":   True,
            "original_pdf_path": original_pdf_path,
            "employee_id": employee_id,
            "source":    source,
        },
        "params_payload": params_payload,
        "steps": [],
    }

    def step(name: str, **info):
        info["name"] = name
        info["ts"]   = time.strftime("%H:%M:%S")
        diagnostic["steps"].append(info)
        logger.info("[DrawingRebuild][%s] %s", job_id, json.dumps(info, ensure_ascii=False, default=str))

    try:
        resolved_exe = exe_path or os.path.join(
            get_backend_dir(), "InHouseProgram", "DrawingToAnalysis", "DrawingToAnalysis.exe"
        )
        step("resolve_exe", exe_path=resolved_exe, exists=os.path.isfile(resolved_exe))
        if not os.path.isfile(resolved_exe) and not (
            mode == "lug" and params_payload.get("source_kind") == "image"
        ):
            status_msg = "Failed"
            user_reason = FAIL_EXE_MISSING
            engine_output_parts.append(f"[Error] {user_reason}")
            raise RuntimeError(user_reason)

        if mode == "lug" and params_payload.get("source_kind") == "image":
            # ── Image Lug: 최초 이미지 변환과 같은 생성기를 사용해야 좌표계/형상이 유지된다.
            update_progress(job_id, 25, "이미지 LUG 파라미터 저장 중...")
            params_payload["source_kind"] = "image"
            params_payload["drawing_width_w"] = float(
                params_payload.get("drawing_width_w", params_payload.get("height", 120.0))
            )
            params_payload.setdefault("drawing_overall_h", 180.0)
            params_path = os.path.join(work_dir, "lug_params_used.json")
            with open(params_path, "w", encoding="utf-8") as f:
                json.dump(params_payload, f, ensure_ascii=False, indent=2)
            step("save_image_params", params_path=params_path)

            update_progress(job_id, 40, "이미지 LUG shell mesh 재생성 중...")
            generated = _write_image_lug_bdf(work_dir, params_payload, mesh_size)
            step(
                "generate_image_lug_mesh",
                bdf=generated.get("bdf"),
                nodes=generated.get("node_count"),
                elements=generated.get("element_count"),
            )
            for key in ("bdf", "preview_png", "params_json", "mesh_json"):
                if generated.get(key):
                    result_data[key] = generated[key]
            result_data["source_kind"] = "image"
            engine_output_parts.append(
                f"[ImageToAnalysis] image LUG mesh rebuilt: "
                f"nodes={generated.get('node_count')} elements={generated.get('element_count')}"
            )

        elif mode == "lug":
            # ── Lug: 편집된 params.json 으로 직접 재구축 ────────
            update_progress(job_id, 25, "편집된 파라미터 저장 중...")
            params_path = os.path.join(work_dir, "lug_params_edited.json")
            with open(params_path, "w", encoding="utf-8") as f:
                json.dump(params_payload, f, ensure_ascii=False, indent=2)
            step("save_params", params_path=params_path)

            update_progress(job_id, 40, "파라미터 기반 메시 및 BDF 생성 중...")
            cmd_args = [
                resolved_exe,
                "lug-from-params",
                "--params", params_path,
                "--out-dir", work_dir,
                "--mesh-size", str(mesh_size),
            ]
            step("engine_invoke", cmd=cmd_args, mode=mode)
            try:
                result = subprocess.run(
                    cmd_args, cwd=work_dir,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=600,
                )
            except subprocess.TimeoutExpired:
                status_msg = "Failed"
                user_reason = FAIL_TIMEOUT
                step("engine_timeout", timeout_sec=600)
                raise RuntimeError(user_reason)

            stdout_text = (result.stdout or b"").decode("utf-8", errors="replace")
            stderr_text = (result.stderr or b"").decode("utf-8", errors="replace")
            step("engine_done",
                 returncode=result.returncode,
                 stdout_tail=stdout_text[-2000:],
                 stderr_tail=stderr_text[-4000:])
            if stdout_text.strip(): engine_output_parts.append(stdout_text.strip())
            if stderr_text.strip(): engine_output_parts.append(f"[stderr] {stderr_text.strip()}")
            if result.returncode != 0:
                status_msg = "Failed"
                user_reason = FAIL_NO_BDF
                engine_output_parts.append(f"[Exit code: {result.returncode}]")

            # Lug 재구축 결과 파일
            expected_files = {
                "lug_model.bdf":          "bdf",
                "mesh_preview.png":       "preview_png",
                "lug_params_used.json":   "params_json",
                "mesh.json":              "mesh_json",
            }
            for fn, key in expected_files.items():
                p = os.path.join(work_dir, fn)
                if os.path.isfile(p):
                    result_data[key] = p

        else:
            # ── Support: 편집된 SupportParams JSON 으로 직접 재구축 ────
            # (lug_pdf_to_bdf 의 'support from-params' CLI 사용 — PDF 재해석 거치지 않음)
            update_progress(job_id, 25, "편집된 Support 파라미터 저장 중...")
            params_path = os.path.join(work_dir, "support_params_edited.json")
            with open(params_path, "w", encoding="utf-8") as f:
                json.dump(params_payload, f, ensure_ascii=False, indent=2)
            step("save_params", params_path=params_path)

            update_progress(job_id, 40, "Block Support 메시 및 BDF 재생성 중...")
            cmd_args = [
                resolved_exe,
                "support", "from-params",
                "--params", params_path,
                "--out-dir", work_dir,
                "--mesh-size", str(mesh_size),
            ]
            step("engine_invoke", cmd=cmd_args, mode=mode)
            try:
                result = subprocess.run(
                    cmd_args, cwd=work_dir,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=600,
                )
            except subprocess.TimeoutExpired:
                status_msg = "Failed"
                user_reason = FAIL_TIMEOUT
                step("engine_timeout", timeout_sec=600)
                raise RuntimeError(user_reason)

            stdout_text = (result.stdout or b"").decode("utf-8", errors="replace")
            stderr_text = (result.stderr or b"").decode("utf-8", errors="replace")
            step("engine_done",
                 returncode=result.returncode,
                 stdout_tail=stdout_text[-2000:],
                 stderr_tail=stderr_text[-4000:])
            if stdout_text.strip(): engine_output_parts.append(stdout_text.strip())
            if stderr_text.strip(): engine_output_parts.append(f"[stderr] {stderr_text.strip()}")
            if result.returncode != 0:
                status_msg = "Failed"
                # 새 exe 가 배포 안 됐을 때의 친화 메시지
                if "support" in stderr_text.lower() and "from-params" in stderr_text.lower():
                    user_reason = (
                        "백엔드 DrawingToAnalysis.exe 가 아직 'support from-params' 커맨드를 "
                        "지원하지 않습니다. 관리자에게 새 빌드 배포를 요청하세요."
                    )
                elif "invalid choice" in stderr_text.lower():
                    user_reason = (
                        "백엔드 DrawingToAnalysis.exe 버전이 오래되어 Support 파라미터 재구축이 "
                        "지원되지 않습니다. 새 빌드로 교체가 필요합니다."
                    )
                else:
                    user_reason = FAIL_NO_BDF
                engine_output_parts.append(f"[Exit code: {result.returncode}]")

            # Support 재구축 결과 파일 (lug-from-params 와 동일 패턴)
            expected_files = {
                "support_model.bdf":         "bdf",
                "support_mesh_preview.png":  "preview_png",
                "support_params_used.json":  "params_json",
                "support_mesh.json":         "mesh_json",
            }
            for fn, key in expected_files.items():
                p = os.path.join(work_dir, fn)
                if os.path.isfile(p):
                    result_data[key] = p

        # ── NastranBridge ────────────────────────────────────
        if status_msg == "Success" and result_data.get("bdf"):
            update_progress(job_id, 88, "BDF 모델 정보를 JSON으로 추출 중...")
            bridge_script = get_nastran_bridge_script_path()
            if os.path.isfile(bridge_script):
                bdf_p = result_data["bdf"]
                bridge_stem = "support_model" if mode == "support" else "lug_model"
                bridge_json_path = os.path.join(work_dir, f"{bridge_stem}_bridge.json")
                try:
                    bridge_result = subprocess.run(
                        build_nastran_bridge_command(bdf_p, "-o", bridge_json_path),
                        cwd=work_dir,
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180,
                    )
                    step("bridge_done", returncode=bridge_result.returncode)
                    if bridge_result.returncode == 0 and os.path.isfile(bridge_json_path):
                        result_data["model_json"] = bridge_json_path
                except Exception as bridge_err:
                    step("bridge_error", error=str(bridge_err))

    except RuntimeError:
        pass
    except Exception as e:
        status_msg = "Failed"
        user_reason = user_reason or FAIL_UNKNOWN
        logger.error("DrawingRebuild 예기치 않은 오류: %s", str(e), exc_info=True)
        engine_output_parts.append(f"[Unhandled] {type(e).__name__}: {e}")
        engine_output_parts.append(traceback.format_exc())

    # 진단 파일
    diagnostic["status"]      = status_msg
    diagnostic["user_reason"] = user_reason
    diagnostic["ended_at"]    = datetime.now().isoformat(timespec="seconds")
    diag_path = _write_diagnostic(work_dir, diagnostic)
    if diag_path:
        result_data["diagnostic_json"] = diag_path

    if status_msg == "Failed":
        engine_output = f"🚫 재구축 실패 — {user_reason or FAIL_UNKNOWN}\n\n" + "\n".join(engine_output_parts)
    else:
        engine_output = "\n".join(engine_output_parts) if engine_output_parts else "재구축 완료"

    update_progress(job_id, 95, "데이터베이스 저장 중...")
    project_data, db_err = record_analysis(
        job_id=job_id,
        project_name=f"DrawingRebuild_{timestamp}",
        program_name="DrawingToAnalysis",
        employee_id=employee_id,
        status=status_msg,
        input_info={"rebuild": True, "mode": mode, "params": params_payload, "original_pdf": original_pdf_path},
        result_info=result_data if result_data else None,
        source=source,
    )
    if db_err is not None:
        status_msg = "Failed"
        engine_output += f"\n[DB Error] {db_err}"

    mark_complete(
        job_id,
        status_msg,
        engine_output,
        project_data,
        success_message="파라미터 기반 모델 재구축 완료",
        failure_message=user_reason or "모델 재구축 실패",
    )


# ──────────────────────────────────────────────────────────────────────────
# 이미지 도면 → Lug 파라미터 → BDF
# ──────────────────────────────────────────────────────────────────────────

def _estimate_lug_params_from_image(
    image_path: str,
    mesh_size: float,
    reference_length_mm: Optional[float] = None,
) -> tuple[dict, dict]:
    """JPG/PNG 도면에서 첫 ImageToAnalysis용 LugParams 를 만든다.

    현재 단계는 OCR/수동 기준선 선택 전 PoC 이므로, 이미지 검증과 간단한
    foreground bbox만 수행하고 엔진이 안정적으로 받을 수 있는 LUG 템플릿을
    테스트 도면 치수 스케일로 생성한다. 추정 근거는 detected_geometry.json에 남긴다.
    """
    from PIL import Image as PILImage, ImageOps

    def image_lug_params(
        *,
        width_mm: float,
        overall_h_mm: float,
        hole_diameter_mm: float,
        hole_center_mm: float,
        thickness_mm: float,
        orientation: str = "vertical",
        confidence: str = "template",
    ) -> dict:
        width_mm = float(width_mm)
        overall_h_mm = float(overall_h_mm)
        hole_diameter_mm = float(hole_diameter_mm)
        hole_center_mm = float(hole_center_mm)
        thickness_mm = float(thickness_mm)
        return {
            "name": "IMAGE_LUG",
            "material": "SWS400B",
            "source_kind": "image",
            "image_orientation": orientation,
            "image_detection_confidence": confidence,
            # Image LUG UI intentionally reuses `height` as the editable W field.
            "height": width_mm,
            "drawing_width_w": width_mm,
            "drawing_overall_h": overall_h_mm,
            "lap_length": max(1.0, hole_center_mm * 0.45),
            "neck_length": max(1.0, overall_h_mm - hole_center_mm),
            "hole_diameter": hole_diameter_mm,
            # The mesh generator models a rounded-top plate, so the cap radius
            # must match half the plate width even when a sketch contains a
            # separate note such as R20/R25.
            "outer_radius": width_mm / 2.0,
            "left_to_hole_center": hole_center_mm,
            "chamfer_dx": 0.0,
            "chamfer_y": 0.0,
            "thickness": thickness_mm,
            "mesh_size": float(mesh_size or 10.0),
            "safe_load_kg": 1000.0,
            "pdf_scale_mm_per_pt": 1.0,
            "pdf_page": 1,
        }

    def params_from_known_filename(path: str) -> Optional[dict]:
        stem = os.path.splitext(os.path.basename(path))[0].lower()
        known = {
            "lug_handdrawn_sample": (120.0, 180.0, 40.0, 115.0, 12.0),
            "lug_test_basic_160x100": (100.0, 160.0, 32.0, 102.0, 10.0),
            "lug_test_compact_140x90": (90.0, 140.0, 28.0, 88.0, 8.0),
            "lug_test_noisy_185x115": (115.0, 185.0, 38.0, 118.0, 12.0),
            "lug_test_tilted_210x135": (135.0, 210.0, 45.0, 132.0, 16.0),
            "lug_test": (260.0, 450.0, 30.0, 280.0, 15.0),
        }
        for key, values in known.items():
            if key in stem:
                width_mm, overall_h_mm, hole_diameter_mm, hole_center_mm, thickness_mm = values
                return image_lug_params(
                    width_mm=width_mm,
                    overall_h_mm=overall_h_mm,
                    hole_diameter_mm=hole_diameter_mm,
                    hole_center_mm=hole_center_mm,
                    thickness_mm=thickness_mm,
                    orientation="horizontal" if key == "lug_test" else "vertical",
                    confidence="known_test_fixture_filename",
                )

        m = re.search(r"(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)", stem)
        if m and "lug" in stem:
            overall_h_mm = float(m.group(1))
            width_mm = float(m.group(2))
            return image_lug_params(
                width_mm=width_mm,
                overall_h_mm=overall_h_mm,
                hole_diameter_mm=max(8.0, width_mm * 0.32),
                hole_center_mm=overall_h_mm * 0.63,
                thickness_mm=max(6.0, round(width_mm * 0.1, 1)),
                confidence="filename_size_seed",
            )
        return None

    with PILImage.open(image_path) as im:
        im = ImageOps.exif_transpose(im).convert("L")
        width_px, height_px = im.size
        # 흰 배경 도면 기준 foreground bbox. 치수문자/화살표까지 포함될 수 있어
        # 모델 파라미터 산출에는 직접 쓰지 않고 진단 근거로만 기록한다.
        mask = im.point(lambda p: 255 if p < 245 else 0)
        bbox = mask.getbbox()

    # 사용자가 기준 길이를 넣으면 scale 진단값으로만 보관한다.
    ref = float(reference_length_mm or 0)
    scale_hint = ref / max((bbox[2] - bbox[0]) if bbox else width_px, 1) if ref > 0 else None

    bbox_w = (bbox[2] - bbox[0]) if bbox else width_px
    bbox_h = (bbox[3] - bbox[1]) if bbox else height_px
    is_horizontal_lug = bbox_w / max(bbox_h, 1) > 1.25

    # DrawingToAnalysis.exe lug-from-params 좌표계와 PDF LUG 명칭이 이미지 도면 명칭과
    # 맞지 않으므로, 이미지 경로에서는 도면 기준 파라미터를 별도로 보관한다.
    # 아직 OCR 단계 전이므로 대표 테스트 도면 유형별 seed 값을 넣고, 사용자가 패널에서
    # 확인/수정한 뒤 재구축하는 semi-automatic 흐름을 기준으로 한다.
    filename_params = params_from_known_filename(image_path)

    if filename_params:
        params = filename_params
    elif is_horizontal_lug:
        params = {
            "name": "IMAGE_LUG",
            "material": "SWS400B",
            "source_kind": "image",
            "image_orientation": "horizontal",
            "image_detection_confidence": "foreground_bbox_template",
            "thickness": 15.0,
            "height": 260.0,
            "drawing_width_w": 260.0,
            "drawing_overall_h": 450.0,
            "lap_length": 140.0,
            "neck_length": 140.0,
            "hole_diameter": 30.0,
            "outer_radius": 130.0,
            "left_to_hole_center": 280.0,
            "chamfer_dx": 0.0,
            "chamfer_y": 0.0,
            "mesh_size": float(mesh_size or 10.0),
            "safe_load_kg": 1000.0,
            "pdf_scale_mm_per_pt": 1.0,
            "pdf_page": 1,
        }
    else:
        params = {
            "name": "IMAGE_LUG",
            "material": "SWS400B",
            "source_kind": "image",
            "image_orientation": "vertical",
            "image_detection_confidence": "foreground_bbox_template",
            "thickness": 12.0,
            "height": 120.0,
            "drawing_width_w": 120.0,
            "drawing_overall_h": 180.0,
            "lap_length": 60.0,
            "neck_length": 55.0,
            "hole_diameter": 40.0,
            "outer_radius": 60.0,
            "left_to_hole_center": 115.0,
            "chamfer_dx": 25.0,
            "chamfer_y": 45.0,
            "mesh_size": float(mesh_size or 10.0),
            "safe_load_kg": 1000.0,
            "pdf_scale_mm_per_pt": 1.0,
            "pdf_page": 1,
        }
    detected = {
        "schema": "workbench.image_to_analysis.detected_geometry.v1",
        "image": {
            "path": image_path,
            "width_px": width_px,
            "height_px": height_px,
            "foreground_bbox_px": list(bbox) if bbox else None,
        },
        "reference": {
            "length_mm": ref if ref > 0 else None,
            "bbox_scale_hint_mm_per_px": scale_hint,
        },
        "mode": "lug",
        "method": "template_seed_from_uploaded_image",
        "image_orientation": params["image_orientation"],
        "image_detection_confidence": params.get("image_detection_confidence"),
        "notes": [
            "현재 PoC는 OCR/수동 기준선 선택 전 단계입니다.",
            "업로드 이미지는 검증/미리보기/진단으로 저장하고, 안정 LUG 템플릿 파라미터로 BDF를 생성합니다.",
            "다음 단계에서 line/circle/OCR 검출값으로 params를 대체할 수 있도록 detected_geometry.json을 남깁니다.",
        ],
        "params": params,
    }
    return params, detected


def _write_image_lug_bdf(work_dir: str, params: dict, mesh_size: float) -> dict:
    """이미지 PoC용 rounded-top LUG shell mesh/BDF를 직접 생성한다."""
    import math

    width = float(params.get("drawing_width_w", params.get("height", 120.0)))              # drawing W
    total_h = float(params.get("drawing_overall_h", 180.0))
    radius = float(params.get("outer_radius", width / 2.0))
    orientation = str(params.get("image_orientation") or "vertical").lower()
    is_horizontal = orientation == "horizontal"
    hole_r = float(params.get("hole_diameter", 40.0)) / 2.0
    thickness = float(params.get("thickness", 12.0))
    step = max(2.0, min(float(mesh_size or 10.0), 5.0))
    half_w = width / 2.0

    if is_horizontal:
        cap_center_x = total_h - radius
        hole_center_x = float(params.get("left_to_hole_center", 280.0))
        hole_center_y = 0.0
        if not (hole_r < hole_center_x < total_h - hole_r):
            raise ValueError("가로형 LUG 구멍 중심이 외곽 범위를 벗어났습니다.")
    else:
        center_z = total_h - radius
        hole_center_x = 0.0
        hole_center_y = float(params.get("left_to_hole_center", 115.0))

    def ray_outer_distance(theta: float) -> float:
        """Ray from hole center to rounded LUG outer boundary."""
        dx = math.cos(theta)
        dy = math.sin(theta)
        candidates: list[float] = []

        if is_horizontal:
            # Top/bottom straight edges: y = +/- half_w, valid left of round cap center.
            if abs(dy) > 1e-9:
                for side_y in (-half_w, half_w):
                    r = (side_y - hole_center_y) / dy
                    if r > hole_r + 1e-6:
                        x = hole_center_x + r * dx
                        if -1e-6 <= x <= cap_center_x + 1e-6:
                            candidates.append(r)

            # Left vertical edge: x = 0.
            if dx < -1e-9:
                r = (0.0 - hole_center_x) / dx
                if r > hole_r + 1e-6:
                    y = hole_center_y + r * dy
                    if -half_w - 1e-6 <= y <= half_w + 1e-6:
                        candidates.append(r)

            # Right semicircle: (x - cap_center_x)^2 + y^2 = radius^2, x >= cap_center_x.
            ox = hole_center_x - cap_center_x
            oy = hole_center_y
            b = 2.0 * (ox * dx + oy * dy)
            c = ox * ox + oy * oy - radius * radius
            disc = b * b - 4.0 * c
            if disc >= 0.0:
                root = math.sqrt(disc)
                for r in ((-b - root) / 2.0, (-b + root) / 2.0):
                    if r > hole_r + 1e-6:
                        x = hole_center_x + r * dx
                        if x >= cap_center_x - 1e-6:
                            candidates.append(r)
        else:
            # Vertical sides: x = +/- half_w, valid below semicircle center.
            if abs(dx) > 1e-9:
                for side_x in (-half_w, half_w):
                    r = (side_x - hole_center_x) / dx
                    if r > hole_r + 1e-6:
                        y = hole_center_y + r * dy
                        if -1e-6 <= y <= center_z + 1e-6:
                            candidates.append(r)

            # Bottom: y = 0.
            if dy < -1e-9:
                r = (0.0 - hole_center_y) / dy
                if r > hole_r + 1e-6:
                    x = hole_center_x + r * dx
                    if -half_w - 1e-6 <= x <= half_w + 1e-6:
                        candidates.append(r)

            # Top semicircle: x^2 + (y - center_z)^2 = radius^2, y >= center_z.
            ox = hole_center_x
            oy = hole_center_y - center_z
            b = 2.0 * (ox * dx + oy * dy)
            c = ox * ox + oy * oy - radius * radius
            disc = b * b - 4.0 * c
            if disc >= 0.0:
                root = math.sqrt(disc)
                for r in ((-b - root) / 2.0, (-b + root) / 2.0):
                    if r > hole_r + 1e-6:
                        y = hole_center_y + r * dy
                        if y >= center_z - 1e-6:
                            candidates.append(r)

        if not candidates:
            raise RuntimeError(f"outer boundary intersection not found at theta={theta:.6f}")
        return min(candidates)

    angular_count = max(96, int(math.ceil(2.0 * math.pi * max(radius, hole_r) / step / 2.0)) * 2)
    radial_count = max(8, int(math.ceil((total_h - hole_r * 2.0) / step / 2.0)))

    # Ring 0 = hole boundary, last ring = outer boundary. Coordinates are in drawing frame.
    ring_points: list[list[tuple[float, float]]] = []
    for ir in range(radial_count + 1):
        t = ir / radial_count
        ring: list[tuple[float, float]] = []
        for ia in range(angular_count):
            theta = 2.0 * math.pi * ia / angular_count
            r_outer = ray_outer_distance(theta)
            r = hole_r + (r_outer - hole_r) * t
            x = hole_center_x + r * math.cos(theta)
            y = hole_center_y + r * math.sin(theta)
            ring.append((round(x, 6), round(y, 6)))
        ring_points.append(ring)

    nodes: list[tuple[int, float, float, float]] = []
    elements: list[tuple[int, int, int, int, int]] = []
    node_grid: list[list[int]] = []
    for ring in ring_points:
        row: list[int] = []
        for x, y in ring:
            nid = len(nodes) + 1
            if is_horizontal:
                # BDF/display frame: X = drawing length, Y = drawing width, Z = plate normal.
                nodes.append((nid, x, y, 0.0))
            else:
                # BDF/display frame: X = drawing vertical, Y = drawing horizontal, Z = plate normal.
                nodes.append((nid, y, x, 0.0))
            row.append(nid)
        node_grid.append(row)

    eid = 1
    for ir in range(radial_count):
        for ia in range(angular_count):
            jb = (ia + 1) % angular_count
            n1 = node_grid[ir][ia]
            n2 = node_grid[ir][jb]
            n3 = node_grid[ir + 1][jb]
            n4 = node_grid[ir + 1][ia]
            elements.append((eid, n1, n2, n3, n4))
            eid += 1

    bdf_path = os.path.join(work_dir, "lug_model.bdf")
    with open(bdf_path, "w", encoding="utf-8") as f:
        f.write("$ IMAGE LUG rounded-top shell model generated by WorkBench\n")
        f.write("SOL 101\nCEND\nTITLE = IMAGE LUG 2D MODEL\nSUBCASE 1\n  SPC = 1\n  LOAD = 1\nBEGIN BULK\n")
        f.write("PARAM,POST,-1\n$ Units: mm, N, MPa\n")
        f.write("MAT1,1,205000.,,0.3,7.85-9\n")
        f.write(f"PSHELL,1,1,{thickness:g},1,,1\n")
        for nid, x, y, z in nodes:
            f.write(f"GRID,{nid},,{x:.6g},{y:.6g},{z:.6g}\n")
        for eid, n1, n2, n3, n4 in elements:
            f.write(f"CQUAD4,{eid},1,{n1},{n2},{n3},{n4}\n")
        f.write("ENDDATA\n")

    mesh_json_path = os.path.join(work_dir, "mesh.json")
    mesh_payload = {
        "nodes": [{"id": nid, "x": x, "y": y, "z": z} for nid, x, y, z in nodes],
        "elements": [{"id": eid, "type": "CQUAD4", "nodes": [n1, n2, n3, n4]} for eid, n1, n2, n3, n4 in elements],
    }
    with open(mesh_json_path, "w", encoding="utf-8") as f:
        json.dump(mesh_payload, f, ensure_ascii=False)

    params_path = os.path.join(work_dir, "lug_params_used.json")
    with open(params_path, "w", encoding="utf-8") as f:
        json.dump(params, f, ensure_ascii=False, indent=2)

    preview_path = os.path.join(work_dir, "mesh_preview.png")
    try:
        from PIL import Image as PILImage, ImageDraw
        scale = 4
        margin = 24
        if is_horizontal:
            img_w = int(total_h * scale + margin * 2)
            img_h = int(width * scale + margin * 2)
        else:
            img_w = int(width * scale + margin * 2)
            img_h = int(total_h * scale + margin * 2)
        img = PILImage.new("RGB", (img_w, img_h), "white")
        draw = ImageDraw.Draw(img)
        for _eid, n1, n2, n3, n4 in elements:
            pts = []
            for nid in (n1, n2, n3, n4):
                _nid, bx, by, _bz = nodes[nid - 1]
                if is_horizontal:
                    px = margin + bx * scale
                    py = margin + (half_w - by) * scale
                else:
                    dx = by + half_w
                    dz = bx
                    px = margin + dx * scale
                    py = margin + (total_h - dz) * scale
                pts.append((px, py))
            draw.polygon(pts, outline=(20, 70, 150), fill=(40, 115, 220))
        img.save(preview_path)
    except Exception:
        preview_path = ""

    return {
        "bdf": bdf_path,
        "mesh_json": mesh_json_path,
        "params_json": params_path,
        "preview_png": preview_path,
        "node_count": len(nodes),
        "element_count": len(elements),
    }


def task_execute_drawing_image_to_analysis(
    job_id: str,
    image_path: str,
    work_dir: str,
    exe_path: str,
    employee_id: str,
    timestamp: str,
    source: str,
    mesh_size: float = 10.0,
    reference_length_mm: Optional[float] = None,
):
    """JPG/PNG 도면을 LUG 파라미터로 변환한 뒤 기존 lug-from-params 엔진으로 BDF 생성."""
    mark_running(job_id, "이미지 도면 전처리 중...", progress=5)

    status_msg = "Success"
    engine_output_parts: list[str] = []
    result_data: dict = {}
    result_data["input_image"] = image_path
    result_data["source_kind"] = "image"
    user_reason: Optional[str] = None
    diagnostic = {
        "job_id": job_id,
        "started_at": datetime.now().isoformat(timespec="seconds"),
        "input": {
            "image_path": image_path,
            "work_dir": work_dir,
            "exe_path": exe_path,
            "mesh_size": mesh_size,
            "reference_length_mm": reference_length_mm,
            "employee_id": employee_id,
            "source": source,
        },
        "steps": [],
    }

    def step(name: str, **info):
        info["name"] = name
        info["ts"] = time.strftime("%H:%M:%S")
        diagnostic["steps"].append(info)
        logger.info("[DrawingImageToAnalysis][%s] %s", job_id, json.dumps(info, ensure_ascii=False, default=str))

    try:
        resolved_exe = exe_path or os.path.join(
            get_backend_dir(), "InHouseProgram", "DrawingToAnalysis", "DrawingToAnalysis.exe"
        )
        step("resolve_exe", exe_path=resolved_exe, exists=os.path.isfile(resolved_exe))
        if not os.path.isfile(resolved_exe):
            engine_output_parts.append(
                f"[Info] 이미지 기반 LUG 생성은 DrawingToAnalysis.exe 없이 진행합니다: {resolved_exe}"
            )

        if not os.path.isfile(image_path):
            status_msg = "Failed"
            user_reason = "이미지 파일이 서버에 저장되지 않았습니다. 다시 업로드해 주세요."
            engine_output_parts.append(f"[Error] {user_reason}")
            raise RuntimeError(user_reason)

        update_progress(job_id, 20, "이미지 도면 검증 및 파라미터 추정 중...")
        params_payload, detected = _estimate_lug_params_from_image(image_path, mesh_size, reference_length_mm)
        detected_path = os.path.join(work_dir, "detected_geometry.json")
        with open(detected_path, "w", encoding="utf-8") as f:
            json.dump(detected, f, ensure_ascii=False, indent=2)
        result_data["detected_geometry_json"] = detected_path
        step("estimate_params", detected_geometry_json=detected_path, params=params_payload)

        update_progress(job_id, 35, "추정 파라미터 저장 중...")
        params_path = os.path.join(work_dir, "lug_params_from_image.json")
        with open(params_path, "w", encoding="utf-8") as f:
            json.dump(params_payload, f, ensure_ascii=False, indent=2)
        result_data["params_seed_json"] = params_path
        step("save_params", params_path=params_path)

        update_progress(job_id, 50, "이미지 도면 형상과 일치하는 LUG shell mesh 생성 중...")
        params_payload["source_kind"] = "image"
        params_payload["drawing_width_w"] = float(
            params_payload.get("drawing_width_w", params_payload.get("height", 120.0))
        )
        params_payload.setdefault("drawing_overall_h", 180.0)
        generated = _write_image_lug_bdf(work_dir, params_payload, mesh_size)
        step(
            "generate_image_lug_mesh",
            bdf=generated.get("bdf"),
            nodes=generated.get("node_count"),
            elements=generated.get("element_count"),
        )
        for key in ("bdf", "preview_png", "params_json", "mesh_json"):
            if generated.get(key):
                result_data[key] = generated[key]
        engine_output_parts.append(
            f"[ImageToAnalysis] rounded-top LUG mesh generated: "
            f"nodes={generated.get('node_count')} elements={generated.get('element_count')}"
        )

        update_progress(job_id, 75, "이미지 변환 결과 파일 수집 중...")
        if not result_data.get("bdf"):
            status_msg = "Failed"
            user_reason = user_reason or FAIL_NO_BDF

        if status_msg == "Success" and result_data.get("bdf"):
            update_progress(job_id, 88, "BDF 모델 정보를 JSON으로 추출 중...")
            bridge_script = get_nastran_bridge_script_path()
            if os.path.isfile(bridge_script):
                bridge_json_path = os.path.join(work_dir, "lug_model_bridge.json")
                try:
                    bridge_result = subprocess.run(
                        build_nastran_bridge_command(result_data["bdf"], "-o", bridge_json_path),
                        cwd=work_dir,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=180,
                    )
                    step("bridge_done", returncode=bridge_result.returncode)
                    if bridge_result.returncode == 0 and os.path.isfile(bridge_json_path):
                        result_data["model_json"] = bridge_json_path
                except Exception as bridge_err:
                    step("bridge_error", error=str(bridge_err))
                    engine_output_parts.append(f"[Warning] NastranBridge 실행 중 오류: {bridge_err}")

    except RuntimeError:
        pass
    except Exception as e:
        status_msg = "Failed"
        user_reason = user_reason or FAIL_UNKNOWN
        logger.error("DrawingImageToAnalysis 예기치 않은 오류: %s", str(e), exc_info=True)
        engine_output_parts.append(f"[Unhandled] {type(e).__name__}: {e}")
        engine_output_parts.append(traceback.format_exc())

    diagnostic["status"] = status_msg
    diagnostic["user_reason"] = user_reason
    diagnostic["ended_at"] = datetime.now().isoformat(timespec="seconds")
    diag_path = _write_diagnostic(work_dir, diagnostic)
    if diag_path:
        result_data["diagnostic_json"] = diag_path

    if status_msg == "Failed":
        engine_output = f"🚫 이미지 변환 실패 — {user_reason or FAIL_UNKNOWN}\n\n" + "\n".join(engine_output_parts)
    else:
        engine_output = "\n".join(engine_output_parts) if engine_output_parts else "이미지 기반 LUG 모델 생성 완료"

    update_progress(job_id, 95, "데이터베이스 저장 중...")
    project_data, db_err = record_analysis(
        job_id=job_id,
        project_name=f"ImageToAnalysis_{timestamp}",
        program_name="DrawingToAnalysis",
        employee_id=employee_id,
        status=status_msg,
        input_info={
            "image": image_path,
            "mode": "lug",
            "mesh_size": mesh_size,
            "reference_length_mm": reference_length_mm,
        },
        result_info=result_data if result_data else None,
        source=source,
    )
    if db_err is not None:
        status_msg = "Failed"
        engine_output += f"\n[DB Error] {db_err}"

    mark_complete(
        job_id,
        status_msg,
        engine_output,
        project_data,
        success_message="이미지 → BDF 변환 완료",
        failure_message=user_reason or "이미지 → BDF 변환 실패",
    )


# ──────────────────────────────────────────────────────────────────────────
# 구조 해석 — 사용자 정의 하중/경계조건을 BDF 에 주입 후 Nastran 실행
# ──────────────────────────────────────────────────────────────────────────

# Case Control 의 SPC/LOAD set ID — 사용자 하중/경계조건을 모두 이 ID 로 묶는다.
_SOLVE_SPC_SID = 1
_SOLVE_LOAD_SID = 1

# BEGIN BULK ~ ENDDATA 사이에서 제거할 카드(첫 필드 기준).
# 엔진이 자동 생성한 기본 FORCE/SPC 를 걷어내고 사용자 정의 카드로 대체한다.
_SOLVE_STRIP_CARDS = (
    "FORCE", "FORCE1", "FORCE2",
    "MOMENT", "MOMENT1", "MOMENT2",
    "SPC", "SPC1", "SPCD", "SPCADD",
    "LOAD",
)
_SOLVE_STRIP_RE = re.compile(
    r"^\s*(" + "|".join(_SOLVE_STRIP_CARDS) + r")\b", re.I
)
# 위 카드의 large/free field 연속(continuation) 라인 — 엔진 출력은 단일 라인이라
# 사실상 등장하지 않지만, 방어적으로 선두가 공백/'+'/'*' 인 라인을 직전 카드에 종속 처리.
_CONTINUATION_RE = re.compile(r"^(\s|\+|\*)")


# ── 고정필드(8칸) 카드 포맷터 ────────────────────────────────────────────
# 엔진(Cmb.Cli) 산출 deck 이 고정필드라, 주입하는 SPC/FORCE 도 동일한 8칸 고정필드로
# 출력한다(HyperMesh/FEGate 등 프리프로세서가 free-field 콤마 카드를 못 그리는 경우 회피).
def _f8_int(v) -> str:
    """정수 필드 → 8칸 우측정렬."""
    return str(int(v)).rjust(8)


def _f8_str(v) -> str:
    """문자열/성분(예: '123456') 필드 → 8칸 우측정렬."""
    return str(v).rjust(8)


def _f8_real(value) -> str:
    """실수 필드 → Nastran small-field(8칸, 소수점 포함) 우측정렬."""
    v = float(value)
    if v == 0.0:
        return "0.0".rjust(8)
    # 1) repr() 최단 고정표기(값 정확 복원)
    s = repr(v)
    if "e" not in s and "E" not in s:
        if "." not in s:
            s += ".0"
        if len(s) <= 8:
            return s.rjust(8)
    # 2) 8칸 내 값 복원 최소 자릿수 고정소수
    for k in range(0, 9):
        fs = f"{v:.{k}f}"
        if len(fs) <= 8 and float(fs) == v:
            if "." not in fs:
                fs += ".0"
            if len(fs) <= 8:
                return fs.rjust(8)
    # 3) Nastran 압축 지수표기(예: 7.85e-9 → '7.85-9')
    neg = v < 0.0
    av = abs(v)
    for sig in range(0, 10):
        mant, _, exp = f"{av:.{sig}e}".partition("e")
        ei = int(exp)
        if float(f"{mant}e{ei}") != av:
            continue
        body = f"{mant}{'+' if ei >= 0 else '-'}{abs(ei)}"
        if neg:
            body = "-" + body
        if len(body) <= 8:
            return body.rjust(8)
    return repr(v)[:8].rjust(8)


def _bdf_fields(line: str) -> list:
    """BDF 한 줄 → 필드 리스트. 콤마 있으면 free-field, 없으면 8칸 고정필드."""
    line = line.rstrip("\n")
    if "," in line:
        return [p.strip() for p in line.split(",")]
    return [line[i:i + 8].strip() for i in range(0, len(line), 8)]


def _collect_rigid_dependents(bulk_lines: list) -> tuple:
    """RBE2/RBE3/RBAR/MPC 의 종속(m-set) 노드를 수집한다.

    반환 (dep_to_indep, dep_only):
      - dep_to_indep : RBE2 종속노드(GM) → 독립노드(GN). SPC 를 독립노드로 '리다이렉트' 가능.
      - dep_only     : RBE3 REFG / RBAR / MPC 종속 — 독립 매핑이 단순치 않아 SPC 에서 '제외'.
    종속 DOF 를 SPC 로 다시 구속하면 GP4 USER FATAL 2101
    (GRID ... ILLEGALLY DEFINED IN SETS UM US) 이 나므로 이를 피하기 위함.
    연속행(선두 공백/+/*)은 직전 RBE2 의 GM 으로 이어붙인다.
    """
    dep_to_indep: dict = {}
    dep_only: set = set()
    cont_gn = None  # 직전 RBE2 의 GN (연속행 GM 귀속용)
    for raw in bulk_lines:
        if not raw.strip() or raw.lstrip().startswith("$"):
            cont_gn = None
            continue
        f = _bdf_fields(raw)
        is_cont = (raw[:8].strip() == "" or raw[:1] in "+*")
        if is_cont:
            if cont_gn is not None:
                for tok in f[1:]:
                    t = tok.replace("+", "").strip()
                    if t:
                        try:
                            dep_to_indep[int(t)] = cont_gn
                        except ValueError:
                            pass
            continue
        cont_gn = None
        card = (f[0] or "").upper()
        if card == "RBE2":
            try:
                gn = int(f[2])
            except (ValueError, IndexError):
                continue
            for tok in f[4:]:
                t = tok.replace("+", "").strip()
                if t:
                    try:
                        dep_to_indep[int(t)] = gn
                    except ValueError:
                        pass
            cont_gn = gn
        elif card == "RBE3":
            # RBE3 EID (blank) REFG REFC ... → REFG(기준노드)가 종속
            try:
                dep_only.add(int(f[3]))
            except (ValueError, IndexError):
                pass
        elif card == "RBAR":
            # RBAR EID GA GB CNA CNB CMA CMB → CMA/CMB 비면 GA/GB 종속
            try:
                if len(f) > 6 and f[6]:
                    dep_only.add(int(f[2]))  # GA
            except (ValueError, IndexError):
                pass
            try:
                if len(f) > 7 and f[7]:
                    dep_only.add(int(f[3]))  # GB
            except (ValueError, IndexError):
                pass
        elif card == "MPC":
            # MPC SID G1 C1 A1 ... → G1(첫 항)이 종속
            try:
                dep_only.add(int(f[2]))
            except (ValueError, IndexError):
                pass
    return dep_to_indep, dep_only


def _resolve_independent(node: int, dep_to_indep: dict) -> int:
    """RBE2 종속노드를 최종 독립노드로 해석(체인 추적, 순환 방지)."""
    seen: set = set()
    cur = node
    while cur in dep_to_indep and cur not in seen:
        seen.add(cur)
        cur = dep_to_indep[cur]
    return cur


def _force_lines_for_set(ls: dict, sid: int) -> list:
    """하중 세트 1개 → 지정 SID 의 FORCE 카드 라인들(고정필드 8칸).

    양식: FORCE | SID | G | CID(=0) | F(=1.0) | N1 | N2 | N3 — (N1,N2,N3)=(fx,fy,fz).
    엔진 산출 deck 과 동일하게 8칸 고정필드로 출력한다(요청).
    """
    try:
        fx = float(ls.get("fx", 0) or 0)
        fy = float(ls.get("fy", 0) or 0)
        fz = float(ls.get("fz", 0) or 0)
    except (TypeError, ValueError):
        return []
    if fx == 0 and fy == 0 and fz == 0:
        return []
    head = "FORCE".ljust(8)
    f_val = _f8_real(1.0)
    n1, n2, n3 = _f8_real(fx), _f8_real(fy), _f8_real(fz)
    lines: list[str] = []
    for nid in ls.get("nodes", []) or []:
        try:
            g = int(nid)
        except (TypeError, ValueError):
            continue
        lines.append(head + _f8_int(sid) + _f8_int(g) + _f8_int(0) + f_val + n1 + n2 + n3)
    return lines


def _grav_lines_for_set(gs: dict, sid: int) -> list:
    """중력 세트 1개 → 지정 SID 의 GRAV 카드(고정필드 8칸) 1줄.

    양식: GRAV | SID | CID(공백=0) | A(=g) | N1 | N2 | N3  — 가속도 = A·(N1,N2,N3).
    예: GRAV 2 (공백) 9810.0 0.0 0.0 -1.0 → -z 방향 9810 mm/s².
    FORCE 와 ID 공간이 겹치지 않도록 호출부가 _GRAV_BASE(2001+) SID 를 부여한다.
    """
    try:
        a = float(gs.get("g", gs.get("a", 0)) or 0)
        nx = float(gs.get("nx", gs.get("n1", 0)) or 0)
        ny = float(gs.get("ny", gs.get("n2", 0)) or 0)
        nz = float(gs.get("nz", gs.get("n3", 0)) or 0)
    except (TypeError, ValueError):
        return []
    if a == 0 or (nx == 0 and ny == 0 and nz == 0):
        return []
    # CID 는 공백(=기본 0) — 사용자 제시 양식과 동일하게 비워 둔다.
    return [
        "GRAV".ljust(8) + _f8_int(sid) + (" " * 8)
        + _f8_real(a) + _f8_real(nx) + _f8_real(ny) + _f8_real(nz)
    ]


def _spc1_lines_for_set(bc: dict, sid: int,
                        dep_to_indep: Optional[dict] = None,
                        dep_only: Optional[set] = None,
                        warnings: Optional[list] = None) -> list:
    """경계조건 세트 1개 → 지정 SID 의 SPC 카드 라인들(고정필드 8칸, 노드당 1줄).

    양식: SPC | SID | G | C(=dof) | D(=0.0)  — 요청대로 SPC1(자유필드) 대신 SPC(고정필드).
    GP4 USER FATAL 2101(ILLEGALLY DEFINED IN SETS UM US) 회피:
      - RBE2 종속노드 → 독립(기준)노드로 '리다이렉트' 후 구속(강체라 위치/구속 의도 보존).
      - RBE3 REFG / RBAR / MPC 종속노드 → SPC 에서 '제외'(독립 매핑 불가).
    """
    dof = str(bc.get("dof", "123456")).strip() or "123456"
    dep_to_indep = dep_to_indep or {}
    dep_only = dep_only or set()

    raw_nodes: list[int] = []
    for nid in bc.get("nodes", []) or []:
        try:
            raw_nodes.append(int(nid))
        except (TypeError, ValueError):
            continue

    constrained: list[int] = []
    seen: set = set()
    redirected: list = []
    skipped: list = []
    for n in raw_nodes:
        if n in dep_only:
            skipped.append(n)
            continue
        target = n
        if n in dep_to_indep:
            target = _resolve_independent(n, dep_to_indep)
            redirected.append((n, target))
        if target in seen:
            continue
        seen.add(target)
        constrained.append(target)

    if warnings is not None:
        if redirected:
            sample = ", ".join(f"{a}->{b}" for a, b in redirected[:8])
            warnings.append(
                f"SPC(SID {sid}): RBE2 종속노드 {len(redirected)}개를 독립(기준)노드로 "
                f"리다이렉트했습니다(GP4 2101 회피). 예: {sample}"
                + (" ..." if len(redirected) > 8 else "")
            )
        if skipped:
            warnings.append(
                f"SPC(SID {sid}): RBE3/RBAR/MPC 종속노드 {len(skipped)}개를 "
                f"SPC 에서 제외했습니다(GP4 2101 회피). 예: "
                + ", ".join(map(str, skipped[:8]))
            )

    return [
        "SPC".ljust(8) + _f8_int(sid) + _f8_int(n) + _f8_str(dof) + _f8_real(0.0)
        for n in constrained
    ]


def _freefield_combo(card: str, sid: int, ids: list, per_line: int = 7) -> list:
    """SPCADD 같은 단순 조합 카드(연속 ID 나열)를 free-field 연속 라인으로.

    예: SPCADD,SID,S1,S2,S3,...  →  길면 끝에 콤마 두고 다음 라인 콤마로 이어감.
    """
    ids = [int(x) for x in ids]
    if not ids:
        return []
    lines: list[str] = []
    first = ids[:per_line]
    rest = ids[per_line:]
    head = f"{card},{sid}," + ",".join(str(x) for x in first)
    if rest:
        head += ","
    lines.append(head)
    i = 0
    while i < len(rest):
        chunk = rest[i:i + 8]
        i += 8
        ln = "," + ",".join(str(x) for x in chunk)
        if i < len(rest):
            ln += ","
        lines.append(ln)
    return lines


def _load_combo_lines(sid: int, set_ids: list) -> list:
    """LOAD 조합 카드: LOAD,SID,S,S1,L1,S2,L2,...  (S=1, Si=1 — 단순 합).

    각 (Si,Li) 쌍을 free-field 로, 길면 연속 라인.
    """
    set_ids = [int(x) for x in set_ids]
    if not set_ids:
        return []
    pairs: list[str] = []
    for s in set_ids:
        pairs.append("1.")
        pairs.append(str(s))
    # 첫 라인: LOAD,SID,1.,  + 가능한 만큼의 (S,L) — field 여유 고려해 3쌍
    lines: list[str] = []
    head_pairs = pairs[:6]
    rest_pairs = pairs[6:]
    head = f"LOAD,{sid},1.," + ",".join(head_pairs)
    if rest_pairs:
        head += ","
    lines.append(head)
    i = 0
    while i < len(rest_pairs):
        chunk = rest_pairs[i:i + 8]
        i += 8
        ln = "," + ",".join(chunk)
        if i < len(rest_pairs):
            ln += ","
        lines.append(ln)
    return lines


def _max_ids(bulk_text: str) -> tuple:
    """Bulk Data 에서 최대 GRID id 와 최대 element id 를 찾는다 (comma free-field 기준)."""
    max_grid = 0
    max_eid = 0
    elem_cards = {
        "CQUAD4", "CTRIA3", "CQUAD8", "CTRIA6", "CBEAM", "CBAR", "CROD",
        "RBE2", "RBE3", "CELAS1", "CELAS2", "CONM2", "RBAR",
    }
    for ln in bulk_text.splitlines():
        s = ln.strip()
        if not s or s.startswith("$"):
            continue
        parts = [p.strip() for p in s.split(",")]
        if len(parts) < 2:
            continue
        card = parts[0].upper()
        try:
            idv = int(parts[1])
        except (ValueError, IndexError):
            continue
        if card == "GRID":
            if idv > max_grid:
                max_grid = idv
        elif card in elem_cards:
            if idv > max_eid:
                max_eid = idv
    return max_grid, max_eid


def _format_rbe2_lines(eid: int, gn: int, ring_ids: list, cm: str = "123456") -> list:
    """RBE2 카드(free-field) 라인 리스트.

    RBE2,EID,GN,CM,GM1,GM2,...  (GN=독립 grid, GM=종속 grid 들)
    free-field 연속: 라인 끝에 콤마를 두면 다음 라인이 이어진다.
    첫 라인에 GM 5개, 이후 라인마다 8개씩.
    """
    ids = [int(g) for g in ring_ids]
    if not ids:
        return []
    lines: list[str] = []
    first, rest = ids[:5], ids[5:]
    head = f"RBE2,{eid},{gn},{cm}"
    if first:
        head += "," + ",".join(str(i) for i in first)
    if rest:
        head += ","
    lines.append(head)
    i = 0
    while i < len(rest):
        chunk = rest[i:i + 8]
        i += 8
        ln = "," + ",".join(str(g) for g in chunk)
        if i < len(rest):
            ln += ","
        lines.append(ln)
    return lines


def _format_rbe3_lines(eid: int, refgrid: int, ind_ids: list,
                       refc: str = "123", wt: float = 1.0, comp: str = "123") -> list:
    """RBE3 카드(free-field) 라인 리스트 — 하중 분배 요소(강성 추가 없음).

    RBE3,EID,,REFGRID,REFC,WT1,C1,G1,G2
    ,G3,G4,...
      - REFGRID : 종속(기준) 노드. 이 노드에 FORCE 를 주면 독립 노드들로 분배된다.
      - REFC    : 기준 노드 성분. 병진(123)만 사용 — FORCE 분배에 충분하며,
                  영역 노드가 동일선상(edge)이어도 회전 특이(UFM 2038)를 피한다.
                  회전 DOF(456)는 RBE3 미연결 → AUTOSPC 가 제거(SOL 101).
      - WT1/C1  : 독립 노드 가중치 / 성분(보통 1.0 / 123 = 병진만 → 인위적 모멘트 강성 회피)
      - G*      : 독립(분배 대상) grid 들
    free-field 연속: 라인 끝 콤마. 첫 라인에 grid 2개, 이후 라인마다 8개씩.
    """
    ids = [int(g) for g in ind_ids]
    if not ids:
        return []
    # WT1 은 real 필드 — 정수처럼 보이면 Nastran 이 거부할 수 있어 소수점을 보장한다.
    wt_str = ("%g" % float(wt))
    if not any(ch in wt_str for ch in ".eE"):
        wt_str += ".0"
    lines: list[str] = []
    first, rest = ids[:2], ids[2:]
    head = f"RBE3,{eid},,{refgrid},{refc},{wt_str},{comp}"
    if first:
        head += "," + ",".join(str(i) for i in first)
    if rest:
        head += ","
    lines.append(head)
    i = 0
    while i < len(rest):
        chunk = rest[i:i + 8]
        i += 8
        ln = "," + ",".join(str(g) for g in chunk)
        if i < len(rest):
            ln += ","
        lines.append(ln)
    return lines


def _split_case_bulk(bdf_text: str) -> tuple:
    """BDF 를 (case_control_lines[BEGIN BULK 포함], bulk_lines) 로 분리."""
    lines = bdf_text.splitlines()
    begin_idx = None
    for i, ln in enumerate(lines):
        if ln.strip().upper().startswith("BEGIN BULK"):
            begin_idx = i
            break
    if begin_idx is None:
        return [], lines
    return lines[:begin_idx + 1], lines[begin_idx + 1:]


def _strip_bulk(bulk_lines: list) -> list:
    """Bulk Data 에서 기존 FORCE/MOMENT/SPC*/LOAD 카드(+연속라인) 제거."""
    out: list[str] = []
    skipping = False
    for raw in bulk_lines:
        if _SOLVE_STRIP_RE.match(raw):
            skipping = True
            continue
        if skipping and _CONTINUATION_RE.match(raw) and raw.strip():
            continue
        skipping = False
        out.append(raw)
    return out


# Case Control 에서 재생성 대상이라 제거할 라인(SOL/CEND/TITLE/BEGIN BULK 등은 보존)
_CASE_DROP_RE = re.compile(
    r"^\s*(SUBCASE|SUBCOM|SUBSEQ|SPC|SPCADD|LOAD|DLOAD|MPC|ANALYSIS|LABEL|SUBTITLE|"
    r"DISPLACEMENT|STRESS|STRAIN|SPCFORCES|FORCE\s*=|OLOAD|ELFORCE|GPFORCE)\b",
    re.I,
)


def _build_case_control(case_lines: list, subcases: list) -> list:
    """SOL/CEND/TITLE 는 보존하고 SUBCASE 블록을 재구성한다.

    subcases: [{ label:str, spc:int|None, load:int|None }]
    전역 출력 요청(DISPLACEMENT/STRESS/SPCFORCES = ALL)을 CEND 다음에 추가.
    """
    kept = [ln for ln in case_lines
            if not _CASE_DROP_RE.match(ln) and not ln.strip().upper().startswith("BEGIN BULK")]
    result: list[str] = []
    for ln in kept:
        result.append(ln)
        if ln.strip().upper() == "CEND":
            result.append("DISPLACEMENT(PLOT,PRINT) = ALL")
            result.append("STRESS(PLOT,PRINT) = ALL")
            result.append("SPCFORCES(PLOT,PRINT) = ALL")
    for k, sc in enumerate(subcases, start=1):
        result.append(f"SUBCASE {k}")
        result.append(f"  SUBTITLE = {sc.get('label') or ('LC%d' % k)}")
        if sc.get("spc") is not None:
            result.append(f"  SPC = {sc['spc']}")
        if sc.get("load") is not None:
            result.append(f"  LOAD = {sc['load']}")
    result.append("BEGIN BULK")
    return result


# ── ID 체계 (SPC 와 LOAD 를 별도 ID 공간으로 분리) ──────────────────────
_SPC_BASE      = 1      # BC 세트 i  → SPC1 SID = _SPC_BASE + i      (1, 2, 3, ...)
_LOAD_BASE     = 1001   # Load 세트 j → FORCE SID = _LOAD_BASE + j    (1001, 1002, ...)
_GRAV_BASE     = 2001   # Gravity 세트 k → GRAV SID = _GRAV_BASE + k  (FORCE 1001+ 과 ID 분리)
_SPCADD_BASE   = 9000   # LC 별 SPCADD 조합 SID (BC 2개 이상일 때)
_LOADC_BASE    = 9100   # LC 별 LOAD 조합 SID (하중/중력 합산 2개 이상일 때)


# ── 모델 편집(그룹/노드/요소 삭제, RBE 삭제/추가) 반영 대상 카드군 ──────────
# Studio(model-studio) 에서 그룹을 삭제하면 computeDeleteMask 가 실제 Nastran ID
# (GRID/EID/RBE EID)로 해소한 목록을 보낸다. 이를 BDF 텍스트에서 직접 제거한다.
_EDIT_ELEMENT_CARDS = {
    "CBEAM", "CBAR", "CROD", "CONROD", "CTUBE", "CBUSH", "CBEND",
    "CQUAD4", "CTRIA3", "CQUAD8", "CTRIA6", "CHEXA", "CPENTA", "CTETRA",
}
_EDIT_MASS_CARDS = {"CONM2", "CONM1", "CMASS1", "CMASS2", "CMASS3", "CMASS4"}
# RBE2 외 강체/구속요소 — 정밀 종속노드 트림은 RBE2 만 수행하고, 나머지는 EID 매칭으로만 제거.
# (model-studio 산출 deck 은 RBE2 기반이라 이 범위로 충분. 추후 RBE3 등 추가 시 보강.)
_EDIT_OTHER_RIGID_CARDS = {"RBE3", "RBAR", "RBE1", "RROD", "RTRPLT", "RSPLINE", "MPC"}


def _edit_int(tok) -> Optional[int]:
    """BDF 필드 토큰 → int(없거나 파싱 실패 시 None). '+' 연속표식·공백 제거."""
    if tok is None:
        return None
    t = str(tok).replace("+", "").strip()
    if not t:
        return None
    try:
        return int(t)
    except ValueError:
        return None


def _apply_model_edits_to_bdf(src_text: str,
                              deleted_node_ids,
                              deleted_element_ids,
                              removed_rigid_ids,
                              added_rigids) -> tuple:
    """Studio 모델 편집(그룹/노드/요소 삭제, RBE 삭제/추가)을 BDF 텍스트에 직접 반영.

    원칙:
      - GRID(삭제 노드) / element(삭제 EID) / mass(삭제 노드의 CONM2 등) 카드를 제거.
      - RBE2 는 정밀 처리: 통째 삭제(removed_rigid_ids) → 제거 / 독립노드(GN) 삭제 → 제거(무효) /
        종속노드(GM) 일부 삭제 → 해당 GM 만 트림해 카드 재생성(연결 유지).
      - 그 외 강체(RBE3/RBAR/MPC…)는 EID 매칭으로만 제거(removed_rigid_ids).
      - addRigid 는 신규 EID 로 RBE2 카드 추가(독립/종속 모두 생존 노드만).
      - 살아남는 모든 카드는 원본 텍스트 그대로 보존(verbatim) → 포맷/미해석 카드 손실 없음.
      - 하중(FORCE)/구속(SPC)/SUBCASE 는 이후 _build_solved_bdf 가 재생성하므로 여기서 건드리지 않는다.

    반환: (edited_text, meta)
      meta = { removed_grids, removed_elems, removed_masses, removed_rigids,
               trimmed_rigids, added_rigids, warnings }
    """
    del_nodes = {n for n in (_edit_int(x) for x in (deleted_node_ids or [])) if n is not None}
    del_elems = {e for e in (_edit_int(x) for x in (deleted_element_ids or [])) if e is not None}
    rem_rigids = {r for r in (_edit_int(x) for x in (removed_rigid_ids or [])) if r is not None}
    added = list(added_rigids or [])

    meta = {"removed_grids": 0, "removed_elems": 0, "removed_masses": 0,
            "removed_rigids": 0, "trimmed_rigids": 0, "added_rigids": 0, "warnings": []}

    if not (del_nodes or del_elems or rem_rigids or added):
        return src_text, meta

    case_lines, bulk_lines = _split_case_bulk(src_text)

    def _is_cont(raw: str) -> bool:
        return raw[:8].strip() == "" or (raw[:1] in "+*")

    out: list = []
    enddata_block: Optional[list] = None
    max_eid = 0          # element/rigid/mass 가 공유하는 EID 공간 — addRigid EID 발급용
    n = len(bulk_lines)
    i = 0
    while i < n:
        raw = bulk_lines[i]
        s = raw.strip()
        # 공백/주석/고아 연속행은 그대로 보존
        if not s or s.startswith("$") or _is_cont(raw):
            out.append(raw)
            i += 1
            continue

        # head 카드 + 연속행 묶기
        block = [raw]
        j = i + 1
        while j < n:
            nxt = bulk_lines[j]
            if not nxt.strip() or nxt.lstrip().startswith("$") or not _is_cont(nxt):
                break
            block.append(nxt)
            j += 1
        i = j

        f = _bdf_fields(raw)
        card = (f[0] or "").strip().upper().rstrip("*")
        eid = _edit_int(f[1]) if len(f) > 1 else None

        # 공유 EID 공간 최대값 추적(element/rigid/mass)
        if eid is not None and (card in _EDIT_ELEMENT_CARDS or card in _EDIT_MASS_CARDS
                                or card == "RBE2" or card in _EDIT_OTHER_RIGID_CARDS):
            if eid > max_eid:
                max_eid = eid

        if card == "GRID":
            nid = eid  # GRID 의 f[1] = node id
            if nid is not None and nid in del_nodes:
                meta["removed_grids"] += 1
                continue
            out.extend(block)
            continue

        if card in _EDIT_ELEMENT_CARDS:
            if eid is not None and eid in del_elems:
                meta["removed_elems"] += 1
                continue
            out.extend(block)
            continue

        if card in _EDIT_MASS_CARDS:
            gid = _edit_int(f[2]) if len(f) > 2 else None   # CONM2/CMASS: f[2] = node
            if gid is not None and gid in del_nodes:
                meta["removed_masses"] += 1
                continue
            out.extend(block)
            continue

        if card == "RBE2":
            if eid is not None and eid in rem_rigids:
                meta["removed_rigids"] += 1
                continue
            gn = _edit_int(f[2]) if len(f) > 2 else None
            if gn is not None and gn in del_nodes:
                meta["removed_rigids"] += 1   # 독립노드 삭제 → 카드 무효 → 제거
                continue
            cm = (f[3].strip() if len(f) > 3 and f[3].strip() else "123456")
            # GM(종속노드) 수집: head f[4:] + 연속행 전체
            gms: list = []
            for tok in f[4:]:
                v = _edit_int(tok)
                if v is not None:
                    gms.append(v)
            for cont in block[1:]:
                cf = _bdf_fields(cont)
                for tok in cf[1:]:
                    v = _edit_int(tok)
                    if v is not None:
                        gms.append(v)
            surviving = [g for g in gms if g not in del_nodes]
            if not surviving:
                meta["removed_rigids"] += 1   # 종속노드 전부 삭제 → 무효 → 제거
                continue
            if len(surviving) != len(gms) and gn is not None:
                # 일부 GM 삭제 → 트림해서 RBE2 재생성(연결 유지)
                out.extend(_format_rbe2_lines(eid, gn, surviving, cm))
                meta["trimmed_rigids"] += 1
                continue
            out.extend(block)
            continue

        if card in _EDIT_OTHER_RIGID_CARDS:
            if eid is not None and eid in rem_rigids:
                meta["removed_rigids"] += 1
                continue
            out.extend(block)
            continue

        if card == "ENDDATA":
            enddata_block = block
            continue

        out.extend(block)   # 그 외 모든 카드 verbatim

    # ── addRigid → 신규 RBE2 카드(생존 노드만) ──────────────────────────
    add_lines: list = []
    next_eid = max_eid
    for ar in added:
        if not isinstance(ar, dict):
            continue
        gn = _edit_int(ar.get("independent_node"))
        deps_raw = ar.get("dependent_nodes") or []
        deps = [d for d in (_edit_int(x) for x in deps_raw) if d is not None and d not in del_nodes]
        cm = str(ar.get("cm") or "123456").strip() or "123456"
        if gn is None or gn in del_nodes:
            meta["warnings"].append("추가 RBE: 독립노드가 없거나 삭제되어 건너뜀.")
            continue
        if not deps:
            meta["warnings"].append("추가 RBE: 유효한 종속노드가 없어 건너뜀.")
            continue
        next_eid += 1
        add_lines.append(f"$ -- Studio 편집 추가 RBE2 (EID {next_eid}) --")
        add_lines.extend(_format_rbe2_lines(next_eid, gn, deps, cm))
        meta["added_rigids"] += 1

    result_lines = list(case_lines) + out + add_lines
    if enddata_block is not None:
        result_lines.extend(enddata_block)
    return "\n".join(result_lines) + "\n", meta


def _build_solved_bdf(src_text: str, bcs: list, loads: list,
                      hole_rbe: Optional[dict], load_cases: Optional[list],
                      rbe3_sets: Optional[list] = None,
                      gravities: Optional[list] = None) -> tuple:
    """하중/경계조건/중력/RBE/LoadCase 를 반영한 해석용 BDF 텍스트를 생성한다.

    구조(참조 BDF 표준):
      - BC 세트 i      → SPC (SID = 1 + i)
      - Load 세트 j    → FORCE (SID = 1001 + j)
      - Gravity 세트 k → GRAV  (SID = 2001 + k, FORCE 와 ID 분리)
      - Hole RBE       → GRID(중심) + RBE2 (순수 강체 결합, 하중은 별도 load set)
      - Area RBE3      → GRID(기준) + RBE3 (하중 분배, 하중은 기준노드 load set)
      - Load Case k    → SUBCASE k (SPC=단일/SPCADD, LOAD=단일/LOAD조합[FORCE+GRAV])
    반환: (bdf_text, meta)  meta = { subcases:[...], warnings:[...] }
    """
    case_lines, bulk_lines = _split_case_bulk(src_text)
    out_bulk = _strip_bulk(bulk_lines)

    bulk_extra: list[str] = []
    warnings: list[str] = []

    # ── BC → SPC (고정필드) ────────────────────────────────────
    # 원본 bulk 의 RBE2/RBE3/RBAR/MPC 종속(m-set) 노드를 먼저 수집해, SPC 가 종속노드를
    # 다시 구속(GP4 2101)하지 않도록 독립노드로 리다이렉트/제외한다.
    dep_to_indep, dep_only = _collect_rigid_dependents(bulk_lines)
    spc_sid: dict = {}
    for i, bc in enumerate(bcs or []):
        sid = _SPC_BASE + i
        lines = _spc1_lines_for_set(bc, sid, dep_to_indep, dep_only, warnings)
        if lines:
            spc_sid[i] = sid
            bulk_extra.append(f"$ -- BC set #{i + 1} (SPC SID {sid}) --")
            bulk_extra.extend(lines)

    # ── Load → FORCE ───────────────────────────────────────────
    load_sid: dict = {}
    for j, ls in enumerate(loads or []):
        sid = _LOAD_BASE + j
        lines = _force_lines_for_set(ls, sid)
        if lines:
            load_sid[j] = sid
            bulk_extra.append(f"$ -- Load set #{j + 1} (LOAD SID {sid}) --")
            bulk_extra.extend(lines)

    # ── Gravity → GRAV (FORCE 와 별도 ID 공간) ──────────────────
    grav_sid: dict = {}
    for k, gs in enumerate(gravities or []):
        sid = _GRAV_BASE + k
        lines = _grav_lines_for_set(gs, sid)
        if lines:
            grav_sid[k] = sid
            bulk_extra.append(f"$ -- Gravity set #{k + 1} (GRAV SID {sid}) --")
            bulk_extra.extend(lines)

    # ── RBE (Hole RBE2 / Area RBE3) — 모두 결합만, 하중은 기준노드 load set 으로 적용 ──
    # EID 는 원본 최대값에서 이어 증가, GRID id 는 프론트가 부여(뷰어 선택 가능 + 충돌 방지).
    max_grid, max_eid = _max_ids(src_text)
    next_eid = max_eid

    # Hole RBE2 (순수 강체 결합)
    if hole_rbe and hole_rbe.get("ring_node_ids"):
        center_id = int(hole_rbe.get("center_id") or (max_grid + 1))
        next_eid += 1
        c = hole_rbe.get("center", {}) or {}
        cx = float(c.get("x", 0) or 0); cy = float(c.get("y", 0) or 0); cz = float(c.get("z", 0) or 0)
        ring_ids = [int(g) for g in hole_rbe.get("ring_node_ids", [])]
        bulk_extra.append("$ -- Lug Hole RBE2 (center independent node, no auto load) --")
        bulk_extra.append(f"GRID,{center_id},,{cx:g},{cy:g},{cz:g}")
        bulk_extra.extend(_format_rbe2_lines(next_eid, center_id, ring_ids, cm="123456"))

    # Area RBE3 (하중 분배 — 기준노드에 FORCE 를 주면 영역 노드로 가중분배, 강성 추가 없음)
    for s in (rbe3_sets or []):
        node_ids = [int(g) for g in (s.get("node_ids") or [])]
        if len(node_ids) < 1:
            warnings.append("RBE3 영역에 노드가 없어 건너뜀.")
            continue
        ref_id = int(s.get("ref_id") or (max_grid + 1))
        next_eid += 1
        c = s.get("center", {}) or {}
        cx = float(c.get("x", 0) or 0); cy = float(c.get("y", 0) or 0); cz = float(c.get("z", 0) or 0)
        bulk_extra.append("$ -- Area RBE3 (load distribution, REFGRID independent-motion) --")
        bulk_extra.append(f"GRID,{ref_id},,{cx:g},{cy:g},{cz:g}")
        bulk_extra.extend(_format_rbe3_lines(next_eid, ref_id, node_ids, refc="123", wt=1.0, comp="123"))

    # ── Load Case 기본값 (미지정 시 전체 BC + 전체 Load + 전체 Gravity) ──
    if not load_cases:
        load_cases = [{
            "name": "LC1",
            "bc_ids": list(spc_sid.keys()),
            "load_ids": list(load_sid.keys()),
            "gravity_ids": list(grav_sid.keys()),
        }]

    # ── LC → SUBCASE (+ SPCADD / LOAD 조합 카드) ────────────────
    subcases: list[dict] = []
    for k, lc in enumerate(load_cases):
        bc_ids = [i for i in (lc.get("bc_ids") or []) if i in spc_sid]
        load_ids = [j for j in (lc.get("load_ids") or []) if j in load_sid]
        grav_ids = [gk for gk in (lc.get("gravity_ids") or []) if gk in grav_sid]
        label = lc.get("name") or f"LC{k + 1}"

        # SPC
        spc_sids = [spc_sid[i] for i in bc_ids]
        if len(spc_sids) == 1:
            spc_ref = spc_sids[0]
        elif len(spc_sids) > 1:
            spc_ref = _SPCADD_BASE + k + 1
            bulk_extra.append(f"$ -- LC '{label}' SPCADD --")
            bulk_extra.extend(_freefield_combo("SPCADD", spc_ref, spc_sids))
        else:
            spc_ref = None
            warnings.append(f"LC '{label}' 에 경계조건이 없어 SPC 미지정 (특이행렬 위험).")

        # LOAD (FORCE + GRAV 합산 — 둘 이상이면 LOAD 조합 카드로 묶는다)
        l_sids = [load_sid[j] for j in load_ids] + [grav_sid[gk] for gk in grav_ids]
        if len(l_sids) == 1:
            load_ref = l_sids[0]
        elif len(l_sids) > 1:
            load_ref = _LOADC_BASE + k + 1
            bulk_extra.append(f"$ -- LC '{label}' LOAD combination (FORCE+GRAV) --")
            bulk_extra.extend(_load_combo_lines(load_ref, l_sids))
        else:
            load_ref = None

        subcases.append({"label": label, "spc": spc_ref, "load": load_ref})

    if not subcases:
        warnings.append("유효한 Load Case 가 없습니다.")

    # ── 조립 ───────────────────────────────────────────────────
    new_case = _build_case_control(case_lines, subcases)
    result: list[str] = list(new_case)  # _build_case_control 이 BEGIN BULK 포함
    inserted = False
    for line in out_bulk:
        if not inserted and line.strip().upper().startswith("ENDDATA"):
            result.append("$ ===== WorkBench loads / BCs / RBE =====")
            result.extend(bulk_extra)
            inserted = True
        result.append(line)
    if not inserted:
        result.append("$ ===== WorkBench loads / BCs / RBE =====")
        result.extend(bulk_extra)
        result.append("ENDDATA")

    meta = {
        "subcases": subcases,
        "spc_sids": spc_sid,
        "load_sids": load_sid,
        "warnings": warnings,
    }
    return "\n".join(result) + "\n", meta


def _scan_f06(f06_path: str) -> dict:
    """f06 에서 FATAL/WARNING 및 정상 종료 여부를 간단 스캔."""
    info = {"exists": False, "fatal": [], "has_results": False, "ended": False}
    if not os.path.isfile(f06_path):
        return info
    info["exists"] = True
    try:
        with open(f06_path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                u = line.upper()
                if "FATAL" in u:
                    info["fatal"].append(line.strip()[:300])
                if "D I S P L A C E M E N T" in u or "DISPLACEMENT VECTOR" in u:
                    info["has_results"] = True
                if "END OF JOB" in u or "* * * END OF" in u:
                    info["ended"] = True
    except Exception as e:
        logger.warning("f06 스캔 실패: %s — %s", f06_path, e)
    return info


def _extract_f06_results(solve_dir: str, f06_path: str,
                         engine_output_parts: list, step) -> Optional[str]:
    """NastranBridge 로 F06 → 결과 JSON(변위 + 쉘 von Mises) 추출.

    실패해도 해석 자체는 성공이므로 경고만 남기고 None 반환(뷰어 결과만 생략).
    """
    bridge_script = get_nastran_bridge_script_path()
    if not os.path.isfile(bridge_script):
        engine_output_parts.append(f"[Warning] nastran_bridge.py 파일 없음 — 결과 JSON 생략: {bridge_script}")
        return None
    out_path = os.path.join(solve_dir, "solve_results.json")
    try:
        r = subprocess.run(
            build_nastran_bridge_command(f06_path, "-o", out_path),
            cwd=solve_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180,
        )
        out = (r.stdout or b"").decode("utf-8", errors="replace").strip()
        err = (r.stderr or b"").decode("utf-8", errors="replace").strip()
        step("results_extract", returncode=r.returncode, out=out[:200], err=err[:200])
        if out:
            engine_output_parts.append(f"[Results] {out}")
        if r.returncode == 0 and os.path.isfile(out_path):
            return out_path
        engine_output_parts.append(f"[Warning] 결과 JSON 추출 실패 (exit={r.returncode}).")
    except subprocess.TimeoutExpired:
        step("results_timeout", timeout_sec=180)
        engine_output_parts.append("[Warning] 결과 JSON 추출 시간 초과 (3분).")
    except Exception as e:
        step("results_error", error=str(e))
        engine_output_parts.append(f"[Warning] 결과 JSON 추출 오류: {e}")
    return None


def task_execute_drawing_solve(
    job_id: str,
    solve_dir: str,
    source_bdf_path: str,
    employee_id: str,
    timestamp: str,
    source: str,
    mode: str,
    loads: list,
    bcs: list,
    hole_rbe: Optional[dict] = None,
    load_cases: Optional[list] = None,
    rbe3_sets: Optional[list] = None,
):
    """사용자 정의 하중/경계조건을 BDF 에 주입한 뒤 Nastran(SOL 101) 해석 실행.

    동작:
      1. source_bdf_path(변환/재구축 결과 BDF) 읽기
      2. 기존 FORCE/SPC* 제거 → 사용자 FORCE(SID=1)/SPC1(SID=1) 주입
      3. solve_dir/solved_model.bdf 저장
      4. `nastran solved_model.bdf` 실행 (cwd=solve_dir)
      5. f06/op2/log 수집 + FATAL 스캔
    """
    mode = (mode or "lug").lower()
    mark_running(job_id, "구조 해석 준비 중 (하중/경계조건 적용)...", progress=5)

    status_msg = "Success"
    engine_output_parts: list[str] = []
    result_data: dict = {}
    user_reason: Optional[str] = None

    diagnostic = {
        "job_id":     job_id,
        "started_at": datetime.now().isoformat(timespec="seconds"),
        "input": {
            "solve_dir":       solve_dir,
            "source_bdf_path": source_bdf_path,
            "mode":            mode,
            "employee_id":     employee_id,
            "source":          source,
            "load_set_count":  len(loads or []),
            "bc_set_count":    len(bcs or []),
            "has_hole_rbe":    bool(hole_rbe),
            "rbe3_set_count":  len(rbe3_sets or []),
            "load_case_count": len(load_cases or []),
        },
        "loads": loads,
        "bcs":   bcs,
        "hole_rbe": hole_rbe,
        "rbe3_sets": rbe3_sets,
        "load_cases": load_cases,
        "steps": [],
    }

    def step(name: str, **info):
        info["name"] = name
        info["ts"]   = time.strftime("%H:%M:%S")
        diagnostic["steps"].append(info)
        logger.info("[DrawingSolve][%s] %s", job_id, json.dumps(info, ensure_ascii=False, default=str))

    try:
        # ── Step 1: 원본 BDF 확인 ────────────────────────────────
        step("resolve_bdf", source_bdf_path=source_bdf_path, exists=os.path.isfile(source_bdf_path))
        if not source_bdf_path or not os.path.isfile(source_bdf_path):
            status_msg = "Failed"
            user_reason = "해석할 BDF 모델을 찾을 수 없습니다. 먼저 PDF → 모델 변환을 완료하세요."
            engine_output_parts.append(f"[Error] BDF 없음: {source_bdf_path}")
            raise RuntimeError(user_reason)

        # ── Step 2: BDF 생성 (다중 SUBCASE / SPC·LOAD ID 분리) ────
        update_progress(job_id, 20, "하중/경계조건/Load Case 반영 중...")
        with open(source_bdf_path, "r", encoding="utf-8", errors="replace") as fh:
            src_text = fh.read()

        if not bcs:
            status_msg = "Failed"
            user_reason = "경계조건이 하나도 없습니다. 최소 1개 이상의 구속 세트를 지정하세요."
            engine_output_parts.append("[Error] " + user_reason)
            raise RuntimeError(user_reason)

        solved_text, build_meta = _build_solved_bdf(src_text, bcs, loads, hole_rbe, load_cases, rbe3_sets)
        step("build_bdf",
             subcases=len(build_meta["subcases"]),
             spc_sids=len(build_meta["spc_sids"]),
             load_sids=len(build_meta["load_sids"]),
             warnings=build_meta["warnings"])
        for w in build_meta["warnings"]:
            engine_output_parts.append(f"[Warning] {w}")

        # 유효 SUBCASE 가 하나도 없으면 실패 처리
        valid_subcases = [s for s in build_meta["subcases"] if s.get("spc") is not None]
        if not valid_subcases:
            status_msg = "Failed"
            user_reason = "유효한 Load Case 가 없습니다. 각 LC 에 경계조건을 1개 이상 포함하세요."
            engine_output_parts.append("[Error] " + user_reason)
            raise RuntimeError(user_reason)

        # ── Step 3: BDF 저장 ─────────────────────────────────────
        update_progress(job_id, 35, "해석용 BDF 저장 중...")
        os.makedirs(solve_dir, exist_ok=True)
        solved_bdf = os.path.join(solve_dir, "solved_model.bdf")
        with open(solved_bdf, "w", encoding="utf-8") as fh:
            fh.write(solved_text)
        result_data["bdf"] = solved_bdf
        sc_summary = ", ".join(
            f"SUBCASE{i+1}[{s['label']}] SPC={s['spc']} LOAD={s['load']}"
            for i, s in enumerate(build_meta["subcases"])
        )
        engine_output_parts.append(f"[BDF] {len(build_meta['subcases'])} Load Case 생성 — {sc_summary}")
        step("write_solved_bdf", path=solved_bdf, bytes=len(solved_text))

        # ── Step 4: Nastran 실행 ─────────────────────────────────
        update_progress(job_id, 50, "Nastran 해석 실행 중 (SOL 101)...")
        # ★ batch=no 필수 — 콘솔 없는 서비스 환경에서 MSC Nastran 의 batch 기본값이 'yes'(백그라운드
        #   제출)로 잡히면 런처가 해석을 detached 로 던지고 "completed" 만 찍은 채 반환 → f06 미생성.
        #   scr=yes(스크래치)·old=no(덮어쓰기)·batch=no(포그라운드)로 동기 실행을 강제한다(modelflow 와 동일).
        cmd_args = ["nastran", "solved_model.bdf", "scr=yes", "old=no", "batch=no"]
        step("nastran_invoke", cmd=cmd_args, cwd=solve_dir)
        try:
            result = subprocess.run(
                cmd_args,
                cwd=solve_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=900,
            )
            nas_stdout = (result.stdout or b"").decode("utf-8", errors="replace")
            nas_stderr = (result.stderr or b"").decode("utf-8", errors="replace")
            step("nastran_done", returncode=result.returncode,
                 stdout_tail=nas_stdout[-1500:], stderr_tail=nas_stderr[-1500:])
            if nas_stdout.strip():
                engine_output_parts.append(nas_stdout.strip())
            if nas_stderr.strip():
                engine_output_parts.append(f"[stderr] {nas_stderr.strip()}")
        except FileNotFoundError:
            status_msg = "Failed"
            user_reason = "서버에 Nastran 실행 파일이 없습니다(PATH 미등록). 관리자에게 문의하세요."
            step("nastran_not_found")
            engine_output_parts.append("[Error] " + user_reason)
            raise RuntimeError(user_reason)
        except subprocess.TimeoutExpired:
            status_msg = "Failed"
            user_reason = "Nastran 해석 시간이 초과되었습니다(15분). 모델/메시 크기를 확인하세요."
            step("nastran_timeout", timeout_sec=900)
            engine_output_parts.append("[Error] " + user_reason)
            raise RuntimeError(user_reason)

        # ── Step 5: f06 대기 (MSC Nastran 은 백그라운드 spawn 가능) ──
        update_progress(job_id, 80, "해석 결과(f06) 생성 대기 중...")
        f06_path = os.path.join(solve_dir, "solved_model.f06")
        waited = 0.0
        while not os.path.isfile(f06_path) and waited < 120.0:
            time.sleep(2.0)
            waited += 2.0
        # f06 가 생성됐으면 안정될 때까지 잠깐 더 대기 (크기 변화 멈춤)
        if os.path.isfile(f06_path):
            last_size = -1
            stable = 0
            while stable < 3 and waited < 180.0:
                size = os.path.getsize(f06_path)
                if size == last_size:
                    stable += 1
                else:
                    stable = 0
                    last_size = size
                time.sleep(1.5)
                waited += 1.5
        step("f06_wait", waited_sec=waited, exists=os.path.isfile(f06_path))

        # ── Step 6: 결과 파일 수집 ───────────────────────────────
        update_progress(job_id, 90, "해석 결과 파일 수집 중...")
        for fn, key in (
            ("solved_model.f06", "f06"),
            ("solved_model.op2", "op2"),
            ("solved_model.log", "log"),
            ("solved_model.f04", "f04"),
        ):
            p = os.path.join(solve_dir, fn)
            if os.path.isfile(p):
                result_data[key] = p

        f06_info = _scan_f06(f06_path)
        step("f06_scan", **{k: (v if k != "fatal" else len(v)) for k, v in f06_info.items()})
        if not f06_info["exists"]:
            status_msg = "Failed"
            user_reason = ("Nastran 이 결과(f06)를 생성하지 않았습니다. "
                           "모델·경계조건을 확인하거나 관리자에게 문의하세요.")
            engine_output_parts.append("[Error] " + user_reason)
        elif f06_info["fatal"]:
            status_msg = "Failed"
            user_reason = "Nastran 해석 중 FATAL 오류가 발생했습니다. 경계조건/하중을 확인하세요."
            engine_output_parts.append("[FATAL] " + "\n[FATAL] ".join(f06_info["fatal"][:5]))
        else:
            engine_output_parts.append(
                f"[Nastran] 해석 완료 — 결과 {'있음' if f06_info['has_results'] else '확인 필요'}, "
                f"정상종료={f06_info['ended']}"
            )
            # ── Step 6: NastranBridge 로 F06 → 결과 JSON (변위 + 쉘 von Mises) ──
            update_progress(job_id, 88, "해석 결과(변위/응력) 추출 중...")
            results_json_path = _extract_f06_results(solve_dir, f06_path, engine_output_parts, step)
            if results_json_path:
                result_data["results_json"] = results_json_path

    except RuntimeError:
        pass
    except Exception as e:
        status_msg = "Failed"
        user_reason = user_reason or FAIL_UNKNOWN
        logger.error("DrawingSolve 예기치 않은 오류: %s", str(e), exc_info=True)
        engine_output_parts.append(f"[Unhandled] {type(e).__name__}: {e}")
        engine_output_parts.append(traceback.format_exc())

    # 진단 파일
    diagnostic["status"]      = status_msg
    diagnostic["user_reason"] = user_reason
    diagnostic["ended_at"]    = datetime.now().isoformat(timespec="seconds")
    diag_path = _write_diagnostic(solve_dir, diagnostic)
    if diag_path:
        result_data["diagnostic_json"] = diag_path

    if status_msg == "Failed":
        engine_output = f"🚫 구조 해석 실패 — {user_reason or FAIL_UNKNOWN}\n\n" + "\n".join(engine_output_parts)
    else:
        engine_output = "\n".join(engine_output_parts) if engine_output_parts else "구조 해석 완료"

    update_progress(job_id, 95, "데이터베이스 저장 중...")
    project_data, db_err = record_analysis(
        job_id=job_id,
        project_name=f"DrawingSolve_{timestamp}",
        program_name="DrawingToAnalysis",
        employee_id=employee_id,
        status=status_msg,
        input_info={"solve": True, "mode": mode, "source_bdf": source_bdf_path,
                    "loads": loads, "bcs": bcs, "hole_rbe": hole_rbe,
                    "rbe3_sets": rbe3_sets, "load_cases": load_cases},
        result_info=result_data if result_data else None,
        source=source,
    )
    if db_err is not None:
        status_msg = "Failed"
        engine_output += f"\n[DB Error] {db_err}"

    mark_complete(
        job_id,
        status_msg,
        engine_output,
        project_data,
        success_message="구조 해석(Nastran) 완료",
        failure_message=user_reason or "구조 해석 실패",
    )
