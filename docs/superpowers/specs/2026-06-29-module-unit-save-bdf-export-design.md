# Module Unit Studio — "Save" 리본 탭 (편집 반영 최종 BDF 출력) 설계

**작성일:** 2026-06-29
**대상:** Module Unit Studio (`C:\Coding\WorkBenchSubModule\ModuleUnitStudio\apps\module-unit-studio`) + WorkBench Electron 앱 + WorkBench 백엔드

---

## 1. 목적

Module Unit Studio에 **"Save" 리본 탭**을 추가한다. 사용자가 스튜디오에서 수행한 모든 편집(모델 수정, 회전, 유체 비우기, 가서포트(보강재) 추가, 그룹/요소 삭제, RBE 추가 등)이 반영된 **현재 모델을 Nastran BDF로 출력**하는 버튼을 제공한다. 가서포트(wire) 설치 여부와 무관하게 항상 "현재 화면의 최종 모델"을 BDF로 저장한다.

이 BDF는 구조해석 파이프라인이 실제로 사용하는 BDF(`_edited.bdf`)와 **동일한 양식**이어야 한다.

## 2. 핵심 설계 결정 (확정)

| 결정 | 선택 | 근거 |
|---|---|---|
| BDF 생성 위치 | **백엔드 `convert_json_to_bdf` 재사용** | Mooring/SidePassage 최종-BDF 출력과 동일. 과거 SidePassage가 "손실 JS 라이터(bdfExport.js)"를 폐기하고 백엔드 라이터로 일원화한 전례(index.js:1883)가 있음 → JS 라이터 재도입 금지. 해석에 쓰는 BDF와 100% 동일 보장. |
| 저장 방식 | **Save-As 대화상자** (Electron `dialog.showSaveDialog`) | Mooring 최종-BDF 출력과 동일 UX. 기본 파일명 `<base>_edited.bdf`. |
| 패널 구성 | **BDF 버튼 + 편집 요약** | 무엇이 출력되는지 명확히 전달. |

## 3. 아키텍처 / 데이터 흐름

Mooring "최종 BDF 출력"(`viewer:exportMooringBdf`) 패턴을 미러링한다. 단, Module Unit은 스튜디오가 **이미 최종 편집 모델 JSON 전체**를 클라이언트에서 만들 수 있으므로(회전·유체비우기가 이미 node 좌표/material 밀도에 baked-in), 백엔드는 `convert_json_to_bdf`만 호출하면 된다(Mooring의 apply-edit·SidePassage의 convert_bdf+apply_edit_json 단계 불필요).

```
[Save 탭] "Nastran BDF로 저장" 클릭
  └─ useEditStore.exportEditedBdf()
       stage   = currentStage()           // stages[마지막]
       intents = get().intents
       editedJson = buildEditedStageJson(stage, intents)   // 회전·유체비우기·삭제·가서포트·RBE 모두 반영
       fileName   = buildEditedStageFileName(stage, formatTimestamp)  // "<base>_edited.json"
       content    = JSON.stringify(editedJson, null, 2)
  └─ host.exportUnitBdf({ fileName, content })
       ┌─ (Electron main: viewer:exportUnitBdf) ────────────────────────────────┐
       │ 0) runtimeConfig/serverUrl/employeeId/viewerParentAnalysisId 검증        │
       │ 1) POST /api/analysis/module-stability/upload                           │
       │      FormData(file=content, employee_id, parent_analysis_id,           │
       │               artifact_kind="edited") → { remotePath }                 │
       │ 2) POST /api/analysis/module-unit/export-bdf { jsonPath: remotePath }   │  ← 신규 백엔드 라우트
       │      = json.load(remotePath) → _nb.convert_json_to_bdf(data)           │
       │        → "<base>.bdf" 작성 → { ok, bdfPath, stats }                     │
       │ 3) GET /api/download?filepath=bdfPath → bdfText                         │
       │ 4) dialog.showSaveDialog(defaultPath="<base>.bdf")                      │
       │      + fs.writeFileSync(filePath, bdfText, "utf-8")                     │
       │ → { ok, savedPath, stats } | { ok:false, canceled?, error }            │
       └─────────────────────────────────────────────────────────────────────────┘
  └─ 토스트: 성공 "BDF 저장됨: <savedPath>" / 실패 error / 취소 무음
```

### 3.1 구성요소

- **클라이언트 모델 빌드**: `buildEditedStageJson(stage, intents)` (기존, `data/applyEditedModel.js`). 반환 JSON에는 `deck` 필드가 없음 → 백엔드 `convert_json_to_bdf`는 표준 deck로 폴백(해석 파이프라인의 `_edited.bdf`와 동일 동작).
- **업로드 채널**: `/api/analysis/module-stability/upload` (기존). `viewer:uploadEvaluationArtifact`와 동일 엔드포인트를 `viewer:exportUnitBdf` 내부에서 재사용. `artifact_kind="edited"`.
- **신규 백엔드 라우트**: `POST /api/analysis/module-unit/export-bdf`.
- **신규 IPC**: `viewer:exportUnitBdf` (preload `workbenchAPI.exportUnitBdf`로 노출).
- **신규 host 메서드**: `ElectronHost.exportUnitBdf` (preload에 채널 있을 때만 부여, `typeof` 가드).
- **신규 UI**: `Save` 탭 + `SavePanel`/`SavePanelDock`.

## 4. 변경 파일 (3계층)

### 4.1 백엔드 (WorkBench 레포 / 서버 145)

**`app/routers/analysis.py`** — 신규 라우트:

```python
@router.post("/analysis/module-unit/export-bdf")
async def export_module_unit_bdf(request, current_user=Depends(require_auth), db=Depends(get_db)):
    # Body: { jsonPath: str }  (= uploadEvaluationArtifact 의 remotePath, 절대경로)
    # 보안: _validate_userconnection_path + assert_current_user_can_access_path (sidepassage 라우트와 동일)
    # 동작: json.load(abs_path) → _nb.convert_json_to_bdf(data) → "<base>.bdf" write_text
    # 반환: { ok, bdfPath, stats(CBEAM/CBAR/RBE2/CONM2/GRID count) }
```

- `_NB_AVAILABLE` 가드, `_nb.convert_json_to_bdf`는 **이미 서버에 존재** → InHouseProgram 교체 불필요.
- 배포: **git pull + 백엔드 재시작만**.

### 4.2 WorkBench Electron 앱 (WorkBench 레포)

**`electron/index.js`** — 신규 `ipcMain.handle("viewer:exportUnitBdf", ...)`: `exportMooringBdf`(1823–1880)를 미러링하되 1단계를 "upload + export-bdf"로 교체.

**`electron/preload.js`** — `VALID_INVOKE_CHANNELS`에 `'viewer:exportUnitBdf'` 추가 + `workbenchAPI.exportUnitBdf: (opts) => ipcRenderer.invoke('viewer:exportUnitBdf', opts)`.

- 배포: **WorkBench 데스크톱 앱 새 릴리스(사용자 재설치)**. 버전 1.2.40 → 1.2.41.

### 4.3 스튜디오 zip (ModuleUnitStudio 레포)

- **`src/components/TopMenuBar.jsx`** — `TABS`에 `{ key: 'save', label: 'Save', Icon: Save }` 추가(analyze 뒤). lucide-react `Save` 아이콘 import.
- **`src/components/LeftDock.jsx`** — `if (activeMode === 'save') return <SavePanelDock />`.
- **`src/components/SavePanel.jsx`** (신규) — 헤더 "저장 (Save)", 편집 요약(가서포트 n / 삭제 그룹·요소 n / 회전·유체비우기 적용 여부 / 추가 RBE n), "Nastran BDF로 저장" 버튼. `intents`를 **stable 구독 후 본문 filter**(Zustand v5 무한루프 회피).
- **`src/components/panels/SavePanelDock.jsx`** (신규) — `SavePanel` 재export(기존 Dock 패턴).
- **`src/store/useEditStore.js`** — 신규 액션 `exportEditedBdf()`(build → host.exportUnitBdf, host 미지원 시 안내 반환).
- **`src/host/host.js`** — `ElectronHost`에 `exportUnitBdf` 메서드(`typeof api.exportUnitBdf === 'function'` 가드).
- 배포: 버전 0.0.69 → 0.0.70, `npm run package` → 로컬 `StudioProgram` + UNC 배포.

## 5. 에러 처리

- **host 미지원(구버전 앱)**: `host.exportUnitBdf`가 `undefined` → 패널 버튼이 비활성/안내("WorkBench 앱 업데이트 필요"). 스튜디오 크래시 없음.
- **stage 없음 / 미로딩**: 버튼 비활성 + 안내.
- **업로드/변환/다운로드 실패**: IPC가 `{ ok:false, error }` 반환 → 토스트로 표시.
- **저장 취소**: `{ ok:false, canceled:true }` → 무음(토스트 없음).
- **백엔드 404(라우트 없음)**: serverUrl이 최신 백엔드인지 확인하라는 힌트(Mooring/SidePassage와 동일).
- **경로 보안**: 백엔드가 `_validate_userconnection_path`로 userConnection 외부 접근 차단.

## 6. 테스트

- **백엔드**: 편집 JSON 픽스처 → `convert_json_to_bdf` → BDF에 GRID/CBEAM/PBEAML/RBE2/CONM2 카드 존재 확인(기존 nastran_bridge 동작이므로 라우트는 경로검증·파일쓰기 위주 스모크).
- **스튜디오(vitest)**:
  - `useEditStore.exportEditedBdf` — host에 `exportUnitBdf`가 있으면 호출되고 `{fileName, content}`에 편집 반영 JSON이 담김. 없으면 `{ ok:false }` 안내 반환(setHost로 가짜 host 주입).
  - SavePanel 편집 요약 카운트 계산이 intents로부터 올바른지(가서포트 n, 삭제 n 등).
- **수동 검증**: 실제 모델 로드 → 가서포트/삭제/회전/유체비우기 적용 → Save 탭 → BDF 저장 → 저장된 BDF를 Nastran/전처리기에서 로드해 양식 확인. 동일 모델의 구조해석 `_edited.bdf`와 카드 일치 확인.

## 7. 배포 비용 요약 (중요)

이 기능은 본질적으로 **3곳 모두** 갱신해야 동작한다(Mooring/SidePassage 최종-BDF 출력과 동일 비용):

1. **서버(145)**: `git pull` + 백엔드 재시작 (analysis.py 신규 라우트). InHouseProgram 교체 불필요(`convert_json_to_bdf` 기존 존재).
2. **WorkBench 데스크톱 앱**: 새 릴리스(preload/index.js 변경) → 사용자 재설치. 1.2.40 → 1.2.41.
3. **스튜디오 zip**: 0.0.69 → 0.0.70, 로컬 `StudioProgram` + UNC 배포.

구버전 앱에서는 그레이스풀 디그레이드(버튼 안내). 세 가지가 모두 반영돼야 정상 동작.

## 8. 비범위 (YAGNI)

- 편집 JSON 내보내기(이미 다른 경로 존재) — Save 탭은 BDF만.
- 브라우저 단독(WebHost) BDF 출력 — Electron 환경 전용(host 미지원 시 안내).
- 해석 deck(Case Control/하중) 포함 BDF — 본 기능은 모델 BDF(표준 deck 폴백). 해석은 기존 구조해석 흐름 사용.
