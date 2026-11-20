# Truss 소모듈 권상 구조해석 자동화 — 계획

작성 2026-11-17. 요구사항 정리와 결정은 사용자와 질문 28개로 합의했다(이 문서의 '결정표').
상태: **계획만, 코드 없음.**

## 1. 목적

지금 WorkBench 의 Truss 앱은 글로벌 모델 전체 평가(Truss Structural Assessment)만 한다.
Truss 를 소모듈로 나눠 들어 올리거나(권상) 쌓아 둘 때(적치)의 구조 검토는 자동화돼 있지 않다.
이 앱은 글로벌 BDF 를 LV(도면 plan 높이)와 평면 영역으로 잘라 소모듈마다 권상, 적치 해석을 하고 보고서를 낸다.
화면과 흐름은 MU 권상 Studio 와 같은 방식이다.

## 2. 조사로 확인한 현재 자산 (2026-11-17)

| 항목 | 사실 | 근거 |
|---|---|---|
| 글로벌 모델 | HyperMesh BDF, CBAR + PBAR 만, 쉘과 RBE 없음. 3321 샘플 GRID 1,247, CBAR 2,093, CONM2 1,239(합 117.8 t) | `WorkBenchSubModule\TrussAssessment\bdf\3321_2tk_moving_04.bdf` |
| 단위 | mm, ton, N (E 206800, GRAV 9800) | 같은 파일 |
| PID 의미 | 1~5 Beam, 6~10 Girder, 11~13 Bracket, 14 BG, 15 Leg, 16 Column, 17~19 Brace | `Csharp\Projects\TrussModelBuilder\Reference\TrussPropertyConvert.txt` |
| pair | pair PBAR 의 A, I 가 single 의 정확히 2배. 짝 single 이 있는 것은 2→1, 4→3, 12→11 뿐, Girder(6~10)와 BG(14)는 짝 없음 | 같은 변환표, 3321 PBAR |
| LV | BDF 에 표시 없음. 실제 Z 레벨(770, 2940, 4140, 7740, 11040 …) = 도면 plan 높이 | 3321 GRID |
| 핀 | 모델에 핀 표현 없음 | 3321 CBAR |
| 평가 | 부재 UC = 축력/허용 + 모멘트/허용(PID 1~18 표), 하중분산판, SideSupport. 변위는 파싱만 | `TrussAssessment\...\Control\ElementStressChecker.cs`, `LoadDistributionChecker.cs` |
| 권상 BDF | bridge `build_lifting_bdf` 가 자세안정성 JSON 의 apex, lug 로 Wire CROD 를 붙임. 원본 SPC, Case Control 제거, 중력 (0,0,-1) × 9800 × 1.2 고정 | `Nastran_bridge\nastran_bridge.py` 4420~4600 |
| MU Studio | CBAR 요소 인식함. 자중 계산은 PBEAML 만 알아 PBAR 면적을 못 읽음. 와이어 간섭 검사가 PBAR 원값(A, I)을 단면 치수로 쓸 위험 | `ModuleUnitStudio\...\store\useEditStore.js`, `ModuleUnitAnalysis\...\PropertyDimensionHelper.cs` |

### TrussAssessment.exe 를 그대로 쓸 수 없는 이유 (코드 읽기 기준, 실제 F06 미확인)
- exe 가 받은 BDF 로 Nastran 을 스스로 다시 돌린다(`Program.cs:52`).
- `SPC1` 을 읽지 않는다(`BdfParser.cs:207`) — 권상 구속(SPC1 990001)이 무시된다.
- 하중분산판 = '모델 최저 Z 의 구속점' 고정. 권상은 대상이 없고, 적치는 최저 Z 가 아닌 받침점을 조용히 버린다.
- 변위가 JSON 에 없다.
- CROD 요소력이 F06 에 섞여도 BAR 파서는 깨지지 않는다(정규식이 BAR 줄만 받음).

### 기존 결함 (이 계획 밖, 기록만)
`LoadDistributionChecker.cs:340-341` — subcase 1 을 'Sustained' 로 표시하면서 허용값은 Temporary(더 큼)를 쓴다.
글로벌 Truss 평가의 subcase 1 하중분산판 판정이 느슨할 수 있다. 별도 작업으로 기존 결과 몇 건의 영향부터 확인한 뒤 고친다.

## 3. 결정표

| # | 결정 |
|---|---|
| D1 | Studio = MU Studio 를 복사한 새 Studio(viewer id `truss-lifting-studio`). MU 와 짝 Studio `watch` 묶음 |
| D2 | 남김: 셸, 3D, 찾기, 선택, 작업 패널, 편집, Hoist(Wire, 자세안정성), 구조 해석 결과 색, 도움말. 뺌: 가서포트, 유체 비움, 중심점 RBE + 질량, 다른 Unit 권상 참조, Strict 평가 토글, 권상 위치 자동 추천 |
| D3 | 입력 = HyperMesh BDF 하나 |
| D4 | 자르기: 평면도(XY), 입면도(XZ, YZ)에 사각형이나 다각형을 그림(절점 격자 snap). 소모듈 = 각 방향으로 밀어 낸 부피의 교집합 |
| D5 | 두 끝 절점이 모두 안에 있는 부재만 포함. 걸친 부재는 쪼개지 않고 목록과 3D 강조, 하나씩 넣거나 뺌 |
| D6 | 자르는 선 위의 pair → single 은 **이미 정의된 single property 로 PID 만 바꾼다**(2026-11-17 사용자 결정 — 새 PID, 절반 허용값은 만들지 않음). pair ↔ single 대응표는 설정 파일 하나로 두고 사용자가 채운다(지금 확인된 짝 2→1, 4→3, 12→11, Girder, BG 짝은 사용자 제공). ~~자동 판정 + 사용자가 하나씩 켜고 끔~~ → **바꿀 부재는 사용자가 고른다**(2026-11-18 사용자 결정, 자동 판정은 후보 표시만) |
| D7 | 재질과 밀도는 유지(부재 자중은 Nastran GRAV 가 계산). 기존 CONM2 는 모두 삭제 |
| D8 | 집중질량 재구성: 각 LV 평면에서 부재로 닫힌 칸을 모두 자동으로 찾고, 칸 면적 × 단위 면적당 질량을 칸 모서리 절점에 똑같이 나눠 CONM2 로. 칸 단위 넣기/빼기 화면은 두지 않음 |
| D9 | 질량은 자른 뒤 소모듈 기준. 자르는 선이 칸 한가운데를 지나면 경고 |
| D10 | 단위 면적당 질량: 기본값 하나 + LV별 변경 가능. **2026-11-18 사용자 결정: Plywood 0.63 t/m²(기본, 바닥 면적당) + Square Tube 는 사용자가 넣는 소모듈 전체 총중량 t('일단', 차후 변경 가능성 있음)** — 0.63 의 단위 t/m² 는 사용자 확인(같은 날) |
| D11 | 편집: 자재 삭제, 이동, 추가는 MU 편집 도구 |
| D12 | 기울이기: 무게중심(부재 자중 + 재구성 질량) 기준 X, Y, Z 축 회전. 질량을 넣은 뒤 회전. 중력은 늘 (0,0,-1) |
| D13 | 저장 형식은 처음부터 '글로벌 모델 하나 + 소모듈 정의 여러 개(이름, 다각형, pair 변환 목록)' |
| D14 | 권상: Wire 연결과 훅 높이, 위치는 MU 방식. 중력 계수 기본 1.2, Studio 에 보이고 바꿀 수 있음 |
| D15 | 적치: 사용자가 고른 받침점(상하 구속 = 하중분산판, 수평만 = SideSupport), 중력 계수 1.0 |
| D16 | 평가 기준은 TrussAssessment 와 같은 식과 허용값 |
| D17 | 권상 평가 = 부재 UC + Wire 장력(값만) + 발생 변위(값만). 적치 평가 = 부재 UC + 하중분산판 + SideSupport + 발생 변위 |
| D18 | 소모듈 전용 exe `TrussModuleAssessment` 를 TrussAssessment 솔루션의 새 프로젝트로. 판정 파일(ElementStressChecker, 허용값 표, F06 파서)은 링크 공유. 글로벌 평가와 기존 exe 는 건드리지 않음 |
| D19 | 전용 exe 에만: F06 재사용(Nastran 재실행 안 함), 받침점 목록 입력, SPC1 읽기, 변위 JSON 출력, 절반 Girder 허용값(별도 표) |
| D20 | WorkBench: 새 앱 메뉴, `runFrame` 공통 틀. 글로벌 BDF 올리기 → 검증 → Studio → 결과와 보고서. 작업 탭(4개 동시)은 나중 |
| D21 | 보고서: MU 상세 레포트 구조(xlsx → 서버 Excel PDF, 그림은 서버 matplotlib), 소모듈 하나당 하나 |
| D22 | 보류: 체인벨트(권상 케이스의 '추가 들어올림 점' 자리만 비워 둠), 핀 조인트 평가 |

## 4. 단계

### 1단계 — 소모듈 1개 권상 (첫 목표)
글로벌 BDF → 소모듈 1개 자르기 → 질량 재구성 → 권상 → 전용 exe 평가 → Studio 결과 표시.
1. **Studio 복사와 정리**: MU Studio 를 `WorkBenchSubModule\TrussLiftingStudio\` 로 복사, D2 의 뺄 기능 제거, viewer id 와 이름 교체. 짝 Studio `watch` 등록.
2. **PBAR 대응**: Studio 자중 계산이 PBAR 면적(필드 3)을 읽게, 자세안정성 엔진 간섭 검사가 PBAR 원값을 단면 치수로 쓰지 않게(Truss 용 단면 치수 = PBAR 응력 회복점 C/D/E/F 에서). bridge PID 중복 검사에 PBARL 포함.
3. **분할 탭**: 평면도, 입면도 2D 화면 + 다각형 그리기 + 3D 미리보기, 걸친 부재 목록, pair → single 판정과 토글. 결과는 intent 로 저장(D13 형식).
4. **질량 재구성**: LV 판정(Z 레벨 군집), 닫힌 칸 찾기(평면 그래프 면 찾기), CONM2 생성. 위치는 Studio(JS, 미리보기) + 서버 적용 둘 중 하나로 — 1단계 설계 때 정한다(MU 처럼 Studio 가 `_edited.json` 을 만드는 쪽이 유력).
5. **권상 BDF**: Studio 가 자세안정성 JSON 형식으로 lug, apex 를 넘기고 bridge `build_lifting_bdf` 로 Wire BDF 생성. 중력 계수를 입력값으로.
6. **전용 exe**: `TrussModuleAssessment`(D18, D19). 백엔드 서비스가 '해석 1회 → exe 에 F06 재사용' 순서로 부름. 평가 폴더는 권상 JSON 과 분리.
7. **WorkBench 페이지와 라우터**: 새 메뉴(D20), `GUARDED_ROUTES`, `program_name`, 결과 다시 열기.

### 2단계 — 적치와 여러 소모듈
적치 케이스(받침점 고르기, 하중분산판, SideSupport), 소모듈 여러 개 관리.

### 3단계 — 편집과 기울이기
자재 삭제, 이동, 추가, 무게중심 기준 회전.

### 4단계 — 보고서

### 보류
체인벨트, 핀 조인트 평가.

## 진행 기록

- **2026-11-17 1단계 1번 완료(Studio 복사와 정리)** — `C:\Coding\WorkBenchSubModule\TrussLiftingStudio\`(git 아님, 원격 없음). MU 작업 폴더 0.0.223 을 복사해 viewer id, 이름, 포트 5186, 브라우저 저장 키(`tls.`) 교체.
  D2 의 뺄 기능은 **화면 진입점만** 걷고 스토어와 데이터 코어는 MU 와 같게 남김(MU 개선을 옮길 때 차이를 줄이려고). 걷어낸 목록은 Studio `README.md`.
  확인: 시험 1,008 통과(설명서 시험 1건은 설명서가 생길 때까지 건너뜀), lint 18건(MU 원본과 같은 수), 빌드, 헤드리스 Chrome 빈 화면 캡처. 모델을 넣은 화면은 아직 안 봄.
  남은 것: 짝 Studio `watch` 등록(`scripts/studio_pair.json` — 다른 세션의 미커밋 변경이 있어 미룸), 저장소 만들기(git init 과 원격)는 사용자 결정.
  Strict 토글을 걷어서 자세안정성 형상 판정은 MU 기본값(완화 — 형상 미달은 경고, 전도는 실패)으로 돈다. Truss 에 엄격 판정이 맞는지는 실제 권상 결과를 본 뒤 정한다.
- **2026-11-17 1단계 2번 완료(PBAR 대응)** — 처음 합의한 'Studio 안에서만' 은 불가능했다(같은 `_edited.json` 을 자세안정성 엔진과 bridge BDF 쓰기가 함께 읽음). 사용자 승인 후 InHouse 두 곳을 고침, 둘 다 PBAR 모델에서만 동작이 바뀐다.
  - **bridge 결함 발견과 수정**: PBAR 를 다시 쓰면 한 줄 136자에 C1 이 예약 칸(9번째)에 들어가 Nastran 이 80자 뒤(D, E, F 회복점, K1, K2)를 버렸다. 읽기에서 NSM 빈칸이면 뒤 값이 당겨지는 결함도 있었다.
    `parse_property` PBAR = 첫 줄 A, I1, I2, J, NSM 은 칸 위치로(빈칸 0), 쓰기 = 첫 줄 다섯 칸 + 8개씩 이어 쓰기 줄. `dims` 모양은 그대로. 시험 `Nastran_bridge/tests/test_pbar_roundtrip.py`(5건, 고치기 전 2건 실패 확인), bridge 시험 120 통과.
    3321 전체 왕복: 속성 17개 모두 원본과 같음, 80자 넘는 줄 0. 원본과 왕복 BDF 를 Nastran 으로 돌려 변위, SPC 반력, CBAR 요소력이 같음(차이는 1e-9 수준 잡음과 인쇄 끝자리). 백엔드 bridge 사용 시험 151 통과.
    70 두 사본(`WorkBenchSubModule/Nastran_bridge`, `InHouseProgram/NastranBridge`) 같게 둠 — sha256 c098a3bc…, 백업 `.bak_20261117_before_pbar`(9d442686…).
  - **자세안정성 엔진** `PropertyDimensionHelper`: `PBAR` = 가장 먼 응력 회복점 × 2, 없으면 √A(예전 기본 규칙은 I1 수천만을 치수로 써서 모든 부재가 와이어 간섭). 시험 `PropertyDimensionPbarTests`(5건), 엔진 시험 194 통과. **exe 빌드와 InHouse 교체는 5번(엔진 호출) 때** — 그 저장소의 다른 미커밋 변경(Stage3 트롤리, Stage7)은 10-01 InHouse exe 에 이미 들어간 것으로 보임(백업 이름 `bak_20261001_trolleyX`).
  - **Truss Studio**: `data/pbarSection.js`(면적, 바깥 치수 — 엔진 규칙의 사본), 자중 계산 `computeCrossSectionAreaMm2`, 3D 단면 `makeSection('PBAR')` 정사각 상자. 시험 1,013 통과, lint 18 그대로.
    헤드리스로 3321 을 넣어 Model, 3D 단면(650 mm 상자), Hoist 탭 화면 오류 0. Hoist '중량 조건' 265.22 t(기존 CONM2 117.8 t + 부재 자중 — 질량 재구성 전).
  - 발견: **처음 열 때 카메라가 모델에 맞춰지지 않는다**(46 m 모델, '전체' 를 누르면 정상). 3번(분할 탭) 화면 작업 때 원인을 본다.
  - 145 반영(앱 공개 때): InHouse `NastranBridge/nastran_bridge.py` 교체(재시작 불필요), 엔진은 5번 기록 참고.
- **2026-11-17 1단계 3번 완료(분할 탭)** — Truss Studio 안에서만, 엔진과 bridge 는 건드리지 않음. 공용 코어 변경은 `ThreeViewport` 에 `pickedEntity.type === 'elementSet'` 갈래 하나(더하기만, 기존 갈래 그대로).
  - 규칙 `data/moduleSplit.js`(+시험 15): LV 자동 판정(Z 50 mm 묶음, 절점 4개 미만 높이 제외), 영역 = 평면 XY ∩ 정면 XZ ∩ 측면 YZ 다각형 ∩ LV 높이 구간(그리지 않은 조건은 무시),
    부재 = 두 끝 안 포함 / 하나만 안 걸침(기본 제외, 사용자가 넣음) / 사용자가 포함 부재 빼기. **경계 pair** = 두 끝이 같은 다각형 변 위 + 그 변이 실제로 모델을 자름(끝 절점에서 변을 건너 영역 반대편으로 가는 부재가 있음 — 모델 바깥 테두리와 같은 변을 따라 이어지는 부재는 제외).
    대응표 `data/trussPairMap.js` = 2→1, 4→3, 12→11, Girder(6~10)와 BG(14)는 '짝 없음' 알림만. 소모듈 모델 JSON(`buildModuleModel`) = 쓰는 절점만, PID 교체(`pairSwappedFrom` 기록), SPC 비움, 요소 type 을 원래 카드(`cardType`)로 복원.
  - 화면: 상단 탭 'Model Check' 다음 '분할'. 가운데 = 3D 위를 덮는 2D 도면(`components/split/SplitCanvas2D.jsx`, 평면/정면/측면, 사각형 끌기, 다각형 클릭 + 더블클릭/Enter, 절점 10 px 붙기, 휠 확대, 오른쪽 끌기 이동, 정면/측면에 LV 높이선과 고른 구간 띠, 도구 없이 부재 클릭 = 넣기/빼기).
    [3D 에서 보기] = 소모듈 부재를 elementSet 으로 골라 '선택만 보기', 도면으로 돌아오거나 탭을 떠나면 원래대로(`SplitWorkspace.jsx`). 왼쪽 `panels/SplitPanel.jsx` = 소모듈 목록(여러 개, 이름), LV 구간, 그린 영역, 걸친 부재, 직접 뺀 부재, 경계 pair 목록(하나씩 끄기), [소모듈 모델 JSON 저장].
    상태 `store/useSplitStore.js`(정의 = 글로벌 하나 + 소모듈 여러 개, D13), 도움말 항목 5개.
  - 확인: Studio 시험 1,028 통과, lint 18(기존과 같음), 빌드. 헤드리스 Chrome + 3321: 마우스로 사각형 → 부재 347, LV1~LV3 구간 + 정면도 띠, 걸친 부재 클릭 넣기(347 → 348), 3D 보기 637 부재 강조, 탭을 떠나면 '선택만 보기' 꺼짐, 화면 오류 0.
    소모듈 JSON → bridge BDF = CBAR 328, PBAR, CONM2, CBEAM 0.
  - 남은 것: 3D 보기에서 절점은 전체 모델 것이 보인다('선택만 보기' 가 부재만 거름). 다각형이 오목하면 경계 pair 의 안쪽 판정(다각형 무게중심 쪽)이 틀릴 수 있다. 소모듈 정의 저장, 불러오기는 WorkBench 연결(7번) 때.
  - **5번에서 고칠 것(발견, 3번에서)**: MU 편집 모델 내보내기(`applyEditedModel`)는 요소 type 을 'BEAM' 으로 내보내고 bridge 는 'BEAM' 을 CBEAM 으로 쓴다 → CBEAM 이 PBAR 를 참조(Nastran FATAL 예상, 실행은 안 해 봄). bridge 의 'PROD 참조 = CROD' 규칙처럼 'PBAR 참조 = CBAR' 로 막는다(PBAR 모델만 영향).

- **2026-11-17 1단계 4번 완료(집중질량 재구성)** — Truss Studio 안에서만(엔진, bridge 변경 없음).
  - 규칙 `data/areaMass.js`(+시험 11): LV 마다 두 끝이 같은 LV 높이인 소모듈 부재로 평면 그래프 → 절점 없이 교차하는 부재는 빼고(건수 알림) → 닫힌 칸(유한 면) 모두 →
    칸 면적 × 단위 면적당 질량을 칸 둘레 절점에 똑같이 나눔. 단위 kg/m² → t/mm² = 1e-9. 0.01 m² 미만 면, 64 절점 넘는 면은 칸으로 보지 않음.
    새 CONM2 번호 = 요소, RBE, 기존 질량 번호 최대 + 1. 그 층 칸 면적 중앙값의 10배 넘는 칸은 '개구부일 수 있음' 으로 알림(질량은 규칙대로 넣음).
  - **단위 면적당 질량 기본값 없음** — 값이 비면 기존 CONM2 를 지우기만 하고 새로 넣지 않는다(임의 숫자로 해석되는 것을 막음). LV 별 값으로 덮어쓸 수 있음. 값은 사용자 협의 뒤(D10).
  - `buildModuleModel(…, { areaMass })` = 기존 CONM2 모두 제거 + 재구성 질량만, `meta.trussModule.areaMass`(지운 개수와 t, LV 별 칸, 면적, 질량).
  - 화면: 분할 패널 '집중질량 재구성'(값 입력, LV 표, 큰 칸 경고, 지울 기존 질량), 평면도에 칸 칠하기(큰 칸 주황). '걸친 부재' 목록은 기본 접음.
  - 확인: 시험 1,040, lint 18, 빌드. 3321 전체(LV3~LV5, 100 kg/m² 시험값): LV3 156칸 1,463 m², LV4 297칸 1,735 m²(평면 외곽 1,893 m² 의 92%), LV5 218칸 1,735 m², 교차로 뺀 부재 0,
    재구성 959개 493.22 t(기존 1,239개 117.82 t 지움). bridge BDF 로 CONM2 959개, 다시 읽은 합 같음. 헤드리스 화면 오류 0.
  - LV3, LV5 에 384 m² 칸이 하나씩 — LV4 는 그 자리에 격자가 있어 가운데 개구부로 보인다. **사용자 결정(같은 날): 그 층 칸 면적 중앙값의 10배 넘는 큰 칸은 기본으로 질량에서 빼고, 패널에서 하나씩 다시 넣는다**
    (D8 '칸 단위 넣기/빼기 화면 없음' 의 예외 — 자동으로 잡힌 큰 칸에만 단추). 칸 이름표 `cellKey` = LV + 둘레 절점 번호(정렬), 스토어 `massIncludeLarge`. 평면도: 뺀 큰 칸 = 주황 점선 테두리, 다시 넣은 큰 칸 = 주황 칠.
    3321(100 kg/m²): 기본 416.5 t(LV3 107.9, LV4 173.5, LV5 135.1), LV3 큰 칸을 넣으면 454.8 t. 시험 1,041, 헤드리스 화면 오류 0.
    LV1(770, 받침점 높이)과 LV2(2940)는 평면 칸이 없어 질량 없음 — 의도에 맞는지 사용자 확인 남음.
- **2026-11-17 1단계 5번 완료(권상 BDF)** — 공유 InHouse 두 곳을 고쳤고, 둘 다 MU 결과가 바뀌지 않음을 실제 시료로 비교했다.
  - **bridge** `convert_json_to_bdf`: PBAR 를 참조하는 요소는 CBAR 로 쓴다(PROD → CROD 규칙과 같은 자리, PBAR 모델만 해당). 시험 `test_element_referencing_pbar_is_written_as_cbar`(고치기 전 실패 확인), bridge 시험 121, 백엔드 bridge 사용 시험 151.
    **MU 무변경 확인**: 고치기 전 bridge(백업)와 지금 bridge 로 MU 시료 JSON 4건 → BDF 글자까지 같음, MU BDF 3건 읽기 결과 같음(변환 시각 `meta.timestamp` 만 다름 — 처음 '다름' 으로 보인 원인), MU 권상 BDF(`build_lifting_bdf`) 5,723줄 같음.
    70 두 사본 sha256 c8e69ae7…(2번 판 c098a3bc… 다음).
  - **자세안정성 엔진**: 70 InHouse `GroupModuleAnalysis\ModuleAnalysis.Core.dll` 하나만 교체(sha256 9c635376…, 옛 4af042c0…, 폴더 백업 `GroupModuleAnalysis.bak_20261117_before_pbar`). 9-10 이후 커밋 없음, Core 미커밋은 PBAR 한 곳뿐이라 바뀐 것은 그것뿐.
    **MU 무변경 확인**: 3496 시료로 옛 exe 와 새 빌드, 그리고 교체 뒤 InHouse exe 가 자세안정성(판정, 경고 3건)과 `--optimize`(후보 22개 평가, 10개 출력) 모두 같음(생성 시각과 입력 경로만 다름).
  - **Truss Studio**: [이 소모듈로 작업 시작](`data/moduleWork.js` — 소모듈 모델 JSON 을 작업 모델로 불러오고 글로벌은 `useSplitStore.globalStages` 에 보관, 분할 탭은 계속 글로벌을 봄), [글로벌 모델로 돌아가기], 상단 띠 `WorkingModuleBanner`.
    Analysis 탭 '권상 중력 계수' 입력(스토어 `safetyFactor` — 기본 1.2, 권상 BDF LOAD 배율. MU 에도 setter 는 있었지만 입력 칸이 없었음).
    자세안정성 평가 때 작업 모델이 Truss 소모듈(`meta.trussModule`)이면 편집이 없어도 모델 JSON 을 늘 올린다(`useEditStore.exportPostureStabilityToFile` 조건 하나 — 소모듈은 Studio 메모리에서 만들어 서버에 원본이 없다).
  - **끝까지 확인(헤드리스 + 실제 InHouse 엔진 exe + bridge + Nastran)**: 3321 의 LV3~LV5 일부(부재 307, 절점 178, 경계 pair 2개 교체, 재구성 질량 165개 69.1 t, 총중량 95.58 t) → 맨 윗층 네 모서리 권상.
    엔진이 Truss 부재 단면 치수를 650 mm 로 써서 와이어 간섭 검사(PBAR 규칙 동작). 와이어 8 m 는 슬링 각도 24° 로 실패(정상 판정), 20 m 는 '검토 필요'.
    권상 BDF = CBAR 307(CBEAM 0), Wire CROD 4, CONM2 165. Nastran FATAL 0, 반력 합 1,123.99 kN = 95.578 t × 9,800 × 1.2(1,124.0), 와이어 장력 대칭.
  - **발견: 최대 변위가 2.4~2.5 m** (훅 한 점, 두 점 모두). 같은 입력이면 옛 bridge 권상 BDF 와 똑같아 이번 수정과 무관. 와이어 없이 권상점 4개를 직접 고정해도 최대 876 mm →
    **시험한 소모듈 구조가 무른 것**(3321 샘플은 브레이스 PID 17~19 를 쓰는 CBAR 가 없어 층 보가 34.7 m 를 보로만 받는다, 손 계산 미터 단위와 맞음). 실제 대상 모델과 실제 권상점으로 다시 봐야 한다.
    FATAL 없는 큰 변위를 사용자에게 알리는 장치(예: 최대 변위가 모델 크기의 일정 비율을 넘으면 경고)는 6번 평가 화면에서 검토할 것.
  - 남은 것: Studio 의 구조 해석 단추(`host.runUnitStructural`)는 백엔드 연결(7번) 전이라 실행 안 함. 소모듈 모델이 서버에 없으므로 7번에서 올리는 경로를 정해야 한다.
    bridge 권상 Wire PID 충돌 검사가 PBARL 을 보지 않는 문제(조사 결과)는 그대로 — Truss 모델 PBARL 은 37~39 라 지금은 132 와 안 겹침.
  - 145 반영(앱 공개 때): InHouse `NastranBridge/nastran_bridge.py`(c8e69ae7…) + `GroupModuleAnalysis\ModuleAnalysis.Core.dll`(9c635376…) 수동 교체, 백엔드 재시작 불필요. 지금 바꿔도 MU 결과는 같다(위 비교).
- **2026-11-17 1단계 6번 완료(소모듈 평가 exe)** — 기존 TrussAssessment 소스와 exe 는 수정 없음(같은 솔루션에 새 프로젝트만 추가, sln 백업 `TrussAssessment.sln.bak_20261117`).
  - `TrussAssessment/TrussAssessment/TrussModuleAssessment/` — 판정 파일(Model, Control 전부)을 링크로 공유, 새 파일은 `Program.cs` 하나. `TrussAssessment/CLAUDE.md` 에 사용법 기록.
  - D19 조정: **SPC1 읽기와 받침점 목록 입력은 넣지 않았다** — 권상은 하중분산판 판정을 안 하고(Q17), 적치(2단계)는 받침점을 BdfParser 가 읽는 SPC 카드(최저 Z)로 쓰면 공유 파서를 고치지 않아도 된다.
    넣은 것 = `--f06` 재사용, BDF 와 같은 이름의 F06 만 사용, `--case lifting|stacking`, `<bdf>_module.json`(판정 요약, 발생 변위, 허용값 표에 없어 빠진 부재 목록).
  - 확인: 5번의 권상 BDF(3321 소모듈)를 기존 InHouse `TrussAssessment.exe`(Nastran 직접 실행, 33초)와 새 exe(F06 재사용, 3초)로 평가 → **부재 평가 307행과 요약이 같음**.
    기존 exe 는 권상 BDF 에서 하중분산판 판정 33건을 만들었다(AUTOSPC 절점을 받침점으로 착각 — 권상에서는 뜻 없음), 새 exe 는 lifting 에서 하지 않는다. 솔루션 전체 빌드 오류 0.
  - 70 InHouse 새 폴더 `TrussModuleAssessment\TrussModuleAssessment.exe`(단일 파일, sha256 dd722055…), 배포본으로 다시 돌려 같은 결과. 기존 `TrussAssessment.exe`(a2904f54…)는 그대로.
  - 이 모델 결과: 평가 307, Fail 191, 최대 UC 15.04 — 5번에서 본 구조가 무른 시험 조건(브레이스 없음, 네 모서리 권상) 탓으로 본다. 실제 모델로 다시 봐야 한다.
  - 남은 것: 백엔드에서 '권상 해석 1회 → 이 exe 로 평가' 를 잇는 것과 Studio 결과 표는 7번. 백엔드 `_ALLOWABLE_PROPERTY_IDS` 사전 점검을 이 경로에도 쓸지 7번에서 정한다(exe 요약이 빠진 부재를 직접 알려 줌).
  - 145 반영(앱 공개 때): InHouse 새 폴더 `TrussModuleAssessment\` 복사(재시작 불필요).
- **2026-11-17 1단계 7번 완료(WorkBench 연결)** — Electron 은 수정 없음(IPC 가 viewer id 를 막지 않음 — 조사 결과). 사용자 결정: 새 기록 이름 `TrussModuleLifting`.
  - **백엔드**: `services/lifting_programs.py` `LIFTING_PARENT_PROGRAMS` = GroupModuleUnit, SidePassage, **TrussModuleLifting** — 업로드, deck-fix, 산출물, lifting-bdf, unit-structural 라우트와 `unit_structural_service` 의 부모 확인 6곳이 이 상수를 쓴다(기존 두 이름 그대로).
    새 라우트 `POST /api/analysis/trusslifting/request`(GMU 검증 작업 재사용, 폴더 `_TrussModuleLifting`), `GUARDED_ROUTES` 에 `/api/analysis/trusslifting/` = 'Truss Module Lifting', `usage_rollup.ROLLUP_PARENTS` 에 추가.
    구조 해석 작업: 부모가 TrussModuleLifting 이면 lift-result 뒤 `services/truss_module_assessment.py` 가 `<bdf 폴더>/truss_assessment/` 에 BDF, F06 사본을 두고 `TrussModuleAssessment.exe --f06 --case lifting` → 결과 JSON 에 `trussAssessment`(ok, error, summary, elements) 를 넣고 `result_info.trussAssessment` 에도 요약. 평가가 실패해도 구조 해석은 그대로, 경고로 남김.
    `admin_projects.LIFTING_PROGRAMS`(LogBook 권상 결과 세트)는 넣지 않았다 — Truss 결과를 LogBook 권상 참조로 보낼지는 따로 정한다.
    ⚠ Studio 의 자세안정성, 구조 해석은 GMU 경로를 함께 써서 App Settings 에서 GMU 를 점검 중으로 내리면 Truss 도 막힌다(입력 검증만 따로 게이트).
  - **Studio**: 소모듈 모델 파일 이름 = 글로벌 모델 파일 이름 — 백엔드가 `<BDF 이름>_edited.json` 으로 편집 모델을 찾으므로, 다르면 **글로벌 BDF 전체로 조용히 권상 해석**한다(조사에서 발견). 분할은 늘 `meta.trussModule` 없는 단계(글로벌)를 본다(폴더에 지난 소모듈 모델이 남아도).
    Analysis 탭 'Truss 소모듈 평가' 구역(`components/TrussAssessmentSection.jsx`, 판정 `data/trussAssessmentView.js` — 프론트 판정의 사본, 줄 누르면 3D 에서 부재 선택). zip 0.0.1 을 70 로컬 `StudioProgram` 에(UNC, 릴리스 표는 아직).
  - **프론트**: 카탈로그 'Truss Module Lifting'(권상·의장, Developing), 레지스트리(`programNames` TrussModuleLifting), `App.jsx` 경로, `requestTrussLifting`, 페이지 `pages/analysis/TrussModuleLifting.jsx`(공용 틀 — 검증 → Studio 설치와 열기 → 구조 해석 완료 알림의 `result.trussAssessment` 로 판정, 수치, UC 상위 15 표), 판정 `utils/trussLiftingVerdict.js`(+시험 4). 작업 탭, 결과 다시 열기, 대시보드 파일 전달은 붙이지 않았다.
  - 확인: 백엔드 새 시험 7(`tests/test_truss_module_lifting.py`) + 백엔드 시험 전체 종료 코드 0, 편집 계약 시험 0. 실제 InHouse 평가 exe 로 `run_truss_module_assessment` → 307행이 결과 JSON 에 들어감. 프론트 유틸 시험 525, 빌드. Studio 시험 1,043, lint 18, 빌드. 70 서버 manifest 에 `truss-lifting-studio` 0.0.1.
  - 70 백엔드 재시작(사용자) 뒤 `trusslifting/request` 가 401(로그인 필요 — 기존 GMU 라우트와 같은 반응, 등록됨).
  - **끝까지 확인(백엔드 작업 함수를 임시 SQLite 로, 사용자 MySQL 무변경)**: ① `task_execute_groupmoduleunit(…, 'TrussModuleLifting')` → 기록 TrussModuleLifting 성공, `3321_2tk_moving_04.json`
    ② 헤드리스 Studio 에 그 폴더를 넣어 분할 → 질량 → 작업 시작 → 훅 두 점, 와이어 20 m → 자세안정성(실제 InHouse 엔진): **올라간 파일 = `3321_2tk_moving_04_edited.json`, `_posture.json`**(이름 함정 수정 확인)
    ③ `task_execute_unit_structural(parent)` → 성공, `projectKind` TrussModuleLifting, 권상 BDF 의 CBAR **307**(글로벌 2,093 이 아니라 소모듈), `truss_assessment/` 하위 폴더에 평가 산출물,
    결과 JSON 과 `result_info` 에 trussAssessment(평가 307, Fail 191, 최대 UC 15.04 — 무른 시험 모델 탓).
    MU 기준 응력 요약(최대 33,971 MPa, 220 MPa 초과 275)은 Nastran 이 PBAR 응력 회복점으로 낸 값 — Truss 판정이 아니라 참고값(Studio 구역에 표시).
  - **확인 못 한 것**: WorkBench 개발 앱 안 페이지 화면과 [Studio 열기] 클릭(Electron IPC 실제 경로)은 눈으로 보지 않았다 — 위 확인은 작업 함수와 헤드리스 Studio 대역까지.
  - 반영: 70 백엔드 재시작(새 라우터) → 개발 앱에서 확인. 145 = `git pull + 재시작`, InHouse 3곳(bridge, Core.dll, `TrussModuleAssessment\`) 수동 복사, `/studio-release truss-lifting-studio`(UNC + 릴리스 표), 새 exe(페이지).
- **사용자 첫 사용 뒤 고친 것 (같은 날, Studio 0.0.2 = 70 로컬, 미커밋)** — 사용자가 개발 앱에서 Studio 까지 들어와 본 뒤 지적 3건.
  - WorkBench 페이지 입력 화면이 조잡 → TrussAssessment 와 같은 틀로(끌어 놓기 입력 칸 = 공용 `runFrame/BdfDropZone`, 진행 순서와 내 최근 실행,
    단계별 본문, 레일 주 버튼 하나). '결과 다시 열기' 등록(`utils/resultReentry.js`).
    ⚠ 그 수정 중 함수 두 개(`resetAll`, `handleFile`) 정의가 빠져 페이지가 ReferenceError 로 죽었다(자동 치환이 조용히 실패, 빌드는 통과).
    이 PC 는 프론트 eslint 가 안 돌아 못 잡았다 → 임시 설정으로 `no-undef` 만 돌려 확인(스크래치 `undef.config.mjs`). 화면 코드를 고치면 이 검사를 함께 돌린다.
  - 3D 단면이 650 mm 상자로 모델을 메움 → 단면적 기준 굵기의 봉(`pbarDisplayDiameterMm`, 60~200 mm). 해석과 무관(자중 = A, 간섭 임계값 = 바깥 치수 그대로).
  - Model Builder 전용 항목 걷기: 배관, U-bolt 레이어 단추, 자동 연결, 입력 감사 탭, 부재 종류로 지우기, '미해결 U-bolt' 줄.
  - **분할 화면 개편**(사용자: '가장 중요한 과정인데 어렵고 복잡하고 조잡') — 규칙은 Studio README '분할 탭 화면 규칙'.
    왼쪽 = 세 걸음(① 높이: LV 사다리 ② 영역 ③ 집중질량) + 자른 결과 요약, 가운데 = 도면과 3D 미리보기 나란히, 영역은 꼭짓점을 끌어 고침,
    사각형 도구가 켜진 채 시작, 걸친 부재 목록과 JSON 저장 단추는 없앰. LV 고르기 규칙 = `moduleSplit.pickLevelRange`(+시험).
  - 함께 찾은 결함: 개발 모드(StrictMode)에서 3D 첫 화면 카메라가 맞지 않음 — 카메라를 다시 만들 때 '맞춤 끝' 표식이 남아 있었다(`ThreeViewport` 정리 코드에서 비움).
    앞의 '3D 첫 화면 카메라 미맞춤' 기록이 이것이다. 배포용 빌드는 원래 정상(헤드리스로 확인).
  - 확인: Studio 시험 1,049, lint 는 MU 에서 온 18건 그대로(고친 파일 0건), 헤드리스 Chrome 으로 dev 와 배포용 빌드 둘 다
    분할(LV, 끌어 그리기, 꼭짓점 고치기, 부재 올리기, 배치 전환, 1600과 1280 폭) → 작업 시작 → Hoist → 글로벌로 돌아가기, 화면 오류 0.
    70 백엔드 manifest = 0.0.2. **WorkBench 앱 안에서 연 Studio 화면은 눈으로 보지 않았다.**
  - 남긴 것: 소모듈로 작업 중일 때 3D 미리보기는 작업 모델을 보인다(다른 영역 미리보기는 글로벌로 돌아간 뒤). 정면도, 측면도는 모델이 납작해 작게 보인다(세로 확대 없음).

- **두 번째 지적 뒤 고친 것 (같은 날, Studio 0.0.3 = 70 로컬, 미커밋)** — 사용자: '도면과 3D 를 같이 보는 것은 좋다. 다만 영역 설정이 헷갈린다'.
  - **고르는 방식을 바꿨다(D4 구현 방식 변경)**: 도면마다 영역 다각형 하나(겹치는 곳) → **상자로 넣고 빼기**(HyperMesh 손동작).
    Shift + 끌기 = 넣기, Shift + 오른쪽 끌기 = 빼기, Esc = 선택 해제, Ctrl+Z = 되돌리기, A / S / D = 평면도 / 정면도 / 측면도.
    소모듈 = `module.ops`(넣고 뺀 동작 순서) 적용 결과. 높이(LV)는 거르개. 다각형 영역, 꼭짓점 고치기, 도구 단추는 없앴다.
  - 그에 따라 **자르는 선 위 pair 판정 규칙이 바뀌었다(D6 구현)**: 예전 = 다각형 변 위의 부재 + 변 반대편으로 건너가는 부재.
    지금 = 소모듈 pair 부재 끝에 고르지 않은 부재가 옆으로(수평으로, 나란하지 않게) 뻗어 있음. 위아래 기둥만 빠진 경우(높이로만 자름)는 해당 없음.
    ⚠ 이 규칙은 제가 정한 것이다 — 실제 모델의 pair 가 어떤 방향으로 나뉘는지 사용자 확인이 필요하다(화면에서 하나씩 끌 수 있다).
  - LV: 부재 끝점만 모인 높이(Leg 맨 아래)는 LV 가 아니다 → 3321 은 Z 2,940 이 LV1(예전 LV1 = 770 제외, 번호가 하나씩 당겨짐).
  - 3D 미리보기는 보기 전용임을 분명히(호박색 표시, 점선 테두리, 누르면 안내). 부재 색을 밝게(본 구조 `#BFE0FF`), 3D 단면 봉 지름 두 배(5 × √A, 120~400 mm).
  - 확인: Studio 시험 1,049, 헤드리스 Chrome 동작 점검 14항목(dev 1600 폭, 배포용 빌드 1600 폭) 모두 통과, 화면 오류 0.
    배포용 1280 폭에서는 14항목 중 '정면도에서 빼기' 하나가 점검 스크립트의 끌기 자리 문제로 실패(화면이 납작해 상자가 LV1 아래만 덮음, 제품 결함 아님).
    70 백엔드 manifest = 0.0.3. **WorkBench 앱 안 Studio 화면과 실제 마우스 오른쪽 끌기는 눈으로 보지 않았다.**

- **세 번째 지적 뒤 고친 것 (같은 날, Studio 0.0.4 = 70 로컬, 미커밋)** — 사용자가 실제 모델(174k_2tk_rev5, LV 10개)로 써 본 뒤.
  - "평면도와 정면도는 다 고른 것처럼 보이는데 측면도는 일부만 골라져 있다, 이상하다" → 사용자 모델로 재현.
    평면도에서만 넣으면 세 도면 모두 다 골라진다(2,393개). 사용자 그림은 **Y–Z 도면에서 왼쪽 아래(LV6 아래)를 뺀 상태**와 같은 그림이다(1,836개).
    선택 계산은 맞았고 **표시가 속였다** — 도면은 깊이 방향 부재가 겹치는데 고른 부재를 위에 그려, 뺀 것이 다른 도면에서는 안 보였다.
    → 겹친 부재를 모두 골랐으면 실선, 일부만 골랐으면 긴 점선(범례 '겹친 부재 가운데 일부만 고름').
  - "측면도 이게 정면도야" → Truss 는 Y–Z 면이 정면도. 분할 도면과 3D 표준 뷰(S, D)를 함께 바꿨다(MU 와 반대 — README 에 기록).
  - 색이 너무 쨍하다 → 부재 `#A0B6D2`, 고른 부재 `#57c49b` 등으로 낮춤.
  - 확인: Studio 시험 1,050, 동작 점검 14항목(dev, 배포용 빌드) 통과, 사용자 모델로 세 도면 캡처. 70 manifest = 0.0.4. 앱 안 화면은 눈으로 보지 않았다.

- **pair → single 을 사용자가 고르게 바꿈 (2026-11-18, Studio 0.0.5 = 70 로컬, 미커밋)**
  - 174k 모델을 가운데 X 격자선(25,740)으로 잘라 판정을 점검: 선 위 pair 134개는 다 잡았지만, 선과 직각으로 끝만 닿은 안쪽 Girder(P8) 32개를
    잘못 잡았다(그 끝에서 선 너머로 가는 수평 사재를 '옆' 으로 봄). → 부재 끝에서 앞쪽으로 계속 뻗는 부재는 옆으로 보지 않게 고쳐 134/134, 잘못 0.
  - 선 위인데 그 층에서 건너편에 구조가 없는 pair(예 X 40,023 LV 4,140 의 E6152 P9)는 자동 판정으로 가를 수 없다 → 사용자 결정:
    **바꿀 부재는 사용자가 정한다.** 도면 Alt + 누르기(MU 의 Alt + 클릭과 같은 손동작), 패널 [후보 모두 single], 자동 판정은 하늘색 점선 후보로만.
  - 확인: Studio 시험 1,053, lint(바꾼 파일), 빌드, 헤드리스 실제 마우스 점검 7항목(자동으로 안 바뀜, Alt 말풍선, Alt + 누르기 하나, 되돌림, 후보 모두 46개 — 짝 없는 후보 88개는 안 바뀜) 통과. 70 manifest = 0.0.5.
    WorkBench 앱 안에서 Alt 키를 눌렀을 때 창 메뉴로 포커스가 가지 않는지는 보지 않았다(keydown 기본 동작은 막아 둠).

- **분할 범위 화면을 범위 상자로 다시 짬 (2026-11-18, Studio 0.0.6 = 70 로컬, 미커밋)** — 사용자: '분할 범위 설정이 너무 직관적이지 않다. 현재 절차는 무시하고 다시'.
  - 진단: 넣고 뺀 동작이 눈에 안 보이게 쌓이고(`ops`), 높이는 패널에서 따로 정하고, 도면 하나를 바꿔 가며 겹친 부재를 읽어야 했다.
  - 새 방식 = **범위 상자 하나**(화면 캡처 도구 방식). 평면도와 입면도를 함께 보이고, 끌어서 그리고 테두리를 끌어 고친다. 테두리는 격자선(절점 좌표, LV)에 붙는다.
    보조 키가 필요 없다. LV 사다리는 같은 상자의 높이를 누르는 다른 손잡이다. 규칙과 없앤 방식 = Studio README '분할 탭 화면 규칙'.
  - 정의가 바뀜: `module.box` + `include` + `exclude`(옛 `ops`, `region` 은 읽지 않는다, `exportDefinition` version 3). 분류 결과 모양(`elementIds`, `crossing`, `boundaryPairs`, `swaps`)은 그대로라
    집중질량, 소모듈 모델 만들기, 작업 시작은 고치지 않았다.
  - 한계: 상자 하나라 L 자 모양 소모듈은 부재를 하나씩 눌러 보태야 한다. 높이 경계의 기둥(한쪽 끝이 범위 밖)은 '잘려서 빠진 부재' 로 남고 하나씩 넣는다 — 한 번에 넣는 단추는 아직 없다.
  - 확인: Studio 시험 1,055, lint(바꾼 파일), 빌드, 헤드리스 실제 마우스 점검 16항목을 174k(1600 폭)와 3321(1280 폭) 두 모델에서 통과
    (끌어 그리기, 입면도 위아래 테두리, 평면도 테두리, Ctrl+Z, 패널 한 칸씩, S/D, 부재 하나 빼기, pair 후보, 끌다 Esc, Esc 해제, 3D 눌러도 그대로). 화면 오류 0.
    70 로컬에 zip 0.0.6 저장(그때 9091 이 꺼져 있어 manifest 주소는 확인 안 함). **WorkBench 앱 안 화면은 눈으로 보지 않았다.**

- **미리보기 키, 집중질량 두 칸, 여러 소모듈 조사 (2026-11-18, Studio 0.0.7~0.0.9 = 70 로컬, 미커밋)** — 사용자 지적 3건.
  - ① 미리보기를 누르면 A / S / D 가 미리보기를 움직인다: 키를 받는 칸 = 마지막으로 누른 칸(`useSplitStore.focus`, 판정 `splitKeyTarget`).
    도면이면 S / D = 입면도 방향, 미리보기면 A / S / D / F = 3D 표준 뷰(마우스 위치와 무관), 테두리 실선, Esc 는 범위를 지우지 않고 키만 도면으로.
    누를 때 띄우던 '여기는 미리보기입니다' 는 Shift + 끌기에만 남겼다.
  - ② 집중질량 = Plywood(바닥 면적당 0.63 t/m² 기본) + Square Tube(**소모듈 전체 총중량 t 를 넣음**, 0.0.8 사용자 결정 '일단 전체 ton, 차후 변경 가능성 있음'. 비면 시작할 때 확인 창, 0 = 없음).
    Plywood 단위를 kg/m² 에서 t/m² 로 바꿈(1 t/m² = 1e-6 t/mm²). Square Tube 총중량은 넣는 칸 면적에 비례해 모든 층에 나눈다(LV 별 값은 Plywood 만 바꿈).
    `areaMass.reconstructAreaMasses` 는 단위 면적당(`tonPerM2`)과 총중량(`extraTon`) 둘 다 받고, 어느 항목을 어느 모양으로 넣는지는 `useSplitStore.splitMassInputs` 한 곳 —
    Square Tube 를 단위 면적당으로 되돌릴 때 그 함수와 패널 단위 글자만 고치면 된다. 패널에 항목별 질량과 PointMass 절점 수. 정의 내보내기 version 5(`massTubeTon`).
    **단위 확인 끝(사용자: 'ton/m^2 이야')** — 0.0.9 에서 단위 확인 경고를 뺐다. 참고 숫자: Plywood 0.63 t/m² 면 174k 샘플 범위(바닥 2,405 m²)에서 1,515 t = 그 범위 글로벌 CONM2 합(약 111 t)의 13.6배(3321 은 710 t, 29배). plywood 밀도가 보통 0.6~0.7 t/m³ 이라
    밀도가 아닌지 물었고 t/m² 가 맞다는 답을 받았다. 다시 묻지 말 것.
  - ③ 여러 소모듈을 Case 로 저장하고 한 번에 권상(조사만, 구현 안 함): 정의(`modules[]`)는 이미 여러 개가 되지만 해석은 막힌다 —
    산출물 이름과 부모 연결이 글로벌 BDF stem 하나에 묶여 있어(`moduleWork.js` 가 sourceFileName 을 글로벌 이름으로 고정, `unit_structural_service` 가 시작할 때 `<stem>_lifting.*` 삭제,
    `_validate_unit_stability_path` 는 부모 BDF 와 같은 폴더만 허용) 소모듈 둘이 서로 덮어쓴다. 권상점, 편집, 결과 스토어도 전역 하나라 소모듈을 바꾸면 지워진다.
    추천 = Studio 가 소모듈마다 순서대로 올리고 실행하는 대기열 + 파일 이름에 case 접미(부모 1건, 자식 N건, InHouse 변경 없음, Electron 은 선택 인자 하나).
    서버 일괄 실행 API 는 변경이 서너 배, 소모듈마다 Studio 창은 'Case 로 저장, 한 번에' 요구와 안 맞음. 사용자 결정 대기.
  - 확인: Studio 시험 1,066, lint(바꾼 파일), 빌드, 헤드리스 실제 마우스와 키 22항목을 174k(1600 폭)와 3321(1280 폭)에서 통과, 범위 상자 16항목 회귀 통과. **WorkBench 앱 안 화면은 눈으로 보지 않았다.**

- **소모듈 여러 개를 Case 로 두고 한 번에 권상 (2026-11-18, Studio 0.0.10 = 70 로컬, 백엔드와 WorkBench 화면 포함, 전부 미커밋)** — 사용자 결정 '순차 대기열로 진행'.
  - Studio: 소모듈마다 권상 지정, 편집, 결과를 보관하고(`data/moduleCases.js`) 분할 탭 [전체 해석] 이 하나씩 실행한다(`data/moduleBatch.js`, 진행 창 `BatchRunOverlay`).
    규칙 원본 = Studio README '소모듈 여러 개와 전체 해석'. 소모듈을 바꿀 때 묻던 '권상 지정이 지워집니다' 확인 창은 없앴다(보관되므로).
  - 백엔드: 산출물 이름 머리를 stability 파일 이름에서 읽는다 — `<bdfStem>__<caseId>_stability.json` 이면 `<bdfStem>__<caseId>_lifting.*`, `_edited.json`
    (`unit_structural_service.resolve_work_stem`, 구조 해석과 'Wire 포함 BDF 받기' 공용). Case 인데 소모듈 모델이 없으면 글로벌 BDF 로 넘어가지 않고 실패.
    결과 JSON 에 `case { id, name }`, 기록에 `input_info.case_id / case_name`, `result_info.caseId / caseName`. artifacts 응답에 `cases[]`(Case 마다 최근 성공 1건과 산출물, 다른 Case 파일을 집지 않는 exact 찾기).
    Case 표식이 없는 이름(MU, Side Passage, 옛 Truss Studio)은 예전 그대로다. **Electron 과 InHouse 는 고치지 않았다**(stability 경로가 Case 를 알려 준다).
  - WorkBench 화면(`TrussModuleLifting.jsx`): 완료 알림을 소모듈마다 받아 탭으로 고른다(`utils/trussLiftingVerdict.js` `trussCaseKey`, `summarizeTrussCases`), 단계 표시는 가장 나쁜 판정.
  - 확인: 3321 모델로 소모듈 2개를 **실제 자세안정성 엔진과 실제 백엔드 작업 함수(Nastran 각 13초, Truss 평가)** 로 끝까지 — 소모듈별 파일이 따로 남고, 결과에 표식이 붙고,
    [결과 보기] 가 그 소모듈과 결과를 연다(헤드리스 21항목). 옛 서버 흉내(표식 없는 결과)에서 결과를 버리는 것도 확인. Studio 시험 1,081, 백엔드 관련 시험 60, WorkBench 유틸 시험과 빌드.
    **확인 안 함**: WorkBench 앱 안에서 Electron 을 거친 실행(헤드리스는 Electron 자리를 대역으로 채움), WorkBench 결과 화면의 소모듈 탭(빌드만), [이 소모듈이 끝나면 멈춤], 174k 모델로 전체 해석.
  - 참고로 3321 소모듈(강재 약 60 t)에 Plywood 0.63 t/m² 를 모든 LV 바닥에 넣으면 집중질량이 1,018 t 이 되어 최대 UC 334, 변위 35 m 가 나왔다(권상점은 시험용으로 맨 윗층 네 모서리).
    단위는 사용자 확인(t/m²)이라 그대로 두었고, 이 숫자는 사용자에게 보고했다.
  - 남은 것: 소모듈 정의와 권상 지정을 Studio 를 닫은 뒤에도 남기기, 실행 중인 Nastran 끊기, 소모듈을 묶은 보고서, 서버 일괄(동시) 실행.

- **분할 패널 재배치, 부재 자중, 바닥 칸 3D (2026-11-18, Studio 0.0.11 = 70 로컬, 미커밋)** — 사용자 지적 4건(/design). 규칙 = Studio README '분할 패널 배치'.
  - **bridge PBARL 읽고 쓰기 (같은 날, 사용자 '진행해')** — 174k 의 `PBARL` 17, 18, 37, 39(ROD, BAR)를 bridge 가 property 로 읽지 않아 그 부재가 단면 없이 들어왔다
    (자중과 3D 굵기가 빠지고, BDF 검증 진단에 `MISSING_ELEMENT_PROPERTY` 경고가 부재 수만큼 쌓였다 — 8276 모델 1,374건).
    BDF 를 다시 쓸 때는 원본 카드를 그대로 옮기는 경로(`passthroughBulk`)로 살아남아 **해석이 깨지지는 않았다**(앞서 '깨질 가능성이 크다' 고 한 추정은 틀렸다).
    이제 `parse_property` 가 PBARL(GROUP, TYPE, DIM, NSM — DIM 수는 `PBARL_DIM_COUNT` 표)을 읽고 `convert_json_to_bdf` 가 고정필드로 쓴다. `MODELED_BULK_CARDS` 에 넣어 원본 카드와 겹쳐 쓰지 않고,
    PBARL 을 참조하는 요소는 CBAR 로 쓴다. 70: `WorkBenchSubModule/Nastran_bridge` 와 InHouse `NastranBridge` 둘 다(같은 내용, 백업 `.bak_20261118_before_pbarl`).
    확인: PBARL 없는 샘플 4개(GMU 3496, HPSCR, 해상 운송 3521, Side Passage) JSON 과 BDF 가 수정 전과 같음 · 174k 소모듈 2개 전체 해석(ROD 부재 496, 452개 포함) Nastran FATAL 0 ·
    174k 부재 자중 115.6 → 122.5 t(빠졌던 ROD 부재가 들어옴). 참고: 글로벌 모델을 bridge 로 통째로 다시 쓰면 SPC 2~6 이 빠져 FATAL 9050 이 나는데 수정 전에도 같다(소모듈은 SPC 를 버리고 권상 구속을 새로 넣어 무관).

- **훅을 무게중심 위에 (2026-11-18, 사용자 '권상 위치 지정이 너무 strict 한지 평가' → 추천안 진행, Studio 0.0.12 + InHouse GroupModuleAnalysis, 미커밋)**
  - 진단: 엔진은 훅을 권상점 평균 위에 두고(같은 길이 슬링 가정) 무게중심이 그 아래에서 대각선 1% 이상 벗어나면 전도 FAIL. 비대칭 무게중심 모듈은 거의 다 FAIL 이었다.
    판정 자체는 같은 길이 슬링이면 맞고(실제로 기운다), 허용치 대각 1%(약 0.9°)는 근거가 약하다(엔진 주석도 각도 기준으로 바꿀 예정이라고 적음).
  - 결정: 현장 방식대로 **훅 하나면 슬링 길이를 맞춰 훅을 무게중심 위에** 둔다. posture `apexPlacement: "overCog"`(Truss Studio 만 보냄) → 엔진 Stage 3 이 정점을 (COG.X, COG.Y, 권상점 평균 Z + Wire)에 두고
    슬링마다 길이(`results[].slings`, `slingLengthMin/Max/DiffMm`)를 남긴다. 훅이 둘 이상, Trolley, 무게중심이 권상점 다각형 밖이면 기존 규칙 + 사유(`apexPlacementNote`). 슬링 길이 차 상한은 사용자가 주지 않아 두지 않았다.
  - Studio: Hoist 패널에 평가 전 안내(무게중심이 권상점 안쪽인지, 밖이면 경계까지 거리 — `hoistPreflight.cogInsideHoistPolygon`), 결과 패널에 '슬링 길이' 표.
  - 엔진: `ModuleUnitAnalysis`(미커밋, 같은 저장소에 10-01 다른 작업의 미커밋 변경도 있음) — 시험 199 통과(새 5건). MU 기록 3건과 Truss 1건을 옛 exe 와 새 exe 로 돌려 **옵션 없으면 값이 모두 같고 새 칸만 붙음** 확인.
    70 InHouse `GroupModuleAnalysis` 의 Core, Stability, Cli dll 과 exe 교체(백업 `.bak_20261118_before_overcog`, Stability sha256 45baa1fe…, Core 46004c54…).
  - 확인: 174k 소모듈 훅 하나 비대칭 4점 — 예전이면 FAIL 인 배치가 전도 통과(어긋남 0), 슬링 23.8~29.9 m(차 6.2 m). 권상점을 한쪽에 몰면 기존 규칙과 사유. 그 배치로 구조 해석까지 Nastran FATAL 0.
  - **남은 문제 2건(이번에 안 고침)**: ① 훅 하나에 슬링 4가닥은 부정정이라 구조 해석에서 한 가닥이 압축(-9.6 MN)으로 나왔다 — 실제로는 그 가닥이 늘어지는 것.
    ② Truss 소모듈 구조 해석 변위가 수십 m(3321 35 m, 174k 66 m)로 비정상이다 — 매커니즘(연결이 덜 된 부재)이나 하중 크기를 먼저 봐야 한다. 결과 숫자를 판정에 쓰기 전에 원인부터.

- **변위 수십 m 원인 조사 (2026-11-19)** — 해석기나 bridge 의 연결 오류가 아니다(3321: 행렬비 2.2e3, epsilon 7.7e-12, 반력 합계 = 넣은 무게, 단면 카드는 원본과 같음, 맨 위 가로 부재 틈은 전역 모델에도 있음).
  - ① **집중질량이 원래 모델의 십수 배** — 0.63 t/m² 를 모든 층 바닥 전체에 넣어 3321 소모듈 1,018 t(원래 모델 전체 CONM2 117.8 t, 바닥 밀도 0.015~0.034 t/m²), 174k 도 같음(원래 0.015~0.093).
  - ② **권상 배치** — 훅 하나에 32 m 떨어진 두 점(슬링 36.6°)이면 권상점마다 약 438 t 이 안쪽으로 당긴다. 슬링만 수직으로 바꾸면 35.6 → 16.8 m.
  - ③ **구조 자체가 유연** — 수직 슬링 + 강재 자중만이어도 0.89 m(권상점이 바깥 가장자리, 가는 기둥 P16, 원본 J=1). 집중질량 ×0.05 면 1.69 m.
  - ④ **bridge 결함: 훅 하나면 매커니즘** — 슬링이 모두 한 점에 모여 모듈이 훅을 중심으로 돌 수 있는데, 강체 운동 막는 고정은 노드 하나의 X, Y 뿐이라 '훅–고정 노드' 축 회전이 남는다
    (174k 단일 훅 1e11 mm). 멀리 있는 노드 하나의 X 를 더 묶으면 풀린다(손으로 고친 BDF: 행렬비 1.3e5 → 4.6e4, 1e11 mm → 40 m). **아직 안 고침** —
    bridge 는 MU 와 공용이라 posture `apexPlacement: "overCog"` + 훅 하나일 때만 고정을 더한다(MU 불변). 고정 노드 반력이 크면 훅이 무게중심 위에 있지 않다는 뜻이니 함께 보인다.
  - 사용자 결정(같은 날): Plywood 0.63 t/m² 는 요청받은 값 그대로, **설치 층을 사용자가 고른다**(처음은 아무 층도 안 고름), Square Tube 도 같은 층에. 기존 상태와 설치 후 중량을 함께 보인다.

- **설치 층 고르기와 기존 상태 중량 (2026-11-19, Studio 0.0.13 = 70 로컬, 미커밋)** — 규칙 = Studio README '설치 층과 기존 상태 중량'.
  - 중량 구역에 설치 층 체크 목록(줄마다 바닥 면적, 기존 질량, 설치 후 질량, [모두] [해제]) + 표 '기존 상태 | 설치 후'(부재 자중, 기존 집중질량 → 지움, Plywood, Square Tube, 합계).
    고르지 않으면 경고, 작업 시작 때 '설치 층 없이 시작할까요?'. 고르지 않은 층은 평면도, 3D 에 칸을 칠하지 않는다. 설치 층은 정의 키에 들어가 [전체 해석] 이 다시 돌린다.
  - 확인: 시험 1,092 통과(새 시험 5건), lint, 헤드리스 Chrome 1600·1280(3321: 안 고름 = 설치 후 42.2 t / 기존 60.5 t, LV3·LV4 고름 = 474.7 t, 모두·해제). WorkBench 앱 안 화면은 확인 안 함.

## 5. 위험과 확인할 것
- 실제 대상 글로벌 모델로 확인한 적이 없다(3321 샘플과 HyperMesh 원본 하나만 봄). 1단계 시작 전에 사용자에게 실제 모델 1개를 받는다.
- LV 를 Z 레벨 군집으로 자동 판정할 때 허용 오차(작은 Z 차이를 같은 LV 로 볼지).
- 닫힌 칸 찾기가 사선 부재, 겹친 부재, 칸 안의 칸에서 어떻게 동작하는지.
- 절반 Girder PID 의 허용값 = pair 절반이 공학적으로 맞는지(허용 축력, 모멘트가 단면에 비례한다는 가정) — 사용자 확인.
- 전용 exe 의 CROD 섞인 F06 파싱은 코드 읽기로만 확인함 — 첫 실제 해석에서 확인.
- InHouse 반영: 전용 exe 와 bridge 수정은 145 수동 교체 대상.
