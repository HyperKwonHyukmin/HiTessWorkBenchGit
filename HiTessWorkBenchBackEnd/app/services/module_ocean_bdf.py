"""Module Unit 해상 운송 구조 해석 — Nastran BDF 조립 (순수 함수).

파일 I/O 도 subprocess 도 타지 않는다. 문자열이 들어가 문자열이 나온다 —
그래야 Nastran 없이 골든 텍스트로 카드 양식을 고정할 수 있다.

단위계: mm · ton · s   (힘 N, 응력 MPa, 가속도 mm/s²)

⚠ 카드 양식은 **8칸 고정필드**다. nastran_bridge.bdf_line 은 free-field(콤마) 라
   한 줄 9필드 제한을 넘길 위험이 있어 여기서는 쓰지 않는다.
   (nastran_bridge 는 InHouseProgram 아래 git 미추적이라 import 도 하지 않는다.)
   단 **입력** BDF 는 외부에서 오므로 free-field 도 읽을 수 있어야 한다.

빌더가 dict 를 돌려주는 것은 의도다. 이 저장소의 서비스 계층은 구조화된 반환에 frozen
dataclass 를 즐겨 쓰지만, 같은 모듈군의 module_ocean_results 는 그대로 JSON 으로 직렬화되는
dict 를 돌려준다. 빌더 둘만 dataclass 로 바꾸면 이 묶음이 반반으로 갈려 더 읽기 어려워진다.
"""
from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List, Sequence, Tuple

# 중력가속도 [mm/s²]. 정반 원본 BDF 의 GRAV 카드가 쓰는 값과 같은 9800.0 이다 —
# 사내 관행이 표준중력(9806.65)이 아니라 9800 이라, 여기만 다르면 같은 모델을
# WorkBench 로 돌렸을 때와 손으로 돌렸을 때 결과가 0.07% 어긋난다.
G_MM_S2 = 9800.0

# 생성 카드 ID — 원본 BDF 와 겹치지 않도록 99xxxx 대역.
SPC_SID = 990001
LOAD_SID = 990002

_MAX_FIELD = 8
# 소필드 한 줄 = 카드 + 9칸이지만, 10번째 칸은 continuation 필드다. 데이터는 8개까지만 쓴다.
_MAX_DATA_FIELDS = 8


def real8(value: float) -> str:
    """8칸 소필드에 들어가는 실수 표기. 반드시 소수점 또는 지수를 포함한다.

    예: 0.0 → '0.0', -125.0 → '-125.0', 9806.65 → '9806.65', 7.85e-9 → '7.85-9'.
    (nastran_bridge.fixed_real 과 같은 의도 — 원본 deck 의 '최단 표기' 양식.)
    """
    v = float(value)
    if math.isnan(v) or math.isinf(v):
        raise ValueError(f"BDF 실수로 쓸 수 없는 값입니다: {value!r}")
    # 삼각함수 round-off(1e-16 급)는 0 으로 눌러 '-7.03-17' 같은 표기를 막는다.
    if abs(v) < 1.0e-14:
        v = 0.0
    if v == 0.0:
        return "0.0"

    # 1) repr 최단 표기 — 값을 정확히 복원한다.
    text = repr(v)
    if "e" not in text and "E" not in text:
        if "." not in text:
            text += ".0"
        if len(text) <= _MAX_FIELD:
            return text

    # 2) 고정소수 — 8칸에 들어가며 값을 정확히 복원하는 최소 자릿수(깔끔한 값 우선).
    for prec in range(0, 9):
        text = f"{v:.{prec}f}"
        if "." not in text:
            text += ".0"
        if len(text) <= _MAX_FIELD and float(text) == v:
            return text

    # 3) Nastran 압축 지수 표기 — '7.85-9', '1.2346+6'. (여기까지도 정확 복원)
    negative = v < 0.0
    magnitude = abs(v)
    for sig in range(0, 10):
        mantissa, _, exponent = f"{magnitude:.{sig}e}".partition("e")
        exp = int(exponent)
        if float(f"{mantissa}e{exp}") != magnitude:
            continue
        body = f"{mantissa}{'+' if exp >= 0 else '-'}{abs(exp)}"
        if negative:
            body = "-" + body
        if len(body) <= _MAX_FIELD:
            return body

    # 4) 최선 근사 — 값을 정확히 복원하지 못해도 8칸에 최대 정밀도로 담는다.
    #    GRAV 크기처럼 sqrt/삼각함수에서 나온 값(13868.697431446113 …)은 8칸 안에
    #    정확히 복원되는 표기가 아예 없다. 정확 복원을 고집하면 실전 입력에서 전부 터진다.
    #    ⚠ 후보는 반드시 **소수점을 포함**해야 한다. MSC Nastran 실수 필드는 소수점을 요구하고,
    #       원본 nastran_bridge.real8 의 계약도 "항상 소수점 포함"이다.
    #       '12345+8' 같은 소수점 없는 압축 지수는 유효숫자를 하나 더 벌 수 있지만 쓰지 않는다.
    candidates: List[str] = []
    for prec in range(8, -1, -1):
        text = f"{v:.{prec}f}"
        if "." not in text:
            text += "."                     # 큰 값은 끝의 점만 붙여 8칸을 지킨다('1234568.')
        if len(text) <= _MAX_FIELD and float(text) != 0.0:
            candidates.append(text)
    for sig in range(6, -1, -1):
        mantissa, _, exponent = f"{magnitude:.{sig}e}".partition("e")
        exp = int(exponent)
        body = f"{mantissa}{'+' if exp >= 0 else '-'}{abs(exp)}"
        if negative:
            body = "-" + body
        if "." in body and len(body) <= _MAX_FIELD:
            candidates.append(body)
    if candidates:
        # 표기법마다 담기는 유효숫자가 다르다 — 실제 오차가 가장 작은 것을 고른다.
        return min(candidates, key=lambda text: abs(_parse_real(text) - v))

    raise ValueError(f"BDF 8칸 실수로 표현할 수 없습니다: {value!r}")


def _parse_real(text: str) -> float:
    """BDF 실수 표기를 float 으로 되돌린다 — Nastran 압축 지수 포함('7.85-9' → 7.85e-9)."""
    body = text.strip()
    sign = ""
    if body[0] in "+-":
        sign, body = body[0], body[1:]
    for index in range(1, len(body)):
        if body[index] in "+-":
            return float(f"{sign}{body[:index]}e{body[index:]}")
    return float(sign + body)


def _field(value: Any) -> str:
    """한 필드(8칸). None/'' 은 공백, float 은 real8, 그 외는 문자열 우측정렬."""
    if value is None or value == "":
        return " " * _MAX_FIELD
    # bool 은 int 의 서브클래스라 그냥 두면 '    True' 가 BDF 에 박힌다. 실수로 흘러들면 막는다.
    if isinstance(value, bool):
        raise ValueError(f"BDF 필드에 bool 을 쓸 수 없습니다: {value!r}")
    text = real8(value) if isinstance(value, float) else str(value)
    if len(text) > _MAX_FIELD:
        raise ValueError(f"BDF 소필드 8칸을 넘습니다: {text!r}")
    return text.rjust(_MAX_FIELD)


def line(card: str, *fields: Any) -> str:
    """고정필드 한 줄. 카드명 8칸 좌측정렬 + 필드 8칸 우측정렬.

    ⚠ 데이터 필드는 **8개까지**다. 소필드 한 줄은 10칸(카드 + 9필드)인데 **10번째 칸은
    Nastran 의 continuation 필드**라 비워 둬야 다음 줄이 연속행으로 이어진다. 9개를 채우면
    뒤에 cont() 를 붙여도 연결이 끊기고, 그 줄은 별개의 깨진 카드로 읽힌다 — 에러 없이.
    참조 구현 nastran_bridge.rbe2_fixed_lines 가 첫 줄을 8필드로 제한하는 이유가 이것이다.
    """
    if len(fields) > _MAX_DATA_FIELDS:
        raise ValueError(
            f"한 줄에 데이터 필드가 {_MAX_DATA_FIELDS}개를 넘습니다({len(fields)}개). "
            "10번째 칸은 continuation 필드라 비워 둬야 한다. cont() 를 쓰세요."
        )
    return (card.ljust(_MAX_FIELD) + "".join(_field(f) for f in fields)).rstrip()


def cont(*fields: Any) -> str:
    """continuation 줄 — 첫 8칸을 비우고 필드 최대 8개."""
    if len(fields) > 8:
        raise ValueError(f"continuation 한 줄에 필드가 8개를 넘습니다({len(fields)}개).")
    return (" " * _MAX_FIELD + "".join(_field(f) for f in fields)).rstrip()


def _denoise(value: float, eps: float = 1.0e-12) -> float:
    return 0.0 if abs(value) < eps else value


def grav_line(sid: int, accel_g: Sequence[float]) -> str:
    """GRAV 카드 — A 는 중력가속도(G_MM_S2), N1~N3 는 **g 값 그대로**.

    accel_g 는 **중력을 포함한 총 가속도**를 g 단위로 받는다(정지 = (0,0,-1)).

    Nastran 이 만드는 하중은 A × N 이므로 A 에 합성크기를 접고 N 을 단위벡터로
    정규화해도 결과는 같다. 그럼에도 사내 표준 표기를 따르는 이유는 **읽기** 다 —

        GRAV  2  0  9800.0   0.093   0.273  -1.168     ← 설계 g 값이 그대로 보인다
        GRAV  2  0 11798.19 0.077302 0.226918 -0.97084  ← 같은 하중, 읽을 수 없다

    BDF 를 열어 하중조건을 확인하는 사람은 N 칸에서 g 값을 바로 읽어야 한다.
    """
    ax, ay, az = (float(accel_g[0]), float(accel_g[1]), float(accel_g[2]))
    if math.sqrt(ax * ax + ay * ay + az * az) <= 0.0:
        raise ValueError("가속도 크기가 0 입니다. 하중이 없어 해석할 수 없습니다.")
    return line("GRAV", sid, 0, G_MM_S2, _denoise(ax), _denoise(ay), _denoise(az))


# ── 과정 1: Module Unit 단독 응력 해석 BDF ────────────────────────────────

# 원본에서 걷어낼 구속 카드. 해상 운송 해석은 접촉 절점에 새 SPC 를 건다 —
# 원본의 임시 지지/바닥 구속이 남아 있으면 하중 경로가 왜곡된다.
_CONSTRAINT_CARDS = frozenset({
    "SPC", "SPC1", "SPCD", "SPCAX", "SPCADD", "SUPORT", "SUPORT1",
})


def extract_bulk_lines(text: str) -> List[str]:
    """BDF 텍스트에서 Bulk Data 영역만 뽑는다.

    BEGIN BULK 다음 줄부터 ENDDATA 직전까지. BEGIN BULK 가 없으면
    (Bulk 만 담긴 include 파일 등) 전체를 Bulk 로 본다.
    """
    lines = text.splitlines()
    begin = None
    for index, raw in enumerate(lines):
        if raw.strip().upper().startswith("BEGIN BULK"):
            begin = index
            break
    body = lines[begin + 1:] if begin is not None else lines

    result: List[str] = []
    for raw in body:
        if raw.strip().upper().startswith("ENDDATA"):
            break
        result.append(raw)
    return result


def _card_name(raw: str) -> str:
    """줄의 카드명. 고정필드는 앞 8칸, free-field 는 첫 콤마 앞."""
    head = raw.split(",")[0] if "," in raw[:_MAX_FIELD + 1] else raw[:_MAX_FIELD]
    return head.strip().upper().rstrip("*")


# 하중 집합 ID(SID)를 쓰는 카드들. build_stress_bdf 가 만드는 GRAV 와 SID 가 겹치면
# Nastran 이 "USER FATAL MESSAGE 9994 (BULKPM) ... Entry was found previously with the
# same key(s)." 로 **즉시 죽는다**(실제 Nastran 으로 재현 확인).
# SPC 계열은 strip_constraint_cards 가 전부 걷어내므로 SPC_SID 는 겹칠 수 없다.
_LOAD_CARDS = frozenset({
    "GRAV", "FORCE", "FORCE1", "FORCE2", "MOMENT", "MOMENT1", "MOMENT2",
    "PLOAD", "PLOAD1", "PLOAD2", "PLOAD4", "PLOADX1",
    "LOAD", "LSEQ", "RFORCE", "SLOAD", "DAREA", "DEFORM", "TEMP", "TEMPD",
})


def _card_fields(raw: str) -> List[str]:
    """카드명을 뺀 필드 목록. 고정필드·free-field 양쪽을 읽는다.

    원본 BDF 는 외부에서 오므로 양식을 강제할 수 없다.
    """
    if "," in raw[:_MAX_FIELD + 1]:
        return [field.strip() for field in raw.split(",")[1:]]
    return [raw[i:i + _MAX_FIELD].strip()
            for i in range(_MAX_FIELD, len(raw), _MAX_FIELD)]


# 양 끝 절점을 갖는 1차원 요소. 특이 절점이 어느 부재에 붙어 있는지 되짚을 때 쓴다.
_LINE_ELEMENT_CARDS = frozenset({"CBEAM", "CBAR", "CROD", "CONROD", "CTUBE", "CBUSH", "CBEND"})


def element_node_map(bulk_lines: Iterable[str]) -> Dict[int, Tuple[int, int]]:
    """1차원 요소의 EID -> (GA, GB) 지도.

    F06 특이도 표는 **절점** 으로만 말하는데 응력 평가는 **요소** 단위라, 둘을 잇는
    다리가 없으면 "특이가 이 결과를 실제로 오염시켰는가"를 판단할 수 없다.
    """
    mapping: Dict[int, Tuple[int, int]] = {}
    for raw in bulk_lines:
        if _card_name(raw) not in _LINE_ELEMENT_CARDS:
            continue
        fields = _card_fields(raw)
        # EID PID GA GB ... (CONROD 는 EID GA GB MID 라 배치가 다르다)
        try:
            eid = int(fields[0])
            if _card_name(raw) == "CONROD":
                ga, gb = int(fields[1]), int(fields[2])
            else:
                ga, gb = int(fields[2]), int(fields[3])
        except (IndexError, ValueError):
            continue
        mapping[eid] = (ga, gb)
    return mapping


def next_free_load_sid(bulk_lines: Iterable[str], preferred: int = LOAD_SID) -> int:
    """원본이 쓰지 않는 하중 SID 를 고른다.

    "99xxxx 대역이면 안 겹칠 것"은 검증되지 않은 가정이다 — 같은 관행을 쓰는 다른
    사내 생성기가 만든 BDF 가 들어오면 오히려 겹칠 확률이 높다. 겹치면 해석이
    원인 불명의 FATAL 로 죽으므로, 사용자에게 BDF 를 고쳐 오라고 하는 대신
    비어 있는 SID 를 찾아 쓴다.
    """
    used = set()
    for raw in bulk_lines:
        stripped = raw.strip()
        if not stripped or stripped.startswith("$"):
            continue
        if _card_name(raw) not in _LOAD_CARDS:
            continue
        fields = _card_fields(raw)
        if fields and fields[0].lstrip("+-").isdigit():
            used.add(int(fields[0]))

    sid = int(preferred)
    while sid in used:
        sid += 1
    return sid


def _is_continuation(raw: str) -> bool:
    """이 줄이 앞 카드의 연속행인가.

    세 가지 형태를 모두 봐야 한다 — 원본 BDF 는 외부에서 오므로 양식을 강제할 수 없다.
      · 고정필드: 첫 8칸이 비어 있다
      · 연속 마커: '+' 또는 '*' 로 시작
      · free-field: 콤마로 시작한다(',5,123456,...')
    free-field 를 빠뜨리면 구속 카드 본문만 지워지고 그 연속행이 살아남아,
    콤마로 시작하는 **깨진 조각**이 생성 BDF 에 그대로 실린다.
    """
    stripped = raw.lstrip()
    if stripped.startswith(","):
        return True
    head = raw[:_MAX_FIELD]
    return head.strip() == "" or stripped.startswith(("+", "*"))


def strip_cards(bulk_lines: Iterable[str], names: frozenset) -> Tuple[List[str], dict]:
    """지정한 카드와 그 continuation 줄을 걷어낸다.

    반환: (남은 줄, {카드명: 제거 개수})
    """
    kept: List[str] = []
    removed: dict = {}
    dropping = False

    for raw in bulk_lines:
        stripped = raw.strip()
        if not stripped or stripped.startswith("$"):
            # 주석·빈 줄은 continuation 판정을 흔들지 않는다(카드 사이에 낄 수 있다).
            kept.append(raw)
            continue
        name = _card_name(raw)
        if name in names:
            removed[name] = removed.get(name, 0) + 1
            dropping = True
            continue
        if dropping and _is_continuation(raw):
            continue
        dropping = False
        kept.append(raw)

    return kept, removed


def strip_constraint_cards(bulk_lines: Iterable[str]) -> Tuple[List[str], dict]:
    """SPC 계열·SUPORT 계열 카드와 그 continuation 줄을 걷어낸다."""
    return strip_cards(bulk_lines, _CONSTRAINT_CARDS)


def strip_load_cards(bulk_lines: Iterable[str]) -> Tuple[List[str], dict]:
    """하중 카드를 걷어낸다.

    원본 정반 BDF 는 자기 GRAV(설계 g)를 품고 있다. 그대로 두면 우리가 넣는 GRAV 와
    SID 가 겹쳐 FATAL 9994 로 죽거나, 안 겹치면 **하중이 두 번 걸린 채** 조용히 풀린다.
    """
    return strip_cards(bulk_lines, _LOAD_CARDS)


def _chunks(values: Sequence[Any], size: int) -> List[List[Any]]:
    return [list(values[i:i + size]) for i in range(0, len(values), size)]


def rigid_dependent_nodes(bulk_lines: Iterable[str]) -> set:
    """RBE2 의 dependent(GM) 절점 ID 집합.

    이 절점들의 자유도는 m-set 이라 **SPC 로 구속할 수 없다.** 걸면 Nastran 이
    "USER FATAL MESSAGE 2101 (GP4) ... ILLEGALLY DEFINED IN SETS UM US" 로 죽는다
    (실제 Nastran 으로 재현 확인). 과정 2 는 기둥 빔으로 m-set 과 s-set 을 갈라 놨지만,
    과정 1 은 원본 모델에 그대로 SPC 를 걸기 때문에 여기서 걸러 내야 한다.

    RBE2 만 본다 — ModelBuilder 가 만드는 Module Unit BDF 의 강체는 전부 RBE2 다.
    다른 강체 카드(RBAR/RBE3/RROD…)가 섞인 모델이 들어오면 이 필터를 넓혀야 한다.
    """
    dependents = set()
    collecting = False
    for raw in bulk_lines:
        stripped = raw.strip()
        if not stripped or stripped.startswith("$"):
            continue
        if _card_name(raw) == "RBE2":
            # RBE2 EID GN CM GM1 GM2 ... — 앞 3필드는 dependent 가 아니다.
            fields = _card_fields(raw)[3:]
            collecting = True
        elif collecting and _is_continuation(raw):
            fields = _card_fields(raw)
        else:
            collecting = False
            continue
        for token in fields:
            # 마지막 필드는 ALPHA(열팽창계수, 실수)일 수 있다 — 소수점이 있으면 절점이 아니다.
            if token and "." not in token and token.lstrip("+-").isdigit():
                dependents.add(int(token))
    return dependents


# 해석 안정화 PARAM. 같은 Module Unit 모델을 돌리는 GMU 권상 파이프라인
# (nastran_bridge 의 lifting/validation BDF)이 쓰는 것과 동일한 정책이다.
#   AUTOSPC — 강성이 0 인 자유도만 자동 구속한다(하중을 못 받는 DOF 라 결과에 영향 없음).
#   BAILOUT — mechanism 이 남아도 멈추지 않고 계속 푼다.
# 이게 없으면 MU 모델을 접촉 절점 몇 개로 지지할 때 USER FATAL 9050
# (EXCESSIVE PIVOT RATIOS IN MATRIX KLL)로 죽는다(실제 Nastran 으로 재현 확인).
# ⚠ 조용히 넘어가지 않도록 F06 의 AUTOSPC·피벗 경고를 걷어 결과에 함께 싣는다
#   (module_ocean_results.scan_f06_warnings).
_STABILIZATION_PARAMS = ("AUTOSPC", "BAILOUT")


def stabilization_param_lines(bulk_lines: Iterable[str]) -> List[str]:
    """원본에 없는 안정화 PARAM 만 만든다.

    같은 PARAM 을 두 번 넣으면 Nastran 이 경고를 내고, 원본이 의도적으로 다른 값을
    지정했을 수도 있다 — 원본의 선택을 덮어쓰지 않는다.
    """
    present = set()
    for raw in bulk_lines:
        if _card_name(raw) != "PARAM":
            continue
        fields = _card_fields(raw)
        if fields:
            present.add(fields[0].strip().upper())

    lines = []
    if "AUTOSPC" not in present:
        lines.append("PARAM,AUTOSPC,YES")
    if "BAILOUT" not in present:
        lines.append("PARAM,BAILOUT,-1")
    return lines


# 1차원 요소 — "빔만으로 이어져 있는가" 를 따질 때의 연결선.
_LINE_ELEMENT_CARDS_FOR_GRAPH = _LINE_ELEMENT_CARDS

def _grid_points(bulk_lines: Iterable[str]) -> Dict[int, Tuple[float, float, float]]:
    """GRID -> (x, y, z). 좌표계(CP)는 무시한다 — 여기 쓰임은 '세 점이 한 직선 위인가'
    뿐이라 국소 좌표계가 섞여도 판정이 뒤집히지 않는다(오히려 보수적으로 나온다)."""
    points: Dict[int, Tuple[float, float, float]] = {}
    for raw in bulk_lines:
        if _card_name(raw) != "GRID":
            continue
        fields = _card_fields(raw)
        try:
            points[int(fields[0])] = (
                _parse_real(fields[2]), _parse_real(fields[3]), _parse_real(fields[4]))
        except (IndexError, ValueError):
            continue
    return points


def _spans_a_plane(points: Sequence[Tuple[float, float, float]]) -> bool:
    """세 점 이상이 **한 직선 위가 아닌가**.

    강체는 비공선 3점을 병진 구속해야 완전히 고정된다. 2점이거나 모두 한 직선 위면
    그 축으로 여전히 돌 수 있다 — 그게 3521 에서 변위가 1e12 mm 로 폭주한 원인이다.
    """
    if len(points) < 3:
        return False
    origin = points[0]

    def sub(a, b):
        return (a[0] - b[0], a[1] - b[1], a[2] - b[2])

    def norm(v):
        return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])

    # 가장 먼 점으로 기준 축을 잡는다(짧은 변으로 잡으면 수치오차에 흔들린다).
    axis = max((sub(p, origin) for p in points[1:]), key=norm, default=(0.0, 0.0, 0.0))
    span = norm(axis)
    if span <= 0.0:
        return False
    tol = max(1.0, span * 1.0e-6)        # 1mm 또는 상대 1e-6 중 큰 쪽
    for p in points[1:]:
        d = sub(p, origin)
        cross = (axis[1] * d[2] - axis[2] * d[1],
                 axis[2] * d[0] - axis[0] * d[2],
                 axis[0] * d[1] - axis[1] * d[0])
        if norm(cross) / span > tol:     # 축에서 떨어진 거리
            return True
    return False


# 조각이 회전으로 떠나가는 것을 막아야 할 때만 쓰는 완전 강결.
_FULL_CM = "123456"

# 고박 승격이 잡는 자유도 — **병진 3개만**. 회전(456)은 건드리지 않는다.
#
# ★ 왜 회전을 빼는가 — 고박(sea-fastening)은 화물이 **미끄러지거나 뜨는 것**을 막는
#   것이지 회전 강결(모멘트 연결)을 뜻하지 않는다. 회전까지 잡으면 **두 강체 사이에
#   끼인 짧은 부재**가 그 회전차를 통째로 흡수해 실재하지 않는 모멘트를 받는다.
#
#   실측(3521, 정반 A, LC1 · 소구경 배관 제외 후):
#     원본(운전조건 그대로) 최대 164.3MPa 초과 0 · 최대변위 214.5mm
#     123456 승격          최대 459.4MPa 초과 2 · 최대변위  34.1mm
#     123 승격(현재)       최대 137.4MPa 초과 0 · 최대변위  45.6mm
#   123456 의 지배 부재 EID 3510/3509 는 `L 50×50×6` 앵글 182mm 두 개인데, 한쪽 절점이
#   RBE2 679(원래 CM=12)의 종속이라 회전을 잡는 순간 30.0 → 459.4MPa 가 됐다.
#   병진만 잡으면 변위 억제 효과(214.5 → 45.6mm)는 그대로 남으면서 이 가짜 모멘트가
#   사라진다(사용자 결정, 2026-09-08).
_SEA_FASTEN_CM = "123"


def _replace_field(raw: str, index: int, value: str) -> str:
    """카드의 index 번째 필드만 바꾼다(카드명이 0번).

    줄을 다시 조립하지 않고 **해당 칸만 덮어쓴다** — RBE2 첫 줄은 GM5 까지 8개
    데이터 필드를 꽉 채울 수 있어서, 재조립하면 열이 밀려 연속행이 끊길 위험이 있다.
    """
    if "," in raw[:_MAX_FIELD + 1]:
        parts = raw.split(",")
        if index >= len(parts):
            return raw
        parts[index] = value
        return ",".join(parts)
    start = index * _MAX_FIELD
    if start >= len(raw):
        return raw
    padded = raw.ljust(start + _MAX_FIELD)
    # 이 파일의 다른 필드와 같은 우측정렬(_field 규약)을 지킨다.
    return (padded[:start] + value.rjust(_MAX_FIELD) + padded[start + _MAX_FIELD:]).rstrip()


def _parse_rbe2_records(bulk_lines: List[str]) -> List[dict]:
    """RBE2 를 (첫 줄 인덱스, GN, CM, GM 목록) 으로 읽는다."""
    records = []
    index = 0
    while index < len(bulk_lines):
        if _card_name(bulk_lines[index]) != "RBE2":
            index += 1
            continue
        fields = _card_fields(bulk_lines[index])
        try:
            gn = int(fields[1])
        except (IndexError, ValueError):
            index += 1
            continue
        cm = fields[2].strip() if len(fields) > 2 else ""
        gms: List[int] = []
        cursor, first = index, True
        while cursor < len(bulk_lines):
            for token in _card_fields(bulk_lines[cursor])[3 if first else 0:]:
                # ALPHA(열팽창계수)는 소수점이 있어 절점 ID 와 구분된다.
                if not token or "." in token:
                    continue
                try:
                    gms.append(int(token))
                except ValueError:
                    continue
            first = False
            cursor += 1
            if cursor >= len(bulk_lines) or not _is_continuation(bulk_lines[cursor]):
                break
        records.append({"line": index, "gn": gn, "cm": cm, "gms": gms})
        index = cursor
    return records


def _beam_components(bulk_lines: List[str]) -> Dict[int, int]:
    """절점 -> 빔 연결 성분 번호. 빔이 안 닿는 절점은 자기 자신만의 성분이 된다."""
    adjacency: Dict[int, set] = {}
    for raw in bulk_lines:
        if _card_name(raw) not in _LINE_ELEMENT_CARDS_FOR_GRAPH:
            continue
        fields = _card_fields(raw)
        try:
            if _card_name(raw) == "CONROD":
                a, b = int(fields[1]), int(fields[2])
            else:
                a, b = int(fields[2]), int(fields[3])
        except (IndexError, ValueError):
            continue
        adjacency.setdefault(a, set()).add(b)
        adjacency.setdefault(b, set()).add(a)

    component: Dict[int, int] = {}
    next_id = 0
    for node in adjacency:
        if node in component:
            continue
        stack = [node]
        component[node] = next_id
        while stack:
            current = stack.pop()
            for neighbour in adjacency.get(current, ()):
                if neighbour not in component:
                    component[neighbour] = next_id
                    stack.append(neighbour)
        next_id += 1
    return component


def promote_partial_rigid_cm(
    bulk_lines: Iterable[str], *, spc_node_ids: Iterable[int],
) -> Tuple[List[str], dict]:
    """Module Unit 의 **모든** 부분 구속 RBE2 에 병진 3개(123)를 채워 고박 상태로 만든다.

    ★ 왜 전부인가 — 해상 운송 검토는 **고박(sea-fastening)된 상태**를 푸는 것이다.
      입력 BDF 는 플랜트 운전 조건 그대로라 배관 지지가 미끄러지는 지지(CM=13 처럼
      한두 축만 잡는 것)로 모델링돼 있다. 운전 중 열팽창을 흘려보내려는 의도지만,
      **운송 가속도는 그 자유 방향으로 그대로 들어온다.**

      실측(3521, 정반 A, LC1 ay=0.255g): OD406.4 배관 15.3m 런의 지지 3점 중 상부
      2점이 CM=13(X·Z 만 구속, **Y 자유**)이라 배관이 Y 로 **214mm** 흔들렸다. 그
      배관에 매달린 소구경 배관이 끌려가며 기생 굽힘을 받아 응력이 500MPa 대로 튀었다.

    ★ 왜 병진만인가 — 회전(456)까지 잡으면 두 강체 사이에 끼인 짧은 부재가 그 회전차를
      흡수해 실재하지 않는 모멘트를 받는다. 자세한 실측 근거는 `_SEA_FASTEN_CM` 주석 참조.
      요약하면 123456 은 최대 응력을 459.4MPa(초과 2개)로 **올려 놓았고**, 123 은
      변위 억제 효과(214.5 → 45.6mm)를 유지하면서 최대 137.4MPa(초과 0)를 준다.

    ⚠ 이미 잡고 있는 자유도는 절대 빼지 않는다 — CM 을 "123" 으로 덮어쓰는 것이 아니라
      합집합으로 올린다(CM=45 → 12345). 덮어쓰면 원래 있던 회전 구속이 풀린다.

    ⚠ 이는 미끄러지는 연결로 의도한 모델링을 바꾸는 것이라, 어떤 EID 를 올렸는지
      반환값·생성 BDF 주석·결과 화면에 모두 남겨 나중에 되짚을 수 있게 한다.

    ⚠ m-set 중복(같은 절점의 같은 자유도가 두 RBE2 의 종속이 되는 것)은 Nastran 이
      `USER FATAL 2101` 로 거부하므로 그런 승격은 건너뛰고 개수만 보고한다.

    부수 효과로 예전 목적(부분 구속 RBE2 로만 매달린 조각의 강체 자유운동)도 함께
    사라진다 — 병진이 묶이면 그 조각은 떠나갈 수 없다.
    `ungroundedComponentCount` 는 승격 뒤에도 빔만으로 접지되지 않은 조각이 남는지를
    보는 진단값으로 계속 돌려준다(남아 있으면 여전히 자유운동 위험이 있다).
    """
    lines = list(bulk_lines)
    records = _parse_rbe2_records(lines)
    component = _beam_components(lines)
    if not records:
        return lines, {"promotedEids": [], "escalatedEids": [],
                       "ungroundedComponentCount": 0, "skippedConflictCount": 0}

    # 이미 종속인 자유도 — 승격이 이걸 침범하면 안 된다.
    dependent_dof: Dict[int, set] = {}
    for record in records:
        for gm in record["gms"]:
            dependent_dof.setdefault(gm, set()).update(record["cm"])

    promoted: List[int] = []
    skipped = 0
    for record in records:
        missing = set(_SEA_FASTEN_CM) - set(record["cm"])
        if not missing:
            continue
        # 이미 갖고 있는 자유도는 **절대 빼지 않는다** — CM=45 를 "123" 으로 덮어쓰면
        # 원래 잡고 있던 회전이 풀린다. 합집합으로 올린다(예: 45 → 12345).
        target = "".join(sorted(set(record["cm"]) | set(_SEA_FASTEN_CM)))
        # 이 RBE2 가 새로 잡으려는 자유도를 **다른** RBE2 가 이미 종속으로 갖고 있으면 충돌이다.
        clash = any((dependent_dof.get(gm, set()) - set(record["cm"])) & missing
                    for gm in record["gms"])
        if clash:
            skipped += 1
            continue
        lines[record["line"]] = _replace_field(lines[record["line"]], 3, target)
        for gm in record["gms"]:
            dependent_dof.setdefault(gm, set()).update(target)
        record["cm"] = target
        fields = _card_fields(lines[record["line"]])
        try:
            promoted.append(int(fields[0]))
        except (IndexError, ValueError):
            pass

    # ── 2차: 조각이 **회전으로 떠나가지 않는가** ────────────────────────────
    #
    # ★ 이 단계가 없으면 병진만 잡은 것이 그대로 mechanism 이 된다. 실측(3521):
    #   L 50×50×6 앵글 8개로 된 9절점 조각이 RBE2 하나(EID 618, 원래 CM=13)로
    #   **절점 한 개에만** 매달려 있었다. 123456 이던 시절에는 그 한 점이 완전
    #   강결이라 조각이 고정됐는데, 병진(123)만 잡으니 그 점을 축으로 자유 회전해
    #   최대 변위가 **3.4e12 mm** 로 폭주했다(PARAM,BAILOUT 이라 해석은 끝까지 간다).
    #
    #   강체를 고정하려면 **한 점 완전구속** 이거나 **비공선 3점** 이 필요하다.
    #   그래서 조각마다 접지 상태를 따져, 그 조건을 못 채우는 조각의 연결만
    #   골라 123456 으로 올린다(escalatedEids). 나머지는 123 그대로라 짧은 부재의
    #   가짜 모멘트 문제도 그대로 피한다 — 실측에서 승격 53개 중 올라간 것은 소수다.
    escalated: List[int] = []
    ungrounded = 0
    if component:
        supported = {int(n) for n in spc_node_ids}
        grounded = {component[n] for n in supported if n in component}
        points = _grid_points(lines)

        def comps_of(record) -> set:
            return {component[g] for g in [record["gn"], *record["gms"]] if g in component}

        def nodes_in(record, cid) -> List[int]:
            return [g for g in [record["gn"], *record["gms"]]
                    if component.get(g) == cid]

        def escalate(record) -> bool:
            """이 RBE2 를 123456 으로. m-set 충돌이면 손대지 않고 False."""
            missing_rot = set(_FULL_CM) - set(record["cm"])
            if not missing_rot:
                return True
            if any((dependent_dof.get(gm, set()) - set(record["cm"])) & missing_rot
                   for gm in record["gms"]):
                return False
            lines[record["line"]] = _replace_field(lines[record["line"]], 3, _FULL_CM)
            for gm in record["gms"]:
                dependent_dof.setdefault(gm, set()).update(_FULL_CM)
            record["cm"] = _FULL_CM
            fields = _card_fields(lines[record["line"]])
            try:
                eid = int(fields[0])
            except (IndexError, ValueError):
                return True
            escalated.append(eid)
            if eid not in promoted:
                promoted.append(eid)
            return True

        all_components = set(component.values())
        changed = True
        while changed:
            changed = False
            for cid in sorted(all_components - grounded):
                # 이 조각을 **이미 접지된 쪽** 과 잇는 RBE2 들.
                ties = [r for r in records
                        if cid in comps_of(r) and (comps_of(r) - {cid}) & grounded]
                if not ties:
                    continue
                if any(set(_FULL_CM) <= set(r["cm"]) for r in ties):
                    grounded.add(cid); changed = True; continue
                anchors = {n for r in ties if set(_SEA_FASTEN_CM) <= set(r["cm"])
                           for n in nodes_in(r, cid)}
                if _spans_a_plane([points[n] for n in anchors if n in points]):
                    grounded.add(cid); changed = True; continue
                # 병진만으로는 회전을 못 막는다 — 연결 하나를 완전 강결로 올린다.
                if any(escalate(r) for r in ties):
                    grounded.add(cid); changed = True
        ungrounded = len(all_components - grounded)

    return lines, {
        "promotedEids": sorted(promoted),
        # 그중 조각의 자유 회전을 막으려고 회전까지 잡은 것.
        "escalatedEids": sorted(escalated),
        "ungroundedComponentCount": ungrounded,
        "skippedConflictCount": skipped,
    }


# ── 소구경 배관 식별 ─────────────────────────────────────────────────────────

# 판정에서 제외할 배관의 외경 상한(mm). NPS 2"(OD 60.3) 이하를 배관 업계에서
# small-bore 로 부르는 통상 정의를 따르고, 공칭 60.3 과 도면 표기 60.4 를 모두
# 담도록 60.5 로 둔다.
#
# ★ 왜 제외하는가 — 이 해석의 평가 대상은 **모듈의 구조 부재**다. 소구경 배관은
#   화물이지 부재가 아니고, 실제 지지 상세(슈·클램프·U볼트)가 BDF 에 없어
#   "관 하나가 배관 계통 전체의 유일한 앵커"로 모델링돼 있다. 실측(3521): 최대
#   응력 요소 EID 287 은 길이 56mm 짜리 OD33.4 관인데 126kg 배관 조각을 지렛대
#   429mm 로 혼자 받아 452MPa 가 나온다. 이건 부재가 위험하다는 신호가 아니라
#   모델링 상세의 산물이다. 실제로 허용 초과 38개가 **전부** OD33.4(36) +
#   OD60.4(2) 였고, 이들을 빼면 최대 512.5 → 164.3MPa(사용률 0.75, 초과 0)로
#   참조 모델(FEModel_1) 최대 156.8MPa 와 같은 수준이 된다.
#
# ⚠ 제외는 **판정에서만** 한다. 요소는 모델에 그대로 남아 질량·강성으로 기여하고,
#   결과에도 별도 목록으로 실린다(module_ocean_results.evaluate_stress).
DEFAULT_SMALL_BORE_MAX_OD_MM = 60.5

# 외경을 읽어낼 수 있는 property 카드. PBEAML 은 TYPE 이 TUBE/TUBE2 일 때만,
# PTUBE 는 항상 외경을 갖는다. PROD 는 면적만 있어 외경을 복원할 수 없다.
_TUBE_BEAML_TYPES = frozenset({"TUBE", "TUBE2"})


def _pbeaml_outer_diameters(bulk_lines: List[str]) -> Dict[int, float]:
    """PID -> 관 외경(mm). 관이 아닌 단면은 담지 않는다."""
    diameters: Dict[int, float] = {}
    for index, raw in enumerate(bulk_lines):
        name = _card_name(raw)
        if name == "PTUBE":
            # PTUBE PID MID OD T
            fields = _card_fields(raw)
            try:
                diameters[int(fields[0])] = _parse_real(fields[2])
            except (IndexError, ValueError):
                continue
            continue
        if name != "PBEAML":
            continue
        fields = _card_fields(raw)
        try:
            pid = int(fields[0])
        except (IndexError, ValueError):
            continue
        # PBEAML PID MID GROUP TYPE ... — GROUP 은 비어 있을 수 있고 TYPE 은 4번째다.
        section = (fields[3] if len(fields) > 3 else "").upper()
        if section not in _TUBE_BEAML_TYPES:
            continue
        dims: List[float] = []
        cursor = index + 1
        while cursor < len(bulk_lines) and _is_continuation(bulk_lines[cursor]):
            for token in _card_fields(bulk_lines[cursor]):
                if not token:
                    continue
                try:
                    dims.append(_parse_real(token))
                except ValueError:
                    pass
            cursor += 1
        # TUBE  = [Ro, Ri], TUBE2 = [Ro, t]. 어느 쪽이든 DIM1 이 외반경이다.
        if dims:
            diameters[pid] = dims[0] * 2.0
    return diameters


def small_bore_element_ids(
    bulk_lines: Iterable[str], *, max_od_mm: float = DEFAULT_SMALL_BORE_MAX_OD_MM,
) -> Dict[int, float]:
    """외경이 기준 이하인 관 요소의 {EID: 외경mm}.

    max_od_mm 이 0 이하면 빈 dict — "제외 안 함"을 이 함수 하나에서 표현한다.
    호출부가 따로 분기하지 않아도 되도록 여기서 막는다.
    """
    if max_od_mm <= 0:
        return {}
    lines = list(bulk_lines)
    diameters = _pbeaml_outer_diameters(lines)
    if not diameters:
        return {}
    found: Dict[int, float] = {}
    for raw in lines:
        if _card_name(raw) not in _LINE_ELEMENT_CARDS:
            continue
        fields = _card_fields(raw)
        try:
            eid = int(fields[0])
            outer = diameters[int(fields[1])]
        except (IndexError, ValueError, KeyError):
            continue
        if outer <= max_od_mm:
            found[eid] = outer
    return found
