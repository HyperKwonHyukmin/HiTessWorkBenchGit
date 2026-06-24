# 설계: Module Unit Studio — "Pipe 내부 유체 비우기"

- 작성일: 2026-06-24
- 대상: HiTESS WorkBench / Module Unit Studio (`module-unit-studio`) + 백엔드 NastranBridge
- 상태: 설계 확정(구현 전)

## 1. 목적 / 배경

Group Module Unit 모델에서 배관(Pipe)은 내부 유체(물)의 중량을 **강재 + 물 등가밀도**로 표현한
전용 material(`Steel_Fluid_*`)을 갖는다. 모듈을 **권상(lifting)** 할 때는 배관 내부를 비우므로,
유체 중량을 제거한 상태의 **모델 중량 / 무게중심**으로 평가·해석해야 한다.

본 기능은 Model 모드에서 버튼 한 번으로 **모든 Pipe material의 밀도를 순수 강재(`7.85e-9 t/mm³`)로
되돌려** 유체 중량을 제거하고, 그 결과가 (1) 뷰어 표시, (2) 권상 자세안정성 평가,
(3) 실제 Nastran 구조해석 BDF 까지 일관되게 반영되도록 한다.

### 확정된 요구사항 (사용자 합의)

| 항목 | 결정 |
|------|------|
| 되돌리기 | **단방향** (비우기만, 다시 채우기/undo 없음) |
| 적용 범위 | 뷰어 표시 + 권상 안정성 평가 + **실제 Nastran/BDF 영구 반영** |
| 질량 갱신 방식 | 비운 뒤 stage 데이터에서 **전체 재계산** (`computeMassFallback`) |
| 버튼 위치 | Model 좌측 패널(`Sidebar`)에 **새 섹션** |
| BDF 반영 방식 | **A안 — 새 edit intent `emptyPipeFluid`** (기존 편집 파이프라인 활용) |

## 2. 데이터 모델 / 핵심 근거 (실측)

실제 모델 JSON(`06_Validation.json`, GroupModuleUnit) 확인 결과:

- material `id=1` = `"Steel"`, `rho = 7.85e-9` (구조용 순수 강재)
- material `id≥2` = `"Steel_Fluid_R<외경>x<내경>"`, `rho > 7.85e-9` (강재 + 내부 물 등가밀도)
  - 예: `Steel_Fluid_R36.5x33.5` → `rho = 1.309e-8`
- 요소 카테고리: `element.category === 'Pipe'` (4866 Structure / 2561 Pipe)
- 연결 체인: `element(category='Pipe')` → `propertyId` → `property.materialId` → `material.rho`

따라서 **"유체 비우기" = Pipe 요소가 참조하는 material 들의 `rho` 를 `7.85e-9` 로 set**.

### ⚠️ 백엔드 식별 제약 (결정적)

`nastran_bridge.parse_material()` 는 BDF→JSON 변환 시 material **이름을 `MAT1_{id}` 로 대체**하고,
BDF 에는 `category`/`modelPart` 개념이 없다. 즉 **백엔드의 apply-edit base JSON 에서는 category 로
pipe material 을 재식별할 수 없다.**

→ **결론:** intent 에 비울 대상 **material ID 목록을 명시적으로 실어** 보낸다. studio 가 phase JSON
(category 보유)에서 계산해 전달하고, 백엔드는 ID 로만 `rho` 를 set 한다.
(studio material id ↔ BDF MAT1 MID 일치 여부는 §8 검증 항목.)

## 3. 아키텍처 — 3개 반영 경로

```
[버튼 클릭] (Model 모드 / Sidebar)
   │
   ├─(1) in-memory stage mutate ──► MassSummaryOverlay / CoG 마커 전체 재계산   (뷰어 표시)
   │
   ├─(2) emptyPipeFluid intent ──► useEditStore                                   (편집 상태)
   │         └─ buildPostureStabilityPayload 가 mutated stage 로 mass 재계산        (권상 안정성)
   │
   └─(3) *_edit.json 에 직렬화 ──► 백엔드 apply_edit_json ──► convert_json_to_bdf
             └─ MAT1 rho=7.85e-9 ──► _edited.bdf ──► lift-run ──► _lifting.bdf ──► Nastran SOL101
```

## 4. Studio 설계

### 4.1 상태 (단일 진실원)

`useStageStore` 에 플래그 추가:

- `pipeFluidEmptied: boolean` (기본 `false`, 단방향 → `true`)
- `reset()` / `loadStages()` 시 `false` 로 초기화 (새 폴더 로드하면 다시 채운 상태로 시작)

### 4.2 비우기 액션 `emptyPipeFluid()` (useStageStore action)

1. `pipeMaterialIds` 계산: 모든 stage 에 대해
   `elements.filter(category==='Pipe')` → `property.materialId` 의 **unique 집합**.
2. **stage mutate**: 각 stage 의 `materialMap`/`materials` 에서 해당 material `rho = 7.85e-9` 로 set.
   - `StageData` 는 클래스 인스턴스 → `materialMap`(Map) 과 `materials`(array) **양쪽** 갱신.
   - React 반응성을 위해 `stages` 를 **새 배열 참조**로 교체(`set({ stages: [...stages] })`).
   - (선택) 변경 후 mass 의존 lazy 캐시가 있으면 무효화 — `StageData` 는 mass 캐시 없음(매번 계산)이라 불필요.
3. `pipeFluidEmptied = true` set.
4. `emptyPipeFluid` intent 1건을 `useEditStore` 에 추가 (§4.4).
5. 비운 질량(delta) 토스트/요약 반환.

### 4.3 질량 / 무게중심 전체 재계산

`MassSummaryOverlay.jsx`:

- 현재: `stageSummary.massProperties` 우선 → 없으면 `computeMassFallback(last stage)`.
- 변경: `pipeFluidEmptied === true` 면 **`stageSummary` 를 무시하고 `computeMassFallback`(mutated last stage)
  강제 사용**. (요구사항 "전체를 stage 에서 재계산".)
  - `useMemo` 의존성에 `pipeFluidEmptied` 와 `stages`(새 참조) 추가 → 자동 재계산.
  - 소스 라벨에 "유체 비움(재계산)" 표기 추가.

무게중심 마커(`CenterOfGravityMarker` / `cog` 레이어):
- 동일 원칙 — `pipeFluidEmptied` 면 재계산 좌표 사용.
- (§8 검증: CoG 마커가 stageSummary 의 COG 를 직접 읽는지, computeMassFallback 의 cog 를 쓰는지 확인 후 일치시킴.)

### 4.4 Edit Intent: `emptyPipeFluid`

`data/EditIntent.js`:

- `VALID_KINDS` 에 `'emptyPipeFluid'` 추가.
- params 스키마: `{ materialIds: number[], targetRho: number /* =7.85e-9 */, pipeElementCount?: number }`
- `validateEmptyPipeFluid`: materialIds 비어있지 않음 + 정수 + (stageData 있으면) 존재하는 material 인지.
  중복 추가 방지(이미 emptyPipeFluid intent 존재 시 차단 — 단방향).
- `summarizeIntent`: `"배관 내부 유체 비우기 (N개 material → ρ=7.85e-9)"`.
- `serializeIntents` / `parseIntents`: 기존 일반 경로로 자동 처리(특수 분기 불필요).

`data/applyEditIntents.js` (`computeDeleteMask`):
- `emptyPipeFluid` 는 **삭제/노드 변경이 아니므로 derived count 에 영향 없음** → 명시적으로 무시(주석).
  (요소·노드 마스크 로직과 무관.)

### 4.5 UI — Sidebar 새 섹션

`components/Sidebar.jsx` — 기존 `Section` 래퍼 재사용. "레이어" 섹션과 "초기화" 버튼 사이에
새 섹션 **"모델 조작"** 추가:

- 버튼 "Pipe 내부 유체 비우기"
  - 클릭 → 확인 다이얼로그(단방향 경고: "되돌리려면 모델을 다시 로드해야 합니다").
  - 확인 시 `emptyPipeFluid()` 호출 → 토스트(예: "배관 유체 제거: −X.X ton, 무게중심 갱신됨").
  - 적용 후: `pipeFluidEmptied === true` 면 버튼 **비활성 + 체크 표시**("유체 비움 완료").
- Pipe material 이 0개면 버튼 비활성 + 안내("배관 부재 없음").

## 5. 백엔드 설계 (NastranBridge)

`InHouseProgram/NastranBridge/nastran_bridge.py` — `apply_edit_json()` 의 intent 분기에 추가:

```python
elif kind == "emptyPipeFluid":
    target_rho = as_float(params.get("targetRho")) or 7.85e-9
    mids = {as_int(m) for m in params.get("materialIds", []) if as_int(m) is not None}
    changed = 0
    for mat in base_data.get("materials", []):
        if isinstance(mat, dict) and as_int(mat.get("id")) in mids:
            mat["rho"] = target_rho
            changed += 1
    if changed:
        summary["applied"] += 1
        summary.setdefault("emptiedPipeMaterials", changed)
    else:
        summary["skipped"] += 1
```

- 이후 `convert_json_to_bdf()` 가 `MAT1 ... rho` 로 그대로 출력 → `_edited.bdf` → `lift-run` 이
  원본 MAT1 보존하므로 `_lifting.bdf` 에 비운 밀도가 그대로 반영 → Nastran.
- 미지원 kind 가 아니므로 기존 "skip + warning" 폴백에 걸리지 않음.

### 배포 (InHouse 규칙 — 필수)

- `WorkBenchSubModule` 에 NastranBridge 소스가 따로 없으면 **`InHouseProgram/NastranBridge/nastran_bridge.py`
  가 1차 작업 대상**. (CLAUDE.md: modelflow service 는 `InHouseProgram/NastranBridge` 하드코딩.)
- `nastran_bridge.py` 는 git 미추적 → **서버(145) 에 수동 교체 + 백엔드 재시작** 필요.
- 커밋 보고에 "서버 수동 교체 대상: nastran_bridge.py + 재시작" 명시.

## 6. 영향 받는 파일 (요약)

Studio (`apps/module-unit-studio/src/`):
- `store/useStageStore.js` — `pipeFluidEmptied` 플래그 + `emptyPipeFluid()` 액션
- `store/useEditStore.js` — emptyPipeFluid intent 추가 헬퍼(필요 시)
- `data/EditIntent.js` — `emptyPipeFluid` kind/검증/요약
- `data/applyEditIntents.js` — emptyPipeFluid 무시 처리(명시)
- `components/MassSummaryOverlay.jsx` — pipeFluidEmptied 시 재계산 강제
- `three/CenterOfGravityMarker.js` (소스 확인 후) — 재계산 CoG 사용
- `components/Sidebar.jsx` — "모델 조작" 섹션 + 버튼
- `package.json` — 버전 bump

Backend:
- `InHouseProgram/NastranBridge/nastran_bridge.py` — `emptyPipeFluid` 핸들러

## 7. 테스트

- `EditIntent.test.js`: `emptyPipeFluid` 생성/검증(빈 materialIds 차단, 중복 차단).
- `useEditStore.test.js` / 신규: `emptyPipeFluid()` 가 pipe material rho 만 7.85e-9 로 바꾸고
  Structure material 은 불변임을 확인.
- mass 재계산: mutated stage 로 `computeMassFallback` 호출 시 총 질량이 유체 delta 만큼 감소.
- (백엔드, 가능 시) `apply_edit_json` 에 emptyPipeFluid intent → 대상 MAT1 rho 가 7.85e-9 로 출력되는지
  `nastran_bridge` 테스트에 케이스 추가.

## 8. 검증 필요 항목 (계획 단계에서 확정)

1. **material ID 일치**: studio phase JSON `materials[].id` ↔ 구조해석 parent **BDF MAT1 MID** 동일성.
   (불일치 시 intent 에 ID 대신 (외경,내경) 또는 property 기반 매칭 필요.)
2. **CoG 마커 데이터 소스**: `CenterOfGravityMarker`/cog 레이어가 stageSummary COG vs computeMassFallback
   중 무엇을 읽는지 → 재계산 경로와 일치시킴.
3. **`*_edit.json` 연결**: Model 모드에서 추가한 emptyPipeFluid intent 가 unit-structural 해석이 읽는
   `_edit.json`/`_edited.json` 에 실제로 포함되는 경로(직렬화/업로드/apply-edit 트리거) 확정.

## 9. Out of Scope

- 되돌리기/토글(다시 채우기), 원본 밀도 보존 — 단방향 결정.
- 배관 외 다른 material 밀도 일반 편집 UI.
- BDF 후처리 방식(B안) — 채택 안 함.
