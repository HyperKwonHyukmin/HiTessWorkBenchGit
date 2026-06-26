# 설계: Module Unit Studio — 권상 Wire 위치로 RBE 노드 허용

- 작성일: 2026-06-25
- 대상: HiTESS WorkBench / Module Unit Studio (`module-unit-studio`) + 백엔드 NastranBridge
- 상태: 설계 확정(구현 전, 사용자 합의 완료)

## 1. 목적 / 배경

권상(Hoisting) Wire 위치를 지정할 때, 현재 Studio 는 **RBE 에 연결된 모든 노드(독립+종속)를
선택 자체에서 차단**한다. 그 결과 원하는 위치가 RBE 노드면 권상점을 못 찍고 엉뚱한 이웃 노드를
고르게 된다.

재검토 결론: **Wire 는 `CROD`(축방향 ROD = 유한강성 요소)로 모델링**되므로, RBE 독립/종속 어느
노드에 붙어도 그 자체로는 Nastran FATAL 사유가 아니다. 요소(element)는 어떤 grid 에도 붙을 수
있고, 종속노드(m-set)에 붙어도 요소 강성은 MPC 변환을 거쳐 독립노드로 전달될 뿐 합법이다.

FATAL 을 내는 것은 **요소가 아니라 다음 조건**이다(코드/Nastran 원리로 확인):
- RBE **종속 DOF 에 SPC 또는 다른 RBE/MPC 종속조건을 중복** 적용(USER FATAL 2101)
- RBE CM 에 Wire 하중 전달에 필요한 **병진 DOF 가 빠짐**
- Wire 방향으로 **구조 강성이 없어 mechanism**(USER FATAL 9050)
- **CROD 길이가 0** 이거나 매우 짧음
- Wire 만으로 **회전 자유도가 안 잡혀** 9050

→ "노드가 RBE 다"라는 사실은 Wire CROD 연결 금지 사유가 **아니다.** 전면 차단을 제거하고,
종속노드는 안내와 함께 허용하되, 실제 실행 전 **중복 구속/zero-length 만** 검증한다.

### 코드 근거 (실측)

- 차단 지점: `ThreeViewport.jsx:463‑472` — `sd.getRbeConnectedNodeIds().has(nodeId)` 면
  토스트 띄우고 `return`(권상점 추가 안 함).
- `StageData.getRbeConnectedNodeIds()`(StageData.js:409) — RBE2/RBE3 의 **independent +
  dependent 합집합**을 반환.
- 권상 모드 시각 강조: `NodePoints.applyHoistModeHighlight()`(NodePoints.js:130) — `rbeNodeSet`
  전체를 분홍(`COLOR_RBE_HOIST`)으로 칠해 "고르지 말 것"을 암시. `colorMode==='freeNode'`
  일 때는 비활성(기존 사용자 요구).
- **lug(권상점) 노드는 SPC 를 받지 않는다**: `build_lifting_bdf`(nastran_bridge.py)는 apex 에만
  `SPC1 …123456`, anchor 에만 `SPC1 …12`(후보에서 lug·apex·RBE 노드 **모두 제외**, line 3815‑
  3819)를 부여하고, lug 에는 **CROD 만** 붙인다. → lug 가 RBE 종속이어도 SPC 중복이 생길 여지
  없음.
- anchor 는 **SPC** 라서 종속노드에 걸면 2101 → `_pick_anti_rigid_body_anchor` 의 RBE 제외는
  **그대로 유지**(이 설계의 변경 대상 아님).

## 2. 변경 설계

### 2.1 Studio — 노드 역할 분류 (StageData)

`getRbeConnectedNodeIds()`(합집합)는 **유지**(기존 테스트/소비처 호환). 추가:

```js
// independent / dependent 를 분리해 반환(둘 다 포함될 수 있음 — 한 노드가 한 RBE 독립이자
// 다른 RBE 종속일 수 있으나, 권상 안내 목적상 'dependent 이면 dependent 우선' 으로 분류).
getRbeNodeRoles() -> { independent: Set<number>, dependent: Set<number> }   // lazy 캐시
getRbeNodeRole(nodeId) -> 'independent' | 'dependent' | null
```

- 규칙: 노드가 어떤 RBE 의 dependent 에 한 번이라도 들어가면 `'dependent'`,
  아니고 independent 면 `'independent'`, 둘 다 아니면 `null`.
- `getRbeConnectedNodeIds()` 는 `independent ∪ dependent` 로 재구현(동작 불변).

### 2.2 Studio — 선택 차단 제거 + 종속 안내 (ThreeViewport)

`ThreeViewport.jsx` hoist 픽 분기(463‑472)를 교체:

```text
hoistPickMode && nodeId != null:
   role = sd.getRbeNodeRole(nodeId)
   if role === 'dependent':
       flashHoistGuide("N{id} 은 RBE 종속노드입니다 — Wire 하중이 RBE 강체연결을 통해 전달됩니다.", 'info')
   addHoistNode(nodeId)         // 독립/종속/일반 모두 추가 (차단 없음)
   return
```

- 독립 노드·일반 노드: 토스트 없이 바로 추가(= "정상 권상점").
- 종속 노드: **선택 허용** + 안내 토스트 1회(차단 아님).
- 토스트 톤: 경고('noMode')가 아니라 정보('info' 또는 'success' 계열) — 차단이 아님을 분명히.

### 2.3 Studio — 권상 모드 강조 의미 전환 (NodePoints)

분홍 강조가 "차단"을 암시하던 것을 "정보(종속노드 = RBE 통해 전달)"로 바꾼다.

- `buildNodePoints`: `mesh.userData` 에 `rbeIndependentSet`, `rbeDependentSet` 를 함께 저장
  (기존 `rbeNodeSet` 은 합집합으로 유지 — 다른 참조 호환).
- `applyHoistModeHighlight(mesh, active)`: active 시 **dependent 노드만** info 색으로 칠하고,
  independent 는 원래 색 그대로(= 정상 권상점). 색 토큰은 차단 느낌의 분홍 대신 중립 정보색
  (예: 연한 청록/호박)으로 조정 — "한 색 = 한 의미" 유지.
- `colorMode==='freeNode'` 비활성 게이트는 유지.

### 2.4 Backend — 실행 전 검증 (build_lifting_bdf)

Wire 생성 시 다음만 검증(과도한 게이트 금지):

- **zero-length / near-zero wire**: 각 wire 의 lug 좌표와 apex 좌표 거리가 임계(예 `1e-3` mm)
  이하이면 명확한 에러(`SystemExit("Wire {eid}: lug N{n} 가 apex 와 동일 위치 — zero-length CROD")`).
  → 사용자에게 obscure FATAL 대신 의미 있는 메시지 제공.
- **lug-SPC 중복 방지(방어적 단언)**: 생성된 SPC 노드 집합(apex+anchor)과 lug 집합이 서로소임을
  단언/메타 기록. (현재 코드상 항상 참 — 회귀 안전망.)
- **meta 기록**: `lifting.wires[*]` 에 `lugRbeRole`(independent/dependent/none, 옵션) 를 추가해
  추적성 확보. (모델에 rigids 정보가 있을 때만.)
- MPC/SPC 중복·mechanism·CM 누락은 **구조적으로 방지**(apex‑only SPC, anchor RBE 제외,
  PARAM AUTOSPC,YES + BAILOUT,-1, apex SPC 123456 회전 구속)되므로 추가 게이트는 두지 않는다.

## 3. 유지(불변) 항목

- anchor `SPC1 …12` 의 RBE independent+dependent 제외 — **유지**(SPC 라 종속이면 2101).
- apex 는 항상 신규 노드 + `SPC1 …123456` — 유지.
- 안정화 PARAM(AUTOSPC,YES / BAILOUT,-1) — 유지.
- `getRbeConnectedNodeIds()` API 및 기존 테스트 — 유지(합집합 재구현).

## 4. 영향 받는 파일

Studio (`apps/module-unit-studio/src/`):
- `data/StageData.js` — `getRbeNodeRoles()` / `getRbeNodeRole()` 추가, `getRbeConnectedNodeIds()` 재구현
- `data/StageData.test.js` — 역할 분류 테스트 추가(기존 합집합 테스트 유지)
- `components/ThreeViewport.jsx` — 463‑472 차단 제거 → 종속 안내 후 허용
- `three/NodePoints.js` — userData 에 independent/dependent set, `applyHoistModeHighlight` dependent‑only
- `three/NodePoints.test.js`(있으면) 또는 신규 — 강조 대상이 dependent 로 한정되는지
- `package.json` — 버전 bump

Backend:
- `InHouseProgram/NastranBridge/nastran_bridge.py` + 미러 `WorkBenchSubModule/Nastran_bridge/nastran_bridge.py`
  — `build_lifting_bdf` zero-length 검증 + meta
- `tests/test_lifting_*` — zero-length 에러/meta 테스트

## 5. 테스트

Studio (vitest):
- `getRbeNodeRole`: 독립→'independent', 종속→'dependent', 무관→null, 독립이자 종속이면 'dependent'.
- `getRbeConnectedNodeIds` 합집합 동작 회귀(기존 테스트 유지).
- hoist 픽 로직(순수화 가능한 부분): 종속 노드 픽 시 addHoistNode 호출 + 안내, 독립/일반은 안내 없이 추가, 차단 0건.
- `applyHoistModeHighlight`: active 시 dependent 인덱스만 색 변경, independent 불변.

Backend (pytest):
- zero-length wire(lug==apex) → `SystemExit` with 명확 메시지.
- 정상 wire → meta.wires 에 `lugRbeRole` 기록, lug/SPC 서로소 단언 통과.
- (옵션·1회) 실제 lifting 모델에서 RBE 종속노드 lug 로 `_lifting.bdf` 생성→Nastran 실행→F06 FATAL 0
  확인(솔버 보유 PC). 자동화 회귀에는 미포함.

## 6. 배포

- Studio: 버전 bump + `npm run package` → zip/sha256 를 **로컬 백엔드 StudioProgram + UNC** 양쪽 복사.
  **사용자 명시 승인 후에만.**
- Backend: `nastran_bridge.py` 두 사본 동기 + **서버(145) 수동 교체 + 백엔드 재시작** 보고
  (git 미추적 → `git pull` 로 안 따라옴). 이미 생성된 `_lifting.bdf` 는 재실행해야 반영.
- 커밋: 한국어, `config.js` 스테이징 금지, `git add -A` 금지(특정 파일만).

## 7. Out of Scope

- RBE3 "리프팅 러그" 자동 삽입(이번엔 불필요 — CROD 직결로 충분).
- 임의 위치(노드 비스냅) Wire 픽.
- anchor 선정 로직 변경(RBE 제외 유지).
- 종속노드 lug 의 RBE CM 병진 누락 자동 진단(향후 필요 시 meta 경고로 확장).
