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
    get_backend_dir,
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
            bridge_exe = os.path.join(
                get_backend_dir(), "InHouseProgram", "NastranBridge", "nastran_bridge.exe"
            )
            if not os.path.isfile(bridge_exe):
                step("bridge_missing", path=bridge_exe)
                engine_output_parts.append(
                    f"[Warning] NastranBridge 실행 파일을 찾을 수 없어 모델 뷰어 JSON 생성을 건너뜁니다: {bridge_exe}"
                )
            else:
                bdf_p = result_data["bdf"]
                bridge_stem = "support_model" if mode == "support" else "lug_model"
                bridge_json_path = os.path.join(work_dir, f"{bridge_stem}_bridge.json")
                try:
                    bridge_result = subprocess.run(
                        [bridge_exe, bdf_p, "-o", bridge_json_path],
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
        if not os.path.isfile(resolved_exe):
            status_msg = "Failed"
            user_reason = FAIL_EXE_MISSING
            engine_output_parts.append(f"[Error] {user_reason}")
            raise RuntimeError(user_reason)

        if mode == "lug":
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
            bridge_exe = os.path.join(
                get_backend_dir(), "InHouseProgram", "NastranBridge", "nastran_bridge.exe"
            )
            if os.path.isfile(bridge_exe):
                bdf_p = result_data["bdf"]
                bridge_stem = "support_model" if mode == "support" else "lug_model"
                bridge_json_path = os.path.join(work_dir, f"{bridge_stem}_bridge.json")
                try:
                    bridge_result = subprocess.run(
                        [bridge_exe, bdf_p, "-o", bridge_json_path],
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
