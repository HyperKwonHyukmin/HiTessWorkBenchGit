# 결과 비교 (최대 6건) (Plan F) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MyProjects 의 기존 2건 전용 "Run Compare" 흐름을 **N (2~6) 건 비교**로 확장한다. 서버가 `program_registry.ProgramSpec.compare_keys` 로 선언된 도메인 키를 읽어 `GET /api/analysis/compare?ids=…` 하나로 표 데이터(programs + rows)를 조립해 내려주면, 프론트는 `CompareModal` 이 sticky 헤더의 N열 표로 렌더한다. 델타(첫 열 기준 절대차 · 상대차 %)는 숫자 값에 한해 서버가 계산해 보내고, 프로그램마다 단위가 다르면 `unit_mismatch=true` 를 실어 프론트가 경고만 낸다(자동 환산 없음). 프로그램 혼합 비교(Truss 3건 + Mooring 1건 등)를 허용하되 그 경우 행은 모든 대상의 `compare_keys` 교집합 + 공통 메타(status·duration·verdict·created_at) 만 보여 준다.

**Architecture:** 백엔드 — `services/program_registry.py` 에 `compare_keys: tuple[str, ...] = ()` 필드 + `__post_init__` 에 dot-path 중복 검증 추가. 초기 대상 프로그램 6개(`truss-assessment`, `mast-post`, `jib-rest`, `column-buckling`, `mooring-fitting`, `mooring-fitting-solve`)에 `compare_keys` 등록. `services/compare_service.py`(신규) 가 `parse_compare_key`·`read_path`·`resolve_common_keys`·`compute_row_delta`·`build_compare` 로 조립. `routers/analysis.py` 에 `GET /analysis/compare` 라우터 1개 추가(`require_auth` + `can_view` 지연 import 폴백). 프론트 — `api/analysis.js` 에 `getAnalysisCompare(ids)` 추가, 순수 유틸 `utils/compareFormat.js`(+`node --test`) — cell 포매팅·델타 톤·kind→클래스 매핑, `components/analysis/CompareModal.jsx`(신규) 가 sticky 헤더·N열 표·델타 열 렌더. `MyProjects.jsx` 는 기존 `flattenComparisonData`·`ProjectCompareModal` 을 삭제하고 `compareProjects` 상한을 2→6 으로 올리며 새 모달로 교체한다.

**Tech Stack:** Python 3.14 / FastAPI / SQLAlchemy(MySQL 운영, SQLite 테스트) / pytest — React 18 + Vite + Tailwind + lucide-react 0.284 + axios — Electron 36. 신규 의존성·신규 테이블·신규 컬럼 **없음**.

**Spec:** `docs/superpowers/specs/2026-09-18-result-compare-design.md` (마스터: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1·§2.6·§2.7)

**규칙(마스터 §1):** 커밋은 사용자가 직접 한다 — 각 Task 마지막 단계는 **"커밋 준비 완료 — 변경 파일 목록을 사용자에게 보고"** 다. `HiTessWorkBench/frontend/src/config.js` 는 절대 스테이징하지 않는다. `Darkmode.js/` 는 건드리지 않는다. 백엔드는 TDD(실패 테스트 → 최소 구현 → 통과). 프론트는 러너가 없으므로 순수 유틸만 `node --test` 하고, 화면 통합은 수동 검증 절차를 따른다. 문서·주석·UI 문구는 한국어, 식별자는 영어.

**테스트 실행 위치:** 모든 pytest 명령은 `C:\Coding\WorkBench\HiTessWorkBenchBackEnd` 에서 `WorkBenchEnv/Scripts/python.exe -m pytest …` 로 실행한다. 프론트 `node --test` 는 `C:\Coding\WorkBench\HiTessWorkBench\frontend` 에서 실행한다.

---

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `HiTessWorkBenchBackEnd/app/services/program_registry.py` | 수정 | `ProgramSpec.compare_keys` 필드 + `__post_init__` 검증 + `_spec()` 헬퍼에 kw 통과 |
| `HiTessWorkBenchBackEnd/tests/test_program_registry.py` | 수정 | `compare_keys` dot-path 중복 → ValueError 회귀 + 미선언 프로그램 기본값 |
| `HiTessWorkBenchBackEnd/app/services/program_registry.py` (2회차) | 수정 | 6개 프로그램에 `compare_keys` 등록 |
| `HiTessWorkBenchBackEnd/tests/test_program_registry_compare_keys.py` | 생성 | 6개 프로그램의 `compare_keys` 회귀 고정 |
| `HiTessWorkBenchBackEnd/app/services/compare_service.py` | 생성 | `parse_compare_key`, `read_path`, `resolve_common_keys`, `compute_row_delta`, `build_compare` |
| `HiTessWorkBenchBackEnd/tests/test_compare_service.py` | 생성 | 서비스 계약(19건) |
| `HiTessWorkBenchBackEnd/app/routers/analysis.py` | 수정 | `GET /analysis/compare` 엔드포인트 추가(prefix `/api` 기존 재사용) |
| `HiTessWorkBenchBackEnd/tests/test_compare_router.py` | 생성 | 라우터 계약(9건) |
| `HiTessWorkBench/frontend/src/api/analysis.js` | 수정 | `getAnalysisCompare(ids)` |
| `HiTessWorkBench/frontend/src/utils/compareFormat.js` | 생성 | 순수 포매팅 유틸(값·델타 톤·kind 스타일) |
| `HiTessWorkBench/frontend/src/utils/compareFormat.test.js` | 생성 | `node:test` |
| `HiTessWorkBench/frontend/src/components/analysis/CompareModal.jsx` | 생성 | sticky 헤더·N열·델타 열 모달 |
| `HiTessWorkBench/frontend/src/pages/analysis/MyProjects.jsx` | 수정 | `flattenComparisonData`·`ProjectCompareModal` 삭제, cap 6 확대, 새 모달로 교체 |

---

### Task 1: `ProgramSpec.compare_keys` 필드 + `__post_init__` 검증

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/program_registry.py:29-56`(`ProgramSpec` 정의 + `__post_init__`), `:59-89`(`_spec()` 헬퍼)
- Modify: `HiTessWorkBenchBackEnd/tests/test_program_registry.py` (파일 끝에 테스트 3건 추가)

**의도:** 마스터 §2.6 이 요구하는 도메인 언어 저장소를 여기에 만든다. 필드는 문자열 튜플로 `"dot.path[:label][:unit]"` 을 담는다 — 별도 자료구조(예: NamedTuple 리스트)를 두면 `frozen=True, slots=True` dataclass 의 이점이 사라지고 program_registry 가 4개 필드에서 5개로 늘어난다. 파싱은 `compare_service.parse_compare_key` **한 곳**에서 한다(여기서는 dot-path 유일성만 지킨다). 유일성 검증을 이 자리에서 하는 이유: label 만 다르게 같은 경로를 두 번 실으면 표에 같은 값이 나란히 뜨는 사고가 서비스 단에 도달하기 전에 스펙 로딩에서 터진다.

- [ ] **Step 1: 실패 테스트 작성** — `HiTessWorkBenchBackEnd/tests/test_program_registry.py` 파일 끝(현재 `test_property_calculators_declare_no_verdict` 뒤)에 아래 테스트 3건을 붙인다.

```python


def test_program_spec_defaults_compare_keys_to_empty_tuple():
    """compare_keys 를 선언하지 않은 스펙은 빈 튜플이다 — Plan F 미등록 프로그램은 공통 메타만."""
    spec = ProgramSpec(
        program_id="x", display_name="X", aliases=("X",),
        capabilities=frozenset(),
    )
    assert spec.compare_keys == ()


def test_program_spec_rejects_duplicate_compare_key_paths():
    """같은 dot-path 가 라벨/단위만 다르게 두 번 들어가면 로딩 단계에서 막힌다.

    표에 같은 값이 두 줄로 나오는 사고가 서비스 단에 도달하기 전에 잡혀야 한다.
    """
    with pytest.raises(ValueError) as excinfo:
        ProgramSpec(
            program_id="x", display_name="X", aliases=("X",),
            capabilities=frozenset(),
            compare_keys=(
                "summary.maxUtilization:최대 활용도",
                "summary.maxUtilization:활용도(중복)",
            ),
        )
    assert "compare_keys" in str(excinfo.value)


def test_program_spec_allows_multiple_compare_keys_with_distinct_paths():
    spec = ProgramSpec(
        program_id="x", display_name="X", aliases=("X",),
        capabilities=frozenset(),
        compare_keys=(
            "summary.maxUtilization:최대 활용도",
            "summary.maxStress:최대 응력:MPa",
        ),
    )
    assert spec.compare_keys == (
        "summary.maxUtilization:최대 활용도",
        "summary.maxStress:최대 응력:MPa",
    )
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_program_registry.py -q -k "compare_keys"
```
기대: `2 failed, 1 error` (필드 미존재 → `TypeError: ProgramSpec.__init__() got an unexpected keyword argument 'compare_keys'`).

- [ ] **Step 3: `ProgramSpec` 에 필드 추가** — `app/services/program_registry.py:29-56` 의 `ProgramSpec` 정의 + `__post_init__` 을 아래로 교체.

수정 전(현행):
```python
@dataclass(frozen=True, slots=True)
class ProgramSpec:
    program_id: str
    display_name: str
    aliases: tuple[str, ...]
    capabilities: frozenset[str]
    history_visible: bool = True
    rerun_adapter: str | None = None
    input_keys: tuple[str, ...] = ()
    statistics_group: str | None = None
    report_adapter: str | None = None
    report_template: str | None = None
    report_scope: str = "not-applicable"
    verdict_kind: str = "required"

    def __post_init__(self) -> None:
        if not self.program_id or not self.aliases:
            raise ValueError("ProgramSpec requires a program_id and at least one alias")
        if len({alias.casefold() for alias in self.aliases}) != len(self.aliases):
            raise ValueError(f"Duplicate aliases in {self.program_id}")
        if self.report_scope not in REPORT_SCOPES:
            raise ValueError(
                f"Unknown report_scope {self.report_scope!r} in {self.program_id}"
            )
        if self.verdict_kind not in VERDICT_KINDS:
            raise ValueError(
                f"Unknown verdict_kind {self.verdict_kind!r} in {self.program_id}"
            )
```

수정 후:
```python
@dataclass(frozen=True, slots=True)
class ProgramSpec:
    program_id: str
    display_name: str
    aliases: tuple[str, ...]
    capabilities: frozenset[str]
    history_visible: bool = True
    rerun_adapter: str | None = None
    input_keys: tuple[str, ...] = ()
    statistics_group: str | None = None
    report_adapter: str | None = None
    report_template: str | None = None
    report_scope: str = "not-applicable"
    verdict_kind: str = "required"
    # Plan F(결과 비교): result_info JSON 안의 도메인 값들을 비교 표에 실어 주는 키 목록.
    # 각 항목은 "dot.path[:label][:unit]" 형태의 문자열이다(파싱은 compare_service.parse_compare_key).
    # 기본값 () 은 "비교 자체가 안 된다"가 아니라 "공통 메타(상태·소요·판정)만 나온다" 를 뜻한다.
    compare_keys: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.program_id or not self.aliases:
            raise ValueError("ProgramSpec requires a program_id and at least one alias")
        if len({alias.casefold() for alias in self.aliases}) != len(self.aliases):
            raise ValueError(f"Duplicate aliases in {self.program_id}")
        if self.report_scope not in REPORT_SCOPES:
            raise ValueError(
                f"Unknown report_scope {self.report_scope!r} in {self.program_id}"
            )
        if self.verdict_kind not in VERDICT_KINDS:
            raise ValueError(
                f"Unknown verdict_kind {self.verdict_kind!r} in {self.program_id}"
            )
        # compare_keys 의 dot-path 유일성만 여기서 지킨다. label/unit 파싱은 compare_service
        # 가 담당한다 — 그쪽 파서를 여기서 다시 import 하지 않아 스펙 로딩이 단순해진다.
        seen_paths: set[str] = set()
        for raw in self.compare_keys:
            path = raw.split(":", 1)[0].strip()
            if not path:
                raise ValueError(
                    f"compare_keys entry {raw!r} in {self.program_id} has empty dot-path"
                )
            if path in seen_paths:
                raise ValueError(
                    f"Duplicate compare_keys path {path!r} in {self.program_id}"
                )
            seen_paths.add(path)
```

- [ ] **Step 4: `_spec()` 헬퍼에 kw 통과** — 59~89행의 `_spec` 시그니처와 반환에 `compare_keys` 를 추가. 수정 후 함수 전체:

```python
def _spec(
    program_id: str,
    display_name: str,
    *aliases: str,
    capabilities: tuple[str, ...] = (),
    history_visible: bool = True,
    rerun_adapter: str | None = None,
    input_keys: tuple[str, ...] = (),
    statistics_group: str | None = None,
    report_adapter: str | None = None,
    report_template: str | None = None,
    report_scope: str = "not-applicable",
    verdict_kind: str = "required",
    compare_keys: tuple[str, ...] = (),
) -> ProgramSpec:
    # "report" capability 를 손으로 적지 않는다 — report_scope 와 두 출처가 되면
    # 한쪽만 고쳐 놓고 다른 쪽이 옛말을 하는 드리프트가 생긴다. 여기서 파생시킨다.
    derived = (*capabilities, "report") if report_scope == "supported" else capabilities
    return ProgramSpec(
        program_id=program_id,
        display_name=display_name,
        aliases=tuple(dict.fromkeys((display_name, *aliases))),
        capabilities=frozenset(derived),
        history_visible=history_visible,
        rerun_adapter=rerun_adapter,
        input_keys=input_keys,
        statistics_group=statistics_group,
        report_adapter=report_adapter,
        report_template=report_template,
        report_scope=report_scope,
        verdict_kind=verdict_kind,
        compare_keys=compare_keys,
    )
```

- [ ] **Step 5: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_program_registry.py -q
```
기대: 신규 3건 포함 전체 통과. 기존 스펙은 `compare_keys=()` 기본값이라 어느 것도 깨지지 않는다.

전 백엔드 회귀(스펙 필드 추가라 한번 돈다):
```
WorkBenchEnv/Scripts/python.exe -m pytest tests -q -x
```
기대: 실패 0.

- [ ] **Step 6: 커밋 준비 완료** — 보고: `app/services/program_registry.py`, `tests/test_program_registry.py`.

---

### Task 2: 각 프로그램에 `compare_keys` 등록

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/program_registry.py` (6개 `_spec` 호출)
- Create: `HiTessWorkBenchBackEnd/tests/test_program_registry_compare_keys.py`

**의도:** spec §3.1 이 확정한 초기 6개 프로그램만 채운다. 마스터 §1-7 YAGNI — result_info 스키마를 눈으로 확인하지 않은 프로그램은 이번 plan 에서 채우지 않는다(미등록이라도 서비스는 공통 메타만으로 완만하게 열린다). 대상은 사용자 시나리오("여러 케이스 중 가장 나은 것"): Truss Assessment(활용도·응력·판정) · Column Buckling·Mast Post·Jib Rest(허용 하중) · Mooring Fitting/Solve(활용도·와이어 장력).

- [ ] **Step 1: 회귀 고정 테스트 작성** — `HiTessWorkBenchBackEnd/tests/test_program_registry_compare_keys.py`:

```python
"""Plan F 초기 등록된 6개 프로그램의 compare_keys 회귀 고정.

여기서 선언한 문자열은 프론트 CompareModal 이 그대로 화면에 라벨/단위로 쓴다.
문구를 바꿀 때는 이 테스트를 함께 고쳐 UI 스크린샷 테스트 대신으로 삼는다.
"""
from app.services.program_registry import resolve_program


def _keys(name: str) -> tuple[str, ...]:
    spec = resolve_program(name)
    assert spec is not None, name
    return spec.compare_keys


def test_truss_assessment_compare_keys():
    assert _keys("Truss Assessment") == (
        "summary.maxUtilization:최대 활용도",
        "summary.maxStress:최대 응력:MPa",
        "summary.verdict:판정",
    )


def test_column_buckling_compare_keys():
    assert _keys("Column Buckling Load Calculator") == (
        "summary.allowableLoad:허용 하중:kN",
        "summary.slendernessRatio:세장비",
    )


def test_mast_post_compare_keys():
    assert _keys("Mast Post Assessment") == (
        "summary.allowableLoad:허용 하중:kN",
        "summary.section:권장 단면",
    )


def test_jib_rest_compare_keys():
    assert _keys("Jib Rest Assessment") == (
        "summary.allowableLoad:허용 하중:kN",
        "summary.section:권장 단면",
    )


def test_mooring_fitting_compare_keys_shared_between_full_and_solve():
    """스펙 §2-7: 프로그램 혼합 비교 시 교집합만 보인다.
    MooringFitting 과 MooringFittingSolve 의 compare_keys 를 같게 두면 두 App 을
    나란히 놓아도 행이 사라지지 않는다.
    """
    full = _keys("MooringFitting")
    solve = _keys("MooringFittingSolve")
    assert full == solve == (
        "summary.maxUtilization:최대 활용도",
        "summary.maxWireTension:최대 와이어 장력:kN",
    )


def test_unpopulated_programs_still_default_to_empty_tuple():
    """이번 plan 은 초기 6개만 채운다 — 나머지는 미선언(공통 메타만)."""
    assert _keys("BdfScanner") == ()
    assert _keys("HiTessModelFlow") == ()
    assert _keys("Simple Beam Assessment") == ()
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_program_registry_compare_keys.py -q
```
기대: 6 개 assertion 실패(`() == (...)`).

- [ ] **Step 3: 6개 프로그램에 `compare_keys` 등록** — `app/services/program_registry.py` 의 해당 `_spec(...)` 호출에 kw 인자를 추가한다.

(a) `truss-assessment`(현재 101~108행):
```python
    _spec(
        "truss-assessment", "Truss Assessment", "Truss Structural Assessment",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="truss-assessment",
        input_keys=("bdf_model",),
        report_adapter="truss-assessment",
        report_scope="supported",
        compare_keys=(
            "summary.maxUtilization:최대 활용도",
            "summary.maxStress:최대 응력:MPa",
            "summary.verdict:판정",
        ),
    ),
```

(b) `mooring-fitting`(현재 137~143행):
```python
    _spec(
        "mooring-fitting", "MooringFitting", "Mooring Fitting Assessment",
        capabilities=("file-analysis", "rerun", "passport"),
        rerun_adapter="mooring-fitting",
        input_keys=("structure_csv", "load_csv"),
        statistics_group="mooring-fitting",
        compare_keys=(
            "summary.maxUtilization:최대 활용도",
            "summary.maxWireTension:최대 와이어 장력:kN",
        ),
    ),
```

(c) `mooring-fitting-solve`(현재 145~151행):
```python
    _spec(
        "mooring-fitting-solve", "MooringFittingSolve",
        capabilities=("derived-analysis", "passport"),
        input_keys=("edited_bdf", "bdf_model"),
        statistics_group="mooring-fitting-solve",
        report_scope="planned",
        compare_keys=(
            "summary.maxUtilization:최대 활용도",
            "summary.maxWireTension:최대 와이어 장력:kN",
        ),
    ),
```

(d) `column-buckling`(현재 248~255행):
```python
    _spec(
        # 허용 하중을 산출할 뿐 합격/불합격을 내지 않는다 → 판정 칸을 만들지 않는다.
        "column-buckling", "Column Buckling Load Calculator",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
        report_scope="supported",
        verdict_kind="none",
        compare_keys=(
            "summary.allowableLoad:허용 하중:kN",
            "summary.slendernessRatio:세장비",
        ),
    ),
```

(e) `mast-post`(현재 256~261행):
```python
    _spec(
        "mast-post", "Mast Post Assessment",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
        report_scope="supported",
        compare_keys=(
            "summary.allowableLoad:허용 하중:kN",
            "summary.section:권장 단면",
        ),
    ),
```

(f) `jib-rest`(현재 262~268행):
```python
    _spec(
        "jib-rest", "Jib Rest Assessment",
        "Jib Rest Assessment (1단)", "Jib Rest Assessment (2단)",
        capabilities=("calculator", "passport"),
        input_keys=("input_json",),
        report_scope="supported",
        compare_keys=(
            "summary.allowableLoad:허용 하중:kN",
            "summary.section:권장 단면",
        ),
    ),
```

⚠️ 실제 `result_info` 안의 dot-path 는 각 서비스의 결과 조립부(`assessment_service`, `mast_post_service` 등)에서 확정한 것이며, **key 문자열은 위 6건이 회귀 테스트 파일(`tests/test_program_registry_compare_keys.py`)에 못박혀 있으므로 임의로 재명명하지 말 것**. 나중에 실제 result_info 의 필드명이 다르면 `read_path` 가 `None` 을 돌려주고 델타 계산에서 제외될 뿐 화면은 안전하다(§6.1 응답 스키마의 `values: […, null, …]`).

- [ ] **Step 4: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_program_registry_compare_keys.py tests/test_program_registry.py -q
```
기대: 신규 6건 + 기존 회귀 전부 통과.

- [ ] **Step 5: 커밋 준비 완료** — 보고: `app/services/program_registry.py`, `tests/test_program_registry_compare_keys.py`.

---

### Task 3: `services/compare_service.py` — `build_compare()` 계약

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/compare_service.py`
- Create: `HiTessWorkBenchBackEnd/tests/test_compare_service.py`

**의도(spec §4):** 도메인 룰·권한 필터·델타 계산·단위 불일치 감지를 **한 곳**에 모은다. 라우터(§Task 4)는 파라미터 파싱과 예외→HTTP 매핑만 한다. Plan G 이전 폴백은 이 서비스 안에서 `can_view` 지연 import 로 흡수한다 — 라우터가 `_access_control` 을 직접 import 하지 않으므로 Plan G 도입 시 라우터를 다시 만지지 않는다.

부속 함수 4개(`parse_compare_key`, `read_path`, `resolve_common_keys`, `compute_row_delta`)는 세션에 의존하지 않는 순수 함수라 fixture 없이 검증된다. `build_compare` 만 `Session` 을 받는다.

- [ ] **Step 1: 실패 테스트 작성** — `HiTessWorkBenchBackEnd/tests/test_compare_service.py`:

```python
"""compare_service 계약 — parse / read_path / resolve_common_keys / compute_row_delta / build_compare.

conftest 의 db_session · make_analysis · make_user 를 재사용한다.

프로그램 스펙은 `program_registry` 를 그대로 쓴다 — Task 2 에서 등록한 6개 중
truss-assessment / mooring-fitting / column-buckling 을 대표로 검증한다.
"""
from datetime import datetime, timedelta

import pytest

from app import models
from app.services import compare_service
from app.services.compare_service import (
    build_compare,
    compute_row_delta,
    parse_compare_key,
    read_path,
    resolve_common_keys,
)
from app.services.program_registry import resolve_program


# ---------- 순수 파서/워커/교집합 ----------

def test_parse_compare_key_path_only():
    assert parse_compare_key("summary.maxUtilization") == (
        "summary.maxUtilization", "summary.maxUtilization", None,
    )


def test_parse_compare_key_path_and_label():
    assert parse_compare_key("summary.maxUtilization:최대 활용도") == (
        "summary.maxUtilization", "최대 활용도", None,
    )


def test_parse_compare_key_path_label_unit():
    assert parse_compare_key("summary.maxStress:최대 응력:MPa") == (
        "summary.maxStress", "최대 응력", "MPa",
    )


def test_parse_compare_key_strips_whitespace():
    assert parse_compare_key("  summary.a  :  라벨  :  단위  ") == ("summary.a", "라벨", "단위")


def test_parse_compare_key_rejects_empty_path():
    with pytest.raises(ValueError):
        parse_compare_key(":라벨:단위")


def test_read_path_dot():
    assert read_path({"summary": {"maxUtilization": 0.83}}, "summary.maxUtilization") == 0.83


def test_read_path_missing_returns_none():
    assert read_path({"summary": {}}, "summary.maxUtilization") is None
    assert read_path({}, "summary.maxUtilization") is None
    assert read_path(None, "summary.maxUtilization") is None


def test_read_path_integer_index_for_list():
    payload = {"cases": [{"score": 0.5}, {"score": 0.9}]}
    assert read_path(payload, "cases.0.score") == 0.5
    assert read_path(payload, "cases.1.score") == 0.9
    assert read_path(payload, "cases.9.score") is None
    assert read_path(payload, "cases.abc.score") is None


def test_resolve_common_keys_intersection_preserves_first_labels():
    """두 스펙의 공통 dot-path 만 남고, 라벨·단위는 첫 스펙 것을 존중한다.

    프로그램마다 label 을 다르게 쓸 수 있다 — 첫 대상의 화면 문구를 원본으로 삼는다.
    """
    a = resolve_program("Truss Assessment")
    b = resolve_program("MooringFitting")
    keys = resolve_common_keys([a, b])
    # truss = maxUtil/maxStress/verdict, mooring = maxUtil/maxWireTension → 교집합은 maxUtil 만.
    assert keys == [("summary.maxUtilization", "최대 활용도", None)]


def test_resolve_common_keys_returns_empty_for_no_specs():
    assert resolve_common_keys([]) == []


def test_resolve_common_keys_handles_none_spec():
    a = resolve_program("Truss Assessment")
    assert resolve_common_keys([a, None]) == []


# ---------- 델타 ----------

def test_compute_row_delta_all_numeric():
    d = compute_row_delta([0.83, 0.91, 0.75])
    assert d == {
        "absolute": [0.0, pytest.approx(0.08), pytest.approx(-0.08)],
        "relative_pct": [0.0, pytest.approx(9.64, abs=0.01), pytest.approx(-9.64, abs=0.01)],
    }


def test_compute_row_delta_baseline_zero_returns_none_relative():
    d = compute_row_delta([0.0, 1.5, -0.5])
    assert d["absolute"] == [0.0, 1.5, -0.5]
    assert d["relative_pct"] == [None, None, None]


def test_compute_row_delta_returns_none_when_non_numeric():
    assert compute_row_delta(["합격", "불합격"]) is None
    assert compute_row_delta([0.83, None, 0.75]) is None
    assert compute_row_delta([0.83, "n/a", 0.75]) is None


def test_compute_row_delta_returns_none_for_single_value():
    assert compute_row_delta([0.83]) is None


def test_compute_row_delta_booleans_are_not_numeric():
    """True/False 는 파이썬에서 int 지만 산술 델타는 무의미하다."""
    assert compute_row_delta([True, False]) is None


# ---------- build_compare ----------

def _seed(db_session, make_analysis, *, employee_id="EMP001", program="Truss Assessment", **result):
    a = make_analysis(employee_id, program, datetime(2026, 9, 10, 14, 33, 22), status="Success")
    a.project_name = result.pop("_project_name", f"{program} 사례")
    a.job_id = result.pop("_job_id", None)
    a.started_at = result.pop("_started_at", None)
    a.updated_at = result.pop("_updated_at", None)
    a.result_info = {"summary": result}
    db_session.commit()
    return a


def test_build_compare_rejects_out_of_range_ids(db_session):
    with pytest.raises(ValueError):
        build_compare(db_session, ids=[1], user="EMP001")
    with pytest.raises(ValueError):
        build_compare(db_session, ids=[1, 2, 3, 4, 5, 6, 7], user="EMP001")


def test_build_compare_two_truss_success(db_session, make_analysis, make_user):
    make_user("EMP001")
    a = _seed(db_session, make_analysis, maxUtilization=0.83, maxStress=212.4, verdict="합격")
    b = _seed(db_session, make_analysis, maxUtilization=0.91, maxStress=235.7, verdict="불합격")
    payload = build_compare(db_session, ids=[a.id, b.id], user="EMP001")

    ids = [p["id"] for p in payload["programs"]]
    assert ids == [a.id, b.id]
    assert payload["programs"][0]["owner_is_me"] is True

    row_keys = [r["key"] for r in payload["rows"]]
    # 공통 메타 4행이 앞, verdict 는 truss verdict_kind=required 라 살아 있다.
    # summary.verdict 는 문자열이라 numeric 이 아니라 "text".
    assert row_keys[0].startswith("meta.")
    assert "summary.maxUtilization" in row_keys
    assert "summary.maxStress" in row_keys
    assert "summary.verdict" in row_keys

    util_row = next(r for r in payload["rows"] if r["key"] == "summary.maxUtilization")
    assert util_row["values"] == [0.83, 0.91]
    assert util_row["kind"] == "numeric"
    assert util_row["delta"] is not None
    assert util_row["unit_mismatch"] is False

    stress_row = next(r for r in payload["rows"] if r["key"] == "summary.maxStress")
    assert stress_row["unit"] == "MPa"

    verdict_row = next(r for r in payload["rows"] if r["key"] == "summary.verdict")
    assert verdict_row["kind"] == "text"
    assert verdict_row["delta"] is None


def test_build_compare_six_analyses(db_session, make_analysis, make_user):
    make_user("EMP001")
    seeds = [_seed(db_session, make_analysis, maxUtilization=0.5 + i * 0.05,
                   maxStress=200.0 + i * 5, verdict="합격") for i in range(6)]
    payload = build_compare(db_session, ids=[s.id for s in seeds], user="EMP001")
    assert len(payload["programs"]) == 6
    util_row = next(r for r in payload["rows"] if r["key"] == "summary.maxUtilization")
    assert len(util_row["values"]) == 6


def test_build_compare_missing_id_raises_lookup_error(db_session, make_analysis, make_user):
    make_user("EMP001")
    a = _seed(db_session, make_analysis, maxUtilization=0.5)
    with pytest.raises(LookupError):
        build_compare(db_session, ids=[a.id, 999_999], user="EMP001")


def test_build_compare_permission_error_when_owner_mismatch_and_not_admin(
    db_session, make_analysis, make_user,
):
    make_user("EMP001")
    make_user("EMP002")
    a = _seed(db_session, make_analysis, employee_id="EMP001", maxUtilization=0.5)
    b = _seed(db_session, make_analysis, employee_id="EMP002", maxUtilization=0.6)
    with pytest.raises(PermissionError):
        build_compare(db_session, ids=[a.id, b.id], user="EMP001")


def test_build_compare_admin_can_view_other_users(db_session, make_analysis, make_user):
    make_user("EMP001")
    make_user("ADMIN001", is_admin=True)
    a = _seed(db_session, make_analysis, employee_id="EMP001", maxUtilization=0.5)
    b = _seed(db_session, make_analysis, employee_id="EMP001", maxUtilization=0.6)
    payload = build_compare(db_session, ids=[a.id, b.id], user="ADMIN001")
    assert [p["owner_is_me"] for p in payload["programs"]] == [False, False]


def test_build_compare_unknown_program_falls_back_to_meta_only(
    db_session, make_analysis, make_user,
):
    """미등록 program_name 은 program_id='unknown', compare_keys=() 로 다뤄져도
    행이 비어 있지 않다 — 공통 메타는 계속 나온다.
    """
    make_user("EMP001")
    a = make_analysis("EMP001", "완전히_새로운_App", datetime(2026, 9, 10), status="Success")
    b = make_analysis("EMP001", "완전히_새로운_App", datetime(2026, 9, 11), status="Success")
    db_session.commit()
    payload = build_compare(db_session, ids=[a.id, b.id], user="EMP001")
    assert any(r["key"].startswith("meta.") for r in payload["rows"])
    assert all(r["key"].startswith("meta.") for r in payload["rows"])  # summary rows 없음
    assert any("compare_keys" in w or "비교 키" in w for w in payload["warnings"])


def test_build_compare_mixed_programs_uses_intersection(
    db_session, make_analysis, make_user,
):
    """Truss + Mooring — 교집합은 summary.maxUtilization 하나."""
    make_user("EMP001")
    a = _seed(db_session, make_analysis, program="Truss Assessment",
              maxUtilization=0.8, maxStress=200.0, verdict="합격")
    b = _seed(db_session, make_analysis, program="MooringFitting",
              maxUtilization=0.9, maxWireTension=120.0)
    payload = build_compare(db_session, ids=[a.id, b.id], user="EMP001")
    summary_keys = [r["key"] for r in payload["rows"] if not r["key"].startswith("meta.")]
    assert summary_keys == ["summary.maxUtilization"]


def test_build_compare_unit_mismatch_flag(db_session, make_analysis, make_user, monkeypatch):
    """서로 다른 프로그램이 같은 dot-path 를 다른 단위로 선언하면 unit_mismatch=True."""
    make_user("EMP001")
    # 임의 스펙 두 개를 두 프로그램에 monkeypatch 로 붙인다.
    from app.services import program_registry as pr
    from app.services.program_registry import ProgramSpec
    fake_a = ProgramSpec(
        program_id="fake-a", display_name="FakeA", aliases=("FakeA",),
        capabilities=frozenset(), compare_keys=("summary.load:하중:kN",),
    )
    fake_b = ProgramSpec(
        program_id="fake-b", display_name="FakeB", aliases=("FakeB",),
        capabilities=frozenset(), compare_keys=("summary.load:하중:ton",),
    )
    original = pr.resolve_program

    def _fake_resolve(name):
        if name == "FakeA":
            return fake_a
        if name == "FakeB":
            return fake_b
        return original(name)

    monkeypatch.setattr(pr, "resolve_program", _fake_resolve)
    monkeypatch.setattr(compare_service, "resolve_program", _fake_resolve)

    a = make_analysis("EMP001", "FakeA", datetime(2026, 9, 10), status="Success")
    a.result_info = {"summary": {"load": 100.0}}
    b = make_analysis("EMP001", "FakeB", datetime(2026, 9, 11), status="Success")
    b.result_info = {"summary": {"load": 100.0}}
    db_session.commit()

    payload = build_compare(db_session, ids=[a.id, b.id], user="EMP001")
    load_row = next(r for r in payload["rows"] if r["key"] == "summary.load")
    assert load_row["unit_mismatch"] is True


def test_build_compare_skips_verdict_row_when_verdict_kind_is_none(
    db_session, make_analysis, make_user,
):
    """column-buckling 은 verdict_kind='none' — meta 판정 행이 생기지 않는다."""
    make_user("EMP001")
    a = make_analysis("EMP001", "Column Buckling Load Calculator",
                      datetime(2026, 9, 10), status="Success")
    a.result_info = {"summary": {"allowableLoad": 100.0, "slendernessRatio": 40.0}}
    b = make_analysis("EMP001", "Column Buckling Load Calculator",
                      datetime(2026, 9, 11), status="Success")
    b.result_info = {"summary": {"allowableLoad": 120.0, "slendernessRatio": 42.0}}
    db_session.commit()
    payload = build_compare(db_session, ids=[a.id, b.id], user="EMP001")
    assert "meta.verdict" not in {r["key"] for r in payload["rows"]}


def test_build_compare_meta_rows_are_first_and_ordered(
    db_session, make_analysis, make_user,
):
    make_user("EMP001")
    a = _seed(db_session, make_analysis, maxUtilization=0.5, verdict="합격")
    b = _seed(db_session, make_analysis, maxUtilization=0.6, verdict="합격")
    a.started_at = datetime(2026, 9, 10, 14, 0, 0)
    a.updated_at = datetime(2026, 9, 10, 14, 0, 12)  # 12 초
    db_session.commit()
    payload = build_compare(db_session, ids=[a.id, b.id], user="EMP001")
    meta_keys = [r["key"] for r in payload["rows"] if r["key"].startswith("meta.")]
    assert meta_keys[0] == "meta.status"
    # duration_ms 는 있으면 세 번째. verdict 는 truss_kind=required 라 살아 있음.
    assert "meta.duration_ms" in meta_keys
    assert "meta.verdict" in meta_keys
    assert "meta.created_at" == meta_keys[-1]
    dur_row = next(r for r in payload["rows"] if r["key"] == "meta.duration_ms")
    assert dur_row["values"][0] == 12000  # 12 s → 12,000 ms


def test_build_compare_dedupes_ids_preserving_order(db_session, make_analysis, make_user):
    """라우터가 이미 중복 제거하지만 서비스 계약도 방어한다."""
    make_user("EMP001")
    a = _seed(db_session, make_analysis, maxUtilization=0.5)
    b = _seed(db_session, make_analysis, maxUtilization=0.6)
    payload = build_compare(db_session, ids=[a.id, b.id, a.id], user="EMP001")
    assert [p["id"] for p in payload["programs"]] == [a.id, b.id]
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_compare_service.py -q
```
기대: `ModuleNotFoundError: No module named 'app.services.compare_service'` (`1 error`).

- [ ] **Step 3: 서비스 구현** — `HiTessWorkBenchBackEnd/app/services/compare_service.py`:

```python
"""결과 비교 서비스 — 2~6건의 Analysis 를 하나의 표(programs + rows)로 조립한다.

라우터(analysis.compare_analyses)는 파라미터 파싱과 예외→HTTP 매핑만 하고, 여기서
    1) 대상 fetch + 개수 검증
    2) 권한 판정(Plan G can_view 지연 import 폴백)
    3) program_registry.compare_keys 교집합 계산
    4) result_info 에서 값 추출
    5) 델타·단위 불일치 계산
    6) 공통 메타 4행(status/duration_ms/verdict/created_at) 앞에 붙이기
를 한다.

이 모듈은 순수 조회다 — notify() 를 부르지 않고, 파일도 만들지 않는다.
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from .. import models
from .program_registry import ProgramSpec, resolve_program

logger = logging.getLogger(__name__)

MIN_COMPARE = 2
MAX_COMPARE = 6
_UNKNOWN_PROGRAM_ID = "unknown"


# ---------- 파서 / 워커 / 교집합 (순수 함수) ----------

def parse_compare_key(spec: str) -> tuple[str, str, str | None]:
    """``"dot.path[:label][:unit]"`` → ``(path, label, unit_or_None)``.

    라벨이 없으면 path 를 라벨로 쓴다. 단위가 없으면 None. 앞뒤 공백은 잘라 낸다.
    빈 dot-path 는 프로그램 스펙 로딩 단계에서도 잡히지만, 파서 자체에서도 방어한다.
    """
    parts = [seg.strip() for seg in spec.split(":", 2)]
    while len(parts) < 3:
        parts.append("")
    path, label, unit = parts
    if not path:
        raise ValueError(f"compare key without dot-path: {spec!r}")
    return path, (label or path), (unit or None)


def read_path(payload: Any, path: str) -> Any:
    """dot-path 로 값을 꺼낸다. 세그먼트가 정수면 리스트 인덱스로 취급한다.

    - ``"summary.maxUtilization"`` → payload["summary"]["maxUtilization"]
    - ``"cases.0.score"``           → payload["cases"][0]["score"]
    누락·타입 불일치는 예외 없이 None 을 돌려준다 — 서로 다른 프로그램의 result_info
    를 나란히 두는 경로에서 KeyError 로 500 이 뜨면 안 된다.
    """
    if payload is None or not path:
        return None
    current: Any = payload
    for seg in path.split("."):
        if current is None:
            return None
        if isinstance(current, dict):
            current = current.get(seg)
        elif isinstance(current, list):
            try:
                idx = int(seg)
            except ValueError:
                return None
            if idx < 0 or idx >= len(current):
                return None
            current = current[idx]
        else:
            return None
    return current


def resolve_common_keys(
    specs: list[ProgramSpec | None],
) -> list[tuple[str, str, str | None]]:
    """모든 스펙의 compare_keys 를 파싱해 dot-path 교집합만 남긴다.

    라벨/단위는 스펙의 **첫 등장 순서**를 존중한다 — 사용자가 처음 고른 해석의 스펙이
    화면 문구의 원본이 된다. 스펙이 None(미등록)이거나 compare_keys 가 비어 있으면
    교집합도 비어 있다.
    """
    if not specs or any(s is None for s in specs):
        return []
    parsed_per_spec: list[list[tuple[str, str, str | None]]] = []
    for spec in specs:
        parsed_per_spec.append([parse_compare_key(k) for k in spec.compare_keys])
    if any(not parsed for parsed in parsed_per_spec):
        return []
    common_paths: set[str] = set(entry[0] for entry in parsed_per_spec[0])
    for parsed in parsed_per_spec[1:]:
        common_paths &= {entry[0] for entry in parsed}
    if not common_paths:
        return []
    # 첫 스펙의 순서를 유지하며 교집합만 남긴다.
    return [
        entry for entry in parsed_per_spec[0]
        if entry[0] in common_paths
    ]


def compute_row_delta(values: list[Any]) -> dict | None:
    """모든 값이 (int|float) 이고 None 이 없을 때만 델타를 계산한다.

    반환: ``{"absolute": [...], "relative_pct": [...]}`` (첫 값 기준).
    첫 값이 0 이면 상대차는 계산 불가라 [None]*N 으로 채운다.
    bool 은 파이썬에서 int 지만 산술 델타가 무의미하므로 제외한다.
    """
    if not values or len(values) < 2:
        return None
    for v in values:
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            return None
    base = float(values[0])
    absolute = [float(v) - base for v in values]
    if base == 0.0:
        relative_pct: list[float | None] = [None] * len(values)
    else:
        relative_pct = [((float(v) - base) / base) * 100.0 for v in values]
    return {"absolute": absolute, "relative_pct": relative_pct}


# ---------- 권한 (Plan G can_view 지연 import 폴백) ----------

def _can_view(analysis: models.Analysis, user: str, db: Session) -> bool:
    """Plan G 의 can_view 를 지연 import 로 쓰고, 없으면 소유자/관리자만 통과.

    소유자 비교는 대소문자 무시 — auth 는 사번을 대문자로 정규화하지만 저장돼 있는
    employee_id 는 역사적으로 대소문자가 섞여 있다.
    """
    try:
        from ..routers._access_control import can_view  # type: ignore
    except ImportError:
        can_view = None
    if can_view is not None:
        try:
            return bool(can_view(analysis, user, db))
        except TypeError:
            # Plan G 의 시그니처가 (analysis, user) 만이더라도 폴백.
            return bool(can_view(analysis, user))
    owner = (analysis.employee_id or "").strip().casefold()
    me = (user or "").strip().casefold()
    if owner and owner == me:
        return True
    try:
        from ..routers._access_control import is_admin_user  # type: ignore
        return bool(is_admin_user(db, user))
    except ImportError:
        return False


# ---------- 진입 ----------

def _dedupe_preserve_order(ids: list[int]) -> list[int]:
    seen: set[int] = set()
    out: list[int] = []
    for i in ids:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def _duration_ms(record: models.Analysis) -> int | None:
    """updated_at - started_at 을 밀리초 정수로. 둘 중 하나라도 없으면 None."""
    if not record.started_at or not record.updated_at:
        return None
    delta = record.updated_at - record.started_at
    ms = int(delta.total_seconds() * 1000.0)
    return ms if ms >= 0 else None


def _me_matches(user_id: str, analysis: models.Analysis) -> bool:
    return (analysis.employee_id or "").strip().casefold() == (user_id or "").strip().casefold()


def _program_snapshot(record: models.Analysis, spec: ProgramSpec | None, user_id: str) -> dict:
    display = spec.display_name if spec else (record.program_name or "Unknown")
    return {
        "id": record.id,
        "program_id": spec.program_id if spec else _UNKNOWN_PROGRAM_ID,
        "program_name": record.program_name,
        "display_name": display,
        "project_name": record.project_name,
        "owner_id": record.employee_id,
        "owner_is_me": _me_matches(user_id, record),
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


def _row(key: str, label: str, unit: str | None, values: list[Any], kind: str,
         *, unit_mismatch: bool = False) -> dict:
    delta = compute_row_delta(values) if kind == "numeric" else None
    return {
        "key": key,
        "label": label,
        "unit": unit,
        "values": values,
        "delta": delta,
        "unit_mismatch": unit_mismatch,
        "kind": kind,
    }


def _values_kind(values: list[Any]) -> str:
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values if v is not None):
        return "numeric" if any(v is not None for v in values) else "text"
    return "text"


def _units_per_program(
    path: str,
    specs: list[ProgramSpec | None],
) -> list[str | None]:
    """path 에 대한 각 프로그램 스펙의 단위를 뽑는다(없거나 미선언은 None)."""
    units: list[str | None] = []
    for spec in specs:
        unit: str | None = None
        if spec is not None:
            for raw in spec.compare_keys:
                p, _label, u = parse_compare_key(raw)
                if p == path:
                    unit = u
                    break
        units.append(unit)
    return units


def _meta_rows(records: list[models.Analysis], specs: list[ProgramSpec | None]) -> list[dict]:
    """공통 메타 4행을 항상 앞에 붙인다.

    - status : Success/Failed/… (문자열, delta 없음)
    - duration_ms : (updated_at - started_at) 밀리초 정수, 없으면 None
    - verdict : summary.verdict 문자열. 모든 스펙의 verdict_kind 가 'none' 이면 스킵
    - created_at : ISO 문자열
    """
    rows: list[dict] = []
    rows.append(_row(
        "meta.status", "상태", None,
        [r.status for r in records], "text",
    ))
    durations = [_duration_ms(r) for r in records]
    if any(d is not None for d in durations):
        rows.append(_row(
            "meta.duration_ms", "소요", "ms",
            durations, "numeric",
        ))
    if any((spec is None) or (spec.verdict_kind != "none") for spec in specs):
        verdicts: list[Any] = []
        for r in records:
            info = r.result_info if isinstance(r.result_info, dict) else {}
            verdicts.append(read_path(info, "summary.verdict"))
        rows.append(_row("meta.verdict", "판정", None, verdicts, "text"))
    rows.append(_row(
        "meta.created_at", "생성", None,
        [r.created_at.isoformat() if r.created_at else None for r in records], "text",
    ))
    return rows


def build_compare(
    db: Session,
    ids: list[int],
    user: "str | models.User",
) -> dict:
    """spec §4.1. 반환 스키마는 §6.1.

    Raises:
        ValueError: ids 개수가 2~6 범위 밖.
        LookupError: 요청한 id 중 존재하지 않는 것이 있음.
        PermissionError: 접근 권한이 없는 대상이 하나라도 포함됨.
    """
    user_id = user.employee_id if isinstance(user, models.User) else str(user or "")
    ids = _dedupe_preserve_order(list(ids or []))
    if not (MIN_COMPARE <= len(ids) <= MAX_COMPARE):
        raise ValueError(f"compare requires {MIN_COMPARE} to {MAX_COMPARE} ids (got {len(ids)})")

    rows = db.query(models.Analysis).filter(models.Analysis.id.in_(ids)).all()
    if len(rows) != len(ids):
        raise LookupError("one or more analyses not found")
    # 요청 순서 유지.
    by_id = {r.id: r for r in rows}
    records: list[models.Analysis] = [by_id[i] for i in ids]

    for record in records:
        if not _can_view(record, user_id, db):
            raise PermissionError(f"cannot view analysis {record.id}")

    specs: list[ProgramSpec | None] = [resolve_program(r.program_name) for r in records]
    warnings: list[str] = []
    for record, spec in zip(records, specs):
        if spec is None:
            warnings.append(
                f"{record.id}: 미등록 프로그램({record.program_name!r})입니다. 공통 메타만 표시합니다."
            )
        elif not spec.compare_keys:
            warnings.append(
                f"{record.id}: 비교 키가 정의되지 않은 프로그램입니다. 공통 메타만 표시합니다."
            )

    out_rows: list[dict] = list(_meta_rows(records, specs))

    common_keys = resolve_common_keys(specs)
    for path, label, unit in common_keys:
        infos = [r.result_info if isinstance(r.result_info, dict) else {} for r in records]
        values = [read_path(info, path) for info in infos]
        kind = _values_kind(values) if all(isinstance(v, (int, float)) and not isinstance(v, bool)
                                            for v in values if v is not None) else "text"
        # 단위 불일치 감지.
        unit_options = [u for u in _units_per_program(path, specs) if u is not None]
        unit_mismatch = len(set(unit_options)) > 1
        out_rows.append(_row(path, label, unit, values, kind, unit_mismatch=unit_mismatch))

    if not common_keys and any(s is not None and s.compare_keys for s in specs):
        warnings.append("공통 비교 키가 없어 공통 메타만 표시합니다.")

    return {
        "programs": [_program_snapshot(r, s, user_id) for r, s in zip(records, specs)],
        "rows": out_rows,
        "warnings": warnings,
    }
```

- [ ] **Step 4: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_compare_service.py -q
```
기대: 19건 전부 통과.

전체 회귀(program_registry 를 건드렸으므로 한 번 더):
```
WorkBenchEnv/Scripts/python.exe -m pytest tests -q -x
```
기대: 실패 0.

- [ ] **Step 5: 커밋 준비 완료** — 보고: `app/services/compare_service.py`, `tests/test_compare_service.py`.

---

### Task 4: `GET /api/analysis/compare` 라우터 추가

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/routers/analysis.py` (파일 안 임의 위치 — 아래 명세)
- Create: `HiTessWorkBenchBackEnd/tests/test_compare_router.py`

**의도(spec §6):** `analysis.py` 의 기존 라우터 prefix(`/api`)를 재사용해 `@router.get("/analysis/compare")` 하나만 늘린다. `main.py` 는 손대지 않는다(analysis 라우터가 이미 등록돼 있다). GET·읽기 전용·플랫폼 공통 기능이라 `services/app_settings.py::GUARDED_ROUTES` 등록 대상이 아니다(스펙 §2-11).

파라미터 파싱은 라우터에서 하고, 도메인 예외 3종(`ValueError`/`LookupError`/`PermissionError`) 은 각각 400/404/403 으로 매핑한다. 사용자 메시지는 한국어.

- [ ] **Step 1: 실패 테스트 작성** — `HiTessWorkBenchBackEnd/tests/test_compare_router.py`:

```python
"""compare 라우터 계약 — 인증·파라미터 검증·오류 매핑·성공 응답 스키마."""
from datetime import datetime

from app import models
from app.dependencies import require_auth
from app.main import app


def _act_as(employee_id: str):
    app.dependency_overrides[require_auth] = lambda: employee_id


def _seed(db_session, make_analysis, *, employee_id="ADMIN001",
          program="Truss Assessment", **result):
    a = make_analysis(employee_id, program, datetime(2026, 9, 10, 14, 33, 22), status="Success")
    a.project_name = result.pop("_project_name", f"{program} 사례")
    a.result_info = {"summary": result}
    db_session.commit()
    return a


def test_get_compare_requires_auth(admin_client):
    saved = app.dependency_overrides.pop(require_auth)
    try:
        r = admin_client.get("/api/analysis/compare", params={"ids": "1,2"})
        assert r.status_code == 401
    finally:
        app.dependency_overrides[require_auth] = saved


def test_get_compare_returns_response_schema(admin_client, db_session, make_analysis):
    a = _seed(db_session, make_analysis, maxUtilization=0.83, maxStress=212.4, verdict="합격")
    b = _seed(db_session, make_analysis, maxUtilization=0.91, maxStress=235.7, verdict="불합격")
    r = admin_client.get("/api/analysis/compare", params={"ids": f"{a.id},{b.id}"})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"programs", "rows", "warnings"}
    ids = [p["id"] for p in body["programs"]]
    assert ids == [a.id, b.id]
    util = next(row for row in body["rows"] if row["key"] == "summary.maxUtilization")
    assert set(util) == {"key", "label", "unit", "values", "delta", "unit_mismatch", "kind"}
    assert util["values"] == [0.83, 0.91]
    assert util["kind"] == "numeric"
    assert util["delta"] is not None


def test_get_compare_six_ids(admin_client, db_session, make_analysis):
    seeds = [_seed(db_session, make_analysis, maxUtilization=0.5 + i * 0.05,
                   maxStress=200.0 + i * 5.0, verdict="합격") for i in range(6)]
    r = admin_client.get(
        "/api/analysis/compare",
        params={"ids": ",".join(str(s.id) for s in seeds)},
    )
    assert r.status_code == 200
    assert len(r.json()["programs"]) == 6


def test_get_compare_rejects_one_id_and_seven_ids(admin_client, db_session, make_analysis):
    a = _seed(db_session, make_analysis, maxUtilization=0.5)
    r = admin_client.get("/api/analysis/compare", params={"ids": f"{a.id}"})
    assert r.status_code == 400
    assert "2" in r.json().get("detail", "") and "6" in r.json().get("detail", "")

    seeds = [_seed(db_session, make_analysis, maxUtilization=0.5 + i * 0.05) for i in range(7)]
    r = admin_client.get(
        "/api/analysis/compare",
        params={"ids": ",".join(str(s.id) for s in seeds)},
    )
    assert r.status_code == 400


def test_get_compare_rejects_empty_and_nonnumeric_ids(admin_client):
    assert admin_client.get("/api/analysis/compare", params={"ids": ""}).status_code == 400
    assert admin_client.get("/api/analysis/compare", params={"ids": "a,b"}).status_code == 400
    assert admin_client.get("/api/analysis/compare").status_code == 422  # ids 자체 미제공


def test_get_compare_dedupes_ids(admin_client, db_session, make_analysis):
    a = _seed(db_session, make_analysis, maxUtilization=0.5)
    b = _seed(db_session, make_analysis, maxUtilization=0.6)
    r = admin_client.get("/api/analysis/compare", params={"ids": f"{a.id},{b.id},{a.id}"})
    assert r.status_code == 200
    assert [p["id"] for p in r.json()["programs"]] == [a.id, b.id]


def test_get_compare_missing_id_returns_404(admin_client, db_session, make_analysis):
    a = _seed(db_session, make_analysis, maxUtilization=0.5)
    r = admin_client.get(
        "/api/analysis/compare", params={"ids": f"{a.id},999999"},
    )
    assert r.status_code == 404
    assert "존재" in r.json().get("detail", "")


def test_get_compare_returns_403_when_owner_mismatch(admin_client, db_session, make_analysis):
    """다른 사용자 소유의 해석이 섞이면 403(관리자 override 는 admin_client 가 아니라
    switchable_client 로 별도 검증)."""
    theirs = _seed(db_session, make_analysis, employee_id="EMP001", maxUtilization=0.5)
    mine = _seed(db_session, make_analysis, employee_id="ADMIN001", maxUtilization=0.6)
    _act_as("ANOTHER_USER")
    r = admin_client.get(
        "/api/analysis/compare", params={"ids": f"{theirs.id},{mine.id}"},
    )
    assert r.status_code == 403
    assert "권한" in r.json().get("detail", "")


def test_get_compare_admin_can_see_others_via_fallback(admin_client, db_session, make_analysis, make_user):
    """Plan G 이전 폴백: 관리자 사번이면 남의 해석도 비교 가능."""
    make_user("EMP001")
    make_user("EMP002")
    a = _seed(db_session, make_analysis, employee_id="EMP001", maxUtilization=0.5)
    b = _seed(db_session, make_analysis, employee_id="EMP002", maxUtilization=0.6)
    # admin_client 는 require_auth="ADMIN001" 로 고정 (conftest 에 admin User 생성됨)
    r = admin_client.get("/api/analysis/compare", params={"ids": f"{a.id},{b.id}"})
    assert r.status_code == 200
    assert [p["owner_is_me"] for p in r.json()["programs"]] == [False, False]
```

- [ ] **Step 2: 실패 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_compare_router.py -q
```
기대: 대부분 404 (라우터 미등록) — 8~9건 실패.

- [ ] **Step 3: 라우터 추가** — `app/routers/analysis.py`

(a) 상단 import 블록 근처에 서비스와 예외 매핑 헬퍼를 추가한다. `from ..services.program_registry import (` 근처(현재 74행 언저리)에:

```python
from ..services.compare_service import (
    MAX_COMPARE as _COMPARE_MAX,
    MIN_COMPARE as _COMPARE_MIN,
    build_compare as _build_compare,
)
```

(b) 파일 안 아무 곳(예: 기존 `_files_available` 정의 위쪽, 파일 상단 헬퍼 그룹) 에 파라미터 파서를 둔다:

```python
def _parse_compare_ids(raw: str) -> list[int]:
    """`?ids=1,2,3` → 정수 리스트(중복 제거·순서 유지). 형식 오류 시 ValueError."""
    if raw is None:
        raise ValueError("ids 는 필수 파라미터입니다.")
    parts = [seg.strip() for seg in raw.split(",") if seg.strip() != ""]
    if not parts:
        raise ValueError("비교는 2~6건까지 가능합니다.")
    out: list[int] = []
    seen: set[int] = set()
    for seg in parts:
        try:
            n = int(seg)
        except ValueError as exc:
            raise ValueError(f"잘못된 id 형식입니다: {seg!r}") from exc
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out
```

(c) 실제 엔드포인트를 라우터의 다른 GET 근처(예: `get_top_programs` 뒤)에 추가한다:

```python
@router.get("/analysis/compare")
def compare_analyses(
    ids: str = Query(..., description="비교할 Analysis id 쉼표 구분(2~6개)"),
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """마스터 §2.6 · spec §6. 프로그램·row·warnings 세 키의 표를 돌려준다.

    오류 매핑:
      ValueError       → 400  ("비교는 2~6건까지 가능합니다." 등)
      LookupError      → 404  ("존재하지 않는 해석입니다.")
      PermissionError  → 403  ("접근 권한이 없는 해석이 포함돼 있습니다.")
    """
    try:
        parsed_ids = _parse_compare_ids(ids)
        if not (_COMPARE_MIN <= len(parsed_ids) <= _COMPARE_MAX):
            raise HTTPException(
                status_code=400,
                detail=f"비교는 {_COMPARE_MIN}~{_COMPARE_MAX}건까지 가능합니다.",
            )
        return _build_compare(db, parsed_ids, me)
    except ValueError as exc:
        # build_compare 도 ValueError 를 던질 수 있다 — 파라미터 파싱 오류와 통합.
        raise HTTPException(status_code=400, detail=str(exc) or "잘못된 요청입니다.") from exc
    except LookupError:
        raise HTTPException(status_code=404, detail="존재하지 않는 해석입니다.")
    except PermissionError:
        raise HTTPException(status_code=403, detail="접근 권한이 없는 해석이 포함돼 있습니다.")
```

⚠️ `main.py` 는 손대지 않는다. `analysis.router` 는 이미 `main.py:191` 에 등록돼 있고, prefix=`/api` 라 이 엔드포인트가 곧 `/api/analysis/compare` 다.

⚠️ `GUARDED_ROUTES` 등록 금지(스펙 §2-11). GET·읽기 전용·플랫폼 공통이다.

- [ ] **Step 4: 통과 확인**

```
WorkBenchEnv/Scripts/python.exe -m pytest tests/test_compare_router.py tests/test_compare_service.py -q
```
기대: 라우터 9건 + 서비스 19건 통과.

전체 회귀:
```
WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
기대: 실패 0.

- [ ] **Step 5: 커밋 준비 완료** — 보고: `app/routers/analysis.py`, `tests/test_compare_router.py`. (백엔드 완료 — 사용자가 여기서 한 번 커밋할 수 있도록 Task 1~4 파일 전체를 다시 나열: `app/services/program_registry.py`, `app/services/compare_service.py`, `app/routers/analysis.py`, `tests/test_program_registry.py`, `tests/test_program_registry_compare_keys.py`, `tests/test_compare_service.py`, `tests/test_compare_router.py`.)

---

### Task 5: 프론트 API 모듈 — `getAnalysisCompare(ids)`

**Files:**
- Modify: `HiTessWorkBench/frontend/src/api/analysis.js` (`getAnalysisById` 근처 288행 뒤)

**의도(spec §7.3):** 페이지에서 axios 를 직접 부르지 않는다(마스터 §1-10). ids 는 배열로 받아 쉼표 문자열로 보낸다.

- [ ] **Step 1: 함수 추가** — `getAnalysisById` 정의 아래(현재 288~289행)에 붙인다:

```js
/**
 * 결과 비교 표(programs + rows + warnings)를 받아 온다.
 * @param {number[]} ids  2~6개. 개수가 벗어나면 서버가 400.
 */
export const getAnalysisCompare = (ids) =>
  axios.get(`${API_BASE_URL}/api/analysis/compare`, {
    params: { ids: (ids || []).join(',') },
    headers: getAuthHeaders(),
  });
```

- [ ] **Step 2: 빌드 확인** (`C:\Coding\WorkBench\HiTessWorkBench\frontend` 에서)

```
npm run build
```
기대: 오류 없음. `MyProjects.jsx` 는 Task 7 에서 리팩토링될 때까지 아직 이 함수를 import 하지 않으므로 tree-shake 로 제거되어도 정상.

- [ ] **Step 3: 커밋 준비 완료** — 보고: `frontend/src/api/analysis.js`.

---

### Task 6: `CompareModal` + 순수 유틸(`node --test`)

**Files:**
- Create: `HiTessWorkBench/frontend/src/utils/compareFormat.js`
- Create: `HiTessWorkBench/frontend/src/utils/compareFormat.test.js`
- Create: `HiTessWorkBench/frontend/src/components/analysis/CompareModal.jsx`

**의도(spec §7.1):** 화면 렌더 자체는 부수효과가 있어 `node --test` 로 안 잡히지만, 값·델타 포매팅과 톤 결정은 **순수 함수** 로 분리해 검증한다. 모달은 그 순수 함수들을 그대로 붙여 쓴다.

sticky 헤더는 `sticky top-0` 로 첫 행·첫 열(Field)을 고정한다. Δ 열은 마지막에 두고, 첫 값 대비 절대/상대차 2줄로 표시한다. 값 차가 있는 numeric 행은 amber, 상대차 절대값이 20% 초과면 rose 로 강조(기존 2건 모달의 톤과 이질감이 없게).

#### Step 순서

- [ ] **Step 1: 순수 유틸 실패 테스트 작성** — `src/utils/compareFormat.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_COMPARE,
  MAX_COMPARE,
  formatCellValue,
  formatDelta,
  rowToneFor,
  cellClassName,
  pctAbsFrom,
} from './compareFormat.js';

test('상수', () => {
  assert.equal(MIN_COMPARE, 2);
  assert.equal(MAX_COMPARE, 6);
});

test('숫자 포매팅 — 정수/소수/절대값 큰 값', () => {
  assert.equal(formatCellValue(0), '0');
  assert.equal(formatCellValue(12), '12');
  assert.equal(formatCellValue(0.83), '0.83');
  assert.equal(formatCellValue(212.4), '212.4');
  assert.equal(formatCellValue(1234.5678), '1234.57');
  assert.equal(formatCellValue(1_234_567), '1,234,567');
});

test('null/undefined/NaN → —, 문자열은 그대로', () => {
  assert.equal(formatCellValue(null), '—');
  assert.equal(formatCellValue(undefined), '—');
  assert.equal(formatCellValue(Number.NaN), '—');
  assert.equal(formatCellValue('합격'), '합격');
  assert.equal(formatCellValue(''), '—');
});

test('불리언은 O/X', () => {
  assert.equal(formatCellValue(true), 'O');
  assert.equal(formatCellValue(false), 'X');
});

test('델타 포매팅 — 절대차 + 상대차 두 줄', () => {
  const rows = formatDelta({ absolute: [0, 0.08, -0.08], relative_pct: [0, 9.64, -9.64] });
  // baseline 은 항상 '—', 나머지는 부호 포함.
  assert.equal(rows[0], '기준');
  assert.equal(rows[1], '+0.08 (+9.64%)');
  assert.equal(rows[2], '-0.08 (-9.64%)');
});

test('상대차가 null 이면 절대차만', () => {
  const rows = formatDelta({ absolute: [0, 1.5], relative_pct: [null, null] });
  assert.equal(rows[1], '+1.50');
});

test('델타 자체가 null 이면 전 셀이 빈 문자열', () => {
  assert.deepEqual(formatDelta(null), []);
});

test('rowToneFor — 값이 다르면 amber, 상대차 >20% 면 rose', () => {
  assert.equal(rowToneFor({ kind: 'meta', values: ['Success', 'Success'], delta: null }), 'plain');
  assert.equal(rowToneFor({ kind: 'meta', values: ['Success', 'Failed'], delta: null }), 'amber');
  assert.equal(rowToneFor({
    kind: 'numeric', values: [0.83, 0.91],
    delta: { absolute: [0, 0.08], relative_pct: [0, 9.64] },
  }), 'amber');
  assert.equal(rowToneFor({
    kind: 'numeric', values: [100, 150],
    delta: { absolute: [0, 50], relative_pct: [0, 50] },
  }), 'rose');
  assert.equal(rowToneFor({
    kind: 'numeric', values: [100, 100],
    delta: { absolute: [0, 0], relative_pct: [0, 0] },
  }), 'plain');
});

test('cellClassName 은 톤 + 미읽음 여부 없이 값 셀 배경만 결정', () => {
  assert.match(cellClassName('amber'), /amber/);
  assert.match(cellClassName('rose'), /rose/);
  assert.match(cellClassName('plain'), /white|slate/);
});

test('pctAbsFrom — 상대차 배열에서 최대 |값|. null·baseline 은 건너뜀', () => {
  assert.equal(pctAbsFrom([0, 9.64, -25.1, null]), 25.1);
  assert.equal(pctAbsFrom([0]), 0);
  assert.equal(pctAbsFrom([null, null]), 0);
  assert.equal(pctAbsFrom(null), 0);
});
```

- [ ] **Step 2: 실패 확인**

```
node --test src/utils/compareFormat.test.js
```
기대: `Cannot find module … compareFormat.js` (fail).

- [ ] **Step 3: 순수 유틸 구현** — `src/utils/compareFormat.js`:

```js
/**
 * 결과 비교 모달의 순수 포매팅 유틸 — 부수효과 없음(node --test 로 검증).
 *
 * 값 셀 · 델타 셀 · 행 톤 · 톤→클래스 매핑을 여기에 모아 CompareModal 이 렌더만 하게 한다.
 */

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 6;

// 상대차 절대값 임계 — 이 값을 넘으면 amber → rose 로 격상. 기존 2건 모달의 amber 톤과
// 맞추되, '눈에 띄게 큰 차'만 빨간색으로 구분한다(사용자가 훑을 때 우선순위 신호).
const ROSE_ABS_PCT = 20;

const NUMBER_FORMATTERS = new Map();
function _nf(digits) {
  if (!NUMBER_FORMATTERS.has(digits)) {
    NUMBER_FORMATTERS.set(digits, new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }));
  }
  return NUMBER_FORMATTERS.get(digits);
}

/** 값 셀 문자열. null/undefined/NaN → '—', boolean → 'O'/'X'. */
export function formatCellValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'O' : 'X';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    // 정수는 그대로, |값| ≥ 1000 은 천단위, 그 외는 소수점 2자리.
    if (Number.isInteger(value)) return _nf(0).format(value);
    if (Math.abs(value) >= 1000) return _nf(2).format(value);
    return _nf(2).format(value);
  }
  if (typeof value === 'string') return value.length ? value : '—';
  // 객체/배열은 방어적으로 문자열화 — 스펙 상 여기 오면 안 된다.
  try { return JSON.stringify(value); } catch { return '—'; }
}

/**
 * 델타 배열 → 열별 문자열 배열(길이 = values 길이).
 * 첫 열은 항상 '기준'. 상대차가 null 인 열은 절대차만 표시한다.
 */
export function formatDelta(delta) {
  if (!delta || !Array.isArray(delta.absolute)) return [];
  const abs = delta.absolute;
  const rel = Array.isArray(delta.relative_pct) ? delta.relative_pct : [];
  return abs.map((absVal, i) => {
    if (i === 0) return '기준';
    if (absVal === null || absVal === undefined) return '—';
    const absStr = (absVal >= 0 ? '+' : '') + _nf(2).format(absVal);
    const relVal = rel[i];
    if (relVal === null || relVal === undefined) return absStr;
    const relStr = (relVal >= 0 ? '+' : '') + _nf(2).format(relVal) + '%';
    return `${absStr} (${relStr})`;
  });
}

/** 상대차 배열에서 baseline(0 번째) 을 제외한 최대 |값|. 계산 실패는 0. */
export function pctAbsFrom(relativePct) {
  if (!Array.isArray(relativePct)) return 0;
  let best = 0;
  for (let i = 1; i < relativePct.length; i += 1) {
    const v = relativePct[i];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const a = Math.abs(v);
      if (a > best) best = a;
    }
  }
  return best;
}

/**
 * 행 톤 결정.
 *  - plain: 값이 전부 같거나 (numeric 인데 델타가 없음)
 *  - amber: 값이 다르지만 상대차가 작음(또는 meta/text)
 *  - rose : 상대차 절대값이 ROSE_ABS_PCT 초과
 */
export function rowToneFor(row) {
  if (!row || !Array.isArray(row.values)) return 'plain';
  const distinct = new Set(row.values.map(v => (v === null || v === undefined ? '__null__' : String(v))));
  if (distinct.size <= 1) return 'plain';
  if (row.kind === 'numeric' && row.delta && Array.isArray(row.delta.relative_pct)) {
    if (pctAbsFrom(row.delta.relative_pct) > ROSE_ABS_PCT) return 'rose';
  }
  return 'amber';
}

/** 톤 → Tailwind 배경/글자 클래스. 값 셀에만 적용. */
export function cellClassName(tone) {
  if (tone === 'rose') return 'bg-rose-50 text-rose-900';
  if (tone === 'amber') return 'bg-amber-50 text-amber-900';
  return 'bg-white text-slate-700';
}
```

- [ ] **Step 4: 통과 확인**

```
node --test src/utils/compareFormat.test.js
```
기대: `pass 10`, `fail 0`.

- [ ] **Step 5: `CompareModal` 컴포넌트** — `src/components/analysis/CompareModal.jsx`:

```jsx
/**
 * @fileoverview 결과 비교 모달(최대 6건) — MyProjects 상단 "Run Compare" 진입점.
 *
 * spec: docs/superpowers/specs/2026-09-18-result-compare-design.md §7.1.
 * 서버가 조립한 표(programs + rows + warnings)를 렌더만 한다.
 * - sticky 헤더(첫 행)와 sticky 첫 열(Field/단위)
 * - N 열(2~6): 프로젝트명 + 사번 배지 + '공유' 태그(owner_is_me=false)
 * - Δ 열: 첫 값 대비 절대/상대차 2줄(numeric 행만)
 * - 톤: 값 차가 있는 행은 amber, 상대차 >20% 는 rose
 * - 단위 불일치 행은 단위 열에 경고 아이콘
 * - 서버 warnings 리스트는 하단 회색 박스
 *
 * v1 은 내보내기·저장 없음(§2-13). 푸터는 "닫기" 만.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, GitCompare, Loader2 } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { getAnalysisCompare } from '../../api/analysis';
import {
  cellClassName,
  formatCellValue,
  formatDelta,
  rowToneFor,
} from '../../utils/compareFormat';

function CompareTable({ programs, rows }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[900px] border-collapse text-xs">
        <thead>
          <tr className="bg-slate-50">
            <th className="sticky left-0 top-0 z-20 border-b border-slate-200 bg-slate-50 px-4 py-3 text-left font-bold text-slate-500">Field</th>
            <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-3 text-left font-bold text-slate-500 w-16">단위</th>
            {programs.map(p => (
              <th
                key={p.id}
                className="sticky top-0 z-10 min-w-[180px] border-b border-slate-200 bg-slate-50 px-4 py-3 text-left align-top"
              >
                <p className="truncate font-bold text-slate-800" title={p.project_name || `해석 ${p.id}`}>
                  {p.project_name || `해석 ${p.id}`}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-slate-500">
                  <span>ID {p.id}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-sans text-slate-600">
                    {p.display_name}
                  </span>
                  {p.owner_is_me === false && (
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 font-sans text-blue-700" title={`소유자: ${p.owner_id || '알 수 없음'}`}>공유</span>
                  )}
                </p>
              </th>
            ))}
            <th className="sticky right-0 top-0 z-20 min-w-[120px] border-b border-slate-200 bg-slate-50 px-3 py-3 text-left font-bold text-slate-500">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const tone = rowToneFor(row);
            const cellCls = cellClassName(tone);
            const deltaStrings = formatDelta(row.delta);
            const isMeta = row.key.startsWith('meta.');
            return (
              <tr key={row.key} className={isMeta ? 'border-b border-slate-100' : 'border-b border-slate-100'}>
                <th className={`sticky left-0 z-10 whitespace-nowrap px-4 py-2.5 text-left align-top font-semibold ${isMeta ? 'bg-slate-50 text-slate-600' : 'bg-white text-slate-700'}`}>
                  {row.label}
                </th>
                <td className={`whitespace-nowrap px-3 py-2.5 text-left align-top font-mono text-[11px] ${isMeta ? 'bg-slate-50 text-slate-500' : 'bg-white text-slate-500'}`}>
                  {row.unit_mismatch ? (
                    <span className="inline-flex items-center gap-1 text-amber-600" title="대상 프로그램마다 단위가 달라 값을 그대로 나열합니다">
                      <AlertTriangle size={12} />
                      {row.unit || '단위 상이'}
                    </span>
                  ) : (row.unit || '')}
                </td>
                {row.values.map((v, i) => (
                  <td
                    key={i}
                    className={`px-4 py-2.5 align-top font-mono ${cellCls} break-all`}
                    title={typeof v === 'string' ? v : undefined}
                  >
                    {formatCellValue(v)}
                  </td>
                ))}
                <td className="sticky right-0 z-10 min-w-[120px] whitespace-nowrap bg-slate-50 px-3 py-2.5 align-top font-mono text-[11px] text-slate-500">
                  {deltaStrings.length === 0 ? '' : (
                    <div className="space-y-0.5">
                      {deltaStrings.map((s, i) => (
                        <div key={i} className={i === 0 ? 'text-slate-400' : ''}>{s}</div>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function CompareModal({ isOpen, onClose, analyses }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // 대상 목록이 바뀌면(또는 모달이 열리면) 서버 호출을 새로.
  const idsKey = useMemo(
    () => (Array.isArray(analyses) ? analyses.map(a => a?.id).filter(Boolean).join(',') : ''),
    [analyses],
  );

  useEffect(() => {
    if (!isOpen) return undefined;
    const ids = idsKey ? idsKey.split(',').map(Number) : [];
    if (ids.length < 2) {
      setErrorMsg('비교 대상이 2건 미만입니다.');
      setData(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMsg('');
    setData(null);
    getAnalysisCompare(ids)
      .then(res => { if (!cancelled) setData(res.data); })
      .catch(err => {
        if (cancelled) return;
        const status = err?.response?.status;
        const detail = err?.response?.data?.detail;
        if (status === 400) setErrorMsg(detail || '비교 요청이 올바르지 않습니다.');
        else if (status === 403) setErrorMsg(detail || '접근 권한이 없는 해석이 포함돼 있습니다.');
        else if (status === 404) setErrorMsg(detail || '존재하지 않는 해석이 포함돼 있습니다.');
        else setErrorMsg('비교 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, idsKey]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={(
        <div className="flex items-center gap-2">
          <GitCompare size={18} className="text-blue-600" />
          <span>결과 비교</span>
          <span className="rounded-full bg-blue-100 px-2 text-[10px] font-bold text-blue-700">
            {analyses?.length ?? 0}건
          </span>
        </div>
      )}
      size="xl"
      footer={<Button variant="secondary" onClick={onClose}>닫기</Button>}
    >
      <div className="p-6">
        {loading && (
          <div className="flex items-center gap-2 py-16 text-slate-500">
            <Loader2 size={16} className="animate-spin" />
            비교 결과를 불러오는 중…
          </div>
        )}
        {!loading && errorMsg && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {errorMsg}
          </div>
        )}
        {!loading && !errorMsg && data && (
          <>
            <CompareTable programs={data.programs} rows={data.rows} />
            {Array.isArray(data.warnings) && data.warnings.length > 0 && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                <p className="mb-2 font-bold text-slate-700">참고 사항</p>
                <ul className="list-disc space-y-1 pl-5">
                  {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            <p className="mt-3 text-xs text-slate-500">
              첫 열이 기준입니다. 값이 다른 행은 노란색, 상대차 20% 초과는 붉은색으로 표시합니다.
              단위 열에 경고 아이콘은 대상 프로그램마다 단위가 다르다는 뜻입니다(자동 환산은 하지 않습니다).
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 6: 빌드**

```
npm run build
```
기대: 오류 없음. (아직 어디서도 import 되지 않으므로 tree-shake 됨.)

- [ ] **Step 7: 커밋 준비 완료** — 보고: `frontend/src/utils/compareFormat.js`, `frontend/src/utils/compareFormat.test.js`, `frontend/src/components/analysis/CompareModal.jsx`.

---

### Task 7: `MyProjects.jsx` 리팩토링 — 기존 2건 모달 제거 + cap 6 확대

**Files:**
- Modify: `HiTessWorkBench/frontend/src/pages/analysis/MyProjects.jsx` (imports, `flattenComparisonData`, `ProjectCompareModal`, `compareProjects` state, `toggleCompareProject`, "Run Compare" 버튼, per-row checkbox, 모달 마운트)

**의도(spec §7.2):** 기존 컴포넌트를 그대로 두고 훅만 늘려 두 모달을 병존시키면 코드 의도가 흐려진다(2건 상한은 legacy). 스펙 §2-1 에 따라 상한 6, 모달 교체, `flattenComparisonData` 삭제로 한 번에 끝낸다.

⚠️ 라인 번호는 현재(Task 7 진입 시점)의 파일 기준이다. 실제 편집은 **함수·상수의 이름으로 찾아 바꾼다** — 이 Task 이전 세션에서 선행 편집이 있으면 라인 번호는 달라진다.

- [ ] **Step 1: 사용하지 않는 심볼 import 정리** — 파일 상단 1행:

수정 전:
```js
import React, { useState, useEffect, useMemo, useCallback } from 'react';
```
`useMemo` 는 `flattenComparisonData`·`ProjectCompareModal` 삭제 후 이 파일에서 다른 곳에서도 쓴다면 그대로, 아니라면 제거. `grep -n "useMemo" MyProjects.jsx` 로 확인해 남은 사용처가 있으면 유지한다.

10~12 행의 lucide-react import 는 그대로 유지(`GitCompare`, `Square`, `CheckSquare` 는 계속 필요).

- [ ] **Step 2: `CompareModal` import 추가** — 22행 `import AssessmentProjectModal from '../../components/analysis/AssessmentProjectModal';` 다음 줄에:

```js
import CompareModal from '../../components/analysis/CompareModal';
```

- [ ] **Step 3: `flattenComparisonData` 삭제** — 529~570행 함수 전체를 제거한다.

삭제할 원본(검색 기준 문자열):
```js
const flattenComparisonData = (project) => {
  const flattened = {
    'Passport.Project ID': project?.id,
    ...
  };
  ...
  return flattened;
};
```

⚠️ 삭제 후 그 위·아래 빈 줄 하나만 남기고 정리한다.

- [ ] **Step 4: `ProjectCompareModal` 컴포넌트 삭제** — 572~636행 JSDoc 주석 블록 + `const ProjectCompareModal = ({ projects, onClose }) => { ... };` 전체를 제거한다.

삭제 대상은:
```js
/**
 * 실행 비교 모달.
 * ...
 */
const ProjectCompareModal = ({ projects, onClose }) => {
  ...
};
```

- [ ] **Step 5: 상한 6으로 확대 — `toggleCompareProject`** — 현재 729~740행. 아래로 교체:

```jsx
  const toggleCompareProject = useCallback((project) => {
    setCompareProjects(current => {
      if (current.some(item => item.id === project.id)) {
        return current.filter(item => item.id !== project.id);
      }
      // spec §2-1: 데스크톱 1080px 폭 sticky 헤더가 6열까지 한 화면에 담긴다.
      if (current.length >= 6) {
        showToast('결과 비교는 최대 6건까지 선택할 수 있습니다.', 'warning');
        return current;
      }
      return [...current, project];
    });
  }, [showToast]);
```

`compareProjects` state 초기값(현재 664행 `useState([])`)은 그대로 둔다 — 상한은 훅에서만 조정한다.

- [ ] **Step 6: "Run Compare" 버튼 확대** — 1051~1063행을 아래로 교체:

```jsx
        <button
          type="button"
          onClick={() => setIsCompareOpen(true)}
          disabled={compareProjects.length < 2}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-45"
          title={
            compareProjects.length >= 2
              ? '선택한 해석을 비교(2~6건)'
              : '비교할 해석을 2건 이상 선택하세요'
          }
        >
          <GitCompare size={16} />
          Run Compare
          {compareProjects.length > 0 && (
            <span className="rounded-full bg-blue-100 px-1.5 text-[10px] text-blue-700">
              {compareProjects.length}/6
            </span>
          )}
        </button>
```

⚠️ `<th>Compare</th>` 헤더(현재 1080행)와 per-row 체크박스 셀(1108~1122행)은 **그대로 둔다**. 상한만 훅에서 6으로 늘렸으므로 표 안 로직은 손댈 필요가 없다.

- [ ] **Step 7: 모달 마운트 교체** — 1289~1292행 `<ProjectCompareModal ... />` 를 아래로 교체:

```jsx
      <CompareModal
        isOpen={isCompareOpen}
        analyses={compareProjects}
        onClose={() => setIsCompareOpen(false)}
      />
```

⚠️ 새 `CompareModal` 은 `isOpen` prop 을 명시적으로 받는다(기존 `ProjectCompareModal` 은 부모가 `projects={isCompareOpen ? … : []}` 로 여닫았다). 이유: `useEffect` 안에서 서버 호출을 트리거해야 하는데, 닫힌 상태에서도 `analyses` 가 넘어오면 불필요한 호출이 뜬다.

- [ ] **Step 8: 구조 검증**

```
npm run build
```
기대: 오류 없음. `React`·`useMemo` 미사용 경고가 뜨면 두 심볼을 import 목록에서 제거한다.

- [ ] **Step 9: 수동 검증 (5단계, 백엔드 9091 + `npm run dev` 필요)**

1. **선택 UX** — MyProjects 진입 → 표의 각 행 Compare 셀에 빈 사각형/체크 사각형 스위치. 배지는 `n/6`. 2건 선택 전에는 "Run Compare" 비활성(툴팁 "…2건 이상…"). 7번째 클릭 시 warning 토스트 "최대 6건".
2. **동일 프로그램 2~6건 비교(Truss Assessment)** — Truss Assessment 이력 중 3~4건 선택 → Run Compare → 모달이 열리며 로딩 스피너 → 표에 공통 메타(상태/소요/판정/생성) + `summary.maxUtilization`·`summary.maxStress`·`summary.verdict` 세 행. 최대 활용도 값이 가장 큰 열은 amber, 25% 이상 차이 나는 열은 rose. 델타 열에 "+0.08 (+9.64%)" 형식 두 줄. 단위 열에 "MPa"(응력 행).
3. **혼합 프로그램 비교(Truss 2 + Mooring 1 = 3건)** — 표에 공통 메타 + `summary.maxUtilization` 하나만. 하단 회색 박스에 "공통 비교 키가 없어 …" 가 뜨지 않음(교집합이 하나 있음). `programs` 열의 배지에 "Truss Assessment"·"MooringFitting" 등 display_name 이 다르게 표시된다.
4. **미등록 프로그램 섞기(예: BdfScanner 2건)** — 표에 공통 메타 4행만. 하단 박스에 "비교 키가 정의되지 않은 프로그램입니다. 공통 메타만 표시합니다." 경고 2개(레코드마다 하나).
5. **오류 시나리오** — DevTools Network 에서 URL 을 `/api/analysis/compare?ids=1,999999` 로 강제 호출 → 404. 모달을 다시 열면 붉은 배너 "존재하지 않는 해석이 포함돼 있습니다." 가 뜬다. 관리자가 아닌 사용자로 남의 해석 id 를 섞어 강제 호출하면 403 배너.

- [ ] **Step 10: 커밋 준비 완료** — 보고: `frontend/src/pages/analysis/MyProjects.jsx`.

---

### Task 8: 커밋 준비 완료 — 서버(145) 반영 안내 + 최종 회귀

- [ ] **Step 1: 백엔드 전체 회귀**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
기대: 실패 0. 신규/변경 테스트 합계: `test_program_registry.py` +3건 · `test_program_registry_compare_keys.py` 6건 · `test_compare_service.py` 19건 · `test_compare_router.py` 9건 = **신규 37건 통과**.

- [ ] **Step 2: 프론트 순수 유틸 + 빌드**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && node --test src/utils/compareFormat.test.js && npm run build
```
기대: `pass 10`, 빌드 성공.

- [ ] **Step 3: 스테이징 점검** — `git status` 에서 `HiTessWorkBench/frontend/src/config.js` 가 변경돼 있으면 **스테이징하지 않는다**(로컬 백엔드 토글). `Darkmode.js/` 미포함 확인.

- [ ] **Step 4: 사용자 보고(커밋은 사용자가 직접)** — 변경 파일 전체 목록(파일 구조 표) + 아래 서버 반영 구분을 그대로 전달.

**서버(145) 반영:**
- **백엔드 — `git pull` + 백엔드 재시작으로 끝.** 신규 테이블·컬럼 없음(스키마 부트스트랩 변경 없음). 신규 pip 의존성 없음(`requirements.txt` 변경 없음).
- **프론트 — 재배포 필요.** WorkBench 포터블 exe 를 `npm run dist` 로 다시 빌드해 배포(`CompareModal.jsx` 추가·`MyProjects.jsx` 교체·순수 유틸·API 함수).
- **InHouse 프로그램 — 없음.** `InHouseProgram/` 수동 교체 대상 없음.

**전체 변경 파일 목록**(사용자 커밋 대상):
- `HiTessWorkBenchBackEnd/app/services/program_registry.py`
- `HiTessWorkBenchBackEnd/app/services/compare_service.py`
- `HiTessWorkBenchBackEnd/app/routers/analysis.py`
- `HiTessWorkBenchBackEnd/tests/test_program_registry.py`
- `HiTessWorkBenchBackEnd/tests/test_program_registry_compare_keys.py`
- `HiTessWorkBenchBackEnd/tests/test_compare_service.py`
- `HiTessWorkBenchBackEnd/tests/test_compare_router.py`
- `HiTessWorkBench/frontend/src/api/analysis.js`
- `HiTessWorkBench/frontend/src/utils/compareFormat.js`
- `HiTessWorkBench/frontend/src/utils/compareFormat.test.js`
- `HiTessWorkBench/frontend/src/components/analysis/CompareModal.jsx`
- `HiTessWorkBench/frontend/src/pages/analysis/MyProjects.jsx`

---

## 자기 검토

- **spec 커버리지**:
  - §2 확정 결정 13개 전부 반영 —
    §2-1(N=2~6, 서버 400, 프론트 비활성) Task 3·4·7 · §2-2(`can_view` 지연 import) Task 3 `_can_view` ·
    §2-3(`ProgramSpec.compare_keys`) Task 1 · §2-4("dot.path[:label][:unit]") Task 1·3 `parse_compare_key` ·
    §2-5(숫자 델타만, 첫 열 기준) Task 3 `compute_row_delta` · §2-6(단위 불일치 감지·자동 환산 없음) Task 3 `_units_per_program` + Task 6 UI ·
    §2-7(프로그램 혼합 허용, 교집합) Task 3 `resolve_common_keys` · §2-8(`model_role` UI 프리셋만) 이번 plan 은 만들지 않음(YAGNI) ·
    §2-9(서버 조립 표, 프론트 렌더만) Task 3·6 · §2-10(별도 페이지 없음, `CompareModal` 하나) Task 6·7 ·
    §2-11(`GUARDED_ROUTES` 미등록) Task 4 · §2-12(알림·보관 없음) 서비스에 `notify` 부재 확인 · §2-13(내보내기·저장 없음) 모달 푸터 "닫기" 만.
  - §3 데이터 모델 — `compare_keys` 필드(Task 1) + dot-path 중복 금지(Task 1 `__post_init__`) + 신규 테이블 없음.
  - §4 서비스 계약 — 4개 부속 함수 + `build_compare` 진입(Task 3).
  - §5 발신 훅 — 해당 없음(순수 조회).
  - §6 API — `GET /api/analysis/compare`(Task 4) + 응답 스키마(§6.1) 그대로.
  - §7 프론트 — `CompareModal`(Task 6) + `MyProjects` 지점별 수정(Task 7).
  - §8 보관 — 해당 없음(모달을 열 때마다 서버 호출, 프론트 캐시 없음).
  - §10 서버 반영 — Task 8.
  - §11 비목표 — PDF/차트/저장 세트/파일 diff/자동 단위 환산/before-after auto 매칭/알림 발신 — 어느 것도 만들지 않는다.

- **플레이스홀더 없음**: 모든 코드 step 이 실제 코드다. 프론트는 러너가 없어 수동 절차를 5개 시나리오로 적었다(동일 프로그램·혼합·미등록·오류·선택 UX).

- **타입/이름 일관성**:
  - 서비스 `build_compare(db, ids, user)` 시그니처는 spec §4.1 그대로.
  - 응답 스키마 6개 키(`programs`·`rows`·`warnings`) + 각 row 7개 키(`key/label/unit/values/delta/unit_mismatch/kind`) = 라우터 테스트(`set(item)`) = 프론트 `CompareModal.CompareTable` 이 읽는 필드 = 순수 유틸 `rowToneFor/formatDelta` 가 참조하는 필드.
  - `compare_keys` 문자열 형식 `"dot.path[:label][:unit]"` 은 `program_registry.__post_init__`(중복 검증) + `compare_service.parse_compare_key`(파싱) + 회귀 테스트(`test_program_registry_compare_keys.py` 6건) 세 곳이 같은 형식을 참조.
  - Plan G 폴백: `_can_view` 가 import 실패 시 소유자(대소문자 무시)/`is_admin_user`. Plan G 도입 후 `_access_control.can_view` 가 생기면 자동으로 그 함수를 쓴다(라우터·서비스 재수정 불필요).
  - 프론트 `MIN_COMPARE=2`·`MAX_COMPARE=6` 은 `compareFormat.js` 와 백엔드 상수와 일치(테스트로 고정).
  - `analyses` prop 형태 `[{id, project_name, program_name}]` = MyProjects `compareProjects` state = spec §7.1 그대로.

- **의존 순서**:
  - Task 1(필드) → Task 2(등록) → Task 3(서비스, `resolve_program` 이 신규 필드를 참조) → Task 4(라우터, `build_compare` 를 지연 import 없이 정직하게 씀) → Task 5(프론트 API 함수) → Task 6(모달 + 순수 유틸) → Task 7(MyProjects 결합·기존 삭제) → Task 8(회귀·보고).
  - Task 6 의 순수 유틸(`compareFormat.js`) 은 Task 3 의 응답 스키마를 그대로 받는다 — 서버 계약이 잡히기 전에 프론트를 굳히면 델타 배열 형태(예: `absolute` vs `absoluteMs` 명명) 에서 쉽게 어긋난다.
  - Task 7 (`MyProjects` 리팩토링) 은 반드시 Task 6 뒤. `CompareModal` 이 없는 상태에서 기존 모달을 지우면 빌드가 깨진다.

- **파일 삭제 안전성**:
  - `flattenComparisonData` 와 `ProjectCompareModal` 은 이 파일 밖에서 import 되지 않는다(모듈 스코프 상수). `grep -rn "flattenComparisonData\|ProjectCompareModal" HiTessWorkBench/frontend/src` 로 사전 확인 — 다른 파일에서 참조하고 있으면 그 파일도 동시에 손질해야 한다(현재는 참조 없음).

- **회귀 안전선**:
  - `ProgramSpec.compare_keys` 기본값 `()` — 등록된 30여 프로그램 중 어느 것도 실패하지 않는다(기존 `test_program_registry.py` 전 테스트 통과 확인이 Task 1 Step 5 의 회귀).
  - `build_compare` 는 미등록 program 을 `program_id="unknown"`·`compare_keys=()` 로 다뤄 결과 표에 공통 메타 4행은 항상 나온다("비교 자체가 안 된다"가 아님).
  - `verdict_kind='none'` 프로그램(예 Column Buckling)은 판정 행을 skip 해 잘못된 강조를 만들지 않는다(테스트 `test_build_compare_skips_verdict_row_when_verdict_kind_is_none`).
  - 델타의 baseline 이 0 이면 상대차는 `[None, None, …]` — 프론트 `formatDelta` 가 절대차만 표시.
  - 단위가 서로 다른 프로그램이 같은 dot-path 를 선언한 경우 `unit_mismatch=true` 만 실어 프론트가 경고 아이콘만 낸다(자동 환산 없음).

- **테스트 총계**: 백엔드 신규 37건 + 기존 회귀 전부 통과 · 프론트 `compareFormat.test.js` 10건 + 수동 검증 5시나리오.

- **커밋 규모**: 백엔드 6개 파일 + 프론트 5개 파일 = **11개 파일**. 파일당 변경량은 서비스 신설 파일 하나가 가장 크고(약 250줄), 그 외는 국소 편집이거나 신설 순수 유틸/컴포넌트.
