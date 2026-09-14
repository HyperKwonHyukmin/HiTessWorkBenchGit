"""Module Unit 해상 운송 — 정반 BDF + Module Unit BDF 합본 유틸 (순수 함수).

파일 I/O 도 subprocess 도 타지 않는다. 줄 목록이 들어가 줄 목록이 나온다.

왜 합치나:
    예전에는 Module Unit 만 떼어내 접촉 절점에 SPC 를 걸고(과정 1), 정반은 CoG 질점 +
    가짜 기둥 6개짜리 모델로 따로 풀었다(과정 2). 정반의 실제 강성이 어디에도 없어서
    ① Unit 응력은 무한강성 지지 위에서 계산됐고 ② Leg 반력의 모멘트는 임의로 세운
    기둥 높이가 정하는 값이었다. 이제 두 모델을 실제로 이어 한 번에 푼다.

왜 ID 를 통째로 밀어야 하나:
    정반 A 는 GRID 1~102736 / 요소 1~99740, Module Unit(3521)은 GRID 1~2882 /
    요소 77~4034 다. **완전히 겹친다.** 그냥 이어 붙이면 Nastran 이 중복 정의로
    죽거나(운이 좋으면), 조용히 남의 절점을 참조하는 모델이 된다(운이 나쁘면).

왜 카드별 필드표를 손으로 들고 있나:
    "숫자처럼 보이면 다 민다" 는 좌표·두께·밀도까지 밀어 버린다. 반대로 모르는 카드를
    그냥 통과시키면 참조가 어긋난 채 해석이 돌아 **결과만 틀린다**. 그래서 아는 카드만
    다루고 모르는 카드는 이름을 대며 멈춘다. 여기에 renumber 뒤 참조 무결성 검사
    (`verify_renumbered`)를 한 겹 더 두어, 표에서 빠뜨린 필드도 잡히게 했다.
"""
from __future__ import annotations

import math
from typing import Dict, Iterable, List, Sequence, Tuple

from .module_ocean_bdf import (
    _card_fields,
    _card_name,
    _is_continuation,
    _parse_real,
    _replace_field,
    real8,
)

# 정반 최대 ID(GRID 102736 / 요소 99740)를 넉넉히 넘는 자리. Module Unit 쪽을 민다 —
# 카드 수가 정반의 1/10 이라 다뤄야 할 카드 종류도 훨씬 적다.
ID_OFFSET = 200000

# 정반 상판으로 묶을 z 허용오차. 상판은 z=8026 한 장이라 1mm 면 충분하다.
PLATE_TOL_MM = 1.0

# 지지점 ↔ 정반 상판 절점 연결의 경고 거리. 상판 격자가 약 200~250mm 라
# 이보다 멀면 "가장 가까운 절점" 이 사실은 꽤 떨어져 있다는 뜻이다.
PAIR_WARN_MM = 400.0


class MergeError(RuntimeError):
    """합본 도중 조용히 틀리느니 멈춰야 하는 상황."""


# ── ID 필드표 ────────────────────────────────────────────────────────────────
# 필드 번호는 _replace_field 규약(카드명 = 0, 첫 데이터 필드 = 1)을 따른다.
_GRID, _ELEM, _PROP, _MAT, _COORD = "grid", "elem", "prop", "mat", "coord"

_ID_ROLES: Dict[str, Dict[int, str]] = {
    "GRID":   {1: _GRID, 2: _COORD, 6: _COORD},
    "CBEAM":  {1: _ELEM, 2: _PROP, 3: _GRID, 4: _GRID},   # 5번은 X1 또는 G0 — 따로 본다
    "CBAR":   {1: _ELEM, 2: _PROP, 3: _GRID, 4: _GRID},
    "CBUSH":  {1: _ELEM, 2: _PROP, 3: _GRID, 4: _GRID},
    "CROD":   {1: _ELEM, 2: _PROP, 3: _GRID, 4: _GRID},
    "CTUBE":  {1: _ELEM, 2: _PROP, 3: _GRID, 4: _GRID},
    "CVISC":  {1: _ELEM, 2: _PROP, 3: _GRID, 4: _GRID},
    "CONROD": {1: _ELEM, 2: _GRID, 3: _GRID, 4: _MAT},
    "CQUAD4": {1: _ELEM, 2: _PROP, 3: _GRID, 4: _GRID, 5: _GRID, 6: _GRID},
    "CTRIA3": {1: _ELEM, 2: _PROP, 3: _GRID, 4: _GRID, 5: _GRID},
    "CONM1":  {1: _ELEM, 2: _GRID, 3: _COORD},
    "CONM2":  {1: _ELEM, 2: _GRID, 3: _COORD},
    "CELAS1": {1: _ELEM, 2: _PROP, 3: _GRID, 5: _GRID},
    "CDAMP1": {1: _ELEM, 2: _PROP, 3: _GRID, 5: _GRID},
    "RBE2":   {1: _ELEM, 2: _GRID},                       # 4번 이후는 전부 GM — 따로 본다
    "PBEAM":  {1: _PROP, 2: _MAT},
    "PBEAML": {1: _PROP, 2: _MAT},
    "PBAR":   {1: _PROP, 2: _MAT},
    "PBARL":  {1: _PROP, 2: _MAT},
    "PROD":   {1: _PROP, 2: _MAT},
    "PTUBE":  {1: _PROP, 2: _MAT},
    "PSHELL": {1: _PROP, 2: _MAT, 4: _MAT, 6: _MAT},
    "PBUSH":  {1: _PROP},
    "PGAP":   {1: _PROP},
    "PVISC":  {1: _PROP},
    "PELAS":  {1: _PROP},
    "PDAMP":  {1: _PROP},
    "MAT1":   {1: _MAT},
    "MAT2":   {1: _MAT},
    "MAT8":   {1: _MAT},
    "MAT9":   {1: _MAT},
    "CORD2R": {1: _COORD, 2: _COORD},
    "CORD2C": {1: _COORD, 2: _COORD},
    "CORD2S": {1: _COORD, 2: _COORD},
}

# 연속행에 ID 가 이어지는 카드. RBE2 만이다(GM 목록).
_CONT_IDS = frozenset({"RBE2"})

# ID 를 갖지 않아 그대로 통과시켜도 되는 카드.
_NO_ID_CARDS = frozenset({"PARAM"})

# 정의(=이 ID 를 만든다) 필드. 참조 무결성 검사에서 "있는 ID 인가" 의 사전이 된다.
_DEFINES = {
    "GRID": _GRID, "CORD2R": _COORD, "CORD2C": _COORD, "CORD2S": _COORD,
    "PBEAM": _PROP, "PBEAML": _PROP, "PBAR": _PROP, "PBARL": _PROP,
    "PROD": _PROP, "PTUBE": _PROP, "PSHELL": _PROP, "PBUSH": _PROP,
    "PGAP": _PROP, "PVISC": _PROP, "PELAS": _PROP, "PDAMP": _PROP,
    "MAT1": _MAT, "MAT2": _MAT, "MAT8": _MAT, "MAT9": _MAT,
}


def _is_int_field(text: str) -> bool:
    """이 필드가 정수 ID 인가. 실수(소수점·Nastran 압축지수)는 ID 가 아니다."""
    body = text.strip()
    if not body:
        return False
    if body[0] in "+-":
        body = body[1:]
    return body.isdigit()


def _cbeam_g0_index(fields: List[str]) -> int | None:
    """CBEAM/CBAR 의 방향 정의가 G0(절점) 형식이면 그 필드 번호, X 벡터면 None.

    G0 형식은 5번 필드가 정수이고 6·7번이 비어 있다. X 벡터는 실수 3개다.
    이걸 구분하지 못하면 방향절점을 안 밀어서 **정반의 엉뚱한 절점**을 가리키게 된다.
    """
    if len(fields) < 5 or not _is_int_field(fields[4]):
        return None
    tail = [f.strip() for f in fields[5:7]]
    return 5 if not any(tail) else None


def _iter_cards(bulk_lines: Sequence[str]):
    """(첫 줄 인덱스, 카드명, 그 카드에 속한 줄 인덱스 목록) 을 차례로 낸다.

    주석·빈 줄은 어느 카드에도 속하지 않는다(카드 사이에 낄 수 있으므로).
    """
    index = 0
    total = len(bulk_lines)
    while index < total:
        raw = bulk_lines[index]
        stripped = raw.strip()
        if not stripped or stripped.startswith("$"):
            index += 1
            continue
        if _is_continuation(raw):        # 앞선 카드 없이 나온 연속행 — 그대로 흘린다
            index += 1
            continue
        name = _card_name(raw)
        rows = [index]
        cursor = index + 1
        while cursor < total:
            nxt = bulk_lines[cursor]
            if not nxt.strip() or nxt.strip().startswith("$"):
                cursor += 1
                continue
            if not _is_continuation(nxt):
                break
            rows.append(cursor)
            cursor += 1
        yield index, name, rows
        index = cursor


def renumber_bulk(bulk_lines: Sequence[str], *, offset: int = ID_OFFSET) -> List[str]:
    """Module Unit Bulk 의 모든 ID 를 offset 만큼 민다.

    좌표계 ID(CP/CD/CID)는 0(전역)일 때 건드리지 않는다 — 전역 좌표계는 두 모델이
    공유하는 유일한 ID 이고, 이것까지 밀면 존재하지 않는 좌표계를 가리키게 된다.

    모르는 카드가 나오면 이름을 대며 멈춘다. 조용히 통과시키면 참조가 어긋난 채
    해석이 정상 종료하고 **결과만 틀린다**.
    """
    lines = list(bulk_lines)

    for head, name, rows in _iter_cards(lines):
        if name in _NO_ID_CARDS:
            continue
        roles = _ID_ROLES.get(name)
        if roles is None:
            raise MergeError(
                f"Module Unit BDF 의 '{name}' 카드는 아직 합본 시 ID 재번호를 지원하지 않습니다. "
                "지원 카드를 추가해야 합니다(module_ocean_merge._ID_ROLES)."
            )

        fields = _card_fields(lines[head])
        for field_index, role in roles.items():
            if field_index > len(fields):
                continue
            text = fields[field_index - 1]
            if not _is_int_field(text):
                continue
            value = int(text)
            if role == _COORD and value == 0:
                continue                     # 전역 좌표계는 공유한다
            lines[head] = _replace_field(lines[head], field_index, str(value + offset))

        if name in ("CBEAM", "CBAR"):
            g0 = _cbeam_g0_index(fields)
            if g0 is not None:
                lines[head] = _replace_field(lines[head], g0, str(int(fields[g0 - 1]) + offset))

        if name == "RBE2":
            _renumber_rbe2(lines, head, rows, offset)

    return lines


def _renumber_rbe2(lines: List[str], head: int, rows: Sequence[int], offset: int) -> None:
    """RBE2 의 GM 목록(첫 줄 4번 필드부터, 연속행 전체)을 민다.

    마지막에 붙을 수 있는 ALPHA 는 실수라 _is_int_field 가 걸러 준다.
    """
    for row in rows:
        fields = _card_fields(lines[row])
        start = 4 if row == head else 1
        for field_index in range(start, len(fields) + 1):
            text = fields[field_index - 1]
            if _is_int_field(text):
                lines[row] = _replace_field(lines[row], field_index, str(int(text) + offset))


def collect_ids(bulk_lines: Sequence[str]) -> Dict[str, set]:
    """카드가 **정의하는** ID 를 종류별로 모은다(참조가 아니라 정의)."""
    found: Dict[str, set] = {_GRID: set(), _COORD: set(), _PROP: set(), _MAT: set(), _ELEM: set()}
    for head, name, _rows in _iter_cards(bulk_lines):
        fields = _card_fields(bulk_lines[head])
        if not fields or not _is_int_field(fields[0]):
            continue
        role = _DEFINES.get(name)
        if role is None:
            roles = _ID_ROLES.get(name) or {}
            if roles.get(1) == _ELEM:
                role = _ELEM
        if role is not None:
            found[role].add(int(fields[0]))
    return found


def verify_renumbered(bulk_lines: Sequence[str], *, defined: Dict[str, set]) -> None:
    """재번호 뒤 참조 무결성 — 요소가 가리키는 절점·물성이 전부 이 덱 안에 있는가.

    필드표에서 한 칸을 빠뜨리면 그 참조만 원래 값으로 남아 **정반 쪽 ID** 를 가리키게
    된다. 카드 종류를 늘릴 때 가장 나기 쉬운 실수라 여기서 한 겹 더 막는다.
    """
    for head, name, rows in _iter_cards(bulk_lines):
        roles = _ID_ROLES.get(name)
        if roles is None or name in _DEFINES:
            continue
        fields = _card_fields(bulk_lines[head])
        for field_index, role in roles.items():
            if role not in (_GRID, _PROP, _MAT) or field_index > len(fields):
                continue
            text = fields[field_index - 1]
            if _is_int_field(text) and int(text) not in defined[role]:
                raise MergeError(
                    f"{name} {fields[0]} 의 {field_index}번 필드가 이 모델에 없는 "
                    f"{role} ID {text} 를 가리킵니다 — 재번호가 새어 나갔습니다."
                )
        if name in _CONT_IDS:
            for row in rows:
                row_fields = _card_fields(bulk_lines[row])
                start = 4 if row == head else 1
                for field_index in range(start, len(row_fields) + 1):
                    text = row_fields[field_index - 1]
                    if _is_int_field(text) and int(text) not in defined[_GRID]:
                        raise MergeError(
                            f"RBE2 {fields[0]} 가 이 모델에 없는 절점 {text} 를 가리킵니다 "
                            "— 재번호가 새어 나갔습니다."
                        )


# ── 배치 변환 ────────────────────────────────────────────────────────────────

def _grid_coords(raw: str) -> Tuple[float, float, float]:
    fields = _card_fields(raw)
    def value(index: int) -> float:
        text = fields[index].strip() if index < len(fields) else ""
        return _parse_real(text) if text else 0.0
    return value(2), value(3), value(4)


def assert_global_coordinates(bulk_lines: Sequence[str]) -> None:
    """GRID 가 전역 좌표계에 있는지 확인한다.

    CP 가 0 이 아니면 X1~X3 은 그 좌표계의 값이라, 숫자만 회전·이동시키면 실제 위치는
    엉뚱한 데로 간다. 사내 Module Unit 덱은 전부 전역이라 지금은 거부로 충분하다.
    """
    for head, name, _rows in _iter_cards(bulk_lines):
        if name in ("CORD2R", "CORD2C", "CORD2S", "CORD1R", "CORD1C", "CORD1S"):
            raise MergeError(
                "Module Unit BDF 에 좌표계 카드(CORD)가 있습니다. "
                "합본 배치 변환은 아직 전역 좌표계 모델만 지원합니다."
            )
        if name != "GRID":
            continue
        fields = _card_fields(bulk_lines[head])
        for field_index in (2, 6):
            text = fields[field_index - 1].strip() if field_index <= len(fields) else ""
            if text and _is_int_field(text) and int(text) != 0:
                raise MergeError(
                    f"GRID {fields[0]} 가 전역이 아닌 좌표계({text})를 씁니다. "
                    "합본 배치 변환은 아직 전역 좌표계 모델만 지원합니다."
                )


def place_grid_lines(
    bulk_lines: Sequence[str],
    *,
    anchor_mm: Sequence[float],
    deck_center_mm: Sequence[float],
    deck_top_z_mm: float,
    offset_x_mm: float = 0.0,
    offset_y_mm: float = 0.0,
    rotation_z_deg: float = 0.0,
    gap_mm: float = 300.0,
) -> Tuple[List[str], Dict[str, float]]:
    """Module Unit GRID 를 정반 좌표계의 적치 위치로 옮긴다.

    화면(feGeometry.transformModulePoint)과 **같은 식**이어야 한다. 어긋나면 사용자가
    본 배치와 해석한 배치가 달라지는데, 결과만 보고는 알아챌 방법이 없다.

        X = deckCenter.x + offsetX + lx·cosθ - ly·sinθ
        Y = deckCenter.y + offsetY + lx·sinθ + ly·cosθ
        Z = deckTopZ + gap + lz                  (l = 좌표 - anchor)

    anchor 는 모듈 bbox 의 XY 중심 + 최저 Z 다. 그래서 Z 식의 gap 이 곧
    "모듈 최하단이 정반 상판보다 몇 mm 위인가" 가 된다. gap 은 호출부가
    **지지점 최하단이 상판 +clearance 에 오도록** 계산해 넘긴다.
    """
    lines = list(bulk_lines)
    ax, ay, az = (float(v) for v in anchor_mm)
    cx, cy = float(deck_center_mm[0]) + float(offset_x_mm), float(deck_center_mm[1]) + float(offset_y_mm)
    base_z = float(deck_top_z_mm) + float(gap_mm)
    theta = math.radians(float(rotation_z_deg))
    cos_t, sin_t = math.cos(theta), math.sin(theta)

    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    moved = 0

    def card_field(rows: Sequence[int], field_index: int) -> str:
        row_index, local_index = divmod(field_index - 1, 8)
        if row_index >= len(rows):
            return ""
        fields = _card_fields(lines[rows[row_index]])
        return fields[local_index] if local_index < len(fields) else ""

    def set_card_field(rows: Sequence[int], field_index: int, value: float) -> None:
        row_index, local_index = divmod(field_index - 1, 8)
        if row_index >= len(rows):
            raise MergeError(f"카드 연속행에 {field_index}번 필드가 없습니다.")
        row = rows[row_index]
        lines[row] = _replace_field(lines[row], local_index + 1, real8(round(value, 8)))

    def rotate_pair(rows: Sequence[int], x_field: int, y_field: int) -> None:
        x_text, y_text = card_field(rows, x_field).strip(), card_field(rows, y_field).strip()
        if not x_text and not y_text:
            return
        x = _parse_real(x_text) if x_text else 0.0
        y = _parse_real(y_text) if y_text else 0.0
        set_card_field(rows, x_field, x * cos_t - y * sin_t)
        set_card_field(rows, y_field, x * sin_t + y * cos_t)

    for head, name, rows in _iter_cards(lines):
        if name == "GRID":
            x, y, z = _grid_coords(lines[head])
            lx, ly, lz = x - ax, y - ay, z - az
            # 회전 행렬의 round-off(cos 90° = 6.1e-17)가 8칸 표기를 잡아먹지 않게 눌러 둔다.
            world = (
                round(cx + lx * cos_t - ly * sin_t, 4),
                round(cy + lx * sin_t + ly * cos_t, 4),
                round(base_z + lz, 4),
            )
            for axis in range(3):
                lines[head] = _replace_field(lines[head], 3 + axis, real8(world[axis]))
                lo[axis] = min(lo[axis], world[axis])
                hi[axis] = max(hi[axis], world[axis])
            moved += 1
        elif name in ("CBEAM", "CBAR"):
            fields = _card_fields(lines[head])
            if _cbeam_g0_index(fields) is None:
                rotate_pair(rows, 5, 6)       # 방향벡터 X1/X2
            rotate_pair(rows, 11, 12)         # WA 단부 오프셋
            rotate_pair(rows, 14, 15)         # WB 단부 오프셋
        elif name == "CONM2":
            cid = card_field(rows, 3).strip()
            if cid and int(cid) != 0:
                raise MergeError("CONM2 배치 회전은 전역 좌표계(CID=0)만 지원합니다.")
            rotate_pair(rows, 5, 6)           # 질량중심 편심 X1/X2

            inertia_text = [card_field(rows, i).strip() for i in range(8, 14)]
            if any(inertia_text):
                values = [_parse_real(v) if v else 0.0 for v in inertia_text]
                i11, i21, i22, i31, i32, i33 = values
                # 대칭 관성텐서 I' = Rz I Rz^T.
                new_i11 = cos_t*cos_t*i11 - 2*cos_t*sin_t*i21 + sin_t*sin_t*i22
                new_i21 = cos_t*sin_t*(i11-i22) + (cos_t*cos_t-sin_t*sin_t)*i21
                new_i22 = sin_t*sin_t*i11 + 2*cos_t*sin_t*i21 + cos_t*cos_t*i22
                new_i31 = cos_t*i31 - sin_t*i32
                new_i32 = sin_t*i31 + cos_t*i32
                for index, value in zip(range(8, 14),
                                        (new_i11, new_i21, new_i22, new_i31, new_i32, i33)):
                    set_card_field(rows, index, value)

    if not moved:
        raise MergeError("Module Unit BDF 에 GRID 카드가 없습니다.")

    return lines, {
        "gridCount": moved,
        "minMm": lo,
        "maxMm": hi,
        "bottomZMm": lo[2],
        "gapMm": lo[2] - float(deck_top_z_mm),
    }


# ── 정반 상판 절점 ───────────────────────────────────────────────────────────

def deck_shell_nodes(bulk_lines: Sequence[str]) -> Dict[int, Tuple[float, float, float]]:
    """정반 QUAD/TRIA 쉘이 실제로 쓰는 절점만 (id → 좌표) 로.

    지지점을 붙일 상대는 쉘이다 — 빔에만 붙은 절점이나 어디에도 안 붙은 절점에
    연결하면 하중이 상판을 거치지 않고 흘러 버린다.
    """
    coords: Dict[int, Tuple[float, float, float]] = {}
    used: set = set()
    for head, name, _rows in _iter_cards(bulk_lines):
        if name == "GRID":
            fields = _card_fields(bulk_lines[head])
            if fields and _is_int_field(fields[0]):
                coords[int(fields[0])] = _grid_coords(bulk_lines[head])
        elif name in ("CQUAD4", "CTRIA3"):
            fields = _card_fields(bulk_lines[head])
            want = 6 if name == "CQUAD4" else 5
            for text in fields[2:want]:
                if _is_int_field(text):
                    used.add(int(text))
    return {nid: coords[nid] for nid in used if nid in coords}


# 상판 경계 판정의 여유 [mm]. 회전 행렬 round-off(cos 90° = 6.1e-17)로 상판 끝에 정확히
# 걸친 절점이 -7e-14 만큼 밀린다. 프론트 feGeometry.PLATE_EPS_MM 과 같은 값이어야
# 화면에서 '상판 위'로 보이던 지지점이 서버에서 밖으로 판정되는 일이 없다.
PLATE_EPS_MM = 1.0e-6


def _inside(x: float, y: float, bbox: Tuple[float, float, float, float]) -> bool:
    """(x, y) 가 상판 bbox 안인가. 현재 A·B 정반 상판은 꽉 찬 사각형이다."""
    x0, y0, x1, y1 = bbox
    return (x0 - PLATE_EPS_MM <= x <= x1 + PLATE_EPS_MM
            and y0 - PLATE_EPS_MM <= y <= y1 + PLATE_EPS_MM)


# ── 정반 적치면(landing level) ───────────────────────────────────────────────
#
# 정반은 2단이다. A 는 상단 z=8026(125㎡, X 26260~33360) + 하단 z=2020(106㎡,
# X 20260~26260), B 는 상단 z=8026(231㎡) + 하단 z=2020(106㎡). 지지점은 그중
# **자기 발밑 층**에 앉는다 — 모듈 3521 은 바닥이 6,276mm 단차로 설계돼 있어
# 실제로 두 층에 걸쳐 앉는다. 상단 하나만 '상판' 으로 보던 시절엔 하단에 앉을
# 지지점이 전부 "상판 밖" 이 되어 3단계가 막혔다.
#
# 프론트 feGeometry.buildDeckSurface 와 **같은 규칙**이어야 한다:
#   · 네 절점(또는 세 절점)이 같은 높이인 쉘 요소만 후보(경사면·수직 웨브 제외)
#   · z 로 묶어 면적을 합치고, 전체 평평한 수평면적의 min_area_ratio 미만은 버린다
#     (z=-25 의 베이스 플레이트가 여기서 걸러진다 — 전체의 0.6%)
# 어긋나면 화면이 본 배치와 서버가 푼 배치가 달라지므로, build_combined_bdf 가
# 프론트가 보낸 gapMm 과 서버 계산값을 대조해 한 번 더 막는다.

MIN_LEVEL_AREA_RATIO = 0.05


def _shell_faces(bulk_lines: Sequence[str]) -> List[List[int]]:
    """CQUAD4/CTRIA3 의 절점 목록. 지지점을 붙일 상대는 쉘이다."""
    faces: List[List[int]] = []
    for head, name, _rows in _iter_cards(bulk_lines):
        if name not in ("CQUAD4", "CTRIA3"):
            continue
        fields = _card_fields(bulk_lines[head])
        want = 6 if name == "CQUAD4" else 5
        nodes = [int(t) for t in fields[2:want] if _is_int_field(t)]
        if len(nodes) >= 3:
            faces.append(nodes)
    return faces


def _polygon_area(points: Sequence[Tuple[float, float]]) -> float:
    """XY 로 투영한 다각형 면적(부호 없음)."""
    total = 0.0
    for i in range(len(points)):
        x0, y0 = points[i - 1]
        x1, y1 = points[i]
        total += x0 * y1 - x1 * y0
    return abs(total) / 2.0


def deck_landing_levels(
    bulk_lines: Sequence[str],
    *,
    tol_mm: float = PLATE_TOL_MM,
    min_area_ratio: float = MIN_LEVEL_AREA_RATIO,
) -> List[Dict[str, object]]:
    """정반의 적치면 목록. 높이 내림차순.

    각 원소: {"z", "areaMm2", "bbox"(x0,y0,x1,y1), "nodes"[(id,x,y,z), ...],
              "solidRect"(bbox 를 꽉 채우는가), "tris"[(ax,ay,bx,by,cx,cy), ...]}

    ⚠ tris/solidRect 는 프론트 feGeometry.buildDeckSurface 와 **같은 규칙**이다.
      층이 bbox 를 꽉 채우면(현재 A·B 정반이 그렇다) 점 판정을 bbox 비교로 끝내고,
      구멍이 뚫린 정반이 들어오면 삼각형 판정으로 떨어진다. 이 폴백이 없으면 프론트는
      '정반 밖' 이라 판정한 자리를 서버는 '안' 이라 보고 서로 다른 배치를 푼다.
    """
    coords = grid_coords_map(bulk_lines)
    buckets: Dict[int, Dict[str, object]] = {}
    flat_area = 0.0

    for nodes in _shell_faces(bulk_lines):
        pts = [coords[n] for n in nodes if n in coords]
        if len(pts) != len(nodes):
            continue
        zs = [p[2] for p in pts]
        if max(zs) - min(zs) > tol_mm:          # 경사면·수직 웨브
            continue
        area = _polygon_area([(p[0], p[1]) for p in pts])
        if area <= 0.0:                          # 수직면은 XY 투영 면적이 0 이다
            continue
        z = sum(zs) / len(zs)
        key = int(round(z / tol_mm))
        bucket = buckets.setdefault(key, {"z": z, "area": 0.0, "nodes": set(), "tris": []})
        bucket["area"] += area
        bucket["nodes"].update(nodes)
        # 부채꼴 삼각분할 — 쉘 면 (a,b,c[,d]) 를 (a,b,c) + (a,c,d) 로. 프론트와 같은 순서다.
        flat = [(p[0], p[1]) for p in pts]
        for k in range(1, len(flat) - 1):
            bucket["tris"].append((*flat[0], *flat[k], *flat[k + 1]))
        flat_area += area

    if not flat_area:
        raise MergeError("정반 BDF 에서 수평 쉘면을 찾지 못했습니다.")

    levels: List[Dict[str, object]] = []
    for bucket in buckets.values():
        if bucket["area"] < flat_area * min_area_ratio:
            continue
        nodes = sorted((n, *coords[n]) for n in bucket["nodes"] if n in coords)
        xs = [x for (_n, x, _y, _z) in nodes]
        ys = [y for (_n, _x, y, _z) in nodes]
        bbox = (min(xs), min(ys), max(xs), max(ys))
        bbox_area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
        solid_rect = bbox_area > 0 and abs(bucket["area"] - bbox_area) / bbox_area < 0.02
        levels.append({
            "z": bucket["z"],
            "areaMm2": bucket["area"],
            "bbox": bbox,
            "nodes": nodes,
            "solidRect": solid_rect,
            # 꽉 찬 사각형이면 삼각형을 들고 있을 이유가 없다(정반 A 상단만 1,600개다).
            "tris": [] if solid_rect else bucket["tris"],
        })
    if not levels:
        raise MergeError("정반 적치면을 찾지 못했습니다.")

    levels.sort(key=lambda lv: -float(lv["z"]))
    return levels


def _point_in_tri_2d(x: float, y: float, tri: Sequence[float]) -> bool:
    """(x, y) 가 삼각형 안인가(경계 포함). 프론트 feGeometry.pointInTri2D 와 같은 식이다."""
    ax, ay, bx, by, cx, cy = tri
    denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(denom) < 1.0e-9:
        return False
    w1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom
    w2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom
    return w1 >= -1.0e-6 and w2 >= -1.0e-6 and (1.0 - w1 - w2) >= -1.0e-6


def landing_level_at(
    levels: Sequence[Dict[str, object]], x: float, y: float,
) -> Dict[str, object] | None:
    """(x, y) 를 받는 적치면. 여러 층이 겹치면 가장 높은 층(높이 내림차순의 첫 일치).

    현재 A·B 정반 적치면은 꽉 찬 사각형이라 bbox 비교로 끝나지만, 구멍이 뚫린 정반이
    들어오면 삼각형 판정으로 떨어진다 — 프론트 landingLevelAt 과 같은 규칙이어야
    두 쪽이 같은 배치를 푼다.
    """
    for level in levels:
        if not _inside(x, y, level["bbox"]):
            continue
        if level.get("solidRect", True):
            return level
        if any(_point_in_tri_2d(x, y, tri) for tri in level.get("tris") or ()):
            return level
    return None


def primary_landing_level(levels: Sequence[Dict[str, object]]) -> Dict[str, object]:
    """배치 기준면 = 면적이 가장 넓은 층(A·B 모두 상단). 같으면 높은 쪽 — 기준이 흔들리면 안 된다."""
    return max(levels, key=lambda lv: (float(lv["areaMm2"]), float(lv["z"])))


def pair_supports_to_plate(
    support_points: Sequence[Tuple[int, float, float]],
    levels: Sequence[Dict[str, object]],
    *,
    forbidden: Iterable[int] = (),
) -> List[Dict[str, object]]:
    """지지점마다 **자기 발밑 적치면**에서 가장 가까운 절점 하나를 배정한다(수평거리, 중복 없음).

    정반이 2단이라 층을 섞으면 안 된다 — 하단(z=2020)에 앉는 지지점을 상단(z=8026)
    절점에 붙이면 스툴이 6m 를 가로질러 엉뚱한 곳에 하중을 걸게 된다.

    같은 절점을 두 지지점이 쓰면 그 절점이 RBE2 종속으로 두 번 잡혀 Nastran 이
    m-set 충돌로 죽는다. 그래서 이미 쓴 절점은 후보에서 뺀다.

    @param support_points  [(모듈 절점 ID, 적치 후 X, 적치 후 Y), ...]
    @param levels          deck_landing_levels 의 결과
    @param forbidden       이미 다른 강체의 종속인 정반 절점(붙이면 FATAL)
    """
    if not support_points:
        raise MergeError("지지점이 없습니다. 2단계에서 지지점을 지정하세요.")
    blocked = set(int(n) for n in forbidden)
    used: set = set()
    pairs: List[Dict[str, object]] = []

    for node_id, sx, sy in support_points:
        level = landing_level_at(levels, sx, sy)
        if level is None:
            raise MergeError(
                f"지지점 절점 {int(node_id)} 발밑에 정반 적치면이 없습니다 — "
                "스툴을 세울 자리가 없습니다."
            )
        best = None
        best_d2 = math.inf
        for deck_id, dx, dy, dz in level["nodes"]:
            if deck_id in used or deck_id in blocked:
                continue
            d2 = (dx - sx) ** 2 + (dy - sy) ** 2
            if d2 < best_d2:
                best_d2, best = d2, (deck_id, dx, dy, dz)
        if best is None:
            raise MergeError(
                f"지지점에 배정할 정반 절점(z={float(level['z']):g})이 남지 않았습니다. "
                "지지점 수를 줄이세요."
            )
        used.add(best[0])
        pairs.append({
            "moduleNodeId": int(node_id),
            "deckNodeId": int(best[0]),
            "moduleXYMm": [sx, sy],
            "deckXYZMm": [best[1], best[2], best[3]],
            "landingZMm": float(level["z"]),
            "distanceMm": math.sqrt(best_d2),
        })
    return pairs


# ── 합본 BDF 조립 ────────────────────────────────────────────────────────────

from .module_ocean_bdf import (                                   # noqa: E402
    LOAD_SID,
    grav_line,
    line,
    next_free_load_sid,
    promote_partial_rigid_cm,
    rigid_dependent_nodes,
    stabilization_param_lines,
    strip_constraint_cards,
    strip_load_cards,
)

# 지지점 RBE2 의 ID 대역. 정반(≤102736)과 재번호된 Module Unit(20xxxx) 어느 쪽과도
# 겹치지 않는 자리다.
SUPPORT_RBE2_EID_BASE = 990100

# 정반 적치면과 그 위에 앉는 지지점 사이의 이격 [mm]. 사용자 결정으로 고정값이다 —
# 모델이 정반 쉘을 통과하는 일이 원천적으로 없어야 한다.
# 2026-09-08: 300 → 100 (사용자 결정). 프론트 feGeometry.DECK_CLEARANCE_MM 과 같은 값이어야
# 하고, 두 쪽이 갈리면 build_combined_bdf 의 gapMm 대조에서 걸린다.
DEFAULT_CLEARANCE_MM = 100.0

# 배치가 화면과 어긋났는지 보는 허용오차. 프론트와 백엔드가 각자 상판을 찾아 계산하므로
# 같은 값이 나와야 정상이고, 어긋나면 사용자가 본 배치와 해석한 배치가 다르다.
PLACEMENT_TOL_MM = 1.0

# 출력 요청을 Module Unit 으로 좁히는 case control SET ID.
_SET_UNIT_NODES = 100
_SET_UNIT_ELEMENTS = 200

# 중량 여유(%)를 곱할 질량 필드.
_RHO_FIELD = {"MAT1": 5}
_MASS_FIELD = {"CONM2": 4}
# 질량을 갖지만 위 표가 다루지 않는 카드. 여유율이 **일부에만** 걸려 조용히 틀리느니
# 멈춘다(여유율이 0이면 곱할 것이 없으므로 통과시킨다).
_MASS_CARDS_UNSCALED = frozenset({"MAT2", "MAT8", "MAT9", "MAT10", "CONM1"})


def grid_coords_map(bulk_lines: Sequence[str]) -> Dict[int, Tuple[float, float, float]]:
    """GRID id → (x, y, z)."""
    coords: Dict[int, Tuple[float, float, float]] = {}
    for head, name, _rows in _iter_cards(bulk_lines):
        if name != "GRID":
            continue
        fields = _card_fields(bulk_lines[head])
        if fields and _is_int_field(fields[0]):
            coords[int(fields[0])] = _grid_coords(bulk_lines[head])
    return coords


def scale_mass(bulk_lines: Sequence[str], factor: float, *, what: str) -> List[str]:
    """MAT1 밀도와 CONM2 질량에 중량 여유율을 곱한다.

    여유율은 "이 물체를 그만큼 무겁게 본다"는 뜻이라 질량에만 곱한다 — 무게중심은
    1차 모멘트가 같은 비율로 커지므로 움직이지 않는다.
    """
    if abs(factor - 1.0) < 1.0e-12:
        return list(bulk_lines)

    lines = list(bulk_lines)
    for head, name, _rows in _iter_cards(lines):
        if name in _MASS_CARDS_UNSCALED:
            raise MergeError(
                f"{what} 모델에 '{name}' 카드가 있어 중량 여유({factor * 100 - 100:+.1f}%)를 "
                "질량 전체에 고르게 적용할 수 없습니다. 여유율을 0 으로 두거나 "
                "module_ocean_merge 의 질량 필드표에 이 카드를 추가하세요."
            )
        field_index = _RHO_FIELD.get(name) or _MASS_FIELD.get(name)
        if field_index is None:
            continue
        fields = _card_fields(lines[head])
        if field_index > len(fields):
            continue
        text = fields[field_index - 1].strip()
        if not text:
            continue
        lines[head] = _replace_field(lines[head], field_index, real8(_parse_real(text) * factor))
    return lines


def split_param_lines(bulk_lines: Sequence[str]) -> Tuple[List[str], Dict[str, str]]:
    """PARAM 카드를 본문에서 떼어 (나머지, {이름: 줄}) 로 나눈다.

    두 덱을 이어 붙이면 PARAM,POST 가 두 번 들어간다. 같은 PARAM 이 중복되면 Nastran 이
    경고 또는 FATAL 을 내므로 이름 기준으로 하나만 남긴다.
    """
    rest: List[str] = []
    params: Dict[str, str] = {}
    for raw in bulk_lines:
        if _card_name(raw) != "PARAM":
            rest.append(raw)
            continue
        fields = _card_fields(raw)
        key = (fields[0] if fields else "").strip().upper()
        params.setdefault(key, raw)
    return rest, params


def deck_spc_sid(bulk_lines: Sequence[str]) -> int:
    """정반이 자기 Leg 에 걸어 둔 SPC 의 SID.

    합본에서는 이것이 **유일한 경계조건**이다 — Module Unit 은 지지점 RBE2 로 정반에
    매달릴 뿐 따로 구속하지 않는다.
    """
    sids = set()
    for head, name, _rows in _iter_cards(bulk_lines):
        if name not in ("SPC", "SPC1"):
            continue
        fields = _card_fields(bulk_lines[head])
        if fields and _is_int_field(fields[0]):
            sids.add(int(fields[0]))
    if not sids:
        raise MergeError("정반 BDF 에 SPC 가 없습니다. Leg 구속이 없으면 해석할 수 없습니다.")
    if len(sids) > 1:
        raise MergeError(
            f"정반 BDF 의 SPC SID 가 여러 개입니다({sorted(sids)}). "
            "합본은 SPCADD 없이 단일 SID 만 지원합니다."
        )
    return sids.pop()


def build_combined_bdf(
    *,
    deck_bulk_lines: Sequence[str],
    unit_bulk_lines: Sequence[str],
    support_node_ids: Sequence[int],
    placement: Dict[str, object],
    accel_g: Sequence[float],
    deck_contingency_pct: float = 0.0,
    module_contingency_pct: float = 0.0,
    clearance_mm: float = DEFAULT_CLEARANCE_MM,
    id_offset: int = ID_OFFSET,
    title: str = "Module Unit Ocean Transport - Jungban + Module Unit",
) -> dict:
    """정반과 Module Unit 을 한 덱으로 합쳐 SOL 101 BDF 를 만든다.

    경계조건은 **정반이 원래 갖고 있던 Leg SPC** 뿐이다. Module Unit 은 지지점마다
    가장 가까운 상판 절점에 RBE2 로 매달린다. 하중은 GRAV 하나 — 정반 자중까지
    한꺼번에 실린다.

    출력은 Module Unit 으로 좁힌다(SET). 정반 쉘 27,000개의 응력까지 F06 에 쓰면
    파일이 수백 MB 가 되는데, 부재 평가 대상은 Module Unit 뿐이라 쓸 데가 없다.
    """
    # ── 정반 ─────────────────────────────────────────────────────────────
    deck_kept, deck_removed_loads = strip_load_cards(deck_bulk_lines)
    spc_sid = deck_spc_sid(deck_kept)
    levels = deck_landing_levels(deck_kept)
    primary = primary_landing_level(levels)
    deck_top_z = float(levels[0]["z"])          # 최상단 적치면 — 배치 Z 의 기준
    deck_shell = deck_shell_nodes(deck_kept)
    deck_max_z = max(z for (_x, _y, z) in grid_coords_map(deck_kept).values())

    px0, py0, px1, py1 = primary["bbox"]
    plate_center = ((px0 + px1) / 2.0, (py0 + py1) / 2.0)

    # 화면이 계산한 배치 기준과 서버가 찾은 정반이 같은 것인지 확인한다. 어긋난 채
    # 진행하면 사용자가 본 자리와 다른 자리에서 해석이 돌고, 결과만으로는 알 수 없다.
    given_center = placement.get("deckCenterMm")
    if given_center is not None:
        drift = max(abs(float(given_center[axis]) - plate_center[axis]) for axis in (0, 1))
        if drift > PLACEMENT_TOL_MM:
            raise MergeError(
                f"화면이 보낸 배치 기준({given_center})과 서버가 찾은 정반 기준 적치면 중심"
                f"({[round(v, 1) for v in plate_center]})이 {drift:.1f}mm 어긋납니다."
            )
    given_top = placement.get("deckTopZMm")
    if given_top is not None and abs(float(given_top) - deck_top_z) > PLACEMENT_TOL_MM:
        raise MergeError(
            f"화면이 보낸 정반 상면(z={float(given_top):g})과 서버가 찾은 최상단 적치면"
            f"(z={deck_top_z:g})이 다릅니다."
        )

    # ── Module Unit ──────────────────────────────────────────────────────
    assert_global_coordinates(unit_bulk_lines)
    unit_kept, unit_removed_spc = strip_constraint_cards(unit_bulk_lines)
    unit_kept, unit_removed_loads = strip_load_cards(unit_kept)
    unit_kept = renumber_bulk(unit_kept, offset=id_offset)
    unit_defined = collect_ids(unit_kept)
    verify_renumbered(unit_kept, defined=unit_defined)

    # 적치 높이를 정하는 것은 **지지점**이다 — 지지점마다 발밑 적치면을 찾아 그 위
    # clearance 를 확보하고, 가장 빡빡한 지지점에 맞춰 모듈 전체가 내려앉는다.
    #
    #     baseZ = max over supports ( landingZ + clearance - localZ )
    #
    # 층이 하나면 예전 식(= clearance - 지지점 최하단)과 같은 값이다. 정반이 2단이면
    # 층마다 스툴 길이가 자동으로 달라진다(정반 A + 3521: 하단 100mm, 상단 370mm).
    # 모듈 최하단을 기준으로 삼으면 안 된다 — 3521 의 최하단 5점은 **하단 정반에 앉는
    # 발**이라, 그 5점을 상단 기준으로 재면 모듈이 6m 잘못 뜬다.
    source_coords = grid_coords_map(unit_kept)
    support_ids = [int(n) + id_offset for n in support_node_ids]
    missing = [n for n in support_ids if n not in source_coords]
    if missing:
        raise MergeError(
            f"지지점 절점 {[n - id_offset for n in missing]} 을 Module Unit BDF 에서 "
            "찾지 못했습니다. 2단계에서 지지점을 다시 지정하세요."
        )

    anchor_mm = [float(v) for v in placement["anchorMm"]]
    offset_x = float(placement.get("offsetXMm") or 0.0)
    offset_y = float(placement.get("offsetYMm") or 0.0)
    rotation_z = float(placement.get("rotationZDeg") or 0.0)
    theta = math.radians(rotation_z)
    cos_t, sin_t = math.cos(theta), math.sin(theta)

    def placed_xy(coord: Tuple[float, float, float]) -> Tuple[float, float]:
        """배치 후 XY. Z 와 달리 gap 에 안 걸려서, 적치 높이를 정하기 전에 알 수 있다."""
        lx, ly = coord[0] - anchor_mm[0], coord[1] - anchor_mm[1]
        return (plate_center[0] + offset_x + lx * cos_t - ly * sin_t,
                plate_center[1] + offset_y + lx * sin_t + ly * cos_t)

    support_landing: Dict[int, float] = {}
    off_plate: List[int] = []
    for nid in support_ids:
        sx, sy = placed_xy(source_coords[nid])
        level = landing_level_at(levels, sx, sy)
        if level is None:
            off_plate.append(nid - id_offset)
        else:
            support_landing[nid] = float(level["z"])
    if off_plate:
        raise MergeError(
            f"지지점 절점 {off_plate} 발밑에 정반 적치면이 없습니다 — 스툴을 세울 자리가 "
            "없습니다. 회전·오프셋으로 정반 안으로 넣거나 그 지지점을 다시 고르세요."
        )

    base_z = max(
        landing_z + float(clearance_mm) - (source_coords[nid][2] - anchor_mm[2])
        for nid, landing_z in support_landing.items()
    )
    gap_mm = base_z - deck_top_z

    # 화면이 계산한 적치 높이와 대조한다. 프론트와 백엔드가 각자 적치면을 찾으므로
    # 두 값이 같아야 정상이고, 다르면 층 판정이 어긋난 것이다(= 사용자가 본 배치와
    # 서버가 푸는 배치가 다르다). 여기서 멈추지 않으면 결과만 보고는 알 수 없다.
    given_gap = placement.get("gapMm")
    if given_gap is not None and abs(float(given_gap) - gap_mm) > PLACEMENT_TOL_MM:
        raise MergeError(
            f"화면이 계산한 적치 높이(gap {float(given_gap):.1f}mm)와 서버 계산"
            f"({gap_mm:.1f}mm)이 다릅니다. 2단계에서 적치 검사를 다시 실행하세요."
        )

    unit_kept, place_stats = place_grid_lines(
        unit_kept,
        anchor_mm=anchor_mm,
        deck_center_mm=plate_center,
        deck_top_z_mm=deck_top_z,
        offset_x_mm=offset_x,
        offset_y_mm=offset_y,
        rotation_z_deg=rotation_z,
        gap_mm=gap_mm,
    )
    unit_coords = grid_coords_map(unit_kept)

    # ── 정반과의 이격 검사 ───────────────────────────────────────────────
    # 규칙 하나로 관통과 여유 부족을 함께 잡는다: **모든 절점이 그 아래 정반면에서
    # clearance 이상 떨어져 있어야 한다.** 정반면을 절점마다 정확히 찾는 대신
    # 상한으로 본다 — 적치면 위는 그 층의 높이(그 구역에서 가장 높은 면이다),
    # 적치면 밖은 적치면 밖 쉘의 최고 높이. 둘 다 실제 면보다 높거나 같으므로
    # 이 검사를 통과하면 실제로도 통과다.
    outside_max_z = max(
        (z for (_x, _y, z) in deck_shell.values() if landing_level_at(levels, _x, _y) is None),
        default=None,
    )
    worst_id, worst_room = None, None
    for nid, (x, y, z) in unit_coords.items():
        level = landing_level_at(levels, x, y)
        floor_z = float(level["z"]) if level is not None else outside_max_z
        if floor_z is None:
            continue                       # 적치면 밖인데 아래에 정반이 아예 없다 — 허공
        room = z - floor_z
        if worst_room is None or room < worst_room:
            worst_room, worst_id = room, nid
    if worst_room is not None and worst_room < float(clearance_mm) - PLACEMENT_TOL_MM:
        raise MergeError(
            f"절점 {worst_id - id_offset} 이 정반면에서 {worst_room:.1f}mm 밖에 떨어져 있지 "
            f"않습니다({clearance_mm:g}mm 필요). 지지점보다 낮은 부재가 정반 위에 있습니다 — "
            "그 자리를 지지점에 추가하거나 배치를 조정하세요."
        )

    # ── 지지점 ↔ 정반 적치면 연결 ────────────────────────────────────────
    pairs = pair_supports_to_plate(
        [(nid, unit_coords[nid][0], unit_coords[nid][1]) for nid in support_ids],
        levels,
        forbidden=rigid_dependent_nodes(deck_kept),
    )
    for pair in pairs:
        pair["moduleNodeId"] = int(pair["moduleNodeId"]) - id_offset   # 화면이 아는 ID 로 되돌린다
        pair["stoolMm"] = unit_coords[int(pair["moduleNodeId"]) + id_offset][2] - float(pair["landingZMm"])

    # 운송은 **고박 상태**를 푸는 것이다 — 운전 조건의 미끄러지는 지지(CM=13 등)를
    # 그대로 두면 그 자유 방향으로 배관이 통째로 흔들린다(실측 214mm).
    # 잡는 것은 **병진 3개뿐**이다 — 회전까지 잡으면 짧은 부재가 가짜 모멘트를 받는다.
    # 근거·실측은 module_ocean_bdf._SEA_FASTEN_CM 주석 참조.
    unit_kept, rigid_info = promote_partial_rigid_cm(unit_kept, spc_node_ids=support_ids)

    # ── 중량 여유 ────────────────────────────────────────────────────────
    deck_kept = scale_mass(deck_kept, 1.0 + float(deck_contingency_pct) / 100.0, what="정반")
    unit_kept = scale_mass(unit_kept, 1.0 + float(module_contingency_pct) / 100.0, what="Module Unit")

    # ── 조립 ─────────────────────────────────────────────────────────────
    deck_kept, deck_params = split_param_lines(deck_kept)
    unit_kept, unit_params = split_param_lines(unit_kept)
    params = {**unit_params, **deck_params}          # 이름이 겹치면 정반 것을 남긴다

    merged = [*deck_kept, *unit_kept]
    load_sid = next_free_load_sid(merged, LOAD_SID)

    support_rbe2 = [
        # GN = Module Unit 지지점, GM = 정반 상판 절점.
        # 정반 절점을 종속으로 두는 것은 의도다 — 쉘 절점의 법선 회전(drilling)은 강성이
        # 없어 독립으로 두면 특이가 되지만, 종속이면 애초에 a-set 에서 빠진다.
        line("RBE2", SUPPORT_RBE2_EID_BASE + index, int(pair["moduleNodeId"]) + id_offset,
             "123456", int(pair["deckNodeId"]))
        for index, pair in enumerate(pairs, start=1)
    ]

    level_note = ", ".join(f"{float(lv['z']):g}" for lv in levels)
    node_ids = sorted(unit_coords)
    element_ids = sorted(unit_defined["elem"])
    generated = [
        "$",
        "$ HiTESS WorkBench - Module Unit Ocean Transport (combined deck + module unit)",
        f"$ landing levels z = {level_note}, module bottom z = {place_stats['bottomZMm']:g}"
        f" (support clearance {clearance_mm:g} mm, min deck clearance {worst_room:.1f} mm)",
        f"$ module unit ids shifted by +{id_offset}",
        f"$ support RBE2 = {len(pairs)} (GN=module unit, GM=deck landing level node)",
        f"$ sea-fastened: partial-CM RBE2 given translations(123) = {len(rigid_info['promotedEids'])}, "
        f"of which fully fixed(123456) to stop free rotation = {len(rigid_info['escalatedEids'])}, "
        f"still-ungrounded beam components = {rigid_info['ungroundedComponentCount']}, "
        f"skipped by m-set clash = {rigid_info['skippedConflictCount']}",
        *support_rbe2,
        grav_line(load_sid, accel_g),
        "$ 해석 안정화 — GMU 권상 파이프라인과 동일 정책(Mechanism/FATAL 9050 회피)",
        *stabilization_param_lines(merged),
    ]

    header = [
        "SOL 101",
        "CEND",
        f"TITLE = {title}",
        # 출력을 Module Unit 으로 좁힌다. 정반 요소·절점은 SPC 반력만 필요하다.
        f"SET {_SET_UNIT_NODES} = {node_ids[0]} THRU {node_ids[-1]}",
        f"SET {_SET_UNIT_ELEMENTS} = {element_ids[0]} THRU {element_ids[-1]}",
        "SUBCASE 1",
        "  LABEL = Ocean transport acceleration",
        f"  SPC = {spc_sid}",
        f"  LOAD = {load_sid}",
        f"  DISPLACEMENT = {_SET_UNIT_NODES}",
        "  SPCFORCES = ALL",
        f"  FORCE = {_SET_UNIT_ELEMENTS}",
        f"  STRESS = {_SET_UNIT_ELEMENTS}",
        "BEGIN BULK",
    ]

    return {
        "text": "\n".join([*header, *params.values(), *merged, *generated, "ENDDATA"]) + "\n",
        "idOffset": id_offset,
        "spcSid": spc_sid,
        "loadSid": load_sid,
        "deckTopZMm": deck_top_z,
        "deckMaxZMm": deck_max_z,
        "deckCenterMm": [plate_center[0], plate_center[1]],
        "clearanceMm": float(clearance_mm),
        "gapMm": place_stats["gapMm"],
        # 적치면 목록과 층별 스툴 — 화면이 "어느 층에 몇 개, 스툴 몇 mm" 로 보여 준다.
        "landingLevelsMm": [
            {"zMm": float(lv["z"]), "areaMm2": float(lv["areaMm2"]),
             "bboxMm": [float(v) for v in lv["bbox"]]}
            for lv in levels
        ],
        "supportStoolMm": {
            "min": min(float(p["stoolMm"]) for p in pairs),
            "max": max(float(p["stoolMm"]) for p in pairs),
        },
        "minDeckClearanceMm": worst_room,
        "moduleBottomZMm": place_stats["bottomZMm"],
        "moduleBoundsMm": {"min": place_stats["minMm"], "max": place_stats["maxMm"]},
        "supportPairs": pairs,
        "maxPairDistanceMm": max(float(p["distanceMm"]) for p in pairs),
        # 화면이 같은 기준으로 경고할 수 있도록 문턱값을 함께 내보낸다 —
        # 프론트에 400 을 다시 적으면 두 값이 갈린다.
        "pairWarnMm": PAIR_WARN_MM,
        "unitNodeIdRange": [node_ids[0], node_ids[-1]],
        "unitElementIdRange": [element_ids[0], element_ids[-1]],
        "unitNodeCount": len(node_ids),
        "removedDeckLoadCards": deck_removed_loads,
        "removedUnitConstraintCards": unit_removed_spc,
        "removedUnitLoadCards": unit_removed_loads,
        "rigidPromotion": rigid_info,
    }
