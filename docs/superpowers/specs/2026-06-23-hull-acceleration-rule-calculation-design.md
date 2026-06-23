# 선급 Rule 기반 선체 가속도 Calculation — 설계 문서

작성일: 2026-06-23
대상 앱: HiTESS WorkBench — `선급 Rule 기반 선체 가속도 Calculation`
상태: 텍스트 추출만 동작 중 → **실제 가속도 계산 적용**

## 1. 목적 / 배경

Trim & Stability(T/S) Booklet PDF의 `Summary of Loading Conditions` 표와 선박 제원·계산 위치를
입력으로, 선급(Classification Society) Rule에 따른 **선체 가속도(X/Y/Z)** 를 계산한다.

기준 원본은 사내 Excel `Data/3441_Rule_acceleration_at_any_points.xlsx` 이다. 이 워크북은
6개 시트로 구성된다.

| 시트 | 역할 |
|------|------|
| `General` | 선박 제원·loading condition 입력 + 5개 Rule 결과를 모아 Envelope(최댓값) Summary 산출 |
| `BV-Ship rule` | Bureau Veritas — Pt B, Ch 5, Sec 3 |
| `DNVGL-Ship rule` | DNV GL — Pt 3, Ch 4, Sec 3 (Envelope Accelerations) |
| `IGC-CODE` | IGC Code — 4.28.2 guidance formulae |
| `CSR` | Common Structural Rules — Pt 1, Ch 4, Sec 3 (Acceleration at any position) |
| `LR` | Lloyd's Register — Pt 3, Ch 9, Sec 9 (Machinery on deck) |

현재 구현 상태:
- 프론트 `HullAccelerationPage.jsx`: PDF 업로드 → `/api/analysis/hullacceleration/request` → 추출된 표 렌더.
- 백엔드 `hull_acceleration_service.py`: `extract_summary_loading_conditions.py` 실행 → JSON/CSV/TXT.
- `ts_acceleration_calculator.py`(개발본, 미배포·미연동): 추출 표 → Excel `General` 시트의 per-condition
  파생값(LCG/GM/CB) 재현. ShipConstants가 **3441 전용으로 하드코딩**되어 있고 가속도 계산은 없음.

## 2. 결정 사항 (확정)

1. **Rule 범위**: 5종 전부(BV·DNVGL·IGC·CSR·LR) + Envelope Summary.
2. **입력 방식**: PDF 업로드 + **프론트 입력 폼**(선박 제원·계산 위치). 3441 값 프리필.
3. **결과 범위**: Envelope + 선급별(rule) + 조건별(per-condition) 상세.
4. **엔진 구조**: 단일 오케스트레이터 CLI `ts_hull_acceleration.py` 하나로 extract→conditions→rules→envelope.
5. **조건별 입력(Loading Type, Roll Gyration)**: 자동 기본값 + 결과 화면에서 편집 가능.
6. **포팅 전략(Approach A)**: Excel 수식을 순수 Python으로 손수 이식, Excel 캐시 계산값과 셀 단위 대조 검증.
   런타임에 Excel/COM 의존 없음(서버 145 배포 가능). COM은 **개발 중 교차검증 전용**.

## 3. 아키텍처

```
[Frontend HullAccelerationPage.jsx]
  PDF 업로드 + 제원/위치/조건 입력 폼
        │  multipart: pdf_file + constants(JSON) + (optional) condition_overrides(JSON)
        ▼
[POST /api/analysis/hullacceleration/request]  (routers/analysis.py)
        │  work_dir에 pdf + constants.json 저장 → job 제출
        ▼
[hull_acceleration_service.task_execute_hull_acceleration]
        │  ts_hull_acceleration.py 1회 실행
        ▼
[InHouseProgram/TS/ts_hull_acceleration.py]  (단일 오케스트레이터 CLI)
        ├─ extract_summary_loading_conditions.extract()  : PDF → 표(JSON/CSV/TXT)
        ├─ ts_acceleration_calculator.build_*()           : 표 → LoadingCondition[] (LCG/GM/CB)
        ├─ ts_rules.{csr,dnvgl,igc,bv,lr}.compute(...)    : 조건별 X/Y/Z 가속도 + max
        └─ envelope/ranking 합성 → result.json
        ▼
[result.json] → result_info에 경로 저장 → 프론트가 download로 읽어 렌더
```

### 엔진 모듈 (개발: `WorkBenchSubModule/TS/`, 배포: `InHouseProgram/TS/`)

| 파일 | 역할 | 비고 |
|------|------|------|
| `extract_summary_loading_conditions.py` | PDF → 표(JSON/CSV/TXT) | 기존. `extract()` 함수 재사용 |
| `ts_acceleration_calculator.py` | 추출 표 → `LoadingCondition[]`(LCG/GM/CB) + ShipConstants | **ShipConstants를 입력 주입형으로 리팩터** |
| `ts_rules/__init__.py` | 5개 rule 등록/공통 타입(`RuleResult`, `AccelResult`) | 신규 |
| `ts_rules/csr.py` `dnvgl.py` `igc.py` `bv.py` `lr.py` | rule별 `compute(constants, position, conditions)` | 신규. 시트 1:1 이식 |
| `ts_hull_acceleration.py` | 오케스트레이터 CLI | 신규. `<pdf> --constants c.json --out result.json` |
| `validate_against_excel.py` | 개발 전용 parity 검증(캐시값/COM) | 신규. 배포 제외 가능 |

각 rule 모듈은 **독립적으로 테스트 가능**해야 한다: 입력은 `(constants, position, conditions[])`,
출력은 `RuleResult`(아래 §5). 다른 rule을 읽지 않고도 무엇을 하는지/어떻게 쓰는지 알 수 있어야 한다.

## 4. 입력 계약

### 4.1 ShipConstants (프론트 폼 → constants.json), 3441 기본값

| 키 | 라벨 | 단위 | 3441 기본 | Excel General |
|----|------|------|-----------|---------------|
| `lbp` | LBP | m | 281.3 | C2 |
| `length` | L (Rule length) | m | 281.3 | C3 |
| `breadth` | B | m | 46.1 | C4 |
| `depth` | D | m | 26.3 | C5 |
| `scantling_draft` | TSC | m | 12.5 | C6 |
| `scantling_cb` | Cb | - | 0.7417 | C7 |
| `speed` | Vs | m/s | 10.0 | C8 |
| `bilge_keel` | Bilge keel | 0/1 | 1 | C9 |
| `gravity` | grav | m/s² | 9.81 | C10 |
| `rho` | rho(sea) | t/m³ | 1.025 | C11 |
| `roll_gyration_option` | Roll Gyration | 0/1 | 0 | C12 |
| `x_from_ap` | X from AP | m | 94.38 | C15 |
| `y_from_cl` | Y from CL | m | -7.257 | C16 |
| `z_from_bl` | Z from BL | m | 38.4585 | C17 |

- `x_from_ap'`(rule length 기준) = `x_from_ap - (lbp - length)` (General C18).

### 4.2 조건별 입력 (자동 기본값 + 편집)

- `loading_type`: cond 3,4 = 0(ballast), 그 외 = 1. (General row24)
- `roll_gyration`: 조건별 값, 기본 0. (General row38)
- 나머지(Displacement, Draft EQUIV/FP/MEAN/AP, TRIM, KMT, KG, GGO, GOM, LCB, MTC)는 PDF 추출값.
  파생: `LCG = LCB + TRIM*MTC/Disp`, `GM = GGO + GOM`, `CB = Disp/rho/L/B/Draft_mean`.

## 5. 출력 계약 (result.json)

```jsonc
{
  "source_pdf": "H3441 ....pdf",
  "matched_pages": [191, 193, ...],
  "extracted_tables": [ ... ],            // 기존 표 렌더용(하위호환 유지)
  "ship_constants": { ...§4.1... },
  "position": { "x_from_ap": .., "y_from_cl": .., "z_from_bl": .. },
  "conditions": [ { "condition_no": 3, "loading_type": 0, "displacement": .., "lcg": .., "gm": .., "cb": .., ... } ],
  "rules": {
    "dnvgl": {
      "label": "DNVGL - Ship rule",
      "x": { "char": "Accx-env", "unit": "m/s2", "max": 2.2295, "max_g": 0.2273, "max_lc": 4 },
      "y": { ... }, "z": { ... },
      "per_condition": [ { "condition_no": 3, "ax": .., "ay": .., "az": .. }, ... ]
    },
    "csr": {...}, "igc": {...}, "bv": {...}, "lr": {...}
  },
  "envelope": {
    "x": { "value": 2.2295, "g": 0.2273, "rule": "DNVGL", "lc": 4 },
    "y": { "value": .., "rule": "LR", "lc": .. },
    "z": { "value": .., "rule": "LR", "lc": .. }
  },
  "ranking": { "x": [["DNVGL",2.23],["BV",2.17],...], "y": [...], "z": [...] }
}
```

요약 검증 기준(Excel General 캐시값, 3441·기본 위치): X-acc Envelope ≈ 2.2295 m/s²(DNVGL, LC4),
Y-acc ≈ 17.40(LR, LC37), Z-acc ≈ 47.34(LR, LC37). (General X3:AC5 / R15:V20)

## 6. 백엔드 변경

- `routers/analysis.py` `request_hull_acceleration`: `constants`(JSON 문자열 Form) +
  `condition_overrides`(선택) 추가 수신. work_dir에 `constants.json` 저장 후 서비스에 경로 전달.
- `hull_acceleration_service.py`: `extract` 단독 실행 → `ts_hull_acceleration.py` 오케스트레이터 실행으로 교체.
  결과 `result.json` 경로를 `result_info["json_result"]`에 저장. 기존 csv/txt도 유지.
- ⚠️ **InHouse 배포 규칙**: `InHouseProgram/TS/` 는 git 미추적. 변경분은 서버 145에 **수동 복사 + 백엔드 재시작**
  필요(커밋 보고에 명시). `analysis.py`/`hull_acceleration_service.py`는 git 추적이라 `git pull`로 반영.

## 7. 프론트엔드 변경 (`HullAccelerationPage.jsx`)

- 좌측 사이드바에 **입력 폼** 추가(제원 §4.1 + 위치). 3441 프리필. localStorage/페이지 상태 저장.
- 실행 시 `pdf_file` + `constants`(JSON) 전송.
- 결과 영역 탭/섹션:
  1. **Envelope Summary**: X/Y/Z 최댓값 + 승자 rule + LC (강조 카드).
  2. **선급별(rule) 비교**: 5종 X/Y/Z max 표 + ranking.
  3. **조건별 상세**: 선택 rule의 condition 3~40 × ax/ay/az 표. Loading Type/Gyration 편집 → 재계산.
  4. **추출 원문 표**: 기존 뷰 유지.

## 8. 검증 전략

1. **단위 검증**: 각 rule 모듈을 Excel 시트의 per-condition 결과 열(예: DNVGL G67:BB71)의 캐시값과
   `math.isclose(rel_tol=1e-6 또는 abs_tol=1e-3)`로 대조하는 pytest 작성.
2. **요약 검증**: rule별 X/Y/Z max·max_lc 가 Excel General 캐시값과 일치.
3. **Envelope 검증**: 최종 Envelope X/Y/Z·rule·LC 가 General Summary와 일치.
4. **회귀**: `validate_against_excel.py`로 (개발 PC) COM 라이브 재계산과도 대조 가능.
5. 불일치가 남는 알려진 항목(AGENTS.md: cond3/KG, cond17/LCB)은 PDF 반올림 차이로 문서화.

## 9. 리스크 / 미해결

- **rule 수식 복잡도**: 각 시트 70~110행 × 50+열. 이식 시 셀 단위 정확도 필요 → §8 검증으로 방어.
- **LR Y/Z 값이 큼**(17.4, 47.3 m/s²): LR은 "machinery on deck" 기준(2/3·Vs)으로 다른 basis. 이식 후
  캐시값과 일치하면 정상으로 간주.
- **named range 의존**: Excel은 `LBP,L,B,D,TSC,CB,grav,X,Y` 등 named range 사용 → constants 매핑으로 치환.
- **per-rule 세부 수식은 구현 단계에서 시트별로 추출**(병렬 서브에이전트)하여 plan에 반영.
```
