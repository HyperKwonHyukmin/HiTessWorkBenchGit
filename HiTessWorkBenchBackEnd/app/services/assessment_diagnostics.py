"""Truss Structural Assessment 실패 원인 진단.

왜 필요한가
-----------
TrussAssessment.exe 는 Nastran 결과 파일(.f06)에서 Displacement / SPCForce /
ELForce 세 블록을 읽는다. BDF 의 Case Control 이 예를 들어

    SPCFORCES(PUNCH) = ALL      ← PRINT 가 없음

로 되어 있으면 SPC 반력은 .pch(punch) 파일로만 나가고 .f06 에는 실리지 않는다.
그러면 엔진은 `f06ParsingResults["SPCForce"]` 에서 KeyNotFoundException 으로
죽고(Program.cs 에 try/catch 없음) 0 이 아닌 종료 코드를 반환한다.

엔진 stdout 에는 원인이 그대로 찍히지만
  - 백엔드 run_engine() 이 CalledProcessError 를 잡아 stdout/stderr 를 버리고
  - 프론트 onError 가 engine_log 를 무시해서
사용자 화면(Execution Console)에는 "해석 실패." 한 줄만 남았다.

이 모듈이 하는 일
-----------------
1. preflight_case_control() — 엔진을 돌리기 **전에** Case Control 을 검사해
   확실히 실패할 BDF 를 즉시 걸러내고 무엇을 고쳐야 하는지 알려준다.
2. diagnose_engine_failure() — 그래도 실패했을 때 엔진 출력에서 알려진 실패
   서명을 찾아 한국어 원인·조치로 바꾼다.
3. build_failure_report() / build_preflight_report() — Execution Console 에
   그대로 출력할 텍스트를 만든다. 서버 절대경로는 redact_paths() 로 가린다.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

# ──────────────────────────────────────────────────────────────
# Case Control 파싱
# ──────────────────────────────────────────────────────────────

#: Case Control 출력 요청 명령의 별칭 → 정규 이름.
#: NASTRAN Case Control 에서 FORCE 는 ELFORCE 의 동의어다.
#: (BULK DATA 의 FORCE 하중 카드와는 다른 것이라 Case Control 구간만 훑는다.)
_COMMAND_ALIASES = {
    "DISPLACEMENT": "DISPLACEMENT",
    "DISPLACEMENTS": "DISPLACEMENT",
    "DISP": "DISPLACEMENT",
    "SPCFORCES": "SPCFORCES",
    "SPCFORCE": "SPCFORCES",
    "SPCF": "SPCFORCES",
    "ELFORCE": "ELFORCE",
    "ELFORCES": "ELFORCE",
    "FORCE": "ELFORCE",
    "FORCES": "ELFORCE",
}

_CEND_RE = re.compile(r"^\s*CEND\b", re.IGNORECASE)
_BEGIN_BULK_RE = re.compile(r"^\s*BEGIN\s+BULK\b", re.IGNORECASE)
_COMMAND_RE = re.compile(r"^\s*([A-Za-z]+)\s*(?:\(([^)]*)\))?\s*=")


@dataclass(frozen=True)
class OutputRequest:
    """Case Control 의 결과 출력 요청 한 줄."""

    name: str                      # 정규화된 명령 이름
    raw: str                       # 원문(앞뒤 공백 제거)
    describers: tuple[str, ...]    # ('PRINT', 'PUNCH') 등

    @property
    def prints_to_f06(self) -> bool:
        """.f06 에 실제로 출력되는가.

        NASTRAN 은 describer 를 생략하면 PRINT 를 기본값으로 쓴다.
        PUNCH 만 지정하면 .pch 로만, PLOT 만 지정하면 어디에도 인쇄되지 않는다.
        """
        if not self.describers:
            return True
        return "PRINT" in self.describers


def _case_control_lines(text: str) -> list[str]:
    """CEND 다음 줄부터 BEGIN BULK 직전까지의 Case Control 구간을 돌려준다.

    CEND 가 없으면 Case Control 을 특정할 수 없으므로 빈 리스트를 준다
    (추측해서 잘못 차단하지 않기 위함).
    """
    lines = text.splitlines()
    start = next((i + 1 for i, ln in enumerate(lines) if _CEND_RE.match(ln)), None)
    if start is None:
        return []

    collected: list[str] = []
    for line in lines[start:]:
        if _BEGIN_BULK_RE.match(line):
            break
        stripped = line.strip()
        if not stripped or stripped.startswith("$"):
            continue
        collected.append(stripped)
    return collected


def read_case_control_head(path: str, max_lines: int = 20_000) -> str | None:
    """BDF 앞부분(BEGIN BULK 까지)만 읽는다.

    Case Control 은 항상 파일 맨 앞에 있으므로 대용량 BULK DATA 를 통째로
    메모리에 올릴 이유가 없다. 파일을 못 읽으면 None (검증을 건너뛴다).
    """
    try:
        lines: list[str] = []
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                lines.append(line)
                if _BEGIN_BULK_RE.match(line) or len(lines) >= max_lines:
                    break
        return "".join(lines)
    except OSError:
        return None


def scan_case_control(text: str) -> dict[str, list[OutputRequest]]:
    """Case Control 구간에서 결과 출력 요청 명령을 모아 정규 이름별로 묶는다."""
    found: dict[str, list[OutputRequest]] = {}
    for line in _case_control_lines(text):
        match = _COMMAND_RE.match(line)
        if not match:
            continue
        canonical = _COMMAND_ALIASES.get(match.group(1).upper())
        if canonical is None:
            continue
        describers = tuple(
            d.strip().upper()
            for d in (match.group(2) or "").split(",")
            if d.strip()
        )
        found.setdefault(canonical, []).append(
            OutputRequest(name=canonical, raw=line, describers=describers)
        )
    return found


# ──────────────────────────────────────────────────────────────
# 사전 검증 (preflight)
# ──────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class CaseControlProblem:
    command: str
    blocking: bool     # True 면 엔진이 반드시 죽으므로 실행 전에 막는다
    current: str
    required: str
    reason: str


#: 엔진이 .f06 에서 읽는 블록 → (차단 여부, 소비하는 검토 단계)
#: Displacement 는 파싱만 되고 어떤 Checker 도 소비하지 않으므로 경고로만 남긴다.
_REQUIRED_OUTPUTS: tuple[tuple[str, bool, str], ...] = (
    ("ELFORCE", True, "부재 응력 검토(ElementStressChecker)"),
    ("SPCFORCES", True, "하중분산판 · Side Support 검토(LoadDistributionChecker)"),
    ("DISPLACEMENT", False, "변위 결과 기록"),
)


def preflight_case_control(text: str) -> list[CaseControlProblem]:
    """엔진 실행 전에 Case Control 이 .f06 결과를 내도록 되어 있는지 검사한다.

    한 명령이 여러 번 나오면 그중 **하나라도** PRINT 로 출력되면 정상으로 본다
    (전역 PUNCH + SUBCASE 별 PRINT 조합을 과잉 차단하지 않기 위함).
    """
    found = scan_case_control(text)
    if not found and not _case_control_lines(text):
        # Case Control 을 못 찾았다 — 추측하지 않고 엔진 판단에 맡긴다.
        return []

    problems: list[CaseControlProblem] = []
    for command, blocking, consumer in _REQUIRED_OUTPUTS:
        requests = found.get(command, [])
        if any(r.prints_to_f06 for r in requests):
            continue

        consequence = (
            f"{consumer} 단계에서 해석이 중단됩니다."
            if blocking else
            f"{consumer}가 비어 있게 됩니다(해석 자체는 계속 진행됩니다)."
        )
        if requests:
            current = requests[0].raw
            reason = (
                "PRINT 가 지정되지 않아 결과가 .f06 이 아닌 다른 파일(.pch 등)로만 "
                f"출력됩니다. 엔진은 .f06 만 읽으므로 {consequence}"
            )
        else:
            current = f"(Case Control 에 {command} 출력 요청이 없습니다)"
            reason = f"{command} 결과가 .f06 에 없어 {consequence}"

        problems.append(CaseControlProblem(
            command=command,
            blocking=blocking,
            current=current,
            required=f"{command}(PRINT,PUNCH) = ALL",
            reason=reason,
        ))
    return problems


# ──────────────────────────────────────────────────────────────
# Property ID 검증
#
# 엔진의 ElementStressChecker 는 허용응력 테이블에 없는 Property ID 를 만나면
# KeyNotFoundException 을 catch 하고 continue 한다 — 즉 아무 흔적 없이 스킵한다.
# BDF 전체가 테이블 밖 ID 로 되어 있으면 FATAL 도 오류도 없이 부재평가 시트만
# 텅 빈 리포트가 나온다(실제 사례: 177K-01.bdf, FEGate 5.03.21 이 +1000 오프셋
# 1001~1019 로 내보냄). 해석을 돌리기 전에 여기서 잡는다.
# ──────────────────────────────────────────────────────────────

#: 엔진이 허용응력을 정의해 둔 Property ID 집합.
#: 원본은 C# 쪽 AllowableInfo.propertiesInfo (ElementStressChecker.cs:28-48).
#: 허용 축력·휨모멘트 **값은 복제하지 않는다** — 판정에 필요한 것은 ID 집합뿐이고,
#: 값까지 두 곳에 두면 드리프트가 곧바로 오판으로 이어진다.
_ALLOWABLE_PROPERTY_IDS = frozenset(range(1, 19))

#: CBAR 카드에서 Property ID 가 놓이는 고정 필드(3번째 필드, 8칸).
#: 엔진 BdfParser.cs 가 line.Substring(16, 8) 로 읽는 위치와 같아야 한다 —
#: preflight 가 엔진보다 관대하거나 엄격하면 판정이 어긋난다.
_CBAR_PID_SLICE = slice(16, 24)

#: 리포트에 나열할 Property ID 최대 개수(나머지는 "외 N 종"으로 접는다).
_MAX_LISTED_PROPERTY_IDS = 12


@dataclass(frozen=True)
class PropertyIdProblem:
    """CBAR 가 참조하는 Property ID 와 허용응력 테이블의 불일치."""

    blocking: bool                          # True 면 평가 가능한 부재가 0 개
    total_elements: int
    mapped_elements: int
    unmapped: tuple[tuple[int, int], ...]   # (Property ID, 요소 수), 요소 수 내림차순


def scan_element_property_ids(path: str) -> Counter | None:
    """BDF 의 CBAR 가 참조하는 Property ID 를 요소 수와 함께 집계한다.

    PBAR/PBARL 카드가 아니라 **CBAR 참조**를 세는 이유: 참조 모델
    3321_2tk_moving_04.bdf 에는 어떤 CBAR 도 쓰지 않는 PBARL 37/38/39 가
    카드로만 존재한다. 카드 기준으로 검사하면 정상 모델이 차단된다.

    카드 이름은 8칸 필드 전체가 정확히 'CBAR' 인 줄만 받는다. 엔진의
    StartsWith("CBAR") 는 CBARAO 같은 카드까지 끌어오는데, 그 3번째 필드는
    Property ID 가 아니라 스칼라라서 우연히 1~18 에 들어가면 불일치를 가려버린다.

    한 줄도 못 읽으면 None — free-field/large-field 처럼 엔진도 못 읽는 형식에서
    억지로 판정해 오탐을 내는 대신 검사를 건너뛴다.
    """
    counts: Counter = Counter()
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                if line[:8].strip() != "CBAR":
                    continue
                try:
                    counts[int(line[_CBAR_PID_SLICE])] += 1
                except ValueError:
                    continue
    except OSError:
        return None
    return counts or None


def preflight_property_ids(counts: Counter | None) -> PropertyIdProblem | None:
    """허용응력 테이블에 없는 Property ID 를 찾는다. 문제가 없으면 None.

    - 평가 가능한 부재가 0 개 → blocking. 엔진을 돌려도 결과가 전부 빈다.
    - 일부만 테이블 밖 → 경고. 엔진은 원래 테이블 밖 Property 를 평가에서
      제외하도록 설계돼 있으므로 해석 자체는 계속 진행한다.
    """
    if not counts:
        return None

    unmapped = tuple(sorted(
        ((pid, n) for pid, n in counts.items() if pid not in _ALLOWABLE_PROPERTY_IDS),
        key=lambda item: (-item[1], item[0]),
    ))
    if not unmapped:
        return None

    total = sum(counts.values())
    mapped = total - sum(n for _, n in unmapped)
    return PropertyIdProblem(
        blocking=mapped == 0,
        total_elements=total,
        mapped_elements=mapped,
        unmapped=unmapped,
    )


def _format_unmapped_ids(unmapped: tuple[tuple[int, int], ...]) -> list[str]:
    """미매핑 Property ID 를 '1008(5,844)' 형태로 한 줄에 4개씩 늘어놓는다."""
    shown = unmapped[:_MAX_LISTED_PROPERTY_IDS]
    lines = [
        "       " + "  ".join(f"{pid}({n:,})" for pid, n in shown[i:i + 4])
        for i in range(0, len(shown), 4)
    ]
    if len(unmapped) > len(shown):
        lines.append(f"       ... 외 {len(unmapped) - len(shown)} 종")
    return lines


def build_property_preflight_report(problem: PropertyIdProblem, bdf_name: str) -> str:
    """Property ID 불일치를 Execution Console 에 출력할 텍스트로 만든다."""
    if problem.blocking:
        title = "BDF 사전 검증 실패 — 해석을 시작하지 않았습니다"
        lead = (
            "[원인] CBAR 가 참조하는 Property ID 가 허용응력 테이블(1~18)과 하나도",
            "       일치하지 않습니다. 이대로 해석하면 부재평가 결과가 전부 빈 채로 나옵니다.",
        )
    else:
        title = "BDF 사전 검증 경고 — 해석은 계속 진행합니다"
        lead = (
            "[알림] 아래 Property ID 는 허용응력 테이블(1~18)에 없어 부재평가에서",
            "       제외됩니다. 나머지 부재는 정상적으로 평가됩니다.",
        )

    parts = [
        _RULE,
        title,
        _RULE,
        f"[파일] {bdf_name}",
        "[단계] Property ID 검증",
        *lead,
        f"[상세] 평가 가능 부재 {problem.mapped_elements:,} / {problem.total_elements:,} 개",
        "       테이블에 없는 Property ID (요소 수):",
        *_format_unmapped_ids(problem.unmapped),
        "[조치] 모델링 도구에서 BDF 를 내보낼 때 PBAR/PBARL 의 Property ID 를 1~18 로",
        "       지정하세요. FEGate 5.x 는 +1000 오프셋으로 내보내는 경우가 있습니다(1001 → 1).",
    ]
    return "\n".join(parts)


# ──────────────────────────────────────────────────────────────
# 엔진 실패 서명 진단
# ──────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class EngineDiagnosis:
    stage: str
    cause: str
    remedy: str
    detail: str = ""


_MISSING_BLOCK_INFO: dict[str, tuple[str, str, str]] = {
    # 엔진 내부 키 → (중단 단계, 원인 설명, 필요한 Case Control)
    "SPCForce": (
        "하중분산판 · Side Support 검토",
        "Nastran 결과 파일(.f06)에 SPC 반력(구속점 반력) 결과가 없습니다.",
        "SPCFORCES(PRINT,PUNCH) = ALL",
    ),
    "ELForce": (
        "부재 응력 검토",
        "Nastran 결과 파일(.f06)에 부재력(Element Force) 결과가 없습니다.",
        "ELFORCE(PRINT,PUNCH) = ALL",
    ),
    "Displacement": (
        "변위 결과 파싱",
        "Nastran 결과 파일(.f06)에 변위(Displacement) 결과가 없습니다.",
        "DISPLACEMENT(PRINT,PUNCH) = ALL",
    ),
}

_KEY_NOT_FOUND_RE = re.compile(r"given key '(\w+)' was not present", re.IGNORECASE)
_NO_DATA_PATTERNS: tuple[tuple[re.Pattern, str], ...] = (
    (re.compile(r"No SPC Force data found", re.IGNORECASE), "SPCForce"),
    (re.compile(r"No EL Force data found", re.IGNORECASE), "ELForce"),
    (re.compile(r"No displacement data found", re.IGNORECASE), "Displacement"),
)
_ZERO_ELEMENT_RE = re.compile(r"총\s*0개\s*평가")


def _missing_block_diagnosis(block: str) -> EngineDiagnosis:
    stage, cause, required = _MISSING_BLOCK_INFO[block]
    return EngineDiagnosis(
        stage=stage,
        cause=cause,
        remedy=(
            f"BDF 의 Case Control 을 `{required}` 로 수정한 뒤 다시 업로드하세요. "
            "PUNCH 만 지정하면 결과가 .pch 파일로만 나가고 .f06 에는 실리지 않습니다 "
            "(describer 를 아예 생략해도 PRINT 가 기본값이라 정상 동작합니다)."
        ),
    )


def diagnose_engine_failure(engine_output: str) -> EngineDiagnosis | None:
    """엔진 stdout/stderr 에서 알려진 실패 서명을 찾아 원인·조치로 변환한다.

    아는 서명이 없으면 None 을 돌려준다 — 이때는 호출부가 원문만 보여준다.
    """
    if not engine_output:
        return None

    # ⓪ 제한 시간 초과 (run_engine 이 넣어주는 메시지)
    if "제한 시간" in engine_output and "초과" in engine_output:
        return EngineDiagnosis(
            stage="Nastran 해석",
            cause="해석이 제한 시간 안에 끝나지 않아 중단되었습니다(제한 시간 초과).",
            remedy=(
                "모델 규모(절점·요소 수)나 SUBCASE 개수를 줄여 다시 시도하거나, "
                "관리자에게 제한 시간 상향을 요청하세요."
            ),
        )

    # ① Nastran 이 아예 안 돌았다 (.f06 없음)
    if ".f06 파일을 찾을 수 없습니다" in engine_output:
        return EngineDiagnosis(
            stage="Nastran 해석",
            cause="Nastran 해석 결과 파일(.f06)이 생성되지 않았습니다. Nastran 실행 자체가 실패했습니다.",
            remedy=(
                "해석 서버에 MSC Nastran 이 설치되어 있고 nastran 실행 파일이 PATH 에 "
                "있는지 관리자에게 확인하세요. BDF 문법 오류로도 발생할 수 있습니다."
            ),
        )

    # ② Nastran 은 돌았으나 FATAL 로 중단
    if "F06 FATAL 발견" in engine_output or "USER FATAL MESSAGE" in engine_output:
        fatal_lines = [
            ln.strip() for ln in engine_output.splitlines()
            if "FATAL" in ln.upper()
        ][:5]
        return EngineDiagnosis(
            stage="Nastran 해석",
            cause="Nastran 이 FATAL 오류로 해석을 중단했습니다. BDF 모델 자체에 문제가 있습니다.",
            remedy=(
                "아래 FATAL 메시지의 카드/절점을 BDF 에서 확인하세요. "
                "경계조건(SPC) 누락, 중복 ID, 잘못된 Property 참조가 흔한 원인입니다."
            ),
            detail="\n".join(fatal_lines),
        )

    # ③ .f06 에 필요한 결과 블록이 없어 엔진이 죽음 (가장 흔한 실패)
    key_match = _KEY_NOT_FOUND_RE.search(engine_output)
    if key_match and key_match.group(1) in _MISSING_BLOCK_INFO:
        return _missing_block_diagnosis(key_match.group(1))

    for pattern, block in _NO_DATA_PATTERNS:
        if pattern.search(engine_output):
            return _missing_block_diagnosis(block)

    # ④ 해석은 끝났으나 평가된 부재가 0개 — 허용응력 테이블과 Property ID 불일치
    if _ZERO_ELEMENT_RE.search(engine_output):
        return EngineDiagnosis(
            stage="부재 응력 검토",
            cause=(
                "부재가 한 개도 평가되지 않았습니다. BDF 의 Property ID 가 엔진의 "
                "허용응력 테이블(Property ID 1~18)과 일치하지 않습니다."
            ),
            remedy=(
                "모델링 도구에서 BDF 를 내보낼 때 PBAR/PBARL 의 Property ID 를 1~18 로 "
                "지정하세요. (실측: FEGate 5.03.21 은 +1000 오프셋인 1001~1019 로 "
                "내보내며, 그대로 쓰면 평가 대상이 하나도 없습니다.)"
            ),
        )

    return None


# ──────────────────────────────────────────────────────────────
# 사용자 노출 텍스트 생성
# ──────────────────────────────────────────────────────────────

_MAX_OUTPUT_CHARS = 4000
_RULE = "─" * 58


def redact_paths(text: str, work_dir: str | None, placeholder: str = "<작업폴더>") -> str:
    """서버 작업 폴더 절대경로를 자리표시자로 바꾼다 (내부 경로 비노출)."""
    if not text or not work_dir:
        return text

    out = text
    for variant in {work_dir, work_dir.replace("\\", "/"), work_dir.replace("/", "\\")}:
        out = re.compile(re.escape(variant), re.IGNORECASE).sub(placeholder, out)
    return out


def _tail(text: str, max_chars: int = _MAX_OUTPUT_CHARS) -> str:
    """엔진 출력의 마지막 부분만 남긴다 — 실패 원인은 항상 끝에 있다."""
    text = text.strip()
    if len(text) <= max_chars:
        return text
    clipped = text[-max_chars:]
    newline = clipped.find("\n")
    if newline != -1:
        clipped = clipped[newline + 1:]
    return f"… (앞부분 {len(text) - len(clipped)}자 생략) …\n{clipped}"


def build_failure_report(
    *,
    diagnosis: EngineDiagnosis | None,
    engine_output: str,
    work_dir: str | None,
) -> str:
    """Execution Console 에 그대로 출력할 실패 리포트를 만든다."""
    parts: list[str] = [_RULE, "해석 실패 원인", _RULE]

    if diagnosis is not None:
        parts.append(f"[단계] {diagnosis.stage}")
        parts.append(f"[원인] {diagnosis.cause}")
        if diagnosis.detail:
            parts.append("[상세]")
            parts.extend(f"       {ln}" for ln in diagnosis.detail.splitlines())
        parts.append(f"[조치] {diagnosis.remedy}")
    else:
        parts.append("[원인] 자동으로 식별되지 않은 오류입니다. 아래 엔진 출력을 확인하세요.")
        parts.append("[조치] 아래 엔진 출력을 첨부해 관리자에게 문의하세요.")

    cleaned = redact_paths(engine_output or "", work_dir).strip()
    if cleaned:
        parts.append(_RULE)
        parts.append("엔진 출력")
        parts.append(_RULE)
        parts.append(_tail(cleaned))

    return "\n".join(parts)


def build_preflight_report(problems: list[CaseControlProblem], bdf_name: str) -> str:
    """엔진 실행 전 차단 시 Execution Console 에 출력할 텍스트를 만든다."""
    parts: list[str] = [
        _RULE,
        "BDF 사전 검증 실패 — 해석을 시작하지 않았습니다",
        _RULE,
        f"[파일] {bdf_name}",
        "[원인] 이 BDF 로는 해석을 끝까지 진행할 수 없습니다. Nastran 결과 파일(.f06)에",
        "       엔진이 읽어야 할 결과 블록이 실리지 않도록 Case Control 이 작성되어 있습니다.",
        "",
    ]
    for problem in problems:
        mark = "✖ 필수" if problem.blocking else "△ 권장"
        parts.append(f"{mark}  {problem.command}")
        parts.append(f"      현재 : {problem.current}")
        parts.append(f"      필요 : {problem.required}")
        parts.append(f"      이유 : {problem.reason}")
        parts.append("")

    parts.append("[조치] 위 '필요' 형태로 Case Control 을 수정한 뒤 다시 업로드하세요.")
    parts.append("       describer 를 생략한 `SPCFORCES = ALL` 형태도 PRINT 가 기본값이라 동작합니다.")
    return "\n".join(parts)
