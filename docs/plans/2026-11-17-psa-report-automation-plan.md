# PSA 평가보고서 자동화 프로그램 — 1단계 입력 화면 계획 (2026-11-17)

Productivity Apps 에 새 App `PSA 평가보고서 자동화 프로그램`(category `Report`, devStatus `Developing`, contributor 권혁민)을 둔다.
1단계는 **입력(key-in 과 결과 폴더 선택)만** 만든다. 결과 파일 읽기와 보고서 생성은 입력이 갖춰진 뒤 사용자가 상세를 주면 이어서 계획한다.
백엔드 변경 없음(프론트만, exe 재빌드 불필요).

## 결정 (사용자 확인, grilling 2라운드)

| # | 결정 |
|---|---|
| 1 | Scope 표의 줄마다 결과 폴더 칸, 표 아래 보고서 그림 폴더 칸 1개. 고르면 파일 목록만 보이고 내용은 아직 읽지 않는다 |
| 2 | 저장 = 화면 자동 임시 저장(이 PC localStorage) + 입력 파일 저장과 불러오기(JSON 한 파일). 서버 저장은 보고서 생성 단계에서 |
| 3 | [+] = 가장 큰 TD 번호 + 1, COMP.RM 바로 위에 넣는다. ↑↓ 로 순서를 바꿔도 번호는 다시 매기지 않는다(결과 폴더와 짝). Line No. 와 Pipe Line 은 직접 고침. COMP.RM 은 하나만(지울 수 있고, 없을 때만 다시 추가) |
| 4 | Process Condition 칸은 모두 글자 칸(두 줄 허용), 단위는 칸 안에 적는다. 표 아래 각주 칸 하나. Fluid, Insulation 은 제안 목록 |
| 5 | 새로 추가한 Line 의 Process Condition 은 비워 둔다(복사하지 않음) |
| 6 | Displacement 는 8칸 고정, 실수(mm/m, 음수 허용), 줄 추가와 삭제 없음 |
| 7 | Acceleration 위 표(Position) Discipline 을 아래 표(Load) 각 줄이 콤보로 고른다. 두 표 모두 줄 추가, 삭제, 수정. 값은 실수 |
| 8 | Manifold Load: System = Scope 의 Line No. 콤보(기본 TD01, TD02), Pipe size 콤보 7개(100, 150, 200, 250, 300/350, 400, 500, 표기 `400A`). 고르면 Fx=Lateral, Fy=Axial, Fz=Vertical, Mxz, My=Mt 가 읽기 전용으로 채워진다. Mx, Mz = Mxz/√2 는 저장만 |
| 9 | Line 을 지우면 Process Condition 줄은 함께 지우고, 그 Line 을 쓰는 Manifold 줄이 있으면 앱 안 확인 창 뒤 함께 지운다(되돌리기 없음) |
| 10 | 공통 틀: 왼쪽 단계 레일 5단계(단계마다 빈 칸 수) + 오른쪽 고른 단계의 표. [보고서 만들기]는 꺼 둠 |
| 11 | 앱 등록 = 위 첫 문단 |
| 12 | 빈 칸은 막지 않고 레일에만 알림. 실수 칸에 숫자가 아닌 글자는 그 칸만 빨간 테두리 |
| 13 | 폴더 선택 = 브라우저 `<input webkitdirectory>` |
| 14 | (같은 날 사용자 지시로 1번 변경) 폴더를 고르면 **바로 서버에 같은 구조로 올린다**: `userConnection/<ts>_<사번>_PsaReport/<Line No.>/…`, 그림 폴더 = `…/Figures/…`. 작업 폴더는 입력 한 벌에 하나(입력과 JSON 에 이름 저장). 같은 칸에서 다시 고르면 서버 폴더를 비우고 새로, 폴더 지우기와 Line 삭제는 서버 폴더도 지움. 앱을 다시 열면 서버에 남은 폴더와 맞춘다(고른 파일 수보다 적으면 '올리기 실패'). 30일 정리로 작업 폴더가 없어지면 다시 선택 |

| 15 | (같은 날 사용자 지시로 4번 변경) Process Condition 숫자 칸은 **숫자만 + 고정 단위**(°C, barg, kg/m³). 칸 = `{a, b, join}`, join = `range`(~) · `and`(&) · `alt`(보조 값, 보고서 두 줄 `45°C(*)`). Fluid, Insulation 은 목록 선택(LNG, NG, LNG & NG / A, N/A, N/A & A). 입력 형식 2판, 1판 글자 값은 숫자를 뽑아 옮긴다(`readValueCell`) |
| 16 | 입력값 전체를 작업 폴더의 `psa_input.json` 에 자동 저장(값을 고치고 1.2초 뒤, 처음 연 순간은 안 함). 화면 [입력 파일 저장] 과 같은 내용이라 **이 JSON 하나로 같은 상태가 이어지고, 보고서 생성도 이 파일만 읽는다**. JSON 의 `report.process` 는 단위를 붙인 보고서 표기(읽기 편의용, 원본은 입력값) |
| 17 | 표 모양 = **엑셀형 격자**(사용자 선택, 같은 날 상자형을 바꿈): 보고서 표 같은 격자선, 칸에 상자 없이 값만, 누른 칸만 파란 테두리. 단위는 머리글 `(°C)`. Enter = 같은 열 아랫칸, Shift+Enter = 윗칸. 둘째 값 + 는 칸에 마우스를 올리거나 들어가면 보임. colgroup 고정 폭(`table-fixed`). Displacement 는 Hogging, Sagging 두 열 + 온도 영향(Sun, Cold) 표 |
| 18 | Process 표 설명 기본 문단 = 사용자가 준 문장(ambient 21℃, (*) liquid main 적용 부위, (**) compressor room). 보고서 Table 2.3 아래 문단, 고칠 수 있음(입력 3판) |

| 19 | **최상단 폴더로 한 번에**(사용자 요청): 호선 PSA 폴더를 고르면 하위 폴더 이름으로 Line 을 맞춘다(`lineFromFolderName` — `TD-01`, `TD_01`, `TD01` → TD01, `Compressor Room`, `Comp RM` → COMP.RM). 폴더만 있는 Line 은 추가(폴더 이름 뒤 글자 = Pipe Line), 폴더 없는 Line 은 제거, 적용 전 확인 창. Line 폴더는 `작업폴더/<Line No.>/…`, 최상단 파일과 못 맞춘 폴더는 `작업폴더/Others/…`(구조 그대로). `~$`, `*.tmp` 는 올리지 않음. 실제 3441 폴더: 7개 모두 연결, 추가와 제거 없음, Others 2개(이전 보고서), 임시 33개 제외, 약 840MB |

| 20 | 3, 4 단계 기본값 = 3441 보고서 Table 2.4~2.6(입력 4판): 변위 +0.81/-0.87, +0.55/-0.50, +0.81/-0.87, Sun +0.29, Cold -0.47 mm/m(부호 없이 저장, 보고서가 + 를 붙임) · 위치 Trunk Deck 57000/8190/37800, Cargo Compressor Room 77150/3200/44000 · 가속도 0.31/1.255/0.579, 0.155/0.6275/0.2895, 0.345/1.391/0.429 g. 위치 이름 `Comp. RM` → `Cargo Compressor Room`. Sun, Cold 머리글에 (+45℃), (-18℃). 3판 이하 입력은 그 표가 모두 비었을 때만 채움 |
| 21 | 화면 정리(사용자 요청 2026-11-17): ① 앱을 열 때마다 Piping line 을 비우고 시작(`createBlankInput`, 이 PC 임시 저장은 읽지도 쓰지도 않음 — 이어 하려면 입력 JSON 불러오기). 줄이 생기면 알려진 Line 번호는 Process 기본값, Manifold 가 비었으면 TD01, TD02 400A ② 체크리스트를 2단계 '보고서 파일 확인' 으로 분리 — 위 = Line 한 줄씩 요약표(스크롤 없이 한눈에), 아래 = 누른 Line 하나의 자세한 표 ③ 보고서 그림 폴더, 기타 파일(Others) 화면에서 뺌, 최상단 폴더의 Others 는 올리지 않음 ④ '입력 완료' 표시 없음(기본값이라 의미 없음) — 잘못된 값만 단계에 표시, 빈 칸과 빠진 파일은 [보고서 만들기] 를 누를 때 `reportProblems` 가 단계별로 알리고 그 단계로 이동 |
| 22 | **빠진 자료는 승인 후 빼고 진행**(사용자 제안 2026-11-17): [보고서 만들기] 때 `reportProblems` 가 block 과 skip 으로 나눈다. block = Line 없음, Line No. 빈 칸이나 중복, 숫자가 아닌 값, 아직 '고르기'인 파일(고르지 않으면 다른 해석본이 조용히 들어갈 수 있어서) → 그 단계로 이동. skip = 빠진 파일, 결과 폴더 없는 Line, 빈 칸 → 확인 창 '빠진 자료를 빼고 진행할까요?' 승인 시 목록을 입력 JSON `reportExclusions` 에 남기고, 보고서 그 자리에는 '자료 없음' 을 적는다(생성기 구현 때) |
| 23 | **보고서 생성기 1차(2026-11-18, 사용자 지시 'R2 Word 양식 그대로')**: 서식 = `app/templates/psa_report/report_template.bin`(R2 docx 평문 사본, .bin 은 DRM 재암호화 방지). `services/psa_report_docx.py` 가 문장, 그림, 머리말은 두고 표만 바꾼다 — Table 1.1, Process(°C→℃, COMP.RM 에 (**)), Displacement 값 칸(+ 부호, mm/m), 가속도 위치와 하중, Manifold, 6장 Line 절(입력에 없는 Line 절 삭제 — 구역 나눔 문단은 남김, 모델 수보다 많은 표와 캡션 삭제, 유체와 보온 줄 갱신, COMP.RM 은 그대로). 빈 자리 = '자료 없음'. 목차와 표 번호는 `updateFields` 로 Word 가 열 때 갱신(한 번 묻는다). 표 값 규칙 = `services/psa_report_tables.py`(Restraint: MAX 줄 ÷1000, 변위 Node−Cnode / Code Compliance: CASE k→Lk 최대 응력비). 라우트 `POST /report {workspace}` → psa_input.json + 고른 파일로 docx 를 메모리에서 바로 응답(경고는 `X-Report-Warnings`), 기록 `PsaReport` 1건. 고른 경로가 작업 폴더 밖이면 무시. 의존성 `python-docx==1.2.0`(requirements 추가). 실데이터 3441 로 3.7초, 시험 `tests/test_psa_report_docx.py` |

### 업로드 구현 메모

- 서버 `app/routers/psa_report.py` — `POST /workspace`, `GET /workspace`(남은 폴더별 파일 수), `POST /folder-upload`(묶음, 첫 묶음 reset), `POST /folder-remove`, `PUT /input`·`GET /input`(psa_input.json, 2MB 상한, 임시 파일 뒤 교체). `GUARDED_ROUTES` 등록. 시험 `tests/test_psa_report_upload.py`.
- 화면이 파일 50개 또는 100MB 단위로 나눠 차례로 보낸다(`planBatches`). 서버는 묶음 안 모든 경로를 먼저 검사한 뒤 쓴다(`..`, 드라이브, 예약 이름 거절, 240자 넘으면 400 + 파일 이름).
- Line No. 가 폴더 이름이 되므로 영문, 숫자, 공백 . _ ( ) - 40자 이내만(`serverFolderName` ↔ 서버 `_TARGET_RE` 사본). 올린 뒤 Line No. 를 바꾸면 서버 폴더 이름은 그대로이고 화면이 알린다.
- 회사 DRM 암호문(`HHIDRMC`)은 막지 않고 올린 뒤 개수를 알린다. 실제 DRM 파일이 브라우저에서 평문으로 읽히는지는 확인 안 함.
- 이 작업 폴더에는 Analysis 기록이 없어 My Projects 에 안 보이고, 폴더 나이 30일 뒤 정리된다. 기록은 보고서 생성 단계에서 만든다.

## 구현 위치

- 규칙과 기본값 = `frontend/src/utils/psaReport.js` (+ `psaReport.test.js`)
- 화면 = `frontend/src/pages/analysis/PsaReportAutomation.jsx` (표 부품은 `components/analysis/psaReport/`)
- 등록 = `DashboardContext.jsx`(`RAW_ANALYSIS_DATA`, `APP_REGISTRY_OVERRIDES`, `APP_CAPABILITY_METADATA`) + `App.jsx` `renderPage`

## 기본값 메모

- Line 7개는 보고서 표 글자를 따른다(입력 그림의 `Vapourt Gas Main` 은 보고서 표의 `Vapour & Gas Main` 으로).
- Acceleration Load 표의 `Cargo Compressor Room (*)` 은 Position 표 이름 `Comp. RM` 과 연결해야 해서 `Comp. RM` 으로 둔다. 보고서 표기가 달라야 하면 다음 단계에서 정한다.
- Process Condition 의 `COMP.RM (**)` 표시와 (\*) 설명은 각주 칸에 적는다(문구는 사용자 확인 필요).

## 다음 단계 (사용자 상세 대기)

- 결과 폴더 안 파일 형식과 보고서에 넣을 값, 보고서 서식(Word 인지 Excel 인지)
- 서버 저장과 My Projects 기록, 빈 칸을 막는 시점

## 보고서 생성 가능성 조사 (2026-11-17, 3441 R2 기준)

기준 보고서 = `UnLock\PSA_Report\3441 PSA REPORT - 연구소\H3441s 8T-5412-003_Pipe Stress Analysis_R2.docx`(표 39개, 그림 21개, 6개 구역). 검증 스크립트는 세션 스크래치패드에만 있었다(필요하면 다시 작성).

### 숫자 표 — 자동 생성 가능(검증함)

- **6.x 'Maximum Forces and Moments and Displacement'** = CAESAR II `Restraint Summary Extended` 내보내기(xlsx) 하나로 계산된다.
  규칙: 지지 Node 블록(`TYPE=…`) 다음의 `Displ. Reaction` 블록 = 연결 Node(Cnode). 힘 6개 = 블록의 `MAX` 줄(N → kN, N·m → kN·m).
  변위 6개 = 하중 경우마다 (Node − Cnode) 를 구해 최대(+), 최소(−), 부호가 안 맞으면 0. 소수 첫째 자리.
  대조: TD03 263/263, TD06-2·3·4 100%, TD02 152/153, TD01 124/126, TD05 51/61, TD04 37/45. 남은 차이는 **수계산 엑셀 최종값과는 같고 보고서만 다른 값**(작성자가 보고서에서 손으로 고친 것)이다.
  TD06-1(0/6)은 폴더 파일이 보고서와 다른 해석본, Compressor Room 은 Node 목록부터 다르다(폴더의 `CR_ALL_250701_RESTRAINT.xlsx` 가 최종본이 아님).
- **6.x 'Stress summary'** = CAESAR II `Code Compliance` 내보내기에서 하중 경우마다 최대 Ratio 줄. TD03(`222222.xlsx`)로 18/18 일치. **다른 Line 에는 이 내보내기가 없다** — CAESAR 에서 Line 마다 내보내야 한다.

### 고정 또는 입력으로 채우는 부분

- 1~5장(Scope, Process, Displacement, Acceleration, Manifold) = 화면 입력값. 설계 코드, 단위계, 재료 물성, 마찰 계수, 단열 두께, 허용 기준, 하중 경우 표 4종 = 기준 보고서의 고정 내용(호선별로 거의 같음, 템플릿).
- 6.x 'Analysis model' 4줄(재료, 두께, 유체, 단열) = 입력 또는 Input Echo. 모델 그림 = CAESAR 화면 캡처라 폴더에 없다(그림 폴더로 받거나 CII 좌표로 직접 그림).
- 7장 노즐 = `Compressor Room\NOZZLE 해석\3441-Nozzle검토_(압축기|열교환기)_*.xlsx` 의 표(보고서에는 그림으로 붙어 있음).
- 부록 = Line 별 `*(ISO).pdf` 와 `INPUT ECHO*.pdf` 를 보고서 PDF 뒤에 붙임.

### 파일 체크리스트 (사용자 결정 2026-11-17)

- 지금은 보고서와 엑셀 값이 맞는지는 보지 않고, **입력 자료대로 보고서를 만드는 것**만 본다. Code Compliance 엑셀은 사용자가 각 Line 폴더에 넣어 준다.
- key-in 은 화면에서, 파일은 Line 결과 폴더로. Line 마다 필요한 파일 = Restraint Summary, Code Compliance, ISO PDF, Input Echo PDF(COMP.RM 은 노즐 압축기, 열교환기 엑셀 2개 더). **하나라도 없거나 후보가 여럿인데 안 고르면 [보고서 만들기]를 막는다.**
- 판별 = 서버 `services/psa_report_files.py`(엑셀은 zip 안 workbook.xml 의 시트 이름, 수계산본 제외, PDF 는 이름) → `GET /api/analysis/psa-report/checklist`. 선택 규칙 = 프론트 `lineChecklist`, `autoPick`(후보 하나면 자동, 모델이 여럿이면 경로의 NO.k). 고른 경로는 입력값 `line.files[kind][모델]` 에 저장(입력 5판) → JSON 만으로 보고서가 쓸 파일을 안다.
- Line 마다 해석 모델 수(`modelCount`, TD06 = 4, 최대 8). 모델마다 위 4가지가 필요하다.
- 실제 3441 폴더: TD01, TD02 자동, TD03~05 RESTRAINT 후보 2~3개(고르기), TD06 NO.1~4 자동(선주 PCF 판은 후보로만), COMP.RM 은 RESTRAINT 와 ISO 후보 여럿.
- **후보를 내용으로 고르기**(같은 날 추가): 서버가 후보마다 CAESAR 머리글(내보낸 날, Job, 버전), 하중 경우 수, 지지 Node 수(Restraint), PDF 쪽수를 읽어 준다(`caesar_xlsx_meta`, `meta`). 자동 선택 = 후보 하나 → 모델이 여럿이면 경로의 NO.k → **후보가 모두 같은 Job 일 때만** 가장 최근에 내보낸 것(Job 이 섞이면 고르기 — 3441 COMP.RM 에서 하위 배관 CR08 파일이 '가장 최근'으로 뽑혔다). 화면에 자동 선택 이유를 보인다.
- 경고(실행은 막지 않음): Job 호선이 기준 호선과 다름(기준 = 최상단 폴더 이름 앞 4자리, 입력 `sourceFolder`), 같은 모델의 Restraint 와 Code Compliance 의 Job 이 다름. 3441 실측: TD03 `222222.xlsx`(Code Compliance)의 Job 이 `3341-TD03…` 라 두 경고가 함께 뜬다.
- 회사 DRM 이 서버에 쓴 PDF 를 감쌀 수 있다(시험 임시 파일이 +4096). 부록 PDF 를 붙이는 단계에서 평문으로 읽히는지 확인할 것.
- **남은 결정**: COMP.RM 은 CR01~CR07 하위 배관마다 ISO PDF 가 따로 있는데, 지금 규칙은 하나만 고른다. 부록에 전부 붙여야 하면 '여러 개 고르기'로 바꾼다.

### 그림 (사용자 결정 2026-11-17)

- **해석 결과물이 아닌 그림은 기준 보고서의 그림을 그대로 쓴다**: P&ID, 좌표계, Hogging/Sagging 선도, Bending moment 선도, Manifold 하중 그림, Stress Range Factor. 생성기는 기준 docx 를 템플릿으로 열어 이 그림을 손대지 않는다.
- Line 별 모델 그림(Piping model for TDxx)은 Line 구성이 호선마다 달라 원본을 담당자에게 요청. 없으면 기준 보고서 그림을 그대로 둔다. 7장 노즐 표 그림은 노즐 검토 엑셀에서 만들지 기존 그림을 쓸지 다음 단계에서 정한다.

### 필요한 파일과 필요 없는 파일

- 필요: Restraint Summary Extended xlsx(Line 마다 1개), Code Compliance xlsx(Line 마다 1개, 지금 TD03 만), ISO pdf, Input Echo pdf, 노즐 검토 xlsx 2개, (선택) CII.
- 필요 없음: CAESAR 작업 파일(`.C2`, `._*`, `.hed`, `.fil`, `.cfg`, `COMNDINP`, `CONTROLU`, `DBGENBIN`, `.bak`, `.dwl`, `.tmp`), 옛 판(`OLD\`, `이전\`, `참고 자료\`, R1 C2), 손 계산 중간본(`수계산`, `AM DATA`, `DIS`, `COR` — 자동 계산이 대신함, 검증용으로만), 수정사항 메모, zip. 파일 판별은 이름이 아니라 **시트 이름과 머리글**(`Restraint Summary Extended`, `Code Compliance`)로 한다(TD03 응력 파일 이름이 `222222.xlsx`).

## 보고서 생성기 2차 (2026-11-18)

사용자 지시: 호선과 대상마다 다른 값은 모두 입력으로 받거나 입력 자료에서 읽을 것, 검토용으로 받아 무엇이 어디서 왔는지 볼 수 있을 것,
양식이 깨지지 않고 선주 제출용으로 깔끔할 것, 자료가 없는 자리는 보고서에도 없는 자리라고 드러날 것.

**서식은 '견본'으로만 쓴다.** 3441 R2 의 글자가 다른 호선 보고서에 남지 않게, 호선에 따라 달라지는 자리는 입력에서 채우고 없으면 표시한다.

| 자리 | 가져오는 곳 | 없을 때 |
|---|---|---|
| 표지 요약표(Title, Client, Project, 선급, Hull No., 날짜, Rev, 부서, 작성/검토/승인, Status, Secret Level) | 입력 `docInfo` (화면 '보고서 정보' 단계) | `[Not provided]` |
| Revision Summary 표 | 입력 `revisions` | `[Not provided]` 한 줄 |
| 호선 문장 3곳 `(Hull No. …)` | `docInfo.hullLabel` → 없으면 최상위 폴더 이름의 네 자리 | `[Not provided]` |
| 해석 프로그램 문장 2곳, 가속도 기준 선급과 규정, P&ID 도면 번호 | `docInfo.software / accelClass / accelRuleRef / pidDrawingNo` | `[Not provided]` |
| Process 표 아래 설명 문단 | 입력 `processNotes`('- ' 줄은 목록) | 문단 없음 |
| 6장 Material, Wall thickness | Line 의 `material`, `wallThickness`(기본 A312 TP316L, Sch. 10s) | `Not provided` |
| 그림: P&ID, Hogging, Sagging, Bending moment, Line(모델)별 배관 모델, 7장 노즐 표 2개 | 작업 폴더 `Figures/` 의 그림을 파일 이름으로 맞춤(`match_figure`) | `[ Figure not provided ]` |
| 6장 최대 반력, 응력 요약 표 | 고른 CAESAR 엑셀 | 한 줄로 합친 `Data not provided` |
| 6장 응력 결과 문장, 초록과 표지의 결론 문장, 7장 문장 | 결과에 맞춰 다시 씀(모두 OK / 허용 초과 Line / 결과 없는 Line) | 'were not provided' 문장 |

- **6장은 Line 마다 새로 만든다.** 서식의 첫 Line 절을 견본으로 복제(모델 수만큼 그림, 반력 표, 응력 표). 서식에 없던 Line(TD07 등)도 들어가고,
  표와 그림 번호와 본문의 'table 6.x' 참조가 맞는다. 번호는 Word 필드이되 갱신하지 않고 열어도 맞게 미리 적는다. Line 절은 새 쪽에서 시작.
- **서식 파일을 가볍게 바꿨다** — `scripts/psa_report_slim_template.py <R2 평문 docx>` 가 6장을 첫 절만, 표를 머리 줄 + 한 줄만 남긴다(2.8 → 2.3 MB).
  원본 그대로면 8,500줄을 지우느라 보고서 한 건에 32초가 걸렸다(지금 4초). 원본 R2 는 UNC `UnLock\PSA_Report` 에 있다. ⚠ 옛 생성기 코드와 새 서식은 맞지 않는다(6장에 첫 Line 만 남음) — 서버는 코드와 서식을 함께 반영하고 재시작할 것.
- **선주 제출용 다듬기**: 결과 표 숫자 글꼴을 Arial 로 고정(서식은 'Arial Unicode MS' 라 그 글꼴이 없는 PC 에서 숫자가 두 줄로 꺾였다), 13칸 표의 칸 여백 축소,
  표 머리 줄은 쪽마다 반복, 데이터 줄은 쪽 경계에서 쪼개지지 않음, 쓰지 않는 서식 그림(3441)은 결과 파일에서 뺌(그림 없이 0.4 MB).
  문단 속성 keepNext, pageBreakBefore 는 쓰지 않는다(편집 기호의 네모점, 사용자 규칙) — 쪽 나눔은 서식처럼 제목 안의 쪽 나눔 문자로. 그래서 표 제목이 쪽 끝에 혼자 남을 수 있다.
- **검토용(review)**: 같은 보고서에 색(입력 파랑, 원본 파일 계산 초록, 올린 그림 보라, 자료 없음 주황), 6장 표 제목 아래 출처 줄(파일, 시트, 줄 수, 규칙),
  맨 끝 점검표(자료가 없어 비운 자리 / 프로그램이 넣은 자리와 가져온 곳 / 서식 그대로인 자리 / 경고). 파일 이름 끝 `_검토용`. 화면 [검토용으로 받기].
- 코드: `psa_report_docops.py`(Word 조작) · `psa_report_docx.py`(조립, `_Report`) · `psa_report_review.py`(기록 `Trace`, 색, 점검표). 라우트 `POST /report {workspace, review}`, `GET /figures`.
  화면: 단계 '보고서 정보'(`PsaDocInfo.jsx`), '보고서 그림'(`PsaFigures.jsx`), 입력 판 6(`docInfo`, `revisions`, Line `material`/`wallThickness`). 빈 칸과 없는 그림은 승인하면 넘어간다(skip).
- **Word 모양 확인 방법**: 생성 docx 를 UNC 에 두고 Word COM 으로 열어 `ExportAsFixedFormat` 을 **로컬 임시 폴더**에 저장 → 탐색기 셸 복사로 UNC 에 평문 PDF → PyMuPDF 로 쪽 그림.
  (PDF 를 UNC 에 바로 쓰면 멈춘다.) 일반용 69쪽, 검토용 76쪽을 이 방법으로 보고 표지, 6장 표, TD06 그림 4개, 가로 쪽 7장, 점검표를 확인했다.
- 확인: 백엔드 PSA 시험 33건, 화면 유틸 시험 50건, 빌드. 받은 보고서(08:33, 옛 생성기)는 입력과 원본 엑셀로 독립 대조해 27곳 일치.
  **새 생성기는 서버(70)를 거쳐서는 아직 못 봤다** — 70 서버가 옛 코드로 돌고 있어 재시작이 필요하다. 화면(보고서 정보, 그림 단계, 검토용 버튼)도 눈으로 확인 안 함.

- **화면 다듬기 (2026-11-18 오후, 사용자 지시)**: '최상단 폴더' → '프로젝트 폴더'. 유의 문구(Line 폴더 파일은 모두 올라가고 그중 필요한 파일만 골라 씀),
  체크리스트 범례(있음 / 고르기 = 직접 골라야 함 / 없음 = 승인하면 빼고 진행). **보고서 정보의 표지와 개정 칸은 비우면 보고서에도 빈칸**(문장에 끼는 값만 `[Not provided]`).
  **그림 폴더는 따로 고르지 않아도 된다** — 프로젝트 폴더 안 `Figures`(또는 `그림`, `보고서 그림`) 하위 폴더를 Line 이 아니라 그림 칸으로 함께 올린다(`FIGURE_FOLDER_RE`). '보고서 그림' 단계 버튼은 그림만 바꿀 때.
  사용자가 받은 '검토용'에 색이 없던 원인 = 70 서버가 08:00 에 띄운 옛 코드 그대로(`--reload` 미반영, 그 요청 기록에 review 표시 없음과 6장 경고 6건). 재시작으로 해결.

- **검토 결과 창 (2026-11-18, 사용자 승인 A안 → 같은 날 보고서와 분리)**: 사용자 결정 = 보고서와 검토는 따로. 왼쪽 레일 두 구역:
  [보고서 만들기] = 최종 제출본만(색 없음, 검토 창을 열지 않음) / '검토' = [검토 결과 보기](웹 창) + [검토용 Word 받기](색 칠한 docx).
  검토 둘은 보고서를 먼저 만들 필요 없이 지금 입력으로 그 자리에서 만든다 — `POST /review`(생성기를 메모리에서 돌려 기록만 돌려줌, 파일 안 씀, 사용 기록 안 남김).
  예전 `GET /review` + `psa_report_review.json` 저장은 없앴다(입력을 고친 뒤 옛 기록이 보이던 문제).
  '고르기'가 남아도 검토는 막지 않는다 — 화면이 `pending`(lineNo, kind, model)을 보내고 그 자리는 '자료 없음 (후보가 여러 개라 아직 고르지 않음)'. 최종본은 지금처럼 막는다(`reviewBlocks`).
  색 정의 원본 = 백엔드 `KIND_FILL`/`KIND_LABEL`, 기록의 `kinds` 로 화면에 실어 보낸다(프론트 `REVIEW_KINDS` 는 옛 서버용 예비). 창 위 색 칩 = 그 색만 거르기.
  창 내용: 맨 위 '자료가 없는 자리'(채우러 가기 = 그 단계로), 보고서 순서 묶음(접기), 서식 그대로인 자리, 경고. `PsaReviewPanel.jsx`, 묶기 `summarizeReview`·`reviewStepOf`.
  docx 를 HTML 로 그리는 방식(B)은 보류 — Word 모양 확인이 자주 필요하면 그때. 검토용 docx 첫 쪽에 '읽는 법'(색 뜻) 한 쪽을 넣었다.
  올리기와 파일 찾기 중에는 화면을 막는 진행 창(`PsaBusyOverlay`), 프로젝트 폴더 확인 창 맨 위에 '파일 N개가 모두 올라감'.
- **Line 별 묶음 엑셀(`TD-01.xlsx`) 가능성 확인 (2026-11-18)**: Restraint 시트는 기존 파일과 결과 126줄 같음. 'Stress Summary (Legacy)' 시트로 응력 요약을 채울 수 있으나 R2 와 20줄 중 16줄만 같고(L22, L23, L28, L29 다름) 소수 1자리.
  판별과 읽기 규칙 추가가 필요 — 사용자가 다른 Line 파일을 다 받은 뒤 요청하기로 함.
- **Legacy 응력 시트로 Stress summary 채우기 (2026-11-19, 사용자 지시)**: 사용자가 받은 `3441 TD\TD-01~05, TD-06-1~4.xlsx`(모두 DRM, Restraint + Legacy + 빈 Sheet1, Code Compliance 없음).
  규칙: Line 폴더에 Code Compliance 파일이 없으면 Legacy 시트가 든 엑셀을 Code Compliance 후보로(`legacy_stress_file`, 손 계산본 제외), 있으면 진짜만.
  읽기 `compliance_rows` = Code Compliance 시트가 없으면 'Highest Stresses … LOADCASE k' 블록의 Ratio(%), Code Stress, Allowable. 검토용 출처에 시트 이름(`compliance_sheet`).
  후보 정보(`caesar_xlsx_meta`)가 첫 시트만 읽어 TD-04~06 이 '지지 Node 0'이던 것도 시트 이름으로 고침.
  실제 9파일: 모두 읽힘, NG 없음(최대 TD01 L39 99.4%). 시험 37건 통과. **70 서버 재시작 전이라 화면 흐름은 확인 안 함.**
- **입력 방식 전환: 엑셀 하나 = Line 하나 (2026-11-19, 사용자 지시)** — 위 19번(프로젝트 폴더 한 번에), 14번의 Line 결과 폴더 선택, Others 를 **폐기**.
  1단계 [결과 엑셀 선택](여러 개) → 엑셀마다 Line(`planExcelFiles`, `applyExcelPlan`). 이름 규칙 `lineFromExcelName`: `TD-01` → TD01, `TD-06_1`·`TD-06-1` → **TD06-1(모델별로 따로인 Line, modelCount 1)**,
  `Compressor Room`/`COMP RM` → COMP.RM, 그 밖은 파일 이름을 다듬어 Line No.(표에서 고침). Pipe Line 기본 = 원래 번호의 기본 이름(`Tank Vent No.1/2/3/4` → `No.k`), Process 기본값도 원래 번호(`baseLineNo`).
  같은 Line No. 가 이미 있으면 그 줄의 엑셀을 바꿈(엑셀이 있던 줄이면 확인 창). 줄마다 [엑셀 선택]/[바꾸기](`ExcelCell`). 서버 폴더 = Line No.(겹치면 ' (2)', `uniqueServerFolder`), 줄 이름을 고쳐도 쓰던 폴더 유지.
  체크리스트 = Restraint, Stress Summary(Code Compliance 또는 Legacy 시트) 두 가지만(ISO, Input Echo, 노즐 엑셀은 생성기가 쓰지 않아 뺌), 해석 모델 수 조절 단추 제거(옛 입력 JSON 의 TD06 4모델은 그대로 읽힘).
  끌어 놓기(같은 날 요청): Scope 단계 전체가 놓는 자리(`ExcelDropZone`) — 엑셀 여러 개 또는 엑셀이 든 폴더(하위 폴더까지 모아 .xlsx 만). 자리 밖에 떨어뜨려도 창이 파일을 열지 않게 이 화면이 보일 때 window 의 drop 을 막는다.
  그림은 그대로 '보고서 그림' 단계에서 폴더로.
- **그림 파일 이름 = 보고서 그림(표) 제목 그대로 (2026-11-19, 사용자 결정)**: `Piping & Instrument Diagram for Cargo System`, `Hogging and sagging on each frames`,
  `Bending moment and section modulus on each frames`, `Summary for compressor equipment nozzle loads`, `Summary of static equipment nozzle loads`, `Piping model for <Line>`(COMP.RM 은 `Compressor Room`).
  맞추기 = 정확히 같은 글자(앞 'Figure 1.1'·'Table 7.1' 번호, 대소문자, 띄어쓰기, 기호 무시). 옛 짧은 이름(PID, Hogging, TD01)은 더 이상 맞추지 않는다(`match_figure`, `FIXED_FIGURES.caption`).
  Figure 2.1 은 서식에 그림 자리가 둘(Hogging, Sagging)이지만 제목이 하나라 **파일 한 장**(`hogsag`)으로 받아 첫 자리를 두 자리 폭(13 cm), 높이 상한 8 cm 로 넓히고 둘째 자리를 지운다(`remove_drawing`).
  화면 '보고서 그림' 표 = 자리 번호 | 파일 이름(복사 단추) | 찾은 파일.
- **최종 검토 반영 (2026-11-19, 사용자 지시)**: ① Scope 에 COMP.RM 이 없으면 서식의 Compressor Room 자리를 뺀다(`drop_comp_room`, `has_comp_room`) —
  Table 2.4 의 Compressor Room 2줄, Table 2.5/2.6 의 Compressor 위치와 그 하중 줄, 2.8 아래 '(*) marked in compressor room' 문단, Process 설명의 '(**) … compressor room' 줄,
  Table 5.4 와 본문 'Table 5.1, 5.2, 5.3 and 5.4' → '5.1, 5.2 and 5.3', Table 7.1(압축기 노즐 그림)과 '7.1 and 7.2' → '7.1', 남은 7.2 를 7.1 로. 그림 단계에서도 압축기 노즐 자리를 묻지 않는다.
  ② 목차 항목을 본문 제목으로 다시 쓴다(`rebuild_toc` — 번호, 제목, 책갈피 연결. 6장 복제 제목은 새 책갈피 `_TocPsa…`). **쪽 번호는 Word 가 쪽을 나눠야 알 수 있어 비워 두고 열 때 필드 갱신으로 채운다**(LibreOffice 없음, 서버에서 Word 를 돌리지 않음).
  캡션 번호(Table 6.1~6.18 등)는 이미 맞게 적혀 있었다(앞 검토의 'Table .' 는 python-docx 가 fldSimple 글을 읽지 않아 생긴 착시).
  ③ 응력 표 숫자 자릿수 고정(`_fixed` — 응력과 허용응력은 원본 자릿수: Legacy 1, Code Compliance 2, 응력비 1. 83 → 83.0).
  확인: 시험 40건, 실제 3441 입력으로 재생성(UNC `UnLock\PSA_Report\3441TD_1315\재생성_*.docx`) — 경고 0, Compressor 언급 0, 목차 51항목, 응력 표 9개 모두 소수 1자리, 그림 없음 0. Word 로 열어 목차 갱신은 안 봄.
  올리기 세 길: [그림 파일 선택](여러 개)과 끌어 놓기(파일이나 폴더) = 있던 그림에 더함(같은 이름 덮어씀, `uploadPsaFolder` reset=false, 끝나면 서버 파일 수로 맞춤) / [폴더 선택] = 그 폴더 그림으로 모두 바꿈. 시험 37건, 빌드 통과, Figure 2.1 합치기는 생성 docx 로 확인(그림 1장 12.99 cm). Word 로 열어 모양은 안 봄. 검증: 실제 9파일을 새 구조로 놓고 생성기 → 6장 표 18개 모두 채움, 경고 0. 화면 유틸 시험 567, 빌드 통과. **앱 화면에서 직접 눌러 보지 않음(70 재시작 필요).**

## 남은 일 (2026-11-19 갱신)

- **70 백엔드 재시작(먼저)** — 사용자가 13:15 에 앱으로 만든 3441 보고서까지는 엑셀 단위 Line, Legacy 응력, 그림 제목 이름이 반영됐다. 그 뒤 고친
  Compressor Room 자리 빼기, 목차 다시 쓰기, 숫자 자릿수 고정은 재시작해야 앱에 반영된다. 재생성 확인본 = UNC `UnLock\PSA_Report\3441TD_1315\재생성_*.docx`(Word 로 열어 [예] 갱신 후 목차, 쪽 번호 확인 안 함).
- **3441 제출 전 사용자 몫**: 보고서 정보 빈칸 14개(표지, Hull No., 가속도 기준 선급과 규정, P&ID 도면 번호)와 개정 이력 내용. 지금은 '[Not provided]' 와 호선 없는 파일 이름.
- **커밋과 릴리스 (2026-11-20)**: 전체 커밋 `23a2457`(리뷰 뒤 기록 이름 `PsaReport` 를 카탈로그 `programNames` 에 연결), WorkBench 1.7.27 릴리스 `aa8b96b` 에 포함. **145 미반영** — 순서 = `pip install python-docx==1.2.0` → ⟳ Update(git pull) + 재시작 → 새 exe 1.7.27. 반영 뒤 DRM 엑셀 하나로 145 복호화 확인(아래 'DRM 원본 그대로 올리기').
- 목차 쪽 번호는 Word 갱신에 맡긴다(서버에 LibreOffice, Word 없음). 사용자가 '갱신 없이' 를 원하면 앱(Electron, 사용자 PC 의 Word)으로 받은 뒤 갱신하는 방법을 따로 검토.
- 서식 그대로인 자리(재질 표, 허용응력 115.14 / 153.13, 마찰계수, 보온 두께, Load cases 표 5.1~5.3)는 호선이 달라도 안 바뀐다 — 입력으로 받을지 사용자 결정.
- 부록 B(Isometric Drawings, Input Echo)는 제목만 — 고른 PDF 를 쪽 그림으로 넣을지 사용자 결정. 7장 노즐 표는 그림으로만 받는다.
- 반력 표(Restraint)는 이번 3441 엑셀로 R2 와 다시 대조하지 않음(11-18 대조: TD03, TD06-2~4 일치).

- **DRM 원본 그대로 올리기 (2026-11-18 시험)**: 앱(Electron 26·40 메인과 화면, node)은 DRM 파일을 암호문 그대로 읽어 보낸다. 그런데 70 백엔드(바탕화면 bat 로 띄운 uvicorn)는 userConnection 의 암호문을 평문으로 읽는다(같은 파이썬 exe 라도 셸에서 띄우면 암호문 — DRM 이 프로세스별로 복호화 허용). E: 원본 3441 최상위 폴더를 그대로 올려도 네트워크 평문 사본으로 올린 것과 docx 가 바이트까지 같았다. 그래서 네트워크 폴더 경유는 넣지 않는다. 145 백엔드가 복호화를 받는지는 미확인(145 에 아직 /report 없음) — 반영 뒤 DRM 엑셀 하나로 판별 확인, 안 되면 그때 경유 방식 논의.
- **'고르기' 막힘 문구 (2026-11-18)**: 사용자가 E: 폴더로 앱에서 [보고서 만들기]를 눌렀는데 '고칠 항목 1건'만 보고 원인을 몰랐다(TD03·TD05·COMP.RM 후보 여럿 6칸). 막는 것은 유지(-196/-163℃ 처럼 공학적 선택), 알림에 막는 이유를 그대로 쓰고 '보고서 파일 확인'으로 가며 고를 칸이 있는 첫 Line 을 펼친다(`reportProblems` 의 `kind: 'choose'`·`lineUid`, `PsaChecklist` `focus`). 앱 안 화면은 눈으로 확인 안 함.

- **화면 연결 (2026-11-18)**: [보고서 만들기] 승인 → `reportExclusions` 를 넣어 `savePsaInput` 즉시 저장(자동 저장 1.2초를 기다리지 않음) → `generatePsaReport`(`api/psaReport.js`, blob, 오류 본문 Blob 에서 detail 추출) → a 태그로 내려받기. 진행 중 버튼 잠금, 끝나면 받은 파일 이름과 서버 경고(`X-Report-Warnings`)를 레일에 보인다. 70 서버에 화면과 같은 순서(작업 폴더 → 고른 xlsx 올리기 → 입력 저장 → POST /report)를 실제 3441 데이터로 돌려 200·10.6초·2.5 MB, 6장 절 7개, Node 표 10개 채움, Code Compliance 는 TD03 만 값(나머지 '자료 없음'), 파일 이름 헤더와 Expose 헤더 확인. 앱 안에서 버튼을 눌러 Electron 저장 대화상자가 뜨는지는 확인 안 함.
- **눈으로 확인 안 함**: 생성 docx 를 Word 로 열어 본 적 없음. Word COM 의 PDF 내보내기가 멈춰(회사 DRM 확인 창으로 추정) 화면 대조를 못 했다. 시험본 = UNC `UnLock\PSA_Report\_generated_test.docx`(갱신 표시 없이 만든 판 — 열고 F9).
- TD05 의 빈 `Sheet1.xlsx` 를 후보에서 뺄지(물었으나 답 없음), COMP.RM ISO 하나 또는 여럿(미정).
- 70 백엔드 재시작 + `pip install python-docx`(145 도) 해야 라우트가 뜬다.
