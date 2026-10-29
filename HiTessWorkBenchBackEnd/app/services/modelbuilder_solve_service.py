"""ModelBuilder Analysis 구조 해석 서비스 — Stage 1 MVP.

ModelFlow 빌드 산출 BDF 에 사용자 정의 경계조건(SPC1)/하중(FORCE)/Load Case(SUBCASE)
를 주입한 뒤 Nastran(SOL 101) 해석을 실행하고, F06 → 결과 JSON(변위 + von Mises)
을 추출한다.

설계 원칙:
  - drawing_to_analysis_service 의 BDF 카드 헬퍼/스캔/추출 함수를 그대로 import 해
    동일한 BDF 변환·해석 파이프라인을 재사용한다 (코드 중복 금지).
  - SPC + FORCE + GRAV(중력) + SUBCASE 를 다룬다.
  - 결과 JSON shape 은 drawing/plate 와 동일하다 (nastran_bridge convert_f06):
        analysisResults.subcases[].{
            displacements:[{nodeId,t1,t2,t3,...}],
            quadStresses/triaStresses/cbeamStresses:[{elementId,vonMises}]
        }
"""
import json
import logging
import os
import re
import shutil
import subprocess
import time
import traceback
from datetime import datetime
from typing import Optional

from .analysis_runner import (
    CANCELLED_MESSAGE,
    JobCancelledError,
    is_cancel_requested,
    mark_complete,
    mark_running,
    record_analysis,
    update_progress,
)
# drawing 서비스의 BDF 카드 헬퍼/스캔/추출/진단 함수를 재사용 (모두 모듈 레벨, 그대로 import).
from .drawing_to_analysis_service import (
    FAIL_UNKNOWN,
    _apply_model_edits_to_bdf,
    _build_solved_bdf,
    _extract_f06_results,
    _scan_f06,
    _write_diagnostic,
)

logger = logging.getLogger(__name__)

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_CMB_EXE = os.path.join(_BACKEND_DIR, "InHouseProgram", "HiTessModeBuilder", "Cmb.Cli.exe")
_SAFE_BASE_NAME = re.compile(r"^[^\\/:*?\"<>|]+$")


def _grid_ids(bdf_text: str) -> set:
    """BDF 의 GRID id 집합(고정·자유 필드 모두)."""
    ids = set()
    for line in bdf_text.splitlines():
        head = line[:8].strip().upper().rstrip("*")
        if line.upper().startswith("GRID,"):
            parts = line.split(",")
            token = parts[1] if len(parts) > 1 else ""
        elif head == "GRID":
            token = line[8:16] if not line[:8].rstrip().endswith("*") else line[8:24]
        else:
            continue
        try:
            ids.add(int(token.strip()))
        except ValueError:
            pass
    return ids


def build_edited_source_bdf(source_bdf_path: str, solve_dir: str, edits: dict, job_id: Optional[str] = None):
    """Studio 편집 intent 전체를 '편집 적용(finalize)' 과 같은 경로로 적용한 BDF 텍스트를 만든다.

    edits = { intent_document: serializeIntents 결과, base_name: 마지막 단계 파일명(확장자 없음) }.
    work_dir(빌드 산출 폴더)의 <base>.json/.bdf 를 solve_dir/edit_apply/ 로 복사하고 <base>_edit.json 을
    써서 hitess_modelflow_service.apply_edit_intents(C# 엔진, 2026-10-29 bridge fallback 제거)로 편집 BDF 를 만든다.
    예전 경로(삭제·RBE 추가만 BDF 텍스트에 직접 반영)는 노드 추가·회전·유체 비움을 빠뜨려
    Studio 화면과 다른 모델로 해석됐다(2026-10-02 정합성 검토).

    반환: (편집 BDF 텍스트, 로그). 실패하면 RuntimeError(사용자에게 보일 사유).
    """
    from .hitess_modelflow_service import apply_edit_intents  # 순환 import 회피

    doc = edits.get("intent_document")
    base_name = (edits.get("base_name") or "").strip()
    if not isinstance(doc, dict) or not doc.get("intents"):
        raise RuntimeError("편집 의도 문서가 비어 있습니다.")
    if not base_name or not _SAFE_BASE_NAME.match(base_name) or base_name in (".", ".."):
        raise RuntimeError(f"편집 대상 단계 파일명이 올바르지 않습니다: {base_name!r}")
    work_dir = os.path.dirname(os.path.abspath(source_bdf_path))
    base_json = os.path.join(work_dir, base_name + ".json")
    if not os.path.isfile(base_json):
        raise RuntimeError(f"편집 대상 단계 파일을 서버에서 찾을 수 없습니다: {base_name}.json")

    apply_dir = os.path.join(solve_dir, "edit_apply")
    os.makedirs(apply_dir, exist_ok=True)
    shutil.copy2(base_json, os.path.join(apply_dir, base_name + ".json"))
    base_bdf = os.path.join(work_dir, base_name + ".bdf")
    if os.path.isfile(base_bdf):
        shutil.copy2(base_bdf, os.path.join(apply_dir, base_name + ".bdf"))
    edit_json = os.path.join(apply_dir, base_name + "_edit.json")
    with open(edit_json, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)

    status, log, edited = apply_edit_intents(apply_dir, _CMB_EXE, edit_json, job_id=job_id)
    bdf = edited.get("edited_bdf_path")
    if status != "Success" or not bdf or not os.path.isfile(bdf):
        tail = "\n".join(log.strip().splitlines()[-6:])
        raise RuntimeError(f"Studio 편집을 모델에 적용하지 못했습니다. {tail}".strip())
    with open(bdf, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read(), log


def task_execute_modelbuilder_solve(
    job_id: str,
    solve_dir: str,
    source_bdf_path: str,
    employee_id: str,
    timestamp: str,
    source: str,
    loads: list,
    bcs: list,
    load_cases: Optional[list] = None,
    gravities: Optional[list] = None,
    edits: Optional[dict] = None,
):
    """ModelFlow 빌드 BDF 에 사용자 SPC/FORCE/GRAV/SUBCASE 를 주입 후 Nastran 해석.

    동작:
      1. source_bdf_path(ModelFlow 최종 BDF) 읽기
      2-0. (선택) Studio 모델 편집(그룹/노드/요소 삭제, RBE 삭제/추가)을 BDF 에 직접 반영
           → 편집된 모델 상태에서 해석되도록 한다(edits).
      2. 기존 FORCE/SPC* 제거 → 사용자 FORCE/SPC1 주입 + 다중 SUBCASE Case Control
         (load_cases 의 bc_ids/load_ids 는 bcs/loads 의 0-base 인덱스)
      3. solve_dir/solved_model.bdf 저장
      4. `nastran solved_model.bdf` 실행 (cwd=solve_dir)
      5. f06/op2/log 수집 + FATAL 스캔
      6. nastran_bridge 로 F06 → 결과 JSON(변위 + von Mises) 추출
      7. record_analysis(program_name="ModelBuilderAnalysis")

    SPC + FORCE + GRAV(중력) + 모델 편집(삭제/추가) + 다중 SUBCASE 지원.
    """
    mark_running(job_id, "ModelBuilder 구조 해석 준비 중 (하중/경계조건 적용)...", progress=5)

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
            "employee_id":     employee_id,
            "source":          source,
            "load_set_count":  len(loads or []),
            "bc_set_count":    len(bcs or []),
            "grav_set_count":  len(gravities or []),
            "load_case_count": len(load_cases or []),
            "edit_del_node_count":    len((edits or {}).get("deleted_node_ids") or []),
            "edit_del_element_count": len((edits or {}).get("deleted_element_ids") or []),
            "edit_removed_rigid_count": len((edits or {}).get("removed_rigid_ids") or []),
            "edit_added_rigid_count": len((edits or {}).get("added_rigids") or []),
            "stage":           2,
        },
        "loads":      loads,
        "bcs":        bcs,
        "gravities":  gravities,
        "load_cases": load_cases,
        "edits":      edits,
        "steps": [],
    }

    def step(name: str, **info):
        info["name"] = name
        info["ts"]   = time.strftime("%H:%M:%S")
        diagnostic["steps"].append(info)
        logger.info("[ModelBuilderSolve][%s] %s", job_id, json.dumps(info, ensure_ascii=False, default=str))

    try:
        # ── Step 1: 원본 BDF 확인 ────────────────────────────────
        step("resolve_bdf", source_bdf_path=source_bdf_path, exists=os.path.isfile(source_bdf_path))
        if not source_bdf_path or not os.path.isfile(source_bdf_path):
            status_msg = "Failed"
            user_reason = "해석할 BDF 모델을 찾을 수 없습니다. 먼저 ModelFlow 빌드를 완료하세요."
            engine_output_parts.append(f"[Error] BDF 없음: {source_bdf_path}")
            raise RuntimeError(user_reason)

        # ── Step 2: BDF 생성 (SPC1 + FORCE + 다중 SUBCASE) ───────
        update_progress(job_id, 20, "하중/경계조건/Load Case 반영 중...")
        with open(source_bdf_path, "r", encoding="utf-8", errors="replace") as fh:
            src_text = fh.read()

        # ── Step 2-0: Studio 모델 편집(그룹/노드/요소 삭제, RBE 삭제/추가) 반영 ──
        # model-studio 가 보낸 edits(실제 Nastran ID 로 해소된 삭제/추가 목록)를 BDF 텍스트에
        # 직접 적용해, "편집된 모델 상태" 의 BDF 로 해석되게 한다(원본 그대로가 아닌 변경 반영).
        ed = edits or {}
        ed_nodes   = ed.get("deleted_node_ids") or []
        ed_elems   = ed.get("deleted_element_ids") or []
        ed_rigids  = ed.get("removed_rigid_ids") or []
        # 무게중심 RBE(독립노드 = 엔진이 새로 만듦)는 예전 경로로 표현할 수 없다 — intent 경로에서만 반영된다.
        ed_added   = [a for a in (ed.get("added_rigids") or []) if a.get("independent_node") is not None]
        if ed.get("intent_document"):
            # ── 새 경로: intent 전체를 편집 적용(finalize)과 같은 엔진으로 적용 ──
            update_progress(job_id, 15, "Studio 편집 적용 중 (편집 적용과 같은 엔진)...")
            try:
                src_text, apply_log = build_edited_source_bdf(source_bdf_path, solve_dir, ed, job_id)
            except RuntimeError as apply_error:
                status_msg = "Failed"
                user_reason = str(apply_error)
                engine_output_parts.append("[Error] " + user_reason)
                raise
            step("apply_edit_intents", intents=len(ed["intent_document"].get("intents") or []))
            engine_output_parts.append(apply_log.strip())
            # 편집 모델에 없는 노드(삭제됨)를 가리키는 경계조건·하중 노드는 뺀다(세트 인덱스는 유지).
            alive = _grid_ids(src_text)
            pruned = 0
            for coll in (bcs or [], loads or []):
                for item in coll:
                    if not isinstance(item, dict):
                        continue
                    orig = item.get("nodes") or []
                    kept = [x for x in orig if int(x) in alive]
                    if len(kept) != len(orig):
                        pruned += len(orig) - len(kept)
                        item["nodes"] = kept
            if pruned:
                engine_output_parts.append(
                    f"[Warning] 편집 모델에 없는 노드를 참조하던 경계조건/하중 노드 {pruned}개를 제외했습니다."
                )
        elif ed_nodes or ed_elems or ed_rigids or ed_added:
            update_progress(job_id, 18, "모델 편집(그룹/요소 삭제) 반영 중...")
            src_text, edit_meta = _apply_model_edits_to_bdf(
                src_text, ed_nodes, ed_elems, ed_rigids, ed_added,
            )
            step("apply_edits", **edit_meta)
            engine_output_parts.append(
                f"[Edit] 모델 편집 반영 — GRID 제거 {edit_meta['removed_grids']}, "
                f"요소 제거 {edit_meta['removed_elems']}, RBE 제거 {edit_meta['removed_rigids']}/"
                f"트림 {edit_meta['trimmed_rigids']}, 질량 제거 {edit_meta['removed_masses']}, "
                f"RBE 추가 {edit_meta['added_rigids']}"
            )
            for w in edit_meta.get("warnings", []):
                engine_output_parts.append(f"[Warning] {w}")
            # 삭제된 노드를 참조하던 BC(SPC)/Force 선택은 dangling 방지를 위해 제거(세트 인덱스는 유지).
            del_node_set = {int(x) for x in ed_nodes}
            pruned = 0
            for coll in (bcs or [], loads or []):
                for item in coll:
                    if not isinstance(item, dict):
                        continue
                    orig = item.get("nodes") or []
                    kept = [x for x in orig if int(x) not in del_node_set]
                    if len(kept) != len(orig):
                        pruned += len(orig) - len(kept)
                        item["nodes"] = kept
            if pruned:
                engine_output_parts.append(
                    f"[Warning] 삭제된 노드를 참조하던 경계조건/하중 노드 {pruned}개를 제외했습니다."
                )

        if not any((b.get("nodes") if isinstance(b, dict) else None) for b in (bcs or [])):
            status_msg = "Failed"
            user_reason = "경계조건이 하나도 없습니다. 최소 1개 이상의 구속 세트를 지정하세요."
            engine_output_parts.append("[Error] " + user_reason)
            raise RuntimeError(user_reason)

        # hole_rbe / rbe3_sets 미사용(None). GRAV(중력)은 gravities 로 반영.
        solved_text, build_meta = _build_solved_bdf(
            src_text, bcs, loads,
            hole_rbe=None, load_cases=load_cases, rbe3_sets=None,
            gravities=gravities,
        )
        step("build_bdf",
             subcases=len(build_meta["subcases"]),
             spc_sids=len(build_meta["spc_sids"]),
             load_sids=len(build_meta["load_sids"]),
             warnings=build_meta["warnings"])
        for w in build_meta["warnings"]:
            engine_output_parts.append(f"[Warning] {w}")

        # 유효 SUBCASE(경계조건 포함)가 하나도 없으면 실패 처리
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
        # ★ batch=no 필수 — 백엔드가 콘솔 없는 환경(서비스/detached)으로 기동되면 MSC Nastran 의
        #   batch 기본값이 RC 파일/실행환경에 따라 'yes'(백그라운드 제출)로 잡힐 수 있다. 그러면
        #   런처가 해석을 detached 로 던지고 "completed" 만 찍은 채 즉시 반환 → f06 이 안 생겨
        #   "실행중"에서 멈춘 것처럼 보인다. scr=yes(스크래치)·old=no(덮어쓰기)와 함께 batch=no 로
        #   포그라운드 실행을 강제한다(검증된 modelflow 경로와 동일).
        cmd_args = ["nastran", "solved_model.bdf", "scr=yes", "old=no", "batch=no"]
        step("nastran_invoke", cmd=cmd_args, cwd=solve_dir)
        # 사용자가 이미 취소를 요청했으면 해석기를 띄우지 않는다.
        # (subprocess.run 은 블로킹이라 중도 중단이 불가능해 '띄우기 전'이 유일한 차단점이다.)
        # ⚠ 이 함수의 except RuntimeError 는 status_msg 를 건드리지 않고 pass 하므로,
        #   이 파일의 다른 실패 분기와 똑같이 raise 전에 status_msg/user_reason 을 먼저 확정한다.
        if is_cancel_requested(job_id):
            status_msg = "Failed"
            user_reason = CANCELLED_MESSAGE
            step("cancel_requested")
            engine_output_parts.append("[Cancelled] " + CANCELLED_MESSAGE)
            raise JobCancelledError(CANCELLED_MESSAGE)
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
            # ── F06 → 결과 JSON (변위 + 쉘 von Mises) ──
            update_progress(job_id, 88, "해석 결과(변위/응력) 추출 중...")
            results_json_path = _extract_f06_results(solve_dir, f06_path, engine_output_parts, step)
            if results_json_path:
                # ⚠️ Studio(Electron) 호스트(viewer:runModelBuilderSolve)는 결과 JSON 을
                #    result_info["nastranResultJson"] 키로만 회수한다(unit_structural/mooring 과 동일 계약).
                #    여기서 "results_json" 키로 두면 호스트가 경로를 못 찾아 result=null →
                #    뷰어 결과 테이블(AnalysisResultDock)이 아예 안 뜬다. 반드시 nastranResultJson 사용.
                result_data["nastranResultJson"] = results_json_path

    except RuntimeError:
        pass
    except Exception as e:
        status_msg = "Failed"
        user_reason = user_reason or FAIL_UNKNOWN
        logger.error("ModelBuilderSolve 예기치 않은 오류: %s", str(e), exc_info=True)
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
        project_name=f"ModelBuilderSolve_{timestamp}",
        program_name="ModelBuilderAnalysis",
        employee_id=employee_id,
        status=status_msg,
        input_info={"solve": True, "source_bdf": source_bdf_path,
                    "loads": loads, "bcs": bcs, "gravities": gravities,
                    "load_cases": load_cases, "edits": edits},
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
        success_message="ModelBuilder 구조 해석(Nastran) 완료",
        failure_message=user_reason or "ModelBuilder 구조 해석 실패",
    )
