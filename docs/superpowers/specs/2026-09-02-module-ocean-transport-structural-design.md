# Module Unit 해상 운송 구조 해석 — 3단계(구조 해석 수행) 설계

> ## ⚠ 이 문서는 **구 2-과정 방식**의 설계다 (2026-09-02 작성)
> 2026-09-07 에 구조가 바뀌어 **아래 5·6장(과정 1 MU 단독 SPC 해석 / 과정 2 CoG 질점 +
> 가짜 기둥 모델)은 더 이상 구현과 일치하지 않는다.** 지금은 **정반 실형상 + Module Unit 을
> 한 덱으로 합쳐 한 번** 푼다. 바뀐 내용은 이 배너와 맨 끝 「12. 2026-09-07 구조 변경」에
> 정리했고, 그 외 장은 **설계 이력**으로 남겨 둔다(왜 그렇게 바꿨는지의 출발점이라 지운다).
>
> | 항목 | 이 문서(구) | 현재 구현 |
> |---|---|---|
> | 해석 횟수 | 2회(응력 / 반력) | **1회**(합본) |
> | 정반 | 모델에 없음 (접촉 절점 SPC) | **실형상 그대로** |
> | 경계조건 | 접촉 절점 SPC 123456 | **정반 자신의 Leg SPC 뿐** |
> | Leg 반력 | CoG 질점 + 500mm 스터브 빔 | **정반 Leg 절점의 SPC 반력** |
> | 적치 높이 기준 | 모듈 최하단 | **지지점마다 발밑 적치면 + 이격값** |
> | 정반 상면 | 한 장(z=8026) | **적치면 2층**(8026 / 2020) |
> | 중량 여유 | 미반영 | **MAT1 RHO·CONM2 에 실제로 곱함** |
> | 가속도 | 사용자 임의 3성분 | **Barge Excel(APOL) 재현 + 서버 재계산 대조** |
> | 용접 평가 | 4단계(범위 밖) | **3단계 과정 2 로 흡수** |

- 작성일: 2026-09-02
- 대상 App: `Module Unit 해상 운송 구조 해석` (viewer 없음, File-Based / 운송 카테고리)
- 범위: 파이프라인 **3단계** 구현. 2단계(적치·중량·CoG)는 이미 구현되어 있고, 4단계(용접부 강도 평가)는 이 문서 범위 밖이다.

---

## 1. 배경과 목표

2단계 "정반 상부 Module Unit 배치 설정"은 Module Unit(이하 MU)을 정반 위에 내려앉혀
접촉 절점·중량·무게중심을 산출한다. 3단계는 그 결과를 받아 **두 개의 독립적인 Nastran 해석**을
순차 수행한다.

| 과정 | 모델 | 목적 |
|------|------|------|
| 과정 1 | MU 단독 (정반 제외) | 접촉부를 경계조건으로 잡고 가속도 하중 → **Element Stress 평가** |
| 과정 2 | CoG 질점 + Leg 스터브 빔 | 합산 질량을 Leg로 분배 → **Leg 반력 산출** (4단계 용접 평가 입력) |

사용자는 가속도 3성분을 직접 입력한다(현재는 임의 값. 향후 선체 가속도 연계 여지를 남기되
이번 구현에는 포함하지 않는다).

---

## 2. 확정된 사양 (사용자 결정)

| 항목 | 결정 |
|---|---|
| 2→3단계 인계 중량·CoG | **정반 + MU 합산** 값 |
| 가속도 입력 | X/Y/Z 3성분 1세트, 단위 **g**, 단일 SUBCASE |
| 가속도 부호 규약 | 중력을 포함한 **총 가속도**. 정지 상태 = `(0, 0, -1.0)` |
| 과정 1 경계조건 | 전 접촉 절점 **SPC 123456** (6자유도 완전 고정) |
| 과정 2 모델 | Leg 위치에서 아래로 **500 mm H형강 스터브**를 세우고, 스터브 **상단**에 RBE2 Dependent, **하단**에 SPC. 스터브 단면 H-400×400×18×21 |
| 재질·허용응력 | SS275, σy = 275 MPa, 허용 = 0.8 × σy = **220 MPa** |
| 중량 여유(%) | **반영하지 않음** (순 모델 중량) |
| 결과 표시 | 요약 카드 + 표 (3D 색맵은 후속) |
| 구현 위치 | **백엔드 파이썬에서 BDF 조립** (nastran_bridge는 F06→JSON 파싱만 무변경 재사용) |

### 구현 위치를 백엔드로 정한 이유

`nastran_bridge.py`는 `InHouseProgram/`에 있어 **git 미추적**이다. 운영 서버(10.14.42.145)는
`git pull`로 코드를 받으므로 이 파일을 고치면 **매번 수동 교체**가 필요하고, 실제로 같은 경로에서
버전 드리프트 장애가 있었다(`rbe2_fixed_lines` 누락 → mooring solve HTTP 500, CLAUDE.md 기록).
BDF 조립은 순수 텍스트 조립이라 백엔드 서비스에 두면 git 하나로 배포가 끝나고 pytest도 쉽다.

---

## 3. 단위계

정반·MU BDF 모두 `MAT1 … 206000.0 … 0.3 … 7.85-9` → **mm · ton · s** 계다.

| 물리량 | 단위 |
|---|---|
| 길이 | mm |
| 질량 | ton (t) |
| 힘 | N |
| 응력 | MPa (= N/mm²) |
| 가속도 | mm/s² |

표준중력 `g = 9806.65 mm/s²`를 쓴다.
(`nastran_bridge.write_validation_bdf`는 9800을 쓰지만 그것은 모델 점검용 임시 하중이므로 따르지 않는다.)

화면 표시는 반력만 **kN**으로 환산한다(반력이 10⁵~10⁶ N 규모라 N 표기는 읽기 어렵다).

---

## 4. 데이터 흐름

### 4.1 2단계 → 3단계 인계

| 필드 | 출처 | 쓰임 |
|---|---|---|
| `bdfPath` | 1단계 업로드 BDF의 서버 경로 | 과정 1 원본 모델 |
| `deckType` (`"A"` \| `"B"`) | 2단계 정반 선택 | 과정 2 Leg 좌표 |
| `contactNodeIds: number[]` | `computeSeating().contacts` | 과정 1 SPC 대상 |
| `rotationZDeg` | `arrangement.rotationZDeg` | 과정 1 가속도 역회전 |
| `totalMassT`, `totalCogMm: [x,y,z]` | `combineMassProperties()`의 합산값(여유 미적용) | 과정 2 CONM2 |
| `accel: {ax, ay, az}` [g] | 3단계 신규 입력 | 두 과정 공통 GRAV |
| `material: {sigmaYMPa, factor}` | 3단계 신규 입력 (275 / 0.8) | 과정 1 허용응력 |

### 4.2 선행 수정 — 절점 ID 노출

현재 뷰어 슬림 페이로드(`slim_model_json`)는 연결도를 **0-based 인덱스**로만 내보내고
BDF 절점 ID를 버린다. 프론트가 접촉 절점의 실제 ID를 알 수 없다.

- `slim_model_json` 반환에 `nodeIds: number[]`를 추가한다(`positions`와 같은 순서).
  MU 모델 기준 수천 개라 페이로드 영향은 무시할 수준이다.
- `_PAYLOAD_SCHEMA`를 2 → 3으로 올리면 정반 `.viewer.json` 캐시가 자동 재생성된다.
  스키마 불일치 검사는 `get_jungban_viewer_model()`에 이미 있다
  (`module_ocean_transport_service.py:292`, `slim.get("schema") != _PAYLOAD_SCHEMA` → 재생성).
  추가 작업 없음.
- `computeSeating()`의 `contacts[]` 원소에 절점 인덱스 `i`를 추가한다.
  프론트는 `nodeIds[c.i]`로 실제 ID를 얻어 payload에 담는다.

### 4.3 API

```
POST /api/analysis/module-ocean-transport/structural-run   → { job_id }
GET  /api/analysis/status/{job_id}                          (기존 폴링 재사용, 1.5s)
```

요청 본문은 4.1 표의 필드를 담은 JSON. 응답 완료 시 `result_info`에 두 과정의 결과 JSON 경로와
요약이 들어간다.

`app/services/app_settings.py`의 `GUARDED_ROUTES`에는
`("/api/analysis/module-ocean-transport/", "Module Unit 해상 운송 구조 해석")`이
**이미 등록돼 있다**(샘플 실행 엔드포인트를 위해 추가된 것). `structural-run`도 같은
접두사라 자동으로 덮인다 — 추가 작업 없음. 주석만 이 엔드포인트를 포함하도록 갱신한다.

1단계 검증은 여전히 GMU 엔드포인트(`/api/analysis/groupmoduleunit/request`)를 재사용하므로
**GMU 앱이 차단되면 1단계도 함께 차단된다.** 3단계는 전용 경로라 영향을 받지 않는다.

### 4.4 작업 실행

`job_manager`의 `ThreadPoolExecutor`에 `task_execute_ocean_structural(job_id, payload)`를 제출한다.
한 job 안에서 과정 1 → 과정 2를 순차 실행하고 진행률을 0→50→100으로 보고한다.
버튼 하나가 결과 한 세트를 만드는 구조다.

산출물은 1단계 작업 폴더(`userConnection/<ts>_<employee>_<Program>/`)에 함께 떨어뜨려
기존 `GET /api/download`로 받을 수 있게 한다.

```
<stem>_ocean_stress.bdf        과정 1 해석 BDF
<stem>_ocean_stress.f06        과정 1 Nastran 출력
<stem>_ocean_stress.json       과정 1 평가 결과
<stem>_ocean_legreact.bdf      과정 2 해석 BDF
<stem>_ocean_legreact.f06      과정 2 Nastran 출력
<stem>_ocean_legreact.json     과정 2 반력 결과
```

DB에는 `program_name="ModuleOceanTransportStructural"` 레코드를 남기고
`input_info.parent_analysis_id`로 1단계 레코드를 참조한다
(`unit_structural_service.py`의 기존 관례를 따른다).

---

## 5. 과정 1 — Module Unit 단독 응력 해석

### 5.1 좌표계

2단계에서 MU를 `rotationZDeg`만큼 회전시켜 정반에 얹었지만, **BDF 절점 좌표는 건드리지 않는다.**
대신 전역(정반) 기준 가속도를 MU 로컬 좌표계로 변환한다.

```
θ = rotationZDeg
a_local = Rz(-θ) · a_global
        = [ ax·cosθ + ay·sinθ,  -ax·sinθ + ay·cosθ,  az ]
```

절점을 회전시키면 CBEAM 방향벡터·오프셋까지 함께 돌려야 해서 위험하다. 하중 벡터 세 숫자만
돌리는 쪽이 훨씬 견고하다. 결과 좌표계는 MU 로컬이며, 응력 평가는 좌표계와 무관하다.

### 5.2 BDF 조립 — `build_stress_bdf()`

```
SOL 101
CEND
TITLE = Module Unit Ocean Transport - Element Stress
SUBCASE 1
  LABEL = Ocean transport acceleration
  SPC = 990001
  LOAD = 990002
  DISPLACEMENT = ALL
  SPCFORCES = ALL
  FORCE = ALL
  STRESS = ALL
BEGIN BULK
  <원본 Bulk — 기존 구속 카드 제거>
  SPC1, 990001, 123456, <접촉 절점 ID … 고정필드 한 줄에 6개, 카드 반복>
  GRAV, 990002, 0, |a|·9806.65, n1, n2, n3
ENDDATA
```

- **생성 하중 SID는 동적으로 고른다.** 원본이 이미 `990002`를 하중 카드(GRAV/FORCE/PLOAD…)에
  쓰고 있으면 Nastran이 `USER FATAL MESSAGE 9994 (BULKPM)`로 **즉시 죽는다**(실제 Nastran으로
  재현 확인). `next_free_load_sid()`가 원본이 쓰지 않는 SID를 찾아 쓰고, Case Control의
  `LOAD =`도 같은 값을 가리킨다. SPC 계열은 아래에서 전부 걷어내므로 `SPC_SID`는 겹칠 수 없다.
- **기존 구속 제거**: `SPC`, `SPC1`, `SPCD`, `SPCAX`, `SPCADD`, `SUPORT`, `SUPORT1`과
  그 continuation line(고정필드 공백·`+`/`*` 마커·free-field 콤마 선행 **세 형태 모두**)을 제거한다. `nastran_bridge._strip_existing_constraints`와 동일 규칙을
  백엔드로 복제하고 pytest로 고정한다(원본 파일은 수정하지 않는다).
- `n = a_local / |a_local|`, `A = |a_local| · 9806.65`.
  `|a_local| = 0`이면 하중이 없으므로 요청을 400으로 거절한다.
- **카드 양식은 8칸 고정필드**를 쓴다(`nastran_bridge.bdf_line_fixed`와 같은 규약).
  `nastran_bridge.bdf_line`은 free-field(콤마)라 한 줄 9필드 제한을 넘길 위험이 있다.
  `SPC1`은 continuation 대신 **같은 SID 카드를 6절점씩 여러 장** 낸다(SID가 같으면 합산된다).
- 정반은 모델에 없다. 접촉 절점의 SPC 123456이 정반 역할을 대신한다.

### 5.3 결과 파싱과 평가

`nastran_bridge <f06>`(무변경 CLI) → JSON. SUBCASE 1에서 다음을 읽는다.

| 요소 | 결과 키 | 평가값 |
|---|---|---|
| CBEAM | `cbeamStress` | 요소의 두 단면(A/B) `sMax`·`sMin` 중 **절대값 최대** |
| CBAR | `cbarStress` | 동일 |
| CQUAD4 | `quadStress` | 상·하면 fiber **von Mises** 최대 |
| CTRIA3 | `triaStress` | 동일 |

CBEAM/CBAR의 `sMax`/`sMin`은 축력 + 굽힘의 합성 수직응력이다(전단·비틀림 미포함).
부재 검토의 통상적 기준이다.

```
사용률 = σ / 220 MPa        (허용 = sigmaYMPa × factor)
판정   = 사용률 ≤ 1.0 → OK, 초과 → NG
```

결과 JSON:

```jsonc
{
  "schema": "moduleOceanStress/1",
  "accelG": { "ax": 0.0, "ay": 0.0, "az": -1.0 },
  "accelLocalG": { "ax": 0.0, "ay": 0.0, "az": -1.0 },
  "rotationZDeg": 0,
  "allowableMPa": 220.0,
  "material": { "name": "SS275", "sigmaYMPa": 275.0, "factor": 0.8 },
  "spcNodeCount": 132,
  "summary": {
    "elementCount": 4312,
    "maxStressMPa": 187.4,
    "maxStressElementId": 10233,
    "maxUsage": 0.852,
    "exceedCount": 0
  },
  "topElements": [ { "elementId": 10233, "type": "CBEAM",
                     "stressMPa": 187.4, "usage": 0.852, "verdict": "OK" } ]
}
```

`topElements`는 응력 내림차순 상위 20개.

### 5.4 실패 처리

Nastran이 FATAL을 내면 `parse_f06_fatal_messages`로 메시지를 추출해 화면에 그대로 표시하고
**과정 2로 넘어가지 않는다.** 과정 2는 기술적으로 과정 1과 독립이지만, 과정 1의 FATAL은
접촉 절점 선정이 잘못됐다는 신호이므로(예: 접점이 1점뿐이라 mechanism) 멈추는 편이 안전하다.

---

## 6. 과정 2 — Leg 반력 모델

### 6.1 Leg 좌표 확보

정반 BDF의 `SPC` / `SPC1` 카드가 참조하는 절점이 곧 Leg다(A 6개, B 8개, 모두 Z = -125 mm).
`.viewer.json`과 같은 방식으로 BDF 옆에 `jungbanBDF_<A|B>.legs.json`을 캐시한다.

```jsonc
{ "schema": "jungbanLegs/1", "deckType": "A",
  "legs": [ { "id": 102723, "x": 20260.0, "y": 5200.0, "z": -125.0 }, … ] }
```

`InHouseProgram/` 아래에 두어 정반 BDF 수동 배포에 함께 따라가게 한다(`.viewer.json`과 동일 관례).

### 6.2 BDF 생성 — `build_leg_reaction_bdf()`

정반 실구조는 **포함하지 않는다.** 절점 2N+1개짜리 초경량 모델을 통째로 새로 만든다.

```
SOL 101
CEND
TITLE = Module Unit Ocean Transport - Leg Reaction
SUBCASE 1
  SPC = 990001
  LOAD = 990002
  DISPLACEMENT = ALL
  SPCFORCES = ALL
  FORCE = ALL
BEGIN BULK
$ SS275 — 스터브 자중 배제를 위해 RHO = 0
MAT1    1       206000. 0.3     0.0
$ H-400x400x18x21 : DIM = [웹순높이, 2·tf, 플랜지폭, 웹두께]
PBEAML  1       1               H
        358.    42.     400.    18.
$ Leg i — 상단 z=-125(RBE2 Dependent), 하단 z=-625(SPC)
GRID    9001            <x1>    <y1>    -125.
GRID    9101            <x1>    <y1>    -625.
CBEAM   9001    1       9001    9101    1.0     0.0     0.0
…
$ 합산 무게중심 — RBE2 Independent
GRID    9999            <cx>    <cy>    <cz>
CONM2   9999    9999    0       <합산질량 t>
RBE2    9900    9999    123456  9001    9002    …   900N
SPC1    990001  123456  9101    9102    …   910N
GRAV    990002  0       |a|·9806.65     n1      n2      n3
ENDDATA
```

RBE2 dependent가 되는 것은 **스터브 상단**이고 SPC는 **스터브 하단**에 걸리므로,
"RBE2 dependent DOF는 SPC로 구속할 수 없다"는 Nastran 제약(m-set / s-set 충돌)에 걸리지 않는다.
스터브 빔이 이 충돌을 구조적으로 해소하는 역할을 겸한다.

RBE2 continuation은 `nastran_bridge.rbe2_fixed_lines`와 동일한 고정필드 규약
(첫 줄 4개, 이후 줄 7개)을 따른다.

### 6.3 설계 판단

- **스터브 밀도 0** — 스터브 자중(단면적 23,244 mm² × 500 mm × 6개 ≈ 0.55 t)이 섞이면
  "반력 합계 = 질량 × 가속도" 검산이 흐려진다. 하중은 CoG의 CONM2 하나에서만 나오게 한다.
- **가속도 역회전 없음** — 이 모델은 처음부터 정반(전역) 좌표계라 입력값을 그대로 쓴다.
- **CBEAM 방향벡터는 전 Leg 동일** (`1.0, 0.0, 0.0`) — 6~8점 지지 강체는 정정이 아니라
  스터브 강성이 분배율에 관여한다. 전 Leg가 동일 단면·동일 방향이어야 분배가
  기하학적 배치만으로 결정된다.
- **정반 자중 포함** — CONM2 질량은 정반 + MU 합산이다. 정반 구조를 모델에 넣지 않는 대신
  그 자중을 CoG 한 점에 모아 Leg로 전달하는 근사다.

### 6.4 반력 추출

F06의 `SINGLE-POINT CONSTRAINT` 섹션을 `parse_point_vector_records(lines, "spcForce")`로 읽어
Leg 하단 절점별 `T1/T2/T3/R1/R2/R3`를 얻는다.

```jsonc
{
  "schema": "moduleOceanLegReaction/1",
  "deckType": "A",
  "accelG": { "ax": 0.0, "ay": 0.0, "az": -1.0 },
  "totalMassT": 100.05,
  "cogMm": [26685.0, 0.0, 12500.0],
  "legs": [
    { "index": 1, "jungbanNodeId": 102723, "x": 20260.0, "y": 5200.0,
      "fxN": 0.0, "fyN": 0.0, "fzN": 163500.0, "resultantN": 163500.0,
      "mxNmm": 0.0, "myNmm": 0.0, "mzNmm": 0.0 }
  ],
  "check": {
    "sumReactionN": [0.0, 0.0, 981200.0],
    "expectedN":    [0.0, 0.0, 981200.0],
    "maxRelError": 1.0e-6,
    "ok": true
  }
}
```

`check`는 화면에 검산 행으로 표시한다. 상대오차 허용치는 1e-3.
이 JSON이 그대로 4단계(용접부 강도 평가) 입력이 된다.

---

## 7. 화면

3단계 패널은 1·2단계와 같은 카드 레이아웃을 따른다.

```
┌ 해석 조건 ─────────────────────────────────────────────┐
│ 가속도 [g]   aX [  0.00 ]  aY [  0.00 ]  aZ [ -1.00 ]   │
│              ※ 중력을 포함한 총 가속도. 정지 = (0,0,-1) │
│ 재질  SS275   항복 σy [ 275 ] MPa  × 계수 [ 0.8 ]       │
│                             → 허용응력 220 MPa          │
└─────────────────────────────────────────────────────────┘
   [ 구조 해석 수행 ]

과정 1/2  Module Unit 응력 해석      ●실행 중
과정 2/2  Leg 반력 산출              ○대기
```

실행 버튼은 **2단계 적치가 성공(`seating.ok === true`)이고 관통이 0**일 때만 활성화한다.

결과:

```
┌ 과정 1 · Module Unit 응력 ─────────────────────────────┐
│  최대 응력 187.4 MPa   사용률 0.85   초과 0개           │
│  평가 요소 4,312개 · 허용 220 MPa                       │
│  [응력 상위 20개]  EID | 유형 | 응력[MPa] | 사용률 | 판정 │
└─────────────────────────────────────────────────────────┘
┌ 과정 2 · Leg 반력 ─────────────────────────────────────┐
│  Leg | 절점 | X | Y | FX | FY | FZ | 합력 [kN]          │
│  ─── 검산: Σ반력 981.2 kN / m·a 981.2 kN  ✓             │
└─────────────────────────────────────────────────────────┘
  산출물  _ocean_stress.{bdf,f06,json}  _ocean_legreact.{bdf,f06,json}
```

초과 요소가 있으면 요약 카드를 경고색으로 바꾸고 NG 행을 강조한다.
모멘트 열은 기본 접어 두고 펼침으로 제공한다.

페이지 상태 저장(`savedPageState`)에 `accel`, `material`, `structuralResult`를 추가해
페이지를 떠났다 돌아와도 결과가 유지되게 한다.

---

## 8. 변경·신규 파일

| 파일 | 내용 |
|---|---|
| `app/services/module_ocean_bdf.py` | **신규** — BDF 조립 순수 함수(파일 I/O·Nastran 없음) |
| `app/services/module_ocean_results.py` | **신규** — F06 JSON → 응력 평가·반력 추출 순수 함수 |
| `app/services/module_ocean_structural_service.py` | **신규** — 오케스트레이션(파일 I/O, Nastran 실행, job·DB) |
| `tests/test_module_ocean_bdf.py` | **신규** — BDF 조립 테스트 |
| `tests/test_module_ocean_results.py` | **신규** — 평가·반력 추출 테스트 |
| `app/routers/module_ocean_transport.py` | `POST /structural-run` 추가 |
| `app/services/module_ocean_transport_service.py` | `slim_model_json`에 `nodeIds` 추가(스키마 bump), `get_jungban_leg_nodes()` 추가 |
| `app/services/app_settings.py` | `GUARDED_ROUTES`에 전용 경로 등록 |
| `frontend/src/utils/feGeometry.js` | `contacts[]`에 절점 인덱스 `i` 추가 |
| `frontend/src/utils/feGeometry.test.js` | 위 회귀 테스트 |
| `frontend/src/api/analysis.js` | `requestModuleOceanStructural()` |
| `frontend/src/pages/analysis/ModuleUnitOceanTransportAnalysis.jsx` | 3단계 패널 실구현 |

---

## 9. 테스트 전략

BDF 조립 함수는 파일 I/O와 Nastran 실행 없이 **문자열을 반환하는 순수 함수**로 둔다.

**pytest (`tests/test_module_ocean_structural.py`)**

1. `build_stress_bdf` — 접촉 절점 20개 → `SPC1` 카드가 8/8/4로 쪼개짐
2. `build_stress_bdf` — 원본 Bulk의 `SPC`/`SUPORT` 및 continuation이 모두 제거됨
3. 가속도 역회전 — `rotationZDeg=90`, `a_global=(1,0,0)` → `a_local≈(0,-1,0)`
4. `|a| = 0` → `ValueError`
5. `build_leg_reaction_bdf` — Leg 6개 → GRID 13개, CBEAM 6개, RBE2 dependent 6개, SPC1 6개
6. `build_leg_reaction_bdf` — `PBEAML H` DIM이 `358./42./400./18.`
7. `MAT1` RHO가 0
8. 허용응력 판정 — σ=220.0 → 사용률 1.0 OK, σ=220.1 → NG
9. `get_jungban_leg_nodes("A")` → 6개, 모두 z=-125 (정반 BDF 픽스처 사용)
10. 반력 검산 — 합계가 `m·a`와 1e-3 이내

**vitest (`feGeometry.test.js`)**

11. `computeSeating().contacts[k].i`가 원본 절점 인덱스를 가리킴

**통합 확인 (수동 1회)**

`ModuleOceanMoving/ModuleUnitBDF_byModelBuilder/3521.bdf` + 정반 A로 실제 Nastran을 돌려
① 과정 1이 FATAL 없이 완료되고 ② 과정 2 반력 합계가 `m·a`와 일치하는지 확인한다.

---

## 10. 배포

전부 git 추적 파일이므로 운영 서버(10.14.42.145)는 **`git pull` + 백엔드 재시작**으로 끝난다.
`InHouseProgram/` 수동 교체 대상 없음.

정반 `.legs.json`은 최초 요청 시 자동 생성되므로 별도 배포가 필요 없다.
단, 정반 BDF(`jungbanBDF_A/B.bdf`)와 `.viewer.json`은 여전히 git 미추적이므로
**서버에 이미 배치돼 있어야 한다**(현재 배치 완료 상태).

`slim_model_json` 스키마 bump로 서버의 기존 `.viewer.json` 캐시는 자동 재생성된다.

---

## 10-A. Nastran 실측 검증 결과 (2026-09-03)

### 실측이 잡아낸 결함 3건 (모두 수정 완료)

1. **생성 하중 SID 충돌 → `USER FATAL 9994 (BULKPM)`**
   원본이 이미 `990002`를 하중 카드에 쓰면 즉사한다. `next_free_load_sid()`가 빈 SID를 고른다.

2. **접촉 절점이 RBE2 dependent면 → `USER FATAL 2101 (GP4) … ILLEGALLY DEFINED IN SETS UM US`**
   m-set(강체 종속) 자유도에 s-set(SPC)을 걸 수 없다. 과정 2는 스터브 빔으로 두 집합을
   갈라 뒀지만 **과정 1은 원본 모델에 그대로 SPC를 걸어서 이 함정을 놓치고 있었다.**
   `rigid_dependent_nodes()`로 걸러 내고, 제외된 절점 수를 결과에 싣는다.
   전부 제외되면 지지가 없으므로 명시적으로 실패시킨다.

3. **FATAL 메시지가 dict 원문으로 표시됨** — `_fatal_text()`가 `text` 키만 보는데
   nastran_bridge는 `message`/`lines`에 담는다. 사용자가 화면에서 원인을 못 읽는다.



FEA 검토에서 **실제 MSC Nastran V2013.1로 생성 덱을 돌려** 확인한 것:

- 카드 필드 배치(CONM2/PBEAML/RBE2/GRAV/MAT1) — QRG 정합, 입력 단계 FATAL·WARNING 없음
- PBEAML `H` DIM 순서 `(358, 42, 400, 18)` — 규약 일치
- m-set/s-set 충돌 없음 (RBE2 dependent와 SPC 대상이 서로 다른 절점)
- **과잉구속 우려 해소**: KLL 행렬 조건비 2.08, epsilon −6.03e-17로 깨끗하게 수렴.
  전 스터브가 동일 단면·방향이라 분배가 배치만으로 정해지는 볼트그룹 탄성분배와 동치다.
  RBE3 대안도 검토했으나 가중치라는 새 주관이 들어와 손계산 교차검증이 어려워진다 — 현 구성 유지.
- `SPCFORCES = ALL`이 하단 절점별 6성분을 F06 `FORCES OF SINGLE-POINT CONSTRAINT`에 출력
- **Σ SPC 반력 = 질량 × 가속도** (부호 반대) 실측 일치

남은 유의사항(결함 아님):
- 원본의 `PARAM,AUTOSPC`는 그대로 통과한다. 접촉 절점이 강체모드를 다 못 없애면 AUTOSPC가
  임의 절점을 조용히 고정해 진짜 모델링 결함이 묻힐 수 있다 → `scan_f06_warnings()`로
  F06의 AUTOSPC/USER WARNING을 걷어 결과에 실어 보낸다.
- 접촉 절점 6자유도 완전고정은 사용자의 명시적 선택이며 안전측이다. 접촉점 바로 옆 요소의
  응력이 허용을 근소하게 넘으면 국부 특이성 아티팩트일 수 있으니 구분해 볼 것.

---

## 11. 범위 밖 (후속)

- 4단계 용접부 강도 평가 — 이 문서의 `_ocean_legreact.json`을 입력으로 받는다.
- 다중 하중조건(LC 여러 개) 및 선체 가속도 연계 — 현재는 단일 세트 임의 입력.
- 3D 응력 색맵 뷰어 — 이번엔 표만.
- 접촉 조건의 압축 전용(compression-only) 처리 — 현재는 양방향 구속(SPC 123456).
- 정반 캐시(`.viewer.json`/`.legs.json`) 읽기·쓰기 제어흐름 공통화 — 현재 두 함수에 복제돼 있다.

---

## 12. 2026-09-07 구조 변경 — 두 과정 → **합본 모델 한 번**

이 문서 5·6장을 대체한다. 근거와 실측은 `app/services/module_ocean_merge.py` 모듈
docstring 과 `CLAUDE.md` 의 같은 절에 있다.

### 왜 바꿨나
정반이 모델에 없어서 ① Unit 응력이 **무한강성 지지** 위에서 계산됐고 ② Leg 반력의 모멘트
지렛대를 **임의로 세운 기둥 높이**가 정했다. 두 모델을 실제로 이어 한 번에 풀면 지지 강성과
반력이 같은 해에서 나온다.

### 지금의 절차
1. **1단계** — Module Unit BDF 검증(GMU 엔진 재사용, 폴더·기록은 이 앱 이름).
2. **2단계** — 정반 타입 선택 → **지지점 지정** → 배치(회전·오프셋) → 적치 검사.
   - 적치 높이는 사용자가 만지지 않는다:
     `baseZ = max over supports(landingZ + clearance − localZ)`.
     이격값은 상수 한 곳에서만 정한다 — 프론트 `feGeometry.DECK_CLEARANCE_MM` =
     백엔드 `module_ocean_merge.DEFAULT_CLEARANCE_MM` (**2026-09-08 현재 100mm**,
     그 전에는 300mm 였다). 문서·화면·테스트에 숫자를 박지 말고 이 상수를 참조할 것.
   - **정반은 2단이다.** 적치면을 면적비 5% 문턱으로 골라 층 목록을 만들고, 지지점마다
     자기 발밑 층을 찾는다. 층이 다르면 스툴 길이가 층마다 다르게 나온다.
   - 프론트(`feGeometry.computeSeatGap`)와 백엔드(`build_combined_bdf`)가 **각자** 계산하고,
     프론트가 보낸 `gapMm`·`deckCenterMm`·`deckTopZMm` 를 서버가 **대조**해 어긋나면 멈춘다.
3. **3단계** — Barge 가속도(Excel APOL 재현) 계산 → 합본 BDF 1개 → SOL 101 1회.
   - 경계조건: **정반 자신의 Leg SPC** 뿐. 하중: GRAV 하나(정반 자중 포함).
   - 지지점은 발밑 적치면의 가장 가까운 절점과 **RBE2 6자유도 강결**.
     **GN = Module Unit, GM = 정반**(쉘 절점의 drilling 강성이 0 이라 종속으로 빼야 한다).
   - 출력은 case control `SET` 으로 Module Unit 만(정반 쉘 27,000장의 응력까지 쓰면 F06 이
     수백 MB 가 된다). SPCFORCES 는 ALL — Leg 반력이 여기서 나온다.
   - 산출: `<stem>_ocean.{bdf,f06}` / `_ocean_stress.json` / `_ocean_legreact.json` /
     `_ocean_weld.json`.

### 이 구조에서 새로 생긴 방어선
| 방어 | 무엇을 막나 |
|---|---|
| `verify_renumbered` | +200000 재번호가 새어 정반 ID 를 가리키는 것 |
| `gapMm` / `deckCenterMm` / `deckTopZMm` 대조 | 화면이 본 배치와 서버가 푸는 배치가 다른 것 |
| 이격 검사(모든 절점 ≥ 이격값) | 지지점보다 낮은 부재가 정반을 파고드는 것 |
| `pair_supports_to_plate` 중복 배정 금지 | 정반 절점이 두 RBE2 의 종속이 되어 나는 m-set FATAL |
| `promote_partial_rigid_cm` (고박) | 운전 조건의 미끄러지는 배관 지지가 운송 하중 방향으로 자유로워 배관이 통째로 흔들리는 것 |
| `scan_f06_quality` + `assess_singularity_impact` | mechanism 이 남은 채 BAILOUT 으로 풀린 결과를 그대로 믿는 것 |
| 반력 평형 검산 | 질량·가속도와 반력이 맞지 않는 것 |

### 현재 구현이 **하지 않는** 것 (의도된 범위)
- 하중조건은 선택한 LC **한 개**다(포락 없음).
- 부재 판정은 `σ ≤ σy × 계수` 하나다 — **좌굴은 보지 않는다**.
- **정반 자체의 강도는 평가하지 않는다**(정반은 지지 강성과 Leg 반력을 위해 들어간다).
- 빔 응력은 축력 + 굽힘의 합성 수직응력이다(전단·비틀림 제외).
- 지지 RBE2 는 6자유도 강결이라 **인발도 견디는** 연결이다(압축 전용 아님).
- 모듈 안의 부분 구속 RBE2 는 **전부 6자유도로 승격**해 푼다(= 고박 상태). 참조 모델
  FEModel_1.bdf 가 RBE2 485개를 전부 123456 으로 두는 것과 같은 처리다.

위 다섯 가지는 3단계 화면의 「이 해석의 모델링 가정」 카드에 그대로 적혀 있다.
