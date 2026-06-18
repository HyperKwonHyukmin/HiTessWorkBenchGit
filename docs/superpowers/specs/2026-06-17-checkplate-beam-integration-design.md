# Check Plate ↔ 1D Beam 통합 설계 (Design)

**작성일:** 2026-06-17
**대상:** SidePassageStudio(`apps/side-passage-studio`) + `nastran_bridge.py`(InHouseProgram/NastranBridge 미러)
**선행:** Check Plate 2D shell(structured mapped quad) 메시 — 이미 구현·배포(studio 0.0.52). 본 문서는 그 후속(§13 follow-up: "1D beam 통합").

---

## 1. 목표 (Goal)

Check Plate(2D shell)를 주변 1D beam과 구조적으로 연결한다. 두 가지 서로 다른 연결 메커니즘을 구현한다.

- **A. 측면 보강빔(같은 평면)** — 빔을 plate mesh 노드에서 **분할(split)** 하여 노드를 직접 공유.
- **B. 하부 지지빔(plate보다 ~12mm 아래)** — 노드 공유가 불가능하므로 **RBE2 강체 스티치**로 offset 간극을 넘겨 하중 전달.

비파괴 원칙: plate가 없는 영역의 빔, 이미 공유된 끝점, band 밖 빔은 **절대 변경하지 않는다**. 변환은 멱등(idempotent)해야 한다.

---

## 2. 배경 / 현재 상태 (worked example)

검증 기준 파일: `C:\Coding\WorkBenchSubModule\SidePassage\RawBdf\studioResult.bdf` (스튜디오 `bdfExport.js`가 내보낸 geometry-check deck, free-field). GRID 2515, CBAR 1693, CQUAD4 800.

### 메커니즘 A 실증 — 측면빔 E2913
```
CBAR,2913,10,1896,200,0.0,0.0,-1.0          # 빔: 1896 → 200
CQUAD4,3845,1011,2739,2746,2747,200          # shell, 끝점 200 공유
CQUAD4,3853,1011,2746,2755,1896,2747         # shell, 끝점 1896 공유
GRID,200 ,, 114295.0, 14887.0, 30272.0
GRID,2747,, 114383.0, 14887.0, 30272.0       # ← 빔 위 내부점(공선), 미공유
GRID,1896,, 114470.0, 14887.0, 30272.0
```
세 노드 모두 Y=14887, Z=30272 동일, X만 증가 → **2747은 빔 1896→200 구간 내부에 정확히 공선.** 그러나 빔이 거기서 안 쪼개져 shell과 노드를 공유하지 못함. → `E2913`을 2747에서 분할해 `1896→2747`, `2747→200` 두 CBAR로 만들어야 함.

### 메커니즘 B 실증 — 지지빔 E2800
```
CBAR,2800,8,1814,125,0.0,0.0,-1.0
GRID,1814,, 113830.0, 15191.6, 30260.0        # Z=30260
GRID,125 ,, 113830.0, 15364.3, 30260.0        # Z=30260
```
지지빔은 Z=30260. checked plate 본체는 **Z=30272**(pid 1011 shell 대부분). 차이 정확히 **12mm**. Z가 떨어져 노드 직접 공유 불가 → RBE2 필요. (E2800 위 plate는 Y>14887 영역으로 본 파일엔 아직 미생성 — 지지빔+plate의 대표 예시.)

### 핵심 관찰: 평면 분류가 이미 반쯤 되어 있다
`useCheckPlateStore.recompute()`의 beamNode 필터는 `Math.abs(n.z - z) <= 50`(plate 평면 ±50mm). 12mm < 50mm이므로 **하부 지지빔도 grid 자동감지(`detectGridLines`)에 이미 포함**되어, plate 격자선이 지지빔 XY 위에 놓인다 → plate 노드가 지지빔 노드 **바로 위(XY 일치)** 에 자연히 생성된다. 통합 모듈은 이 후보 빔들을 **Z-offset으로 재분류**만 하면 된다.

---

## 3. 아키텍처 (어디서 도는가)

plate는 `addCheckPlate` intent로만 보관되고, **실제 노드/요소 materialize는 export 시점**에 두 경로에서 독립적으로 일어난다:

| 경로 | 산출물 | 언어 |
|------|--------|------|
| 스튜디오 `bdfExport.js` | geometry-check BDF(`studioResult.bdf`) | JS |
| 백엔드 `nastran_bridge.py` | 해석 BDF(`_edited.bdf`) | Python |

→ 통합 변환은 **두 곳 모두**에 동일 알고리즘으로 필요. 기존 `gridDetect.js ↔ resolve_grid_lines` 미러 패턴을 그대로 따른다.

- **JS:** 새 모듈 `src/data/beamIntegrate.js`. 순수 함수, three.js/스토어 비의존(테스트 용이).
- **Python:** `nastran_bridge.py` 내 `integrate_beams(...)` (기존 `split_beam_at_node`, `split_beams_on_grid` 재사용/일반화).

두 구현은 **동일 테스트 벡터**로 동작 일치를 lock-in.

### 입력/출력 계약 (양 구현 공통 개념)
입력: `{ beams: CBAR[], plateNodes: {id,x,y,z,shared}[], plate: {planeZ, footprintPolygonXY}, params }`
출력(원본 모델에 적용할 변경 집합):
- `splitBeams`: 원본 EID → 대체 CBAR 세그먼트 리스트(pid·방향벡터 보존, 신규 EID)
- `rbe2Links`: `{ indepNode(beam), depNode(plate), cm:"123456" }[]`
- `extraPlateNodes`: 필요 시 지지빔 노드 위에 생성한 신규 plate GRID(거의 불필요 — §2 관찰)

`addCheckPlate` intent / `checkPlates[]` 데이터 스키마는 **변경 없음**(파라미터만 추가, 4번 참조). 통합은 export-time 파생이라 intent에 결과를 굳히지 않는다.

---

## 4. 메커니즘 A — 측면빔 분할

### 규칙
plate mesh의 **모든 노드**(둘레+내부) 각각에 대해, 어떤 기존 CBAR의 **양 끝점이 아닌 내부 점**과 일치하면(공선 + 구간 내부, 허용오차 `splitTolMm` 기본 1.0) 그 빔을 그 노드에서 분할한다.

판정(점 P가 빔 A→B 내부에 있는가):
1. 공선: `|(P-A) × (B-A)| / |B-A| ≤ splitTolMm` (점-직선 거리)
2. 구간 내부: `0 + ε < t < 1 - ε`, where `t = (P-A)·(B-A)/|B-A|²`, `ε`는 `splitTolMm/|B-A|`
3. 끝점 제외: P가 A 또는 B와 `splitTolMm` 이내면 스킵(이미 공유)

### 분할
`CBAR(eid, pid, GA, GB, vec)` → 내부점들을 A→B 방향 t순 정렬 후 연쇄 분할:
`CBAR(newEid1, pid, GA, P1, vec)`, `CBAR(newEid2, pid, P1, P2, vec)`, …, `CBAR(newEidN, pid, Pk, GB, vec)`.
- 원본 EID는 제거(또는 첫 세그먼트로 재사용). pid·방향벡터·기타 필드 보존.
- 신규 EID는 현재 최대 EID+1부터(백엔드 `_next_id` 패턴) — **중복 EID 절대 금지**(과거 split_beam_at_node 버그 재발 방지: 세그먼트 추가 후 다음 id 계산).

### 백엔드 일반화
기존 `split_beams_on_grid`는 **격자선 교차**에서만 분할 → plate mesh 세분점(예: 2747은 격자선이 아닌 elementSize 분할점일 수 있음)을 놓침. 탐지를 **"모든 coincident plate 노드"** 로 확장한다.

---

## 5. 메커니즘 B — 하부 지지빔 RBE2 스티치

### 탐지 (어떤 빔이 지지빔인가)
plate별로 후보 빔을 Z-offset으로 분류:
- `|Δz| ≤ planeTolMm`(기본 1.0) → **IN-PLANE** → 메커니즘 A로 처리.
- `planeTolMm < (planeZ − beamZ) ≤ offsetBandMm`(기본 50.0) **이고** 빔이 plate footprint(XY 폴리곤) 내부에 투영됨 → **SUPPORT(offset)** → RBE2.
- 그 외 → 무시.

(Δz는 빔 양 끝 평균 Z 기준. plate는 수평 데크 가정 → offset 방향 = −Z. 비수평 plate는 비목표, §8.)

### 정렬 + 연결
1. 지지빔을 **plate 격자선과의 XY 교차점**에서 분할(메커니즘 A와 동일 split 함수, 단 plate 노드가 아닌 격자 교차 X/Y 기준) → 빔 노드가 plate 노드 바로 아래에 정렬.
2. 각 지지빔 노드에 대해, **XY가 일치(`stitchTolMm` 기본 1.0)하는 plate 노드**를 찾아(§2 관찰로 대개 이미 존재; 없으면 `extraPlateNodes`로 생성) 페어를 만든다.
3. 페어마다 RBE2 생성: **independent = 지지빔 노드(master), dependent = plate 노드(slave), CM = 123456.**

### RBE2 카드 (free-field)
```
RBE2, EID, GN(=beam node), CM(=123456), GM1(=plate node)
```
- 신규 RBE2 EID는 요소 EID 공간과 분리 충돌 없게 채번(최대 EID+1 연속).
- **중복 종속 방지(필수):** 한 plate 노드는 **최대 1개 RBE2의 dependent**. 두 지지빔이 한 plate 노드 아래에서 만나면 첫 빔에만 스티치(dedupe by depNode). RBE2 dependent DOF 중복은 Nastran FATAL.

---

## 6. 파라미터 / 기본값

| 이름 | 기본 | 의미 |
|------|------|------|
| `splitTolMm` | 1.0 | 빔 위 노드 공선/구간 판정 허용오차 |
| `planeTolMm` | 1.0 | IN-PLANE 판정(같은 평면) |
| `offsetBandMm` | 50.0 | 지지빔 인정 최대 하향 offset |
| `stitchTolMm` | 1.0 | 지지빔 노드↔plate 노드 XY 일치 |
| `rbe2Cm` | `123456` | RBE2 구속 DOF(완전 강체 offset) |

스튜디오 UI 노출은 최소화(기본값으로 동작). 필요 시 추후 고급 옵션.

---

## 7. 비파괴 / 멱등성 / 테스트

### 불변식
- plate footprint 밖, band 밖, 이미 공유된 끝점의 빔은 **불변**.
- 통합을 두 번 적용해도 결과 동일(멱등). 이미 분할된 빔에 같은 노드 재적용 시 no-op.
- 분할 전후 빔 **총 길이/연속성 보존**, EID **전역 유일**.
- RBE2 dependent plate 노드 **유일성**(중복 종속 0).

### 테스트 전략
- **JS(vitest):** `beamIntegrate.test.js` — (a) E2913@2747 분할 → 2 CBAR, 끝점 보존; (b) 지지빔 12mm → RBE2 1개, CM=123456, dependent 유일; (c) footprint 밖 빔 불변; (d) 멱등; (e) 다중 내부점 연쇄 분할 EID 유일.
- **Python(pytest):** `test_integrate_beams.py` — JS와 동일 시나리오(동일 좌표 벡터) 미러.
- **회귀:** 기존 studio 252 / backend 21 테스트 무회귀.
- **수동 검증:** `studioResult.bdf` 재현 입력으로 export → E2913 분할 + (지지빔 있는 plate에) RBE2 생성 육안 확인.

---

## 8. 비목표 (Non-goals)

- 비수평(기울어진) plate의 통합 — 후속.
- 지지빔 offset 카드(CBAR/CBEAM WA/WB) 정식 방식 — 본 설계는 RBE2 채택(사용자 결정).
- stiffener/flatbar 자동 생성, plate 질량의 안정성 해석 반영 — 별개 follow-up.
- 곡면/이중곡률 plate.

---

## 9. 구축 순서 (Phasing)

- **Phase 1 — 메커니즘 A(분할):** JS `beamIntegrate.js`(split만) + `bdfExport.js` 연결 + 백엔드 `integrate_beams`(split 일반화). `studioResult.bdf`로 E2913 분할 검증. 회귀 0.
- **Phase 2 — 메커니즘 B(RBE2):** 동일 모듈에 지지빔 탐지 + RBE2 추가. 양 export 경로 + 테스트.

각 Phase는 독립적으로 동작·테스트 가능한 산출물.

---

## 10. 배포 영향 (CLAUDE.md 규칙)

- 스튜디오: `package.json` 버전 bump → `npm run package` → **백엔드-로컬 `StudioProgram/` + UNC** 양쪽 복사.
- `nastran_bridge.py`: `WorkBenchSubModule/Nastran_bridge`(소스) ↔ `InHouseProgram/NastranBridge`(미러) **동시 갱신**. git 미추적 → **서버(145) 수동 교체 + 백엔드 재시작** 필요(커밋 보고에 명시).
