# Mooring Fitting 원인 진단 (Diagnosis) — 설계

- 작성일: 2026-09-03
- 대상: `MooringFitting` 엔진(C#) + WorkBench 백엔드(Python) + MooringFittingStudio + WorkBench 프론트
- 목적: 입력 오류·모델 결함·하중 누락·과대응력의 **원인을 사용자에게 문장으로 알려준다.**

## 1. 문제

사용자가 마주치는 두 상황 — ① 입력이 잘못돼 오류가 나거나 ② 해석은 됐는데 응력이 과대하게 나오는 경우 —
에서 **원인을 스스로 찾을 수단이 없다.** 화면에는 결과 숫자만 나오고, 그 숫자가 어디서 비롯됐는지
(어느 CSV 행, 어떤 자동 변형, 어느 하중) 되짚을 경로가 노출되지 않는다.

### 1.1 현황 실측 (NewCase_02, 2026-09-03)

| 구간 | 추적 | 근거 |
|---|---|---|
| ① CSV 파싱 | 가능 | `ParseSkip`(파일·라인·행종류·사유·원문) → `CSV_Parse_Skips.csv`. WorkBench 화면에 이미 표시 |
| ② 파싱 → 초기 FE | 가능 | `RawToFeRecord`. LINEAGE `00_BuildRaw` 609건 (`"Angle#198 id=HSTIFF idsp 6003 …"`) |
| ③ 초기 FE → 최종 모델 | **끊김** | 최종 CBEAM 1,748개 중 **1,446개(83%)가 lineage 이력 없음** |
| ④ 하중 생성 | 가능 | `Report_LoadCalculation_MF.csv` — MF_ID·LC·Node·SWL·Angle_H/V·F·SF + 산출근거 문장 |
| ⑤ 해석 건전성 | 강함 | `EquilibriumVerifier`(하중+반력=0, 1% 초과 실패), `F06ResultScanner`(FATAL·MECHANISM·MAXRATIO·EPSILON) |
| ⑥ 결과 → 원인 | **없음** | `BeamStressResult`는 `ElementID`만. CSV 행·하중과의 링크 없음 |
| ⑦ 사용자 노출 | **거의 없음** | Studio·WorkBench 어디에도 LINEAGE / MODEL_TRANSFORM_SUMMARY / 하중 CSV를 읽는 코드 없음 (grep 0건) |

### 1.2 ③이 끊긴 원인 두 가지

1. **역방향 인덱스 누락** — `LineageJsonWriter`가 `ElementId`/`RelatedElementId`만 인덱싱하고
   `Derivatives`/`Sources`를 무시한다. MeshRefinement는 분할을 부모에만 기록하므로
   (`elem 2 → derivatives [1634,1635,1636]`) 자식 1,000여 개가 자기 이력을 갖지 못한다.
   **데이터는 이미 있는데 쓰기 단계에서 버려진다.**
2. **부모 링크 부재** — 01/02/04단계의 `ElementCreated`는 `{"note":"By ExtendToBBoxIntersect"}` 뿐이다(1,331건).
   발행 주체가 `ModelDiffTracer`(전후 ID 집합 diff)라 태생적으로 parent-child를 모른다.
   클래스 주석도 *"한계: parent-child 관계는 표현 못 함"* 이라고 적고 있다.

### 1.3 확인된 제약

`solve-bdf`는 `edited.bdf` + `editedModel.json`만 받는다. **lineage를 전혀 모른다.**
반대로 결과 JSON은 이미 부재별 `nx/my/mz/mx/qy/usage`와 노드쌍을 싣고 있어 응력 성분 증거는 추가 작업이 거의 없다.

## 2. 결정 사항

| 항목 | 결정 |
|---|---|
| 진단 수준 | **원인 문장 자동 생성** (근거 데이터 제시에 그치지 않음) |
| 노출 시점 | **해석 전·후 모두** |
| 원인 범주 | 4개 전부 — 가짜 하중경로 / 하중 입력값 / 단면 부족 / 경계조건·연결 |
| 판정 위치 | **하이브리드** — 엔진은 증거, 백엔드는 문장 |

**하이브리드를 고른 이유**: 변경 빈도가 다르다. "어느 부재가 어느 CSV 행에서 왔나"를 계산하는 조인 로직은
한번 맞추면 거의 바뀌지 않고, "연장 몇 mm부터 의심할까 / 문구를 어떻게 쓸까"는 계속 바뀐다.
무거운 조인은 엔진에, 자주 바뀌는 규칙은 Python에 두면 **규칙 조정이 `git pull`로 끝난다**
(엔진에 두면 임계값 한 줄에도 exe 재빌드 + 서버 145 수동 교체 + 재시작이 붙는다).

## 3. 아키텍처

```
build-full ──► MODEL_EVIDENCE.json     (모델 증거: 출신·변형·하중경로·단면·경계)
                      │
solve-bdf  ──► <case>.result.json      (결과 증거: 성분응력·Usage — 이미 존재)
                      │
                      ▼
       backend: mooring_diagnosis.py   (임계값 + 우선순위 + 문장 템플릿)
                      │
                      ▼
              out/DIAGNOSIS.json  ──► Studio 패널 / 보고서 진단 장 / WorkBench 배너
```

**증거를 두 파일로 나누는 이유**: 모델 증거는 build-full 시점(파이프라인 메모리 안)에서만 조인할 수 있고,
결과 증거는 solve 이후에만 존재한다. 한 파일로 합치려면 solve-bdf가 build-full 산출물을 되읽어야 하는데
편집 모델 경로에서는 그 대응이 깨진다. `elementId` 조인은 백엔드에서 한다.

**조인 실패는 버리지 않고 정보로 쓴다.** 결과에는 있는데 모델 증거에 없는 `elementId`는
Studio에서 사용자가 추가한 부재다(보강 클론 900xxx 포함). 진단 문장의 근거가 된다.

**해석 전 진단도 같은 파일로 돈다.** `MODEL_EVIDENCE.json`만으로 판정되는 규칙(§5.1)은 build-full 직후 발동하고,
결과 증거가 붙으면 과대응력 규칙(§5.2)이 추가로 켜진다. 화면과 코드가 두 벌이 되지 않는다.

## 4. 엔진 변경

### 4.1 수리 ① `LineageJsonWriter` 역인덱스

인덱싱 대상에 `Derivatives`/`Sources`를 추가한다. 자식 ID에 대해서도 timeline 엔트리를 만들고
`relatedElementId`에 부모를 넣는다. **새 데이터 없이 1,000여 개 요소의 이력이 살아난다.**

- 파일: `src/MooringFitting.App/Io/Json/LineageJsonWriter.cs`

### 4.2 수리 ② `ModelDiffTracer` 기하 매칭 — "모든 신규 요소에 부모가 있다"는 전제를 버린다

modifier 8개를 고쳐 부모를 넘기게 하는 대신, 신규 요소를 두 종류로 구분한다.

- **분할 자식**(02·04·05) — 자식 선분이 부모 선분에 포함된다. 출신을 상속한다.
- **신설 부재**(`ExtendToBBoxIntersect`, `CollinearFreeEndCollapse`) — 자유단을 허공으로 뻗어 만든 구간이라
  **원 도면에 대응하는 행이 아예 없다.** 억지로 부모를 붙이면 "CSV 198행 때문"이라는 거짓 설명이 나온다.

`ModelDiffTracer`가 사전 스냅샷에 좌표까지 담고, 신규 요소마다 "이전 요소의 선분에 포함되는가"만 판정한다.
포함되면 출신 상속 + `relatedElementId`로 부모 기록, 아니면 `fabricated`로 표시한다.
**modifier는 손대지 않고 파일 하나로 끝난다.**

- 포함 판정 허용오차: 기존 `Tolerances.Geom` 을 그대로 쓴다(신규 상수를 만들지 않는다).
  방향은 `CollinearAngleTolRad`(3e-2), 선분과의 수직거리는 `CollinearDistTolMm`(20.0),
  끝점 일치는 `NodeMergeMm`(1.0). 이 값들이 곧 분할·정렬 modifier 가 쓰는 판정 기준이라,
  같은 tol 로 되짚어야 그들이 만든 자식을 빠짐없이 인식한다.
- 출신 저장: `FeModelContext.ElementOrigins` 사이드맵. `Element`는 불변 객체라 필드를 붙일 수 없다.
- 파일: `src/MooringFitting.Pipeline/Core/ModelDiffTracer.cs`,
  `src/MooringFitting.Core/Model/Entities/FeModelContext.cs`

### 4.3 신규 `MODEL_EVIDENCE.json`

부재별로 이미 조인된 증거. 백엔드가 추가 조인 없이 바로 판정에 쓴다.

```json
{ "elementId": 2312,
  "origin": { "kind": "derived", "rawKind": "Angle", "csvLine": 198,
              "rawId": "HSTIFF idsp 6003", "chain": ["00_BuildRaw", "05_MeshRefinement(3분할)"] },
  "transformOps": [ { "stage": "04_Connectivity", "code": "EXTEND_PROCESSED", "deltaMm": 1823.4 } ],
  "section":  { "propertyId": 47, "type": "L", "areaMm2": 2760, "iWeakMm4": 3.09e6 },
  "geometry": { "lengthMm": 490.2, "n1": 812, "n2": 1634 },
  "loadPath": { "loadNode": 1791, "hops": 2, "forceN": 1348414, "loadCases": [1005,1006] },
  "boundary": { "spcHops": 1, "spcSource": "AutoBottom" } }
```

`origin.kind`는 `derived` | `fabricated` 둘 중 하나이며, `fabricated`는 `stage`/`operation`을 갖는다.
`hops`는 하중 절점·SPC 절점에서 BFS 한 번으로 얻는다.
케이스 단위 블록(미반영 입력 행, 하중 건수, 연결 성분 수, 평형 잔차, effectiveWidth 편차)을 같은 파일에 얹어
**백엔드가 읽을 파일을 하나로 만든다.** 1,748개 요소 기준 700KB 내외.

### 4.4 `solve-bdf` 결과 JSON

`propertyId` 한 필드 추가. 나머지 성분응력은 이미 있다.

- 파일: `src/MooringFitting.App/Commands/SolveBdfCommand.cs`

### 4.5 `report` verb

`report <case-folder>`는 이미 케이스 폴더를 통째로 읽는다. **새 인자 없이** out에 `DIAGNOSIS.json`이 있으면
진단 장을 쓰고, 없으면 건너뛴다. **판정이 실패해도 보고서는 진단 장만 빠진 채 정상 생성되어야 한다.**

- 파일: `src/MooringFitting.App/Services/Reporting/MooringReportBuilder.cs`

## 5. 백엔드 판정 — `app/services/mooring_diagnosis.py`

순수 함수. 입력은 `MODEL_EVIDENCE.json` + `result.json` + F06 스캔 결과, 출력은 `DIAGNOSIS.json` dict.
파일 I/O·DB를 타지 않아 pytest로 규칙만 검증할 수 있다. 임계값은 모듈 상단 상수 한 곳에 모은다.

### 5.1 케이스 단위 규칙 (해석 전에도 발동)

| 코드 | 조건 | 문장 예 |
|---|---|---|
| `INPUT_ROW_DROPPED` | ParseSkip 중 Failure > 0 | "구조 CSV 3행이 반영되지 않았습니다. 해당 부재는 모델에 존재하지 않습니다." |
| `LOAD_NONE` | MF 또는 Winch 하중 0건 | "Winch 하중이 0건입니다. LOADCASE 행이 없거나 전부 빈 행입니다." |
| `EFFWIDTH_INCONSISTENT` | 유효폭 편차 > 1mm | "ANGLE 유효폭이 중앙값에서 N mm 벗어나 중앙값으로 대체했습니다." |
| `MODEL_DISCONNECTED` | 연결 성분 > 1 | "모델이 N개로 분리돼 있습니다. 분리된 쪽은 하중을 받지 못합니다." |
| `TRANSFORM_HEAVY` | 하중경로 변경 연산 총량 | "부재 제거 12·신규 연결 27·절점 병합 41건입니다." |
| `EQUILIBRIUM_FAIL` | 잔차 > 1% | "적용 하중과 반력이 N% 어긋납니다 — 하중이 모델에 도달하지 못했습니다." |
| `SOLVER_UNSTABLE` | MECHANISM / MAXRATIO / EPSILON | "강성행렬 조건수가 N입니다. 해가 신뢰 범위를 벗어납니다." |

`LOAD_NONE`은 현재 NewCase_02에서 실제로 걸린다(Winch 리포트가 헤더만 존재).

### 5.2 부재 단위 규칙 (과대응력)

| 우선 | 코드 | 근거 | 문장 예 |
|---|---|---|---|
| 1 | `FAKE_LOAD_PATH` | `origin.kind == fabricated` | "원 도면에 없는 부재입니다. 04_Connectivity가 1.8m 연장해 만든 구간이며 MF-F15 하중이 이리로 흐릅니다." |
| 1 | `BOUNDARY_ARTIFACT` | `spcSource == FreeEnd`, `spcHops ≤ 1` | "인접 절점이 자유단 SPC로 고정돼 있습니다. 이 SPC는 연결 끊김 검출용이라 실제 구속이 아니며 반력이 과도하게 집중됩니다." |
| 2 | `LOAD_INPUT_ANOMALY` | SWL·각도 이상치 | "CHOCK인데 Angle_V가 0°입니다 — 연직 성분이 빠졌습니다." |
| 3 | `LOAD_PROXIMITY` | `hops ≤ 2` & 큰 하중 | "MF-F15의 110t(SF 1.25 적용 1,348kN)이 2절점 거리에서 직결됩니다." |
| 4 | `SECTION_WEAK` | 성분 분해 + 약축 강성 비교 | "굽힘이 92% 지배하고, 약축 단면2차모멘트가 같은 종류 부재 중앙값의 1/4입니다." |

**우선순위의 근거**: 모델 결함이 먼저다. 순서를 뒤집으면 "단면을 키우세요"라고 답했는데 실은
원 도면에 없는 가짜 부재였던 경우가 생긴다. 사용자가 존재하지 않는 부재를 보강하러 가는 것이
이 기능에서 나올 수 있는 가장 비싼 오답이다. `SECTION_WEAK`은 **위 셋이 모두 깨끗할 때만** 나온다.

### 5.3 틀린 단정을 막는 장치

- **근거 수치를 문장에 항상 붙인다.** "굽힘 지배"가 아니라
  "굽힘 92%, 약축 Iyy = 3.09e6 mm⁴ (중앙값 1.24e7)". 사용자가 판정을 검증할 수 있어야 판정을 믿을 수 있다.
- **확신도 3단계**: `확정`(단일 근거로 결정 — 예: 원 도면 없음) / `유력`(임계값 초과) / `참고`(경향).
- **아무 규칙도 맞지 않으면 지어내지 않는다** —
  "하중·단면·모델 모두 정상 범위입니다. Usage 초과는 설계 여유 부족으로 보입니다."

### 5.4 대상 범위

Fail 부재 전부 + LC별 상위 N(보고서와 같은 N). 1,748개를 다 진단하면 노이즈가 된다.

### 5.5 초기 임계값 (실측 후 조정)

| 상수 | 초기값 | 성격 |
|---|---|---|
| `LOAD_PROXIMITY_HOPS` | 2 | 공학 판단 — 절점 거리 대신 실제 mm 로 바꿀 수 있음 |
| `SECTION_WEAK_RATIO` | 1/3 이하 | 공학 판단. 비교군 = **같은 PBEAML 단면 타입(I/T/L/BAR …)을 쓰는 부재 전체**, 비교값 = 약축 단면2차모멘트(`SectionGeometryCalculator.Iyy`)의 중앙값. 단면계수 Z 는 c 를 새로 유도해야 해 오류 여지가 커서 쓰지 않는다 |
| `BENDING_DOMINANT_RATIO` | 0.6 | 굽힘 지배 판정 |
| `EQUILIBRIUM_FAIL` | 1% | `EquilibriumVerifier.RelTolFail` 재사용 |
| `EFFWIDTH_TOL_MM` | 1.0 | CONTEXT.md 의 기존 도메인 약속 재사용 |

## 6. 노출

**보고서** — 6장(결과) 뒤·7장(결론) 앞. 결과를 보고 원인을 읽고 결론으로 가는 순서.
요약 페이지에는 케이스 단위 경고만 한 줄.

**실행 순서가 강제된다**: `solve-bdf` → 백엔드 판정 → `report`.
단, **백엔드는 현재 `report` verb 를 호출하지 않는다**(보고서는 CLI 로 생성 중이며 백엔드 연동은 별도 대기 항목).
따라서 이번 범위에서 백엔드가 하는 일은 solve 후 `out/DIAGNOSIS.json` 을 만들어 두는 것까지이고,
`report` 는 그 파일이 있으면 진단 장을 붙인다. 나중에 백엔드가 report 를 부르게 되면 순서만 지키면 된다.

**Studio** — 부재 클릭 시 `InspectorPanel`에 '진단' 섹션, 케이스 단위 진단은 `BottomReviewDock`에 목록.
initialFolder의 파일을 읽는 기존 구조를 그대로 쓴다.
해석 전 시점에는 모델 증거만 있으므로 과대응력 항목은 비어 있고 모델·하중·입력 진단만 표시된다.

**WorkBench 페이지** — `MooringFittingAssessment.jsx` 결과 영역에 진단 요약 배너.
CSV 파싱 결과 카드 옆에 붙인다.

## 7. 테스트

**엔진 — 커버리지가 회귀 테스트다.** 현재 최종 요소 1,748개 중 이력 보유 302개(17%).
수리 후에는 **전부가 `derived` 또는 `fabricated` 중 하나의 출신을 가져야 한다.**
이 비율을 테스트로 고정하면 modifier 추가로 추적이 다시 끊기는 순간 빨개진다.

**`ModelDiffTracer` 기하 매칭 단위 테스트** — 두 방향을 모두 박는다.
분할 자식은 부모 선분에 포함(상속), 연장 스텁은 비포함(`fabricated`).
이 판정이 뒤집히면 거짓 원인이 나오므로 가장 중요한 테스트다.

**백엔드 — 규칙별 pytest.** 규칙마다 발동/미발동 케이스를 최소 입력 dict로 만든다.
우선순위 규칙(모델 결함이 단면 부족을 이긴다)도 따로 테스트한다.

**통합 — 인수 조건.** NewCase_02 에서 `beam 2312 → 부모 → 초기 요소 → CSV 행` 이 나와야 한다.
오늘 이 조회는 `null` 을 반환한다.

## 8. 배포

| 대상 | 방법 | 비고 |
|---|---|---|
| `MooringFitting.exe` | `InHouseProgram/MooringFitting/` 교체 | **서버(145) 수동 복사 + 백엔드 재시작** (git 미추적) |
| `mooring_diagnosis.py` 등 백엔드 | `git pull` + 재시작 | 이후 규칙 수정은 이것만으로 반영 |
| MooringFittingStudio zip | 버전 bump → StudioProgram 2곳(백엔드-로컬 + UNC) | 프론트 수동 버전 핀 없음(manifest 자동 인식) |
| WorkBench 프론트 | 재배포 | |

## 9. 범위 밖

- Studio 화면 캡쳐를 보고서 그림으로 쓰는 연동(별건, 기존 대기 항목)
- 진단 결과를 근거로 한 **자동 수정 제안**(예: 단면 자동 상향). 이번엔 원인 설명까지만 한다.
- 원 도면(AM/PDF)과의 대조. 진단의 상한은 CSV 입력이다.
