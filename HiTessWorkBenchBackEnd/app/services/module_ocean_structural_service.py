"""Module Unit 해상 운송 구조 해석 — 3단계 오케스트레이션.

한 job 에서 **합본 모델 한 번**을 푼다.
  정반(실형상) + Module Unit 을 지지점 RBE2 로 이어 붙이고, 경계조건은 정반이 원래
  갖고 있던 Leg SPC 뿐이다. 하중은 GRAV 하나로 정반 자중까지 함께 실린다.
    · 부재 응력 평가는 **Module Unit 만** (정반은 평가 대상이 아니다)
    · Leg 반력은 **정반 Leg 절점의 SPC 반력** → 용접부 평가

BDF 조립은 module_ocean_bdf/module_ocean_merge(순수), 결과 해석은 module_ocean_results(순수) 에 있다.
여기서는 파일 입출력·Nastran 실행·job/DB 만 다룬다 — 그래야 조립·해석 로직을
Nastran 없이 테스트로 고정할 수 있다.

F06 파싱은 InHouseProgram 의 nastran_bridge CLI 를 **무변경** 재사용한다.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

from .analysis_runner import (
    CANCELLED_MESSAGE,
    JobCancelledError,
    build_nastran_bridge_command,
    is_cancel_requested,
    mark_complete,
    mark_running,
    record_analysis,
    run_subprocess_killtree,
    update_progress,
)
from ._subproc_decode import safe_decode
from .module_ocean_bdf import (
    DEFAULT_SMALL_BORE_MAX_OD_MM,
    element_node_map,
    extract_bulk_lines,
    small_bore_element_ids,
)
from .module_ocean_merge import DEFAULT_CLEARANCE_MM, build_combined_bdf
from .module_ocean_results import (
    assess_singularity_impact,
    envelope_displacement,
    envelope_leg_reactions,
    envelope_stress,
    envelope_weld,
    evaluate_stress,
    extract_displacements,
    extract_leg_reactions,
    f06_fatal_messages,
    scan_f06_quality,
)
from .module_ocean_transport_service import get_jungban_leg_nodes, jungban_bdf_path
from .module_ocean_weld import evaluate_weld

logger = logging.getLogger(__name__)

# 1단계 검증과 **같은 이름** 을 쓴다. 이 앱의 작업은 한 폴더
# (userConnection/{timestamp}_{사번}_ModuleOceanMoving/)에서 이어지므로,
# 기록만 다른 이름으로 남기면 My Project 에서 한 앱의 작업이 둘로 갈라져 보인다.
PROGRAM_NAME = "ModuleOceanMoving"
MATERIAL_NAME = "SS275"

# ★ 이 해석이 **무엇을 판정하고 무엇을 판정하지 않는가**. 화면 첫 줄과 결과 파일이
#   같은 문구를 쓰도록 서버에 한 벌만 둔다.
#
#   왜 코드에 박는가 — 화면은 큰 글씨로 OK/NG 를 띄우는데 그 OK 의 범위는 지금까지
#   코드에만 있었다. 특히 소구경 배관은 판정에서 빠지는데 실측(3521)에서 그 배관
#   32개가 허용의 2배(437.9 MPa)였다. "무엇을 안 봤는지"가 판정 옆에 없으면
#   프로그램은 맞는 말을 했는데 사람이 틀리게 읽는다.
ASSESSMENT_SCOPE = {
    "version": "2026-09-14",
    "title": "이 해석이 판정하는 범위",
    "included": [
        "Module Unit 부재의 축력+굽힘 합성 수직응력 (쉘은 von Mises)",
        "정반 Leg 용접부 — SPC 반력을 패드 용접면으로 옮겨 4분절 용접군 등가응력",
        "선택한 하중조건 전체의 포락 (부재·Leg 마다 자기 최악 조건)",
        "반력의 힘·모멘트 6성분 평형 검산",
    ],
    "excluded": [
        "부재의 전단·비틀림·좌굴·횡좌굴·처짐 허용 (수직응력 하나로만 판정한다)",
        "소구경 배관 — 화물이며 실제 지지 상세가 모델에 없다. 응력은 따로 표시한다",
        "스툴 — 지지점을 강체(RBE2)로 이었다. 단면·좌굴·인발·용접은 평가하지 않는다",
        "정반 본체·Leg 기둥·바지 갑판 국부 강도 (출력 자체를 Module Unit 으로 좁혔다)",
        "풍하중·슬래밍·그린워터, 피로",
        "재질별 허용응력 — 입력한 항복강도 하나를 전 부재에 적용한다",
    ],
    "note": "범위 밖 항목은 별도 검토가 필요하다. 이 결과만으로 운송 적합을 판정하지 않는다.",
}

# 사내 표준 Nastran 경로 (없으면 환경변수 NASTRAN_EXE 로 override)
_DEFAULT_NASTRAN_EXE = r"C:\MSC.Software\MSC_Nastran\20131\bin\nastran.exe"
NASTRAN_TIMEOUT_SEC = 1800
BRIDGE_TIMEOUT_SEC = 600


def _resolve_nastran_exe() -> Optional[str]:
    env = os.environ.get("NASTRAN_EXE", "").strip().strip('"')
    if env and os.path.exists(env):
        return env
    if os.path.exists(_DEFAULT_NASTRAN_EXE):
        return _DEFAULT_NASTRAN_EXE
    return None


def _write(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8") as fp:
        fp.write(text)


def _read(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="replace") as fp:
        return fp.read()


def _run_nastran(bdf_path: str) -> str:
    """Nastran SOL 101 실행. 성공 여부는 F06 존재와 FATAL 유무로 판단한다."""
    exe = _resolve_nastran_exe()
    if not exe:
        raise RuntimeError(
            "Nastran 실행 파일을 찾지 못했습니다. NASTRAN_EXE 환경변수를 설정하세요."
        )
    work_dir = os.path.dirname(bdf_path)
    cmd = [exe, os.path.basename(bdf_path), "scr=yes", "old=no", "batch=no"]
    logger.info("[ModuleOceanStructural] Nastran: %s (cwd=%s)", " ".join(cmd), work_dir)
    # ⚠ subprocess.run 을 쓰면 안 된다 — nastran.exe 는 런처라 실제 solver 를 **손자
    #   프로세스**로 띄운다. timeout 시 직계 자식만 죽고 solver 는 남아 CPU 와 scratch 를
    #   계속 잡는다(30분짜리 해석이라 실제로 마주칠 수 있는 상황이다).
    # 사용자가 이미 취소를 요청했으면 해석기를 띄우지 않는다(job_id 는 worker 컨텍스트에서 해석).
    if is_cancel_requested():
        raise JobCancelledError(CANCELLED_MESSAGE)
    proc = run_subprocess_killtree(cmd, cwd=work_dir, timeout=NASTRAN_TIMEOUT_SEC)
    log = safe_decode(proc.stdout)
    stderr_text = safe_decode(proc.stderr)
    if stderr_text.strip():
        log += "\n[stderr]\n" + stderr_text
    return log


def _f06_to_json(f06_path: str) -> Dict[str, Any]:
    """nastran_bridge <f06> 로 결과 JSON 을 만든다(CLI 무변경 재사용)."""
    json_path = os.path.splitext(f06_path)[0] + "_f06.json"
    cmd = build_nastran_bridge_command(f06_path, "-o", json_path)
    if is_cancel_requested():
        raise JobCancelledError(CANCELLED_MESSAGE)
    proc = run_subprocess_killtree(cmd, cwd=os.path.dirname(f06_path),
                                   timeout=BRIDGE_TIMEOUT_SEC)
    if proc.returncode != 0 or not os.path.exists(json_path):
        detail = (proc.stderr or proc.stdout or "").strip()[-2000:]
        raise RuntimeError(f"F06 파싱에 실패했습니다(exit {proc.returncode}): {detail}")
    with open(json_path, "r", encoding="utf-8") as fp:
        return json.load(fp)


# 합본 BDF·F06·결과 JSON 이 공유하는 파일 이름 줄기(<업로드명>_ocean.*).
_COMBINED_STEM_SUFFIX = "_ocean"

_LEG_JSON_SUFFIX = "_legreact.json"
_WELD_JSON_SUFFIX = "_weld.json"


def weld_json_path_for(leg_json_path: str) -> str:
    """Leg 반력 결과 옆에 둘 용접 평가 결과 경로.

    해석 job 과 재평가 엔드포인트가 **같은 파일**을 써야 한다 — 규칙이 갈라지면
    사용자가 사양을 바꿔 재평가한 뒤에도 폴더에는 옛 판정이 남는다.
    """
    if leg_json_path.endswith(_LEG_JSON_SUFFIX):
        return leg_json_path[: -len(_LEG_JSON_SUFFIX)] + _WELD_JSON_SUFFIX
    return os.path.splitext(leg_json_path)[0] + "_weld.json"


def reassess_weld(leg_json_path: str, spec: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """저장된 Leg 반력으로 용접부를 다시 평가한다(재해석 없음).

    사용자가 각장·용접길이 같은 사양을 바꿀 때마다 20분짜리 Nastran 을 다시 돌릴
    수는 없다. 반력은 사양과 무관하므로 결과 파일의 반력을 그대로 재사용한다.
    """
    with open(leg_json_path, "r", encoding="utf-8") as fp:
        leg_result = json.load(fp)
    legs = leg_result.get("legs") or []
    if not legs:
        raise ValueError("결과 파일에 Leg 반력이 없습니다.")

    # ⚠ 저장된 `legs` 는 **이전 사양으로 고른** 지배 LC 의 행이다. 사양이 바뀌면
    #   단면계수 비가 달라져 지배 LC 도 바뀔 수 있으므로, LC 별 반력이 남아 있으면
    #   전부 다시 판정해 포락한다. 그렇지 않으면 새 사양의 최악을 놓친다.
    per_case = leg_result.get("perLoadCase") or {}
    case_ids = leg_result.get("loadCaseIds") or list(per_case)
    cases = [(case_id, per_case[case_id]["legs"])
             for case_id in case_ids
             if case_id in per_case and per_case[case_id].get("legs")]
    if len(cases) > 1:
        weld_result = envelope_weld([(case_id, evaluate_weld(rows, spec))
                                     for case_id, rows in cases])
    else:
        weld_result = evaluate_weld(legs, spec)
    weld_path = weld_json_path_for(leg_json_path)
    _write(weld_path, json.dumps(weld_result, ensure_ascii=False, indent=2))
    weld_result["resultJson"] = weld_path
    return weld_result


def _fatal_text(messages: List[Dict[str, Any]]) -> str:
    """FATAL 메시지를 사람이 읽을 문장으로. 사용자가 화면에서 그대로 보는 텍스트다.

    nastran_bridge 는 message/lines 키에 담는다 — 키를 잘못 짚으면 dict 원문이
    그대로 찍혀 무슨 일이 났는지 알아볼 수 없다.
    """
    out = []
    for entry in messages[:10]:
        text = entry.get("message") or entry.get("text")
        if not text:
            text = "\n".join(str(line) for line in (entry.get("lines") or []))
        line_no = entry.get("lineNumber")
        prefix = f"[F06 {line_no}행] " if line_no else ""
        out.append(prefix + str(text).strip())
    return "\n".join(out)


def _run_one(stem: str, bdf_text: str, phase: str) -> Dict[str, Any]:
    """BDF 를 쓰고 Nastran 을 돌려 결과 JSON 까지. FATAL 이면 RuntimeError."""
    bdf_path = f"{stem}.bdf"
    _write(bdf_path, bdf_text)
    console_log = _run_nastran(bdf_path)

    f06_path = f"{stem}.f06"
    if not os.path.exists(f06_path):
        raise RuntimeError(
            f"{phase}: Nastran 이 F06 을 만들지 못했습니다.\n{console_log[-2000:]}"
        )

    f06_text = _read(f06_path)
    f06_json = _f06_to_json(f06_path)
    fatals = f06_fatal_messages(f06_json)
    if fatals:
        raise RuntimeError(f"{phase}: Nastran FATAL\n{_fatal_text(fatals)}")

    return {
        "bdfPath": bdf_path,
        "f06Path": f06_path,
        "f06Json": f06_json,
        # mechanism 이 남은 채 BAILOUT 으로 풀렸는지 — 결과 신뢰도의 핵심 신호다.
        "quality": scan_f06_quality(f06_text),
        "consoleLog": console_log,
    }


def _shift_ids(rows: List[Dict[str, Any]], key: str, offset: int) -> None:
    """합본에서 밀어 둔 ID 를 화면이 아는 원본 ID 로 되돌린다(제자리 수정).

    화면의 3D 모델·응력 색맵은 업로드한 BDF 의 ID 로 그려진다. 여기서 되돌리지 않으면
    결과가 어떤 요소에도 붙지 않아 색맵이 통째로 비는데, 요약 숫자는 멀쩡해 보인다.
    """
    for row in rows:
        if row.get(key) is not None:
            row[key] = int(row[key]) - offset


def _quality_to_display_ids(quality: Dict[str, Any], *, offset: int) -> None:
    """품질 진단이 든 합본 ID 를 **화면이 아는 ID** 로 되돌린다.

    ★ 이걸 빠뜨리면 사용자는 자기 BDF 에 없는 번호를 본다. 실제로 그랬다 — 합본
      모델로 바꾼 뒤 응력·변위 ID 는 되돌리면서 quality 만 빠져, 화면에 절점
      "200009" 가 찍혔다(사용자 BDF 의 절점 9). 찾을 수 없는 번호는 경고가 아니라
      혼란이다.

    합본에는 정반 절점(< offset)과 Module Unit 절점(>= offset)이 섞여 있다. 정반은
    프로그램 내장 모델이라 사용자 BDF 에 아예 없으므로, 되돌리지 않고 **따로 세어**
    화면이 "모듈 n개 · 정반 m개" 로 말할 수 있게 한다.
    """
    def split(values):
        module, deck = [], []
        for raw in values or []:
            value = int(raw)
            (module if value >= offset else deck).append(
                value - offset if value >= offset else value)
        return module, deck

    nodes, deck_nodes = split(quality.get("highPivotNodeIds"))
    quality["highPivotNodeIds"] = nodes
    quality["highPivotDeckNodeIds"] = deck_nodes
    for key in ("affectedElementIds", "contaminatedTopElementIds"):
        module, deck = split(quality.get(key))
        # 요소는 모듈 것만 평가 대상이라 정반 쪽은 개수로만 남긴다.
        quality[key] = module
        if deck:
            quality[f"{key}DeckCount"] = len(deck)


def _to_module_ids(stress_result: Dict[str, Any], displacement: Dict[str, Any],
                   *, offset: int) -> None:
    _shift_ids(stress_result["elements"], "elementId", offset)
    _shift_ids(stress_result["topElements"], "elementId", offset)
    _shift_ids([stress_result["summary"]], "maxStressElementId", offset)
    # 제외 목록도 같이 되돌린다 — 여기를 빠뜨리면 화면의 '제외된 배관' 목록만
    # 합본 ID 로 남아 사용자가 자기 BDF 에서 그 요소를 찾지 못한다.
    dropped = stress_result.get("excludedSummary")
    if dropped:
        _shift_ids(dropped["topElements"], "elementId", offset)
        _shift_ids([dropped], "maxStressElementId", offset)
    _shift_ids(displacement["nodes"], "nodeId", offset)
    _shift_ids([displacement["summary"]], "maxNodeId", offset)
    # LC 별 요약도 같은 ID 규약을 따라야 한다 — 여기만 빠지면 포락 표의 '지배 부재'
    # 열만 합본 ID 로 남아 사용자가 자기 BDF 에서 찾지 못한다.
    _shift_ids(list((stress_result.get("perLoadCase") or {}).values()),
               "maxStressElementId", offset)
    for rows in (stress_result.get("perLoadCaseElements") or {}).values():
        _shift_ids(rows, "elementId", offset)
    for rows in (stress_result.get("perLoadCaseTopElements") or {}).values():
        _shift_ids(rows, "elementId", offset)
    _shift_ids(list((displacement.get("perLoadCase") or {}).values()),
               "maxNodeId", offset)


def task_execute_ocean_structural(job_id: str, payload: Dict[str, Any]) -> None:
    """3단계 — 정반 + Module Unit 합본 모델을 한 번 풀고 두 가지를 뽑는다.

    ① Module Unit 부재 응력 (평가 대상은 Module Unit 뿐이다)
    ② 정반 Leg 의 SPC 반력 → 용접부 강도 평가

    예전에는 이 둘을 각각 다른 모델로 풀었다. 이제 한 모델이라 지지 강성과 반력이
    같은 해에서 나온다.
    """
    employee_id = payload["employee_id"]
    bdf_path = payload["bdf_path"]
    work_dir = payload["work_dir"]
    deck_type = payload["deck_type"]
    support_node_ids = payload["support_node_ids"]
    placement = payload["placement"]
    clearance_mm = float(payload.get("clearance_mm") or DEFAULT_CLEARANCE_MM)
    # 소구경 배관 제외 외경. 0 이면 '제외 안 함'이므로 `or` 폴백을 쓰면 안 된다 —
    # 0 이 falsy 라 기본값으로 되살아난다.
    raw_small_bore = payload.get("small_bore_max_od_mm")
    small_bore_max_od_mm = (
        DEFAULT_SMALL_BORE_MAX_OD_MM if raw_small_bore is None else float(raw_small_bore)
    )
    accel_g = (
        float(payload["accel"]["ax"]),
        float(payload["accel"]["ay"]),
        float(payload["accel"]["az"]),
    )
    # 하중조건 목록. 라우터가 Barge 표에서 8개를 펼쳐 넘긴다. 없으면 단일 accel 로
    # 한 조건만 푼다(구 요청 호환).
    load_case_inputs = payload.get("load_cases") or [
        {"id": "LC1", "label": "", "accelG": {"ax": accel_g[0], "ay": accel_g[1], "az": accel_g[2]}}
    ]
    sigma_y = float(payload["material"]["sigmaYMPa"])
    factor = float(payload["material"]["factor"])
    allowable = sigma_y * factor
    material = {"name": MATERIAL_NAME, "sigmaYMPa": sigma_y, "factor": factor}
    source = payload.get("source") or "web"
    project_name = os.path.basename(work_dir)

    mark_running(job_id, "해석 모델을 준비하는 중...", 10)
    # 재실행은 이전 검토 근거를 덮어쓰지 않는다. job id 는 이미 유일하므로 별도 시각
    # 문자열보다 충돌에 강하고, My Project 의 Analysis 레코드와 산출물 폴더도 연결된다.
    run_dir = os.path.join(work_dir, "ocean_runs", job_id)
    stem = os.path.join(run_dir,
                        os.path.splitext(os.path.basename(bdf_path))[0] + _COMBINED_STEM_SUFFIX)

    try:
        os.makedirs(run_dir, exist_ok=False)
        update_progress(job_id, 15, "정반 + Module Unit 합본 모델 생성 중...")
        deck_bulk = extract_bulk_lines(_read(jungban_bdf_path(deck_type)))
        unit_bulk = extract_bulk_lines(_read(bdf_path))
        build = build_combined_bdf(
            deck_bulk_lines=deck_bulk,
            unit_bulk_lines=unit_bulk,
            support_node_ids=support_node_ids,
            placement=placement,
            load_cases=[
                {"id": case["id"], "label": case.get("label") or "",
                 "accelG": (float(case["accelG"]["ax"]), float(case["accelG"]["ay"]),
                            float(case["accelG"]["az"]))}
                for case in load_case_inputs
            ],
            deck_contingency_pct=float(payload.get("deck_contingency_pct") or 0.0),
            module_contingency_pct=float(payload.get("module_contingency_pct") or 0.0),
            clearance_mm=clearance_mm,
        )
        offset = int(build["idOffset"])

        cases = build["loadCases"]
        update_progress(job_id, 25,
                        f"Nastran 해석 중... 하중조건 {len(cases)}개 "
                        "(정반 포함 모델이라 몇 분 걸립니다)")
        run = _run_one(stem, build["text"], "합본 해석")

        # ── Module Unit 부재 응력 ────────────────────────────────────────
        update_progress(job_id, 70, f"하중조건 {len(cases)}개 부재 응력 평가 중...")
        # 소구경 배관은 평가 대상 '부재'가 아니라 화물이다 — 판정에서만 뺀다.
        # EID 는 아직 합본 기준이라 원본 ID 에 offset 을 더해 맞춘다.
        small_bore = {
            eid + offset: outer
            for eid, outer in small_bore_element_ids(
                unit_bulk, max_od_mm=small_bore_max_od_mm).items()
        }
        legs = get_jungban_leg_nodes(deck_type)
        stress_cases: List[Any] = []
        disp_cases: List[Any] = []
        leg_cases: List[Any] = []
        for case in cases:
            case_accel = (float(case["accelG"]["ax"]), float(case["accelG"]["ay"]),
                          float(case["accelG"]["az"]))
            stress_cases.append((case["id"], evaluate_stress(
                run["f06Json"],
                allowable_mpa=allowable,
                subcase_id=int(case["subcaseId"]),
                excluded_elements=small_bore,
                excluded_reason=f"외경 {small_bore_max_od_mm:g}mm 이하 소구경 배관",
            )))
            disp_cases.append((case["id"], extract_displacements(
                run["f06Json"], subcase_id=int(case["subcaseId"]))))
            # 합본에서는 정반 Leg 절점 자체가 SPC 절점이고, 모멘트는 그 위 패드
            # 용접면으로 옮겨진 값이 실린다(legs 의 weldPlaneZMm).
            leg_cases.append((case["id"], extract_leg_reactions(
                run["f06Json"],
                legs=legs,
                total_mass_t=float(payload["total_mass_t"]),
                accel_g=case_accel,
                subcase_id=int(case["subcaseId"]),
                cog_mm=payload["total_cog_mm"],
            )))

        stress_result = envelope_stress(stress_cases)
        displacement = envelope_displacement(disp_cases)

        quality = dict(run["quality"])
        # 고피벗이 있다는 사실만으로 결과 전체를 버리면 과잉 차단이다 — 특이 절점이
        # 실제로 어느 부재에 붙어 있는지 되짚어 "지배 부재가 오염됐는가"까지 본다.
        # 절점·요소 ID 는 아직 합본 기준이므로 되돌리기 **전에** 대조한다.
        quality.update(assess_singularity_impact(
            singular_node_ids=quality.get("highPivotNodeIds") or [],
            element_nodes=element_node_map(extract_bulk_lines(build["text"])),
            top_element_ids=[item["elementId"] for item in stress_result.get("topElements") or []],
            governing_element_id=(stress_result.get("summary") or {}).get("maxStressElementId"),
        ))
        # quality 도 같이 되돌린다 — 여기만 빠지면 화면에 사용자 BDF 에 없는 절점 번호가 찍힌다.
        _quality_to_display_ids(quality, offset=offset)
        _to_module_ids(stress_result, displacement, offset=offset)

        # 승격한 RBE2 의 EID 도 화면이 아는 원본 ID 로 되돌린다 — 사용자가 자기 BDF 에서
        # 그 요소를 찾아봐야 "이 연결부 모멘트가 어디서 왔나" 를 되짚을 수 있다.
        rigid_promotion = dict(build["rigidPromotion"])
        for key in ("promotedEids", "escalatedEids"):
            rigid_promotion[key] = [
                int(eid) - offset for eid in (rigid_promotion.get(key) or [])
            ]

        governing_case = next(
            (case for case in cases
             if case["id"] == stress_result["summary"].get("governingLoadCase")),
            cases[0],
        )
        stress_result.update({
            # 포락의 지배 LC 가속도. 단일 LC 시절 키를 그대로 두어 화면·이력이 깨지지 않게 한다.
            "accelG": governing_case["accelG"],
            "loadCases": cases,
            "assessmentScope": ASSESSMENT_SCOPE,
            "rotationZDeg": float(placement.get("rotationZDeg") or 0.0),
            "material": material,
            "supportCount": len(build["supportPairs"]),
            "supportPairs": build["supportPairs"],
            "clearanceMm": build["clearanceMm"],
            # 화면이 "무엇을 어떤 기준으로 뺐는지"를 그대로 되읽을 수 있게 남긴다.
            "smallBoreMaxOdMm": small_bore_max_od_mm,
            "gapMm": build["gapMm"],
            "deckTopZMm": build["deckTopZMm"],
            # 부분 구속 RBE2 를 강결로 올린 내역. **사용자 모델의 연결 조건을 바꾼
            # 조작**이므로 결과 화면에도 띄운다 — 그 연결부에 원래 없던 모멘트가 생긴다.
            "rigidPromotion": rigid_promotion,
            # 결과 모달의 변위 색맵·변형 형상용. 절점 2천여 개라 작업 레코드에는 싣지 않고
            # 결과 파일에만 넣는다(모달이 열릴 때만 내려받는다 — elements 와 같은 방식).
            "displacement": displacement,
            "spcSid": build["spcSid"],
            "loadSid": build["loadSid"],
            "quality": quality,
        })
        stress_json_path = f"{stem}_stress.json"
        _write(stress_json_path, json.dumps(stress_result, ensure_ascii=False, indent=2))

        # ── 정반 Leg 반력 · 용접 ─────────────────────────────────────────
        # Leg 마다 지배 LC 가 다르다(실측: +Y 는 Leg 2, −Y 는 Leg 7). 그래서 용접을
        # LC 마다 판정한 뒤 Leg 별로 최악을 고르고, 반력 표시 행도 그 LC 로 맞춘다 —
        # 두 표가 다른 LC 를 가리키면 사용자가 대조할 수 없다.
        update_progress(job_id, 85, "정반 Leg 반력·용접 포락 중...")
        try:
            weld_cases = [(case_id, evaluate_weld(result["legs"], payload.get("weld_spec")))
                          for case_id, result in leg_cases]
            weld_result = envelope_weld(weld_cases)
            weld_error: Optional[str] = None
        except Exception as weld_exc:                         # noqa: BLE001
            # 용접 사양이 잘못됐다고 해석 결과까지 버릴 수는 없다. 응력·반력은 그대로
            # 살리고, 화면에서 사양을 고쳐 재평가하게 둔다.
            logger.warning("[ModuleOceanStructural] 용접 평가 실패 job=%s: %s", job_id, weld_exc)
            weld_result, weld_error = None, str(weld_exc)

        leg_result = envelope_leg_reactions(leg_cases, weld_result)
        leg_result["accelG"] = governing_case["accelG"]
        leg_result["loadCases"] = cases
        leg_result["assessmentScope"] = ASSESSMENT_SCOPE
        leg_result["deckType"] = deck_type
        leg_result["cogMm"] = payload["total_cog_mm"]
        leg_result["legColumnHeightsMm"] = [
            (float(leg["zTop"]) - float(leg["z"])) if leg.get("zTop") is not None else None
            for leg in legs
        ]
        leg_result["quality"] = quality
        leg_json_path = f"{stem}{_LEG_JSON_SUFFIX}"
        _write(leg_json_path, json.dumps(leg_result, ensure_ascii=False, indent=2))

        # 사양을 바꾼 재평가는 /weld-assess 가 이 파일을 덮어쓴다.
        update_progress(job_id, 93, "Leg 용접부 강도 평가 중...")
        if weld_result is not None:
            weld_json_path = weld_json_path_for(leg_json_path)
            _write(weld_json_path, json.dumps(weld_result, ensure_ascii=False, indent=2))
            weld_info = {
                "resultJson": weld_json_path,
                "spec": weld_result["spec"],
                "section": weld_result["section"],
                "summary": weld_result["summary"],
                "legs": weld_result["legs"],
            }
        else:
            weld_info = {"error": weld_error, "legReactionJson": leg_json_path}

        # ── 마감 ─────────────────────────────────────────────────────────
        result_info = {
            # ★ My Project 가 파일을 내려받는 통로. 저 화면은 result_info 의 **최상위
            #   문자열 값**만 다운로드 행으로 그린다(다른 앱과 같은 규약). 아래 model/
            #   stress 는 전부 dict 라, 이 키가 없으면 이 앱만 받을 파일이 하나도
            #   안 보인다. model.bdf 와 같은 경로를 가리키는 별칭이다.
            #   ⚠ 키 이름을 'bdf' 로 하면 안 된다 — My Project 는 result_info.bdf 가
            #     있으면 '3D 시각화' 버튼을 띄우는데, 합본은 정반 포함 10만 요소라
            #     그 뷰어가 감당하지 못한다.
            "combined_bdf": run["bdfPath"],
            "runId": job_id,
            "assessmentScope": ASSESSMENT_SCOPE,
            "inputSnapshot": {
                "bdfPath": bdf_path,
                "deckType": deck_type,
                "supportNodeIds": support_node_ids,
                "placement": placement,
                "clearanceMm": clearance_mm,
                "smallBoreMaxOdMm": small_bore_max_od_mm,
                "deckContingencyPct": float(payload.get("deck_contingency_pct") or 0.0),
                "moduleContingencyPct": float(payload.get("module_contingency_pct") or 0.0),
                "totalMassT": float(payload["total_mass_t"]),
                "totalCogMm": list(payload["total_cog_mm"]),
                "accelG": {"ax": accel_g[0], "ay": accel_g[1], "az": accel_g[2]},
                "loadCases": cases,
                "material": material,
                "weldSpec": payload.get("weld_spec"),
            },
            # 어떤 Excel 입력/LC가 이 가속도를 만들었는지 결과와 함께 보존한다.
            "accelerationCalculation": payload.get("acceleration_calculation"),
            "model": {
                "bdf": run["bdfPath"],
                "f06": run["f06Path"],
                "deckType": deck_type,
                "clearanceMm": build["clearanceMm"],
                # 적치 높이가 어떻게 정해졌는지 되짚을 수 있어야 한다 —
                # baseZ = max(지지점 발밑 적치면 z + clearance - 지지점 로컬 z).
                "gapMm": build["gapMm"],
                "landingLevelsMm": build["landingLevelsMm"],
                "supportStoolMm": build["supportStoolMm"],
                "minDeckClearanceMm": build["minDeckClearanceMm"],
                "deckTopZMm": build["deckTopZMm"],
                "deckCenterMm": build["deckCenterMm"],
                "moduleBottomZMm": build["moduleBottomZMm"],
                "supportPairs": build["supportPairs"],
                # 지지점과 그 발밑 정반 절점 사이의 수평 거리. 정반 격자가 ~400mm 라
                # 이보다 멀면 "가장 가까운 절점" 이 사실은 꽤 떨어져 있다는 뜻이라,
                # 화면이 경고할 수 있도록 기준값을 함께 싣는다.
                "maxPairDistanceMm": build["maxPairDistanceMm"],
                "pairWarnMm": build["pairWarnMm"],
                # 사용자 모델의 부분 구속 RBE2 를 강결로 올린 내역(원본 EID).
                "rigidPromotion": rigid_promotion,
                "unitNodeCount": build["unitNodeCount"],
                "idOffset": offset,
            },
            "stress": {
                "resultJson": stress_json_path,
                "bdf": run["bdfPath"],
                "f06": run["f06Path"],
                "summary": stress_result["summary"],
                "allowableMPa": allowable,
                # 어느 조건들을 포락했고 무엇이 지배했는지 — 요약 카드가 바로 보여 준다.
                "loadCases": cases,
                "perLoadCase": stress_result.get("perLoadCase"),
                "assessmentScope": ASSESSMENT_SCOPE,
                # 무엇을 판정에서 뺐는지는 요약 카드에서 바로 보여야 한다 —
                # 결과 파일을 열어야만 알 수 있으면 사실상 감춘 것과 같다.
                "smallBoreMaxOdMm": small_bore_max_od_mm,
                "excludedSummary": stress_result.get("excludedSummary"),
                "quality": quality,
                # 최대 변위는 요약 카드에서 바로 보여 준다(전체 절점 값은 결과 파일에만).
                "displacementSummary": displacement["summary"],
                # 변위도 응력과 같이 **조건별 값**을 따로 보여 준다. 포락값 하나만 주면
                # "어느 조건에서 얼마나 눕는가" 를 사용자가 되짚을 수 없다.
                "displacementPerLoadCase": displacement.get("perLoadCase"),
                "supportCount": len(build["supportPairs"]),
            },
            "legReaction": {
                "resultJson": leg_json_path,
                "bdf": run["bdfPath"],
                "f06": run["f06Path"],
                "legs": leg_result["legs"],
                "check": leg_result["check"],
                # 결과 모달이 Leg 모델을 그리는 데 필요한 것들(합쳐야 몇 개 안 된다).
                "cogMm": leg_result["cogMm"],
                "loadCases": cases,
                "weldMomentReference": leg_result.get("weldMomentReference"),
                "deckType": deck_type,
                "legColumnHeightsMm": leg_result["legColumnHeightsMm"],
                "totalMassT": leg_result["totalMassT"],
                "accelG": leg_result["accelG"],
                "quality": quality,
            },
            "weld": weld_info,
        }
        project_data, db_error = record_analysis(
            job_id=job_id,
            project_name=project_name,
            program_name=PROGRAM_NAME,
            employee_id=employee_id,
            status="Success",
            input_info={
                "parent_analysis_id": payload.get("parent_analysis_id"),
                "bdf_path": bdf_path,
                "deck_type": deck_type,
                "accel_g": {"ax": accel_g[0], "ay": accel_g[1], "az": accel_g[2]},
                "load_case_ids": [case["id"] for case in cases],
                "acceleration_calculation": payload.get("acceleration_calculation"),
                "placement": placement,
                "clearance_mm": clearance_mm,
                "material": material,
                "total_mass_t": payload["total_mass_t"],
                "total_cog_mm": payload["total_cog_mm"],
                "deck_contingency_pct": payload.get("deck_contingency_pct"),
                "module_contingency_pct": payload.get("module_contingency_pct"),
                "support_node_count": len(support_node_ids),
                "support_node_ids": support_node_ids,
                "small_bore_max_od_mm": small_bore_max_od_mm,
                "weld_spec": payload.get("weld_spec"),
                "run_id": job_id,
            },
            result_info=result_info,
            source=source,
        )
        engine_log = run["consoleLog"]
        if db_error:
            engine_log += f"\nDB 기록 오류: {db_error}"

        mark_complete(
            job_id, "Success", engine_log, project_data,
            extra={"result_info": result_info},
            success_message="해상 운송 구조 해석이 완료되었습니다",
        )

    except Exception as exc:                                  # noqa: BLE001
        logger.exception("[ModuleOceanStructural] 실패 job=%s", job_id)
        project_data, _ = record_analysis(
            job_id=job_id,
            project_name=project_name,
            program_name=PROGRAM_NAME,
            employee_id=employee_id,
            status="Failed",
            input_info={"bdf_path": bdf_path, "deck_type": deck_type},
            result_info=None,
            source=source,
        )
        mark_complete(
            job_id, "Failed", str(exc), project_data,
            failure_message="해상 운송 구조 해석에 실패했습니다",
        )
