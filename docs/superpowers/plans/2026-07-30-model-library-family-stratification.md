# Model Library 계열 분류 · Insight 스코프 분리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서로 다른 성질의 모델(Module Unit / Side Passage / Truss)을 계열로 분류하고, Insight 를 「라이브러리 전체」와 「선택 계열」 두 스코프로 갈라 혼합 모집단 통계를 없앤다.

**Architecture:** 새 DB 컬럼을 만들지 않고 기존 `model_type` 컬럼을 통제 어휘(계열)로 승격한다. 등록 시 `source_program_name` + `artifact_kind` 에서 계열을 파생해 자동으로 채우고, 쓰기는 pydantic enum 으로 엄격하게 읽기는 관용적으로 처리한다. Insight 는 기존 순수 함수 `aggregate_registry_insights()` 의 계약을 **전혀 바꾸지 않고**, 신규 순수 함수가 그것을 두 번(전체 / 계열) 호출해 블록을 스코프별로 투영한다.

**Tech Stack:** FastAPI · SQLAlchemy · pydantic v2 · pytest / React 18 · Vite · Tailwind · node:test

**설계 근거:** `docs/superpowers/specs/2026-07-30-model-library-family-stratification-design.md`

---

## 작업 전 필독

**커밋 규칙**
- 커밋 메시지는 한국어로 쓴다(프로젝트 관례). 각 커밋 메시지 **끝에 다음 두 줄을 반드시 붙인다**:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01A4iTHuP1ENKKcQGD47om9n
  ```
- ⚠ **`HiTessWorkBench/frontend/src/config.js` 는 어떤 경우에도 `git add` 하지 않는다.** 개발자가 로컬 백엔드와 팀 서버를 토글하는 로컬 전용 파일이다. 커밋하면 배포 빌드의 기본 백엔드가 개인 PC로 바뀐다.
- `git add` 는 항상 **파일을 명시**한다. `git add -A` / `git add .` 금지.

**테스트 실행 위치**
```powershell
# 백엔드 (HiTessWorkBenchBackEnd 에서)
WorkBenchEnv\Scripts\python.exe -m pytest tests/test_model_family.py -v

# 프론트 순수 함수 (HiTessWorkBench/frontend 에서)
node --test src/utils/modelRegistryUtils.test.js

# 프론트 빌드 검증 (HiTessWorkBench/frontend 에서)
npm run build
```

**배포 단위 경고**
Task 4(백엔드 응답 형태 변경)와 Task 8(프론트 대시보드)은 **같은 배포 단위**다. Task 8 의 대시보드에는 구버전 백엔드(`overall` 없는 평면 응답)에서도 죽지 않는 폴백을 넣는다 — 서버 재시작과 프론트 재배포 순서가 보장되지 않기 때문이다.

---

## 파일 구조

| 파일 | 책임 | 변경 |
|---|---|---|
| `HiTessWorkBenchBackEnd/app/model_registry_schemas.py` | 어휘(enum)·요청/응답 계약 | `ModelFamily` enum, 라벨 맵, `unassigned` 상수 추가. `RegisterRequest`/`ModelPatchRequest`/`PreviewResponse` 타입 변경 |
| `HiTessWorkBenchBackEnd/app/services/model_family.py` | **신규.** 계열 파생 규칙 + 읽기 관용 정규화(순수) | 신규 |
| `HiTessWorkBenchBackEnd/app/services/model_registry_service.py` | 등록 오케스트레이션 | 계열 자동 채움 |
| `HiTessWorkBenchBackEnd/app/services/model_insight_service.py` | Insight 집계 | `build_scoped_overview()` 추가, `build_dataset_readiness` 에 계열 혼재 caveat |
| `HiTessWorkBenchBackEnd/app/routers/model_registry.py` | HTTP 계약 | preview 에 파생 계열, insights 에 `family` 파라미터 |
| `HiTessWorkBench/frontend/src/utils/modelRegistryUtils.js` | 순수 헬퍼 | `MODEL_FAMILIES`, `familyLabel()` |
| `HiTessWorkBench/frontend/src/api/modelRegistry.js` | API 클라이언트 | insights 에 `family` 전달(파라미터 통과라 코드 변경 없음 — 호출부에서 넘긴다) |
| `HiTessWorkBench/frontend/src/components/modelRegistry/ModelRegistrationModal.jsx` | 등록 폼 | 「모델 종류」 자유 입력 → select |
| `HiTessWorkBench/frontend/src/pages/analysis/ModelLibrary.jsx` | 목록·필터·Insight 탭 | 계열 필터, 계열 배지, Insight 계열 상태 |
| `HiTessWorkBench/frontend/src/components/modelRegistry/ModelInsightDashboard.jsx` | Insight 렌더 | 두 스코프 영역으로 재구성(지역 컴포넌트 2개 추가 + 준비도 분할) |
| `docs/apps/model-library.md` | 사용 설명서 | 필드·필터·Insight 절 갱신 |

**왜 대시보드를 별도 파일로 쪼개지 않는가:** `ModelInsightDashboard.jsx` 는 이미 지역 컴포넌트 10여 개(`Card`, `SectionEyebrow`, `DistributionChart`, `MetricRow`, `ShareRow`, `ScaleStat`, `AxisPanel`, `KpiCard` …)를 한 파일에 두는 구조다. 두 스코프 섹션도 **같은 파일의 지역 컴포넌트**로 추가한다 — 공용 프리미티브를 옮기지 않아 diff 가 렌더 구조 변경에만 남는다. 별도 파일 추출은 이 작업의 목적이 아니다.

---

### Task 1: 계열 어휘와 파생 규칙 (순수 함수)

**Files:**
- Create: `HiTessWorkBenchBackEnd/app/services/model_family.py`
- Modify: `HiTessWorkBenchBackEnd/app/model_registry_schemas.py` (line 71~75 `Visibility` 뒤에 추가)
- Test: `HiTessWorkBenchBackEnd/tests/test_model_family.py` (신규)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`HiTessWorkBenchBackEnd/tests/test_model_family.py`:

```python
"""모델 계열(family) 파생 규칙.

가장 중요한 계약: **판정 순서**. SidePassage 는 GroupModuleUnit 과 artifact_kind 를
공유하므로(ARTIFACT_RULES.programs), kind 를 먼저 보면 side-passage 가 사라진다.
"""
from app.model_registry_schemas import (
    UNASSIGNED_FAMILY_KEY,
    ModelFamily,
    SourceArtifactKind,
)
from app.services.model_family import derive_model_family, family_key, family_label


# --------------------------------------------------------------------------- #
# 파생 규칙
# --------------------------------------------------------------------------- #

def test_side_passage_wins_over_shared_module_unit_kind():
    """★ 순서 회귀 테스트 — 이게 깨지면 SidePassage 모델이 전부 module-unit 으로 빨려 들어간다."""
    for kind in (
        SourceArtifactKind.GROUPMODULE_ORIGINAL,
        SourceArtifactKind.MODULE_UNIT_EDITED,
        SourceArtifactKind.MODULE_UNIT_LIFTING,
    ):
        assert derive_model_family("SidePassage", kind) is ModelFamily.SIDE_PASSAGE


def test_modelbuilder_artifacts_are_module_unit():
    for kind in (
        SourceArtifactKind.MODELBUILDER_FINAL,
        SourceArtifactKind.MODELBUILDER_EDITED,
        SourceArtifactKind.MODELBUILDER_SOLVED,
    ):
        assert derive_model_family("HiTessModelBuilder", kind) is ModelFamily.MODULE_UNIT


def test_group_module_and_unit_structural_are_module_unit():
    assert derive_model_family(
        "GroupModuleUnit", SourceArtifactKind.MODULE_UNIT_EDITED,
    ) is ModelFamily.MODULE_UNIT
    assert derive_model_family(
        "UnitStructuralAnalysis", SourceArtifactKind.MODULE_UNIT_LIFTING,
    ) is ModelFamily.MODULE_UNIT


def test_unknown_program_and_kind_fall_back_to_other():
    """조용한 오분류보다 미분류가 낫다 — 부분일치로 넓히지 않는다."""
    assert derive_model_family("SidePassageV2", "some_new_kind") is ModelFamily.OTHER
    assert derive_model_family(None, None) is ModelFamily.OTHER


def test_artifact_kind_accepts_plain_string():
    """DB 에서 읽은 값은 enum 이 아니라 문자열이다."""
    assert derive_model_family(
        "HiTessModelBuilder", "modelbuilder_final",
    ) is ModelFamily.MODULE_UNIT


# --------------------------------------------------------------------------- #
# 읽기 관용 — 어휘 밖 레거시 값
# --------------------------------------------------------------------------- #

def test_family_key_keeps_vocabulary_values():
    assert family_key("module-unit") == "module-unit"
    assert family_key(" side-passage ") == "side-passage"
    assert family_key("other") == "other"


def test_legacy_and_empty_values_are_unassigned_not_other():
    """명시적 '기타'(other)와 미지정을 합치면 통계가 거짓말을 한다."""
    assert family_key("beam-frame") == UNASSIGNED_FAMILY_KEY
    assert family_key("") == UNASSIGNED_FAMILY_KEY
    assert family_key(None) == UNASSIGNED_FAMILY_KEY


def test_family_label_is_human_readable():
    assert family_label("module-unit") == "Module / Group Unit 구조"
    assert family_label("other") == "기타"
    assert family_label(UNASSIGNED_FAMILY_KEY) == "미분류"
    assert family_label(None) == "미분류"
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `WorkBenchEnv\Scripts\python.exe -m pytest tests/test_model_family.py -v`
Expected: FAIL — `ImportError: cannot import name 'UNASSIGNED_FAMILY_KEY'`

- [ ] **Step 3: 어휘를 추가한다**

`app/model_registry_schemas.py` 의 `class Visibility` 정의(line 71~74) **바로 아래**에 추가:

```python
class ModelFamily(str, Enum):
    """모델 계열 — '구조가 무엇인가'.

    ⚠ '어떤 해석인가'(lifting / static)는 이 축이 아니다. 그것은 향후
    RegisteredAnalysisRun.run_kind 의 몫이며, 두 축을 한 필드에 섞으면 되돌릴 수 없다.
    truss 는 아직 등록 경로(SourceArtifactKind)가 없어 어휘에만 예약돼 있다.
    """

    MODULE_UNIT = "module-unit"
    SIDE_PASSAGE = "side-passage"
    TRUSS = "truss"
    OTHER = "other"


MODEL_FAMILY_LABELS: dict[str, str] = {
    ModelFamily.MODULE_UNIT.value: "Module / Group Unit 구조",
    ModelFamily.SIDE_PASSAGE.value: "Side Passage 구조",
    ModelFamily.TRUSS.value: "Truss 구조",
    ModelFamily.OTHER.value: "기타",
}

# 값이 비었거나 어휘 밖인 레거시 model_type 을 담는 집계 버킷.
# 관리자가 명시적으로 고른 'other'(기타)와 절대 합치지 않는다.
UNASSIGNED_FAMILY_KEY = "unassigned"
UNASSIGNED_FAMILY_LABEL = "미분류"
```

- [ ] **Step 4: 파생 규칙 모듈을 만든다**

`app/services/model_family.py` (신규):

```python
"""모델 계열(family) — 파생 규칙과 읽기 관용 정규화.

계열은 '구조가 무엇인가'다. 등록자가 자유 입력하던 값을 통제 어휘로 승격하면서,
**기계가 이미 아는 사실**(원 프로그램 + artifact 종류)에서 기본값을 파생한다.

순수 함수만 둔다 — DB/ORM/파일을 모른다.
"""
from __future__ import annotations

from typing import Any, Optional

from ..model_registry_schemas import (
    MODEL_FAMILY_LABELS,
    UNASSIGNED_FAMILY_KEY,
    UNASSIGNED_FAMILY_LABEL,
    ModelFamily,
    SourceArtifactKind,
)

# 프로그램 이름 → 계열. **정확 일치만** 본다.
# 부분일치로 넓히면 새 프로그램이 조용히 잘못 분류된다 — 조용한 오분류는 미분류보다 나쁘다.
PROGRAM_FAMILIES: dict[str, ModelFamily] = {
    "SidePassage": ModelFamily.SIDE_PASSAGE,
}

# 이 artifact 종류들은 모듈 유닛 구조에서 나온다.
MODULE_UNIT_KINDS = frozenset({
    SourceArtifactKind.MODELBUILDER_FINAL,
    SourceArtifactKind.MODELBUILDER_EDITED,
    SourceArtifactKind.MODELBUILDER_SOLVED,
    SourceArtifactKind.GROUPMODULE_ORIGINAL,
    SourceArtifactKind.MODULE_UNIT_EDITED,
    SourceArtifactKind.MODULE_UNIT_LIFTING,
})


def derive_model_family(program_name: Optional[str], artifact_kind: Any) -> ModelFamily:
    """등록 출처에서 계열을 파생한다.

    ★ **판정 순서가 계약이다. 프로그램 이름을 먼저 본다.**
    SidePassage 는 groupmodule_original / module_unit_edited / module_unit_lifting 을
    GroupModuleUnit 과 공유하므로(ARTIFACT_RULES.programs), kind 를 먼저 보면
    SidePassage 모델이 전부 module-unit 으로 빨려 들어간다.
    """
    mapped = PROGRAM_FAMILIES.get((program_name or "").strip())
    if mapped is not None:
        return mapped

    try:
        kind = SourceArtifactKind(artifact_kind)
    except ValueError:
        kind = None
    if kind is not None and kind in MODULE_UNIT_KINDS:
        return ModelFamily.MODULE_UNIT

    return ModelFamily.OTHER


def family_key(model_type: Optional[str]) -> str:
    """저장된 model_type → 집계 버킷 키.

    **읽기는 관용적이다** — 어휘 밖 레거시 값이나 빈 값을 지우지 않고,
    'other'(명시적 기타)에 섞지도 않고 'unassigned' 로 분리한다.
    """
    value = (model_type or "").strip()
    if value in MODEL_FAMILY_LABELS:
        return value
    return UNASSIGNED_FAMILY_KEY


def family_label(key: Optional[str]) -> str:
    """버킷 키 → 화면 라벨. 모르는 키는 '미분류'."""
    if not key:
        return UNASSIGNED_FAMILY_LABEL
    return MODEL_FAMILY_LABELS.get(key, UNASSIGNED_FAMILY_LABEL)
```

- [ ] **Step 5: 테스트가 통과하는 것을 확인한다**

Run: `WorkBenchEnv\Scripts\python.exe -m pytest tests/test_model_family.py -v`
Expected: PASS — 8 passed

- [ ] **Step 6: 커밋**

```bash
git add HiTessWorkBenchBackEnd/app/model_registry_schemas.py HiTessWorkBenchBackEnd/app/services/model_family.py HiTessWorkBenchBackEnd/tests/test_model_family.py
git commit -m "✨ feat: 모델 계열 어휘와 파생 규칙 추가 (SidePassage 우선 판정)"
```

---

### Task 2: 등록 시 계열 자동 채움 + 통제 어휘 검증

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/model_registry_schemas.py` (line 149, 180, 228~233)
- Modify: `HiTessWorkBenchBackEnd/app/routers/model_registry.py` (line 188~201 preview 응답)
- Modify: `HiTessWorkBenchBackEnd/app/services/model_registry_service.py` (line 468~501)
- Test: `HiTessWorkBenchBackEnd/tests/test_model_registry_api.py` (기존 파일 끝에 추가)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/test_model_registry_api.py` **파일 끝에** 추가(기존 `_seed_source` / `_register` / `switchable_client` / `registry_env` 픽스처를 그대로 쓴다):

```python
# --------------------------------------------------------------------------- #
# 모델 계열(family)
# --------------------------------------------------------------------------- #

def test_api_preview_suggests_family_from_source(
    switchable_client, db_session, registry_env,
):
    """자유 입력이던 「모델 종류」의 기본값을 서버가 정해 준다."""
    a = _seed_source(db_session, registry_env)

    res = switchable_client.post(
        "/api/model-registry/preview",
        json={"source_analysis_id": a.id, "artifact_kind": "modelbuilder_final"},
    )

    assert res.status_code == 200, res.text
    assert res.json()["suggested_model_type"] == "module-unit"


def test_api_registration_fills_family_when_omitted(
    switchable_client, db_session, registry_env,
):
    """미지정으로 등록해도 파생값이 저장된다 — 신규 등록본에 미분류가 남지 않는다."""
    a = _seed_source(db_session, registry_env)

    uid = _register(switchable_client, a.id).json()["model_uid"]

    detail = switchable_client.get(f"/api/model-registry/models/{uid}").json()
    assert detail["model_type"] == "module-unit"


def test_api_registration_rejects_value_outside_vocabulary(
    switchable_client, db_session, registry_env,
):
    """쓰기는 엄격하다 — model_role 과 같은 pydantic enum 검증 경로를 탄다."""
    a = _seed_source(db_session, registry_env)

    res = _register(switchable_client, a.id, model_type="beam-frame")

    assert res.status_code == 422, res.text


def test_api_patch_rejects_value_outside_vocabulary(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    res = switchable_client.patch(
        f"/api/model-registry/models/{uid}", json={"model_type": "beam-frame"},
    )

    assert res.status_code == 422, res.text


def test_api_patch_accepts_vocabulary_value(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    res = switchable_client.patch(
        f"/api/model-registry/models/{uid}", json={"model_type": "truss"},
    )

    assert res.status_code == 200, res.text
    # ★ enum 이 아니라 문자열 값이 저장되어야 한다 ('ModelFamily.TRUSS' 가 아니다)
    assert res.json()["model_type"] == "truss"


def test_api_legacy_value_outside_vocabulary_is_still_readable(
    switchable_client, db_session, registry_env,
):
    """읽기는 관용적이다 — 어휘 밖 레거시 값이 있어도 목록·상세가 200 이어야 한다."""
    a = _seed_source(db_session, registry_env)
    uid = _register(switchable_client, a.id).json()["model_uid"]

    row = (
        db_session.query(registry_models.RegisteredModel)
        .filter(registry_models.RegisteredModel.model_uid == uid)
        .first()
    )
    row.model_type = "beam-frame"          # 옛 자유 입력 값을 직접 심는다
    db_session.commit()

    assert switchable_client.get("/api/model-registry/models").status_code == 200
    detail = switchable_client.get(f"/api/model-registry/models/{uid}")
    assert detail.status_code == 200
    assert detail.json()["model_type"] == "beam-frame"   # 지우지 않는다
```

파일 상단 import 절에 ORM 모델 접근이 없다면 다음 한 줄을 추가한다(이미 있으면 생략):

```python
from app import models as registry_models
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `WorkBenchEnv\Scripts\python.exe -m pytest tests/test_model_registry_api.py -k family -v`
Expected: FAIL — `suggested_model_type` KeyError, 등록 시 `model_type` 이 `None`, 어휘 밖 값이 422 대신 201

- [ ] **Step 3: 스키마 타입을 바꾼다**

`app/model_registry_schemas.py`:

1. `RegisterRequest` (line 149) — `model_type: Optional[str] = Field(default=None, max_length=100)` 를 다음으로 교체:

```python
    model_type: Optional[ModelFamily] = None      # 미지정이면 서버가 출처에서 파생한다
```

2. `ModelPatchRequest` (line 180) — 같은 줄을 다음으로 교체:

```python
    model_type: Optional[ModelFamily] = None
```

3. `PreviewResponse` (line 228~233) — 필드 하나를 추가:

```python
class PreviewResponse(BaseModel):
    source: SourceInfo
    summary: dict[str, Any]
    available_artifacts: list[AvailableArtifact]
    duplicate: Optional[DuplicateInfo] = None
    warnings: list[str] = Field(default_factory=list)
    # 등록 모달의 「모델 종류」 기본값. 제목 초안과 같은 성격의 '서버가 제안하는 값'이다.
    suggested_model_type: Optional[ModelFamily] = None
```

> ⚠ **응답 스키마(`ModelListItem` / `RevisionResponse` / `ModelDetailResponse`)의 `model_type` 은 `str` 그대로 둔다.** enum 으로 바꾸면 어휘 밖 레거시 값이 직렬화 단계에서 터진다(§3.3 읽기 관용).

- [ ] **Step 4: preview 응답에 파생 계열을 싣는다**

`app/routers/model_registry.py`:

1. import 절(`from ..services.model_registry_service import ...` 블록 아래, line 48 뒤)에 추가:

```python
from ..services.model_family import derive_model_family
```

2. `preview_registration` 의 `return PreviewResponse(...)`(line 188~201) 에 인자 한 줄 추가:

```python
        duplicate=duplicate,
        warnings=warnings,
        suggested_model_type=derive_model_family(
            resolved.program_name, resolved.artifact_kind,
        ),
    )
```

- [ ] **Step 5: 등록 시 계열을 채운다**

`app/services/model_registry_service.py`:

1. import 절에 추가:

```python
from .model_family import derive_model_family
```

2. line 468 `if model is None:` **바로 앞**에 계열 결정 블록을 삽입한다:

```python
    # 계열: 요청 → (기존 모델 유지) → 출처에서 파생.
    # 신규 등록본에 미지정이 남지 않게 하는 것이 목적이다.
    if request.model_type is not None:
        family_value = request.model_type.value
    elif model is not None and model.model_type:
        family_value = model.model_type
    else:
        family_value = derive_model_family(
            resolved.program_name, resolved.artifact_kind,
        ).value

    if model is None:
```

3. 모델 생성 인자(line 473) 를 교체:

```python
            model_type=family_value,
```

4. summary `model_meta` 의 `modelType`(line 494) 을 교체:

```python
            "modelType": family_value,
```

- [ ] **Step 6: 테스트가 통과하는 것을 확인한다**

Run: `WorkBenchEnv\Scripts\python.exe -m pytest tests/test_model_registry_api.py -v`
Expected: PASS — 신규 6건 포함 전부 통과. 기존 `test_api_..._filters` 의 `total(model_type="beam-frame") == 0` 도 통과한다(목록 **필터** 파라미터는 여전히 자유 문자열이다).

- [ ] **Step 7: 커밋**

```bash
git add HiTessWorkBenchBackEnd/app/model_registry_schemas.py HiTessWorkBenchBackEnd/app/routers/model_registry.py HiTessWorkBenchBackEnd/app/services/model_registry_service.py HiTessWorkBenchBackEnd/tests/test_model_registry_api.py
git commit -m "✨ feat: 등록 시 모델 계열 자동 채움 + 통제 어휘 검증"
```

---

### Task 3: Insight 스코프 투영 함수 (순수)

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/services/model_insight_service.py` (import 절, `build_dataset_readiness` caveats, 파일 끝에 신규 함수)
- Test: `HiTessWorkBenchBackEnd/tests/test_model_insight_service.py` (파일 끝에 추가)

> ★ **기존 25건은 한 줄도 수정하지 않는다.** `aggregate_registry_insights` / `build_dataset_readiness` / `describe` 의 계약을 건드리지 않는 것이 이 설계의 목적이다. 기존 테스트가 깨지면 구현이 틀린 것이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/test_model_insight_service.py` **파일 끝에** 추가:

```python
# --------------------------------------------------------------------------- #
# 스코프 투영 — 전체 통계와 계열 통계는 다른 질문에 답한다
# --------------------------------------------------------------------------- #

def test_scoped_overview_puts_each_block_in_exactly_one_scope():
    """전체 전용 블록과 계열 전용 블록이 양쪽에 동시에 나타나면 안 된다."""
    result = build_scoped_overview([_revision()])

    assert set(result["overall"]) == {
        "totals", "distributions", "topTags", "recentTrend", "dataHygiene",
    }
    assert set(result["family"]) == {
        "metrics", "qualityIssues", "qualityByOutcome", "datasetReadiness",
    }


def test_scoped_overview_defaults_to_largest_family():
    revisions = [
        _revision(model_uid="u1", model_type="module-unit"),
        _revision(model_uid="u2", model_type="module-unit"),
        _revision(model_uid="u3", model_type="side-passage"),
    ]

    result = build_scoped_overview(revisions)

    assert result["scope"]["family"] == "module-unit"
    assert result["scope"]["familyCount"] == 2
    assert result["scope"]["sampleSize"] == {"overall": 3, "family": 2}


def test_scoped_overview_keeps_overall_totals_when_family_selected():
    """계열을 골라도 상단은 전체 모집단이다 — 스코프가 섞이지 않는다."""
    revisions = [
        _revision(model_uid="u1", model_type="module-unit", node_count=100),
        _revision(model_uid="u2", model_type="side-passage", node_count=900),
    ]

    result = build_scoped_overview(revisions, family="side-passage")

    assert result["overall"]["totals"]["revisions"] == 2
    assert result["family"]["metrics"]["nodeCount"]["sampleSize"] == 1
    assert result["family"]["metrics"]["nodeCount"]["max"] == 900


def test_scoped_overview_unknown_family_returns_empty_scope_not_error():
    result = build_scoped_overview([_revision()], family="truss")

    assert result["scope"]["family"] == "truss"
    assert result["family"]["metrics"]["nodeCount"]["sampleSize"] == 0
    assert result["family"]["metrics"]["nodeCount"]["mean"] is None


def test_scoped_overview_separates_unassigned_from_explicit_other():
    """명시적 '기타'와 어휘 밖 레거시 값을 한 버킷에 담으면 통계가 거짓말을 한다."""
    revisions = [
        _revision(model_uid="u1", model_type="other"),
        _revision(model_uid="u2", model_type="beam-frame"),   # 옛 자유 입력
        _revision(model_uid="u3", model_type=None),
    ]

    keys = {f["key"]: f["count"] for f in build_scoped_overview(revisions)["families"]}

    assert keys == {"unassigned": 2, "other": 1}


def test_scoped_overview_hygiene_and_readiness_go_to_different_scopes():
    result = build_scoped_overview([_revision()])

    hygiene = result["overall"]["dataHygiene"]
    readiness = result["family"]["datasetReadiness"]

    assert hygiene["features"]           # 피처 커버리지 = 데이터 위생 → 전체
    assert "extractorVersion" in hygiene
    assert readiness["tasks"]            # 학습 과제 표본 → 계열
    assert "features" not in readiness   # 중복 노출 금지
    assert "split" not in readiness


def test_scoped_overview_returns_null_family_for_empty_registry():
    result = build_scoped_overview([])

    assert result["family"] is None
    assert result["families"] == []
    assert result["overall"]["totals"]["revisions"] == 0


def test_readiness_warns_when_families_are_pooled():
    """라우터를 거치지 않는 직접 호출에서도 침묵하지 않는다."""
    revisions = [
        _revision(model_uid="u1", model_type="module-unit"),
        _revision(model_uid="u2", model_type="side-passage"),
    ]

    caveats = " ".join(build_dataset_readiness(revisions)["caveats"])

    assert "계열" in caveats
```

같은 파일 상단의 import 절(line 13~18)에 두 이름을 추가한다:

```python
from app.services.model_insight_service import (
    aggregate_registry_insights,
    build_dataset_readiness,
    build_export_rows,
    build_scoped_overview,
    describe,
)
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `WorkBenchEnv\Scripts\python.exe -m pytest tests/test_model_insight_service.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_scoped_overview'`

- [ ] **Step 3: 계열 혼재 caveat 를 추가한다**

`app/services/model_insight_service.py`:

1. import 절(line 19~24) 아래에 추가:

```python
from .model_family import family_key, family_label
```

2. `build_dataset_readiness` 안, `unique_models` 관련 caveat 블록(line 410~415) **바로 뒤**에 추가:

```python
    family_keys = {family_key(r.get("model_type")) for r in revisions}
    if len(family_keys) > 1:
        caveats.append(
            f"서로 다른 계열 {len(family_keys)}종이 함께 집계되어 있습니다 — "
            "계열이 다르면 형상·하중 특성이 달라, 한 학습 표본으로 섞으면 "
            "계열을 맞히는 모델이 됩니다."
        )
```

- [ ] **Step 4: 스코프 투영 함수를 만든다**

`app/services/model_insight_service.py` 의 `build_dataset_readiness` 정의가 끝난 직후(`# export` 구분선 앞)에 삽입:

```python
# --------------------------------------------------------------------------- #
# 스코프 투영 — '라이브러리 전체' 와 '이 계열' 은 다른 질문이다
# --------------------------------------------------------------------------- #
#
# 블록마다 올바른 스코프가 하나로 정해진다. 개수·분포·데이터 위생은 전체에서만 의미가 있고
# (계열별로 쪼개면 라이브러리 상태를 볼 수 없다), 연속값의 중심경향·비율·교차표·학습 표본은
# 계열 안에서만 의미가 있다(혼합 모집단에서는 평균이 거짓말을 하고 교차표는 역전된다).
#
# ★ 기존 aggregate_registry_insights() 의 계약은 건드리지 않는다. 두 번 호출해 투영만 한다.
#   대가로 버릴 블록도 계산하지만 전부 순수 파이썬 카운팅이며, 규모가 커지면 여기가 손댈 자리다.

OVERALL_BLOCKS = ("totals", "distributions", "topTags", "recentTrend")
FAMILY_BLOCKS = ("metrics", "qualityIssues", "qualityByOutcome")

# datasetReadiness 에서 전체 스코프로 올려 보내는 키(= 데이터 위생).
HYGIENE_KEYS = ("features", "split")


def family_distribution(revisions: list[dict]) -> list[dict]:
    """계열별 revision 수. **실제 존재하는 계열만** 낸다(0 을 채우지 않는다).

    정렬은 (건수 내림, 키 오름) 으로 결정적이다 — 첫 항목이 기본 선택 계열이 된다.
    """
    counter = Counter(family_key(r.get("model_type")) for r in revisions)
    ordered = sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))
    return [
        {"key": key, "label": family_label(key), "count": count}
        for key, count in ordered
    ]


def build_scoped_overview(
    revisions: list[dict], *, family: Optional[str] = None,
) -> dict:
    """Insight 응답 — 전체 스코프와 계열 스코프를 각각 계산해 나란히 낸다.

    family 를 주지 않으면 **건수 최다 계열**을 고르고, 무엇을 골랐는지 scope.family 로
    항상 되돌려 준다(첫 렌더가 요청 1번으로 끝나고 빈 카드가 생기지 않는다).
    존재하지 않는 계열 키를 주면 오류가 아니라 **빈 계열 스코프**를 낸다 —
    표본 0 을 정직하게 0 으로 내는 기존 태도와 같다.
    """
    families = family_distribution(revisions)
    selected = family if family is not None else (families[0]["key"] if families else None)

    overall_agg = aggregate_registry_insights(revisions)
    overall = {key: overall_agg[key] for key in OVERALL_BLOCKS}
    overall_readiness = overall_agg.get("datasetReadiness") or {}
    overall["dataHygiene"] = {
        "extractorVersion": overall_readiness.get("extractorVersion"),
        "features": overall_readiness.get("features") or [],
        "split": overall_readiness.get("split"),
    }

    family_rows: list[dict] = []
    family_block = None
    if selected is not None:
        family_rows = [r for r in revisions if family_key(r.get("model_type")) == selected]
        family_agg = aggregate_registry_insights(family_rows)
        family_block = {key: family_agg[key] for key in FAMILY_BLOCKS}
        family_readiness = family_agg.get("datasetReadiness") or {}
        family_block["datasetReadiness"] = {
            key: value
            for key, value in family_readiness.items()
            if key not in HYGIENE_KEYS
        }

    return {
        "scope": {
            "family": selected,
            "familyLabel": family_label(selected) if selected else None,
            "familyCount": len(families),
            "sampleSize": {"overall": len(revisions), "family": len(family_rows)},
        },
        "families": families,
        "overall": overall,
        "family": family_block,
    }
```

- [ ] **Step 5: 테스트가 통과하는 것을 확인한다**

Run: `WorkBenchEnv\Scripts\python.exe -m pytest tests/test_model_insight_service.py -v`
Expected: PASS — 기존 25건 + 신규 8건 전부 통과. **기존 테스트를 하나라도 수정했다면 되돌린다.**

- [ ] **Step 6: 커밋**

```bash
git add HiTessWorkBenchBackEnd/app/services/model_insight_service.py HiTessWorkBenchBackEnd/tests/test_model_insight_service.py
git commit -m "✨ feat: Insight 스코프 투영 — 전체 통계와 계열 통계 분리"
```

---

### Task 4: Insight 엔드포인트에 계열 파라미터 연결

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/routers/model_registry.py` (line 53~56 import, line 487~498)
- Test: `HiTessWorkBenchBackEnd/tests/test_model_registry_api.py` (파일 끝에 추가)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/test_model_registry_api.py` **파일 끝에** 추가:

```python
def test_api_insights_are_split_into_overall_and_family_scopes(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    _register(switchable_client, a.id)

    body = switchable_client.get("/api/model-registry/insights/overview").json()

    assert body["scope"]["family"] == "module-unit"
    assert body["families"] == [
        {"key": "module-unit", "label": "Module / Group Unit 구조", "count": 1},
    ]
    assert body["overall"]["totals"]["revisions"] == 1
    assert body["family"]["metrics"]["nodeCount"]["sampleSize"] >= 0


def test_api_insights_accept_family_query(
    switchable_client, db_session, registry_env,
):
    a = _seed_source(db_session, registry_env)
    _register(switchable_client, a.id)

    body = switchable_client.get(
        "/api/model-registry/insights/overview", params={"family": "truss"},
    ).json()

    assert body["scope"]["family"] == "truss"
    assert body["scope"]["sampleSize"] == {"overall": 1, "family": 0}
    assert body["overall"]["totals"]["revisions"] == 1     # 상단은 전체 유지
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `WorkBenchEnv\Scripts\python.exe -m pytest tests/test_model_registry_api.py -k insights -v`
Expected: FAIL — `KeyError: 'scope'` (현재는 평면 응답)

- [ ] **Step 3: 라우터를 바꾼다**

`app/routers/model_registry.py`:

1. import 절(line 53~56)을 교체:

```python
from ..services.model_insight_service import (
    build_export_rows,
    build_scoped_overview,
)
```

> `aggregate_registry_insights` 는 이 라우터에서 더 이상 직접 쓰지 않는다(`build_scoped_overview` 가 내부에서 호출한다).

2. `get_insights_overview`(line 487~498)를 교체:

```python
@router.get("/insights/overview")
def get_insights_overview(
    status: str = "active",
    family: str | None = None,
    db: Session = Depends(database.get_db),
    current_user: str = Depends(require_auth),
):
    """등록 모델 통계. 현재 사용자가 볼 수 있는 모델만 집계한다.

    응답은 **두 스코프**로 나뉜다 — `overall`(항상 전체)과 `family`(선택 계열).
    개수·분포·데이터 위생은 전체에서만, 연속값 통계·교차표·학습 표본은 계열 안에서만
    의미가 있기 때문이다. family 를 생략하면 서버가 건수 최다 계열을 고른다.

    표본 수·결측 수를 항상 함께 내며, 표본이 없는 통계는 0 이 아니라 null 이다.
    """
    rows = _visible_revision_rows(db, current_user, status=status)
    return build_scoped_overview(rows, family=family)
```

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

Run: `WorkBenchEnv\Scripts\python.exe -m pytest tests/test_model_registry_api.py -v`
Expected: PASS — 전부 통과

- [ ] **Step 5: 백엔드 전체 회귀를 돌린다**

Run:
```powershell
WorkBenchEnv\Scripts\python.exe -m pytest tests/test_model_family.py tests/test_model_registry_api.py tests/test_model_insight_service.py tests/test_model_feature_service.py tests/test_model_search_service.py tests/test_model_summary_service.py tests/test_model_registry_storage.py tests/test_model_registry_source_resolver.py -v
```
Expected: PASS — 회귀 0건

- [ ] **Step 6: 커밋**

```bash
git add HiTessWorkBenchBackEnd/app/routers/model_registry.py HiTessWorkBenchBackEnd/tests/test_model_registry_api.py
git commit -m "✨ feat: Insight 엔드포인트를 전체/계열 두 스코프로 분리"
```

---

### Task 5: 프론트 계열 어휘와 라벨 헬퍼

**Files:**
- Modify: `HiTessWorkBench/frontend/src/utils/modelRegistryUtils.js` (line 56~59 `VISIBILITY_OPTIONS` 뒤)
- Test: `HiTessWorkBench/frontend/src/utils/modelRegistryUtils.test.js` (파일 끝에 추가)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/utils/modelRegistryUtils.test.js` **파일 끝에** 추가(파일 상단 import 목록에 `MODEL_FAMILIES`, `familyLabel` 을 추가한다):

```js
test('MODEL_FAMILIES 는 백엔드 ModelFamily 어휘와 1:1 이다', () => {
  assert.deepEqual(
    MODEL_FAMILIES.map((f) => f.value),
    ['module-unit', 'side-passage', 'truss', 'other'],
  );
});

test('familyLabel 은 어휘 값을 사람이 읽는 라벨로 바꾼다', () => {
  assert.equal(familyLabel('module-unit'), 'Module / Group Unit 구조');
  assert.equal(familyLabel('other'), '기타');
});

test('familyLabel 은 어휘 밖·빈 값을 미분류로 표시한다', () => {
  // 백엔드 family_key 의 unassigned 규칙과 같은 판정이어야 한다
  assert.equal(familyLabel('beam-frame'), '미분류');
  assert.equal(familyLabel(''), '미분류');
  assert.equal(familyLabel(null), '미분류');
  assert.equal(familyLabel(undefined), '미분류');
});

test('buildListParams 는 계열 필터를 model_type 으로 보낸다', () => {
  const params = buildListParams({ modelType: 'side-passage' });
  assert.equal(params.model_type, 'side-passage');
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `node --test src/utils/modelRegistryUtils.test.js`
Expected: FAIL — `MODEL_FAMILIES is not defined`

- [ ] **Step 3: 어휘와 헬퍼를 추가한다**

`src/utils/modelRegistryUtils.js` 의 `VISIBILITY_OPTIONS` 정의(line 56~59) **바로 뒤**에 추가:

```js
/**
 * 모델 계열 — 백엔드 `ModelFamily` 와 1:1 로 유지한다.
 *
 * 계열은 '구조가 무엇인가'다. '어떤 해석인가'(권상/정적)는 이 축이 아니다.
 * truss 는 아직 등록 경로가 없지만 어휘에 미리 둔다(등록 경로가 생겨도 배포가 갈리지 않게).
 */
export const MODEL_FAMILIES = [
  { value: 'module-unit', label: 'Module / Group Unit 구조' },
  { value: 'side-passage', label: 'Side Passage 구조' },
  { value: 'truss', label: 'Truss 구조' },
  { value: 'other', label: '기타' },
];

const FAMILY_LABELS = Object.fromEntries(MODEL_FAMILIES.map((f) => [f.value, f.label]));

/**
 * 저장된 `model_type` → 표시 라벨.
 *
 * 어휘 밖 레거시 값과 빈 값은 '미분류'다 — 백엔드 `family_key()` 의 unassigned 와 같은 규칙.
 * 관리자가 명시적으로 고른 '기타'(other)와 혼동하지 않게 라벨을 다르게 쓴다.
 */
export function familyLabel(value) {
  const key = String(value ?? '').trim();
  return FAMILY_LABELS[key] ?? '미분류';
}
```

- [ ] **Step 4: 테스트가 통과하는 것을 확인한다**

Run: `node --test src/utils/modelRegistryUtils.test.js`
Expected: PASS — 전부 통과

- [ ] **Step 5: 커밋**

```bash
git add HiTessWorkBench/frontend/src/utils/modelRegistryUtils.js HiTessWorkBench/frontend/src/utils/modelRegistryUtils.test.js
git commit -m "✨ feat: 프론트 모델 계열 어휘와 라벨 헬퍼 추가"
```

---

### Task 6: 등록 모달 — 자유 입력을 계열 select 로

**Files:**
- Modify: `HiTessWorkBench/frontend/src/components/modelRegistry/ModelRegistrationModal.jsx` (line 15~29 import, 95~99 preview, 454~459 필드)

- [ ] **Step 1: import 에 어휘를 추가한다**

`import { ... } from '../../utils/modelRegistryUtils';` 목록(line 15~29)에 `MODEL_FAMILIES` 를 알파벳 순서에 맞춰 추가:

```js
  CONFIDENCE_LEVELS,
  MODEL_FAMILIES,
  MODEL_ROLES,
```

- [ ] **Step 2: preview 결과로 기본값을 채운다**

`runPreview` 안의 `setForm` 호출(line 95~98)을 교체:

```js
      setForm((f) => ({
        ...f,
        title: f.title || suggestTitle(data),
        // 사용자가 이미 고른 값이 있으면 덮어쓰지 않는다.
        modelType: f.modelType || data.suggested_model_type || '',
      }));
```

- [ ] **Step 3: 입력 필드를 select 로 바꾼다**

line 454~459 의 다음 블록:

```jsx
                  <Input
                    label="모델 종류"
                    value={form.modelType}
                    onChange={setField('modelType')}
                    placeholder="예: module-unit"
                  />
```

를 다음으로 교체:

```jsx
                  <Labeled label="모델 종류">
                    <select className={SELECT_CLASS} value={form.modelType} onChange={setField('modelType')}>
                      {/* preview 가 도착하기 전(또는 파생 실패)에는 빈 값이다.
                          비워서 보내면 서버가 출처에서 파생해 채운다 — 미지정으로 남지 않는다. */}
                      {!form.modelType && <option value="">자동 판정</option>}
                      {MODEL_FAMILIES.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </Labeled>
```

- [ ] **Step 4: 빌드로 검증한다**

Run: `npm run build`
Expected: 성공(오류 없음). `Input` import 가 다른 필드에서 계속 쓰이므로 미사용 경고는 나지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add HiTessWorkBench/frontend/src/components/modelRegistry/ModelRegistrationModal.jsx
git commit -m "🚸 ux: 등록 모달 모델 종류를 자유 입력에서 계열 선택으로 변경"
```

---

### Task 7: 목록에 계열 필터와 배지

**Files:**
- Modify: `HiTessWorkBench/frontend/src/pages/analysis/ModelLibrary.jsx` (line 16~24 import, 31~43 상수, 68~72 상태, 91~98 params, 109·119 deps, 192~199 리셋, 268~297 필터 UI, 300~318 칩, 424 배지)

- [ ] **Step 1: import 와 상수를 추가한다**

1. `modelRegistryUtils` import 목록(line 16~24)에 두 이름을 추가:

```js
import {
  MODEL_FAMILIES,
  buildListParams,
  extractApiError,
  familyLabel,
  formatNumber,
  formatUtilization,
  outcomeInfo,
  qualityLabelWithCode,
  utilizationVariant,
} from '../../utils/modelRegistryUtils';
```

2. `STATUS_FILTERS` 정의(line 40~43) 뒤에 추가:

```js
// 계열 필터 — '미지정' 옵션은 두지 않는다. 이 변경 이후 신규 등록본에는 계열이 항상 채워지고,
// SQL exact-match 로는 "null 또는 어휘 밖"을 표현할 수 없다. 미지정 확인은 Insight 에서 한다.
const FAMILY_FILTERS = [
  { value: 'All', label: '전체' },
  ...MODEL_FAMILIES,
];
```

- [ ] **Step 2: 상태와 쿼리에 연결한다**

1. line 72 `const [status, setStatus] = useState('active');` 뒤에 추가:

```js
  const [family, setFamily] = useState('All');
```

2. `buildListParams` 호출(line 91~98)에 계열을 넘긴다:

```js
      const params = buildListParams({
        skip: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
        query: search,
        modelType: family,
        qualityLevel: quality,
        designOutcome: outcome,
        status,
      });
```

3. `fetchModels` 의 deps(line 109)를 교체:

```js
  }, [page, search, family, quality, outcome, status]);
```

4. 페이지 리셋 effect 의 deps(line 119)를 교체:

```js
  useEffect(() => { setPage(1); }, [search, family, quality, outcome, status]);
```

- [ ] **Step 3: 필터 초기화·활성 판정에 포함한다**

`resetFilters`(line 192~197)와 `filtersActive`(line 199)를 교체:

```js
  const resetFilters = () => {
    setSearch('');
    setFamily('All');
    setQuality('All');
    setOutcome('All');
    setStatus('active');
  };

  const filtersActive =
    Boolean(search) || family !== 'All' || quality !== 'All' || outcome !== 'All' || status !== 'active';
```

- [ ] **Step 4: 필터 UI 를 추가한다**

필터 4개가 되므로 그리드 폭과 열 수를 바꾸고 `FilterSelect` 를 하나 더 넣는다.
line 268 의 여는 `div` 를 교체:

```jsx
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:w-[720px] lg:shrink-0 lg:grid-cols-4">
              <FilterSelect
                id="ds-family"
                label="모델 계열"
                value={family}
                onChange={setFamily}
                options={FAMILY_FILTERS}
              />
```

(기존 `ds-quality` / `ds-outcome` / `ds-status` `FilterSelect` 3개는 그대로 그 아래에 둔다.)

- [ ] **Step 5: 적용된 조건 칩에 계열을 추가한다**

line 303 의 검색 칩 바로 뒤에 추가:

```jsx
              {family !== 'All' && (
                <FilterChip
                  label={familyLabel(family)}
                  onClear={() => setFamily('All')}
                />
              )}
```

- [ ] **Step 6: 행 배지를 라벨로 바꾼다**

line 424 의 `{m.model_type || '종류 미지정'}` 를 교체:

```jsx
                            {familyLabel(m.model_type)}
```

- [ ] **Step 7: 빌드로 검증한다**

Run: `npm run build`
Expected: 성공

- [ ] **Step 8: 수동 확인**

백엔드를 띄운 상태에서 Model Library 를 열고:
- 「모델 계열」 필터를 바꾸면 목록이 필터링되고 1페이지로 되돌아간다
- 행의 종류 표시가 `module-unit` 같은 원값이 아니라 `Module / Group Unit 구조` 로 보인다
- 계열 선택 후 「초기화」를 누르면 전체로 돌아온다

- [ ] **Step 9: 커밋**

```bash
git add HiTessWorkBench/frontend/src/pages/analysis/ModelLibrary.jsx
git commit -m "✨ feat: Model Library 목록에 계열 필터와 계열 배지 추가"
```

---

### Task 8: Insight 대시보드를 두 스코프 영역으로

**Files:**
- Modify: `HiTessWorkBench/frontend/src/pages/analysis/ModelLibrary.jsx` (Insight 상태·fetch·props)
- Modify: `HiTessWorkBench/frontend/src/components/modelRegistry/ModelInsightDashboard.jsx` (렌더 구조)

- [ ] **Step 1: 페이지에 Insight 계열 상태를 만든다**

`ModelLibrary.jsx`:

1. line 80 `const [insightError, setInsightError] = useState(null);` 뒤에 추가:

```js
  // Insight 하단(계열 스코프)에서 보고 있는 계열. null 이면 서버가 최다 계열을 고른다.
  const [insightFamily, setInsightFamily] = useState(null);
```

2. Insight fetch effect(line 122~140)의 요청과 deps 를 교체:

```js
        const res = await getRegistryInsights(
          insightFamily ? { status, family: insightFamily } : { status },
          { signal: controller.signal },
        );
```

```js
  }, [tab, status, insightFamily]);
```

3. 대시보드 호출(line 240~244)에 계열 props 를 넘긴다:

```jsx
          <ModelInsightDashboard
            data={insights}
            loading={insightState === 'loading'}
            error={insightError}
            onFamilyChange={setInsightFamily}
          />
```

- [ ] **Step 2: 대시보드가 두 스코프를 읽게 한다**

`ModelInsightDashboard.jsx` 의 시그니처와 구조 분해(line 54~72)를 교체:

```jsx
export default function ModelInsightDashboard({ data, loading, error, onFamilyChange }) {
  if (loading) return <FeedbackState variant="loading" title="통계를 계산하는 중…" />;
  if (error) return <FeedbackState variant="error" title="통계를 불러오지 못했습니다" message={error} />;
  if (!data) return null;

  // 구버전 백엔드(평면 응답)에서도 죽지 않게 한다 — 서버 재시작과 프론트 재배포 순서는
  // 보장되지 않는다. 그때는 전체 스코프만 렌더하고 계열 영역은 접힌다.
  const overall = data.overall ?? data;
  const familyScope = data.family ?? null;
  const families = data.families ?? [];
  const scope = data.scope ?? null;

  const { totals, distributions, topTags, recentTrend, dataHygiene } = overall;

  if (!totals?.revisions) {
    return (
      <FeedbackState
        variant="empty"
        title="집계할 모델이 없습니다"
        message="모델이 등록되면 분포와 통계가 여기에 표시됩니다."
      />
    );
  }

  return (
    <div className="space-y-6">
      <LibraryOverviewSection
        totals={totals}
        distributions={distributions}
        topTags={topTags}
        recentTrend={recentTrend}
        dataHygiene={dataHygiene}
        sampleSize={scope?.sampleSize?.overall ?? totals.revisions}
      />
      <FamilyInsightSection
        family={familyScope}
        families={families}
        scope={scope}
        onFamilyChange={onFamilyChange}
      />
    </div>
  );
}
```

- [ ] **Step 3: 전체 스코프 섹션을 만든다**

같은 파일에서, 위 `export default` 함수 **바로 뒤**에 지역 컴포넌트를 추가한다.
기존 렌더에서 다음 블록을 **잘라서** 이 컴포넌트의 반환값으로 옮긴다.

| 옮길 기존 블록 | 위치(변경 전) |
|---|---|
| `{/* ── 1. 읽는 법 ── */}` | line 76~83 |
| `{/* ── 2. 라이브러리 규모 ── */}` | line 85~94 |
| `{/* ── 3. 핵심 — 두 개의 독립된 축 ── */}` | line 96~160 |
| `{/* ── 7. 부가 정보 ── */}` | line 288~340 |

```jsx
/**
 * 상단 — 라이브러리 현황. **항상 전체 모집단**이다.
 *
 * 개수·분포·데이터 위생은 계열을 섞어도 왜곡되지 않고, 오히려 계열별로 쪼개면
 * "라이브러리가 어떤 상태인가"를 볼 수 없다. 그래서 이 영역에는 계열 선택기가 없다.
 */
function LibraryOverviewSection({ totals, distributions, topTags, recentTrend, dataHygiene, sampleSize }) {
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <Boxes size={15} className="text-slate-400" /> 라이브러리 현황
        </h3>
        {/* 스코프를 라벨로 못박는다 — 한 화면에 두 모집단이 있으므로 오독을 막아야 한다 */}
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
          전체 {formatNumber(sampleSize)}건
        </span>
      </div>

      {/* ↓ 여기에 기존 블록 1·2·3·7 을 그대로 옮긴다 (JSX 내용 변경 없음) */}

      {dataHygiene && <DataHygieneSection hygiene={dataHygiene} />}
    </section>
  );
}
```

`distributions.modelType` 을 「부가 정보」 그리드의 첫 카드로 추가한다(계열 분포는 전체 스코프에서만 의미가 있다). line 292 의 「원 프로그램」 카드 **앞**에 삽입:

```jsx
          <Card icon={Split} title="모델 계열" caption="서로 다른 성질의 모델이 각각 몇 건인지">
            <DistributionChart
              rows={distributions.modelType}
              colorFor={(_, i) => COLORS[i % COLORS.length]}
              labelFor={(k) => familyLabel(k)}
            />
          </Card>
```

그리고 그 그리드의 열 수를 4개로 바꾼다(line 291):

```jsx
        <div className="mt-2 grid gap-4 lg:grid-cols-4">
```

`familyLabel` 을 import 에 추가한다(파일 상단 `modelRegistryUtils` import 목록):

```js
  familyLabel,
```

- [ ] **Step 4: 계열 스코프 섹션을 만든다**

`LibraryOverviewSection` 뒤에 추가한다. 기존 렌더에서 다음 블록을 **잘라서** 옮긴다.

| 옮길 기존 블록 | 위치(변경 전) |
|---|---|
| `{/* ── 4. 수치 요약 ── */}`(metrics 표 `Card` 전체) | line 161~199 |
| `{/* ── 5. 품질 이슈 빈도 · 교차표 ── */}` | line 201~281 |
| `{/* ── 6. 데이터셋 준비도 ── */}` | line 283~286 |

```jsx
/**
 * 하단 — 계열별 특성. **선택된 한 계열의 모집단**이다.
 *
 * 연속값의 평균·중앙값, 결함 비율, 교차표, 학습 표본은 계열이 섞이면 의미를 잃는다
 * (혼합 모집단에서 평균은 거짓말을 하고 교차표는 Simpson's paradox 로 역전된다).
 * 그래서 이 영역은 항상 계열 하나로 좁혀서 본다.
 */
function FamilyInsightSection({ family, families, scope, onFamilyChange }) {
  if (!family) {
    return (
      <section>
        <FeedbackState
          variant="empty"
          title="계열별 통계를 표시할 수 없습니다"
          message="백엔드가 계열 스코프를 제공하지 않습니다. 서버를 최신 버전으로 재시작하세요."
        />
      </section>
    );
  }

  const { metrics, qualityIssues, qualityByOutcome, datasetReadiness } = family;
  const selected = scope?.family ?? '';
  const count = scope?.sampleSize?.family ?? 0;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <Split size={15} className="text-slate-400" /> 계열별 특성
        </h3>
        <div className="flex items-center gap-2">
          {/* 계열이 1종이면 고를 것이 없다 — 선택기를 감추고 무엇을 보고 있는지만 밝힌다 */}
          {families.length > 1 ? (
            <select
              value={selected}
              onChange={(e) => onFamilyChange?.(e.target.value)}
              aria-label="계열 선택"
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
            >
              {families.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label} ({f.count})
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[11px] font-semibold text-slate-600">
              {scope?.familyLabel ?? familyLabel(selected)}
            </span>
          )}
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
            {formatNumber(count)}건
          </span>
        </div>
      </div>

      <p className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-500">
        <Split size={13} className="shrink-0 text-slate-400" aria-hidden="true" />
        아래 통계는 위 라이브러리 현황과 **모집단이 다릅니다** — 선택한 계열({formatNumber(count)}건)만 집계합니다.
      </p>

      {/* ↓ 여기에 기존 블록 4·5·6 을 그대로 옮긴다 (JSX 내용 변경 없음) */}
    </section>
  );
}
```

- [ ] **Step 5: 데이터셋 준비도를 두 조각으로 나눈다**

`DatasetReadinessSection`(line 349~431) 에서 **「학습 입력 후보 커버리지」 카드(line 363~396)를 잘라내** 새 `DataHygieneSection` 으로 옮긴다. 준비도 쪽에는 「라벨 가용성」(398~402)과 「과제별 착수 가능성」(405~428)만 남는다.

> ⚠ **현재 UI 에는 `split`(분할 누수) 카드가 없다.** 백엔드는 `split_report()` 로 계산하는데 화면에 한 번도 노출되지 않았다. 위생 블록을 만드는 이번 기회에 함께 낸다 — 아래 코드에 포함돼 있다.

1. `DatasetReadinessSection` 정의 **바로 앞**에 새 컴포넌트를 추가한다:

```jsx
/**
 * 데이터 위생 — 스키마·결측·분할 누수. **계열과 무관하므로 전체 스코프에 둔다.**
 *
 * "이 계열의 표본이 몇 건인가"(준비도)와 "우리 데이터가 깨끗한가"(위생)는 다른 질문이다.
 * 후자는 계열별로 쪼개면 오히려 라이브러리 전체의 결측 상태를 볼 수 없다.
 */
function DataHygieneSection({ hygiene }) {
  const { features = [], split, extractorVersion } = hygiene;
  if (!features.length && !split) return null;

  return (
    <div>
      <SectionEyebrow
        icon={ClipboardCheck}
        title="데이터 위생"
        hint={extractorVersion ? `추출기 v${extractorVersion} · 전체 기준` : '전체 기준'}
      />
      <div className="mt-2 grid gap-4 lg:grid-cols-2">
        {/* ↓ 기존 line 363~396 의 「학습 입력 후보 커버리지」 Card 를 그대로 옮긴다 (내용 변경 없음) */}

        <Card
          icon={Grid3x3}
          title="분할 누수 검증"
          caption="같은 모델의 revision 이 학습·검증 양쪽에 들어가면 성능이 부풀려집니다."
        >
          {split ? (
            <div className="space-y-1.5 text-xs leading-relaxed text-slate-600">
              <p>
                {split.folds} fold · 서로 다른 모델{' '}
                <b className="tabular-nums text-slate-800">{formatNumber(split.distinctModels)}</b>개
              </p>
              <p className={split.leakageFree ? 'text-emerald-700' : 'text-red-700'}>
                {split.leakageFree
                  ? '겹치는 모델 없음 — 누수 없이 분할할 수 있습니다.'
                  : `겹치는 모델 ${formatNumber(split.groupOverlap)}건 — 분할을 다시 만들어야 합니다.`}
              </p>
            </div>
          ) : (
            <p className="py-6 text-center text-xs text-slate-500">
              서로 다른 모델이 2개 이상일 때 계산됩니다.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
```

2. `DatasetReadinessSection` 에서 위생 조각을 뺀다.

구조 분해(line 350~352)에서 `features` 를 제거:

```jsx
  const {
    sampleSize, distinctModels, labels, tasks = [], caveats = [], note,
  } = readiness;
```

「학습 입력 후보 커버리지」 카드를 옮긴 뒤 남은 「라벨 가용성」 카드는 2열 그리드가 필요 없다 —
감싸던 `<div className="mt-3 grid gap-4 lg:grid-cols-2">`(line 362)를 다음으로 바꾼다:

```jsx
      <div className="mt-3">
```

3. `ClipboardCheck` 아이콘을 파일 상단 `lucide-react` import 에 추가한다.

- [ ] **Step 6: 빌드로 검증한다**

Run: `npm run build`
Expected: 성공. 미사용 변수 경고가 나오면(예: 옮긴 뒤 남은 `metrics` 참조) 해당 참조를 정리한다.

- [ ] **Step 7: 수동 확인 (이 Task 의 핵심 검증)**

백엔드를 재시작한 뒤 Model Library → Insight 탭:
- 상단 「라이브러리 현황」에 `전체 N건` 배지가 보이고 계열 분포 카드가 있다
- 하단 「계열별 특성」에 계열 선택기(2종 이상일 때)와 `M건` 배지가 보인다
- 계열을 바꾸면 하단만 갱신되고 **상단 총계는 그대로**다
- 빈 카드나 "계열을 선택하세요" 안내가 **없다**

- [ ] **Step 8: 커밋**

```bash
git add HiTessWorkBench/frontend/src/pages/analysis/ModelLibrary.jsx HiTessWorkBench/frontend/src/components/modelRegistry/ModelInsightDashboard.jsx
git commit -m "✨ feat: Insight 를 라이브러리 현황·계열별 특성 두 스코프로 재구성"
```

---

### Task 9: 문서 갱신과 최종 검증

**Files:**
- Modify: `docs/apps/model-library.md` (§5.1 등록 필드표, §5.2 필터, §5.7 Insight, §9 체크리스트)

- [ ] **Step 1: 등록 필드표를 고친다**

§5.1 의 표에서 「모델 종류」 행을 교체:

```markdown
   | 모델 종류 | | **계열 선택**(Module/Group Unit · Side Passage · Truss · 기타). 비워 두면 서버가 원 프로그램·산출물 종류에서 자동 판정한다 |
```

- [ ] **Step 2: 필터 설명을 고친다**

§5.2 의 필터 줄을 교체:

```markdown
- 필터: **모델 계열** / 품질 등급 / 설계 결과 / 상태(사용 중·삭제됨)
```

- [ ] **Step 3: Insight 절을 고친다**

§5.7 의 표 위에 다음 문단을 추가하고, 표의 블록을 스코프별로 갈라 적는다:

```markdown
Insight 는 **두 스코프**로 나뉜다. 개수·분포·데이터 위생은 계열을 섞어도 의미가 있지만,
연속값의 평균·비율·교차표·학습 표본은 계열이 섞이면 의미를 잃기 때문이다(혼합 모집단에서
평균은 거짓말을 하고 교차표는 역전된다).

| 스코프 | 블록 |
|---|---|
| **라이브러리 현황(항상 전체)** | `totals` · `distributions`(계열·원 프로그램·품질·설계 결과·단위) · `topTags` · `recentTrend` · `dataHygiene`(피처 커버리지 · 분할 누수 검증) |
| **계열별 특성(선택 계열)** | `metrics` · `qualityIssues` · `qualityByOutcome` · `datasetReadiness`(표본·라벨·코호트) |

`GET /insights/overview?family=` 를 생략하면 서버가 **건수 최다 계열**을 고르고, 무엇을 골랐는지
`scope.family` 로 되돌려 준다. 존재하지 않는 계열 키는 오류가 아니라 **빈 계열 스코프**(표본 0)로 온다.
값이 비었거나 어휘 밖인 레거시 `model_type` 은 `other`(명시적 '기타')와 섞지 않고 `unassigned`(미분류)
버킷으로 분리된다.
```

- [ ] **Step 4: 확장 체크리스트에 계열을 추가한다**

§9 의 목록에 항목을 추가:

```markdown
- **새 계열 추가** → ① `ModelFamily` enum ② `MODEL_FAMILY_LABELS` ③ `model_family.PROGRAM_FAMILIES`
  또는 `MODULE_UNIT_KINDS` 파생 규칙 ④ 프론트 `MODEL_FAMILIES` ⑤ `tests/test_model_family.py`.
  ⚠ 파생 규칙에서 **프로그램 이름 판정이 artifact_kind 판정보다 먼저**여야 한다(SidePassage 가
  kind 를 GroupModuleUnit 과 공유한다).
```

- [ ] **Step 5: 전체 테스트를 돌린다**

Run (HiTessWorkBenchBackEnd):
```powershell
WorkBenchEnv\Scripts\python.exe -m pytest tests/ -q
```
Expected: PASS — 회귀 0건

Run (HiTessWorkBench/frontend):
```powershell
node --test src/utils/modelRegistryUtils.test.js
npm run build
```
Expected: 둘 다 성공

- [ ] **Step 6: 커밋**

```bash
git add docs/apps/model-library.md
git commit -m "📝 docs: Model Library 계열 분류·Insight 두 스코프 문서 갱신"
```

---

## 스펙과 다르게 처리한 것 (의도적)

- **스펙 §5.4 의 `build_cohort(..., family=None)` 인자 추가는 하지 않는다.** 호출자가 없다 —
  `build_scoped_overview()` 가 계열 필터링을 직접 하므로 이 인자는 아무도 쓰지 않는 죽은 파라미터가 된다.
  계열 코호트를 실제로 소비하는 곳(ML 배치·export)이 생기면 그때 그 요구에 맞춰 추가한다(YAGNI).
- **`split`(분할 누수 검증) 카드는 이번에 새로 만든다.** 스펙은 이 블록을 '전체 스코프로 이동'이라고
  적었지만, 실제 UI 에는 해당 카드가 아예 없었다(백엔드만 계산 중). 위생 블록을 만드는 김에 노출한다.

## 배포 메모

- **DB 마이그레이션 없음.** 새 컬럼도 새 테이블도 없다 — `schema_bootstrap` 을 손대지 않는다.
- **InHouse exe 교체 없음.** `git pull` + 백엔드 재시작 + 프론트 재배포로 끝난다.
- Task 4(응답 형태 변경)와 Task 8(대시보드)은 **한 배포 단위**다. 다만 Task 8 의 폴백 덕분에
  프론트가 먼저 올라가도 Insight 상단은 렌더되고 하단만 안내로 대체된다.
- 기존 등록본은 `model_type` 이 비었거나 어휘 밖이면 목록에서 `미분류`로 보인다.
  관리자가 상세 모달에서 계열을 지정하면 정리된다(로컬 registry 기준 1건).

## 잔여 리스크 (구현 후에도 남는 것)

1. **유사 검색에 계열 게이트가 없다** — 계열이 달라도 규모·요소구성이 비슷하면 추천된다.
   계열 값이 채워지면 `Dimension("modelType")`(가중치 0.10)이 skip 되지 않고 작동해 **부분적으로만** 완화된다.
2. `list_models()` 의 전량 메모리 로딩은 그대로다(문서 §7-11).
3. `build_scoped_overview` 는 `aggregate_registry_insights` 를 두 번 호출한다. 등록 건수가 수천 건이 되면
   블록별 계산 분리가 필요하다.
4. 계열이 잘못 파생된 채 등록되면 통계가 조용히 어긋난다 — 목록·상세의 계열 배지가 유일한 방어다.
