# Module Unit 해상 운송 구조 해석 — 3단계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2단계 적치 결과(접촉 절점·합산 중량·CoG)를 받아 가속도 하중으로 ① Module Unit 단독 응력 해석과 ② 정반 Leg 반력 해석을 순차 수행하는 3단계를 구현한다.

**Architecture:** BDF 조립은 백엔드 파이썬의 **순수 함수**(파일 I/O·Nastran 실행 없음)로 두고 골든 텍스트로 고정한다. Nastran 실행과 F06 파싱은 기존 자산(`nastran.exe`, `nastran_bridge <f06>` CLI)을 **무변경** 재사용한다. 오케스트레이션 서비스가 job_manager 위에서 두 과정을 순차 실행한다.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy / pytest (백엔드), React 18 / Vite / Node 내장 `node:test` (프론트), MSC Nastran SOL 101

**설계 문서:** `docs/superpowers/specs/2026-09-02-module-ocean-transport-structural-design.md`

---

## 커밋 정책 (중요)

이 저장소는 **에이전트 자동 커밋 금지**다. 각 Task 끝의 "커밋 지점"은 사용자가 직접 커밋하는 자리다.
에이전트는 `git add` / `git commit`을 실행하지 말고, **무엇을 커밋하면 되는지 파일 목록만 보고**한다.

또한 `HiTessWorkBench/frontend/src/config.js`는 **절대 스테이징하지 않는다**(로컬 전용 백엔드 토글).

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `HiTessWorkBenchBackEnd/app/services/module_ocean_bdf.py` | **신규.** BDF 8칸 고정필드 포맷터, 가속도 좌표 변환, 구속 카드 제거, 두 과정의 BDF 텍스트 생성. 파일 I/O·subprocess 없음 |
| `HiTessWorkBenchBackEnd/app/services/module_ocean_results.py` | **신규.** `convert_f06` JSON → 응력 평가 / Leg 반력 추출. 순수 함수 |
| `HiTessWorkBenchBackEnd/app/services/module_ocean_structural_service.py` | **신규.** 오케스트레이션 — 파일 읽기/쓰기, Nastran 실행, F06 변환 호출, job 진행률, DB 기록 |
| `HiTessWorkBenchBackEnd/app/services/module_ocean_transport_service.py` | 수정. `nodeIds` 노출, `_PAYLOAD_SCHEMA` bump, `get_jungban_leg_nodes()` |
| `HiTessWorkBenchBackEnd/app/routers/module_ocean_transport.py` | 수정. `POST /structural-run` |
| `HiTessWorkBenchBackEnd/app/services/app_settings.py` | 수정. `GUARDED_ROUTES` 등록 |
| `HiTessWorkBenchBackEnd/tests/test_module_ocean_bdf.py` | **신규.** BDF 조립 테스트 |
| `HiTessWorkBenchBackEnd/tests/test_module_ocean_results.py` | **신규.** 평가·반력 추출 테스트 |
| `HiTessWorkBench/frontend/src/utils/feGeometry.js` | 수정. `contacts[]`에 절점 인덱스 |
| `HiTessWorkBench/frontend/src/utils/feGeometry.test.js` | 수정. 위 회귀 테스트 |
| `HiTessWorkBench/frontend/src/api/analysis.js` | 수정. `requestModuleOceanStructural()` |
| `HiTessWorkBench/frontend/src/pages/analysis/ModuleUnitOceanTransportAnalysis.jsx` | 수정. 3단계 패널 |

BDF 조립(순수)과 오케스트레이션(부수효과)을 갈라 둔 것이 핵심이다. 그래야 Nastran 없이 BDF 텍스트를 골든으로 고정할 수 있다.

**테스트 실행 위치:** pytest는 `HiTessWorkBenchBackEnd/`에서, 프론트 테스트는 `HiTessWorkBench/frontend/`에서 실행한다.

---

## Task 1: 뷰어 페이로드에 BDF 절점 ID 노출

접촉 절점을 백엔드로 넘기려면 프론트가 실제 BDF 절점 ID를 알아야 한다. 현재 슬림 페이로드는 0-based 인덱스만 내보낸다.

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/module_ocean_transport_service.py:70` (`_PAYLOAD_SCHEMA`), `:103-215` (`slim_model_json`)
- Test: `HiTessWorkBenchBackEnd/tests/test_module_ocean_transport_payload.py` (신규)

- [ ] **Step 1: 실패하는 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_module_ocean_transport_payload.py`:

```python
"""슬림 뷰어 페이로드 — 절점 ID 노출 회귀 테스트.

3단계 구조 해석은 접촉 절점의 **BDF 절점 ID** 를 백엔드로 넘겨야 한다.
페이로드가 인덱스만 내보내면 프론트가 ID 를 알 수 없다.
"""
from app.services.module_ocean_transport_service import _PAYLOAD_SCHEMA, slim_model_json


def _model():
    return {
        "meta": {"unit": "mm"},
        "nodes": [
            {"id": 101, "x": 0.0, "y": 0.0, "z": 0.0},
            {"id": 205, "x": 1000.0, "y": 0.0, "z": 0.0},
            {"id": 309, "x": 1000.0, "y": 1000.0, "z": 0.0},
        ],
        "elements": [
            {"id": 1, "type": "CBEAM", "startNode": 101, "endNode": 205},
        ],
        "rigids": [],
        "properties": [],
        "materials": [],
        "pointMasses": [],
    }


def test_slim_payload_exposes_node_ids_in_position_order():
    slim = slim_model_json(_model(), name="t")
    assert slim["nodeIds"] == [101, 205, 309]
    assert len(slim["nodeIds"]) == slim["nodeCount"]


def test_slim_payload_schema_bumped_to_3():
    # 스키마를 올려야 서버에 남아 있는 정반 .viewer.json 캐시가 재생성된다.
    assert _PAYLOAD_SCHEMA == 3
    assert slim_model_json(_model(), name="t")["schema"] == 3
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_module_ocean_transport_payload.py -v`
Expected: FAIL — `KeyError: 'nodeIds'` 및 `assert 2 == 3`

- [ ] **Step 3: 구현**

`module_ocean_transport_service.py`에서 `_PAYLOAD_SCHEMA = 2` → `3`으로 바꾼다.

`slim_model_json` 안, `index_of: Dict[Any, int] = {}` 선언 옆에 수집 리스트를 추가한다:

```python
    index_of: Dict[Any, int] = {}
    node_ids: List[Any] = []          # positions 와 같은 순서의 BDF 절점 ID
    positions: List[float] = []
```

절점 루프에서 인덱스를 등록하는 줄 바로 뒤에 ID를 함께 쌓는다:

```python
        index_of[nid] = len(positions) // 3
        node_ids.append(nid)
```

반환 dict의 `"nodeCount"` 바로 위에 필드를 추가한다:

```python
        # 3단계 구조 해석이 접촉 절점을 SPC 로 잡으려면 BDF 절점 ID 가 필요하다.
        # positions 와 같은 순서이므로 프론트는 nodeIds[i] 로 조회한다.
        "nodeIds": node_ids,
        "nodeCount": len(positions) // 3,
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_module_ocean_transport_payload.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: 커밋 지점 (사용자 직접)**

보고할 파일: `app/services/module_ocean_transport_service.py`, `tests/test_module_ocean_transport_payload.py`

---

## Task 2: 정반 Leg 절점 추출

과정 2가 쓸 Leg 좌표를 정반 BDF에서 뽑는다. 정반 BDF의 `SPC`/`SPC1` 카드가 참조하는 절점이 Leg다.

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/module_ocean_transport_service.py` (파일 끝에 추가)
- Test: `HiTessWorkBenchBackEnd/tests/test_module_ocean_transport_payload.py` (Task 1 파일에 추가)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_module_ocean_transport_payload.py` 끝에 추가:

```python
import pytest

from app.services.module_ocean_transport_service import extract_leg_nodes


def test_extract_leg_nodes_from_spc_cards():
    model = {
        "nodes": [
            {"id": 102723, "x": 20260.0, "y": 5200.0, "z": -125.0},
            {"id": 102724, "x": 26260.0, "y": 5200.0, "z": -125.0},
            {"id": 500, "x": 0.0, "y": 0.0, "z": 2020.0},
        ],
        "spcs": [
            {"nodeId": 102723, "components": "123456"},
            {"nodeId": 102724, "components": "123456"},
        ],
    }
    legs = extract_leg_nodes(model)
    assert [leg["id"] for leg in legs] == [102723, 102724]
    assert legs[0]["x"] == 20260.0 and legs[0]["z"] == -125.0


def test_extract_leg_nodes_raises_when_no_constraints():
    with pytest.raises(ValueError, match="구속"):
        extract_leg_nodes({"nodes": [{"id": 1, "x": 0.0, "y": 0.0, "z": 0.0}], "spcs": []})
```

- [ ] **Step 2: 모델 JSON의 구속 키 이름 확인**

`extract_leg_nodes`가 읽을 키가 실제 `convert_bdf` 산출물에서 무엇인지 확인한다.

Run:
```bash
python InHouseProgram/NastranBridge/nastran_bridge.py InHouseProgram/ModuleOceanMoving/JungbanBDF/jungbanBDF_A.bdf -o /tmp/jbA.json
python -c "import json;d=json.load(open('/tmp/jbA.json'));print([k for k in d]);print(json.dumps({k:v[:2] for k,v in d.items() if isinstance(v,list) and 'constraint' in k.lower() or k in ('spcs','constraints')},ensure_ascii=False))"
```
Expected: 구속 목록을 담은 키 이름과 각 원소의 필드명(`nodeId`/`components` 등)이 출력된다.
실측 결과: 컨테이너 키는 **`spcs`**(`constraints` 아님), 각 원소는 `{"nodeId": int, "components": str}`.
근거는 `nastran_bridge.py` 의 `parse_spc()`/`parse_spc1()`(약 457-489행)와 `convert_bdf()`(약 1044행)다.

- [ ] **Step 3: 실패 확인**

Run: `python -m pytest tests/test_module_ocean_transport_payload.py -v`
Expected: FAIL — `ImportError: cannot import name 'extract_leg_nodes'`

- [ ] **Step 4: 구현**

`module_ocean_transport_service.py` 끝에 추가:

```python
# ── 정반 Leg 절점 (과정 2 반력 모델 입력) ─────────────────────────────────

_LEGS_SCHEMA = "jungbanLegs/1"


def _legs_cache_path(deck_type: str) -> str:
    """.viewer.json 과 같은 자리에 둔다 — 정반 BDF 수동 배포에 함께 따라가게."""
    return f"{os.path.splitext(jungban_bdf_path(deck_type))[0]}.legs.json"


def extract_leg_nodes(model_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    """모델 JSON 에서 SPC 로 구속된 절점(=정반 Leg)의 좌표를 뽑는다.

    정반 A 는 6개, B 는 8개이며 모두 Z=-125mm 평면에 있다.
    과정 2 는 이 좌표에서 아래로 스터브 빔을 세운다.
    """
    coords = {}
    for node in model_json.get("nodes") or []:
        nid = node.get("id")
        if nid is None:
            continue
        coords[nid] = (
            float(node.get("x", 0.0)),
            float(node.get("y", 0.0)),
            float(node.get("z", 0.0)),
        )

    leg_ids: List[Any] = []
    for entry in model_json.get("spcs") or []:
        nid = entry.get("nodeId")
        if nid is None or nid in leg_ids or nid not in coords:
            continue
        leg_ids.append(nid)

    if not leg_ids:
        raise ValueError("정반 모델에서 구속(SPC) 절점을 찾지 못했습니다. Leg 위치를 알 수 없습니다.")

    legs = []
    for nid in sorted(leg_ids):
        x, y, z = coords[nid]
        legs.append({"id": nid, "x": x, "y": y, "z": z})
    return legs


def get_jungban_leg_nodes(deck_type: str = DEFAULT_DECK_TYPE, *,
                          force_rebuild: bool = False) -> List[Dict[str, Any]]:
    """정반 Leg 절점 목록. .viewer.json 과 같은 캐시 규약을 따른다."""
    bdf_path = jungban_bdf_path(deck_type)
    cache_path = _legs_cache_path(deck_type)

    if not os.path.exists(bdf_path):
        raise ModelParseError(
            f"{deck_type} 타입 정반 BDF 가 배치되어 있지 않습니다: {bdf_path}"
        )

    if not force_rebuild and os.path.exists(cache_path) and _cache_is_fresh(cache_path, bdf_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as fp:
                cached = json.load(fp)
            if cached.get("schema") == _LEGS_SCHEMA and cached.get("legs"):
                return cached["legs"]
        except (OSError, ValueError) as exc:
            logger.warning("[ModuleOceanTransport] 정반(%s) Leg 캐시 로드 실패 — 재생성: %s",
                           deck_type, exc)

    model_json = parse_bdf_to_model_json(bdf_path)
    legs = extract_leg_nodes(model_json)

    try:
        with open(cache_path, "w", encoding="utf-8") as fp:
            json.dump({"schema": _LEGS_SCHEMA, "deckType": deck_type, "legs": legs},
                      fp, ensure_ascii=False)
    except OSError as exc:
        logger.warning("[ModuleOceanTransport] 정반(%s) Leg 캐시 저장 실패: %s", deck_type, exc)

    return legs
```

- [ ] **Step 5: 통과 확인**

Run: `python -m pytest tests/test_module_ocean_transport_payload.py -v`
Expected: PASS (4 passed)

- [ ] **Step 6: 실제 정반으로 확인**

Run:
```bash
python -c "from app.services.module_ocean_transport_service import get_jungban_leg_nodes as g; a=g('A'); b=g('B'); print(len(a), len(b)); print(a)"
```
Expected: `6 8` 이 출력되고, A의 좌표가 `(20260/26260/32260, ±5200, -125)` 여섯 조합과 일치한다.
숫자가 다르면 Step 2에서 확인한 키가 잘못된 것이다.

- [ ] **Step 7: 커밋 지점 (사용자 직접)**

보고할 파일: `app/services/module_ocean_transport_service.py`, `tests/test_module_ocean_transport_payload.py`

---

## Task 3: BDF 고정필드 포맷터와 가속도 변환

BDF 카드를 8칸 고정필드로 찍는 최소 도구와, 전역 가속도를 MU 로컬로 돌리는 변환을 만든다.

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/module_ocean_bdf.py`
- Test: `HiTessWorkBenchBackEnd/tests/test_module_ocean_bdf.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_module_ocean_bdf.py`:

```python
"""Module Unit 해상 운송 — BDF 조립 순수 함수 테스트.

파일 I/O 도 Nastran 도 타지 않는다. 문자열이 들어가 문자열이 나오므로
골든 텍스트로 카드 양식을 고정할 수 있다.

단위계: mm · ton · s (힘 N, 응력 MPa, 가속도 mm/s²)
"""
import math

import pytest

from app.services.module_ocean_bdf import (
    G_MM_S2,
    LOAD_SID,
    grav_line,
    line,
    real8,
    rotate_accel_to_local,
)


def parse_bdf_real(text):
    """BDF 8칸 실수 표기를 float 으로 되돌린다 — Nastran 압축 지수 포함('7.85-9' → 7.85e-9)."""
    body = text.strip()
    sign = ""
    if body[0] in "+-":
        sign, body = body[0], body[1:]
    for i in range(1, len(body)):
        if body[i] in "+-":
            return float(f"{sign}{body[:i]}e{body[i:]}")
    return float(sign + body)


# ── 고정필드 포맷 ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("value,expected", [
    (0.0, "0.0"),
    (-125.0, "-125.0"),
    (20260.0, "20260.0"),
    (0.3, "0.3"),
    (9806.65, "9806.65"),
    (7.85e-9, "7.85-9"),      # Nastran 압축 지수 표기
])
def test_real8_keeps_decimal_within_eight_columns(value, expected):
    out = real8(value)
    assert out == expected
    assert len(out) <= 8


def test_real8_rejects_unrepresentable():
    with pytest.raises(ValueError):
        real8(float("nan"))


# 이 도메인의 실제 값 범위: 좌표 ~1e6 mm, 질량 ~1e2 t, 가속도 크기 ~1e4 mm/s²,
# 방향 코사인 ~1e-6..1. 그 범위를 대표하는 '깔끔하지 않은' 값들이다.
@pytest.mark.parametrize("value", [
    13868.697431446113,   # |(1,0,-1)| · g — sqrt 에서 나오는 전형적 GRAV 크기
    9806.650000000001,
    1234567.8,            # 큰 좌표 — '1234568.' 처럼 끝의 점만 남는 형태
                          # (음수로 7자리 정수부가 되면 부호가 한 칸을 먹어 8칸 안에
                          #  rel 1e-4 를 못 맞춘다. 이 도메인 최대 좌표는 ~1.5e5 라 무해하다.)
    0.00012345678,
    1.23456e-6,           # 거의 축정렬인 가속도의 방향 코사인
    1.23456789e-9,
])
def test_real8_falls_back_to_best_approximation(value):
    """8칸 안에 정확히 복원되는 표기가 없는 값도 최선 근사로 담아야 한다.

    정확 복원을 고집하면 sqrt/삼각함수에서 나온 실제 가속도 크기가 전부 ValueError 가 된다.
    """
    out = real8(value)
    assert len(out) <= 8
    assert parse_bdf_real(out) == pytest.approx(value, rel=1e-4)


@pytest.mark.parametrize("value", [
    0.0, -125.0, 20260.0, 0.3, 9806.65, 7.85e-9,
    13868.697431446113, -1234567.8, 0.00012345678, 1.23456e-6, 1.23456789e-9,
])
def test_real8_always_contains_a_decimal_point(value):
    """MSC Nastran 실수 필드는 소수점을 요구한다 — 어떤 경로로 나오든 이 불변식은 지켜야 한다.

    소수점 없는 압축 지수('12345+8')는 유효숫자를 하나 더 벌지만 실수 필드에서 안전하지 않다.
    """
    assert "." in real8(value)


def test_line_pads_card_left_and_fields_right():
    # GRID 카드: 카드명 8칸 좌측정렬, 각 필드 8칸 우측정렬
    out = line("GRID", 9001, None, 20260.0, 5200.0, -125.0)
    assert out.startswith("GRID    ")
    assert out[8:16] == "    9001"
    assert out[16:24] == "        "      # CP 는 공백
    assert out[24:32] == " 20260.0"
    assert len(out) <= 80


def test_line_rejects_field_longer_than_eight():
    with pytest.raises(ValueError):
        line("GRID", 1234567890)


def test_line_leaves_the_continuation_column_free():
    """10번째 칸은 continuation 필드다 — 데이터로 채우면 뒤따르는 cont() 가 연결되지 않는다."""
    full = line("TESTCARD", 1, 2, 3, 4, 5, 6, 7, 8)
    assert len(full) <= 72                      # 카드 + 8필드 = 72칸, 10번째 칸은 비어 있다
    with pytest.raises(ValueError, match="continuation"):
        line("TESTCARD", 1, 2, 3, 4, 5, 6, 7, 8, 9)


def test_field_rejects_bool():
    """bool 은 int 의 서브클래스라 막지 않으면 '    True' 가 BDF 에 박힌다."""
    with pytest.raises(ValueError, match="bool"):
        line("GRID", True)


# ── 가속도 좌표 변환 ──────────────────────────────────────────────────────

def test_rotate_accel_no_rotation_is_identity():
    assert rotate_accel_to_local((0.3, -0.2, -1.0), 0.0) == (0.3, -0.2, -1.0)


def test_rotate_accel_90deg_maps_x_to_negative_y():
    # MU 를 +90° 돌려 얹었으면, 전역 +X 가속도는 MU 로컬에서 -Y 로 보인다.
    lx, ly, lz = rotate_accel_to_local((1.0, 0.0, -1.0), 90.0)
    assert lx == pytest.approx(0.0, abs=1e-12)
    assert ly == pytest.approx(-1.0)
    assert lz == -1.0


def test_rotate_accel_preserves_magnitude():
    a = (0.4, -0.7, -1.1)
    local = rotate_accel_to_local(a, 37.0)
    assert math.dist(local, (0, 0, 0)) == pytest.approx(math.dist(a, (0, 0, 0)))


# ── GRAV ─────────────────────────────────────────────────────────────────

def test_grav_line_unit_gravity():
    out = grav_line(LOAD_SID, (0.0, 0.0, -1.0))
    assert out.startswith("GRAV    ")
    fields = [out[i:i + 8].strip() for i in range(8, len(out), 8)]
    assert fields[0] == str(LOAD_SID)
    assert fields[1] == "0"
    assert float(fields[2]) == pytest.approx(G_MM_S2)
    assert [float(f) for f in fields[3:6]] == [0.0, 0.0, -1.0]


def test_grav_line_scales_magnitude():
    out = grav_line(LOAD_SID, (0.0, 0.0, -2.0))
    magnitude = float(out[24:32].strip())
    assert magnitude == pytest.approx(2.0 * G_MM_S2, rel=1e-4)


def test_grav_line_rejects_zero_acceleration():
    with pytest.raises(ValueError, match="가속도"):
        grav_line(LOAD_SID, (0.0, 0.0, 0.0))


@pytest.mark.parametrize("accel", [
    (1.0, 0.0, -1.0),
    (0.3, -0.2, -1.05),
    (0.15, 0.27, -1.0),
])
def test_grav_line_handles_non_axis_aligned_acceleration(accel):
    """실제 입력은 축 정렬이 아니다 — 크기가 sqrt 에서 나와도 카드가 만들어져야 한다."""
    out = grav_line(LOAD_SID, accel)
    assert out.startswith("GRAV    ")
    assert len(out) <= 80
    magnitude = float(out[24:32].strip())
    expected = math.dist(accel, (0, 0, 0)) * G_MM_S2
    assert magnitude == pytest.approx(expected, rel=1e-4)
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_module_ocean_bdf.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.module_ocean_bdf'`

- [ ] **Step 3: 구현**

`HiTessWorkBenchBackEnd/app/services/module_ocean_bdf.py` (신규):

```python
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
from typing import Any, Iterable, List, Sequence, Tuple

# 표준중력 [mm/s²]
G_MM_S2 = 9806.65

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

    # 2) 고정소수 — 8칸에 들어가며 값을 **정확히** 복원하는 최소 자릿수(깔끔한 값 우선).
    for prec in range(0, 9):
        text = f"{v:.{prec}f}"
        if "." not in text:
            text += ".0"
        if len(text) <= _MAX_FIELD and float(text) == v:
            return text

    # 3) Nastran 압축 지수 표기 — '7.85-9', '1.2346+6'.
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


def rotate_accel_to_local(accel_g: Sequence[float], rotation_z_deg: float) -> Tuple[float, float, float]:
    """전역(정반) 가속도를 MU 로컬 좌표계로 변환한다 — a_local = Rz(-θ)·a_global.

    2단계는 MU 를 rotationZDeg 만큼 돌려 정반에 얹지만, 해석 BDF 는 원본 절점 좌표를
    그대로 쓴다(절점을 돌리면 CBEAM 방향벡터·오프셋까지 돌려야 해서 위험하다).
    대신 하중 벡터 세 숫자만 반대로 돌린다.
    """
    ax, ay, az = (float(accel_g[0]), float(accel_g[1]), float(accel_g[2]))
    theta = math.radians(float(rotation_z_deg or 0.0))
    cs, sn = math.cos(theta), math.sin(theta)
    return (_denoise(ax * cs + ay * sn), _denoise(-ax * sn + ay * cs), az)


def grav_line(sid: int, accel_g: Sequence[float]) -> str:
    """GRAV 카드 — 크기는 mm/s², 방향은 단위벡터.

    accel_g 는 **중력을 포함한 총 가속도**를 g 단위로 받는다(정지 = (0,0,-1)).
    """
    ax, ay, az = (float(accel_g[0]), float(accel_g[1]), float(accel_g[2]))
    magnitude = math.sqrt(ax * ax + ay * ay + az * az)
    if magnitude <= 0.0:
        raise ValueError("가속도 크기가 0 입니다. 하중이 없어 해석할 수 없습니다.")
    return line(
        "GRAV", sid, 0, magnitude * G_MM_S2,
        _denoise(ax / magnitude), _denoise(ay / magnitude), _denoise(az / magnitude),
    )
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_module_ocean_bdf.py -v`
Expected: PASS (37 passed)

- [ ] **Step 5: 커밋 지점 (사용자 직접)**

보고할 파일: `app/services/module_ocean_bdf.py`, `tests/test_module_ocean_bdf.py`

---

## Task 4: 과정 1 BDF 조립 — 구속 제거 + 접촉 SPC + GRAV

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/module_ocean_bdf.py`
- Test: `HiTessWorkBenchBackEnd/tests/test_module_ocean_bdf.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_module_ocean_bdf.py` 끝에 추가:

```python
from app.services.module_ocean_bdf import (
    SPC_SID,
    build_stress_bdf,
    extract_bulk_lines,
    spc1_lines,
    strip_constraint_cards,
)


SAMPLE_DECK = """\
SOL 101
CEND
TITLE = original
BEGIN BULK
$ 원본 주석
GRID           1              0.0     0.0     0.0
GRID           2           1000.0     0.0     0.0
SPC1           7  123456       1       2
SPC            9       1  123456     0.0
SUPORT         1  123456
CBEAM          1       1       1       2     1.0     0.0     0.0
ENDDATA
"""


def test_extract_bulk_lines_takes_only_bulk_region():
    bulk = extract_bulk_lines(SAMPLE_DECK)
    assert bulk[0].startswith("$ 원본 주석")
    assert not any("SOL 101" in ln for ln in bulk)
    assert not any("ENDDATA" in ln for ln in bulk)


def test_extract_bulk_lines_treats_bulk_only_file_as_bulk():
    text = "GRID           1              0.0     0.0     0.0\n"
    assert extract_bulk_lines(text) == ["GRID           1              0.0     0.0     0.0"]


def test_strip_constraint_cards_removes_spc_family():
    kept, removed = strip_constraint_cards(extract_bulk_lines(SAMPLE_DECK))
    assert not any(ln.startswith(("SPC", "SUPORT")) for ln in kept)
    assert any(ln.startswith("CBEAM") for ln in kept)
    assert removed == {"SPC1": 1, "SPC": 1, "SUPORT": 1}


def test_strip_constraint_cards_removes_continuation_lines():
    bulk = [
        "SPC1           7  123456       1       2       3       4       5       6",
        "                     7       8",
        "GRID           9              0.0     0.0     0.0",
    ]
    kept, _ = strip_constraint_cards(bulk)
    assert kept == ["GRID           9              0.0     0.0     0.0"]


@pytest.mark.parametrize("continuation", [
    "                     7       8",      # 고정필드 — 첫 8칸 공백
    "+SP1           7       8",            # 연속 마커
    ",5,123456,6,123456",                  # free-field — 콤마로 시작
])
def test_strip_constraint_cards_removes_every_continuation_form(continuation):
    """원본 BDF 는 외부에서 오므로 연속행 양식을 강제할 수 없다.

    한 형태라도 놓치면 구속 카드 본문만 지워지고 연속행이 살아남아,
    깨진 조각이 생성 BDF 에 실린다.
    """
    bulk = [
        "SUPORT1,1,123456,2,123456,3,123456,4,123456",
        continuation,
        "GRID,7,,0.0,0.0,0.0",
    ]
    kept, removed = strip_constraint_cards(bulk)
    assert kept == ["GRID,7,,0.0,0.0,0.0"]
    assert removed == {"SUPORT1": 1}


def test_spc1_lines_emit_repeated_cards_of_six_nodes():
    lines = spc1_lines(SPC_SID, list(range(101, 121)))   # 20개
    assert len(lines) == 4                                # 6+6+6+2
    assert all(ln.startswith("SPC1    ") for ln in lines)
    assert all(len(ln) <= 80 for ln in lines)
    first_fields = [lines[0][i:i + 8].strip() for i in range(8, len(lines[0]), 8)]
    assert first_fields[:2] == [str(SPC_SID), "123456"]
    assert first_fields[2:] == [str(n) for n in range(101, 107)]


def test_build_stress_bdf_wires_case_control_and_cards():
    result = build_stress_bdf(
        bulk_lines=extract_bulk_lines(SAMPLE_DECK),
        contact_node_ids=[2, 1, 2],           # 중복·역순도 받아 정리한다
        accel_g=(0.0, 0.0, -1.0),
        rotation_z_deg=0.0,
    )
    text = result["text"]
    assert "SOL 101" in text and text.rstrip().endswith("ENDDATA")
    assert f"  SPC = {SPC_SID}" in text
    assert f"  LOAD = {LOAD_SID}" in text
    assert "  STRESS = ALL" in text
    assert "  SPCFORCES = ALL" in text
    # 원본 구속은 사라지고 새 SPC1 만 남는다
    assert "SUPORT" not in text
    assert text.count("SPC1    ") == 1
    assert result["spcNodeIds"] == [1, 2]
    assert result["removedCounts"]["SUPORT"] == 1
    assert result["accelLocalG"] == (0.0, 0.0, -1.0)


def test_build_stress_bdf_rejects_empty_contacts():
    with pytest.raises(ValueError, match="접촉 절점"):
        build_stress_bdf(
            bulk_lines=extract_bulk_lines(SAMPLE_DECK),
            contact_node_ids=[],
            accel_g=(0.0, 0.0, -1.0),
            rotation_z_deg=0.0,
        )
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_module_ocean_bdf.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_stress_bdf'`

- [ ] **Step 3: 구현**

`module_ocean_bdf.py` 끝에 추가:

```python
# ── 과정 1: Module Unit 단독 응력 해석 BDF ────────────────────────────────

# 원본에서 걷어낼 구속 카드. 해상 운송 해석은 접촉 절점에 새 SPC 를 건다 —
# 원본의 임시 지지/바닥 구속이 남아 있으면 하중 경로가 왜곡된다.
_CONSTRAINT_CARDS = frozenset({
    "SPC", "SPC1", "SPCD", "SPCAX", "SPCADD", "SUPORT", "SUPORT1",
})

# 고정필드 SPC1 한 줄에 들어가는 절점 수 — 카드(8) + SID(8) + C(8) + 6×8 = 80칸.
_SPC1_NODES_PER_CARD = 6


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


def strip_constraint_cards(bulk_lines: Iterable[str]) -> Tuple[List[str], dict]:
    """SPC 계열·SUPORT 계열 카드와 그 continuation 줄을 걷어낸다.

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
        if name in _CONSTRAINT_CARDS:
            removed[name] = removed.get(name, 0) + 1
            dropping = True
            continue
        if dropping and _is_continuation(raw):
            continue
        dropping = False
        kept.append(raw)

    return kept, removed


def _chunks(values: Sequence[Any], size: int) -> List[List[Any]]:
    return [list(values[i:i + size]) for i in range(0, len(values), size)]


def spc1_lines(sid: int, node_ids: Sequence[int], components: str = "123456") -> List[str]:
    """SPC1 카드들. continuation 대신 같은 SID 카드를 여러 장 낸다 —
    SID 가 같으면 Nastran 이 합산하므로 continuation 양식 위험을 피할 수 있다."""
    return [line("SPC1", sid, components, *chunk)
            for chunk in _chunks(list(node_ids), _SPC1_NODES_PER_CARD)]


def build_stress_bdf(
    *,
    bulk_lines: Iterable[str],
    contact_node_ids: Iterable[int],
    accel_g: Sequence[float],
    rotation_z_deg: float,
    title: str = "Module Unit Ocean Transport - Element Stress",
) -> dict:
    """과정 1 BDF. 정반은 모델에 없고 접촉 절점의 SPC 123456 이 그 역할을 대신한다."""
    node_ids = sorted({int(n) for n in contact_node_ids})
    if not node_ids:
        raise ValueError("접촉 절점이 없습니다. 2단계 적치를 먼저 수행하세요.")

    accel_local = rotate_accel_to_local(accel_g, rotation_z_deg)
    kept, removed = strip_constraint_cards(bulk_lines)

    generated = [
        "$",
        "$ HiTESS WorkBench - Module Unit Ocean Transport (stress run)",
        f"$ contact SPC nodes = {len(node_ids)}, "
        f"removed constraint cards = {sum(removed.values())}",
        *spc1_lines(SPC_SID, node_ids),
        grav_line(LOAD_SID, accel_local),
    ]

    header = [
        "SOL 101",
        "CEND",
        f"TITLE = {title}",
        "SUBCASE 1",
        "  LABEL = Ocean transport acceleration",
        f"  SPC = {SPC_SID}",
        f"  LOAD = {LOAD_SID}",
        "  DISPLACEMENT = ALL",
        "  SPCFORCES = ALL",
        "  FORCE = ALL",
        "  STRESS = ALL",
        "BEGIN BULK",
    ]

    return {
        "text": "\n".join([*header, *kept, *generated, "ENDDATA"]) + "\n",
        "spcNodeIds": node_ids,
        "removedCounts": removed,
        "accelLocalG": accel_local,
    }
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_module_ocean_bdf.py -v`
Expected: PASS (19 passed)

- [ ] **Step 5: 커밋 지점 (사용자 직접)**

보고할 파일: `app/services/module_ocean_bdf.py`, `tests/test_module_ocean_bdf.py`

---

## Task 5: 과정 2 BDF 조립 — CoG 질점 + Leg 스터브 빔

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/module_ocean_bdf.py`
- Test: `HiTessWorkBenchBackEnd/tests/test_module_ocean_bdf.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_module_ocean_bdf.py` 끝에 추가:

```python
from app.services.module_ocean_bdf import (
    STUB_DIMS_MM,
    STUB_LENGTH_MM,
    build_leg_reaction_bdf,
)


LEGS_A = [
    {"id": 102723, "x": 20260.0, "y": 5200.0, "z": -125.0},
    {"id": 102724, "x": 20260.0, "y": -5200.0, "z": -125.0},
    {"id": 102725, "x": 26260.0, "y": 5200.0, "z": -125.0},
    {"id": 102734, "x": 26260.0, "y": -5200.0, "z": -125.0},
    {"id": 102735, "x": 32260.0, "y": 5200.0, "z": -125.0},
    {"id": 102736, "x": 32260.0, "y": -5200.0, "z": -125.0},
]


def _leg_bdf(**overrides):
    kwargs = dict(
        legs=LEGS_A,
        total_mass_t=100.05,
        cog_mm=(26260.0, 0.0, 12500.0),
        accel_g=(0.0, 0.0, -1.0),
    )
    kwargs.update(overrides)
    return build_leg_reaction_bdf(**kwargs)


def test_leg_bdf_creates_two_grids_and_one_beam_per_leg():
    result = _leg_bdf()
    text = result["text"]
    assert text.count("GRID    ") == 2 * len(LEGS_A) + 1     # 상단+하단 + CoG
    assert text.count("CBEAM   ") == len(LEGS_A)
    assert len(result["legTopIds"]) == len(LEGS_A)
    assert len(result["legBottomIds"]) == len(LEGS_A)


def test_leg_bdf_stub_goes_down_by_500mm():
    text = _leg_bdf()["text"]
    tops = [ln for ln in text.splitlines() if ln.startswith("GRID    ") and " -125.0" in ln]
    bots = [ln for ln in text.splitlines() if ln.startswith("GRID    ") and " -625.0" in ln]
    assert len(tops) == len(bots) == len(LEGS_A)
    assert STUB_LENGTH_MM == 500.0


def test_leg_bdf_uses_h400_section_and_zero_density():
    text = _leg_bdf()["text"]
    assert "PBEAML  " in text
    dims_line = next(ln for ln in text.splitlines()
                     if ln.startswith(" " * 8) and "358.0" in ln)
    assert [float(dims_line[i:i + 8]) for i in range(8, 40, 8)] == list(STUB_DIMS_MM)
    # MAT1 컬럼: MID(8-16) E(16-24) G(24-32, 공백) NU(32-40) RHO(40-48)
    mat1 = next(ln for ln in text.splitlines() if ln.startswith("MAT1    "))
    assert float(mat1[16:24]) == pytest.approx(206000.0)
    assert mat1[24:32].strip() == ""                # G 는 비운다
    assert float(mat1[32:40]) == pytest.approx(0.3)
    assert mat1[40:48].strip() == "0.0"             # RHO — 스터브 자중 배제


def test_leg_bdf_rbe2_independent_is_cog_dependents_are_tops():
    result = _leg_bdf()
    lines = result["text"].splitlines()
    rbe2 = next(ln for ln in lines if ln.startswith("RBE2    "))
    fields = [rbe2[i:i + 8].strip() for i in range(8, len(rbe2), 8)]
    assert fields[1] == str(result["cogNodeId"])         # GN = CoG
    assert fields[2] == "123456"
    assert fields[3] == str(result["legTopIds"][0])      # GM1 = 첫 스터브 상단


def test_leg_bdf_spc_is_on_bottom_nodes_only():
    result = _leg_bdf()
    spc_nodes = []
    for ln in result["text"].splitlines():
        if ln.startswith("SPC1    "):
            fields = [ln[i:i + 8].strip() for i in range(8, len(ln), 8)]
            spc_nodes += [int(f) for f in fields[2:] if f]
    assert sorted(spc_nodes) == sorted(result["legBottomIds"])
    # RBE2 dependent(상단)에는 SPC 가 걸리면 안 된다 — m-set/s-set 충돌.
    assert not set(spc_nodes) & set(result["legTopIds"])


def test_leg_bdf_conm2_carries_total_mass_at_cog():
    result = _leg_bdf(total_mass_t=123.5, cog_mm=(1000.0, 2000.0, 3000.0))
    conm2 = next(ln for ln in result["text"].splitlines() if ln.startswith("CONM2   "))
    fields = [conm2[i:i + 8].strip() for i in range(8, len(conm2), 8)]
    assert fields[1] == str(result["cogNodeId"])
    assert float(fields[3]) == pytest.approx(123.5)
    cog_grid = next(ln for ln in result["text"].splitlines()
                    if ln.startswith("GRID    ") and str(result["cogNodeId"]) in ln[8:16])
    assert float(cog_grid[24:32]) == pytest.approx(1000.0)


def test_leg_bdf_rejects_empty_legs_and_zero_mass():
    with pytest.raises(ValueError, match="Leg"):
        _leg_bdf(legs=[])
    with pytest.raises(ValueError, match="중량"):
        _leg_bdf(total_mass_t=0.0)


def test_leg_bdf_all_lines_within_80_columns():
    for ln in _leg_bdf()["text"].splitlines():
        assert len(ln) <= 80, ln
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_module_ocean_bdf.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_leg_reaction_bdf'`

- [ ] **Step 3: 구현**

`module_ocean_bdf.py` 끝에 추가:

```python
# ── 과정 2: Leg 반력 모델 BDF ─────────────────────────────────────────────

STUB_LENGTH_MM = 500.0
# H-400×400×18×21 — PBEAML 'H' 의 DIM 규약은 [웹순높이(d-2tf), 2·tf, 플랜지폭, 웹두께].
# (DIM1=플랜지폭 으로 읽으면 단면적을 26~46% 과소평가한다.)
STUB_DIMS_MM = (358.0, 42.0, 400.0, 18.0)
STEEL_E_MPA = 206000.0
STEEL_NU = 0.3

STUB_PID = 1
STUB_MID = 1
LEG_TOP_GID_BASE = 9000     # 상단 = RBE2 Dependent
LEG_BOT_GID_BASE = 9100     # 하단 = SPC
COG_GID = 9999
STUB_EID_BASE = 9000
RBE2_EID = 9900
CONM2_EID = 9999

# RBE2 고정필드: 첫 줄에 GM 5개(EID/GN/CM + 5 = 8필드), 연속행에 8개.
_RBE2_FIRST = 5
_RBE2_NEXT = 8


def rbe2_lines(eid: int, independent: int, components: str,
               dependents: Sequence[int]) -> List[str]:
    """RBE2 카드(연속행 포함). Independent 1개, Dependent N개."""
    if not dependents:
        raise ValueError("RBE2 dependent 절점이 없습니다.")
    first, rest = list(dependents[:_RBE2_FIRST]), list(dependents[_RBE2_FIRST:])
    result = [line("RBE2", eid, independent, components, *first)]
    for chunk in _chunks(rest, _RBE2_NEXT):
        result.append(cont(*chunk))
    return result


def build_leg_reaction_bdf(
    *,
    legs: Sequence[dict],
    total_mass_t: float,
    cog_mm: Sequence[float],
    accel_g: Sequence[float],
    stub_length_mm: float = STUB_LENGTH_MM,
    title: str = "Module Unit Ocean Transport - Leg Reaction",
) -> dict:
    """과정 2 BDF — 정반 실구조는 넣지 않고 절점 2N+1 개짜리 모델을 새로 만든다.

    합산 무게중심(Independent) → RBE2 → 스터브 상단(Dependent),
    스터브 하단에 SPC 123456. RBE2 dependent DOF 는 SPC 로 구속할 수 없으므로
    (m-set/s-set 충돌) 스터브 빔이 그 사이를 벌려 주는 역할을 겸한다.
    """
    if not legs:
        raise ValueError("정반 Leg 절점이 없습니다.")
    if float(total_mass_t) <= 0.0:
        raise ValueError("합산 중량이 0 이하입니다.")

    bulk: List[str] = [
        "$ SS275 — 스터브 자중이 섞이면 반력 합계 검산이 흐려지므로 RHO=0",
        line("MAT1", STUB_MID, STEEL_E_MPA, None, STEEL_NU, 0.0),
        "$ H-400x400x18x21  DIM = [웹순높이, 2*tf, 플랜지폭, 웹두께]",
        line("PBEAML", STUB_PID, STUB_MID, None, "H"),
        cont(*STUB_DIMS_MM),
    ]

    top_ids: List[int] = []
    bottom_ids: List[int] = []
    for index, leg in enumerate(legs, start=1):
        top = LEG_TOP_GID_BASE + index
        bottom = LEG_BOT_GID_BASE + index
        x, y, z = float(leg["x"]), float(leg["y"]), float(leg["z"])
        bulk.append(line("GRID", top, None, x, y, z))
        bulk.append(line("GRID", bottom, None, x, y, z - float(stub_length_mm)))
        # 방향벡터는 전 Leg 동일 — 6~8점 지지 강체는 정정이 아니라 스터브 강성이
        # 분배율에 관여한다. 동일 단면·동일 방향이어야 배치만으로 분배가 정해진다.
        bulk.append(line("CBEAM", STUB_EID_BASE + index, STUB_PID, top, bottom,
                         1.0, 0.0, 0.0))
        top_ids.append(top)
        bottom_ids.append(bottom)

    cx, cy, cz = (float(v) for v in cog_mm)
    bulk.append("$ 합산(정반+MU) 무게중심 — RBE2 Independent")
    bulk.append(line("GRID", COG_GID, None, cx, cy, cz))
    bulk.append(line("CONM2", CONM2_EID, COG_GID, 0, float(total_mass_t)))
    bulk.extend(rbe2_lines(RBE2_EID, COG_GID, "123456", top_ids))
    bulk.extend(spc1_lines(SPC_SID, bottom_ids))
    bulk.append(grav_line(LOAD_SID, accel_g))

    header = [
        "SOL 101",
        "CEND",
        f"TITLE = {title}",
        "SUBCASE 1",
        "  LABEL = Ocean transport acceleration",
        f"  SPC = {SPC_SID}",
        f"  LOAD = {LOAD_SID}",
        "  DISPLACEMENT = ALL",
        "  SPCFORCES = ALL",
        "  FORCE = ALL",
        "BEGIN BULK",
    ]

    return {
        "text": "\n".join([*header, *bulk, "ENDDATA"]) + "\n",
        "cogNodeId": COG_GID,
        "legTopIds": top_ids,
        "legBottomIds": bottom_ids,
        "legNodeIds": [int(leg["id"]) for leg in legs],
        "totalMassT": float(total_mass_t),
        "cogMm": [cx, cy, cz],
    }
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_module_ocean_bdf.py -v`
Expected: PASS (27 passed)

- [ ] **Step 5: 커밋 지점 (사용자 직접)**

보고할 파일: `app/services/module_ocean_bdf.py`, `tests/test_module_ocean_bdf.py`

---

## Task 6: F06 결과 → 응력 평가

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/module_ocean_results.py`
- Test: `HiTessWorkBenchBackEnd/tests/test_module_ocean_results.py`

`nastran_bridge <f06>`가 내는 JSON 스키마(근거: `nastran_bridge.convert_f06` / `new_subcase_result`):

```
{"analysisResults": {"subcases": [{"subcaseId": 1,
    "spcForces":     [{"pointId", "t1","t2","t3","r1","r2","r3"}],
    "cbeamStresses": [{"elementId", "gridId", "end", "sMax", "sMin", ...}],
    "cbarStresses":  [{"elementId", "sAMax","sAMin","sBMax","sBMin", ...}],
    "quadStresses":  [{"elementId", "elementType", "vmZ1", "vmZ2"}],
    "triaStresses":  [{"elementId", "elementType", "vmZ1", "vmZ2"}]}]}}
```
FATAL 이면 `{"fatalMessages": [...]}` 만 담긴다(`analysisResults` 없음).

- [ ] **Step 1: 실패하는 테스트 작성**

`HiTessWorkBenchBackEnd/tests/test_module_ocean_results.py`:

```python
"""F06 결과 JSON → 응력 평가 / Leg 반력 추출 테스트.

입력 스키마는 nastran_bridge.convert_f06 산출물이다(new_subcase_result 참조).
"""
import pytest

from app.services.module_ocean_results import evaluate_stress, f06_fatal_messages


def _f06(**subcase):
    base = {
        "subcaseId": 1,
        "displacements": [], "spcForces": [],
        "cbarForces": [], "cbarStresses": [],
        "cbeamForces": [], "cbeamStresses": [],
        "crodForces": [], "crodStresses": [],
        "quadStresses": [], "triaStresses": [],
    }
    base.update(subcase)
    return {"analysisResults": {"fileName": "x.f06", "subcases": [base]}}


def test_fatal_messages_detected():
    data = {"fatalMessages": [{"text": "USER FATAL MESSAGE 9137"}]}
    assert f06_fatal_messages(data) == [{"text": "USER FATAL MESSAGE 9137"}]
    assert f06_fatal_messages(_f06()) == []


def test_cbeam_uses_absolute_max_over_both_ends():
    data = _f06(cbeamStresses=[
        {"elementId": 10, "gridId": 1, "end": "A", "sMax": 100.0, "sMin": -30.0},
        {"elementId": 10, "gridId": 2, "end": "B", "sMax": 40.0, "sMin": -180.0},
    ])
    out = evaluate_stress(data, allowable_mpa=220.0)
    assert out["summary"]["elementCount"] == 1
    assert out["summary"]["maxStressMPa"] == pytest.approx(180.0)
    assert out["summary"]["maxStressElementId"] == 10
    assert out["topElements"][0]["type"] == "CBEAM"


def test_cbar_uses_absolute_max_over_a_and_b_sections():
    data = _f06(cbarStresses=[
        {"elementId": 7, "sAMax": 55.0, "sAMin": -12.0, "sBMax": 5.0, "sBMin": -66.0},
    ])
    out = evaluate_stress(data, allowable_mpa=220.0)
    assert out["summary"]["maxStressMPa"] == pytest.approx(66.0)
    assert out["topElements"][0]["type"] == "CBAR"


def test_shell_uses_max_von_mises_over_fibers():
    data = _f06(quadStresses=[
        {"elementId": 3, "elementType": "CQUAD4", "vmZ1": 90.0, "vmZ2": 145.0},
    ], triaStresses=[
        {"elementId": 4, "elementType": "CTRIA3", "vmZ1": 20.0, "vmZ2": None},
    ])
    out = evaluate_stress(data, allowable_mpa=220.0)
    by_id = {e["elementId"]: e for e in out["topElements"]}
    assert by_id[3]["stressMPa"] == pytest.approx(145.0)
    assert by_id[3]["type"] == "CQUAD4"
    assert by_id[4]["stressMPa"] == pytest.approx(20.0)


def test_verdict_boundary_at_allowable():
    data = _f06(cbeamStresses=[
        {"elementId": 1, "sMax": 220.0, "sMin": 0.0},
        {"elementId": 2, "sMax": 220.1, "sMin": 0.0},
    ])
    out = evaluate_stress(data, allowable_mpa=220.0)
    verdicts = {e["elementId"]: e["verdict"] for e in out["topElements"]}
    assert verdicts[1] == "OK"
    assert verdicts[2] == "NG"
    assert out["summary"]["exceedCount"] == 1
    assert out["summary"]["maxUsage"] == pytest.approx(220.1 / 220.0)


def test_top_elements_sorted_desc_and_capped():
    data = _f06(cbeamStresses=[
        {"elementId": i, "sMax": float(i), "sMin": 0.0} for i in range(1, 40)
    ])
    out = evaluate_stress(data, allowable_mpa=220.0, top_n=20)
    assert len(out["topElements"]) == 20
    stresses = [e["stressMPa"] for e in out["topElements"]]
    assert stresses == sorted(stresses, reverse=True)
    assert stresses[0] == pytest.approx(39.0)


def test_records_without_any_stress_value_are_skipped():
    """응력 필드가 전부 None 인 레코드는 '0 MPa 합격 요소' 가 아니라 데이터 없음이다."""
    data = _f06(cbeamStresses=[
        {"elementId": 1, "sMax": 150.0, "sMin": -20.0},
        {"elementId": 2, "sMax": None, "sMin": None},
    ])
    out = evaluate_stress(data, allowable_mpa=220.0)
    assert out["summary"]["elementCount"] == 1
    assert [e["elementId"] for e in out["topElements"]] == [1]


def test_missing_subcase_raises_instead_of_returning_another_one():
    """조용히 다른 하중조건 결과를 주면 호출부가 틀린 줄도 모른다."""
    data = _f06(cbeamStresses=[{"elementId": 1, "sMax": 10.0, "sMin": 0.0}])
    with pytest.raises(ValueError, match="SUBCASE 99"):
        evaluate_stress(data, allowable_mpa=220.0, subcase_id=99)


def test_summary_counts_exceeding_elements_beyond_top_n():
    """요약은 top_n 슬라이스가 아니라 전체에서 나와야 한다 — NG 가 잘려 나가면 안 된다."""
    data = _f06(cbeamStresses=[
        {"elementId": i, "sMax": 300.0 + i, "sMin": 0.0} for i in range(1, 31)
    ])
    out = evaluate_stress(data, allowable_mpa=220.0, top_n=5)
    assert len(out["topElements"]) == 5
    assert out["summary"]["elementCount"] == 30
    assert out["summary"]["exceedCount"] == 30


def test_empty_results_raise():
    with pytest.raises(ValueError, match="응력 결과"):
        evaluate_stress(_f06(), allowable_mpa=220.0)


def test_allowable_must_be_positive():
    with pytest.raises(ValueError, match="허용응력"):
        evaluate_stress(_f06(cbeamStresses=[{"elementId": 1, "sMax": 1.0, "sMin": 0.0}]),
                        allowable_mpa=0.0)
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_module_ocean_results.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.module_ocean_results'`

- [ ] **Step 3: 구현**

`HiTessWorkBenchBackEnd/app/services/module_ocean_results.py` (신규):

```python
"""Module Unit 해상 운송 구조 해석 — F06 결과 해석 (순수 함수).

입력은 `nastran_bridge <파일>.f06` 이 내는 JSON 이다(convert_f06 / new_subcase_result).
파일 I/O 는 하지 않는다 — 오케스트레이션 서비스가 읽어서 dict 로 넘겨 준다.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

RESULT_SCHEMA_STRESS = "moduleOceanStress/1"
RESULT_SCHEMA_LEG = "moduleOceanLegReaction/1"

# 반력 합계 검산 허용 상대오차.
REACTION_CHECK_TOL = 1.0e-3


def f06_fatal_messages(f06_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    """FATAL 이 있으면 그 목록, 없으면 빈 리스트."""
    return list(f06_json.get("fatalMessages") or [])


def _subcase(f06_json: Dict[str, Any], subcase_id: int = 1) -> Dict[str, Any]:
    """요청한 SUBCASE 를 고른다. 없으면 **조용히 다른 것을 주지 않고** 예외를 낸다.

    첫 subcase 로 폴백하면 호출부는 요청한 것과 **다른 하중조건**의 결과를
    아무 신호 없이 받는다 — 형태가 멀쩡해 오류로 보이지도 않는다.
    이 함수의 출력은 합불 판정에 쓰이므로 조용히 틀리느니 멈추는 편이 낫다.
    """
    subcases = ((f06_json.get("analysisResults") or {}).get("subcases")) or []
    if not subcases:
        return {}
    for entry in subcases:
        if int(entry.get("subcaseId", 1)) == subcase_id:
            return entry
    available = [entry.get("subcaseId") for entry in subcases]
    raise ValueError(f"F06 에 SUBCASE {subcase_id} 이 없습니다. 있는 것: {available}")


def _abs_max(*values: Optional[float]) -> Optional[float]:
    """절대값 최대. 값이 하나도 없으면 **0.0 이 아니라 None** 을 돌려준다.

    데이터 없음(None)과 응력 0 은 다르다. 0.0 으로 뭉개면 F06 파싱이 깨진 레코드가
    '합격한 0응력 요소'로 둔갑해 요약만 멀쩡해 보인다.
    """
    present = [abs(v) for v in values if v is not None]
    return max(present) if present else None


def evaluate_stress(
    f06_json: Dict[str, Any],
    *,
    allowable_mpa: float,
    subcase_id: int = 1,
    top_n: int = 20,
) -> Dict[str, Any]:
    """요소별 대표 응력을 뽑아 허용응력과 비교한다.

    CBEAM/CBAR 은 축력+굽힘 합성 수직응력(sMax/sMin)의 절대 최대,
    쉘은 상·하면 fiber von Mises 의 최대를 대표값으로 쓴다.
    """
    if allowable_mpa <= 0:
        raise ValueError("허용응력은 0보다 커야 합니다.")

    subcase = _subcase(f06_json, subcase_id)
    peak: Dict[int, Dict[str, Any]] = {}
    # 수직응력(CBEAM/CBAR)과 von Mises(쉘)를 같은 허용응력으로 재는 것은 의도다 —
    # 부재 검토의 통상 관행이다. 빔 쪽은 전단·비틀림이 빠져 있다는 점도 함께 기억할 것.

    def _record(element_id: Any, element_type: str, stress: Optional[float]) -> None:
        # stress 가 None 이면 그 레코드에 응력 값이 하나도 없다는 뜻이다 — 건너뛴다.
        if element_id is None or stress is None:
            return
        eid = int(element_id)
        current = peak.get(eid)
        if current is None or stress > current["stressMPa"]:
            peak[eid] = {"elementId": eid, "type": element_type, "stressMPa": stress}

    for row in subcase.get("cbeamStresses") or []:
        _record(row.get("elementId"), "CBEAM", _abs_max(row.get("sMax"), row.get("sMin")))
    for row in subcase.get("cbarStresses") or []:
        _record(row.get("elementId"), "CBAR",
                _abs_max(row.get("sAMax"), row.get("sAMin"),
                         row.get("sBMax"), row.get("sBMin")))
    for key in ("quadStresses", "triaStresses"):
        for row in subcase.get(key) or []:
            _record(row.get("elementId"), row.get("elementType") or "SHELL",
                    _abs_max(row.get("vmZ1"), row.get("vmZ2")))

    if not peak:
        raise ValueError("F06 에서 응력 결과를 찾지 못했습니다. STRESS 출력 요청을 확인하세요.")

    for entry in peak.values():
        entry["usage"] = entry["stressMPa"] / allowable_mpa
        entry["verdict"] = "NG" if entry["usage"] > 1.0 else "OK"

    ordered = sorted(peak.values(), key=lambda e: e["stressMPa"], reverse=True)
    worst = ordered[0]
    exceed = sum(1 for e in ordered if e["verdict"] == "NG")

    return {
        "schema": RESULT_SCHEMA_STRESS,
        "allowableMPa": allowable_mpa,
        "summary": {
            "elementCount": len(ordered),
            "maxStressMPa": worst["stressMPa"],
            "maxStressElementId": worst["elementId"],
            "maxUsage": worst["usage"],
            "exceedCount": exceed,
        },
        "topElements": ordered[:top_n],
    }
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_module_ocean_results.py -v`
Expected: PASS (11 passed)

- [ ] **Step 5: 커밋 지점 (사용자 직접)**

보고할 파일: `app/services/module_ocean_results.py`, `tests/test_module_ocean_results.py`

---

## Task 7: F06 결과 → Leg 반력 추출

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/module_ocean_results.py`
- Test: `HiTessWorkBenchBackEnd/tests/test_module_ocean_results.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_module_ocean_results.py` 끝에 추가:

```python
from app.services.module_ocean_bdf import G_MM_S2
from app.services.module_ocean_results import extract_leg_reactions


LEGS = [
    {"id": 102723, "x": 20260.0, "y": 5200.0, "z": -125.0},
    {"id": 102724, "x": 20260.0, "y": -5200.0, "z": -125.0},
]
BOTTOM_IDS = [9101, 9102]


def _reaction_f06(t3_each):
    return {"analysisResults": {"fileName": "x.f06", "subcases": [{
        "subcaseId": 1, "displacements": [],
        "spcForces": [
            {"pointId": 9101, "t1": 0.0, "t2": 0.0, "t3": t3_each,
             "r1": 0.0, "r2": 0.0, "r3": 0.0},
            {"pointId": 9102, "t1": 0.0, "t2": 0.0, "t3": t3_each,
             "r1": 0.0, "r2": 0.0, "r3": 0.0},
        ],
        "cbarForces": [], "cbarStresses": [], "cbeamForces": [], "cbeamStresses": [],
        "crodForces": [], "crodStresses": [], "quadStresses": [], "triaStresses": [],
    }]}}


def test_leg_reactions_map_bottom_nodes_back_to_jungban_legs():
    mass_t = 10.0
    each = mass_t * G_MM_S2 / 2.0            # 자중을 두 Leg 가 균등 분담
    out = extract_leg_reactions(
        _reaction_f06(each),
        legs=LEGS, leg_bottom_ids=BOTTOM_IDS,
        total_mass_t=mass_t, accel_g=(0.0, 0.0, -1.0),
    )
    assert [leg["jungbanNodeId"] for leg in out["legs"]] == [102723, 102724]
    assert out["legs"][0]["x"] == 20260.0
    assert out["legs"][0]["fzN"] == pytest.approx(each)
    assert out["legs"][0]["resultantN"] == pytest.approx(each)


def test_leg_reaction_sum_check_passes_when_balanced():
    mass_t = 10.0
    out = extract_leg_reactions(
        _reaction_f06(mass_t * G_MM_S2 / 2.0),
        legs=LEGS, leg_bottom_ids=BOTTOM_IDS,
        total_mass_t=mass_t, accel_g=(0.0, 0.0, -1.0),
    )
    assert out["check"]["ok"] is True
    assert out["check"]["expectedN"][2] == pytest.approx(mass_t * G_MM_S2)
    assert out["check"]["maxRelError"] < 1e-6


def test_leg_reaction_sum_check_fails_when_unbalanced():
    out = extract_leg_reactions(
        _reaction_f06(1.0),                   # 터무니없이 작은 반력
        legs=LEGS, leg_bottom_ids=BOTTOM_IDS,
        total_mass_t=10.0, accel_g=(0.0, 0.0, -1.0),
    )
    assert out["check"]["ok"] is False


def test_leg_reaction_raises_when_spc_force_missing():
    empty = _reaction_f06(0.0)
    empty["analysisResults"]["subcases"][0]["spcForces"] = []
    with pytest.raises(ValueError, match="SPC 반력"):
        extract_leg_reactions(empty, legs=LEGS, leg_bottom_ids=BOTTOM_IDS,
                              total_mass_t=10.0, accel_g=(0.0, 0.0, -1.0))
```

- [ ] **Step 2: 실패 확인**

Run: `python -m pytest tests/test_module_ocean_results.py -v`
Expected: FAIL — `ImportError: cannot import name 'extract_leg_reactions'`

- [ ] **Step 3: 구현**

`module_ocean_results.py` 끝에 추가:

```python
def extract_leg_reactions(
    f06_json: Dict[str, Any],
    *,
    legs: Sequence[Dict[str, Any]],
    leg_bottom_ids: Sequence[int],
    total_mass_t: float,
    accel_g: Sequence[float],
    subcase_id: int = 1,
) -> Dict[str, Any]:
    """스터브 하단 SPC 반력을 정반 Leg 로 되돌려 매핑한다.

    `leg_bottom_ids[i]` 는 `legs[i]` 아래에 세운 스터브의 하단 절점이다
    (build_leg_reaction_bdf 가 같은 순서로 만든다).
    """
    from .module_ocean_bdf import G_MM_S2      # 순환 없음 — bdf 는 results 를 모른다

    subcase = _subcase(f06_json, subcase_id)
    by_point = {int(row["pointId"]): row for row in (subcase.get("spcForces") or [])
                if row.get("pointId") is not None}
    if not by_point:
        raise ValueError("F06 에서 SPC 반력을 찾지 못했습니다. SPCFORCES 출력 요청을 확인하세요.")

    rows: List[Dict[str, Any]] = []
    total = [0.0, 0.0, 0.0]
    for index, (leg, bottom_id) in enumerate(zip(legs, leg_bottom_ids), start=1):
        record = by_point.get(int(bottom_id))
        if record is None:
            raise ValueError(f"Leg {index}(절점 {bottom_id})의 SPC 반력이 F06 에 없습니다.")
        fx = float(record.get("t1") or 0.0)
        fy = float(record.get("t2") or 0.0)
        fz = float(record.get("t3") or 0.0)
        total = [total[0] + fx, total[1] + fy, total[2] + fz]
        rows.append({
            "index": index,
            "jungbanNodeId": int(leg["id"]),
            "stubBottomNodeId": int(bottom_id),
            "x": float(leg["x"]),
            "y": float(leg["y"]),
            "fxN": fx, "fyN": fy, "fzN": fz,
            "resultantN": (fx * fx + fy * fy + fz * fz) ** 0.5,
            "mxNmm": float(record.get("r1") or 0.0),
            "myNmm": float(record.get("r2") or 0.0),
            "mzNmm": float(record.get("r3") or 0.0),
        })

    # 검산: 반력 합계는 관성력과 크기가 같고 방향이 반대다.
    mass = float(total_mass_t)
    expected = [-mass * float(component) * G_MM_S2 for component in accel_g]
    scale = max(abs(v) for v in expected) or 1.0
    max_rel_error = max(abs(total[i] - expected[i]) / scale for i in range(3))

    return {
        "schema": RESULT_SCHEMA_LEG,
        "totalMassT": mass,
        "accelG": {"ax": float(accel_g[0]), "ay": float(accel_g[1]), "az": float(accel_g[2])},
        "legs": rows,
        "check": {
            "sumReactionN": total,
            "expectedN": expected,
            "maxRelError": max_rel_error,
            "ok": max_rel_error <= REACTION_CHECK_TOL,
        },
    }
```

- [ ] **Step 4: 통과 확인**

Run: `python -m pytest tests/test_module_ocean_results.py -v`
Expected: PASS (12 passed)

- [ ] **Step 5: 커밋 지점 (사용자 직접)**

보고할 파일: `app/services/module_ocean_results.py`, `tests/test_module_ocean_results.py`

---

## Task 8: 오케스트레이션 서비스

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/module_ocean_structural_service.py`

이 Task는 파일 I/O·subprocess·DB를 다루므로 단위 테스트 대신 Task 12의 실측으로 검증한다.
순수 로직은 Task 3~7에서 이미 고정되어 있다.

- [ ] **Step 1: 서비스 작성**

`HiTessWorkBenchBackEnd/app/services/module_ocean_structural_service.py` (신규):

```python
"""Module Unit 해상 운송 구조 해석 — 3단계 오케스트레이션.

한 job 안에서 두 과정을 순차 실행한다.
  과정 1 (진행률 10→50) : MU 단독 + 접촉 SPC + 가속도 → Element Stress
  과정 2 (진행률 50→95) : CoG 질점 + Leg 스터브 빔 → Leg 반력

BDF 조립은 module_ocean_bdf(순수), 결과 해석은 module_ocean_results(순수) 에 있다.
여기서는 파일 입출력·Nastran 실행·job/DB 만 다룬다.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
from typing import Any, Dict, List, Optional

from .analysis_runner import (
    build_nastran_bridge_command,
    mark_complete,
    mark_running,
    record_analysis,
    run_subprocess_killtree,
    update_progress,
)
from .module_ocean_bdf import build_leg_reaction_bdf, build_stress_bdf, extract_bulk_lines
from .module_ocean_results import (
    evaluate_stress,
    extract_leg_reactions,
    f06_fatal_messages,
)
from .module_ocean_transport_service import get_jungban_leg_nodes

logger = logging.getLogger(__name__)

PROGRAM_NAME = "ModuleOceanTransportStructural"

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


def _run_nastran(bdf_path: str) -> str:
    """Nastran SOL 101 실행. 반환은 콘솔 로그 — F06 존재 여부로 성공을 판단한다."""
    exe = _resolve_nastran_exe()
    if not exe:
        raise RuntimeError(
            "Nastran 실행 파일을 찾지 못했습니다. NASTRAN_EXE 환경변수를 설정하세요."
        )
    work_dir = os.path.dirname(bdf_path)
    cmd = [exe, os.path.basename(bdf_path), "scr=yes", "old=no", "batch=no"]
    logger.info("[ModuleOceanStructural] Nastran: %s (cwd=%s)", " ".join(cmd), work_dir)
    proc = subprocess.run(
        cmd, cwd=work_dir, capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=NASTRAN_TIMEOUT_SEC,
    )
    log = (proc.stdout or "")
    if (proc.stderr or "").strip():
        log += "\n[stderr]\n" + proc.stderr
    return log


def _f06_to_json(f06_path: str) -> Dict[str, Any]:
    """nastran_bridge <f06> 로 결과 JSON 을 만든다(CLI 무변경 재사용)."""
    json_path = os.path.splitext(f06_path)[0] + "_f06.json"
    cmd = build_nastran_bridge_command(f06_path, "-o", json_path)
    proc = run_subprocess_killtree(cmd, cwd=os.path.dirname(f06_path),
                                   timeout=BRIDGE_TIMEOUT_SEC)
    if proc.returncode != 0 or not os.path.exists(json_path):
        raise RuntimeError(
            f"F06 파싱에 실패했습니다(exit {proc.returncode}): {proc.stderr or proc.stdout}"
        )
    with open(json_path, "r", encoding="utf-8") as fp:
        return json.load(fp)


def _fatal_text(messages: List[Dict[str, Any]]) -> str:
    return "\n".join(str(m.get("text") or m) for m in messages[:20])


def _write(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8") as fp:
        fp.write(text)


def _run_one(stem: str, bdf_text: str, phase: str) -> Dict[str, Any]:
    """BDF 를 쓰고 Nastran 을 돌려 결과 JSON 까지. FATAL 이면 RuntimeError."""
    bdf_path = f"{stem}.bdf"
    _write(bdf_path, bdf_text)
    console_log = _run_nastran(bdf_path)

    f06_path = f"{stem}.f06"
    if not os.path.exists(f06_path):
        raise RuntimeError(f"{phase}: Nastran 이 F06 을 만들지 못했습니다.\n{console_log[-2000:]}")

    f06_json = _f06_to_json(f06_path)
    fatals = f06_fatal_messages(f06_json)
    if fatals:
        raise RuntimeError(f"{phase}: Nastran FATAL\n{_fatal_text(fatals)}")

    return {"bdfPath": bdf_path, "f06Path": f06_path, "f06Json": f06_json,
            "consoleLog": console_log}


def task_execute_ocean_structural(job_id: str, payload: Dict[str, Any]) -> None:
    """3단계 두 과정을 순차 실행한다. payload 스키마는 라우터가 검증해서 넘긴다."""
    employee_id = payload["employee_id"]
    bdf_path = payload["bdf_path"]
    work_dir = payload["work_dir"]
    deck_type = payload["deck_type"]
    contact_node_ids = payload["contact_node_ids"]
    rotation_z_deg = float(payload.get("rotation_z_deg") or 0.0)
    accel_g = (float(payload["accel"]["ax"]),
               float(payload["accel"]["ay"]),
               float(payload["accel"]["az"]))
    sigma_y = float(payload["material"]["sigmaYMPa"])
    factor = float(payload["material"]["factor"])
    allowable = sigma_y * factor

    mark_running(job_id, "해석 모델을 준비하는 중...", 10)
    stem_base = os.path.join(work_dir, os.path.splitext(os.path.basename(bdf_path))[0])

    project_data = None
    try:
        # ── 과정 1 : Module Unit 단독 응력 ───────────────────────────────
        update_progress(job_id, 15, "과정 1/2 — Module Unit 응력 해석 BDF 생성 중...")
        with open(bdf_path, "r", encoding="utf-8", errors="replace") as fp:
            original_text = fp.read()

        stress_build = build_stress_bdf(
            bulk_lines=extract_bulk_lines(original_text),
            contact_node_ids=contact_node_ids,
            accel_g=accel_g,
            rotation_z_deg=rotation_z_deg,
        )
        update_progress(job_id, 25, "과정 1/2 — Nastran 해석 중...")
        stress_run = _run_one(f"{stem_base}_ocean_stress", stress_build["text"], "과정 1")

        update_progress(job_id, 45, "과정 1/2 — 응력 평가 중...")
        stress_result = evaluate_stress(stress_run["f06Json"], allowable_mpa=allowable)
        stress_result.update({
            "accelG": {"ax": accel_g[0], "ay": accel_g[1], "az": accel_g[2]},
            "accelLocalG": {
                "ax": stress_build["accelLocalG"][0],
                "ay": stress_build["accelLocalG"][1],
                "az": stress_build["accelLocalG"][2],
            },
            "rotationZDeg": rotation_z_deg,
            "material": {"name": "SS275", "sigmaYMPa": sigma_y, "factor": factor},
            "spcNodeCount": len(stress_build["spcNodeIds"]),
            "removedConstraintCards": stress_build["removedCounts"],
        })
        stress_json_path = f"{stem_base}_ocean_stress.json"
        _write(stress_json_path, json.dumps(stress_result, ensure_ascii=False, indent=2))

        # ── 과정 2 : Leg 반력 ────────────────────────────────────────────
        update_progress(job_id, 55, "과정 2/2 — Leg 반력 모델 생성 중...")
        legs = get_jungban_leg_nodes(deck_type)
        leg_build = build_leg_reaction_bdf(
            legs=legs,
            total_mass_t=float(payload["total_mass_t"]),
            cog_mm=payload["total_cog_mm"],
            accel_g=accel_g,
        )
        update_progress(job_id, 65, "과정 2/2 — Nastran 해석 중...")
        leg_run = _run_one(f"{stem_base}_ocean_legreact", leg_build["text"], "과정 2")

        update_progress(job_id, 90, "과정 2/2 — 반력 정리 중...")
        leg_result = extract_leg_reactions(
            leg_run["f06Json"],
            legs=legs,
            leg_bottom_ids=leg_build["legBottomIds"],
            total_mass_t=leg_build["totalMassT"],
            accel_g=accel_g,
        )
        leg_result["deckType"] = deck_type
        leg_result["cogMm"] = leg_build["cogMm"]
        leg_json_path = f"{stem_base}_ocean_legreact.json"
        _write(leg_json_path, json.dumps(leg_result, ensure_ascii=False, indent=2))

        # ── 마감 ─────────────────────────────────────────────────────────
        result_info = {
            "stress": {
                "resultJson": stress_json_path,
                "bdf": stress_run["bdfPath"],
                "f06": stress_run["f06Path"],
                "summary": stress_result["summary"],
                "allowableMPa": allowable,
            },
            "legReaction": {
                "resultJson": leg_json_path,
                "bdf": leg_run["bdfPath"],
                "f06": leg_run["f06Path"],
                "legs": leg_result["legs"],
                "check": leg_result["check"],
            },
        }
        project_data, db_error = record_analysis(
            job_id=job_id,
            project_name=os.path.basename(work_dir),
            program_name=PROGRAM_NAME,
            employee_id=employee_id,
            status="Success",
            input_info={
                "parent_analysis_id": payload.get("parent_analysis_id"),
                "bdf_path": bdf_path,
                "deck_type": deck_type,
                "accel_g": {"ax": accel_g[0], "ay": accel_g[1], "az": accel_g[2]},
                "rotation_z_deg": rotation_z_deg,
                "material": {"name": "SS275", "sigmaYMPa": sigma_y, "factor": factor},
                "total_mass_t": payload["total_mass_t"],
                "total_cog_mm": payload["total_cog_mm"],
                "contact_node_count": len(stress_build["spcNodeIds"]),
            },
            result_info=result_info,
            source=payload.get("source") or "web",
        )
        engine_log = stress_run["consoleLog"] + "\n" + leg_run["consoleLog"]
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
            project_name=os.path.basename(work_dir),
            program_name=PROGRAM_NAME,
            employee_id=employee_id,
            status="Failed",
            input_info={"bdf_path": bdf_path, "deck_type": deck_type},
            result_info=None,
            source=payload.get("source") or "web",
        )
        mark_complete(
            job_id, "Failed", str(exc), project_data,
            failure_message="해상 운송 구조 해석에 실패했습니다",
        )
```

- [ ] **Step 2: import 확인**

Run: `python -c "from app.services.module_ocean_structural_service import task_execute_ocean_structural; print('ok')"`
Expected: `ok`

- [ ] **Step 3: 전체 테스트 회귀**

Run: `python -m pytest tests/ -q`
Expected: 기존 테스트 전부 PASS (신규 실패 없음)

- [ ] **Step 4: 커밋 지점 (사용자 직접)**

보고할 파일: `app/services/module_ocean_structural_service.py`

---

## Task 9: 라우터 엔드포인트와 앱 게이트

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/routers/module_ocean_transport.py`
- Modify: `HiTessWorkBenchBackEnd/app/services/app_settings.py:43-51` (`GUARDED_ROUTES`)

- [ ] **Step 1: GUARDED_ROUTES 등록**

`app/services/app_settings.py`의 `GUARDED_ROUTES` 튜플에서 GMU 줄 **아래**에 추가한다.
(경로 매칭은 접두사 우선순위 순이라 더 구체적인 경로가 먼저 와야 하지만, 이 둘은 겹치지 않는다.)

```python
    ("/api/analysis/groupmoduleunit/", "Group & Module Unit 권상 구조 해석"),
    # 해상 운송은 전용 엔드포인트를 쓴다 — 미등록이면 fail-open 이라 반드시 여기 있어야 한다.
    ("/api/analysis/module-ocean-transport/", "Module Unit 해상 운송 구조 해석"),
```

- [ ] **Step 2: 엔드포인트 추가**

`app/routers/module_ocean_transport.py` 상단 import에 추가:

```python
from pydantic import BaseModel, Field
from ..services.module_ocean_structural_service import task_execute_ocean_structural
```

파일 끝에 추가:

```python
# ── 3단계: 구조 해석 수행 ─────────────────────────────────────────────────

class AccelInput(BaseModel):
    ax: float = 0.0
    ay: float = 0.0
    az: float = -1.0


class MaterialInput(BaseModel):
    sigmaYMPa: float = Field(275.0, gt=0)     # SS275
    factor: float = Field(0.8, gt=0, le=1.0)  # 허용 = 0.8 × σy = 220 MPa


class StructuralRunRequest(BaseModel):
    bdf_path: str
    deck_type: str = DEFAULT_DECK_TYPE
    contact_node_ids: list[int]
    rotation_z_deg: float = 0.0
    total_mass_t: float = Field(..., gt=0)
    total_cog_mm: list[float]
    accel: AccelInput = AccelInput()
    material: MaterialInput = MaterialInput()
    parent_analysis_id: int | None = None


@router.post("/structural-run")
def run_structural_analysis(
    body: StructuralRunRequest,
    employee_id: str = Depends(require_auth),
    db: Session = Depends(database.get_db),
):
    """2단계 적치 결과로 ① MU 응력 해석 ② Leg 반력 해석을 순차 수행한다."""
    bdf_path = os.path.abspath(body.bdf_path)
    if not _is_within_dir(_USER_CONNECTION_DIR, bdf_path) or not os.path.isfile(bdf_path):
        raise HTTPException(status_code=400, detail="BDF 경로가 올바르지 않습니다.")
    assert_current_user_can_access_path(employee_id, bdf_path, db)

    if not body.contact_node_ids:
        raise HTTPException(status_code=400,
                            detail="접촉 절점이 없습니다. 2단계 적치를 먼저 수행하세요.")
    if len(body.total_cog_mm) != 3:
        raise HTTPException(status_code=400, detail="무게중심 좌표는 [x, y, z] 3개여야 합니다.")

    accel = body.accel
    if (accel.ax ** 2 + accel.ay ** 2 + accel.az ** 2) <= 0.0:
        raise HTTPException(status_code=400,
                            detail="가속도 크기가 0 입니다. 하중이 없어 해석할 수 없습니다.")

    try:
        deck_type_label = next(d for d in list_jungban_deck_types()
                               if d["id"] == body.deck_type)
    except StopIteration:
        raise HTTPException(status_code=400,
                            detail=f"알 수 없는 정반 타입입니다: {body.deck_type}")

    payload = {
        "employee_id": employee_id,
        "bdf_path": bdf_path,
        "work_dir": os.path.dirname(bdf_path),
        "deck_type": body.deck_type,
        "contact_node_ids": body.contact_node_ids,
        "rotation_z_deg": body.rotation_z_deg,
        "total_mass_t": body.total_mass_t,
        "total_cog_mm": body.total_cog_mm,
        "accel": accel.model_dump(),
        "material": body.material.model_dump(),
        "parent_analysis_id": body.parent_analysis_id,
        "source": "web",
    }
    job_id = submit_analysis_job(
        task_execute_ocean_structural, payload,
        queue_message="구조 해석 대기 중...",
    )
    logger.info("[ModuleOceanTransport] 구조 해석 제출 job=%s deck=%s contacts=%d",
                job_id, deck_type_label["id"], len(body.contact_node_ids))
    return {"job_id": job_id}
```

- [ ] **Step 3: 서버 기동 확인**

Run:
```bash
python -c "from app.main import app; print([r.path for r in app.routes if 'module-ocean' in getattr(r,'path','')])"
```
Expected: 목록에 `/api/analysis/module-ocean-transport/structural-run` 포함

- [ ] **Step 4: 커밋 지점 (사용자 직접)**

보고할 파일: `app/routers/module_ocean_transport.py`, `app/services/app_settings.py`

---

## Task 10: 프론트 — 접촉 절점 인덱스 노출

**Files:**
- Modify: `HiTessWorkBench/frontend/src/utils/feGeometry.js:307-410` (`computeSeating`)
- Test: `HiTessWorkBench/frontend/src/utils/feGeometry.test.js`

- [ ] **Step 1: 실패하는 테스트 작성**

`feGeometry.test.js` 끝에 추가 (기존 파일의 헬퍼/스타일을 그대로 따른다):

```js
import { computeSeating, prepareModuleFootprint } from './feGeometry';

describe('computeSeating — 접촉 절점 인덱스', () => {
  // 평평한 상판(z=0) 위에 바닥이 평평한 4절점 모듈을 올린다.
  const surface = {
    topZ: 0,
    plateBBox: [-1000, -1000, 1000, 1000],
    isRectangular: true,
    grid: null,
  };
  const moduleModel = {
    positions: [
      -100, -100, 0,     // 0 — 바닥
       100, -100, 0,     // 1 — 바닥
       100,  100, 0,     // 2 — 바닥
      -100,  100, 500,   // 3 — 위쪽, 접점 아님
    ],
  };

  it('contacts[] 각 원소가 원본 절점 인덱스 i 를 가진다', () => {
    const footprint = prepareModuleFootprint(moduleModel);
    const seating = computeSeating(surface, footprint, {
      deckCenter: [0, 0], contactTolMm: 10, checkPenetration: false,
    });
    expect(seating.ok).toBe(true);
    expect(seating.contacts.map(c => c.i).sort()).toEqual([0, 1, 2]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run (`HiTessWorkBench/frontend/`에서): `node --test src/utils/feGeometry.test.js`
Expected: FAIL — `contacts[].i` 가 `undefined` 라 `[undefined, undefined, undefined]`

> 위 테스트가 `surface` 목(mock) 형태 때문에 `isOnPlate`에서 실패하면, 테스트를 실제
> `buildDeckSurface()`로 만든 surface를 쓰도록 바꾼다. 검증하려는 것은 `i` 필드의 존재이지
> surface 목의 모양이 아니다.

- [ ] **Step 3: 구현**

`feGeometry.js`의 `computeSeating` 안, 접점 수집 루프를 고친다:

```js
  // ── 2) 접점 수집 ──────────────────────────────────────────────────────
  const contacts = [];
  for (let i = 0; i < count; i += 1) {
    if (!onPlateFlag[i]) continue;
    const rel = local[3 * i + 2] - minLocalZ;
    // i 는 positions/nodeIds 의 원본 인덱스다 — 3단계가 이걸로 BDF 절점 ID 를 찾는다.
    if (rel <= contactTolMm) contacts.push({ i, x: worldX[i], y: worldY[i], z: surface.topZ + rel });
  }
```

- [ ] **Step 4: 통과 확인**

Run: `node --test src/utils/feGeometry.test.js`
Expected: PASS (기존 테스트 포함 전부)

- [ ] **Step 5: 커밋 지점 (사용자 직접)**

보고할 파일: `src/utils/feGeometry.js`, `src/utils/feGeometry.test.js`

---

## Task 11: 프론트 — API 클라이언트와 3단계 패널

**Files:**
- Modify: `HiTessWorkBench/frontend/src/api/analysis.js:150-190`
- Modify: `HiTessWorkBench/frontend/src/pages/analysis/ModuleUnitOceanTransportAnalysis.jsx`

- [ ] **Step 1: API 클라이언트 추가**

`src/api/analysis.js`의 `requestModuleOceanTransport` 아래에 추가:

```js
/**
 * Module Unit 해상 운송 구조 해석 — 3단계 구조 해석 수행.
 * 과정 1(MU 응력) + 과정 2(Leg 반력) 를 한 job 으로 순차 실행한다.
 */
export const requestModuleOceanStructural = (payload) =>
  axios.post(`${API_BASE_URL}/api/analysis/module-ocean-transport/structural-run`, payload, {
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
  }).then(res => res.data);
```

> `authHeaders()`가 이 파일의 실제 헬퍼 이름과 다르면 같은 파일의 다른 함수가 쓰는 방식을 그대로 따른다.

- [ ] **Step 2: 3단계 상태 추가**

`ModuleUnitOceanTransportAnalysis.jsx`의 Step 4 상태 선언(약 line 661) **위**에 추가:

```jsx
  // ── Step 3: 구조 해석 ────────────────────────────────────────
  const [accel, setAccel] = useState(savedPageState.accel ?? { ax: 0, ay: 0, az: -1 });
  const [material, setMaterial] = useState(savedPageState.material ?? { sigmaYMPa: 275, factor: 0.8 });
  const [structuralJobId, setStructuralJobId] = useState(null);
  const [structuralBusy, setStructuralBusy] = useState(false);
  const [structuralProgress, setStructuralProgress] = useState(0);
  const [structuralMsg, setStructuralMsg] = useState('');
  const [structuralError, setStructuralError] = useState(null);
  const [structuralResult, setStructuralResult] = useState(savedPageState.structuralResult ?? null);

  const allowableMPa = useMemo(
    () => Number(material.sigmaYMPa || 0) * Number(material.factor || 0),
    [material],
  );
```

- [ ] **Step 2b: 해석용 중량(여유 미반영) memo 추가**

화면의 `massSummary`는 사용자가 넣은 중량 여유(%)가 반영된 값이다. **3단계 해석은 순 모델
중량을 쓴다**(설계 결정)이므로 여유 0%로 한 번 더 계산한다. `massSummary` memo 바로 아래에 둔다:

```jsx
  // 3단계 해석 입력 — 중량 여유(%)를 반영하지 않은 순 모델 중량·CoG.
  // 화면 표시용 massSummary 와 달리 여유를 0 으로 고정해 다시 합산한다.
  const massForAnalysis = useMemo(() => combineMassProperties({
    deckMass: jungbanModel?.massProperties,
    moduleMass: moduleModel?.massProperties,
    placement: (placement?.anchor && placement?.deckCenter) ? {
      anchor: placement.anchor,
      deckCenter: placement.deckCenter,
      deckTopZ: placement.deckTopZ,
      offsetXMm: arrangement.offsetXMm,
      offsetYMm: arrangement.offsetYMm,
      rotationZDeg: arrangement.rotationZDeg,
      gapMm: arrangement.gapMm,
    } : null,
    deckContingencyPct: 0,
    moduleContingencyPct: 0,
  }), [jungbanModel, moduleModel, placement, arrangement]);
```

`savedPageState` 저장 배열(약 line 678·686)에 `accel`, `material`, `structuralResult`를 추가한다.

**★ 전역 작업 등록(필수).** Nastran 해석은 수 분이 걸린다. 1단계 검증이 쓰는
`startGlobalJob`/`pageJob` 장치에 3단계 job 도 등록해, 페이지를 벗어났다 돌아와도
진행률과 결과를 잃지 않게 한다. 등록하지 않으면 `structuralJobId` 가 사라져 폴링이 끊기고,
백엔드는 계속 도는데 화면에는 아무 결과도 안 남는다.

- [ ] **Step 3: 실행 핸들러 추가**

`handleRunSeating` 등 기존 핸들러 근처에 추가:

```jsx
  // 2단계 적치가 성공하고 관통이 없어야 3단계를 열어 준다.
  const canRunStructural = Boolean(
    seating?.ok && seating.penetrationCount === 0 && bdfPath && deckType && massForAnalysis?.total,
  );

  const handleRunStructural = async () => {
    if (!canRunStructural || structuralBusy) return;
    setStructuralBusy(true);
    setStructuralError(null);
    setStructuralResult(null);
    setStepStatus('structural-run', 'running');
    try {
      // contacts[].i 는 뷰어 positions 인덱스다 — nodeIds 로 실제 BDF 절점 ID 를 만든다.
      const nodeIds = moduleModel?.nodeIds || [];
      const contactNodeIds = seating.contacts
        .map(c => nodeIds[c.i])
        .filter(id => Number.isFinite(id));
      if (!contactNodeIds.length) {
        throw new Error('접촉 절점의 BDF 절점 ID 를 찾지 못했습니다. 모델을 다시 불러오세요.');
      }

      // combineMassProperties 의 cogMm 은 {x,y,z} 객체다 — 백엔드는 [x,y,z] 를 받는다.
      const { massTon, cogMm } = massForAnalysis.total;

      const { job_id } = await requestModuleOceanStructural({
        bdf_path: bdfPath,
        deck_type: deckType,
        contact_node_ids: contactNodeIds,
        rotation_z_deg: arrangement.rotationZDeg || 0,
        total_mass_t: massTon,
        total_cog_mm: [cogMm.x, cogMm.y, cogMm.z],
        accel: { ax: Number(accel.ax), ay: Number(accel.ay), az: Number(accel.az) },
        material: { sigmaYMPa: Number(material.sigmaYMPa), factor: Number(material.factor) },
        parent_analysis_id: bdfAnalysisId ?? null,
      });
      setStructuralJobId(job_id);
    } catch (err) {
      setStructuralBusy(false);
      setStructuralError(err?.response?.data?.detail || err.message);
      setStepStatus('structural-run', 'error');
    }
  };
```

- [ ] **Step 4: 폴링 — 실제로는 `usePolling` 훅을 쓴다**

⚠ **실측 정정.** 아래 `setInterval` 초안은 이 저장소 관례와 다르다:
> - 이 파일은 `usePolling` 훅(`src/hooks/usePolling.js`)을 쓴다. 언마운트·jobId 변경 시
>   타이머를 스스로 정리하므로 `setInterval` 을 직접 쓰지 마라.
> - `getAnalysisStatus` 라는 export 는 없다. 실제 함수는 `getJobStatus` 이고 `usePolling` 이 감싼다.
> - 결과는 `data.result_info` 가 아니라 **`data.project?.result_info`** 로 온다.
> - 실패 메시지는 `errData?.engine_log || errData?.message` 로 받는다.
> - `requestModuleOceanStructural` 은 이 파일 관례대로 **axios 응답 전체**를 반환하므로
>   `res.data.job_id` 로 읽는다. 인증 헤더 헬퍼는 `getAuthHeaders()` 다.

초안은 의도(진행률·완료·실패 처리)만 참고하고, 1단계 `bdf-validation` 의 `usePolling`
블록을 그대로 본떠라:

```jsx
  useEffect(() => {
    if (!structuralJobId) return undefined;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const data = await getAnalysisStatus(structuralJobId);
        if (!alive) return;
        setStructuralProgress(data.progress ?? 0);
        setStructuralMsg(data.message || '');
        if (data.status === 'Success') {
          clearInterval(timer);
          setStructuralBusy(false);
          setStructuralJobId(null);
          setStructuralResult(data.result_info);
          setStepStatus('structural-run', 'done');
        } else if (data.status === 'Failed') {
          clearInterval(timer);
          setStructuralBusy(false);
          setStructuralJobId(null);
          setStructuralError(data.engine_log || '해석에 실패했습니다.');
          setStepStatus('structural-run', 'error');
        }
      } catch {
        /* 폴링 실패는 다음 주기에 재시도 */
      }
    }, 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [structuralJobId]);
```

(위 정정 참고 — 실제 구현은 `usePolling` + `getJobStatus` 다.)

- [ ] **Step 5: 3단계 패널 교체**

`structural-run` 단계의 "구성 예정" 플레이스홀더(약 line 1476)를 실제 패널로 바꾼다:

```jsx
<div className="space-y-4">
  {/* 해석 조건 */}
  <div className="rounded-lg border border-slate-200 bg-white p-4">
    <h4 className="text-sm font-semibold text-slate-700 mb-3">해석 조건</h4>
    <div className="grid grid-cols-3 gap-3">
      {['ax', 'ay', 'az'].map(axis => (
        <label key={axis} className="text-xs text-slate-500">
          {axis.toUpperCase()} [g]
          <input
            type="number" step="0.01" value={accel[axis]}
            disabled={structuralBusy}
            onChange={e => setAccel(a => ({ ...a, [axis]: e.target.value }))}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-800"
          />
        </label>
      ))}
    </div>
    <p className="mt-2 text-[11px] text-slate-400">
      중력을 포함한 총 가속도입니다. 정지 상태 = (0, 0, −1).
    </p>
    <div className="mt-3 grid grid-cols-3 gap-3 items-end">
      <label className="text-xs text-slate-500">
        항복응력 σy [MPa]
        <input
          type="number" step="1" value={material.sigmaYMPa}
          disabled={structuralBusy}
          onChange={e => setMaterial(m => ({ ...m, sigmaYMPa: e.target.value }))}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-800"
        />
      </label>
      <label className="text-xs text-slate-500">
        허용 계수
        <input
          type="number" step="0.05" value={material.factor}
          disabled={structuralBusy}
          onChange={e => setMaterial(m => ({ ...m, factor: e.target.value }))}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-800"
        />
      </label>
      <div className="text-xs text-slate-500">
        허용응력
        <div className="mt-1 rounded bg-slate-50 px-2 py-1 text-sm font-semibold text-slate-800">
          {allowableMPa.toFixed(1)} MPa
        </div>
      </div>
    </div>
    <p className="mt-2 text-[11px] text-slate-400">재질 SS275 (σy 275 MPa · 허용 0.8σy)</p>
  </div>

  <button
    onClick={handleRunStructural}
    disabled={!canRunStructural || structuralBusy}
    className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white
               disabled:bg-slate-300 disabled:cursor-not-allowed"
  >
    {structuralBusy ? `해석 중… ${structuralProgress}%` : '구조 해석 수행'}
  </button>
  {!canRunStructural && (
    <p className="text-[11px] text-amber-600">
      2단계에서 적치를 성공적으로 마치고 관통이 0 이어야 실행할 수 있습니다.
    </p>
  )}
  {structuralBusy && <p className="text-xs text-slate-500">{structuralMsg}</p>}
  {structuralError && (
    <pre className="whitespace-pre-wrap rounded border border-red-200 bg-red-50 p-3
                    text-[11px] text-red-700">{structuralError}</pre>
  )}

  {structuralResult && <StructuralResultCards result={structuralResult} />}
</div>
```

- [ ] **Step 6: 결과 카드 컴포넌트 추가**

파일 상단의 다른 보조 컴포넌트(`Toggle`, `BdfDropZone`) 옆에 추가:

```jsx
/** 3단계 결과 — 과정 1 응력 요약/상위 요소, 과정 2 Leg 반력 표. */
function StructuralResultCards({ result }) {
  const stress = result?.stress;
  const leg = result?.legReaction;
  if (!stress || !leg) return null;

  const s = stress.summary;
  const ng = s.exceedCount > 0;
  const kN = (n) => (n / 1000).toFixed(1);

  return (
    <div className="space-y-4">
      {/* 과정 1 */}
      <div className={`rounded-lg border p-4 ${ng ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
        <h4 className="text-sm font-semibold text-slate-700">과정 1 · Module Unit 응력</h4>
        <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
          <div><span className="text-slate-500">최대 응력</span>
            <div className="font-semibold">{s.maxStressMPa.toFixed(1)} MPa</div></div>
          <div><span className="text-slate-500">사용률</span>
            <div className={`font-semibold ${ng ? 'text-red-600' : 'text-slate-800'}`}>
              {s.maxUsage.toFixed(2)}</div></div>
          <div><span className="text-slate-500">초과 요소</span>
            <div className="font-semibold">{s.exceedCount} 개</div></div>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          평가 요소 {s.elementCount.toLocaleString()}개 · 허용 {stress.allowableMPa.toFixed(1)} MPa
          · 최대 요소 EID {s.maxStressElementId}
        </p>
      </div>

      {/* 과정 2 */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h4 className="text-sm font-semibold text-slate-700">과정 2 · Leg 반력</h4>
        <table className="mt-2 w-full text-xs">
          <thead className="text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="py-1 text-left">Leg</th><th className="text-left">절점</th>
              <th className="text-right">X</th><th className="text-right">Y</th>
              <th className="text-right">FX</th><th className="text-right">FY</th>
              <th className="text-right">FZ</th><th className="text-right">합력 [kN]</th>
            </tr>
          </thead>
          <tbody className="text-slate-700">
            {leg.legs.map(row => (
              <tr key={row.index} className="border-b border-slate-100">
                <td className="py-1">{row.index}</td>
                <td>{row.jungbanNodeId}</td>
                <td className="text-right">{row.x.toFixed(0)}</td>
                <td className="text-right">{row.y.toFixed(0)}</td>
                <td className="text-right">{kN(row.fxN)}</td>
                <td className="text-right">{kN(row.fyN)}</td>
                <td className="text-right">{kN(row.fzN)}</td>
                <td className="text-right font-semibold">{kN(row.resultantN)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={`mt-2 text-[11px] ${leg.check.ok ? 'text-slate-400' : 'text-red-600'}`}>
          검산: Σ반력 {kN(leg.check.sumReactionN[2])} kN / m·a {kN(leg.check.expectedN[2])} kN
          {leg.check.ok ? ' ✓' : ' ✗ 불일치 — 모델을 확인하세요'}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: 빌드 확인**

Run (`HiTessWorkBench/frontend/`에서): `npm run build`
Expected: 빌드 성공, 에러 없음

- [ ] **Step 8: 커밋 지점 (사용자 직접)**

보고할 파일: `src/api/analysis.js`, `src/pages/analysis/ModuleUnitOceanTransportAnalysis.jsx`
(⚠ `src/config.js`는 절대 포함하지 않는다)

---

## Task 12: 실측 통합 확인

순수 함수는 이미 고정됐다. 여기서는 실제 Nastran으로 물리가 맞는지 본다.

**Files:** 없음 (실행·확인만)

- [ ] **Step 1: 백엔드 기동**

Run (`HiTessWorkBenchBackEnd/`에서):
```bash
uvicorn app.main:app --host 0.0.0.0 --port 9091 --reload
```

- [ ] **Step 2: 프론트에서 1~2단계 수행**

`npm run dev` 후 앱에서:
1. `WorkBenchSubModule/ModuleOceanMoving/ModuleUnitBDF_byModelBuilder/3521.bdf` 업로드 → 1단계 검증
2. 2단계에서 정반 A 선택, 적치 실행 → 접촉 절점·합산 중량·CoG 확인 (관통 0)

- [ ] **Step 3: 3단계 실행 — 정지 자중**

가속도 `(0, 0, -1)`, 재질 기본값으로 "구조 해석 수행".

확인 항목:
- 두 과정이 FATAL 없이 완료된다
- 과정 2 검산 행이 `✓` (Σ반력 ≈ m·a)
- 합산 중량 ≈ 100 t 기준 Σ FZ ≈ 981 kN

- [ ] **Step 4: 산출물 확인**

Run:
```bash
ls -la HiTessWorkBenchBackEnd/userConnection/*_ModuleOceanMoving*/ 2>/dev/null || \
ls -la HiTessWorkBenchBackEnd/userConnection/ | tail -5
```
Expected: `_ocean_stress.{bdf,f06,json}` 과 `_ocean_legreact.{bdf,f06,json}` 6개 파일 존재

- [ ] **Step 5: 생성 BDF 눈으로 확인**

Run:
```bash
grep -n "SPC1\|GRAV\|RBE2\|CONM2\|PBEAML\|MAT1" HiTessWorkBenchBackEnd/userConnection/*/[0-9]*_ocean_legreact.bdf | head -30
```
Expected:
- `MAT1` RHO 필드가 `0.0`
- `PBEAML` 다음 줄 DIM이 `358.0 / 42.0 / 400.0 / 18.0`
- `RBE2` GN이 `9999`(CoG), GM이 `9001…`(스터브 상단)
- `SPC1` 절점이 `9101…`(스터브 하단)뿐 — 상단이 섞여 있으면 안 된다

- [ ] **Step 6: 횡가속도 확인**

가속도 `(0.3, 0, -1)`로 재실행. 확인:
- 과정 2 Σ FX ≈ −0.3 × m × g (검산 `✓`)
- 과정 1 최대 응력이 정지 자중일 때보다 증가

- [ ] **Step 7: 회전 배치 확인**

2단계에서 `rotationZDeg = 90`으로 다시 적치한 뒤 가속도 `(0.3, 0, -1)`로 실행.
`_ocean_stress.json`의 `accelLocalG`가 `{ax: 0, ay: -0.3, az: -1}`인지 확인한다.
(전역 +X 가속도가 MU 로컬에서 −Y로 보이는 것이 정상이다.)

- [ ] **Step 8: 전체 테스트 최종 회귀**

Run (`HiTessWorkBenchBackEnd/`): `python -m pytest tests/ -q`
Run (`HiTessWorkBench/frontend/`): `node --test src/utils/feGeometry.test.js`
Expected: 모두 PASS

- [ ] **Step 9: 커밋 지점 (사용자 직접)**

이 Task는 코드 변경이 없다. Step 3·6·7에서 물리가 안 맞으면 해당 Task로 돌아간다.

---

## 배포 안내 (구현 완료 후 사용자에게 보고할 내용)

- **`git pull` 만으로 서버(10.14.42.145) 반영 완료** — 이번 변경은 전부 git 추적 파일이다.
  백엔드 재시작 필요, 프론트는 재배포 필요.
- **InHouseProgram 수동 교체 대상 없음.** `nastran_bridge.py`는 건드리지 않았다.
- 정반 `.legs.json`은 서버에서 최초 요청 시 자동 생성된다.
- `_PAYLOAD_SCHEMA` bump로 서버의 기존 `jungbanBDF_*.viewer.json` 캐시는 자동 재생성된다
  (첫 요청이 몇 초 느려진다).
- 서버에 `jungbanBDF_A.bdf` / `jungbanBDF_B.bdf`가 배치돼 있어야 한다(현재 배치 완료).
- MSC Nastran이 서버에 설치돼 있어야 한다(`NASTRAN_EXE` 환경변수로 경로 override 가능).
