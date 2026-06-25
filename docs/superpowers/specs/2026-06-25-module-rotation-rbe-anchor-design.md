# 설계: Module Unit Studio — RBE 인지 anchor + 모델 회전

- 작성일: 2026-06-25
- 대상: HiTESS WorkBench / Module Unit Studio (`module-unit-studio`) + 백엔드 NastranBridge
- 상태: 설계 확정(구현 전, 사용자 승인 완료)

## 1. 목적 / 배경

두 가지 독립 기능을 한 작업으로 묶는다.

1. **Feature 1 — anchor 노드 RBE 제외**: 자세안정성/구조검토 lifting 해석에서 모델 무게중심(CoG)
   근처 노드 1개에 `SPC1 990001 12`(X/Y 병진 구속)를 잡아 강체운동(rigid-body)을 막는다.
   현재는 RBE **dependent** 노드만 제외하는데, RBE 에 연결된 **independent + dependent** 노드 위치를
   **모두 제외**하고 그 다음으로 가까운 구조 노드에 잡아달라는 요구.

2. **Feature 2~4 — 모델 회전**: Model 리본(Model 모드)에서 회전 축(X/Y/Z)과 각도를 입력하면 모델을
   해당 축 중심으로 회전한다. 회전된 모델이 (1) 뷰어 표시, (2) 권상 자세안정성 평가, (3) 실제 Nastran
   구조해석, (4) BDF 출력까지 **일관되게** 반영되어야 한다.

### 확정된 요구사항 (사용자 합의)

| 항목 | 결정 |
|------|------|
| 회전 기준점(피벗) | **모델 무게중심(CoG)** — 회전해도 CoG 전역 좌표는 고정 |
| 회전 누적/초기화 | **누적 회전** (버튼마다 현재 상태에서 추가), 초기화는 **폴더 재로드** |
| 회전 적용 위치 | **프론트 인메모리 변환**(Approach A) — 뷰어/자세/구조/BDF 모두 한 소스에서 |
| 회전 대상 데이터 | 노드 좌표 (x,y,z) + **CBEAM/CBAR orientation 벡터**(방향 회전) |
| anchor 폴백 | CoG 근처 RBE-비연결 구조 노드가 0개면 **가장 가까운 구조 노드로 폴백** |

## 2. 데이터 모델 / 핵심 근거 (실측)

`nastran_bridge.py` + Studio `StageData` 확인 결과:

- **노드**: `model["nodes"] = [{id, x, y, z, tags}]` (단위 mm). GRID 카드 field4~6.
  - Studio: `StageData.nodeMap: Map<id, {x,y,z,tags}>` (StageData.js:25-34).
- **요소 orientation**: CBEAM/CBAR 는 `element.orientation = [x1,x2,x3]`(기본 `[0,0,1]`) 보유
  (nastran_bridge.py:362-367). BDF X1/X2/X3(field5~7) = 단면 방향 v-벡터. `offt`(OFFT, 예 'BGG')
  보존. **basic/global 프레임 v-벡터이므로 모델 회전 시 함께 회전해야** 단면 방향/응력이 맞다.
  - CBUSH 는 orientation 생략(line 1947) → 회전 대상 아님.
- **점질량(CONM2)**: `{id, nodeId, mass}` 만 — 관성텐서/오프셋 없음(offset X1/X2/X3=0 고정 출력,
  line 2002). **노드 위치에만 종속** → 노드만 회전하면 충분, 별도 처리 불필요.
- **RBE2/RBE3**: `model["rigids"] = [{id, independentNode, dependentNodes[], cm, remark}]`.
  헬퍼 `rigid_node_ids(rigid)` 가 **independent + dependent 전체**를 반환(line 384-390).

### Feature 1 현재 코드 근거

`_pick_anti_rigid_body_anchor` (nastran_bridge.py:3527-3631):
- pipe 노드 제외(modelPart='stru' 만 후보) → CoG 거리순 top-20 → 단면 최대치수 최대 노드 선택.
- 현재 RBE 제외: `dependentNodes` 만 `rigid_dependent_nodes` 에 add(line 3565-3567).
  **independent(GN) 는 제외 안 함.** ← Feature 1 의 변경 지점.

## 3. 아키텍처

### 3.1 Feature 1 — anchor RBE 제외 (백엔드 전용)

```
build_lifting_bdf → _pick_anti_rigid_body_anchor(model, cog, excluded_node_ids)
   excluded = (pipe 노드) ∪ (모든 rigid 의 independent+dependent)   ← 변경
   후보 풀이 비면 → RBE 제외 완화(가장 가까운 구조 노드)            ← 폴백
   → SPC1 990001 12 <anchor>
```

### 3.2 Feature 2~4 — 모델 회전 (프론트 인메모리 변환, Approach A)

```
[모델 회전 버튼] (Model 모드 / Sidebar) → RotateModelDialog(axis, angleDeg)
   │
   └─ useStageStore.rotateModel({axis, angleDeg})
        1) pivot = 현재 CoG (computeMassFallback)
        2) 모든 노드 좌표를 axis·angle 로 pivot 중심 회전
        3) 모든 CBEAM/CBAR orientation 벡터를 axis·angle 로 방향 회전(translation 없음)
        4) stages 새 참조 교체 + modelRotated = true (누적)
        5) 기존 자세안정성/구조해석 결과 무효화 (emptyPipeFluid 와 동일)
        6) rotateModel intent {axis, angleDeg} 기록(provenance)
   │
   ├─(뷰어)   ThreeViewport ← nodeMap (회전 반영)
   ├─(자세)   buildPostureStabilityPayload ← computeMassFallback(회전 nodeMap)
   └─(구조/BDF) buildEditedStageJson ← 회전된 nodeMap/elements → _edited.json
                 → convert_json_to_bdf → _edited.bdf → lift-run → _lifting.bdf → Nastran
```

**Approach A 선택 이유 / 이중 적용 방지:**
- 세 소비처(뷰어/자세/구조·BDF)가 모두 **프론트 geometry**(nodeMap / `_edited.json` / posture payload)를
  읽으므로, 인메모리 변환 한 번으로 전부 일관 반영된다.
- `rotateModel` intent 는 **기록용**. `_edited.json` 에 이미 회전 좌표가 baked 되므로 백엔드
  `apply_edit_json` 는 이 intent 를 재적용하지 않는다(미지원 kind → skip, 무해). → **이중 회전 없음.**
- ⚠️ **계획 단계 검증 게이트(§8-3)**: 만약 어떤 소비처가 `_edit.json`(intents) 을 **원본 geometry 에
  재적용**해 BDF 를 만든다면(= `_edited.json` 미경유), 그 경로에서는 회전이 누락된다. 이 경우에만
  Approach C(백엔드 `apply_edit_json` 에 `rotateModel` 핸들러 추가; 파일이 다르므로 이중적용 아님)로
  보강한다 — 이는 서버(145) 재배포 항목이 된다.

## 4. 회전 수학 (확정)

각 θ = `angleDeg · π/180`, `c=cosθ`, `s=sinθ`. pivot `(px,py,pz)=CoG`.
노드는 `(x',y',z')` 로, orientation 벡터 `(vx,vy,vz)` 는 **pivot translation 없이** 같은 회전 행렬 적용.

- **X축**: `y'=(y-py)c-(z-pz)s+py`, `z'=(y-py)s+(z-pz)c+pz`, `x'=x`
- **Y축**: `z'=(z-pz)c-(x-px)s+pz`, `x'=(z-pz)s+(x-px)c+px`, `y'=y`
- **Z축**: `x'=(x-px)c-(y-py)s+px`, `y'=(x-px)s+(y-py)c+py`, `z'=z`

(orientation 벡터는 동일 식에서 pivot 항을 제거: 예 Z축 `vx'=vx·c-vy·s`, `vy'=vx·s+vy·c`.)

- 오른손 좌표계, CCW 양각. 회전은 순수 강체 회전(형상·치수 보존).
- pivot=CoG 이므로 CoG 전역좌표는 회전 불변 → 누적 회전 시 동일 CoG 재사용(드리프트 없음).
- 정밀도: 프론트는 double 유지, BDF writer 가 8칸 고정필드로 포맷. 누적 float 오차는 공학적으로 무시.

## 5. Studio 설계

### 5.1 상태

`useStageStore`:
- `modelRotated: boolean` (기본 `false`). `reset()`/`loadStages()` 시 `false`.
- (선택 기록) `rotationLog: [{axis, angleDeg}]` — 누적 회전 이력(요약/디버그용).

### 5.2 액션 `rotateModel({axis, angleDeg})` (useStageStore)

1. stage 없으면 no-op `{ changedNodeCount: 0 }`.
2. pivot = `computeMassFallback(last).centerOfGravityMm` (없으면 bbox center 폴백).
3. **모든 stage** 의 `nodeMap` 노드 좌표를 §4 식으로 회전(in-place mutate).
4. **모든 stage** 의 CBEAM/CBAR `orientation` 벡터를 방향 회전. orientation 없으면 skip.
5. `set({ stages: [...stages], modelRotated: true })`.
6. 변경 발생 시 자세안정성/구조해석 결과 무효화(§5.5) — emptyPipeFluid 와 동일 패턴.
7. `useEditStore.addIntent({ kind:'rotateModel', params:{axis, angleDeg} })`.
8. 반환 `{ axis, angleDeg, changedNodeCount, invalidatedStability }`.

### 5.3 Edit Intent `rotateModel`

`data/EditIntent.js`:
- `VALID_KINDS` 에 `'rotateModel'` 추가.
- params: `{ axis: 'X'|'Y'|'Z', angleDeg: number }`.
- `validateRotateModel`: axis ∈ {X,Y,Z}, angleDeg 유한 실수. (누적 허용 → 중복 차단 안 함.)
- `summarizeIntent`: `"모델 회전 (Z축 45°)"`.
- `serializeIntents`/`parseIntents`: 일반 경로 자동 처리.
- `applyEditIntents.js`(`computeDeleteMask`): rotateModel 은 삭제/노드제거 무관 → 명시적 무시(주석).

### 5.4 회전 좌표가 `_edited.json` 으로 흐르는 경로

`buildEditedStageJson`(applyEditedModel.js:28-) 는 `stageData.nodeMap` 좌표와
`stageData.elements`(orientation 포함)를 그대로 export 한다. §5.2 가 이들을 **인메모리에서 이미 회전**
시켰으므로 `_edited.json` 에 회전 좌표/방향이 그대로 실린다. **buildEditedStageJson 자체 수정 불필요.**

### 5.5 무효화 + stale stageSummary 게이트

- 회전으로 형상이 바뀌면 기존 자세안정성/구조해석 결과는 stale → `useStabilityStore.reset()` +
  `useUnitStructuralStore.reset()` (emptyPipeFluid 의 무효화 로직 재사용).
- `buildPostureStabilityPayload`(useEditStore.js) 의 stale 게이트를 확장:
  `(pipeFluidEmptied || modelRotated) ? null : stageSummary`. (stageSummary 의 CoG/형상은 회전 전 값.)
- `MassSummaryOverlay`/CoG 마커도 동일 게이트(pipeFluidEmptied 처리와 같은 자리).

### 5.6 UI — RotateModelDialog + Sidebar 버튼

`components/Sidebar.jsx` "모델 조작" 섹션(유체 비우기 옆)에 버튼 "모델 회전" 추가:
- 클릭 → `RotateModelDialog.jsx`(신규, `AddRigidDialog` 패턴 재사용):
  - axis 라디오 X/Y/Z, angle(deg) number 입력, 검증 표시.
  - 확인 시 `rotateModel()` 호출 → 토스트(예: "Z축 45° 회전 적용 — 자세안정성 재평가 필요").
- 회전 후 안내(emptyPipeFluid 와 동일): "형상이 바뀌어 자세안정성/구조해석 결과를 초기화했습니다.
  자세안정성 평가를 다시 실행하세요."
- 모델 미로드 시 버튼 비활성.

## 6. 백엔드 설계 (Feature 1)

`InHouseProgram/NastranBridge/nastran_bridge.py` — `_pick_anti_rigid_body_anchor`:

```python
# 변경 전: dependent 만 제외
# for rigid in model.get("rigids", []) or []:
#     for nid in (rigid.get("dependentNodes", []) or []): rigid_dependent_nodes.add(nid)

# 변경 후: independent+dependent 전체 제외 (rigid_node_ids 헬퍼 사용)
rbe_nodes: set[int] = set()
for rigid in model.get("rigids", []) or []:
    for nid in rigid_node_ids(rigid):
        rbe_nodes.add(nid)
# excluded = pipe 노드 ∪ rbe_nodes

# 1차: rbe_nodes 제외 후보로 선택
# 폴백: 후보 풀이 비면 rbe_nodes 제외를 완화하고 가장 가까운 구조 노드 선택
#       (pipe 제외는 유지) → meta["rbeExclusionRelaxed"] = True
```

- 반환 meta 에 `rbeIndependentExcludedCount`, `rbeExclusionRelaxed`(bool) 추가.
- 폴백 단계: ① RBE 제외 + 구조 + 거리순 → ② (비면) RBE 완화 + 구조 + 거리순 → ③ (비면) 최근접 노드.

### 배포 (InHouse 규칙 — 필수)

- `nastran_bridge.py` 는 git 미추적 → **서버(145) 수동 교체 + 백엔드 재시작** 필요.
- 커밋 보고에 "서버 수동 교체 대상: nastran_bridge.py + 재시작" 명시.
- (직전 세션의 emptyPipeFluid 핸들러 미반영분과 함께 교체하면 1회로 끝남.)

## 7. 영향 받는 파일 (요약)

Studio (`apps/module-unit-studio/src/`):
- `store/useStageStore.js` — `modelRotated` 플래그 + `rotateModel()` 액션 + 회전 수학
- `store/useEditStore.js` — stale 게이트에 `modelRotated` 추가
- `data/EditIntent.js` — `rotateModel` kind/검증/요약
- `data/applyEditIntents.js` — rotateModel 무시(명시)
- `components/RotateModelDialog.jsx` — 신규 입력 다이얼로그
- `components/Sidebar.jsx` — "모델 회전" 버튼 + 회전 후 안내
- `data/geometry.js`(또는 store 내부) — 회전 행렬 헬퍼(테스트 용이하게 분리 권장)
- `package.json` — 버전 0.0.55 → 0.0.56

Backend:
- `InHouseProgram/NastranBridge/nastran_bridge.py` — `_pick_anti_rigid_body_anchor` RBE 제외+폴백
- (조건부) Approach C 시 `apply_edit_json` 에 `rotateModel` 핸들러

## 8. 검증 필요 항목 (계획/구현 단계에서 확정)

1. **orientation OFFT 프레임**: 실제 모델 elements 의 `offt` 가 basic/global('BGG' 등)인지 확인 →
   basic 이면 v-벡터 회전이 정답. (element-relative 프레임이면 회전 불필요 — 실측 케이스 확인.)
2. **CoG 일관성**: pivot=CoG 회전 후 `buildPostureStabilityPayload` 의 `centerOfGravityMm` 가
   회전 불변(동일)인지, 폴백 게이트가 stageSummary 가 아닌 computeMassFallback 을 쓰는지 확인.
3. **BDF 출력/구조해석 입력 경로**: 구조해석·BDF 출력이 실제로 `_edited.json`(프론트 geometry)을
   경유하는지 확정. `_edit.json` 을 원본에 재적용하는 경로가 있으면 Approach C 보강(서버 재배포).
4. **anchor 폴백 동작**: RBE 밀집 모델에서 폴백이 정상 anchor 1개를 확보하는지(USER FATAL 9050 방지).

## 9. 테스트

Studio (vitest):
- 회전 수학: 알려진 점의 Z축 90° 결과, CoG 불변성, orientation 벡터 회전, 누적 2회 합성.
- `EditIntent.test.js`: rotateModel 생성/검증(axis∈X/Y/Z, 비수치 각도 차단).
- `rotateModel()`: 무효화(stability/structural reset), `modelRotated` set, intent 기록.
- `buildPostureStabilityPayload`: `modelRotated=true` 면 회전 반영 CoG 사용(stageSummary 무시).

Backend (pytest/스크립트):
- `_pick_anti_rigid_body_anchor`: independent+dependent RBE 노드 제외 확인, 후보 0개 시 폴백 동작
  (`rbeExclusionRelaxed=True`)과 anchor 1개 확보.

## 10. 배포

- Studio: 버전 bump + `npm run package` → zip/sha256 를 **로컬 백엔드 StudioProgram + UNC** 양쪽 복사.
  **사용자 명시 승인 후에만 배포.**
- Backend: `nastran_bridge.py` 미러 + **서버(145) 수동 교체 + 재시작** 보고.
- 커밋: 한국어, `config.js` 스테이징 금지, `git add -A` 금지(특정 파일만), LayerPanel WIP 미스테이징 유지.

## 11. Out of Scope

- 회전 undo/역회전 UI(초기화는 폴더 재로드).
- 임의 축(벡터 지정) 회전 — X/Y/Z 표준축만.
- 회전 외 일반 좌표 변환(병진/스케일) UI.
- pivot 사용자 지정 옵션(현재 CoG 고정; 향후 필요 시 확장).
