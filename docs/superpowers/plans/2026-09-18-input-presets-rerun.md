# 입력 프리셋 + 수정 후 재실행(Plan C) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MyProjects 상세 모달에서 과거 해석의 입력을 불러와 값 옵션만 고쳐 재실행하고(파일은 원본에서 복사), 값 세트를 이름 붙여 프리셋으로 저장·재적용하며, 파라메트릭 계산기 페이지는 `usePreset(programId)` 훅으로 그 값을 주입받는다.

**Architecture:** 백엔드는 `services/input_presets.py`(순수 판정·검증) + `routers/presets.py`(CRUD) + `routers/analysis.py`(기존 `rerun` 분기를 `_dispatch_rerun` 으로 추출하고 `input-snapshot` GET·`rerun-with` POST 추가). 프론트는 `api/presets.js` + `utils/presetHandoff.js`(순수 함수) + `hooks/usePreset.js` + 공용 `PresetPicker`/`InputPresetDrawer` + MyProjects 연결 + 파라메트릭 파일럿 2개(Jib Rest, Column Buckling). 앱별 폼은 만들지 않는다.

**Tech Stack:** Python 3.14 / FastAPI / SQLAlchemy(MySQL 운영, SQLite 테스트) / pytest — React 18 + Vite + Tailwind + axios + lucide-react + HeadlessUI Modal. 프론트 테스트 러너 없음(수동 검증).

**Spec:** `docs/superpowers/specs/2026-09-18-input-presets-rerun-design.md` (마스터: `specs/2026-09-18-platform-feature-program-design.md` §1·§2.4)

**규칙(마스터 §1):** 커밋은 사용자가 직접 한다 — 각 Task 의 마지막 단계는 **"커밋 준비 완료(변경 파일 목록 보고)"** 다. `HiTessWorkBench/frontend/src/config.js` 는 절대 스테이징하지 않는다. `Darkmode.js/` 는 건드리지 않는다. 백엔드 테스트 실행은 항상 `cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest <파일> -q`.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `HiTessWorkBenchBackEnd/app/models.py` | `InputPreset` 모델 추가 |
| `HiTessWorkBenchBackEnd/app/schemas.py` | `InputPresetCreate/Update/Response`, `RerunWithRequest` |
| `HiTessWorkBenchBackEnd/app/schema_bootstrap.py` | `ensure_input_preset_columns()` + `run_schema_bootstrap` 호출 |
| `HiTessWorkBenchBackEnd/app/services/input_presets.py` (신규) | 프리셋 가능 판정, 파일/값 분리, 계산기 input_json 인라인, 프리셋·오버라이드 검증 |
| `HiTessWorkBenchBackEnd/app/routers/presets.py` (신규) | `/api/presets` CRUD |
| `HiTessWorkBenchBackEnd/app/routers/analysis.py` | `_dispatch_rerun` 추출, `GET /analysis/{id}/input-snapshot`, `POST /analysis/{id}/rerun-with` |
| `HiTessWorkBenchBackEnd/app/main.py` | `presets` 라우터 등록 |
| `HiTessWorkBenchBackEnd/tests/test_input_presets_service.py` (신규) | 서비스 단위 테스트 |
| `HiTessWorkBenchBackEnd/tests/test_input_presets_api.py` (신규) | CRUD·권한·bootstrap 테스트 |
| `HiTessWorkBenchBackEnd/tests/test_analysis_rerun_with.py` (신규) | 스냅샷·수정 재실행 테스트 |
| `HiTessWorkBench/frontend/src/api/presets.js` (신규) | 프리셋 API 함수 |
| `HiTessWorkBench/frontend/src/api/analysis.js` | `getAnalysisInputSnapshot`, `rerunAnalysisWith` |
| `HiTessWorkBench/frontend/src/utils/presetHandoff.js` (신규) | sessionStorage 핸드오프·필드 타입·diff 순수 함수 |
| `HiTessWorkBench/frontend/src/hooks/usePreset.js` (신규) | 프리셋 목록·적용·저장·핸드오프 수신 훅 |
| `HiTessWorkBench/frontend/src/components/analysis/PresetPicker.jsx` (신규) | 프리셋 선택/저장/삭제 한 줄 툴바 |
| `HiTessWorkBench/frontend/src/components/analysis/InputPresetDrawer.jsx` (신규) | 상세 모달에서 여는 공용 입력 편집기 |
| `HiTessWorkBench/frontend/src/pages/analysis/MyProjects.jsx` | "입력 불러와 수정" 버튼·드로어 연결 |
| `HiTessWorkBench/frontend/src/pages/analysis/JibRestAssessment.jsx` | `PresetPicker` 파일럿(input_json 인라인 케이스) |
| `HiTessWorkBench/frontend/src/pages/analysis/ColumnBucklingCalculator.jsx` | `PresetPicker` 파일럿(dict 저장·키 이름 불일치 케이스) |

---

### Task 1: 데이터 모델·스키마·bootstrap

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/models.py` (파일 끝, `RegisteredModelArtifact` 다음)
- Modify: `HiTessWorkBenchBackEnd/app/schemas.py` (import 줄 4, `AppSettingUpdate` 다음)
- Modify: `HiTessWorkBenchBackEnd/app/schema_bootstrap.py:152-160`
- Create: `HiTessWorkBenchBackEnd/tests/test_input_presets_api.py` (bootstrap 테스트만 먼저)

- [ ] **Step 1: 실패 테스트 작성 — 모델과 bootstrap**

`HiTessWorkBenchBackEnd/tests/test_input_presets_api.py`:

```python
"""입력 프리셋 API·스키마 회귀 테스트."""
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from app import models
from app.schema_bootstrap import ensure_input_preset_columns, run_schema_bootstrap


def _sqlite_engine():
    return create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def test_input_preset_model_round_trip(db_session):
    row = models.InputPreset(
        employee_id="EMP001", program_id="jib-rest", name="기본안",
        input_info={"jh": 990, "jb": 670}, source_analysis_id=42,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)

    assert row.id is not None
    assert row.input_info == {"jh": 990, "jb": 670}
    assert row.created_at is not None


def test_schema_bootstrap_is_idempotent_for_input_presets():
    engine = _sqlite_engine()
    models.Base.metadata.create_all(bind=engine)

    run_schema_bootstrap(engine=engine)
    run_schema_bootstrap(engine=engine)

    columns = {c["name"] for c in inspect(engine).get_columns("input_presets")}
    assert {"id", "employee_id", "program_id", "name", "input_info",
            "source_analysis_id", "created_at", "updated_at"} <= columns


def test_bootstrap_adds_missing_source_analysis_id():
    engine = _sqlite_engine()
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE input_presets ("
            " id INTEGER PRIMARY KEY, employee_id VARCHAR(50), program_id VARCHAR(100),"
            " name VARCHAR(100), input_info JSON, created_at DATETIME, updated_at DATETIME)"
        ))

    ensure_input_preset_columns(engine=engine)

    columns = {c["name"] for c in inspect(engine).get_columns("input_presets")}
    assert "source_analysis_id" in columns
```

- [ ] **Step 2: 실패 확인**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_input_presets_api.py -q
```
Expected: `ImportError: cannot import name 'ensure_input_preset_columns'` (collection 단계 실패).

- [ ] **Step 3: 모델 추가**

`app/models.py` 파일 끝(`RegisteredModelArtifact` 클래스 뒤)에 추가:

```python
class InputPreset(Base):
  """사용자가 이름 붙여 저장한 입력 값 세트.

  파일 경로는 담지 않는다(값 키만) — userConnection/ 은 30일 뒤 삭제되므로 경로를
  저장하면 죽은 참조가 된다. source_analysis_id 는 RegisteredModelRevision 과 같은
  이유로 ForeignKey 가 아니다(이력이 정리돼도 프리셋은 남는다).
  """

  __tablename__ = "input_presets"
  __table_args__ = (
      UniqueConstraint("employee_id", "program_id", "name", name="uq_input_preset_name"),
  )

  id = Column(Integer, primary_key=True, index=True)
  employee_id = Column(String(50), nullable=False, index=True)
  program_id = Column(String(100), nullable=False, index=True)  # ProgramSpec.program_id
  name = Column(String(100), nullable=False)
  input_info = Column(JSON, nullable=False, default=dict)
  source_analysis_id = Column(Integer, nullable=True, index=True)
  created_at = Column(DateTime(timezone=True), server_default=func.now())
  updated_at = Column(
      DateTime(timezone=True),
      default=datetime.now,
      onupdate=datetime.now,
  )
```

- [ ] **Step 4: 스키마 추가**

`app/schemas.py` 4행을 `from pydantic import BaseModel, ConfigDict, Field` 로 바꾸고, `AppSettingUpdate` 클래스 뒤(`class UserGuideCreate` 앞)에 추가:

```python
class InputPresetCreate(BaseModel):
    """프리셋 생성. input_info 는 값 키만(파일 경로 금지 — 라우터가 422)."""

    program_id: str
    name: str
    input_info: dict = Field(default_factory=dict)
    source_analysis_id: Optional[int] = None


class InputPresetUpdate(BaseModel):
    """부분 갱신 — 보낸 필드만 반영한다(model_dump(exclude_unset=True))."""

    name: Optional[str] = None
    input_info: Optional[dict] = None


class InputPresetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: str
    program_id: str
    name: str
    input_info: dict
    source_analysis_id: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class RerunWithRequest(BaseModel):
    """수정 후 재실행 — 값 옵션 오버라이드만. 파일 키는 라우터가 422 로 거부한다."""

    input_info: dict = Field(default_factory=dict)
```

- [ ] **Step 5: bootstrap 추가**

`app/schema_bootstrap.py` 의 `ensure_app_spaces` 함수 앞에 추가:

```python
def ensure_input_preset_columns(*, engine=None) -> None:
    """input_presets 는 create_all 로 생기지만, 이후 컬럼이 늘 때를 위한 보강 자리."""
    _add_missing_columns("input_presets", {
        "source_analysis_id": "ALTER TABLE input_presets ADD COLUMN source_analysis_id INT NULL",
        "created_at": "ALTER TABLE input_presets ADD COLUMN created_at DATETIME NULL",
        "updated_at": "ALTER TABLE input_presets ADD COLUMN updated_at DATETIME NULL",
    }, engine=engine)
    _add_missing_indexes("input_presets", {
        "ix_input_presets_source_analysis_id": (
            "CREATE INDEX ix_input_presets_source_analysis_id ON input_presets (source_analysis_id)"
        ),
    }, engine=engine)
```

`run_schema_bootstrap` 의 `ensure_chat_message_columns(engine=engine)` 다음 줄에 `ensure_input_preset_columns(engine=engine)` 추가.

- [ ] **Step 6: 통과 확인**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_input_presets_api.py tests/test_database_lifecycle.py -q
```
Expected: `3 passed` + 기존 lifecycle 테스트 전부 통과(`... passed`, `0 failed`).

- [ ] **Step 7: 커밋 준비 완료 — 사용자에게 보고**

변경 파일: `app/models.py`, `app/schemas.py`, `app/schema_bootstrap.py`, `tests/test_input_presets_api.py`.

---

### Task 2: `services/input_presets.py` — 순수 판정·검증 로직

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/input_presets.py`
- Create: `HiTessWorkBenchBackEnd/tests/test_input_presets_service.py`

- [ ] **Step 1: 실패 테스트 작성**

`tests/test_input_presets_service.py`:

```python
"""입력 프리셋 순수 로직 테스트 — 라우터·DB 없이 돈다."""
import json

import pytest
from fastapi import HTTPException

from app.services import input_presets as svc
from app.services.program_registry import get_program


def test_is_preset_capable_follows_registry():
    assert svc.is_preset_capable(get_program("hitess-model-builder")) is True
    assert svc.is_preset_capable(get_program("jib-rest")) is True
    # 외부 앱은 input_keys 가 없다.
    assert svc.is_preset_capable(get_program("block-weld")) is False
    # 내부 substep 은 MyProjects 에 안 보이므로 프리셋 대상이 아니다.
    assert svc.is_preset_capable(get_program("module-stability")) is False
    assert svc.is_preset_capable(None) is False


def test_split_input_info_separates_paths_from_values(tmp_path):
    base = tmp_path / "userConnection"
    base.mkdir()
    bdf = base / "20260918_120000_EMP001_BdfScanner" / "model.bdf"
    info = {
        "bdf_model": str(bdf),
        "use_nastran": False,
        "analysis_mode": "PSA",          # 상대 문자열은 경로가 아니다
        "employee_id": "EMP001",         # 항상 버린다
    }

    files, values = svc.split_input_info(info, str(base))

    assert files == {"bdf_model": str(bdf)}
    assert values == {"use_nastran": False, "analysis_mode": "PSA"}


def test_split_input_info_ignores_paths_outside_user_connection(tmp_path):
    base = tmp_path / "userConnection"
    base.mkdir()
    outside = tmp_path / "elsewhere" / "x.bdf"

    files, values = svc.split_input_info({"bdf_model": str(outside)}, str(base))

    assert files == {}
    assert values == {"bdf_model": str(outside)}


def test_inline_calculator_input_json_reads_object(tmp_path):
    base = tmp_path / "userConnection"
    work = base / "20260918_120000_EMP001_JibRestCalculation"
    work.mkdir(parents=True)
    input_json = work / "input.json"
    input_json.write_text(json.dumps({"jh": 990, "jb": 670, "employee_id": "x"}), encoding="utf-8")

    files, values = svc.inline_calculator_input_json(
        {"input_json": str(input_json)}, {}, base_dir=str(base),
    )

    assert files == {}
    assert values == {"jh": 990, "jb": 670}


def test_inline_calculator_input_json_keeps_file_when_unreadable(tmp_path):
    base = tmp_path / "userConnection"
    base.mkdir()
    missing = base / "gone" / "input.json"

    files, values = svc.inline_calculator_input_json(
        {"input_json": str(missing)}, {}, base_dir=str(base),
    )

    assert files == {"input_json": str(missing)}
    assert values == {}


def test_build_input_snapshot_for_calculator_and_file_app(tmp_path):
    base = tmp_path / "userConnection"
    work = base / "20260918_120000_EMP001_JibRestCalculation"
    work.mkdir(parents=True)
    (work / "input.json").write_text(json.dumps({"jh": 990}), encoding="utf-8")

    calc = svc.build_input_snapshot(
        {"input_json": str(work / "input.json")}, get_program("jib-rest"), base_dir=str(base),
    )
    assert calc["program_id"] == "jib-rest"
    assert calc["preset_capable"] is True
    assert calc["rerun_editable"] is False
    assert calc["app_openable"] is True
    assert calc["files"] == {}
    assert calc["values"] == {"jh": 990}

    scan = svc.build_input_snapshot(
        {"bdf_model": str(work / "model.bdf"), "use_nastran": True},
        get_program("bdf-scanner"), base_dir=str(base),
    )
    assert scan["rerun_editable"] is True
    assert scan["app_openable"] is False
    assert scan["files"] == {"bdf_model": "model.bdf"}   # basename 만
    assert scan["values"] == {"use_nastran": True}

    none = svc.build_input_snapshot({"x": 1}, get_program("block-weld"), base_dir=str(base))
    assert none["preset_capable"] is False
    assert none["files"] == {} and none["values"] == {}


def test_validate_preset_values_rejects_user_connection_paths(tmp_path):
    base = tmp_path / "userConnection"
    base.mkdir()
    with pytest.raises(HTTPException) as exc:
        svc.validate_preset_values({"bdf_model": str(base / "a" / "m.bdf")}, base_dir=str(base))
    assert exc.value.status_code == 422
    assert "파일 경로" in exc.value.detail


def test_validate_preset_values_drops_employee_id_and_limits_size(tmp_path):
    base = str(tmp_path)
    cleaned = svc.validate_preset_values({"jh": 990, "employee_id": "x"}, base_dir=base)
    assert cleaned == {"jh": 990}

    with pytest.raises(HTTPException) as exc:
        svc.validate_preset_values({"blob": "x" * (svc.PRESET_MAX_BYTES + 1)}, base_dir=base)
    assert exc.value.status_code == 422


def test_validate_overrides_blocks_file_keys_and_nested_values():
    files = {"bdf_model": "C:/x/model.bdf"}

    assert svc.validate_overrides({"use_nastran": True, "employee_id": "x"}, files) == {"use_nastran": True}

    with pytest.raises(HTTPException) as exc:
        svc.validate_overrides({"bdf_model": "C:/other.bdf"}, files)
    assert exc.value.status_code == 422
    assert "bdf_model" in exc.value.detail

    with pytest.raises(HTTPException):
        svc.validate_overrides({"opts": {"a": 1}}, files)


def test_validate_preset_name_trims_and_bounds():
    assert svc.validate_preset_name("  기본안 ") == "기본안"
    with pytest.raises(HTTPException):
        svc.validate_preset_name("   ")
    with pytest.raises(HTTPException):
        svc.validate_preset_name("x" * (svc.PRESET_NAME_MAX + 1))
```

- [ ] **Step 2: 실패 확인**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_input_presets_service.py -q
```
Expected: `ModuleNotFoundError: No module named 'app.services.input_presets'`.

- [ ] **Step 3: 서비스 구현**

`app/services/input_presets.py`:

```python
"""입력 프리셋·수정 후 재실행의 순수 로직.

라우터를 import 하지 않는다(routers → services 한 방향). 파일 키와 값 키의 구분은
레지스트리 선언이 아니라 **값**으로 판정한다 — input_keys 는 파일 키만 선언하고
use_nastran·mesh_size 같은 옵션은 프로그램마다 달라서 열거할 수 없다.
"""
from __future__ import annotations

import json
import os
import urllib.parse
from typing import Any, Iterator

from fastapi import HTTPException

from .program_registry import ProgramSpec

PRESET_NAME_MAX = 100
PRESET_MAX_BYTES = 64 * 1024
PRESET_MAX_KEYS = 100
OVERRIDE_MAX_KEYS = 50
OVERRIDE_MAX_STR = 500
INLINE_JSON_MAX_BYTES = 256 * 1024

# 요청자 신원은 토큰에서 온다 — 스냅샷·프리셋·오버라이드 어디에도 싣지 않는다.
_DROPPED_KEYS = frozenset({"employee_id"})


def is_preset_capable(spec: ProgramSpec | None) -> bool:
    """input_keys 를 선언했고 MyProjects 에 보이는 프로그램만."""
    return bool(spec and spec.input_keys and spec.history_visible)


def _is_user_connection_path(value: Any, base_dir: str) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    unquoted = urllib.parse.unquote(value)
    if not os.path.isabs(unquoted):
        return False
    try:
        path = os.path.abspath(unquoted)
        base = os.path.abspath(base_dir)
        return os.path.commonpath([base, path]) == base
    except ValueError:
        return False


def split_input_info(info: Any, base_dir: str) -> tuple[dict, dict]:
    """input_info 를 (파일 키: 절대경로, 값 키: 값) 으로 나눈다."""
    files: dict[str, str] = {}
    values: dict[str, Any] = {}
    if not isinstance(info, dict):
        return files, values
    for key, value in info.items():
        if key in _DROPPED_KEYS:
            continue
        if _is_user_connection_path(value, base_dir):
            files[key] = value
        else:
            values[key] = value
    return files, values


def inline_calculator_input_json(files: dict, values: dict, *, base_dir: str) -> tuple[dict, dict]:
    """계산기 앱의 input_json 파일 내용을 값으로 펼친다. 못 읽으면 그대로 둔다."""
    path = files.get("input_json")
    if not path or not _is_user_connection_path(path, base_dir):
        return files, values
    try:
        if os.path.getsize(path) > INLINE_JSON_MAX_BYTES:
            return files, values
        with open(path, encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, ValueError):
        return files, values
    if not isinstance(payload, dict):
        return files, values
    merged = {k: v for k, v in payload.items() if k not in _DROPPED_KEYS}
    merged.update(values)
    rest = {k: v for k, v in files.items() if k != "input_json"}
    return rest, merged


def build_input_snapshot(info: Any, spec: ProgramSpec | None, *, base_dir: str) -> dict:
    """드로어가 그리는 스냅샷. files 는 basename 만(절대경로 노출 금지)."""
    capable = is_preset_capable(spec)
    result = {
        "program_id": spec.program_id if spec else None,
        "preset_capable": capable,
        "rerun_editable": bool(spec and spec.rerun_adapter),
        "app_openable": bool(spec and "calculator" in spec.capabilities),
        "files": {},
        "values": {},
    }
    if not capable:
        return result
    files, values = split_input_info(info, base_dir)
    if result["app_openable"]:
        files, values = inline_calculator_input_json(files, values, base_dir=base_dir)
    result["files"] = {
        key: os.path.basename(urllib.parse.unquote(path).replace("\\", "/"))
        for key, path in files.items()
    }
    result["values"] = values
    return result


def _walk_strings(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for nested in value.values():
            yield from _walk_strings(nested)
    elif isinstance(value, (list, tuple)):
        for nested in value:
            yield from _walk_strings(nested)


def validate_preset_name(name: Any) -> str:
    text = str(name or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="프리셋 이름을 입력하세요.")
    if len(text) > PRESET_NAME_MAX:
        raise HTTPException(status_code=422, detail=f"프리셋 이름은 {PRESET_NAME_MAX}자 이하여야 합니다.")
    return text


def validate_preset_values(values: Any, *, base_dir: str) -> dict:
    """프리셋에 담을 값 — 파일 경로 금지, 크기·키 수 제한, JSON 직렬화 가능."""
    if not isinstance(values, dict):
        raise HTTPException(status_code=422, detail="input_info 는 객체여야 합니다.")
    cleaned = {k: v for k, v in values.items() if k not in _DROPPED_KEYS}
    if len(cleaned) > PRESET_MAX_KEYS:
        raise HTTPException(status_code=422, detail=f"프리셋 항목은 {PRESET_MAX_KEYS}개 이하여야 합니다.")
    for text in _walk_strings(cleaned):
        if _is_user_connection_path(text, base_dir):
            raise HTTPException(
                status_code=422,
                detail="파일 경로는 프리셋에 담을 수 없습니다. 파일은 재실행 시 원본 이력에서 복사됩니다.",
            )
    try:
        size = len(json.dumps(cleaned, ensure_ascii=False).encode("utf-8"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="JSON 으로 저장할 수 없는 값이 있습니다.") from exc
    if size > PRESET_MAX_BYTES:
        raise HTTPException(status_code=422, detail="프리셋이 너무 큽니다(64KB 초과).")
    return cleaned


def validate_overrides(overrides: Any, files: dict) -> dict:
    """rerun-with 오버라이드 — 파일 키 거부, 스칼라만, 개수·길이 제한."""
    if not isinstance(overrides, dict):
        raise HTTPException(status_code=422, detail="input_info 는 객체여야 합니다.")
    cleaned = {k: v for k, v in overrides.items() if k not in _DROPPED_KEYS}
    if len(cleaned) > OVERRIDE_MAX_KEYS:
        raise HTTPException(status_code=422, detail=f"수정 항목은 {OVERRIDE_MAX_KEYS}개 이하여야 합니다.")
    blocked = sorted(key for key in cleaned if key in files)
    if blocked:
        raise HTTPException(
            status_code=422,
            detail=f"파일 입력({', '.join(blocked)})은 수정할 수 없습니다. 원본 파일이 그대로 복사됩니다.",
        )
    for key, value in cleaned.items():
        if isinstance(value, (dict, list, tuple)):
            raise HTTPException(status_code=422, detail=f"'{key}' 값은 숫자·문자열·불리언만 허용됩니다.")
        if isinstance(value, str) and len(value) > OVERRIDE_MAX_STR:
            raise HTTPException(status_code=422, detail=f"'{key}' 값이 너무 깁니다({OVERRIDE_MAX_STR}자 초과).")
    return cleaned
```

- [ ] **Step 4: 통과 확인**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_input_presets_service.py -q
```
Expected: `10 passed`.

- [ ] **Step 5: 커밋 준비 완료 — 사용자에게 보고**

변경 파일: `app/services/input_presets.py`, `tests/test_input_presets_service.py`.

---

### Task 3: `/api/presets` CRUD 라우터

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/routers/presets.py`
- Modify: `HiTessWorkBenchBackEnd/app/main.py:20-45` (import), `:208-212` (include_router)
- Modify: `HiTessWorkBenchBackEnd/tests/test_input_presets_api.py` (테스트 추가)

- [ ] **Step 1: 실패 테스트 추가**

`tests/test_input_presets_api.py` 끝에 추가:

```python
def _create(client, **overrides):
    payload = {
        "program_id": "jib-rest",
        "name": "기본안",
        "input_info": {"jh": 990, "jb": 670},
        "source_analysis_id": None,
    }
    payload.update(overrides)
    return client.post("/api/presets", json=payload)


def test_preset_crud_round_trip(switchable_client):
    client = switchable_client
    client.as_user()

    created = _create(client)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["employee_id"] == "EMP001"
    assert body["program_id"] == "jib-rest"
    assert body["input_info"] == {"jh": 990, "jb": 670}
    preset_id = body["id"]

    listed = client.get("/api/presets", params={"program_id": "jib-rest"})
    assert [p["id"] for p in listed.json()] == [preset_id]
    assert client.get("/api/presets", params={"program_id": "mast-post"}).json() == []

    updated = client.put(f"/api/presets/{preset_id}", json={"name": "수정안", "input_info": {"jh": 1000}})
    assert updated.status_code == 200
    assert updated.json()["name"] == "수정안"
    assert updated.json()["input_info"] == {"jh": 1000}

    assert client.delete(f"/api/presets/{preset_id}").status_code == 204
    assert client.get("/api/presets").json() == []


def test_preset_duplicate_name_is_409(switchable_client):
    client = switchable_client
    client.as_user()
    assert _create(client).status_code == 201
    dup = _create(client)
    assert dup.status_code == 409
    assert "같은 이름" in dup.json()["detail"]


def test_preset_rejects_unsupported_program_and_paths(switchable_client, monkeypatch, tmp_path):
    from app.routers import presets as presets_router

    client = switchable_client
    client.as_user()
    assert _create(client, program_id="block-weld").status_code == 422
    assert _create(client, program_id="no-such-program").status_code == 422

    base = tmp_path / "userConnection"
    base.mkdir()
    monkeypatch.setattr(presets_router, "_USER_CONNECTION_DIR", str(base))
    bad = _create(client, input_info={"bdf_model": str(base / "a" / "m.bdf")})
    assert bad.status_code == 422
    assert "파일 경로" in bad.json()["detail"]


def test_preset_is_private_to_owner_but_admin_can_edit(switchable_client):
    client = switchable_client
    client.as_user()
    preset_id = _create(client).json()["id"]

    client.as_admin()
    # 목록은 본인 것만 — 관리자도 남의 프리셋을 훑지 않는다.
    assert client.get("/api/presets").json() == []
    # 그러나 관리자는 지정 id 를 수정·삭제할 수 있다.
    assert client.put(f"/api/presets/{preset_id}", json={"name": "관리자 수정"}).status_code == 200

    client.as_user()
    assert client.get("/api/presets").json()[0]["name"] == "관리자 수정"

    # 제3자는 403 (EMP002 는 DB 에 없어도 소유자 불일치·비관리자이므로 거부)
    switchable_client.as_user()
    from app.dependencies import require_auth
    from app.main import app
    app.dependency_overrides[require_auth] = lambda: "EMP002"
    assert client.put(f"/api/presets/{preset_id}", json={"name": "x"}).status_code == 403
    assert client.delete(f"/api/presets/{preset_id}").status_code == 403
    assert client.put("/api/presets/999999", json={"name": "x"}).status_code == 404
```

- [ ] **Step 2: 실패 확인**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_input_presets_api.py -q
```
Expected: 앞 3개 통과, 새 4개 실패(`404 Not Found` — 라우트 없음; `test_preset_rejects_...` 는 `ImportError`).

- [ ] **Step 3: 라우터 구현**

`app/routers/presets.py`:

```python
"""입력 프리셋 CRUD.

프리셋은 개인 소유다. 목록은 본인 것만 돌려주고(관리자도 남의 것을 훑지 않는다),
지정 id 의 수정·삭제는 소유자 또는 관리자만 할 수 있다. 값 키만 저장하며 파일
경로는 services.input_presets 가 422 로 거른다.
"""
import os

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import database, models, schemas
from ..dependencies import require_auth
from ..services.input_presets import (
    is_preset_capable,
    validate_preset_name,
    validate_preset_values,
)
from ..services.program_registry import get_program
from ._access_control import assert_current_user_can_access_owner

router = APIRouter(prefix="/api/presets", tags=["presets"])

_ROUTER_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(os.path.dirname(_ROUTER_DIR))
_USER_CONNECTION_DIR = os.path.abspath(os.path.join(_BACKEND_DIR, "userConnection"))


def _require_capable_program(program_id: str) -> str:
    key = (program_id or "").strip()
    spec = get_program(key)
    if not is_preset_capable(spec):
        raise HTTPException(status_code=422, detail="이 앱은 프리셋을 지원하지 않습니다.")
    return key


def _load_owned(db: Session, preset_id: int, current_user: str) -> models.InputPreset:
    row = db.query(models.InputPreset).filter(models.InputPreset.id == preset_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="프리셋을 찾을 수 없습니다.")
    assert_current_user_can_access_owner(row.employee_id, current_user, db)
    return row


def _name_taken(db: Session, employee_id: str, program_id: str, name: str, *, exclude_id: int | None = None) -> bool:
    query = db.query(models.InputPreset.id).filter(
        models.InputPreset.employee_id == employee_id,
        models.InputPreset.program_id == program_id,
        models.InputPreset.name == name,
    )
    if exclude_id is not None:
        query = query.filter(models.InputPreset.id != exclude_id)
    return query.first() is not None


@router.get("", response_model=list[schemas.InputPresetResponse])
def list_presets(
    program_id: str | None = Query(default=None),
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    query = db.query(models.InputPreset).filter(models.InputPreset.employee_id == current_user)
    if program_id:
        query = query.filter(models.InputPreset.program_id == program_id.strip())
    rows = query.order_by(models.InputPreset.program_id.asc(), models.InputPreset.name.asc()).all()
    return [schemas.InputPresetResponse.model_validate(row) for row in rows]


@router.post("", response_model=schemas.InputPresetResponse, status_code=201)
def create_preset(
    body: schemas.InputPresetCreate,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    program_id = _require_capable_program(body.program_id)
    name = validate_preset_name(body.name)
    values = validate_preset_values(body.input_info, base_dir=_USER_CONNECTION_DIR)
    if _name_taken(db, current_user, program_id, name):
        raise HTTPException(status_code=409, detail="같은 이름의 프리셋이 이미 있습니다.")

    row = models.InputPreset(
        employee_id=current_user,
        program_id=program_id,
        name=name,
        input_info=values,
        source_analysis_id=body.source_analysis_id,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="같은 이름의 프리셋이 이미 있습니다.")
    db.refresh(row)
    return schemas.InputPresetResponse.model_validate(row)


@router.put("/{preset_id}", response_model=schemas.InputPresetResponse)
def update_preset(
    preset_id: int,
    body: schemas.InputPresetUpdate,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    row = _load_owned(db, preset_id, current_user)
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes:
        name = validate_preset_name(changes["name"])
        if _name_taken(db, row.employee_id, row.program_id, name, exclude_id=row.id):
            raise HTTPException(status_code=409, detail="같은 이름의 프리셋이 이미 있습니다.")
        row.name = name
    if "input_info" in changes:
        row.input_info = validate_preset_values(changes["input_info"], base_dir=_USER_CONNECTION_DIR)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="같은 이름의 프리셋이 이미 있습니다.")
    db.refresh(row)
    return schemas.InputPresetResponse.model_validate(row)


@router.delete("/{preset_id}", status_code=204)
def delete_preset(
    preset_id: int,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    row = _load_owned(db, preset_id, current_user)
    db.delete(row)
    db.commit()
    return Response(status_code=204)
```

- [ ] **Step 4: main.py 등록**

`app/main.py` import 블록(20-45행)의 `presence,` 다음 줄에 `presets,` 를 넣고(알파벳 순), `application.include_router(chat.router)`(208행) 다음 줄에 `application.include_router(presets.router)` 추가.

- [ ] **Step 5: 통과 확인**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_input_presets_api.py tests/test_app_settings.py -q
```
Expected: `test_input_presets_api.py` 7 passed, `test_app_settings.py` 전부 통과(`/api/presets` 는 `GUARDED_ROUTES` 미등록 → `resolve_app_key("/api/presets")` 가 None 이어야 하며 기존 테스트가 이를 깨지 않는다).

- [ ] **Step 6: 커밋 준비 완료 — 사용자에게 보고**

변경 파일: `app/routers/presets.py`, `app/main.py`, `tests/test_input_presets_api.py`.

---

### Task 4: `_dispatch_rerun` 추출 + `GET /analysis/{id}/input-snapshot`

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/routers/analysis.py:72-75` (import), `:1981-2160` (`rerun_analysis`)
- Create: `HiTessWorkBenchBackEnd/tests/test_analysis_rerun_with.py`

- [ ] **Step 1: 실패 테스트 작성(스냅샷)**

`tests/test_analysis_rerun_with.py`:

```python
"""입력 스냅샷·수정 후 재실행 API 테스트."""
import json

import pytest

from app import models
from app.routers import _intake, analysis


@pytest.fixture(autouse=True)
def isolated_user_connection(tmp_path, monkeypatch):
    root = tmp_path / "userConnection"
    root.mkdir(exist_ok=True)
    monkeypatch.setattr(analysis, "_USER_CONNECTION_DIR", str(root))
    monkeypatch.setattr(analysis, "_ALLOWED_DOWNLOAD_BASE", str(root))
    monkeypatch.setattr(_intake, "USER_CONNECTION_DIR", str(root))
    return root


def _seed(db_session, employee_id, program_name, input_info):
    record = models.Analysis(
        employee_id=employee_id, program_name=program_name, project_name="src",
        status="Success", input_info=input_info, result_info={}, source="Workbench",
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def _bdf_scanner_record(db_session, root, employee_id="ADMIN001", use_nastran=False):
    work = root / f"20260918_120000_{employee_id}_BdfScanner"
    work.mkdir(parents=True, exist_ok=True)
    bdf = work / "model.bdf"
    bdf.write_text("CEND\nBEGIN BULK\nENDDATA\n", encoding="utf-8")
    return _seed(db_session, employee_id, "BDF Scanner",
                 {"bdf_model": str(bdf), "use_nastran": use_nastran}), bdf


def test_input_snapshot_splits_files_and_values(admin_client, db_session, isolated_user_connection):
    record, _ = _bdf_scanner_record(db_session, isolated_user_connection)

    response = admin_client.get(f"/api/analysis/{record.id}/input-snapshot")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["analysis_id"] == record.id
    assert body["program_id"] == "bdf-scanner"
    assert body["preset_capable"] is True
    assert body["rerun_editable"] is True
    assert body["app_openable"] is False
    assert body["files_available"] is True
    assert body["files"] == {"bdf_model": "model.bdf"}
    assert body["values"] == {"use_nastran": False}


def test_input_snapshot_inlines_calculator_input_json(admin_client, db_session, isolated_user_connection):
    work = isolated_user_connection / "20260918_120000_ADMIN001_JibRestCalculation"
    work.mkdir(parents=True)
    input_json = work / "input.json"
    input_json.write_text(json.dumps({"jh": 990, "jb": 670}), encoding="utf-8")
    record = _seed(db_session, "ADMIN001", "Jib Rest Assessment (1단)", {"input_json": str(input_json)})

    body = admin_client.get(f"/api/analysis/{record.id}/input-snapshot").json()

    assert body["program_id"] == "jib-rest"
    assert body["app_openable"] is True
    assert body["rerun_editable"] is False
    assert body["files"] == {}
    assert body["values"] == {"jh": 990, "jb": 670}


def test_input_snapshot_marks_unsupported_program(admin_client, db_session):
    record = _seed(db_session, "ADMIN001", "BlockWeld", {"anything": 1})

    body = admin_client.get(f"/api/analysis/{record.id}/input-snapshot").json()

    assert body["preset_capable"] is False
    assert body["files"] == {} and body["values"] == {}


def test_input_snapshot_denies_other_user(switchable_client, db_session, isolated_user_connection):
    record, _ = _bdf_scanner_record(db_session, isolated_user_connection, employee_id="ADMIN001")
    switchable_client.as_user()

    assert switchable_client.get(f"/api/analysis/{record.id}/input-snapshot").status_code == 403
    assert switchable_client.get("/api/analysis/999999/input-snapshot").status_code == 404
```

- [ ] **Step 2: 실패 확인**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_analysis_rerun_with.py -q
```
Expected: 4 failed — `assert 404 == 200`(라우트 없음) 또는 `KeyError`.

- [ ] **Step 3: import 추가**

`app/routers/analysis.py` 72-75행의 `from ..services.program_registry import (...)` 블록 바로 뒤에:

```python
from ..services.input_presets import build_input_snapshot, split_input_info, validate_overrides
```

- [ ] **Step 4: `rerun_analysis` 를 `_dispatch_rerun` + 얇은 라우트로 교체**

`analysis.py:1981-2160` 의 `@router.post("/analysis/{analysis_id}/rerun")` 데코레이터부터 `return {...}` 까지를 **아래 전체로 교체**한다(분기 내용은 기존과 글자 단위로 같고, `make_work_dir(current_user, "X")` 만 `open_work_dir("X")` 로 바뀐다):

```python
def _dispatch_rerun(
    record: models.Analysis,
    info: dict,
    *,
    current_user: str,
    db: Session,
    source: str,
) -> str:
    """rerun / rerun-with 공용 디스패치. info 는 (원본 ∪ 오버라이드) 값 dict.

    파일 키는 _copy_rerun_input 이 원본 경로를 검증·복사한다. 옵션 값 변환
    (float/_rerun_bool) 이 실패하면 방금 만든 작업 폴더를 지우고 422 로 바꾼다 —
    rerun-with 가 임의 문자열을 받을 수 있기 때문이다.
    """
    state: dict[str, object] = {"work_dir": None}

    def open_work_dir(program_folder: str):
        work_dir, timestamp = make_work_dir(current_user, program_folder)
        state["work_dir"] = work_dir
        return work_dir, timestamp

    def copy_input(value, work_dir, **kwargs):
        try:
            return _copy_rerun_input(
                value,
                work_dir,
                current_user=current_user,
                db=db,
                **kwargs,
            )
        except Exception:
            _cleanup_owned_workspace(work_dir, current_user)
            raise

    program = record.program_name or ""
    program_spec = resolve_program(program)
    rerun_adapter = program_spec.rerun_adapter if program_spec else None

    try:
        if rerun_adapter == "truss":
            work_dir, timestamp = open_work_dir("TrussModelBuilder")
            node_path = copy_input(info.get("node_csv"), work_dir)
            member_path = copy_input(info.get("member_csv"), work_dir)
            exe_dir = os.path.abspath(os.path.join(_BACKEND_DIR, "InHouseProgram", "TrussModelBuilder"))
            exe_path = os.path.join(exe_dir, "TrussModelBuilder.exe")
            job_id = submit_analysis_job(
                task_execute_truss, node_path, member_path, work_dir, exe_path, exe_dir,
                current_user, timestamp, source,
                owned_work_dir=work_dir,
            )

        elif rerun_adapter == "truss-assessment":
            work_dir, timestamp = open_work_dir("TrussAssessment")
            bdf_path = copy_input(info.get("bdf_model"), work_dir)
            job_id = submit_analysis_job(
                task_execute_assessment, bdf_path, work_dir, current_user, timestamp, source,
                owned_work_dir=work_dir,
            )

        elif rerun_adapter == "bdf-scanner":
            work_dir, timestamp = open_work_dir("BdfScanner")
            bdf_path = copy_input(info.get("bdf_model"), work_dir)
            job_id = submit_analysis_job(
                task_execute_bdfscanner, bdf_path, work_dir, current_user, timestamp, source,
                _rerun_bool(info.get("use_nastran"), False),
                owned_work_dir=work_dir,
            )

        elif rerun_adapter == "hp-scr":
            mode = str(info.get("analysis_mode") or ("POR" if "POR" in program.upper() else "PSA")).upper()
            work_dir, timestamp = open_work_dir(f"HpScr{mode}")
            bdf_path = copy_input(info.get("bdf_model"), work_dir)
            job_id = submit_analysis_job(
                task_execute_hpscr, bdf_path, work_dir, current_user, timestamp, source, mode,
                owned_work_dir=work_dir,
            )

        elif rerun_adapter == "f06-parser":
            work_dir, timestamp = open_work_dir("F06Parser")
            f06_path = copy_input(info.get("f06_file"), work_dir)
            job_id = submit_analysis_job(
                task_execute_f06parser, f06_path, work_dir, current_user, timestamp, source,
                owned_work_dir=work_dir,
            )

        elif rerun_adapter == "mooring-fitting":
            work_dir, timestamp = open_work_dir("MooringFitting")
            structure_path = copy_input(
                info.get("structure_csv"), work_dir, dest_name="MooringFittingData.csv",
            )
            load_path = copy_input(
                info.get("load_csv"), work_dir, dest_name="MooringFittingDataLoad.csv",
            )
            exe_path = os.path.abspath(os.path.join(
                _BACKEND_DIR, "InHouseProgram", "MooringFitting", "MooringFitting.exe",
            ))
            job_id = submit_analysis_job(
                task_execute_mooring_fitting,
                structure_path, load_path, work_dir, exe_path,
                current_user, timestamp, source, float(info.get("mf_safety_factor") or 1.25),
                owned_work_dir=work_dir,
            )

        elif rerun_adapter == "model-builder":
            work_dir, timestamp = open_work_dir("HiTessModelBuilder")
            stru_path = copy_input(info.get("stru_csv"), work_dir, required=False)
            pipe_path = copy_input(info.get("pipe_csv"), work_dir, required=False)
            equip_path = copy_input(info.get("equip_csv"), work_dir, required=False)
            if not stru_path and not pipe_path:
                _cleanup_owned_workspace(work_dir, current_user)
                raise HTTPException(status_code=409, detail="Structural 또는 Piping 원본 CSV가 없어 재실행할 수 없습니다.")
            exe_path = os.path.abspath(os.path.join(
                _BACKEND_DIR, "InHouseProgram", "HiTessModeBuilder", "Cmb.Cli.exe",
            ))
            job_id = submit_analysis_job(
                task_execute_modelflow,
                stru_path, pipe_path, equip_path, work_dir, exe_path,
                current_user, timestamp, source,
                float(info.get("mesh_size") or 200.0),
                _rerun_bool(info.get("ubolt_full_fix"), False),
                _rerun_bool(info.get("run_nastran"), False),
                info.get("nastran_path"),
                info.get("leg_z_tol"),
                info.get("mesh_size_structure"),
                info.get("mesh_size_pipe"),
                queue_message="재실행 대기 중...",
                owned_work_dir=work_dir,
            )

        elif rerun_adapter == "simple-beam":
            work_dir, timestamp = open_work_dir("SimpleBeam")
            input_json_path = copy_input(info.get("input_json"), work_dir)
            job_id = submit_analysis_job(
                task_execute_beam, input_json_path, work_dir, current_user, timestamp, source,
                owned_work_dir=work_dir,
            )

        elif rerun_adapter in ("group-module-unit", "side-passage"):
            program_name = "SidePassage" if rerun_adapter == "side-passage" else "GroupModuleUnit"
            work_dir, timestamp = open_work_dir(program_name)
            bdf_path = copy_input(info.get("bdf_model"), work_dir)
            job_id = submit_analysis_job(
                task_execute_groupmoduleunit,
                bdf_path, work_dir, current_user, timestamp, source,
                _rerun_bool(info.get("use_nastran"), False), program_name,
                queue_message="재실행 대기 중...",
                owned_work_dir=work_dir,
            )

        elif rerun_adapter == "hull-acceleration":
            work_dir, timestamp = open_work_dir("HullAcceleration")
            pdf_path = copy_input(info.get("pdf_file"), work_dir)
            constants_path = copy_input(
                info.get("constants"), work_dir, dest_name="constants.json", required=False,
            )
            overrides_path = copy_input(
                info.get("condition_overrides"), work_dir, dest_name="condition_overrides.json", required=False,
            )
            job_id = submit_analysis_job(
                task_execute_hull_acceleration,
                pdf_path, work_dir, current_user, timestamp, source, constants_path, overrides_path,
                owned_work_dir=work_dir,
            )

        else:
            raise HTTPException(
                status_code=422,
                detail="이 앱은 저장 파일 기반 재실행을 지원하지 않습니다. 앱에서 입력값을 불러와 새 해석을 시작하세요.",
            )
    except (TypeError, ValueError) as exc:
        _cleanup_owned_workspace(state["work_dir"], current_user)
        raise HTTPException(status_code=422, detail=f"입력 값 형식이 올바르지 않습니다: {exc}") from exc

    return job_id


@router.post("/analysis/{analysis_id}/rerun")
def rerun_analysis(
    analysis_id: int,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """보존된 입력 파일/옵션을 새 작업 폴더로 복제해 동일 해석을 다시 제출한다.

    파일 기반 비동기 앱부터 지원한다. 원본 레코드와 결과는 변경하지 않으며 새 job_id와
    새 Analysis 레코드가 생성된다. 값을 바꿔 돌리려면 rerun-with 를 쓴다.
    """
    record = db.query(models.Analysis).filter(models.Analysis.id == analysis_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Analysis record not found")
    assert_current_user_can_access_owner(record.employee_id, current_user, db)

    info = record.input_info if isinstance(record.input_info, dict) else {}
    job_id = _dispatch_rerun(record, info, current_user=current_user, db=db, source="WorkbenchRerun")

    return {
        "job_id": job_id,
        "source_analysis_id": analysis_id,
        "program_name": record.program_name or "",
        "message": "동일 입력으로 새 해석 작업을 제출했습니다.",
    }


@router.get("/analysis/{analysis_id}/input-snapshot")
def get_analysis_input_snapshot(
    analysis_id: int,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """이력의 input_info 를 파일 키(basename)/값 키로 나눠 돌려준다 — InputPresetDrawer 의 데이터원."""
    record = db.query(models.Analysis).filter(models.Analysis.id == analysis_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Analysis record not found")
    assert_current_user_can_access_owner(record.employee_id, current_user, db)

    spec = resolve_program(record.program_name)
    snapshot = build_input_snapshot(record.input_info, spec, base_dir=_USER_CONNECTION_DIR)
    return {
        "analysis_id": record.id,
        "program_name": record.program_name or "",
        "files_available": _files_available(record),
        **snapshot,
    }
```

- [ ] **Step 5: 통과 확인 + 기존 rerun 회귀**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_analysis_rerun_with.py tests/test_analysis_rerun.py -q
```
Expected: 새 4개 + 기존 `test_analysis_rerun.py` 전부 `passed`(기존 테스트가 `analysis.make_work_dir`/`submit_analysis_job` 을 monkeypatch 하는 방식이 `open_work_dir` 클로저를 거쳐도 그대로 먹혀야 한다).

- [ ] **Step 6: 커밋 준비 완료 — 사용자에게 보고**

변경 파일: `app/routers/analysis.py`, `tests/test_analysis_rerun_with.py`.

---

### Task 5: `POST /analysis/{id}/rerun-with`

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/routers/analysis.py` (Task 4 의 `get_analysis_input_snapshot` 바로 뒤)
- Modify: `HiTessWorkBenchBackEnd/tests/test_analysis_rerun_with.py`

- [ ] **Step 1: 실패 테스트 추가**

`tests/test_analysis_rerun_with.py` 끝에 추가:

```python
def test_rerun_with_overrides_scalar_option(admin_client, db_session, isolated_user_connection, tmp_path, monkeypatch):
    record, bdf = _bdf_scanner_record(db_session, isolated_user_connection, use_nastran=False)
    rerun_dir = isolated_user_connection / "rerun"
    rerun_dir.mkdir()
    submitted = {}
    monkeypatch.setattr(analysis, "make_work_dir", lambda *_a: (str(rerun_dir), "20260918_130000"))

    def fake_submit(task, *args, **kwargs):
        submitted["task"] = task
        submitted["args"] = args
        return "rerun-with-job-1"

    monkeypatch.setattr(analysis, "submit_analysis_job", fake_submit)

    response = admin_client.post(
        f"/api/analysis/{record.id}/rerun-with",
        json={"input_info": {"use_nastran": True, "employee_id": "HACK"}},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["job_id"] == "rerun-with-job-1"
    assert body["overridden_keys"] == ["use_nastran"]
    assert submitted["task"] is analysis.task_execute_bdfscanner
    # (bdf_path, work_dir, current_user, timestamp, source, use_nastran)
    assert submitted["args"][2] == "ADMIN001"
    assert submitted["args"][4] == "WorkbenchRerun"
    assert submitted["args"][5] is True
    assert (rerun_dir / "model.bdf").read_text(encoding="utf-8") == bdf.read_text(encoding="utf-8")


def test_rerun_with_rejects_file_key_override(admin_client, db_session, isolated_user_connection):
    record, _ = _bdf_scanner_record(db_session, isolated_user_connection)

    response = admin_client.post(
        f"/api/analysis/{record.id}/rerun-with",
        json={"input_info": {"bdf_model": "C:/evil/model.bdf"}},
    )

    assert response.status_code == 422
    assert "bdf_model" in response.json()["detail"]
    # 작업 폴더를 만들기 전에 거부된다.
    assert sorted(p.name for p in isolated_user_connection.iterdir()) == ["20260918_120000_ADMIN001_BdfScanner"]


def test_rerun_with_rejects_program_without_adapter(admin_client, db_session):
    record = _seed(db_session, "ADMIN001", "Column Buckling Load Calculator",
                   {"memberName": "300A PIPE", "columnLengthMm": 4470})

    response = admin_client.post(f"/api/analysis/{record.id}/rerun-with", json={"input_info": {"columnLengthMm": 5000}})

    assert response.status_code == 422
    assert "앱에서 열어" in response.json()["detail"]


def test_rerun_with_bad_numeric_value_cleans_workspace(admin_client, db_session, isolated_user_connection, monkeypatch):
    work = isolated_user_connection / "20260918_120000_ADMIN001_MooringFitting"
    work.mkdir(parents=True)
    structure = work / "MooringFittingData.csv"
    load = work / "MooringFittingDataLoad.csv"
    structure.write_text("a,b\n1,2\n", encoding="utf-8")
    load.write_text("c,d\n3,4\n", encoding="utf-8")
    record = _seed(db_session, "ADMIN001", "MooringFitting", {
        "structure_csv": str(structure), "load_csv": str(load), "mf_safety_factor": 1.25,
    })
    monkeypatch.setattr(analysis, "submit_analysis_job", lambda *a, **k: pytest.fail("submit 되면 안 된다"))

    response = admin_client.post(
        f"/api/analysis/{record.id}/rerun-with",
        json={"input_info": {"mf_safety_factor": "abc"}},
    )

    assert response.status_code == 422
    assert "입력 값 형식" in response.json()["detail"]
    # 실제 make_work_dir 이 만든 새 폴더가 정리되어 원본 폴더만 남는다.
    assert sorted(p.name for p in isolated_user_connection.iterdir()) == [work.name]
```

- [ ] **Step 2: 실패 확인**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_analysis_rerun_with.py -q
```
Expected: 앞 4개 통과, 새 4개 실패(`assert 404 == 200` 등).

- [ ] **Step 3: 라우트 구현**

`analysis.py` 의 `get_analysis_input_snapshot` 함수 바로 뒤에 추가:

```python
@router.post("/analysis/{analysis_id}/rerun-with")
def rerun_analysis_with(
    analysis_id: int,
    body: RerunWithRequest,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """이전 입력의 값 옵션만 바꿔 다시 제출한다. 파일 입력은 항상 원본 이력에서 복사한다.

    파일 키를 오버라이드하려 하면 422 — 클라이언트가 임의 경로를 넣는 통로를 열지 않는다.
    """
    record = db.query(models.Analysis).filter(models.Analysis.id == analysis_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Analysis record not found")
    assert_current_user_can_access_owner(record.employee_id, current_user, db)

    spec = resolve_program(record.program_name)
    if not spec or not spec.rerun_adapter:
        raise HTTPException(
            status_code=422,
            detail="이 앱은 수정 후 재실행을 지원하지 않습니다. 프리셋을 저장한 뒤 앱에서 열어 실행하세요.",
        )

    info = record.input_info if isinstance(record.input_info, dict) else {}
    files, _values = split_input_info(info, _USER_CONNECTION_DIR)
    overrides = validate_overrides(body.input_info, files)
    merged = {**info, **overrides}

    job_id = _dispatch_rerun(record, merged, current_user=current_user, db=db, source="WorkbenchRerun")

    return {
        "job_id": job_id,
        "source_analysis_id": analysis_id,
        "program_name": record.program_name or "",
        "overridden_keys": sorted(overrides),
        "message": "수정한 입력으로 새 해석 작업을 제출했습니다.",
    }
```

`analysis.py` 상단 `from pydantic import BaseModel`(24행) 아래에 `from ..schemas import RerunWithRequest` 를 추가한다(`from .. import models, database` 26행 옆).

- [ ] **Step 4: 통과 확인**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests/test_analysis_rerun_with.py tests/test_analysis_rerun.py tests/test_input_presets_api.py tests/test_input_presets_service.py -q
```
Expected: 전부 `passed`(rerun_with 8, rerun 기존, presets_api 7, service 10).

- [ ] **Step 5: 전체 백엔드 회귀**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests -q -x
```
Expected: `0 failed`. (느린 보고서 테스트가 있어 수 분 걸린다.)

- [ ] **Step 6: 커밋 준비 완료 — 사용자에게 보고**

변경 파일: `app/routers/analysis.py`, `tests/test_analysis_rerun_with.py`. 백엔드 완료 — 서버(145)는 `git pull` + 재시작.

---

### Task 6: 프론트 API 모듈 + 핸드오프 유틸 + `usePreset` 훅

**Files:**
- Create: `HiTessWorkBench/frontend/src/api/presets.js`
- Modify: `HiTessWorkBench/frontend/src/api/analysis.js:24-30` 뒤
- Create: `HiTessWorkBench/frontend/src/utils/presetHandoff.js`
- Create: `HiTessWorkBench/frontend/src/hooks/usePreset.js`

- [ ] **Step 1: `api/presets.js`**

```js
/**
 * 입력 프리셋 API. 프리셋은 개인 소유이며 값 키만 담는다(파일 경로는 서버가 422).
 */
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthHeaders } from '../utils/auth';

/** 내 프리셋 목록. programId 를 주면 그 앱 것만. */
export const listPresets = (programId) =>
  axios.get(`${API_BASE_URL}/api/presets`, {
    params: programId ? { program_id: programId } : {},
    headers: getAuthHeaders(),
  });

/** 생성 — { program_id, name, input_info, source_analysis_id? } */
export const createPreset = (payload) =>
  axios.post(`${API_BASE_URL}/api/presets`, payload, { headers: getAuthHeaders() });

/** 부분 갱신 — { name?, input_info? } */
export const updatePreset = (presetId, payload) =>
  axios.put(`${API_BASE_URL}/api/presets/${presetId}`, payload, { headers: getAuthHeaders() });

export const deletePreset = (presetId) =>
  axios.delete(`${API_BASE_URL}/api/presets/${presetId}`, { headers: getAuthHeaders() });
```

- [ ] **Step 2: `api/analysis.js` 에 두 함수 추가**

`rerunAnalysisProject`(24-30행) 바로 뒤에:

```js
/** 이력 레코드의 input_info 를 파일(basename)/값으로 나눈 스냅샷 — InputPresetDrawer 데이터원 */
export const getAnalysisInputSnapshot = (analysisId) =>
  axios.get(`${API_BASE_URL}/api/analysis/${analysisId}/input-snapshot`, { headers: getAuthHeaders() });

/** 값 옵션만 바꿔 과거 해석을 새 작업으로 재제출 (파일은 원본 이력에서 복사) */
export const rerunAnalysisWith = (analysisId, inputInfo) =>
  axios.post(
    `${API_BASE_URL}/api/analysis/${analysisId}/rerun-with`,
    { input_info: inputInfo },
    { headers: getAuthHeaders() },
  );
```

- [ ] **Step 3: `utils/presetHandoff.js` (부수효과는 sessionStorage 두 함수에만)**

```js
/**
 * 프리셋 값을 MyProjects → 파라메트릭 앱 페이지로 넘기는 핸드오프와,
 * InputPresetDrawer 가 쓰는 필드 타입·변환·diff 순수 함수.
 *
 * 핸드오프는 Dashboard → MyProjects 상세 모달이 쓰는 sessionStorage 패턴
 * (`workbench:open-project-detail`)과 같은 방식이다. 읽으면 즉시 지운다.
 */
export const PRESET_HANDOFF_KEY = 'workbench:preset-handoff';
const HANDOFF_TTL_MS = 5 * 60 * 1000;

export function writePresetHandoff({ programId, values, name = '' }) {
  try {
    sessionStorage.setItem(PRESET_HANDOFF_KEY, JSON.stringify({
      programId, values: values || {}, name, at: Date.now(),
    }));
    return true;
  } catch {
    return false;
  }
}

/** programId 가 일치하고 5분 이내면 값을 돌려주고 지운다. 아니면 null. */
export function takePresetHandoff(programId, now = Date.now()) {
  try {
    const raw = sessionStorage.getItem(PRESET_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.programId !== programId) return null;
    sessionStorage.removeItem(PRESET_HANDOFF_KEY);
    if (!parsed.at || now - parsed.at > HANDOFF_TTL_MS) return null;
    return { values: parsed.values || {}, name: parsed.name || '' };
  } catch {
    return null;
  }
}

/** 스냅샷 값의 타입으로 드로어 필드 종류를 정한다. 앱별 분기 없음. */
export function fieldKindOf(value) {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (value === null || value === undefined || typeof value === 'string') return 'text';
  return 'json';
}

/** 드로어 입력(문자열/불리언)을 서버에 보낼 값으로 바꾼다. 빈 값은 null(= 원본 유지). */
export function coerceFieldValue(kind, raw) {
  if (kind === 'boolean') return Boolean(raw);
  if (kind === 'number') {
    if (raw === '' || raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (kind === 'json') return raw;
  if (raw === null || raw === undefined) return '';
  return String(raw);
}

/** 원본과 다른 키만 남긴다. null/빈 문자열은 '수정 안 함'으로 본다. */
export function diffOverrides(original, coerced) {
  const out = {};
  Object.entries(coerced || {}).forEach(([key, value]) => {
    if (value === null || value === '') return;
    if (JSON.stringify(original?.[key]) !== JSON.stringify(value)) out[key] = value;
  });
  return out;
}
```

- [ ] **Step 4: `hooks/usePreset.js`**

```js
/**
 * usePreset(programId, { onApply })
 *
 * - 마운트 시 그 앱의 내 프리셋 목록을 읽는다.
 * - MyProjects 드로어가 남긴 핸드오프(sessionStorage)가 있으면 1회 onApply(values, meta) 한다.
 * - applyPreset / saveCurrent / removePreset 을 돌려준다.
 *
 * 값 → 페이지 state 매핑은 페이지의 onApply 가 맡는다(앱별 폼을 여기 두지 않는다).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPreset, deletePreset, listPresets } from '../api/presets';
import { takePresetHandoff } from '../utils/presetHandoff';

export default function usePreset(programId, { onApply } = {}) {
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(false);
  const onApplyRef = useRef(onApply);
  useEffect(() => { onApplyRef.current = onApply; }, [onApply]);

  const refresh = useCallback(async () => {
    if (!programId) return;
    setLoading(true);
    try {
      const res = await listPresets(programId);
      setPresets(Array.isArray(res.data) ? res.data : []);
    } catch {
      // 목록 실패는 조용히 — 페이지 본연의 기능을 막지 않는다.
    } finally {
      setLoading(false);
    }
  }, [programId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!programId) return;
    const handoff = takePresetHandoff(programId);
    if (handoff && onApplyRef.current) {
      onApplyRef.current(handoff.values, { source: 'handoff', name: handoff.name });
    }
  }, [programId]);

  const applyPreset = useCallback((preset) => {
    if (!preset) return;
    onApplyRef.current?.(preset.input_info || {}, { source: 'preset', id: preset.id, name: preset.name });
  }, []);

  const saveCurrent = useCallback(async (name, values, sourceAnalysisId = null) => {
    const res = await createPreset({
      program_id: programId,
      name,
      input_info: values || {},
      source_analysis_id: sourceAnalysisId,
    });
    await refresh();
    return res.data;
  }, [programId, refresh]);

  const removePreset = useCallback(async (presetId) => {
    await deletePreset(presetId);
    await refresh();
  }, [refresh]);

  return { presets, loading, refresh, applyPreset, saveCurrent, removePreset };
}
```

- [ ] **Step 5: 빌드 확인**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && npm run build
```
Expected: `✓ built in ...` — 오류 없음(아직 어디서도 import 하지 않으므로 트리셰이킹돼도 문법 오류는 잡힌다).

- [ ] **Step 6: 커밋 준비 완료 — 사용자에게 보고**

변경 파일: `src/api/presets.js`, `src/api/analysis.js`, `src/utils/presetHandoff.js`, `src/hooks/usePreset.js`. `config.js` 는 제외.

---

### Task 7: `PresetPicker` + `InputPresetDrawer`

**Files:**
- Create: `HiTessWorkBench/frontend/src/components/analysis/PresetPicker.jsx`
- Create: `HiTessWorkBench/frontend/src/components/analysis/InputPresetDrawer.jsx`

- [ ] **Step 1: `PresetPicker.jsx`**

```jsx
/**
 * 프리셋 한 줄 툴바 — 선택/적용, 현재 값 저장, 삭제.
 *
 * 파라메트릭 페이지와 InputPresetDrawer 가 같이 쓴다.
 *   <PresetPicker programId="jib-rest" getValues={() => ({...})} onApply={(values) => ...} />
 * getValues 는 저장 시점의 값 dict(서버가 employee_id 는 버린다).
 */
import React, { useState } from 'react';
import { BookmarkPlus, Check, Trash2, X } from 'lucide-react';
import usePreset from '../../hooks/usePreset';
import { useToast } from '../../contexts/ToastContext';
import ConfirmDialog from '../ui/ConfirmDialog';

export default function PresetPicker({ programId, getValues, onApply, sourceAnalysisId = null, className = '' }) {
  const { showToast } = useToast();
  const { presets, loading, applyPreset, saveCurrent, removePreset } = usePreset(programId, { onApply });
  const [selectedId, setSelectedId] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!programId) return null;
  const selected = presets.find((p) => String(p.id) === selectedId) || null;

  const handleApply = () => {
    if (!selected) return;
    applyPreset(selected);
    showToast(`프리셋 '${selected.name}' 을 적용했습니다.`, 'success');
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const saved = await saveCurrent(trimmed, getValues?.() || {}, sourceAnalysisId);
      setSelectedId(String(saved.id));
      setNaming(false);
      setName('');
      showToast(`프리셋 '${trimmed}' 을 저장했습니다.`, 'success');
    } catch (error) {
      showToast(error?.response?.data?.detail || '프리셋 저장에 실패했습니다.', 'error', 6000);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!selected) return;
    setConfirmDelete(false);
    try {
      await removePreset(selected.id);
      setSelectedId('');
      showToast('프리셋을 삭제했습니다.', 'success');
    } catch {
      showToast('프리셋 삭제에 실패했습니다.', 'error');
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        disabled={loading || presets.length === 0}
        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 focus:border-brand-blue focus:outline-none disabled:text-slate-400"
        aria-label="입력 프리셋 선택"
      >
        <option value="">{presets.length === 0 ? '저장된 프리셋 없음' : '프리셋 선택…'}</option>
        {presets.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
      </select>
      <button
        type="button"
        onClick={handleApply}
        disabled={!selected}
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-brand-blue/30 bg-blue-50 px-2.5 text-xs font-bold text-brand-blue hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Check size={13} /> 적용
      </button>
      <button
        type="button"
        onClick={() => setConfirmDelete(true)}
        disabled={!selected}
        className="inline-flex h-8 items-center rounded-lg px-2 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="선택한 프리셋 삭제"
      >
        <Trash2 size={13} />
      </button>
      {naming ? (
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setNaming(false); }}
            maxLength={100}
            placeholder="프리셋 이름"
            className="h-8 w-40 rounded-lg border border-slate-200 px-2 text-xs focus:border-brand-blue focus:outline-none"
          />
          <button type="button" onClick={handleSave} disabled={busy || !name.trim()} className="inline-flex h-8 items-center rounded-lg bg-brand-blue px-2.5 text-xs font-bold text-white disabled:opacity-40">저장</button>
          <button type="button" onClick={() => { setNaming(false); setName(''); }} className="inline-flex h-8 items-center rounded-lg px-1.5 text-slate-400 hover:text-slate-600" aria-label="취소"><X size={13} /></button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setNaming(true)}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
        >
          <BookmarkPlus size={13} /> 현재 값 저장
        </button>
      )}
      <ConfirmDialog
        isOpen={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleRemove}
        title="프리셋 삭제"
        message={selected ? `프리셋 '${selected.name}' 을 삭제할까요? 되돌릴 수 없습니다.` : ''}
        confirmLabel="삭제"
      />
    </div>
  );
}
```

- [ ] **Step 2: `InputPresetDrawer.jsx`**

```jsx
/**
 * MyProjects 상세 모달에서 여는 공용 "입력 불러와 수정" 편집기.
 *
 * 앱별 폼을 만들지 않는다 — GET /input-snapshot 의 values 를 타입별 범용 필드로 그린다.
 *   boolean → 체크박스, number → CalcInputField, string/null → Input, dict/list → 읽기 전용 JSON
 * 파일 키는 읽기 전용 목록("원본에서 복사")이다.
 *
 * 푸터: rerun_editable → "수정한 입력으로 재실행" (POST /rerun-with, 변경분만 전송)
 *       app_openable   → "앱에서 열기" (sessionStorage 핸드오프 → 페이지 usePreset 이 주입)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText, Loader2, Play } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import CalcInputField from '../ui/CalcInputField';
import PresetPicker from './PresetPicker';
import { getAnalysisInputSnapshot, rerunAnalysisWith } from '../../api/analysis';
import { coerceFieldValue, diffOverrides, fieldKindOf, writePresetHandoff } from '../../utils/presetHandoff';
import { getDisplayProgramName } from '../../contexts/DashboardContext';
import { useToast } from '../../contexts/ToastContext';

const toDraft = (values) => {
  const draft = {};
  Object.entries(values || {}).forEach(([key, value]) => {
    const kind = fieldKindOf(value);
    draft[key] = kind === 'boolean' ? Boolean(value)
      : kind === 'json' ? value
        : value === null || value === undefined ? '' : String(value);
  });
  return draft;
};

export default function InputPresetDrawer({ project, isOpen, onClose, onSubmitted, onOpenApp }) {
  const { showToast } = useToast();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !project?.id) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSnapshot(null);
    getAnalysisInputSnapshot(project.id)
      .then((res) => {
        if (cancelled) return;
        setSnapshot(res.data);
        setDraft(toDraft(res.data?.values));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.detail || '입력 스냅샷을 불러오지 못했습니다.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, project?.id]);

  // 필드 종류는 원본 값의 타입으로 고정한다(프리셋 적용으로 타입이 바뀌지 않게).
  const kinds = useMemo(() => {
    const out = {};
    Object.entries(snapshot?.values || {}).forEach(([key, value]) => { out[key] = fieldKindOf(value); });
    return out;
  }, [snapshot]);

  const coercedDraft = useCallback(() => {
    const out = {};
    Object.entries(draft).forEach(([key, raw]) => {
      out[key] = coerceFieldValue(kinds[key] || fieldKindOf(raw), raw);
    });
    return out;
  }, [draft, kinds]);

  const applyPresetValues = useCallback((values) => {
    setDraft((prev) => {
      const next = { ...prev };
      Object.entries(values || {}).forEach(([key, value]) => {
        const kind = kinds[key] || fieldKindOf(value);
        next[key] = kind === 'boolean' ? Boolean(value)
          : kind === 'json' ? value
            : value === null || value === undefined ? '' : String(value);
      });
      return next;
    });
  }, [kinds]);

  const handleRerun = async () => {
    if (!snapshot?.rerun_editable || submitting) return;
    const overrides = diffOverrides(snapshot.values, coercedDraft());
    setSubmitting(true);
    try {
      const res = await rerunAnalysisWith(project.id, overrides);
      const jobId = res.data?.job_id;
      if (!jobId) throw new Error('job_id missing');
      onSubmitted?.(project, jobId, res.data?.overridden_keys || []);
      onClose?.();
    } catch (err) {
      showToast(err?.response?.data?.detail || '수정 재실행 요청에 실패했습니다.', 'error', 7000);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenApp = () => {
    if (!snapshot?.app_openable) return;
    const ok = writePresetHandoff({
      programId: snapshot.program_id,
      values: coercedDraft(),
      name: project?.project_name || '',
    });
    if (!ok) {
      showToast('브라우저 저장소를 쓸 수 없어 값을 넘기지 못했습니다.', 'error');
      return;
    }
    onOpenApp?.(project, snapshot.program_id);
    onClose?.();
  };

  const fileEntries = Object.entries(snapshot?.files || {});
  const valueKeys = Object.keys(draft);
  const filesMissing = snapshot?.files_available === false;
  const programLabel = getDisplayProgramName(project?.program_name);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="입력 불러와 수정"
      size="lg"
      footer={(
        <div className="flex items-center justify-between gap-2">
          <Button variant="secondary" size="md" onClick={onClose}>닫기</Button>
          <div className="flex items-center gap-2">
            {snapshot?.app_openable && (
              <Button variant="secondary" size="md" onClick={handleOpenApp} disabled={loading || !!error}>
                <ExternalLink size={14} className="mr-1" /> 앱에서 열기
              </Button>
            )}
            {snapshot?.rerun_editable && (
              <Button
                variant="primary"
                size="md"
                onClick={handleRerun}
                disabled={loading || !!error || submitting || filesMissing}
                title={filesMissing ? '입력 파일 보관 기간이 만료되어 재실행할 수 없습니다.' : undefined}
              >
                {submitting ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Play size={14} className="mr-1" />}
                수정한 입력으로 재실행
              </Button>
            )}
          </div>
        </div>
      )}
    >
      <div className="space-y-5 p-6">
        <div className="text-xs text-slate-500">
          <span className="rounded bg-slate-100 px-2 py-0.5 font-bold text-slate-600">{programLabel}</span>
          <span className="ml-2 font-mono">ID: {project?.id}</span>
        </div>

        {loading && <p className="text-sm text-slate-500">입력 스냅샷을 불러오는 중…</p>}
        {error && <p className="text-sm font-semibold text-red-600">{error}</p>}

        {snapshot && !snapshot.preset_capable && (
          <p className="text-sm text-slate-600">이 앱은 입력 프리셋을 지원하지 않습니다.</p>
        )}

        {snapshot?.preset_capable && (
          <>
            <PresetPicker
              programId={snapshot.program_id}
              getValues={coercedDraft}
              onApply={applyPresetValues}
              sourceAnalysisId={project?.id ?? null}
            />

            {fileEntries.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">파일 입력 (원본에서 복사)</h3>
                <ul className="space-y-1">
                  {fileEntries.map(([key, name]) => (
                    <li key={key} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                      <FileText size={14} className="text-slate-400" />
                      <span className="font-bold uppercase text-slate-600">{key.replace(/_/g, ' ')}</span>
                      <span className="ml-auto truncate font-mono text-slate-500" title={name}>{name}</span>
                    </li>
                  ))}
                </ul>
                {filesMissing && (
                  <p className="mt-1 text-[11px] font-semibold text-amber-700">보관 기간이 지나 원본 파일이 없습니다. 값은 프리셋으로 저장할 수 있지만 재실행은 할 수 없습니다.</p>
                )}
              </section>
            )}

            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">값 입력</h3>
              {valueKeys.length === 0 ? (
                <p className="text-xs text-slate-500">수정할 수 있는 값 옵션이 없습니다. 파일만 원본에서 복사해 재실행합니다.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {valueKeys.map((key) => {
                    const kind = kinds[key] || fieldKindOf(draft[key]);
                    const label = key.replace(/_/g, ' ');
                    if (kind === 'boolean') {
                      return (
                        <label key={key} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            checked={Boolean(draft[key])}
                            onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.checked }))}
                          />
                          {label}
                        </label>
                      );
                    }
                    if (kind === 'number') {
                      return (
                        <CalcInputField
                          key={key}
                          size="sm"
                          label={label}
                          value={draft[key]}
                          onChange={(next) => setDraft((prev) => ({ ...prev, [key]: next }))}
                          allowFormula
                          rangeHint={false}
                        />
                      );
                    }
                    if (kind === 'json') {
                      return (
                        <div key={key} className="sm:col-span-2">
                          <p className="mb-1 text-[11px] font-semibold text-slate-600">{label} <span className="text-slate-400">(읽기 전용)</span></p>
                          <pre className="max-h-40 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600">{JSON.stringify(draft[key], null, 2)}</pre>
                        </div>
                      );
                    }
                    return (
                      <Input
                        key={key}
                        size="sm"
                        label={label}
                        value={draft[key] ?? ''}
                        onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                      />
                    );
                  })}
                </div>
              )}
              {snapshot.rerun_editable && (
                <p className="mt-2 text-[11px] text-slate-500">원본과 같은 값은 보내지 않습니다. 빈 칸은 원본 값을 유지합니다.</p>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: 빌드 확인**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && npm run build
```
Expected: `✓ built in ...`. (`Input` 가 `size`·`label` prop 을 받는지는 `components/ui/Input.jsx:22-30` 의 JSDoc 대로다.)

- [ ] **Step 4: 커밋 준비 완료 — 사용자에게 보고**

변경 파일: `src/components/analysis/PresetPicker.jsx`, `src/components/analysis/InputPresetDrawer.jsx`.

---

### Task 8: MyProjects 연결

**Files:**
- Modify: `HiTessWorkBench/frontend/src/pages/analysis/MyProjects.jsx` (`:1-12` import, `:264` 시그니처, `:365-372` 푸터, `:651-666` state, `:742-763` 뒤 핸들러, `:1261-1266` 렌더)

- [ ] **Step 1: import 추가**

2행 뒤에:

```js
import InputPresetDrawer from '../../components/analysis/InputPresetDrawer';
import { useNavigation } from '../../contexts/NavigationContext';
```

4-12행 lucide import 목록에 `SlidersHorizontal` 추가(예: `Clock3, ListChecks, Pipette, Terminal, SlidersHorizontal`).

- [ ] **Step 2: `ProjectDetailModal` 에 버튼**

264행 시그니처를 `const ProjectDetailModal = ({ project, onClose, onOpen3D, onEditInputs }) => {` 로 바꾸고, 푸터(365-372행)를 아래로 교체:

```jsx
      footer={
        <div className="flex items-center justify-between">
          <Button
            variant="secondary"
            size="md"
            onClick={() => onEditInputs?.(project)}
            disabled={!project?.input_info || Object.keys(project.input_info).length === 0}
            title="이전 입력을 불러와 값을 고쳐 재실행하거나 프리셋으로 저장합니다."
          >
            <SlidersHorizontal size={14} className="mr-1" /> 입력 불러와 수정
          </Button>
          <Button variant="secondary" size="md" onClick={onClose}>닫기</Button>
        </div>
      }
```

- [ ] **Step 3: 메인 컴포넌트 state·핸들러**

653행 `const { startGlobalJob } = useGlobalJobs();` 다음에:

```js
  const { setCurrentMenu } = useNavigation();
```

666행 `const [rerunningIds, setRerunningIds] = useState(() => new Set());` 다음에:

```js
  const [presetDrawerProject, setPresetDrawerProject] = useState(null);
```

`handleRerun`(742-763행) 바로 뒤에:

```js
  // 드로어에서 수정 재실행이 제출되면 동일 입력 재실행과 같은 후처리를 한다.
  const handleRerunWithSubmitted = useCallback((project, jobId, overriddenKeys) => {
    const app = findAppByProgramName(project.program_name);
    startGlobalJob(jobId, app?.title || getDisplayProgramName(project.program_name));
    const summary = overriddenKeys.length > 0 ? ` (변경: ${overriddenKeys.join(', ')})` : '';
    showToast(`수정한 입력으로 새 해석 작업을 제출했습니다.${summary}`, 'success');
    window.dispatchEvent(new CustomEvent('workbench:open-job-center'));
  }, [showToast, startGlobalJob]);

  // 계산기 앱은 값을 sessionStorage 로 넘기고 페이지로 이동한다(페이지의 usePreset 이 받는다).
  const handleOpenAppWithPreset = useCallback((project) => {
    const app = findAppByProgramName(project.program_name);
    const menu = app?.menuName || app?.title;
    if (!menu) {
      showToast('이 프로그램의 앱 페이지를 찾지 못했습니다.', 'error');
      return;
    }
    setSelectedProject(null);
    setCurrentMenu(menu);
  }, [setCurrentMenu, showToast]);
```

- [ ] **Step 4: 렌더 연결**

1261-1266행의 `<ProjectDetailModal ... />` 에 prop 추가:

```jsx
        <ProjectDetailModal
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onOpen3D={() => setIs3DViewerOpen(true)}
          onEditInputs={(project) => setPresetDrawerProject(project)}
        />
```

`<ProjectCompareModal ... />` 바로 뒤(닫는 `</div>` 앞)에:

```jsx
      <InputPresetDrawer
        project={presetDrawerProject}
        isOpen={!!presetDrawerProject}
        onClose={() => setPresetDrawerProject(null)}
        onSubmitted={handleRerunWithSubmitted}
        onOpenApp={handleOpenAppWithPreset}
      />
```

- [ ] **Step 5: 수동 검증 (백엔드 `uvicorn app.main:app --port 9091 --reload` + `npm run dev`)**

1. My Projects → BDF Scanner 이력 행 클릭 → 상세 모달 왼쪽 아래 "입력 불러와 수정" 클릭.
2. 드로어에 `파일 입력` 목록(`bdf model · model.bdf`)과 `값 입력`에 `use nastran` 체크박스가 보인다.
3. 체크를 바꾸고 "수정한 입력으로 재실행" → 토스트 `수정한 입력으로 새 해석 작업을 제출했습니다. (변경: use_nastran)` + Job Center 열림 + 새 이력 행(source `WorkbenchRerun`).
4. 값을 그대로 두고 재실행 → 토스트에 `(변경: …)` 이 없고 정상 제출.
5. "현재 값 저장" → 이름 입력 → 저장 → 셀렉트에 나타남 → 다른 BDF Scanner 이력에서 드로어를 열어 그 프리셋 "적용" → 체크 상태가 바뀐다.
6. HiTESS Model Builder 이력에서 드로어 → `mesh size` 숫자 필드에 `abc` 는 `CalcInputField` 가 막고, `150*2` 수식은 300 으로 들어간다.
7. Column Buckling 이력(계산기) → 드로어 푸터에 "앱에서 열기"만 보이고 재실행 버튼은 없다. (주입 확인은 Task 9)
8. 파일 만료 행(`files_available=false`) → 재실행 버튼 비활성 + 파일 목록 아래 경고 문구.
9. 다른 사용자 이력(관리자 계정으로 Analysis Management 등에서 접근 시)은 범위 밖 — 상세 모달 자체가 본인 이력만 열린다.

- [ ] **Step 6: 커밋 준비 완료 — 사용자에게 보고**

변경 파일: `src/pages/analysis/MyProjects.jsx`. `config.js` 제외.

---

### Task 9: 파라메트릭 파일럿 — Jib Rest, Column Buckling

**Files:**
- Modify: `HiTessWorkBench/frontend/src/pages/analysis/JibRestAssessment.jsx` (`:20` import, `:189-190` 상수, `:207` 뒤 핸들러, `:424` 입력 패널)
- Modify: `HiTessWorkBench/frontend/src/pages/analysis/ColumnBucklingCalculator.jsx` (import, `:75` 뒤 핸들러, `:128-130` 툴바)

- [ ] **Step 1: Jib Rest — import·상수**

20행 `import CalcInputField ...` 다음에:

```js
import PresetPicker from '../../components/analysis/PresetPicker';
```

189-190행 상수 아래에:

```js
const KEYS_1DAN = Object.keys(EMPTY_1DAN);
const KEYS_2DAN = Object.keys(EMPTY_2DAN);
```

- [ ] **Step 2: Jib Rest — 주입/추출 핸들러**

207행(`const isValid2dan = ...`) 다음에:

```js
  // 프리셋/핸드오프 값 → 폼. 키가 1단·2단 어느 쪽인지로 나눠 넣고, 2단 키가 있으면 2단 탭으로 간다.
  // input_json 인라인이라 키 이름이 요청 스키마(jh, jb, …)와 같다.
  const applyPresetValues = useCallback((values) => {
    const next1 = {};
    const next2 = {};
    Object.entries(values || {}).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') return;
      if (KEYS_1DAN.includes(key)) next1[key] = String(value);
      else if (KEYS_2DAN.includes(key)) next2[key] = String(value);
    });
    if (Object.keys(next1).length > 0) setInputs1dan(prev => ({ ...prev, ...next1 }));
    if (Object.keys(next2).length > 0) {
      setInputs2dan(prev => ({ ...prev, ...next2 }));
      setActiveTab('2dan');
    }
    setResult1dan(null);
    setResult2dan(null);
    setSelectedRank1(null);
    setSelectedRank2(null);
  }, []);

  // 현재 탭 기준 저장 값(숫자). 2단 탭이면 2단 키까지 포함한다.
  const currentPresetValues = () => {
    const out = {};
    Object.entries(inputs1dan).forEach(([key, value]) => { out[key] = value === '' ? null : Number(value); });
    if (activeTab === '2dan') {
      Object.entries(inputs2dan).forEach(([key, value]) => { out[key] = value === '' ? null : Number(value); });
    }
    return out;
  };
```

1행 `import React, { useState } from 'react';` 를 `import React, { useCallback, useState } from 'react';` 로.

- [ ] **Step 3: Jib Rest — 툴바 배치**

424행 `<div className="p-6 space-y-4">` 바로 다음 줄(`{/* 1단 공통 입력 */}` 앞)에:

```jsx
            <PresetPicker programId="jib-rest" getValues={currentPresetValues} onApply={applyPresetValues} className="mb-2" />
```

- [ ] **Step 4: Column Buckling — import·핸들러·툴바**

`import CalcInputField` 줄 뒤에 `import PresetPicker from '../../components/analysis/PresetPicker';`.
1행 import 에 `useCallback` 추가(`import React, { useCallback, useMemo, useState } from 'react';`).

75행 `const autosave = ...` 다음에:

```js
  // 저장은 요청 스키마 키(member_name, length_mm)로 통일한다. 이력 스냅샷은 서비스가
  // 저장한 camelCase(memberName, columnLengthMm — column_buckling_service.py:47-50)로 오므로 둘 다 읽는다.
  const applyPresetValues = useCallback((values) => {
    const name = values?.member_name ?? values?.memberName;
    const length = values?.length_mm ?? values?.columnLengthMm;
    if (typeof name === 'string' && name.trim()) setMemberName(name);
    if (length !== null && length !== undefined && length !== '') setLengthMm(String(length));
    setResult(null);
    setError(null);
  }, []);
  const currentPresetValues = () => ({
    member_name: memberName,
    length_mm: lengthMm === '' ? null : Number(lengthMm),
  });
```

128-130행의 툴바를 아래로 교체:

```jsx
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <PresetPicker programId="column-buckling" getValues={currentPresetValues} onApply={applyPresetValues} />
        <DraftAutosavePill autosave={autosave} onRestore={restoreDraft} />
      </div>
```

- [ ] **Step 5: 빌드 + 수동 검증**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && npm run build
```
Expected: `✓ built in ...`.

수동(`npm run dev`):
1. Jib Rest 페이지 → 값을 바꾸고 "현재 값 저장" → 이름 `A안` → 셀렉트에 보임. 새로고침 후에도 목록에 남는다(서버 저장).
2. 값을 기본으로 되돌린 뒤 `A안` "적용" → 12개 필드가 저장값으로 바뀌고 결과 영역이 비워진다.
3. 2단 탭에서 저장 → 프리셋에 `h2,h3,d1,t1` 포함 → 1단 탭에서 적용하면 2단 탭으로 자동 전환.
4. My Projects → Jib Rest 이력 → "입력 불러와 수정" → 드로어에 `jh, jb, …` 숫자 필드(파일 목록 없음) → `jh` 를 1000 으로 → "앱에서 열기" → Jib Rest 페이지가 열리고 `JH` 가 1000. **자동 계산되지 않는다.**
5. 같은 절차를 Column Buckling 이력으로: 드로어에 `memberName`, `columnLengthMm` → "앱에서 열기" → 부재명·길이 주입.
6. 핸드오프 후 다시 같은 페이지를 열어도 값이 재주입되지 않는다(읽으면 삭제).
7. Jib Rest 에서 저장한 프리셋이 Column Buckling 셀렉트에 안 보인다(program_id 필터).
8. 프리셋 이름 중복 저장 → 토스트 `같은 이름의 프리셋이 이미 있습니다.`

- [ ] **Step 6: 커밋 준비 완료 — 사용자에게 보고**

변경 파일: `src/pages/analysis/JibRestAssessment.jsx`, `src/pages/analysis/ColumnBucklingCalculator.jsx`. `config.js` 제외.

---

### Task 10: 최종 회귀·자기 검토·서버 반영 안내

**Files:** 없음(검증만)

- [ ] **Step 1: 백엔드 전체 테스트**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
Expected: `0 failed`.

- [ ] **Step 2: 게이트 미등록 확인**

```
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd && WorkBenchEnv/Scripts/python.exe -c "from app.services.app_settings import resolve_app_key as r; print(r('/api/presets'), r('/api/analysis/1/rerun-with'))"
```
Expected: `None None` (플랫폼 공통 기능 — 마스터 §1-8).

- [ ] **Step 3: 프론트 빌드 + `git status` 점검**

```
cd C:\Coding\WorkBench\HiTessWorkBench\frontend && npm run build && cd C:\Coding\WorkBench && git status --short
```
Expected: 빌드 성공. 변경 목록에 `HiTessWorkBench/frontend/src/config.js` 가 있으면 **스테이징하지 말 것**(로컬 전용). `Darkmode.js/` 는 없어야 한다.

- [ ] **Step 4: 사용자에게 최종 보고 — 서버(145) 반영 구분**

| 구분 | 내용 |
|---|---|
| **git pull + 백엔드 재시작으로 끝** | `app/models.py`, `app/schemas.py`, `app/schema_bootstrap.py`, `app/services/input_presets.py`, `app/routers/presets.py`, `app/routers/analysis.py`, `app/main.py`, `tests/*` — `input_presets` 테이블은 기동 시 `create_all` 로 생성, bootstrap 은 no-op. 신규 pip 의존성 없음. |
| **프론트 재배포 필요** | `src/api/presets.js`, `src/api/analysis.js`, `src/utils/presetHandoff.js`, `src/hooks/usePreset.js`, `src/components/analysis/PresetPicker.jsx`, `src/components/analysis/InputPresetDrawer.jsx`, `src/pages/analysis/MyProjects.jsx`, `src/pages/analysis/JibRestAssessment.jsx`, `src/pages/analysis/ColumnBucklingCalculator.jsx` — `npm run build` 후 Electron `npm run dist`. |
| **InHouse 수동 교체** | 없음. |

후속(범위 밖, 같은 3줄 패턴): Mast Post·D Type Lug·Hole Fatigue·Section Property·Carling×2 페이지에 `PresetPicker` 부착.
