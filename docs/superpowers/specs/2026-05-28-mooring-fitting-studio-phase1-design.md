# MooringFittingStudio Phase 1 — 설계 명세

**날짜**: 2026-05-28  
**범위**: Phase 1 — BDF 뷰어 + 그룹 삭제 + RBE2 수정 + 최종 BDF 출력  
**Phase 2 이후 (별도)**: SPC 수정, 하중 수정/시각화

---

## 1. 배경 및 목적

MooringFitting.exe는 Structure CSV + Load CSV를 입력받아 8단계 파이프라인을 거쳐
`Stage_00_BuildRaw.bdf`(원본 raw 모델)와 `Stage_07_FinalValidation.bdf`(최종 검증 모델)을 포함한
out/ 폴더를 생성한다.

MooringFittingStudio는 이 두 BDF 파일을 3D로 시각화하고, 그룹 삭제·RBE2 수정·최종 BDF
재출력을 지원하는 Electron Studio 앱이다. ModelBuilderStudio 패턴을 기반으로 한다.

---

## 2. 전체 아키텍처

```
[MooringFittingAssessment.jsx]
  해석 완료 후 "Studio 열기" 버튼 노출
    │
    ├─ viewer:install('mooring-fitting-studio')
    │    UNC StudioProgram/mooring-fitting-studio-x.x.x.zip 복사 → 압축 해제
    │
    ├─ GET /api/analysis/mooring-fitting/viewer-zip?output_dir=<out_path>
    │    └ nastran_bridge.convert_bdf(Stage_00_BuildRaw.bdf)       → stage00.json
    │    └ nastran_bridge.convert_bdf(Stage_07_FinalValidation.bdf) → stage07.json
    │    └ StreamingResponse(zip)
    │
    ├─ viewer:fetchResultDir → 로컬 임시폴더 압축 해제
    └─ viewer:open('mooring-fitting-studio', initialFolder=<local_tmp>)

[MooringFittingStudio]
  getInitialFolder() → { folderRef, files: [stage00.json, stage07.json] }
  Stage 00 / Stage 07 토글 → Three.js 1D beam 씬 렌더링
  Edit mode:
    - 그룹 삭제 (deleteGroup intent)
    - RBE2 추가 / 삭제 (addRigid / deleteRigid intent)
    │
    └─ finalizeEditedModel(folderPath, intents)
         │
         └─ POST /api/analysis/mooring-fitting/apply-edit
              nastran_bridge.apply_edit_json(stage07.json, intents) → 수정된 BDF 저장
```

---

## 3. MooringFittingStudio 프로젝트

### 3.1 프로젝트 생성

- **기반**: `WorkBenchSubModule/StudioBasic/` 복사 → `WorkBenchSubModule/MooringFittingStudio/`
- **package.json**: `name: "mooring-fitting-studio"`, `version: "0.1.0"`, port `5177`
- **vite.config.js**: manifest `id: 'mooring-fitting-studio'`, `name: 'MooringFittingStudio'`

### 3.2 파일 구조

```
src/
  App.jsx                     # root — getInitialFolder() → loadStages()
  host/
    host.js                   # ModelBuilderStudio에서 그대로 복사
  data/
    BdfStageData.js           # nastran_bridge JSON (schemaVersion 1.2) 래퍼
                              # ModelBuilderStudio StageData.js 기반, MooringFitting 특화
  store/
    useStageStore.js          # stage00/stage07 로드, activeStageKey('00'|'07') 토글
    useViewerStore.js         # viewports, camera, pickedEntity (StudioBasic 기반)
    useEditStore.js           # editIntents[], editMode(boolean), 적용 함수
  three/
    BeamMesh.js               # CBEAM/CBAR 선 렌더링 (ModelBuilderStudio 이식)
    RigidMesh.js              # RBE2 스파이더 선 (ModelBuilderStudio 이식)
    SpcMarkers.js             # SPC 노드 마커 — 구 모양 (신규)
    SceneBuilder.js           # BdfStageData → Three.js 씬 조립
    SelectionHighlight.js     # 선택 엔티티 하이라이트
  components/
    Sidebar.jsx               # Stage 토글 + 레이어 패널 + 헬스메트릭 요약
    ThreeViewport.jsx         # Three.js 캔버스 (StudioBasic 기반)
    ViewportContainer.jsx     # 뷰포트 그리드 (1~4분할)
    InspectorPanel.jsx        # 클릭 엔티티 상세 (element/rigid/node)
    EditPanel.jsx             # 그룹 삭제 버튼 + RBE2 추가 폼
    BottomReviewDock.jsx      # 진단 테이블 (접힘/펼침)
    AddRigidDialog.jsx        # RBE2 추가 다이얼로그 (ModelBuilderStudio 이식)
```

### 3.3 BdfStageData 스키마

`nastran_bridge.convert_bdf()` 출력 그대로 사용 (schemaVersion 1.2):

```json
{
  "meta": { "schemaVersion": "1.2", "stageName": "...", ... },
  "nodes":       [{ "id", "x", "y", "z", "tags" }],
  "elements":    [{ "id", "type", "startNode", "endNode", "propertyId", "lengthMm" }],
  "rigids":      [{ "id", "independentNode", "dependentNodes", "cm" }],
  "properties":  [{ "id", "card", "kind", "dims", "materialId" }],
  "materials":   [{ "id", "E", "nu", "rho" }],
  "connectivity":{ "groups": [...], "groupCount", ... },
  "healthMetrics": { "totals", "issues", ... },
  "diagnostics": [{ "severity", "code", "message" }]
}
```

### 3.4 편집 인텐트 (Phase 1)

| intent kind | params | 설명 |
|-------------|--------|------|
| `deleteGroup` | `groupId` | 연결 그룹 통째 삭제 |
| `addRigid` | `independentNode`, `dependentNodes[]`, `cm` | RBE2 추가 |
| `deleteRigid` | `rigidId` | RBE2 삭제 |

편집 후 `_edit.json`을 `folderRef`에 기록 → `workbenchAPI.finalizeEditedModel()` 호출.

### 3.5 Three.js 렌더링 규칙

| 엔티티 | 표현 | 색상 |
|--------|------|------|
| CBEAM / CBAR (구조) | 선 (LineSegments) | `#6ee7b7` (emerald) |
| SPC 노드 | 구 (SphereGeometry r=50mm) | `#f87171` (red) |
| RBE2 | 스파이더 선 | `#fbbf24` (amber) |
| 선택된 엔티티 | 하이라이트 | `#38bdf8` (sky) |
| 그리드 | XZ 평면 | `#1e293b` |

---

## 4. 백엔드 변경

### 4.1 viewer-zip 엔드포인트

```
GET /api/analysis/mooring-fitting/viewer-zip?output_dir=<path>
```

- **보안**: `output_dir`은 `userConnection/` 하위 경로여야 함 (경로 traversal 차단)
- **처리**:
  1. `<output_dir>/Stage_00_BuildRaw.bdf` → `nastran_bridge.convert_bdf()` → `stage00.json`
  2. `<output_dir>/Stage_07_FinalValidation.bdf` → `nastran_bridge.convert_bdf()` → `stage07.json`
  3. 두 JSON을 in-memory zip으로 묶어 `StreamingResponse` 반환
- **오류**: BDF 파일 없으면 404

### 4.2 apply-edit 엔드포인트

```
POST /api/analysis/mooring-fitting/apply-edit
Body: { folderPath: str, intents: [...], stageRef: str }
```

- **처리**:
  1. `<folderPath>/stage07.json` 로드 (또는 `_edit.json`의 `stageRef`로 식별)
  2. `nastran_bridge.apply_edit_json(base_data, edit_data)` 적용
  3. `nastran_bridge.convert_json_to_bdf(result)` → BDF 텍스트
  4. `<folderPath>/mooring_fitting_edited.bdf` 저장
  5. `{ ok: true, bdfPath }` 반환

### 4.3 nastran_bridge import 방식

백엔드 루트에 `nastran_bridge.py`를 복사 또는 `sys.path`로 참조.
`convert_bdf(path)`, `apply_edit_json(base, edit)`, `convert_json_to_bdf(data)` 함수 직접 import.

---

## 5. WorkBench 프론트엔드 변경 (MooringFittingAssessment.jsx)

### 5.1 추가 상태

```js
const [viewerInstalled, setViewerInstalled] = useState(null)
const [viewerStatus,    setViewerStatus]    = useState('idle')   // idle|checking|installing|opening|error
const [viewerProgress,  setViewerProgress]  = useState(null)
const [viewerError,     setViewerError]     = useState(null)
```

### 5.2 handleOpenStudio 콜백

GroupModuleUnitLiftingAnalysis.jsx의 `handleOpenStudio` 패턴 그대로:
1. `viewer:check-installed('mooring-fitting-studio')`
2. 미설치 → `viewer:install` (UNC zip)
3. `GET /api/analysis/mooring-fitting/viewer-zip?output_dir=<out_dir>` URL로 `viewer:fetchResultDir`
4. `viewer:open('mooring-fitting-studio', { initialFolder, parentAnalysisId, serverUrl })`

### 5.3 UI 추가

결과 섹션에 "Studio 열기" 버튼 (해석 완료 상태에서만 활성화, 동일한 뷰어 인스톨/진행률 표시 포함).

---

## 6. 배포

| 단계 | 명령 / 작업 |
|------|------------|
| 빌드 | `cd MooringFittingStudio && npm run build` |
| 패키징 | `dist/` 내용을 `mooring-fitting-studio-0.1.0.zip`으로 압축 (루트에 manifest.json, index.html) |
| 배포 | UNC `StudioProgram/mooring-fitting-studio/mooring-fitting-studio-0.1.0.zip` 복사 |

---

## 7. 완료 기준 (Phase 1)

- [ ] MooringFittingAssessment에서 "Studio 열기" 버튼 클릭 → Studio 창 오픈
- [ ] Stage 00 / Stage 07 전환 시 씬 교체됨
- [ ] CBEAM, RBE2, SPC 모두 3D에서 시각적으로 구분됨
- [ ] 그룹 삭제 → 씬에서 즉시 반영
- [ ] RBE2 추가/삭제 → 씬에서 즉시 반영
- [ ] "최종 BDF 출력" → `mooring_fitting_edited.bdf` 생성

---

## 8. Phase 2 이후 (별도 세션)

- SPC 노드 추가/삭제
- 하중 카드(FORCE/MOMENT) 수정
- 하중 벡터 시각화 (Three.js ArrowHelper)
- 전체 스테이지 브라우저 (00~07 슬라이더)
