# FemScanner

MSC Nastran BDF(Bulk Data File) 파싱·검증·JSON 추출 CLI 도구 (.NET 8 / C#)

BDF 파일을 구조화된 JSON으로 변환하고, 두 단계 검증 보고서를 출력합니다.

- **단계 1 — BDF 기본 검토**: 파싱 요약, 참조 무결성 검증
- **단계 2 — Nastran 해석 검토** (`--nastran`): 하중 제거 후 Nastran 실행, F06 결과 파싱

---

## 요구사항

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- MSC Nastran (`--nastran` 옵션 사용 시에만 필요, PATH에 `nastran` 명령 등록 필요)

---

## 빌드 및 테스트

```bash
dotnet build FemScanner.sln
dotnet test FemScanner.Tests/FemScanner.Tests.csproj
```

---

## 사용법

```bash
dotnet run --project FemScanner -- <model.bdf> [옵션]
```

| 옵션 | 설명 |
|------|------|
| `<bdf파일>` | 분석할 BDF 파일 경로 (필수) |
| `--nastran` | Nastran 실행 후 F06 결과 파싱 (단계 2 추가) |
| `--help` | 도움말 출력 |

---

## 출력 파일

모든 파일은 **BDF와 동일한 폴더**에 생성됩니다.

| 파일명 | 생성 조건 | 내용 |
|--------|-----------|------|
| `<이름>.json` | 항상 | 파싱된 BDF 모델 전체 |
| `<이름>_validation_step1.json` | 항상 | **단계 1** — BDF 기본 검토 결과 |
| `<이름>_validation_step2.json` | `--nastran` 시 | **단계 2** — Nastran 해석 검토 결과 |

---

## JSON 스키마 레퍼런스

### `<이름>.json` — BDF 모델

```jsonc
{
  "grids": [
    { "id": 1, "coordId": 0, "x": 0.0, "y": 0.0, "z": 0.0, "outCoordId": 0 }
  ],
  "elements": [
    // cardType 필드로 요소 종류 구분
    { "cardType": "CQUAD4", "id": 1, "propertyId": 1, "nodeIds": [1, 2, 3, 4] },
    { "cardType": "CBEAM",  "id": 2, "propertyId": 2, "nodeIds": [1, 2] }
  ],
  "properties": [
    { "cardType": "PSHELL", "id": 1, "materialId": 1, "thickness": 2.0 },
    { "cardType": "PBEAML", "id": 2, "materialId": 1, "beamType": "BOX", "dims": [0.1, 0.2] }
  ],
  "materials": [
    { "cardType": "MAT1", "id": 1, "e": 2.1e11, "g": 8.1e10, "nu": 0.3, "rho": 7850.0 }
  ],
  "loads": [
    { "cardType": "FORCE",  "id": 10, "subcaseId": 0, "nodeId": 4,
      "coordId": 0, "magnitude": 1000.0, "direction": [0.0, 0.0, -1.0] },
    { "cardType": "GRAV",   "id": 1,  "subcaseId": 0, "coordId": 0,
      "scale": 9.81, "direction": [0.0, 0.0, -1.0] }
  ],
  "boundaryConditions": [
    { "cardType": "SPC1", "id": 20, "dof": "123456", "nodeIds": [1, 2, 3] },
    { "cardType": "SPC",  "id": 21, "nodeId": 4, "dof": "1", "value": 0.0 }
  ],
  "caseControl": {
    "globalDirectives": {},
    "subcases": [
      { "id": 1, "directives": { "LOAD": "10", "SPC": "20" } }
    ]
  },
  "parameters": [
    { "name": "WTMASS", "v1": "0.00259", "v2": "" }
  ]
}
```

---

### `<이름>_validation_step1.json` — 단계 1: BDF 기본 검토

오류가 없어도 파싱 요약과 검증 실행 내역이 항상 기록됩니다.

```jsonc
{
  "version": "1.0",
  "step": 1,
  "stepName": "BDF 기본 검토",
  "generatedAt": "2026-04-07T14:30:00+09:00",
  "sourceFile": "model.bdf",

  // "pass" | "warning" | "error"
  "status": "error",

  "summary": {
    "totalErrors": 1,       // 검증 규칙에서 발견된 오류 수
    "totalWarnings": 2,     // 검증 규칙에서 발견된 경고 수
    "parserWarnings": 1,    // 파싱 중 발생한 경고 수 (미지원 카드 등)
    "f06Fatals": 0,         // 항상 0 (step1 전용)
    "f06Warnings": 0        // 항상 0 (step1 전용)
  },

  "parsingSummary": {
    "cardCounts": {
      "grid": 120, "element": 85, "property": 5, "material": 3,
      "load": 12, "boundaryCondition": 4, "subcase": 1, "param": 2
    },
    // 요소/물성/재질/하중/경계조건 카드별 개수
    "elementBreakdown":  { "CQUAD4": 60, "CTRIA3": 25 },
    "propertyBreakdown": { "PSHELL": 4, "PBAR": 1 },
    "materialBreakdown": { "MAT1": 3 },
    "loadBreakdown":     { "FORCE": 8, "PLOAD4": 4 },
    "bcBreakdown":       { "SPC1": 4 },
    // 파서가 인식하지 못한 카드 목록 (Nastran에서는 정상일 수 있음)
    "parserWarnings": ["Line 45: 미지원 카드 'CELAS1'"]
  },

  // 실행된 검증 규칙 목록
  "rulesChecked": ["GridRule", "ElementRule", "PropertyRule",
                   "MaterialRule", "LoadRule", "BcRule"],

  // 오류/경고가 없으면 빈 배열 []
  "validationResults": [
    {
      "severity": "error",      // "error" | "warning"
      "cardType": "CQUAD4",
      "cardId": 101,
      "fieldName": "G1",        // 문제가 된 필드명
      "message": "노드 ID 9999에 해당하는 GRID가 존재하지 않습니다."
    }
  ]
}
```

---

### `<이름>_validation_step2.json` — 단계 2: Nastran 해석 검토

`--nastran` 옵션 사용 시에만 생성됩니다.

```jsonc
{
  "version": "1.0",
  "step": 2,
  "stepName": "Nastran 해석 검토",
  "generatedAt": "2026-04-07T14:35:12+09:00",
  "sourceFile": "model.bdf",

  // "pass" | "warning" | "error"
  "status": "error",

  "summary": {
    "totalErrors": 0,    // 항상 0 (step2 전용)
    "totalWarnings": 0,  // 항상 0 (step2 전용)
    "parserWarnings": 0, // 항상 0 (step2 전용)
    "f06Fatals": 1,      // F06에서 발견된 FATAL 수
    "f06Warnings": 2     // F06에서 발견된 WARNING 수
  },

  "f06Summary": {
    "fatalCount": 1,
    "warningCount": 2,
    "messages": [
      {
        "level": "fatal",       // "fatal" | "warning"
        "lineNumber": 142,
        "message": "*** FATAL ERROR 4276: ...",
        "context": "...(전후 2라인 포함 원문)..."
      },
      {
        "level": "warning",
        "lineNumber": 89,
        "message": "*** USER WARNING MESSAGE 4276: ...",
        "context": "..."
      }
    ]
  }
}
```

---

## 프론트엔드 구현 가이드

### 파일 로딩 패턴

```
1. <name>_validation_step1.json  → 항상 존재 → 단계 1 탭 표시
2. <name>_validation_step2.json  → 존재 여부 확인 → 존재하면 단계 2 탭 추가
```

### status 값에 따른 UI 처리

| status | 권장 표시 |
|--------|-----------|
| `"pass"` | 초록 배지 — 이상 없음 |
| `"warning"` | 노란 배지 — 경고 있음 |
| `"error"` | 빨간 배지 — 오류 있음 |

### 단계 1 화면 구성 요소

| 데이터 위치 | 표시 용도 |
|-------------|-----------|
| `parsingSummary.cardCounts` | 카드 수량 요약 카드 (GRID N개, 요소 N개 …) |
| `parsingSummary.elementBreakdown` | 요소 종류별 파이차트 또는 목록 |
| `parsingSummary.parserWarnings` | 미인식 카드 경고 목록 (정보성) |
| `summary.totalErrors` / `totalWarnings` | 검증 결과 카운트 배지 |
| `rulesChecked` | 실행된 검증 규칙 목록 |
| `validationResults` | 오류/경고 테이블 (severity로 색상 구분) |

### 단계 2 화면 구성 요소

| 데이터 위치 | 표시 용도 |
|-------------|-----------|
| `summary.f06Fatals` / `f06Warnings` | Fatal/Warning 카운트 배지 |
| `f06Summary.messages` | F06 메시지 목록 |
| `messages[].level` | `"fatal"` → 빨간, `"warning"` → 노란 행 강조 |
| `messages[].lineNumber` | F06 파일 내 위치 |
| `messages[].context` | 클릭 시 펼치는 원문 컨텍스트 |

### 단계 2 미실행 상태 처리

```
_validation_step2.json 파일이 없는 경우:
→ "Nastran 해석 검토를 실행하려면 --nastran 옵션을 사용하세요" 안내 표시
→ 단계 2 탭을 비활성화(disabled) 처리
```

### validationResults 항목 표시 예시

```
[Error]   CQUAD4 #101  (G1)  노드 ID 9999에 해당하는 GRID가 존재하지 않습니다.
[Warning] MAT1   #3    (E)   탄성계수(E)가 0입니다.
```

- `cardType` + `#` + `cardId` 로 카드 식별자 조합
- `fieldName`이 비어있지 않으면 괄호로 표시
- `severity === "error"` → 빨간, `"warning"` → 노란

---

## Nastran 연동 동작 방식

`--nastran` 옵션 사용 시 **모델 구조 자체의 유효성만 검증**하기 위해 다음 과정을 수행합니다.

1. 원본 BDF에서 하중 카드(`FORCE`, `MOMENT`, `PLOAD`, `PLOAD4`) 제거한 임시 BDF 생성
2. 기존 `GRAV`가 있으면 유지, 없으면 `9.81 Z축 하향` 기본값 자동 추가
3. 임시 BDF로 Nastran 실행 → F06 파싱
4. F06 결과를 `_validation_step2.json`으로 출력
5. 임시 파일(`.bdf`, `.f06`) 자동 삭제

하중 카드를 제거하는 이유: 하중 관련 오류가 Nastran 실패를 유발하지 않도록 하여, 메시 연결성·물성·경계조건 등 **모델 구조적 유효성**에만 집중.

---

## 검증 규칙

| 규칙 | 검사 내용 |
|------|-----------|
| `GridRule` | 중복 GRID ID, 비양수 ID |
| `ElementRule` | 노드 ID → GRID 참조 무결성, PropertyId → Property 참조 무결성 |
| `PropertyRule` | MaterialId → Material 참조 무결성 |
| `MaterialRule` | MAT1에서 E=0 && G=0 경고 |
| `LoadRule` | FORCE/MOMENT NodeId → GRID 참조 무결성 |
| `BcRule` | SPC/SPC1/MPC NodeId → GRID 참조 무결성 |

---

## 지원 카드 목록

| 카테고리 | 지원 카드 |
|----------|-----------|
| Grid | GRID |
| Element | CQUAD4, CTRIA3, CTETRA, CHEXA, CBAR, CBEAM, CROD, CONM2, RBE2 |
| Property | PSHELL, PSOLID, PBAR, PBARL, PBEAM, PBEAML, PROD |
| Material | MAT1, MAT2, MAT8 |
| Load | FORCE, MOMENT, PLOAD, PLOAD4, GRAV |
| Boundary Condition | SPC, SPC1, MPC |
| Case Control | SUBCASE, LOAD, SPC, METHOD, DISP, STRESS 등 |

<details>
<summary>카드별 상세 설명 보기</summary>

### 그리드
| 카드 | 설명 |
|------|------|
| `GRID` | 절점 (ID, CP, X, Y, Z, CD) |

### 요소
| 카드 | 설명 |
|------|------|
| `CQUAD4` | 사각형 쉘 요소 (4노드) |
| `CTRIA3` | 삼각형 쉘 요소 (3노드) |
| `CTETRA` | 사면체 솔리드 요소 (4노드) |
| `CHEXA` | 육면체 솔리드 요소 (8노드) |
| `CBAR` | 보 요소 (2노드 + 방향벡터) |
| `CBEAM` | 보 요소 고급 (2노드 + 방향벡터) |
| `CROD` | 봉 요소 (2노드) |
| `RBE2` | 강체 요소 (독립 노드 + 종속 노드) |
| `CONM2` | 집중 질량 요소 |

### 물성
| 카드 | 설명 |
|------|------|
| `PSHELL` | 쉘 물성 (MID, 두께) |
| `PSOLID` | 솔리드 물성 (MID) |
| `PBAR` | 보 물성 (MID, A, I1, I2, J) |
| `PBARL` | 보 물성 표준 단면 (MID, TYPE, 치수) |
| `PBEAM` | 보 물성 고급 (MID, A, I1, I2, J) |
| `PBEAML` | 보 물성 고급 표준 단면 |
| `PROD` | 봉 물성 (MID, A, J) |

### 재질
| 카드 | 설명 |
|------|------|
| `MAT1` | 등방성 재질 (E, G, Nu, Rho) |
| `MAT2` | 이방성 쉘 재질 (G11~G33, Rho) |
| `MAT8` | 직교이방성 재질 (E1, E2, Nu12, G12, G1z, G2z, Rho) |

### 하중
| 카드 | 설명 |
|------|------|
| `FORCE` | 절점 집중력 |
| `MOMENT` | 절점 집중 모멘트 |
| `PLOAD` | 면압 하중 |
| `PLOAD4` | 요소 면압 하중 |
| `GRAV` | 중력 하중 |

### 경계조건
| 카드 | 설명 |
|------|------|
| `SPC` | 단일 점 구속 |
| `SPC1` | 단일 점 구속 다중 노드 |
| `MPC` | 다중 점 구속 |

</details>

---

## 아키텍처

```
BDF 파일
  → BdfParser (CardReader, CaseControlParser)
  → BdfModel
  → BdfValidator (6 규칙)
  → [단계 1 보고서] → _validation_step1.json

  [--nastran 옵션]
  → BdfCheckFileBuilder (하중 제거 + GRAV 적용 임시 BDF)
  → NastranRunner
  → F06Parser
  → [단계 2 보고서] → _validation_step2.json
```

```
FemScanner/
├── Program.cs
├── Parsers/
│   ├── BdfParser.cs
│   ├── CardReader.cs
│   ├── CaseControlParser.cs
│   └── F06Parser.cs
├── Models/
│   ├── BdfModel.cs
│   ├── ValidationReport.cs       # ValidationReport, ParsingSummary, F06Section 등
│   ├── ValidationResult.cs
│   ├── Grids/, Elements/, Properties/, Materials/, Loads/, BoundaryConditions/
├── Validators/
│   ├── BdfValidator.cs
│   └── Rules/
├── Exporters/
│   └── JsonExporter.cs           # ExportModel(), ExportValidation()
├── Helpers/
│   └── BdfCheckFileBuilder.cs
└── NastranRunner/
    └── NastranRunner.cs
```

---

## 제한사항

- **대형 파일**: 수십만 카드 이상의 BDF에 대한 성능 최적화 미적용
- **continuation 카드 데이터**: 현재 파서는 continuation 라인의 추가 필드를 읽지 않음 (첫 번째 라인 필드만 파싱)
- **DMIG / DLOAD / RLOAD**: 미지원 카드는 스킵
- **MAT8**: 기본 필드만 파싱 — 온도 의존성 필드 미지원
- **Nastran 연동**: PATH에 `nastran` 명령 등록 필요, 라이선스 필요
- **Nastran 실행 타임아웃**: 기본 300초
