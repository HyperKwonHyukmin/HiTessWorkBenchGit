# Mooring Fitting — 부식 마진(corrosion addition) 반영 계획 (2026-11-12)

## 지금 상태

- 구조 CSV 2번째 줄에 값이 이미 있다: `corrosion,1` (NewCase_02,03,04, 호선 3496,3445) , `corrosion,1.5` (NewCase_01, 호선 3516). 단위는 mm 로 보인다.
- 엔진은 이 줄을 버린다 — `StructureCsvParser.cs` 196행 `case "CORROSION":` → '의도적으로 반영하지 않는 메타데이터 행'(Skipped).
- 그래서 모든 판정이 **총두께(gross)** 기준이다. 보고서도 그렇게 적고 있다(`MooringReportBuilder.cs` 327,486,1043행 'Gross scantlings - no corrosion deduction', 'IACS UR A2.4 는 2.0 mm 를 요구하니 한계 근처 부재는 다시 보라').
- 총두께 판정은 응력을 작게 낸다(비보수적). 부식 두께만큼 웹,면재,갑판이 얇아지면 단면계수가 줄어 Usage 가 오른다.

## 정할 것 (추천안 먼저)

| # | 질문 | 추천 | 이유 |
|---|------|------|------|
| D1 | CSV 값의 뜻 | **양면 합계 tc**, 각 판 두께에서 한 번 뺀다 | IACS UR A2 의 tc 정의가 '양면 합계'. 값 1~1.5 mm 도 한쪽 면 값으로 보기엔 크지 않음 |
| D2 | 무엇을 줄이나 | **두께만**(웹,면재,부착 갑판,PLATE 판). 높이,폭,유효폭은 CSV 그대로 | 순단면(net) 관례. 높이 1 mm 차이는 결과에 거의 영향 없고 규칙이 단순해진다 |
| D3 | 강성과 응력 | **둘 다 순두께**(BDF 자체를 순두께로) | BDF 하나로 끝나고 해석,보고서,Studio 가 같은 치수를 본다. 갈라 쓰면 BDF 2개 또는 후처리 재계산이 필요 |
| D4 | UR A2.4 최소 2.0 mm | **CSV 값을 그대로 쓰고**, 2.0 미만이면 진단 경고 + 보고서에 명시 | 값을 몰래 올리면 설계자가 준 값과 결과가 어긋난다. CSR 선은 2.0 이 아닐 수 있다 |
| D5 | 값 바꾸기(화면 입력) | **1차에는 안 함**. CSV 값만 쓰고 WorkBench,Studio 는 표시만 | 입력 경로가 하나여야 추적이 쉽다. 필요하면 SF 칸처럼 나중에 추가 |
| D6 | corrosion 줄이 없을 때 | 0 mm + 경고 `CORROSION_MISSING`(보고서 'Gross scantlings' 문구 유지) | 옛 CSV 도 돌아가게 |

## 단계

### 1. 엔진 — 값을 읽어 단면에 반영 (MooringFitting, C#)

1. `StructureCsvParser`: `CORROSION` 줄의 2번째 칸을 숫자로 읽어 `RawStructureData.CorrosionMm`(없으면 null). 숫자가 아니거나 음수면 경고 후 0.
2. `RawFeModelBuilder`: 두께 공제를 **한 곳**에서 한다 — `Net(t) = t − tc`.
   - ANGLE,TBAR(I): 웹 `sizeB`, 면재 `sizeD`, 부착 갑판.
   - FLATBAR(T): 웹 `sizeB`, 부착 갑판.
   - PLATE below,above(T): 판 `Thickness`, 갑판.
   - 갑판 중앙값(`deckThickness`)도 순두께로. H = 높이 + **순** 갑판 두께(D2).
   - 순두께 ≤ 0.5 mm 면 그 행을 빼지 말고 오류 진단(`CORROSION_THICKNESS_NONPOSITIVE`) + build 실패(exit 2). 조용히 0 두께 단면을 만들지 않는다.
3. `PlateTaperHeightModifier` 는 `dims[2]`(이미 순두께)를 쓰므로 수정 없음 — 테스트로만 확인.
4. 출력에 적용값 기록: `ModelEvidenceWriter` `caseFacts.corrosionMm`(+ 출처 `csv` / `missing`). 백엔드,Studio 가 이 값을 읽는다(아래 2,3단계의 유일한 원본).
5. 진단: `CORROSION_APPLIED`(Info, 값) , `CORROSION_BELOW_UR_A2`(Warning, < 2.0) , `CORROSION_MISSING`(Warning).
6. 보고서(`MooringReportBuilder`): 327,486,1043행 문구를 적용값에 따라 바꾼다 — 'Net scantlings: tc = 1.0 mm (input) deducted from all plate thicknesses', 2.0 미만이면 UR A2.4 주의 한 줄. 부록 A 단면표는 순두께가 자동으로 나온다(머리에 'net' 표기만 추가).
7. 테스트: 파서(값,없음,이상값), 매퍼(행 종류별 공제), 0 두께 거부, caseFacts 기록.

### 2. 백엔드 — 행 편집이 같은 규칙을 쓰게 (WorkBench)

⚠ **이 단계를 빠뜨리면 행 편집이 조용히 멈춘다.** `mooring_row_edit._section_is_from_row` 는 CSV 칸으로 다시 계산한 치수가 지금 단면과 같을 때만 '이 행의 단면'으로 본다. 엔진만 순두께가 되면 모든 행이 '다른 행 단면'으로 판정돼 크기 편집이 전부 건너뛰어진다.

1. `_new_dims(row, prop, cells, corrosion_mm)` — 두께 칸(`size(3)`,`size(4)`,`size(5)`,PLATE `size(5)`/`size(15)`)에서 tc 를 뺀다. 갑판(`dims[5]`/`dims[2]`)은 이미 순두께인 기존 값을 그대로 쓴다.
2. tc 는 그 결과 폴더의 `caseFacts.corrosionMm`. 없으면 0(옛 결과 = 총두께 BDF 라 그대로 맞는다).
3. 시험: 순두께 결과에서 `_section_is_from_row` 가 참, 편집 후 치수 = (새 값 − tc).

### 3. Studio — 사본과 표시 (MooringFittingStudio)

1. `utils/sectionSketch.js` `rowDims` 는 `_new_dims` 사본 → 같은 인자,규칙(사본 동기화 주석 갱신).
2. 정보 패널,단면 그림: '웹 12 → 순 11 (부식 1.0 mm)'처럼 CSV 값과 순두께를 함께. 단면,재질 편집 패널은 사용자가 **CSV 값(총두께)** 을 넣고, 바뀔 PBEAML 은 순두께로 보인다(입력 혼동 방지).
3. Model Check 에 위 진단 3종 표시. '구조 CSV' 탭의 corrosion 줄 상태를 '모델에 쓰지 않음' → '적용 1.0 mm' 로.
4. 바뀐 행 CSV 내보내기는 원문 칸 그대로(총두께) — 바꿀 것 없음.

### 4. WorkBench 화면

- 해석 뒤 판정 요약(`mooringVerdict.js`) 옆에 '부식 공제 1.0 mm (CSV)' 한 줄. 없으면 '부식 공제 없음'. 다른 변경 없음(D5).

### 5. 검증

1. 샘플 전부(NewCase_01~04, 05 는 하위 폴더 `[260521] 3516-MF-해석`)를 공제 전,후로 build-full + solve-bdf → 판정 건수,최대 Usage 변화 표. 기대: Usage 가 대략 tc/t 비율만큼 오름(얇은 FLATBAR 가 가장 크게).
2. 한 부재를 손계산(순두께 단면계수 × 같은 내력)으로 대조.
3. 행 편집 회귀: 순두께 결과에서 등급,크기 편집 각 1건(E2206,E2121 실례 재현).
4. 옛 결과(caseFacts 없음)로 Studio,보고서,행 편집이 예전과 같은지.

## 배포 영향

- 엔진 `MooringFitting.exe` → 70,145 InHouse 수동 교체(git 미추적).
- 백엔드 `_new_dims` → 145 `git pull + 재시작`. **엔진보다 먼저 또는 동시에** — 엔진만 먼저 바뀌면 2단계 경고처럼 편집이 멈춘다. 백엔드는 caseFacts 가 없으면 0 이라 먼저 올려도 안전하다.
- Studio zip → `/studio-release mooring-fitting-studio`.
- 순서: 백엔드 → 엔진 exe → Studio.

## 미리 알아 둘 것

- 3445,3496 제출 계산서가 부식을 어떻게 다뤘는지 아직 모른다(원본이 DRM 이라 이번에 못 읽음). 지금도 도구 응력이 계산서보다 1.4~4.5배 높은데, 계산서가 총두께였다면 공제 후 차이가 더 벌어진다. 비교 전에 계산서의 단면 두께가 순두께인지 확인이 필요하다.
- MF 엔진,Studio 는 원격 저장소가 없고 미커밋 변경이 많다(CLAUDE.md). 1단계 착수 전에 스냅숏 커밋을 권한다.

## 진행 상태 (2026-11-12, 사용자 지시 '진행해' — D1~D5 추천안대로)

- 엔진: 파서가 corrosion 값을 읽고 `PbeamlDimMapper.NetThickness` 한 곳에서 웹, 면재, 갑판, 판 두께에서 뺀다(순두께 0 이하면 멈춤). 진단 `VAL_CORROSION_APPLIED / _BELOW_UR_A2 / _MISSING`, `MODEL_EVIDENCE caseFacts.corrosionMm + corrosionSource`, 보고서 문구 4곳(옛 결과는 총두께 문구 유지). 시험 `CorrosionTests` 7건(전체 89 통과).
- 백엔드: `mooring_row_edit.corrosion_info / _new_dims(…, corrosion)`, viewer-zip `csv_rows.json` 에 `corrosion`, 진단 `CORROSION_MISSING / CORROSION_BELOW_UR_A2`. Mooring 시험 155 통과.
- Studio 0.1.88: 상단 칩 '부식 마진 N mm'(2.0 이상 초록, 미만 노랑), Model 탭과 Analysis 재료 구역 설명 상자, 단면 그림 아래 순두께 안내, 행 편집 안내, 구조 CSV 표 corrosion 줄 상태. `rowDims / sectionIsFromRow` 에 같은 공제(시험 59 통과).
- 비교(build-full --solve, 재질별 판정 = 백엔드 함수, Usage 증가 중앙값):
  NewCase_01 tc 1.5: NOT OK 56 → 77, 재질 변경 29 → 27, 최대 4.85 → 5.45(×1.13) | NewCase_02 tc 1: 22 → 26, 18 → 21, 1.82 → 1.95(×1.09) | NewCase_04 tc 1: 1228 → 1270(Winch 단위 문제 샘플).
  보고서 숫자(NOT OK 77, 재질 변경 27, 최대 5.451)가 위 계산과 같다. 새 결과로 만든 viewer-zip 에서 행 편집 대상 1934 개 모두 '이 행 단면'(다른 행 0).
- 확인 안 함: WorkBench 앱 안 Studio 화면(헤드리스 Chrome 캡처만), WorkBench 판정 요약 줄(4단계, 하지 않음 — 다음 exe 와 함께), 3445·3496 계산서의 부식 처리.
- 배포: 70 InHouse `MooringFitting.exe`(백업 `.bak_20261112_before_corrosion` = f9105a0b…) · 70 로컬 Studio 0.1.88. 145 미반영. 순서 = 백엔드 `git pull + 재시작` → 엔진 exe 교체 → `/studio-release mooring-fitting-studio`.
