# Independent Tank Assessment — 입력 Payload 명세

프론트엔드 `pages/analysis/IndependentTankAssessment.jsx`가 백엔드로 제출하는 입력 JSON의 스펙입니다.
백엔드 모델 구축 및 해석 파이프라인은 이 문서의 스키마를 기준으로 payload를 해석합니다.

- **예시 payload**: [`independent_tank_assessment.payload.json`](./independent_tank_assessment.payload.json)
- **단위**: 길이 = mm, 가속도 = g, 각도 = 도(°), 좌표 = mm (탱크 원점 `(0, 0, 0)` 기준 절대 좌표)

---

## 1. 최상위 구조

```jsonc
{
  "geometry":    { ... },   // 형상·판두께·보강재 정의
  "boundaryLoad":{ ... }    // 가속도·에어 벤트·경계조건
}
```

---

## 2. `geometry` — 형상 정의

### 2.1 탱크 외형 치수

| 필드 | 타입 | 범위 | 의미 |
|------|------|------|------|
| `L` | number | 100 ~ 100,000 mm | 길이 (X 축) |
| `B` | number | 100 ~ 100,000 mm | 폭 (Y 축) |
| `D` | number | 100 ~ 100,000 mm | 높이 (Z 축, 바닥 z=0 → 천장 z=D) |

### 2.2 `plate` — 판 두께

| 필드 | 타입 | 범위 | 의미 |
|------|------|------|------|
| `tp` | number | 3 ~ 100 mm | 판 두께 |
| `tcorr` | number | 0 ~ 10 mm, `< tp` | 부식 여유 (판 두께에서 차감되어 유효 두께 계산) |

### 2.3 `topOpen` — 상판 유무

| 값 | 의미 |
|----|------|
| `"closed"` | 폐쇄형 — 6면 모두 판 |
| `"open"` | 개방형 — 상판 없음 (z=D 면 제거) |

### 2.4 `stiffeners` — 보강재 배치

각 축(`L` / `B` / `D`)에 대해 별도 보강재 배치 정의가 들어갑니다.

#### 2.4.1 축별 보강재 정의 — `stiffeners.{L,B,D}`

| 필드 | 타입 | 의미 |
|------|------|------|
| `type` | `"uniform"` \| `"custom"` | 배치 방식 |
| `countMode` | `"interval"` \| `"count"` | uniform 모드에서만 유효. `interval`=간격(mm), `count`=갯수(EA) |
| `value` | number | uniform 모드에서만 유효. `countMode`에 따라 간격 또는 갯수로 해석 |
| `customDistances` | number[] | custom 모드에서만 유효. **끝 변에서부터의 누적 거리(mm)** 배열 |

**`type` 별 동작 정의**

- **`type: "uniform"`** — 축길이를 균등 분할.
  - `countMode: "interval"`: `value` mm 간격으로 보강재 배치 → 갯수 = `floor(axisLen / value) - 1`
  - `countMode: "count"`: `value`개를 균등 간격으로 배치 → 간격 = `axisLen / (count + 1)`

- **`type: "custom"`** — 사용자가 각 보강재 사이 거리를 직접 지정.
  - 첫 보강재는 끝 변(좌표 0)에서 `customDistances[0]` mm 떨어진 위치
  - 두 번째 보강재는 첫 보강재에서 `customDistances[1]` mm 떨어진 위치 (즉 절대 위치 = `customDistances[0] + customDistances[1]`)
  - **누적합이 축길이를 초과하면 검증 실패** — 프론트에서 차단되지만 백엔드도 재검증 권장

**예시** — L 축 길이 2000mm, custom 모드 `[300, 700, 500]`:
```
보강재 1: x = 300
보강재 2: x = 1000  (300 + 700)
보강재 3: x = 1500  (1000 + 500)
```

#### 2.4.2 단면 형상 — `stiffeners.section`

| 필드 | 타입 | 의미 |
|------|------|------|
| `type` | `"Flat"` \| `"T"` \| `"L"` | 단면 형상 |
| `A` | number, 30 ~ 500 mm | 주 치수 (Flat: 높이, T/L: 웹 높이) |
| `B` | number, 3 ~ 30 mm | 보조 치수 (Flat: 두께, T/L: 웹 두께) |
| `C` | number \| `null` | T/L 전용 — 플랜지 폭. Flat 일 때 `null` |
| `D` | number \| `null` | T/L 전용 — 플랜지 두께. Flat 일 때 `null` |
| `side` | `"Outside"` \| `"Inside"` | 판 표면 기준 보강재 부착 방향 |

**단면 좌표계 정의**

- 로컬 `X` = 판 표면 위 가로 방향 (보강재 길이축에 직교)
- 로컬 `Y` = 판 표면 법선 (외측이 `+Y`)
- 로컬 `Z` = 보강재 길이축 (extrude 방향)

**형상별 메모**
- `Flat`: 직사각형 단면 (`B × A`)
- `T`: 웹 `A × B` + 플랜지 `C × D` (웹이 판에 수직, 플랜지가 상단 좌우 대칭)
- `L`: 수직 leg `A × B` + 수평 leg `C × D` (웹 자유단이 판 접촉, 플랜지가 외부 꼭지점에서 +X 방향)

---

## 3. `boundaryLoad` — 하중 및 경계조건

### 3.1 가속도 — `acceleration`

| 필드 | 타입 | 범위 | 의미 |
|------|------|------|------|
| `x` | number | -3 ~ 3 g | X 축 가속도 |
| `y` | number | -3 ~ 3 g | Y 축 가속도 |
| `z` | number | -3 ~ 3 g | Z 축 가속도 (중력 포함 시 `-1`g가 기본값) |

### 3.2 에어 벤트 — `airVentHeight`

| 필드 | 타입 | 범위 | 의미 |
|------|------|------|------|
| `airVentHeight` | number | `≥ D`, 100 ~ 100,000 mm | 탱크 바닥부터 에어 벤트 출구까지의 높이 (정수두 계산용) |

### 3.3 경계조건 — `bcMode` + `bcNodes`

| 필드 | 타입 | 의미 |
|------|------|------|
| `bcMode` | `"auto"` \| `"manual"` | 경계조건 노드 선택 방식 |
| `bcNodes` | `{x, y, z}[]` | 경계조건 적용 노드 절대 좌표 배열 (mm) |

**모드별 동작**

- **`bcMode: "auto"`** — 탱크 바닥(z=0) 평면의 4 꼭짓점이 자동 고정.
  ```json
  [
    { "x": 0, "y": 0, "z": 0 },
    { "x": L, "y": 0, "z": 0 },
    { "x": L, "y": B, "z": 0 },
    { "x": 0, "y": B, "z": 0 }
  ]
  ```
  L/B 치수 변경 시 자동으로 동기화됩니다.

- **`bcMode: "manual"`** — 사용자가 3D 뷰어에서 클릭한 위치들이 그대로 `bcNodes`로 전송됨. 빈 배열도 가능.

---

## 4. 검증 요약 (백엔드 재검증 권장 항목)

- `L, B, D ∈ [100, 100000]` (mm)
- `tp ∈ [3, 100]`, `tcorr ∈ [0, 10]`, `tcorr < tp`
- 보강재 단면: `A ∈ [30, 500]`, `B ∈ [3, 30]`; `T`/`L` 형상이면 `C, D` 필수
- 가속도: `|x|, |y|, |z| ≤ 3`
- 에어 벤트: `airVentHeight ≥ D`
- 보강재 `custom`: 모든 거리 `> 0`, 누적합 `≤ 축길이`
- 보강재 `uniform` + `interval`: `value ∈ [50, axisLen/2]`
- 보강재 `uniform` + `count`: 정수, `value ∈ [0, floor(axisLen/100)]`

---

## 5. 향후 확장 예약 필드

현 시점에는 사용되지 않지만 추후 추가될 가능성이 있는 필드 (백엔드에서 무시해도 무방):

- `geometry.material` — 재료 물성 (E, ν, ρ, σ_y)
- `geometry.stiffeners.placement` — 보강재 ring을 박스 한 면에만 부착하는 옵션
- `boundaryLoad.pressure` — 정적 압력 하중 추가
- `boundaryLoad.dynamic` — 동적 응답 해석 옵션

---

_최종 갱신: 페이지 컴포넌트 `pages/analysis/IndependentTankAssessment.jsx` 기준._
