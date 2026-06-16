# Studio 파이프라인 표준 (Studio Pipeline Standard)

> WorkBench의 모든 **Studio형 해석 워크플로우**(ModelBuilder · MooringFitting · SidePassage · ModuleUnit …)가
> 따라야 하는 **공통 절차·프로그램·데이터 계약**을 단계별로 정의한다.
>
> **작성 목적**
> 1. 각 Studio가 단계마다 어떤 InHouse 프로그램 / 엔드포인트 / 파일 포맷을 쓰는지 **명시**해,
>    studio 간 절차·프로그램이 **상이해지는 위험(divergence)** 을 가시화한다.
> 2. **신규 Studio 생성 시 참조 표준**으로 사용한다.
> 3. CLAUDE.md 의 서술과 충돌하면 **이 문서가 코드 검증 결과로 우선**한다(아래 모든 항목은 실제 소스 `파일:라인` 기준 검증, 2026-06-16).
>
> **이 문서의 사용법**: §1 표준 단계 → §2 Model Builder 레퍼런스 구현 → §3 프로그램 총괄 →
> §4 데이터 계약 → §5 머신 분리 패턴 → §6 **Studio 비교 매트릭스(신규 studio 채우는 곳)** → §7 함정 → §8 신규 studio 체크리스트.

---

## 1. 표준 파이프라인 개관 — 모든 Studio가 따르는 단계

```
[S0] 입력 업로드 + 작업 폴더 생성   (WorkBench 프론트 → 백엔드 라우터)
        │  POST .../request  (multipart: 입력파일 + 옵션)
        ▼
[S1] 입력 검증 + 모델 빌드          (백엔드 서비스 → 엔진 .exe)
        │  엔진 exe: <검증/감사> + <빌드> 를 한 번에
        ▼
[S2] 산출물 수집                     (phase JSON/BDF + audit/summary + 최종 산출물)
        │  stdout 의 "출력 폴더:" 라인으로 output_dir 확정
        ▼
[S3] Studio 설치/실행 + 폴더 전달    (프론트 → viewer 매니페스트/다운로드 → Electron 실행)
        │  output_dir(또는 로컬 추출본) 을 initialFolder 로 주입
        ▼
[S4] Studio 로드                     (host.getInitialFolder → phase JSON 파싱 → stage model)
        ▼
[S5] 편집                            (edit intent 생성 + 검증)
        ▼
[S6] 편집 저장                       (*_edit.json 작성) + 머신 분리 시 백엔드로 업로드
        │  POST .../upload-edit  (백엔드≠사용자PC 일 때만)
        ▼
[S7] 편집 적용                       (apply-edit: 엔진 exe → 미지원 intent 는 Python fallback)
        │  POST .../apply-edit
        ▼
[S8] 최종 BDF/JSON 출력              (edited/ 폴더에 <base>.bdf + <base>.json + apply-trace.json)
        ▼
[S9] (선택) Nastran 해석 + F06 파싱   (nastran.exe → F06Parser → _results.json + _SC*_*.csv)
```

각 단계는 **3가지를 반드시 고정**해야 한다 → 그래야 studio 간 비교가 가능하다:
- **(a) 어떤 프로그램**(InHouse exe / Python / 외부)을 **어느 경로**에서 실행하는가
- **(b) 어떤 엔드포인트 / IPC** 로 트리거되는가
- **(c) 어떤 파일 포맷 / 계약**(stdout 라인, 파일명 규칙, JSON 스키마, exit 코드)을 주고받는가

---

## 2. Model Builder — 레퍼런스 구현 (단계별)

> 진입 페이지: **`HiTessWorkBench/frontend/src/pages/analysis/HiTessModelBuilder.jsx`**
> (라우팅: `App.jsx` `case 'HiTESS Model Builder'` — ⚠️ `HiTessModelFlow.jsx` 라는 파일은 **없다**. CLAUDE.md 표 부정확.)
> 백엔드 오케스트레이터: **`HiTessWorkBenchBackEnd/app/services/hitess_modelflow_service.py`**
> 라우터: **`app/routers/analysis.py`** (§ "HiTESS Model Builder", line 2295~)

### S0. 입력 업로드 + 작업 폴더 생성
- **트리거**: 프론트 `handleRunModelBuilder()` → `POST /api/analysis/modelflow/request` (multipart `FormData`).
- **업로드 파일**: `stru_file`(필수) · `pipe_file`(선택) · `equip_file`(선택).
- **옵션(폼 필드)**: `employee_id`, `mesh_size`(기본 300), `ubolt_full_fix`(기본 true), `run_nastran`(기본 true).
  - 백엔드는 추가로 `mesh_size_structure` / `mesh_size_pipe` / `nastran_path` / `leg_z_tol` 도 받지만 **현재 UI 는 노출 안 함**.
- **작업 폴더**: `make_work_dir(employee_id, "HiTessModelBuilder")` →
  `HiTessWorkBenchBackEnd/userConnection/{timestamp}_{employee_id}_HiTessModelBuilder/`
  업로드 파일은 `save_upload()` 로 이 폴더에 저장.
- **응답**: `{ job_id }` → 프론트는 `GET /api/analysis/status/{job_id}` 를 **1.5초 간격** 폴링.

### S1. 입력 검증 + 모델 빌드 (엔진 exe)
- **서비스**: `task_execute_modelflow()` (modelflow_service.py:78).
- **프로그램**: **`InHouseProgram/HiTessModeBuilder/Cmb.Cli.exe`**
  (경로는 라우터가 `_BACKEND_DIR/InHouseProgram/HiTessModeBuilder/Cmb.Cli.exe` 로 고정. ⚠️ 폴더명 `HiTessModeBuilder` — 'l' 빠진 철자가 정상.)
- **명령**:
  ```
  Cmb.Cli.exe build-full --stru <csv> [--pipe <csv>] [--equip <csv>]
                         --mesh-size <MM> [--mesh-size-structure <MM>] [--mesh-size-pipe <MM>]
                         [--ubolt-full-fix] [--run-nastran [--nastran-path <PATH>] [--leg-z-tol <MM>]]
  ```
  - `cwd = work_dir`, `timeout = 1200s(20분)`.
- **입력 검증은 빌드 엔진(C#) 내부에서** 수행되어 `00_InputAudit.json` 으로 산출된다(별도 검증 프로그램 없음 — **빌드 exe 1개가 검증+빌드 통합**).
- **exit 코드 계약**: `1 = 산출물 없음(실패)`, `0/2 = 산출물 작성 OK`.

### S2. 산출물 수집 + output_dir 확정
- **output_dir 확정 규칙**(핵심 계약):
  1. stdout 에서 정규식 `^(?:출력\s*폴더|폴더)\s*[:：]\s*(.+)$` 로 **`출력 폴더: <path>`** 라인을 캡처(`_parse_output_dir`).
  2. 못 찾으면 work_dir 에서 `yyyyMMdd_HHmmss` 패턴 폴더 중 **mtime 최신** 으로 폴백(`_scan_latest_timestamp_dir`).
  → **엔진 exe 는 반드시 stdout 첫 줄에 출력 폴더 라인을 찍어야 한다.**
- **산출 폴더 구조**: `output_dir = userConnection/.../yyyyMMdd_HHmmss/`
  - **phase 파일**: `00_InputAudit.json`, `00_StageSummary.json`, `NN_*.json` / `NN_*.bdf`
    (정규식 `^\d{2}_[A-Za-z]+\.(json|bdf)$` 로 식별).
  - **최종 산출물**: `<designName>.json` / `<designName>.bdf`
    (`_pick_final_artifact` = phase 정규식에 **안 맞는** 최신 파일 — 도면번호로 시작하는 designName 오탐 방지).
- **DB 기록**: `record_analysis(program_name="HiTessModelBuilder", ...)`, status 결과를 job 에 반영(`output_dir/audit_path/summary_path/bdf_path/json_path`).

### S3. Studio 설치/실행 + 폴더 전달
- **뷰어 id**: `VIEWER_ID = 'model-studio'`. (Studio 패키지: `ModelBuilderStudio/apps/model-studio`, `package.json` 의 `name = "hitess-model-studio"`.)
- **매니페스트**: `GET /api/viewers/manifest/model-studio` → `{ manifest:{version,…}, size, downloadUrl, sha256, [uncPath] }`.
  - 백엔드 `viewers.py` 의 `_find_zip` 이 후보 폴더(**로컬 `<backend>/StudioProgram` + UNC**)를 우선순위로 스캔, **첫 폴더의 최고 버전** zip 을 서빙.
  - ⚠️ size/sha256/본문은 **전부 `read()` 한 바이트 기준**(회사 DRM at-rest 암호화로 인한 `ERR_CONTENT_LENGTH_MISMATCH` 회피 — `os.path.getsize`/`FileResponse` 금지).
- **설치/실행(Electron IPC)** — 프론트 `launchAlgorithmViewer()`:
  1. `viewer:check-installed` → 로컬 설치/버전 확인.
  2. 버전 불일치면 `viewer:install { downloadUrl, uncPath, expectedSha256 }` → 사용자 PC 에 설치.
  3. `viewer:checkPathAccess { path: output_dir }` → 사용자 PC 가 백엔드 output_dir 를 직접 fs 로 읽을 수 있는지 검사.
  4. **접근 불가**(백엔드≠사용자PC)면 `viewer:fetchResultDir { downloadUrl: GET /api/analysis/modelflow/result-zip?output_dir=… }`
     → zip 다운로드 후 **로컬 temp 폴더에 추출**, 그 경로를 `initialFolder` 로 사용.
  5. `viewer:open { viewerId, initialFolder }` → Studio 실행.

### S4. Studio 로드 (phase JSON → stage model)
> Studio 측 파일: `model-studio/src/{host/host.js, App.jsx, data/fileLoader.js, data/StageData.js, store/useStageStore.js}`
- **호스트 추상화**(`host.js`): `detectHost()` 가 `window.workbenchAPI` 유무로 **`ElectronHost`**(WorkBench) / **`WebHost`**(브라우저 단독) 선택.
- **부트스트랩**(`App.jsx`): 마운트 시 `getHost().getInitialFolder()`
  - Electron: `window.workbenchAPI.getInitialFolder()` → `{ folderRef, files[] }`(파일은 `{name, content}` → `{name, text()}` 로 매핑).
  - Web: `null`(수동 "폴더 열기" 로 `webkitdirectory` 사용) → no-op.
  - 이어서 `useStageStore.loadStages(files)`.
- **파싱/분류**(`fileLoader.loadFiles`): 파일명 선두 정수로 정렬 → UTF-8 BOM 제거 → 분류:
  - `00_InputAudit.json` → `InputAuditData`
  - `00_StageSummary.json` → `StageSummaryData`
  - phase JSON(`Array.isArray(json.nodes) && Array.isArray(json.elements)`) → `StageData`
  - 후처리 `applyFinalGroupMapping(stages)`.
- **StageData 보유 필드**(데이터 계약, §4.1): `nodeMap`, `elements`, `rigids`, `properties`, `materials`,
  `pointMasses`, `connectivity`, `healthMetrics`, `diagnostics`, `groups`, `propertyMap`, `materialMap`.
  좌표는 `getNodePos` 에서 `(coord - center)/1000` 으로 **mm→m + 센터링** 변환.

### S5. 편집 (edit intents)
> Studio 측 파일: `model-studio/src/{data/EditIntent.js, store/useEditStore.js, data/applyEditIntents.js}`
- **유효 intent 종류**(`VALID_KINDS`): **`addRigid` · `deleteGroup` · `deleteRigid`**.
- **intent 형태**: `{ id, kind, createdAt, params, validation:{status,warnings[],errors[]} }`.
  - `addRigid.params`: `{ independentNode, dependentNodes[], remark?, cm? }` (cm = DOF 코드 1~6, 중복 불가).
  - `deleteGroup.params`: `{ groupId, memberNodeCount? }` (groupId 는 **builderId 계약**, 화면 인덱스 아님).
  - `deleteRigid.params`: `{ rigidId, reason? }` (`reason:'mergeRigid'` = RBE 병합으로 흡수된 경우).
- **검증**(`validateIntent`): `error` → 거부, `warning` → 확인 후 저장, `ok` → 자동 저장.
  (예: addRigid 의 node 존재성·self-loop 금지·cm 포맷, deleteGroup 의 RBE 단절 경고, 중복 intent 에러.)

### S6. 편집 저장 (*_edit.json) + (필요시) 업로드
- **저장**(`SavePanel.jsx` → `useEditStore.exportToFile()`):
  - 파일명 규칙: **`{sourceFileName}_edit.json`** (예: `06_Validation.json` → `06_Validation_edit.json`).
    소스명 없으면 `edit-intent_{phase}_{timestamp}.json`.
  - 우선순위 쓰기: ① `host.writeFile(folderRef, …)`(Electron=`workbenchAPI.writeFile`, Web=FS Access API)
    → ② `showSaveFilePicker` → ③ 브라우저 download.
- **마무리 신호**: `getHost().finalizeEditedModel(folderRef, request)` →
  `window.workbenchAPI.finalizeEditedModel`(레거시 `finalModelOutput`/`requestFinalModelOutput` 폴백).
  request: `{ action, viewerId, editFileName, stageFileName, stageRef, intentCount, closeStudio, openValidationTab }`.
- **WorkBench 측 처리**(`HiTessModelBuilder.jsx` 의 `modelflow:finalize-edit-request` 핸들러):
  - initialFolder 가 **로컬 추출본**(S3-4)이면, 로컬 `*_edit.json` 을 읽어
    **`POST /api/analysis/modelflow/upload-edit`** (`target_dir`=백엔드 output_dir, `file`=*_edit.json) 로 백엔드에 먼저 올린다.
    (`upload-edit` 는 파일명이 `_edit.json` 으로 끝나야 하고 경로 구분자 금지.)
  - initialFolder 가 **백엔드 output_dir 자체**(같은 머신/접근 가능)면 Studio 가 직접 그 폴더에 써서 업로드 생략 가능.

### S7. 편집 적용 (apply-edit)
- **트리거**: `POST /api/analysis/modelflow/apply-edit` `{ output_dir, strict }` → `task_execute_apply_edit()`.
- **기본 경로**: **`Cmb.Cli.exe apply-edit-intent <output_dir> [--strict]`** (`cwd=output_dir`, `timeout=600s`).
  - `detect_edit_json` 이 폴더 안 **최신 `*_edit.json`** 자동 선택.
  - **exit 코드 계약**: `0=성공`, `2=intents 빔/없음`, `64/65/70=실패`.
  - 산출: `output_dir/edited/<base>.bdf` + `<base>.json` + `apply-trace.json`.
- **★ Python fallback**(modelflow_service.py:550~): **exit==65 AND `*_edit.json` 에 `deleteRigid` 포함 AND 로그에 "unsupported intent kind"** 인 경우에 한해
  → `InHouseProgram/NastranBridge/nastran_bridge.py` 의 `write_edited_model_outputs()` 로 edited BDF/JSON 생성(Cmb.Cli 가 모르는 신규 intent 를 Python 이 처리).
  - ⚠️ `_load_nastran_bridge_module()` 은 **`InHouseProgram/NastranBridge`(camelCase) 만 하드코딩, 폴백 없음**. nastran_bridge.py 는 반드시 이 폴더에 둘 것.
  - ⚠️ **편집 BDF 포맷은 writer 별로 다르다**: 일반 편집(Cmb.Cli) BDF 의 포맷 버그는 **C# 엔진**에서, deleteRigid fallback BDF 의 포맷 버그는 **nastran_bridge.py** 에서 고쳐야 한다. (예: PBEAML 단면 타입 `Channel→CHAN` 매핑은 양쪽에 각각 존재 — §7 참조.)

### S8. 최종 BDF/JSON 출력
- `detect_edited_artifacts(output_dir)` 가 `edited/` 에서 `<base>.bdf` / `<base>.json` / `apply-trace.json` 수집.
- 프론트는 `GET /api/analysis/modelflow/edit-status?output_dir=…` 로
  `has_edit_json` / `has_edited` / `needs_apply`(편집본이 최신 `_edit.json` 보다 오래됐는지) / `apply_trace_path` / `edited_json_path` 등을 받아 후속 동작 결정.

### S9. (선택) Nastran 해석 + F06 파싱
`task_execute_apply_edit` 가 `run_nastran=True`(기본) 일 때 **편집 BDF 에 대해 자동 체인**:
1. **`_run_nastran_on_bdf`**: 외부 **MSC `nastran.exe`** (기본 `C:\MSC.Software\MSC_Nastran\20131\bin\nastran.exe`, `--nastran-path` override).
   명령 `nastran.exe <bdf> scr=yes old=no batch=no` (cwd=BDF 폴더, timeout 1800s) → `.f06/.op2/.log`.
2. **`_run_f06parser`**: **`InHouseProgram/F06Parser/F06Parser.Console.exe <f06> --output-dir <dir>`** (timeout 300s)
   → `<stem>_results.json` + `<stem>_SC*_*.csv`.
3. **`scan_f06_diagnostics`**: F06 의 `*** USER/SYSTEM FATAL|ERROR` 마커를 별도 수집(edit-status 응답에 포함).

---

## 3. 사용 프로그램 총괄 (Model Builder)

| 단계 | 프로그램 | 경로 | 종류 | git 추적 | 서버(145) 반영 |
|------|----------|------|------|----------|----------------|
| S1 빌드 / S7 apply-edit 기본 | **Cmb.Cli.exe** | `InHouseProgram/HiTessModeBuilder/Cmb.Cli.exe` | C# exe(엔진) | ❌(gitignore) | **수동 교체 + 백엔드 재시작** |
| S7 fallback(deleteRigid 등) | **nastran_bridge.py** | `InHouseProgram/NastranBridge/nastran_bridge.py` | Python | ❌ | **수동 교체 + 재시작** |
| S9 결과 파싱 | **F06Parser.Console.exe** | `InHouseProgram/F06Parser/F06Parser.Console.exe` | C# exe | ❌ | **수동 교체 + 재시작** |
| S9 해석기 | **nastran.exe** | `C:\MSC.Software\MSC_Nastran\20131\bin\` | 외부 MSC | — | **MSC 설치 필요**(InHouse 아님) |
| S3 뷰어 | **model-studio*.zip** | `<backend>/StudioProgram/` + UNC | Studio(React) zip | ❌ | **zip 수동 복사** |

- **엔진 C# 소스**(작업 위치): `WorkBenchSubModule/HiTessModelBuilder/` (`HiTessModelBuilder.sln`, `Cmb.*`).
- **Studio 소스**(작업 위치): `WorkBenchSubModule/ModelBuilderStudio/apps/model-studio/`.
- **nastran_bridge 소스**: `WorkBenchSubModule/Nastran_bridge/nastran_bridge.py` (underscore) ↔ 배포본 `InHouseProgram/NastranBridge/`(camelCase). **양쪽 동기 필수.**
- 🔔 **InHouseProgram/ 은 `.gitignore` 대상 → `git pull` 로 서버에 절대 안 따라온다.** 변경 시 커밋 보고에 "서버 수동 교체 대상 + 재시작 필요"를 **항상 명시**.

---

## 4. 핵심 데이터 계약 (Data Contracts)

### 4.1 phase JSON (`NN_*.json`, build-full 산출 → Studio StageData)
```jsonc
{
  "meta": { "phase": "C", "stageName": "C_Final", "timestamp": "yyyyMMdd_HHmmss", "unit": "mm", "schemaVersion": "1.1" },
  "nodes":      [ { "id": 1, "x": 0, "y": 0, "z": 0, "tags": [] } ],
  "elements":   [ { "id": 100, "type": "BEAM", "startNode": 1, "endNode": 2, "category": "Structure", "propertyId": 1 } ],
  "rigids":     [ { "id": 100, "independentNode": 1, "dependentNodes": [2], "remark": "UBOLT" } ],
  "properties": [ /* PBEAML/PBEAM/PBAR … (kind, dims, materialId) */ ],
  "materials":  [ /* MAT1 (E, nu, rho) */ ],
  "pointMasses":[ /* CONM2 (nodeId, mass) */ ],
  "connectivity": { "groups": [ { "elementIds": [], "nodeIds": [] } ] },
  "healthMetrics": { "totals": { "bbox": {} } }, "diagnostics": [], "trace": []
}
```
- 식별 키: `Array.isArray(nodes) && Array.isArray(elements)` → phase stage 로 판정.

### 4.2 edit intent envelope (`*_edit.json`, Studio 작성 → apply-edit 입력)
```jsonc
{
  "schemaVersion": "1.0",
  "stageRef":  { "phase": "C", "stageName": "C_Final", "sourceTimestamp": "yyyyMMdd_HHmmss" },
  "createdAt": "ISO-8601",
  "createdBy": "viewer",
  "intents": [
    { "id": "...", "kind": "addRigid",
      "params": { "independentNode": 3, "dependentNodes": [4], "remark": "UBOLT", "cm": "123" },
      "validation": { "status": "ok", "warnings": [], "errors": [] } },
    { "id": "...", "kind": "deleteRigid", "params": { "rigidId": 100, "reason": "mergeRigid" } },
    { "id": "...", "kind": "deleteGroup", "params": { "groupId": 0, "memberNodeCount": 4 } }
  ]
}
```
- 파일명: `{phase파일명}_edit.json`. 백엔드 `detect_edit_json` 이 폴더 내 최신본 자동 선택.

### 4.3 apply-trace.json (apply-edit 산출, 적용 내역)
`{ schemaVersion, appliedAt, intentFile, baseStage, intents[], operations[], summary, [fallback:"nastran_bridge"] }`
(fallback 키가 있으면 Python 경로로 적용됐다는 표식.)

### 4.4 엔진 stdout 계약
- build-full: 첫 줄에 **`출력 폴더: <abs path>`**(또는 `폴더:`, 한글 콜론 허용) 필수.
- exit: build-full `1=실패 / 0,2=OK`; apply-edit-intent `0=성공 / 2=빔 / 64,65,70=실패`.

---

## 5. 머신 분리 패턴 (백엔드 ≠ 사용자 PC) — **모든 Studio 공통 필수**

백엔드와 사용자 PC 가 **다른 머신**일 수 있으므로, 파일을 양방향으로 옮기는 표준 2엔드포인트가 있다:

| 방향 | 엔드포인트 | 용도 |
|------|-----------|------|
| 백엔드 → 사용자 PC | `GET .../result-zip?output_dir=` | output_dir 전체를 zip 으로 받아 **로컬 추출 → Studio initialFolder** |
| 사용자 PC → 백엔드 | `POST .../upload-edit` (`target_dir`, `file`) | 로컬에서 작성된 `*_edit.json` 을 **백엔드 output_dir 로 업로드** → apply-edit 가 읽음 |

- 판정: 프론트가 `viewer:checkPathAccess(output_dir)` 로 직접 접근 가능 여부 확인 → 불가 시 위 우회 사용.
- 보안: 모든 경로는 `_validate_userconnection_path`(userConnection 외부 차단) + `assert_current_user_can_access_path`.

---

## 6. Studio 비교 매트릭스 — **신규 Studio 추가 시 채우는 표**

> ✅ = 코드 검증 완료, ⬜ = 미확인(해당 studio 작업 시 채울 것). **divergence 가 한눈에 보이도록 모든 칸을 채운다.**

| 단계 / 항목 | **ModelBuilder** (레퍼런스) | MooringFitting | SidePassage | ModuleUnit |
|------|------|------|------|------|
| 진입 페이지 | ✅ `HiTessModelBuilder.jsx` | ⬜ | ⬜ | ⬜ |
| viewer id | ✅ `model-studio` | ⬜ | ⬜ | ⬜ |
| S1 빌드 exe | ✅ `Cmb.Cli.exe build-full` @ `InHouseProgram/HiTessModeBuilder` | ⬜ `MooringFitting.exe` | ⬜ | ⬜ |
| S0 request 엔드포인트 | ✅ `POST /api/analysis/modelflow/request` | ⬜ | ⬜ | ⬜ |
| S2 output_dir 계약 | ✅ stdout `출력 폴더:` + phase 정규식 | ⬜ | ⬜ | ⬜ |
| S3 viewer 매니페스트 | ✅ `GET /api/viewers/manifest/{id}`(공통) | 공통 | 공통 | 공통 |
| S5 intent 종류 | ✅ `addRigid/deleteGroup/deleteRigid` | ⬜ | ⬜ | ⬜ |
| S6 *_edit.json 저장 | ✅ `host.writeFile` + finalizeEditedModel | ⬜ | ⬜ | ⬜ |
| S6 업로드 | ✅ `POST .../upload-edit` | ⬜ | ⬜ | ⬜ |
| S7 apply-edit 기본 | ✅ `Cmb.Cli apply-edit-intent` | ⬜ `nastran_bridge.apply_edit_json`(직접) | ⬜ `nastran_bridge`(직접) | ⬜ |
| S7 fallback writer | ✅ `nastran_bridge.write_edited_model_outputs` (exit65+deleteRigid) | ⬜ | ⬜ | ⬜ |
| S8 BDF writer 권위 | ✅ C# `Cmb.Io BdfWriter`(일반) / `nastran_bridge.py`(fallback) | ⬜ | ⬜ `nastran_bridge.py` | ⬜ |
| S9 해석기 | ✅ MSC `nastran.exe` | ⬜ | ⬜ | ⬜ |
| S9 결과 파서 | ✅ `F06Parser.Console.exe` | ⬜ | ⬜ | ⬜ |

> ⚠️ **이 매트릭스가 이 문서의 핵심 산출물**이다. MooringFitting/SidePassage/ModuleUnit 작업 시
> §2 와 같은 단계별 상세를 **각각 추가**하고 이 표의 ⬜ 를 채워, 단계별로 **어떤 프로그램·경로·엔드포인트가 다른지**를 명확히 한다.

---

## 7. 알려진 함정 · 교정 이력 (studio 공통 주의)

1. **InHouse 버전 드리프트**: `WorkBenchSubModule/<Program>` 만 고치고 `InHouseProgram/<Program>` 미반영 시 **dev 는 되고 서버는 깨진다**. 항상 양쪽 동기 + 서버 수동 교체 보고.
2. **폴더명 불일치**: `InHouseProgram` 은 camelCase(`NastranBridge`, `HiTessModeBuilder`), `WorkBenchSubModule` 은 underscore(`Nastran_bridge`) 혼용. modelflow 의 nastran_bridge 로더는 **`NastranBridge` 하드코딩**.
3. **DRM zip(+4096B)**: 로컬 C: 디스크 zip 은 회사 DRM 이 at-rest 암호화 → PowerShell 엔 손상으로 보임(UNC 는 안 걸림). `viewers.py` 는 size/sha256/본문을 **전부 `read()` 바이트**로 서빙해야 `ERR_CONTENT_LENGTH_MISMATCH` 안 남.
4. **PBEAML 단면 타입 `CHANNEL`(무효) → `CHAN`**(2026-06-16 수정): nastran_bridge.py `property_kind_to_bdf` 가 `Channel` 을 `CHANNEL` 로 내보내 HyperMesh import 실패. C# `Cmb.Io BdfWriter.SectionTypeName`(권위 매핑: `Channel→CHAN`)과 일치시킴. **fallback BDF 와 엔진 BDF 의 포맷 수정 위치가 다름**에 유의.
5. **고정필드 실수 포맷**: 8칸 꽉 채움(`real8`) 보다 최단표기(`fixed_real`)가 안전(HyperMesh 호환). 옛 산출물엔 `124.4000` 류가 남아 있을 수 있음(컬럼상 유효하나 비표준).
6. **진입 페이지 명**: Model Builder 는 `HiTessModelBuilder.jsx`(=`HiTessModelFlow.jsx` 아님).

---

## 8. 신규 Studio 생성 체크리스트

- [ ] **S0** request 엔드포인트 + 업로드 파일/옵션 정의, `make_work_dir(employee_id, "<Program>")` 폴더 규칙.
- [ ] **S1** 빌드 exe 경로 확정(`InHouseProgram/<camelCase>/`), CLI 플래그 매핑, exit 코드 계약.
- [ ] **S2** output_dir 확정 방법(stdout 라인) + phase/최종 산출물 식별 규칙.
- [ ] **S3** viewer id 등록 + `StudioProgram/`(로컬) **및** UNC 양쪽 zip 배포 + 매니페스트 read() 서빙.
- [ ] **S4** `host.js`(Electron/Web) + phase JSON 파싱(stage model 필드 계약).
- [ ] **S5** intent 종류/스키마 정의 + 검증 규칙.
- [ ] **S6** `*_edit.json` 파일명 규칙 + `finalizeEditedModel` 신호 + (머신 분리 시) upload-edit.
- [ ] **S7** apply-edit 경로(엔진 직접 vs nastran_bridge 직접 vs fallback) 결정 + BDF writer 권위 위치 명시.
- [ ] **S8/S9** 최종 BDF/JSON + (선택) Nastran/F06Parser 체인.
- [ ] **§6 매트릭스 채우기** + InHouse 프로그램 서버 수동 교체 목록 문서화.

---
*최종 검증: 2026-06-16 — `hitess_modelflow_service.py`, `analysis.py`, `viewers.py`, `model-studio/src/*`, `HiTessModelBuilder.jsx`, `BdfWriter.cs` 코드 기준.*
