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


def _force_lines_for_set(ls: dict, sid: int) -> list:
    """하중 세트 1개 → 지정 SID 의 FORCE 카드 라인들.

    FORCE,SID,G,CID,F,N1,N2,N3 — F=1.0, (N1,N2,N3)=(fx,fy,fz) 벡터 그대로 적용.
    """
    try:
        fx = float(ls.get("fx", 0) or 0)
        fy = float(ls.get("fy", 0) or 0)
        fz = float(ls.get("fz", 0) or 0)
    except (TypeError, ValueError):
        return []
    if fx == 0 and fy == 0 and fz == 0:
        return []
    lines: list[str] = []
    for nid in ls.get("nodes", []) or []:
        try:
            g = int(nid)
        except (TypeError, ValueError):
            continue
        lines.append(f"FORCE,{sid},{g},,1.0,{fx:g},{fy:g},{fz:g}")
    return lines


def _spc1_lines_for_set(bc: dict, sid: int, chunk: int = 6) -> list:
    """경계조건 세트 1개 → 지정 SID 의 SPC1 카드 라인들."""
    dof = str(bc.get("dof", "123456")).strip() or "123456"
    nodes: list[int] = []
    for nid in bc.get("nodes", []) or []:
        try:
            nodes.append(int(nid))
        except (TypeError, ValueError):
            continue
    seen = set()
    nodes = [n for n in nodes if not (n in seen or seen.add(n))]
    lines: list[str] = []
    for i in range(0, len(nodes), chunk):
        grp = nodes[i:i + chunk]
        lines.append(f"SPC1,{sid},{dof}," + ",".join(str(n) for n in grp))
    return lines


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
_SPCADD_BASE   = 9000   # LC 별 SPCADD 조합 SID (BC 2개 이상일 때)
_LOADC_BASE    = 9100   # LC 별 LOAD 조합 SID (하중 2개 이상일 때)


def _build_solved_bdf(src_text: str, bcs: list, loads: list,
                      hole_rbe: Optional[dict], load_cases: Optional[list],
                      rbe3_sets: Optional[list] = None) -> tuple:
    """하중/경계조건/RBE/LoadCase 를 반영한 해석용 BDF 텍스트를 생성한다.

    구조(참조 BDF 표준):
      - BC 세트 i      → SPC1 (SID = 1 + i)
      - Load 세트 j    → FORCE (SID = 1001 + j)
      - Hole RBE       → GRID(중심) + RBE2 (순수 강체 결합, 하중은 별도 load set)
      - Area RBE3      → GRID(기준) + RBE3 (하중 분배, 하중은 기준노드 load set)
      - Load Case k    → SUBCASE k (SPC=단일 또는 SPCADD, LOAD=단일 또는 LOAD조합)
    반환: (bdf_text, meta)  meta = { subcases:[...], warnings:[...] }
    """
    case_lines, bulk_lines = _split_case_bulk(src_text)
    out_bulk = _strip_bulk(bulk_lines)

    bulk_extra: list[str] = []
    warnings: list[str] = []

    # ── BC → SPC1 ──────────────────────────────────────────────
    spc_sid: dict = {}
    for i, bc in enumerate(bcs or []):
        sid = _SPC_BASE + i
        lines = _spc1_lines_for_set(bc, sid)
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

    # ── Load Case 기본값 (미지정 시 전체 BC + 전체 Load) ──
    if not load_cases:
        load_cases = [{
            "name": "LC1",
            "bc_ids": list(spc_sid.keys()),
            "load_ids": list(load_sid.keys()),
        }]

    # ── LC → SUBCASE (+ SPCADD / LOAD 조합 카드) ────────────────
    subcases: list[dict] = []
    for k, lc in enumerate(load_cases):
        bc_ids = [i for i in (lc.get("bc_ids") or []) if i in spc_sid]
        load_ids = [j for j in (lc.get("load_ids") or []) if j in load_sid]
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

        # LOAD
        l_sids = [load_sid[j] for j in load_ids]
        if len(l_sids) == 1:
            load_ref = l_sids[0]
        elif len(l_sids) > 1:
            load_ref = _LOADC_BASE + k + 1
            bulk_extra.append(f"$ -- LC '{label}' LOAD combination --")
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
    bridge_exe = os.path.join(
        get_backend_dir(), "InHouseProgram", "NastranBridge", "nastran_bridge.exe"
    )
    if not os.path.isfile(bridge_exe):
        engine_output_parts.append(f"[Warning] NastranBridge 실행 파일 없음 — 결과 JSON 생략: {bridge_exe}")
        return None
    out_path = os.path.join(solve_dir, "solve_results.json")
    try:
        r = subprocess.run(
            [bridge_exe, f06_path, "-o", out_path],
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
        # 사용자 지정: cmd `nastran <파일>.bdf` 직접 실행 (PATH 등록됨).
        # MSC Nastran 은 batch 로 즉시 반환할 수 있어 이후 f06 생성 폴링으로 완료를 대기한다.
        cmd_args = ["nastran", "solved_model.bdf"]
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
