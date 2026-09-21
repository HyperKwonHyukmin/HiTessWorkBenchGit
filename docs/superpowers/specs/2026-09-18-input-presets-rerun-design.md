# 입력 프리셋 + "이전 입력 불러와 수정 후 재실행" — 설계 (Plan C)

- 작성일: 2026-09-18
- 상위 규약: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1(공통 규칙), §2.4(입력 프리셋), §3(실행 순서: 5번째, 의존 없음). 충돌 시 마스터가 우선.
- 대상 저장소: `HiTessWorkBenchBackEnd/`(FastAPI) + `HiTessWorkBench/frontend/`(React). InHouse 프로그램은 건드리지 않는다.

## 1. 배경 — 지금의 `rerun` 은 "그대로 다시" 뿐이다

`POST /api/analysis/{analysis_id}/rerun`(`app/routers/analysis.py:1981-2160`) 은 이력 레코드의
`input_info` 를 **읽기만** 하고, `program_registry.ProgramSpec.rerun_adapter` 로 분기해 원본 입력 파일을
새 작업 폴더로 복사한 뒤 같은 옵션으로 작업을 다시 제출한다.

```python
# app/routers/analysis.py:1995-2014 (발췌)
info = record.input_info if isinstance(record.input_info, dict) else {}
def copy_input(value, work_dir, **kwargs):
    try:
        return _copy_rerun_input(value, work_dir, current_user=current_user, db=db, **kwargs)
    except Exception:
        _cleanup_owned_workspace(work_dir, current_user)
        raise
program_spec = resolve_program(program)
rerun_adapter = program_spec.rerun_adapter if program_spec else None
source = "WorkbenchRerun"
if rerun_adapter == "truss": ...
```

- 파일 입력은 `_copy_rerun_input()`(`analysis.py:1801-1962`) 이 **userConnection 안, 소유자 본인(또는 관리자), 일반 파일, 복사 중 불변** 을 모두 검증하고 복사한다. 만료된 파일은 409.
- 옵션 값은 `info.get("use_nastran")`, `float(info.get("mesh_size") or 200.0)` 처럼 **레코드 값을 그대로** 태스크 인자로 넘긴다(`_rerun_bool`, `analysis.py:1964`).
- `rerun_adapter` 가 없는 프로그램(파라메트릭 계산기, 파생 solve, ModelFlow 등)은 422
  `"이 앱은 저장 파일 기반 재실행을 지원하지 않습니다. 앱에서 입력값을 불러와 새 해석을 시작하세요."` — 그런데 **"앱에서 입력값을 불러오는" 경로가 실제로는 없다.**

프론트 `MyProjects.jsx` 는 재실행 버튼(`:1136-1162`)을 `findAppByProgramName(...)?.supportsRerun`(`:31-33`) 으로만 켜고, 상세 모달(`ProjectDetailModal`, `:264-372`)은 `input_info` 를 **다운로드 행**으로만 보여 준다(`:504-512`, 문자열 값만 렌더 — 숫자·불리언 옵션은 아예 안 보인다).

그래서 사용자는 (a) 메시 크기·안전계수·Nastran 실행 여부 같은 옵션 하나만 바꿔 다시 돌리고 싶을 때도 앱 페이지로 가서 파일을 다시 올려야 하고, (b) 파라메트릭 계산기(Jib Rest 12개 필드 등)는 지난번 값을 손으로 다시 친다.

## 2. 확정 결정

| # | 결정 | 근거 |
|---|---|---|
| D1 | **프리셋 대상 = `ProgramSpec.input_keys` 가 비어 있지 않고 `history_visible=True` 인 프로그램.** 판정 함수는 백엔드 한 곳(`services/input_presets.is_preset_capable`). | 마스터 §2.4. 내부 substep 3종(`module-stability` 등)은 MyProjects 에 안 보이므로 제외. 프론트는 카탈로그 플래그를 새로 만들지 않고 스냅샷 API 응답(`preset_capable`)을 믿는다. |
| D2 | **`rerun` 은 그대로 두고 `POST /api/analysis/{id}/rerun-with` 를 새로 만든다.** body `{"input_info": {...}}` 는 **스칼라 옵션 오버라이드만** 담는다. 파일 입력은 항상 **원본 레코드의 경로에서 `_copy_rerun_input` 으로 복사**하고, 파일 키를 오버라이드하면 422. | 마스터 §2.4 "기존 rerun_adapter 재사용, 파일 입력은 원본 work_dir 에서 복사". 클라이언트가 임의 경로를 넣는 통로를 처음부터 열지 않는다. |
| D3 | 두 엔드포인트는 **같은 디스패치 함수 `_dispatch_rerun(record, info, ...)`** 를 쓴다. `rerun` 은 `info=record.input_info`, `rerun-with` 는 `info={**record.input_info, **overrides}`. | 어댑터 분기 150줄을 복제하지 않는다. `source` 는 둘 다 `"WorkbenchRerun"` 유지(통계 어휘 불변). |
| D4 | **파일 키 / 값 키의 구분은 값으로 판정**한다: 문자열이고 `userConnection/` 안의 경로로 해석되면 파일 키. 레지스트리에 새 필드를 추가하지 않는다. | `input_keys` 는 파일 키만 선언하고(`bdf-scanner` 의 `use_nastran`, `hitess-model-builder` 의 `mesh_size` 등 옵션은 미선언), 프로그램마다 옵션 키가 다르다. 값 기반 판정이면 옵션 키를 열거할 필요가 없다. |
| D5 | **앱별 폼을 재구성하지 않는다.** 공용 `InputPresetDrawer` 가 스냅샷의 값 키를 **타입별 범용 필드**(boolean→체크, number→`CalcInputField`, string→`Input`)로 그린다. | 마스터 §2.4 YAGNI. |
| D6 | **파라메트릭 앱은 `usePreset(programId)` 훅으로 값을 주입**한다. MyProjects 드로어의 "앱에서 열기" 는 `sessionStorage['workbench:preset-handoff']` 에 값을 싣고 `setCurrentMenu(menuName)` 으로 이동, 페이지의 훅이 마운트 시 꺼내 `onApply(values)` 로 넘긴다. `input_info` 키 → 페이지 state 매핑(예: Column Buckling `memberName`→`member_name`)은 **각 페이지의 `onApply` 5줄**이 맡는다. | Dashboard→MyProjects 상세 모달이 이미 쓰는 sessionStorage 핸드오프 패턴(`MyProjects.jsx:675-685`, 키 `workbench:open-project-detail`) 재사용. 파라메트릭 요청 스키마와 저장 키가 다른 앱이 있어(§5.3) 매핑은 페이지 소관. |
| D7 | **계산기 앱의 `input_json` 파일은 스냅샷에서 값으로 인라인**한다(`"calculator" in capabilities` 이고 파일이 JSON object, ≤256KB 일 때). | Jib Rest 는 `input_info={"input_json": <path>}` 로만 저장(`davit_service.py:154`)돼 값이 파일 안에만 있다. 프론트가 파일을 받아 파싱하게 하지 않는다. |
| D8 | **프리셋은 값 키만 저장**한다(파일 경로 금지, 422). `source_analysis_id` 는 non-FK 참조(마스터 §2.4). 프리셋을 파일 앱 레코드에 "적용" 하면 드로어의 값 필드만 채워지고 파일은 그 레코드 것을 쓴다. | 파일은 30일 뒤 만료(`cleanup_service.RETENTION_DAYS`)되므로 프리셋에 담으면 죽은 참조가 된다. |
| D9 | 프리셋은 **개인 소유**(employee_id). 조회·수정·삭제 = 본인 또는 관리자(`_access_control.assert_current_user_can_access_owner`). 공유·부서 프리셋은 범위 밖. | 마스터 §2.7 공유는 Plan G 의 프로젝트 멤버십 한 가지 경로만. |
| D10 | `/api/presets`, `rerun-with` 는 **`GUARDED_ROUTES` 에 등록하지 않는다.** | 플랫폼 공통 기능(마스터 §1-8). 기존 `rerun` 도 미등록. |

## 3. 프리셋 가능 프로그램 (레지스트리 실측, `program_registry.py:94-307`)

| program_id | display_name | capabilities | rerun_adapter | input_keys | 드로어 동작 |
|---|---|---|---|---|---|
| truss-model-builder | TrussModelBuilder | file-analysis, rerun | `truss` | node_csv, member_csv | 수정 후 재실행 |
| truss-assessment | Truss Assessment | file-analysis, rerun, report | `truss-assessment` | bdf_model | 수정 후 재실행(값 키 없음 → 파일만 복사) |
| bdf-scanner | BDF Scanner | file-analysis, rerun | `bdf-scanner` | bdf_model (+옵션 `use_nastran`) | 수정 후 재실행 |
| hp-scr-psa / hp-scr-por | HP-SCR PSA / POR | file-analysis, rerun | `hp-scr` | bdf_model (+옵션 `analysis_mode`) | 수정 후 재실행 |
| f06-parser | F06 Parser | file-analysis, rerun | `f06-parser` | f06_file | 수정 후 재실행 |
| mooring-fitting | MooringFitting | file-analysis, rerun | `mooring-fitting` | structure_csv, load_csv (+옵션 `mf_safety_factor`) | 수정 후 재실행 |
| hitess-model-builder | HiTessModelBuilder | file-analysis, rerun | `model-builder` | stru_csv, pipe_csv, equip_csv (+옵션 mesh_size, ubolt_full_fix, run_nastran, nastran_path, leg_z_tol, mesh_size_structure, mesh_size_pipe) | 수정 후 재실행 |
| simple-beam | Simple Beam Assessment | file-analysis, rerun, report | `simple-beam` | input_json | 수정 후 재실행(input_json 은 파일 키 — 인라인 안 함) |
| group-module-unit | GroupModuleUnit | file-analysis, rerun | `group-module-unit` | bdf_model (+옵션 `use_nastran`) | 수정 후 재실행 |
| side-passage | SidePassage | file-analysis, rerun | `side-passage` | bdf_model (+옵션 `use_nastran`) | 수정 후 재실행 |
| hull-acceleration | 선급 Rule 기반 선체 가속도 Calculation | file-analysis, rerun | `hull-acceleration` | pdf_file, constants, condition_overrides | 수정 후 재실행(세 키 모두 파일) |
| mooring-fitting-solve | MooringFittingSolve | derived-analysis | — | edited_bdf, bdf_model | 프리셋 저장/열람만 |
| model-builder-analysis | ModelBuilderAnalysis | derived-analysis | — | bdf_model, edited_bdf | 프리셋 저장/열람만 |
| hitess-modelflow | HiTessModelFlow | file-analysis | — | stru_file, pipe_file, equip_file | 프리셋 저장/열람만 |
| drawing-to-analysis | DrawingToAnalysis | file-analysis | — | drawing_file, image_file, bdf_model | 프리셋 저장/열람만 |
| plate-structure | PlateStructureAnalysis | file-analysis | — | input_json, bdf_model | 프리셋 저장/열람만 |
| double-pipe-fuel-line | DoublePipeFuelLine | file-analysis | — | input_csv, csv_file | 프리셋 저장/열람만 |
| carling-free / carling-optimization | Carling Free / Design Optimization | calculator, report | — | input_json | 앱에서 열기 |
| column-buckling | Column Buckling Load Calculator | calculator, report | — | input_json | 앱에서 열기 |
| mast-post | Mast Post Assessment | calculator, report | — | input_json | 앱에서 열기 |
| jib-rest | Jib Rest Assessment (1단/2단) | calculator, report | — | input_json | 앱에서 열기 |
| d-type-lug | D Type Lug Assessment | calculator, report | — | input_json | 앱에서 열기 |
| hole-fatigue | Simplified Hole Fatigue Assessment | calculator, report | — | input_json | 앱에서 열기 |
| section-property | Section Property Calculator | calculator, report | — | input_json | 앱에서 열기 |

제외: `independent-tank`, `block-weld`, `heavy-block-lifting`(외부 앱, input_keys 없음), `module-stability`·`module-hoist-optimize`·`unit-structural-analysis`(`history_visible=False`).

⚠ 파라메트릭 계산기의 `input_keys=("input_json",)` 은 **선언과 실제 저장이 다르다**: Mast Post 는 `{"vessel_size","height_mm","weight_kg"}`(`davit_service.py:82-93`), Column Buckling 은 `{"memberName","columnLengthMm"}`(`column_buckling_service.py:47-50, 95`), Jib Rest 만 `{"input_json": <path>}`(`davit_service.py:154`). D4 의 값 기반 판정이 이 차이를 흡수한다 — 레지스트리를 고치지 않는다.

## 4. 데이터 모델

```python
# app/models.py (RegisteredModelRevision 의 non-FK source_analysis_id 관례를 따른다)
class InputPreset(Base):
    """사용자가 이름 붙여 저장한 입력 값 세트. 파일 경로는 담지 않는다(값 키만)."""
    __tablename__ = "input_presets"
    __table_args__ = (
        UniqueConstraint("employee_id", "program_id", "name", name="uq_input_preset_name"),
    )
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(String(50), nullable=False, index=True)
    program_id = Column(String(100), nullable=False, index=True)   # ProgramSpec.program_id
    name = Column(String(100), nullable=False)
    input_info = Column(JSON, nullable=False, default=dict)
    source_analysis_id = Column(Integer, nullable=True, index=True)  # non-FK: 이력이 정리돼도 프리셋은 남는다
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)
```

- 신규 테이블은 `main.initialize_database()` 의 `create_all`(`main.py:66`)로 생긴다. 마스터 §1-3 에 따라
  `schema_bootstrap.ensure_input_preset_columns()` 를 추가하고 `run_schema_bootstrap()`(`schema_bootstrap.py:152-160`)에서 호출한다 — 오늘은 no-op 이지만 이후 컬럼 추가 시 서버(145) 500 을 막는 자리.
- 제약: `name` 1~100자(trim), `input_info` 직렬화 ≤ 64KB, 키 ≤ 100개, 값은 JSON 스칼라(str/int/float/bool/None) 또는 스칼라 배열·1단계 dict(Double Pipe `inner_support_config` 같은 값 dict 허용). **userConnection 경로 문자열은 422.**

## 5. API

### 5.1 `GET /api/analysis/{analysis_id}/input-snapshot` — 드로어의 단일 데이터원

소유자/관리자. 레코드의 `input_info` 를 파일 키 / 값 키로 나눠 돌려준다.

```json
{
  "analysis_id": 1234,
  "program_id": "hitess-model-builder",
  "program_name": "HiTessModelBuilder",
  "preset_capable": true,
  "rerun_editable": true,          // ProgramSpec.rerun_adapter is not None
  "app_openable": false,           // "calculator" in capabilities
  "files_available": true,         // analysis._files_available(record)
  "files":  {"stru_csv": "STRU.csv", "pipe_csv": "PIPE.csv"},   // basename 만 — 절대경로 노출 금지
  "values": {"mesh_size": 200.0, "run_nastran": false, "ubolt_full_fix": false}
}
```

- `preset_capable=False` 면 `files/values` 는 비우고 200 으로 돌려준다(프론트가 버튼을 비활성화하는 근거). 404/403 은 기존 `rerun` 과 같다.
- 계산기 앱(D7): `files.input_json` 이 있고 파일이 JSON object 면 `values` 에 **펼쳐 넣고** `files` 에서 뺀다. 못 읽으면(만료·비 JSON) `files` 에 남기고 `values` 는 빈 dict.
- `values` 에서 `employee_id` 키는 항상 제거한다(요청자 위조 방지, `dependencies.authenticated_employee_id` 와 같은 취지).

### 5.2 `POST /api/analysis/{analysis_id}/rerun-with`

```json
// 요청
{"input_info": {"mesh_size": 150, "run_nastran": true}}
// 응답 200
{"job_id": "...", "source_analysis_id": 1234, "program_name": "HiTessModelBuilder",
 "overridden_keys": ["mesh_size", "run_nastran"], "message": "수정한 입력으로 새 해석 작업을 제출했습니다."}
```

| 상황 | 응답 |
|---|---|
| 레코드 없음 / 남의 레코드 | 404 / 403 (`rerun` 과 동일) |
| `rerun_adapter` 없음 | 422 `"이 앱은 수정 후 재실행을 지원하지 않습니다. 프리셋을 저장한 뒤 앱에서 열어 실행하세요."` |
| 파일 키 오버라이드 (`bdf_model` 등) | 422 `"파일 입력(bdf_model)은 수정할 수 없습니다. 원본 파일이 그대로 복사됩니다."` |
| 값이 dict/list/길이>500 문자열, 키 50개 초과 | 422 |
| 어댑터가 값을 변환하다 실패(`float("abc")`) | 422 `"입력 값 형식이 올바르지 않습니다: ..."` + 만든 작업 폴더 정리 |
| 원본 파일 만료 | 409 (`_copy_rerun_input` 그대로) |

구현: `_dispatch_rerun(record, info, *, current_user, db, source)` 로 기존 분기 본문을 추출. 각 분기의 `make_work_dir` 를 클로저 `open_work_dir(program)` 로 바꿔 마지막에 만든 폴더를 기억해 두고, `(TypeError, ValueError)` 를 잡아 `_cleanup_owned_workspace` 후 422 로 바꾼다. 기존 `test_analysis_rerun.py` 가 `analysis.make_work_dir` 를 monkeypatch 하므로 클로저는 모듈 이름 `make_work_dir` 를 그대로 호출한다.

### 5.3 `/api/presets` CRUD (`app/routers/presets.py`, 로그인 필수)

| 메서드 | 경로 | body / query | 응답 |
|---|---|---|---|
| GET | `/api/presets?program_id=jib-rest` | program_id 선택(없으면 내 전체) | `[{id, program_id, name, input_info, source_analysis_id, created_at, updated_at}]` 이름순 |
| POST | `/api/presets` | `{program_id, name, input_info, source_analysis_id?}` | 201 + 프리셋. 같은 이름 409 `"같은 이름의 프리셋이 이미 있습니다."`, 대상 아님 422 `"이 앱은 프리셋을 지원하지 않습니다."`, 파일 경로 포함 422 |
| PUT | `/api/presets/{id}` | `{name?, input_info?}` 부분 갱신 | 200. 소유자/관리자 아니면 403, 없으면 404 |
| DELETE | `/api/presets/{id}` | — | 204 |

- 응답 목록은 **본인 것만**(관리자도 GET 목록은 본인 것 — 남의 프리셋을 훑는 관리 화면은 범위 밖). PUT/DELETE 는 관리자 허용.
- `program_id` 는 `program_registry.get_program()` 으로 존재 확인. 프론트가 `program_name` 밖에 모를 때는 5.1 응답의 `program_id` 를 쓴다.

## 6. 백엔드 구조

| 파일 | 변경 |
|---|---|
| `app/models.py` | `InputPreset` 추가 |
| `app/schemas.py` | `InputPresetCreate / InputPresetUpdate / InputPresetResponse / RerunWithRequest` |
| `app/schema_bootstrap.py` | `ensure_input_preset_columns()` + `run_schema_bootstrap` 호출 |
| `app/services/input_presets.py` (신규) | 순수 로직: `is_preset_capable(spec)`, `split_input_info(info, base_dir) -> (files, values)`, `inline_calculator_input_json(...)`, `validate_preset_values(values, base_dir)`, `validate_overrides(overrides, files)`. 라우터를 import 하지 않는다. |
| `app/routers/presets.py` (신규) | CRUD, `require_auth`, `assert_current_user_can_access_owner` |
| `app/routers/analysis.py` | `_dispatch_rerun` 추출, `rerun_analysis` 가 위임, `input-snapshot` GET, `rerun-with` POST 추가 |
| `app/main.py` | `presets` import + `include_router(presets.router)` |

## 7. 프론트

| 파일 | 변경 |
|---|---|
| `src/api/presets.js` (신규) | `listPresets(programId)`, `createPreset(payload)`, `updatePreset(id, payload)`, `deletePreset(id)` — `getAuthHeaders()` 사용(`api/appSettings.js` 와 같은 꼴) |
| `src/api/analysis.js` | `getAnalysisInputSnapshot(id)`, `rerunAnalysisWith(id, inputInfo)` (`rerunAnalysisProject`, `:24-30` 옆) |
| `src/utils/presetHandoff.js` (신규, 부수효과 격리) | `PRESET_HANDOFF_KEY='workbench:preset-handoff'`, `writePresetHandoff({programId, values, name})`, `takePresetHandoff(programId)`(5분 TTL, 읽으면 삭제), `coerceFieldValue(kind, raw)` 순수 함수 |
| `src/hooks/usePreset.js` (신규) | `usePreset(programId, { onApply })` → `{ presets, loading, refresh, applyPreset, saveCurrent, removePreset }`. 마운트 시 `takePresetHandoff(programId)` 가 값을 주면 `onApply(values, meta)` 1회 호출. |
| `src/components/analysis/PresetPicker.jsx` (신규) | 훅을 감싼 한 줄 툴바: `<select>` 프리셋 + "적용" + "현재 값 저장"(이름 입력) + 삭제. 파라메트릭 페이지에서 `<PresetPicker programId="jib-rest" getValues={...} onApply={...} />` 로 사용. |
| `src/components/analysis/InputPresetDrawer.jsx` (신규) | MyProjects 상세 모달에서 여는 공용 편집기(`Modal size="lg"`). 상단 `PresetPicker`(같은 program_id), 파일 목록(읽기 전용, "원본에서 복사"), 값 필드(타입별), 푸터 = `rerun_editable` 이면 "수정한 입력으로 재실행", `app_openable` 이면 "앱에서 열기", 둘 다 아니면 저장만. |
| `src/pages/analysis/MyProjects.jsx` | `ProjectDetailModal` 푸터(`:365-372`)에 "입력 불러와 수정" 버튼(prop `onEditInputs`), 메인 컴포넌트에 `presetDrawerProject` state 와 `<InputPresetDrawer>` 렌더, 제출 성공 시 `handleRerun`(`:742-763`) 과 동일한 후처리(`startGlobalJob` + 토스트 + `workbench:open-job-center`). `useNavigation` import 추가("앱에서 열기"). |
| `src/pages/analysis/JibRestAssessment.jsx` | `PresetPicker` 1개(`programId="jib-rest"`). `onApply(values)`: 1단 키(`EMPTY_1DAN` 의 키, `:189`)와 2단 키(`:190`)로 나눠 `setInputs1dan/setInputs2dan`, `h2` 가 있으면 `setActiveTab('2dan')`. `getValues` = 현재 탭 기준 합친 문자열 dict. |
| `src/pages/analysis/ColumnBucklingCalculator.jsx` | `PresetPicker programId="column-buckling"`. `onApply`: `memberName ?? member_name`, `columnLengthMm ?? length_mm` 를 받아 `setMemberName/setLengthMm`(`:66-67`). 저장 키는 요청 스키마 이름(`member_name`, `length_mm`)으로 통일 — 스냅샷에서 온 camelCase 도 읽을 수 있게 둘 다 본다. |

값 필드 렌더 규칙(`InputPresetDrawer`, 앱별 분기 없음):

| 값 타입 | 컴포넌트 | 비고 |
|---|---|---|
| boolean | 체크박스 | `use_nastran`, `run_nastran`, `ubolt_full_fix` |
| number | `CalcInputField`(`components/ui/CalcInputField.jsx`, `size="sm"`, `allowFormula`) | 문자열로 들고 있다가 제출 시 `Number()` |
| string | `Input` | `analysis_mode`, `nastran_path`, `vessel_size` |
| null | `Input`(빈 값) | 제출 시 빈 문자열이면 키를 보내지 않는다(원본 유지) |
| dict/list | 읽기 전용 `<pre>` JSON | 편집 불가, 프리셋 저장 시 그대로 포함 |

전달 시 원본과 **같은 값인 키는 보내지 않는다**(`overridden_keys` 가 실제 변경분만 담기게). 파라메트릭 "앱에서 열기" 는 `values` 전체를 핸드오프한다.

## 8. 흐름

```
[파일 앱]  MyProjects 행 → 상세 모달 → "입력 불러와 수정"
           → GET /input-snapshot → InputPresetDrawer(파일 읽기전용 + 값 편집 + 프리셋 적용/저장)
           → POST /rerun-with {input_info: 변경분} → startGlobalJob → Job Center

[계산기]   MyProjects 상세 모달 → 드로어(값 편집·프리셋 저장) → "앱에서 열기"
           → sessionStorage handoff → setCurrentMenu(app.menuName)
           → 페이지 usePreset(programId) 가 꺼내 onApply → 사용자가 "계산" 클릭 (자동 실행하지 않는다)

[계산기, 앱 안에서]  PresetPicker: 저장된 프리셋 선택 → 적용 / 현재 값 → 이름 붙여 저장
```

계산기에서 "앱에서 열기" 후 **자동 계산은 하지 않는다** — 사용자가 값을 확인하고 누른다(파라메트릭 요청은 동기 호출이라 즉시 exe 가 돈다).

## 9. 보안·경계

- 스냅샷·rerun-with·프리셋 모두 `require_auth` + 소유자/관리자(`_access_control`).
- 스냅샷의 `files` 는 basename 만. 절대경로는 기존 다운로드 행(`MyProjects.jsx:504-512`)이 이미 노출하지만 새 API 는 늘리지 않는다.
- rerun-with 는 파일 키를 받지 않으므로 `_copy_rerun_input` 의 경로 검증이 유일한 파일 통로로 남는다.
- 프리셋 값에 userConnection 경로 문자열이 섞이면 422 — 프리셋으로 남의 폴더를 가리키는 일이 없다.
- `employee_id` 키는 스냅샷·프리셋·오버라이드 모두에서 제거.

## 10. 테스트

| 파일 | 내용 |
|---|---|
| `tests/test_input_presets_service.py` | `split_input_info`(경로/비경로/`employee_id` 제거), `inline_calculator_input_json`(정상/만료/비 JSON), `validate_preset_values`(경로 422·크기·타입), `validate_overrides`(파일 키 거부), `is_preset_capable`(레지스트리 실측 3종) |
| `tests/test_input_presets_api.py` | CRUD 왕복, 유니크 409, 대상 아님 422, 타인 403·관리자 통과, 목록 program_id 필터, `run_schema_bootstrap(engine=sqlite)` 멱등 |
| `tests/test_analysis_rerun_with.py` | bdf-scanner 레코드로 `use_nastran` 오버라이드가 태스크 인자에 반영, 파일 키 오버라이드 422, 어댑터 없음 422, `mesh_size="abc"` → 422 + 작업 폴더 잔존 없음, 기존 `rerun` 회귀(`test_analysis_rerun.py` 그대로 통과) |
| 프론트 | 러너 없음 → plan 의 수동 검증 절차 |

## 11. 서버(145) 반영

- **`git pull` + 백엔드 재시작으로 끝**(신규 테이블은 `create_all`, bootstrap 은 no-op). 신규 pip 의존성 없음.
- **프론트 재배포 필요**(MyProjects·파라메트릭 페이지·신규 컴포넌트).
- InHouse 프로그램 교체 없음.

## 12. 범위 밖 (하지 않는다)

- 프리셋 공유/부서 공개, 관리자 프리셋 관리 화면, 프리셋 버전 이력.
- 파일 앱의 "파일까지 바꿔 재실행"(그건 앱 페이지의 새 해석).
- 배치 케이스 매트릭스(Plan H), 결과 비교(Plan F).
- 파라메트릭 8개 페이지 전부 `PresetPicker` 부착 — 이번엔 **Jib Rest·Column Buckling 2개**를 파일럿으로 하고, 나머지(Mast Post, D Type Lug, Hole Fatigue, Section Property, Carling×2)는 같은 3줄 패턴으로 후속.
