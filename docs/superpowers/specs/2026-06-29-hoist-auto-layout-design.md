# Module Unit Studio — "권상 위치 자동 선정" (XY 구역 분할 + 권상 최적안 제안) 설계

**작성일:** 2026-06-29
**대상:** Module Unit Studio (`C:\Coding\WorkBenchSubModule\ModuleUnitStudio\apps\module-unit-studio`)

---

## 1. 목적

Hoist 탭에 **"권상 위치 자동 선정"** 버튼을 추가한다. 클릭하면 모델을 위에서 내려다본 **XY 평면 SVG 모달 에디터**가 열린다. 사용자는 X·Y 축으로 나눌 구역 개수(예: `1 × 2`)를 입력하고, **무게중심을 기준으로 생성된 분할선을 마우스로 드래그**해 구역을 조정한다. 각 구역(=권상 그룹)마다 권상 포인트 개수를 정수로 입력하면, 프로그램이 **권상 측면에서 가장 좋은 케이스(균형·분산·안정)를 계산해 포인트를 자동 제안**한다. 사용자는 제안을 그대로 쓰거나 마커를 드래그해 수정할 수 있다.

## 2. 범위

**이번 단계 포함**
- Hoist 패널에 `권상 위치 자동 선정` 버튼 + 결과 요약.
- SVG XY 모달: 모델 풋프린트 투영, 무게중심 표시, **드래그 가능한 분할선**, 구역별 정수 입력, **권상 최적안 자동 제안**, 제안 마커 드래그 수정.
- 결과(구역 정의 + 구역별 선택 노드)를 **자체 store에 보관 + 패널 요약 표시**.

**비포함 (다음 단계)**
- 파일(JSON/BDF) 출력, posture-stability 평가 연결, 기존 수동 `hoistGroups`와의 병합.
- 분할 개수/위치 자체의 자동 최적화(현재는 사용자 입력·드래그). 빔 질량 가중 구역 중심.
- 기존 수동 Hoist 패널·평가 흐름은 **그대로 둔다**(이 기능은 완전 독립).

## 3. 핵심 설계 결정 (확정)

| 결정 | 선택 | 근거 |
|---|---|---|
| 기존 기능 연계 | **독립 신규 도구** | 새 버튼·모달·자체 store. 기존 `hoistGroups`/posture-stability 평가 불간섭. |
| 권상 포인트 정의 | **가장 가까운 모델 절점 스냅** | 기존 hoist 로직이 노드 기반 → 이후 연계 용이. |
| 제안 방식 | **권상 최적안 탐색** | 단순 대칭 배치가 아니라 균형+분산+군집회피를 점수화해 최적 노드 조합 탐색. |
| 렌더링 | **SVG 2D 모달** | 드래그·히트테스트 자명, HTML 입력 겹치기 쉬움, 순수함수 테스트 용이, three.js와 완전 분리. |
| 구역 최소 포인트 | **2개** (기본 2, 최소 2) | 단일점 권상은 무의미. |

## 4. 좌표계 / 투영

- 모델 좌표: X·Y 수평, **Z 위(up)**, 단위 **mm**. (`StageData.nodeMap: Map<id,{x,y,z}>`, `StageData.bbox{minX..maxZ}`)
- 탑다운 = Z축에서 내려다봄 → 각 노드를 **(x, y)** 로 투영(z 무시).
- SVG는 y가 아래로 증가하므로 **화면 y는 모델 y를 반전**해 매핑. bbox에 ~6% 여백을 두고 `viewBox`에 맞춘다.
- 무게중심: `useStageStore.stageSummary.massProperties` 우선, 없으면(또는 회전·유체비움으로 stale) `computeMassFallback(stage).centerOfGravityMm` 사용(기존 패턴 그대로). 둘 다 없으면 **bbox 중심으로 폴백 + 안내**.

## 5. 축 / 분할 의미와 분할선 동작

- `divX = N` → X축 **N칸** → **N−1개 수직 분할선**(`dividersX`, x좌표 mm 배열).
- `divY = M` → Y축 **M칸** → **M−1개 수평 분할선**(`dividersY`, y좌표 mm 배열).
- 예) `1 × 2` → 수직선 0개·수평선 1개 → 위/아래 2구역. `2 × 2` → 수직 1·수평 1 → 4구역, 교점이 무게중심.
- **초기 분할선 위치 규칙** (`computeInitialDividers`):
  - 한 축의 분할선이 **1개(=칸 2개)** 면 → 그 선을 **무게중심 좌표**에 배치(2×2면 교점이 정확히 무게중심).
  - **2개 이상** 이면 → bbox 범위를 **균등 분할**해 배치.
- **드래그 제약** (`clampDivider`): 수직선은 `[bboxMinX, bboxMaxX]` 내, 좌우 인접 분할선을 넘지 못함(교차 방지). 수평선 동일. 드래그 시 구역·제안 실시간 재계산.
- divX·divY 범위 **1–6** 으로 클램프. 기본 **1 × 2**.

## 6. 구역 모델

- 구역 식별자: `regionId = c{col}_r{row}` (col=0..divX-1 = X 왼→오, row=0..divY-1 = Y 아래→위).
- 구역 경계: `splitRegions(bbox, dividersX, dividersY)` → 각 구역 `{ id, col, row, minX,maxX,minY,maxY }` (mm). 구역 개수 = `divX × divY`.
- 노드→구역 배정: `assignNodesToRegions(projectedNodes, regions)` — 노드 XY가 속한 구역에 배정. 경계선 위 노드는 **낮은 인덱스 구역**에 귀속(`x < divider` 규칙, 일관성). 각 구역은 `nodeIds: number[]` 보유.
- divX/divY 변경 시 regionId 체계가 바뀌므로 `pointsPerRegion`·`suggestions`·`overrides` 맵을 **리셋**(기본 포인트 2로 재시드).

## 7. 권상 최적안 제안 알고리즘

구역 R(노드집합 `S_R`)에 정수 `n (≥2)` 입력 시 → 그 구역의 최적 포인트 노드 `n`개를 산출. **결정적(deterministic)** — 동일 입력은 동일 결과(랜덤 미사용, 테스트 가능).

### 7.1 구역 중심 `C`
- 구역 내 포인트매스가 있으면 질량 가중 평균, 없으면 노드 XY 기하 평균. (`regionCenter(regionNodes, pointMasses)`)

### 7.2 점수 함수 `scoreLayout(P, C, region)`
선택 위치 집합 `P={p1..pn}`(XY), 구역 특성 크기 `D = 구역 대각선 길이`, 구역 면적 `A`.
- **균형(balance)** `eb = |centroid(P) − C| / D` → **작을수록 좋음**. 선택점 무게중심이 구역 무게중심과 일치하면 각 와이어가 하중을 고르게 분담(모듈이 수평으로 들림).
- **분산(spread)**
  - `n = 2`: `s = |p1 − p2| / D` (멀수록 좋음).
  - `n ≥ 3`: `s = convexHullArea(P) / A` (넓을수록 좋음, 공선이면 0).
- **군집 penalty** `cp = clamp(1 − minPairwiseDist(P)/(0.25·D))` (서로 너무 가까우면 벌점).
- **종합** `score = 0.6·(1 − clamp01(eb)) + 0.4·clamp01(s) − 0.3·cp` → **최대화**.

### 7.3 탐색 절차 (이상배치 → 노드 스냅 → 그리디 국소개선)
1. **이상 배치** `idealTargets(C, n, region)`: C 주위 반경 `r = 0.4 × 구역 반폭`에 n개를 대칭 배치.
   - `n=2`: 구역 장축 방향 ± 양쪽. `n=3`: 정삼각. `n=4`: 구역축 정렬 사각(코너). `n≥5`: 등각 링.
2. **후보·초기해**: 각 ideal target마다 **그 구역 내 최근접 노드 k개(기본 8)**를 후보로. 초기해 = 서로 다른 최근접 노드.
3. **그리디 국소개선**: 개선이 없을 때까지(최대 20회) 각 슬롯 i를 그 슬롯 후보들로 교체 시도, `scoreLayout`을 가장 키우는 교체를 채택(다른 슬롯과 중복 노드 금지).
4. 최적 `P`의 노드 id 배열 반환.

### 7.4 엣지
- `|S_R| < n` → 가능한 노드만 제안 + 경고 플래그. `|S_R| = 0` → 빈 구역 경고, 제안 없음.
- 공선/축퇴 구역 → hull 면적 0이면 분산항은 pairwise 거리로 대체(점수함수에 내장).
- 전체 관점: 구역 분할선이 무게중심에 정렬되고 각 구역이 자기 중심을 기준으로 균형을 맞추면, 전체 권상점 무게중심도 모델 무게중심에 근접(전역 최적화는 후속 과제로 명시).

## 8. 사용자 편집 모델

- **개수 변경**: 구역 정수 입력 수정(최소 2) → **그 구역만** 재제안(해당 구역 `override` 초기화).
- **위치 변경**: 제안 마커 ◆ 드래그 → 놓으면 **그 구역 내 최근접 노드로 재스냅**(`override` 기록). override는 그 구역 개수 변경 전까지 유지.
- 모달을 닫아도 store 상태 보존(재오픈 시 복원).

## 9. 파일 / 컴포넌트 구조

| 파일 | 종류 | 책임 |
|---|---|---|
| `src/data/hoistAutoLayout.js` | 신규(순수함수) | `projectNodesXY`, `resolveCog`, `computeInitialDividers`, `clampDivider`, `splitRegions`, `assignNodesToRegions`, `regionCenter`, `idealTargets`, `convexHullArea`, `scoreLayout`, `suggestPointsForRegion`, `snapToNearestNode` |
| `src/store/useHoistLayoutStore.js` | 신규(zustand) | 모달/분할/구역/제안/override 상태 + 액션 |
| `src/components/HoistAutoLayoutEditor.jsx` | 신규 | SVG 모달 UI(투영·분할선 드래그·구역 입력·마커 드래그·요약) |
| `src/components/HoistPositionPanel.jsx` | 수정 | `권상 위치 자동 선정` 버튼 + 결과 요약 + 모달 마운트 |
| `src/data/hoistAutoLayout.test.js` | 신규 | 순수함수 단위 테스트(TDD) |
| `src/store/useHoistLayoutStore.test.js` | 신규 | store 액션 단위 테스트 |

> 모달은 LeftDock 라우트가 아니라 Hoist 패널에서 토글하는 오버레이이므로 별도 `PanelDock` 재export 불필요.

### 9.1 store 상태 (zustand v5 — 셀렉터에서 새 객체/배열 반환 금지)
```js
{
  open: false,
  divX: 1, divY: 2,
  dividersX: [/* mm, len = divX-1 */],
  dividersY: [/* mm, len = divY-1 */],
  pointsPerRegion: { [regionId]: int },   // 기본 2, 최소 2
  suggestions:     { [regionId]: [nodeId] },  // 최적안 결과
  overrides:       { [regionId]: [nodeId] },  // 사용자 수정 우선
  warnings:        { [regionId]: string },    // 빈/부족 구역 경고
  // actions
  openEditor(stage), closeEditor(),
  setDivX(n), setDivY(n),           // 분할선·맵 리셋, 무게중심 기준 재배치
  setDividerX(i, xMm), setDividerY(i, yMm),  // 드래그(clampDivider)
  setRegionPointCount(regionId, n), // 최소 2, 해당 구역 재제안
  recomputeAll(stage),              // 전체 구역 제안 갱신
  setRegionPoints(regionId, nodeIds) // 마커 드래그 override
}
```
컴포넌트는 안정 ref(`s.divX`, `s.suggestions` 등)를 각각 구독하고 파생값은 렌더 본문에서 계산(무한 렌더 루프 회피).

## 10. 엣지 / 에러 처리

- 모델 미로드 → 버튼 비활성("모델을 먼저 로드하세요").
- 무게중심 없음 → bbox 중심 폴백 + 안내 배지.
- 빈/부족 구역 → 경고(`warnings`), 가능한 만큼만 제안.
- 평면(degenerate) bbox 가드(0 분모 방지). divX/divY 1–6 클램프, 포인트 ≥2.

## 11. 테스트 전략 (TDD)

**순수함수** (`hoistAutoLayout.test.js`)
- `projectNodesXY`: z 무시·좌표 보존.
- `computeInitialDividers`: 분할선 1개→무게중심, 2개↑→균등.
- `splitRegions`: 구역수 = divX·divY, 경계 정확.
- `assignNodesToRegions`: 노드가 올바른 구역, 경계 노드 규칙.
- `convexHullArea`/`scoreLayout`: 균형↑·분산↑이면 점수↑, 군집·공선 벌점.
- `suggestPointsForRegion`: n=2/3/4 결과가 노드, 중복 없음, 균형 개선(스왑 전후 점수 비교), 부족 구역 경고.
- `snapToNearestNode`: 최근접 선택.

**store** (`useHoistLayoutStore.test.js`)
- `setDivX/Y`: 분할선·맵 리셋, 기본 포인트 2 재시드.
- `setDividerX`: 인접·bbox 클램프.
- `setRegionPointCount`: 최소 2 강제, 해당 구역 재제안.
- `setRegionPoints`: override 보존, 개수 변경 시 초기화.

**컴포넌트**: 경량 렌더(모달 오픈 시 구역 입력·요약 표시) 1~2개.

## 12. 배포 (구현·검증 후, 별도 승인 시)

기존 스튜디오 배포 규약 그대로: `package.json` 버전 bump → `npm run package` → `release/module-unit-studio-<ver>.zip`(+`.sha256`) → 로컬 `HiTessWorkBenchBackEnd\StudioProgram\`(1순위) + UNC 아카이브 복사. 스튜디오 소스는 별도 레포라 zip만 배포(소스 커밋 안 함). **이 단계는 별도 승인 후 진행.**
