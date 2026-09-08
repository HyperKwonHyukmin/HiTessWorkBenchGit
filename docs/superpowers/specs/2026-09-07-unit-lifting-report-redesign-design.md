# Module Unit 권상 구조 검토 보고서 — 전면 재구성 설계

- 작성일: 2026-09-07
- 대상 기능: Group & Module Unit 권상 구조 해석 → 검토 보고서(xlsx) 생성
- 대체 대상: codex 가 만든 1차 구현(사내 3페이지 서식 채우기 + Studio 6뷰 캡처)

## 1. 목표

결과 보고서 **한 파일만으로** 해당 Unit 의 권상 구조 검토 전체(입력 모델 → 권상 위치·자세 안정성 → 하중·경계조건 → 구조 해석 결과 → 판정)를 확인할 수 있게 한다.

결정 사항(사용자 확인 완료):

| 항목 | 결정 |
|---|---|
| 틀 | 다장(多章) 기술보고서. 표지·요약·목차·1~6장·부록. Excel 인쇄 가능 |
| 그림 | **백엔드 2D 도면 렌더(matplotlib)**. Studio 캡처 의존 제거 |
| 언어 | 한국어 본문. 기술 용어는 괄호 영문 병기 |
| 부재 결과 깊이 | 지배 부재 상위 30 + 허용 초과 전량 + 단면(PID)별 요약 + 히스토그램. 전 부재는 데이터 시트 |
| 진입점 | Studio 버튼 + WorkBench 권상 페이지 버튼 (공용 입력 모달) |
| 변위 | 참고치만(판정 없음) |
| 자세안정성 | 7단계 판정표 + 권상 위치 선정 근거 |
| 와이어 | 지그 기준(기본 6.2 ton) 유지, 옵션으로 변경 가능 |
| 표지 정보 | 생성 직전 입력 모달(호선·유닛은 파일명 자동 추출로 선입력) |
| 편집 이력 | 포함(원본 대비 삭제·가서포트·경계조건 제거) |

## 2. 구현 방식 — Python 보고서 빌더

Mooring 의 C# `ReportSheet`/`MooringReportBuilder` 구조를 파이썬으로 옮긴다. 사내 3페이지 xlsx 서식의 **셀 배치는 계승하지 않고**, 로고·HULL/UNIT 헤더·요약표의 *정보 구성*만 계승한다.

```
HiTessWorkBenchBackEnd/app/services/unit_lifting_report/
├── __init__.py      generate_unit_lifting_report(...)  — 기존 시그니처 호환 진입점
├── collector.py     결과 폴더 JSON → ReportData(dataclass)
├── figures.py       matplotlib(Agg) 렌더 → PNG bytes
├── sheet.py         레이아웃 프리미티브(표지·목차·장·절·문단·표·그림·각주)
└── builder.py       장 순서대로 조립, 두 패스 목차, 데이터 시트
```

- `app/services/unit_lifting_report_service.py` 는 패키지로 위임하는 얇은 껍데기로 교체(라우터 import 경로 유지).
- 로고: 기존 템플릿 `.bin` 의 HD 로고 이미지를 1회 추출해 `app/templates/hd_logo.png` 로 저장. 이후 템플릿 xlsx/.bin 의존은 없앤다(`.bin`·README·export 스크립트는 삭제 대상 — 서식 채우기 방식이 사라지므로).
- 산출물은 메모리(BytesIO)에서 생성해 스트리밍(디스크 미저장, DRM 회피 — 기존 export-xlsx 와 동일).

### 2.1 sheet.py — 레이아웃 프리미티브

단일 `Report` 시트에 위→아래로 써 내려간다. 열 격자는 A~L 12열 고정(인쇄 폭 = A4 세로 1쪽), 표는 열 병합으로 폭 조절.

| 프리미티브 | 동작 |
|---|---|
| `cover(titles, facts, verdicts)` | 로고, 제목, 사실표(호선·유닛·도면·권상방식·리비전·작성자·부서·일자), **핵심 판정 박스** 3칸(구조/안정성/지그). 페이지 나누기 |
| `toc_placeholder()` / `toc_fill(entries)` | 1패스에서 자리 예약, 2패스에서 장·절·쪽번호 채움 |
| `chapter(key, text)` | 새 페이지에서 시작, 쪽번호 기록 |
| `section(text)` / `subsection(text)` | 굵은 제목 행 + 여백 |
| `para(text)` / `bullet(text)` / `note(text)` | 병합 셀 텍스트, 줄바꿈 자동, 행 높이 추정 |
| `table(headers, rows, widths, align, status_col=None)` | 헤더 음영, 테두리, 숫자 서식, 판정 열(OK/NG·PASS/WARN/FAIL) 배경색 |
| `figure(png_bytes, caption, width_cols)` | 이미지 앵커 + 캡션 "그림 n-m" 자동 번호 |
| `kv(rows)` | 2열 키-값 표 |
| `page_break()` | 명시 페이지 나누기 |

쪽번호 산정: 행 높이 누적으로 페이지 경계를 추정(장 시작은 강제 나누기라 정확, 절은 근사). 인쇄 설정: A4 세로, 가로 1쪽 맞춤, 머리글에 "HULL / UNIT / 권상 방식", 바닥글에 쪽번호와 "Hi-TESS WorkBench 자동 생성".

### 2.2 figures.py — 그림 (모두 PNG bytes, dpi 150)

공통 입력: `nodes{id→(x,y,z)}`, `elements[(id, n1, n2, pid)]`, 삭제 마스크, 그룹 색상표(Studio 와 동일한 6색).

| 그림 | 내용 |
|---|---|
| 모델 3면(평면 XY / 측면 XZ / 정면 YZ) + 등각 | 부재 회색 선, 외형 치수선(mm), 좌표축 |
| 권상 배치 평면도·측면도 | 부재 연회색, 러그 절점(그룹색 원 + "G1·N34"), 정점(중공 원 + "HOOK G1"), 와이어(그룹색 선 + 슬링각 라벨), COG(★) 와 수직 투영, 지지 다각형(ConvexPolygon 이면 점선) |
| 변형 형상 | 원형(연회색) + 변형(색: 변위 크기 컬러맵), 배율 자동(최대 변위가 외형 최대 치수의 5% 가 되도록) 표기, 최대 변위 절점 마커 |
| 응력 색상맵 평면도·등각도 | 활용도(σ/허용) 컬러맵(Studio `stressColorRamp` 와 같은 구간색), 컬러바, 상위 5 부재 ID 라벨 |
| 활용도 히스토그램 | 0~1.2 구간 20빈, 허용선(1.0) 표시 |
| 가서포트 배치(있을 때만) | 부재 연회색, 서포트 부재 주황 굵은 선 + "S1·N12–N34" |

라벨 겹침은 단순 회피(후보 위치 6개 중 첫 미충돌) — codex 의 `LiftingArrangementReport.js` 로직을 파이썬으로 옮긴다.

### 2.3 collector.py — 데이터 모델

`result_info` 에서 `nastranResultJson`, `stabilityJson`, `liftingMetaJson`, `bdf`(수정본 BDF) 를 얻고, 같은 폴더에서 `*_posture.json`, `*_hoist_optimization.json`, `*_validation_step1.json`, `*_edited.json`(또는 `*_edit.json`) 을 **파일명 접두어**로 찾는다. 원본 JSON(`meta.sourceBdf` 짝) 이 있으면 편집 이력 비교에 쓴다.

`ReportData` 필드(요지):

- `identity`: 호선·유닛·도면·리비전·작성자·부서·일자·권상방식·그룹수·와이어길이
- `model`: 절점/요소/PID/재료/집중질량 수, bbox, 중량, COG, 질량원, 단면 목록(PBEAML kind·dims·면적), 재료 목록
- `edits`: 삭제 부재/강체 수, 가서포트 목록(연결 절점·PID·길이), 제거된 원본 SPC/SUPORT 수, 분리그룹 수(validation)
- `hoist`: 그룹별 러그 절점·좌표·중심, 자동 선정 여부, 후보/평가 수, 선정 라벨·점수, 현재 vs 최적 지표
- `stability`: 단계별(0~7) 이름·판정·핵심 수치(summary 에서 추출)·비고, 정점 좌표, 와이어 기하(길이·슬링각·safe), 전도 평가 방식·마진·편차, overall
- `loads`: SF, 중력, 총 하중(중량×SF), 와이어 PID/MID·A·J·E·재배정 여부, SPC 성분, 안티 강체 앵커(절점·성분·거리), 안정화 카드·사유, subcase, F06 FATAL/WARNING 목록
- `results`: 최대 변위(절점·성분·크기), 상위 10 절점, 부재(전량 + 지배 30 + 초과 전량), PID 별 요약(개수·최대응력·최대활용도·지배 부재), 히스토그램 빈, 와이어별(장력 ton·슬링각·수직반력·지그 요부·슬랙/압축), Hook 별 합계와 검산(Σ수직반력 vs 중량×SF, 오차 %)
- `verdicts`: 구조(OK/NG: 초과 부재 0 이면 OK), 안정성(overall), 지그(어느 와이어라도 지그 기준 초과면 필요), 조치 목록

없는 자료는 `None` 으로 두고 builder 가 "자료 없음(해당 단계 미실행)" 으로 쓴다. 필수는 `nastranResultJson`·`stabilityJson` 두 개뿐.

### 2.4 builder.py — 장 구성(확정)

| 위치 | 내용 |
|---|---|
| 표지 | 제목 "Module Unit 권상 구조 검토 보고서"(Group 이면 "Group Unit"), 사실표, 핵심 판정 박스 |
| 요약 | 사내 서식 요약표(중량·항복·허용·최대응력(부재)·최대변위(절점)·판정) + Hook 별 반력 합계표 + "먼저 확인할 사항" 최대 3줄 |
| 목차 | 장·절·쪽 |
| 1. 개요 | 1.1 목적 · 1.2 검토 범위 · 1.3 입력 자료 · 1.4 소프트웨어 · 1.5 판정 기준 |
| 2. 해석 모델 | 2.1 모델 개요(+3면·등각 그림) · 2.2 중량·무게중심(+집중질량표) · 2.3 재료·단면 · 2.4 모델 편집 이력 |
| 3. 권상 위치 선정 및 자세 안정성 | 3.1 권상 그룹·러그 절점 · 3.2 선정 근거 · 3.3 7단계 판정표 · 3.4 정점·와이어 기하 · 3.5 전도 여유(+권상 배치 평면도·측면도) |
| 4. 하중 및 경계조건 | 4.1 하중 · 4.2 와이어 모델링 · 4.3 경계조건 · 4.4 안정화 파라미터 · 4.5 해석 조건(F06 진단) |
| 5. 해석 결과 | 5.1 변위(+변형 형상) · 5.2 부재 응력(초과 전량 → 지배 30 → PID 요약 → 히스토그램 → 색상맵) · 5.3 와이어 장력(+Hook 검산) · 5.4 가서포트(있을 때만) |
| 6. 결론 | 판정 문장 · 조치 필요 사항 · 근거와 한계 |
| 부록 | A 단면 물성 · B 기호 · C 해석 로그 요약 |
| 데이터 시트 | `Members`(전 부재), `Displacements`(전 절점), `Wires` |

판정 규칙(1.5 절에 그대로 기술):
- 허용응력 = 항복강도 × 0.8 (항복 기본 275 MPa, 옵션). `nastranResult.evaluation.structuralAllowableMPa` 가 있으면 그 값을 허용으로 쓰고 항복은 역산.
- 구조 판정: 활용도 > 1.0 부재가 하나라도 있으면 NG.
- 지그: 와이어 장력(ton, N/9800) > 지그 기준(기본 6.2 ton) 이면 "국부 변형 방지 지그 필요".
- 와이어 건전성: 압축/슬랙 와이어가 있으면 결론에 경고.
- 변위: 참고치. 판정 없음.
- 자세안정성: 엔진 overall 그대로(pass/warn/fail). Strict 평가 OFF 로 완화된 경우 그 사실을 3.3 절에 명시.

## 3. 진입점

### 3.1 백엔드 API (계약 변경)

`POST /api/analysis/unit-structural/report`
- 요청: `{ analysisId: int, options: { hullNo, unitNo, drawingNo, revision, author, department, jigLimitTon=6.2, yieldStrengthMpa=275, notes } }` — `captures` 필드 제거
- 응답: xlsx 스트리밍. 헤더 `X-Report-Filename`, `X-Report-Warnings`, `X-Report-Summary`(기존 유지)
- 파일명: `{호선}-{유닛}_{권상방식}_Unit_권상_구조_검토_보고서_{Rev}_{yyyymmdd}.xlsx`
- 권한·상태 검사(기존 유지): 소유자 접근, `program_name == UnitStructuralAnalysis`, `status == Success`

### 3.2 공용 입력 모달

필드: 호선 / 유닛 / 도면번호 / 리비전(기본 "0") / 작성자(로그인 사번·이름 선입력) / 부서 / 지그 기준(ton) / 항복강도(MPa) / 비고. 호선·유닛은 BDF 파일명 `(\d{4})[-_](\d{5})` 로 선입력.

- **Studio**: `UnitStructuralReportButton` → 모달(`UnitStructuralReportDialog.jsx`) → `host.generateUnitLiftingReport({ analysisId, options })`. 캡처 관련 코드 삭제: `ThreeViewport.captureReportViews`, `useUnitStructuralStore.reportCapture/setReportCapture`, `ViewportContainer` 등록 effect, `three/LiftingArrangementReport.js(+test)`, `three/DisplacementResultOverlay.js(+test)`. Studio 버전 0.0.131 로 bump → zip 2곳 배포 → 프론트 핀 동기화(사용자 허락 후).
- **WorkBench** `GroupModuleUnitLiftingAnalysis.jsx`: Step3 완료 결과 카드에 "검토 보고서" 버튼 → 같은 필드의 모달(`components/analysis/UnitLiftingReportDialog.jsx`) → `api/analysis.js: downloadUnitLiftingReport(analysisId, options)` → blob 다운로드(파일명은 헤더에서).
- **Electron** `viewer:generateUnitLiftingReport`: `captures` 검증 제거, `options` 그대로 전달. 나머지(저장 다이얼로그) 유지.

## 4. 예외 처리

| 상황 | 처리 |
|---|---|
| `nastranResultJson`/`stabilityJson` 없음 | 409 (기존) |
| 선택 JSON 없음(posture·hoist_optimization·validation·edited) | 해당 절 "자료 없음(해당 단계 미실행)" + 경고 목록에 기록 |
| 그림 렌더 예외 | 그 그림만 "렌더 실패: {사유}" 텍스트 박스로 대체 + 경고. 보고서는 생성 |
| 부재 결과 0개 / 와이어 결과 누락 | 결론에 "결과 없음 — 해석 로그 확인" 명시, 구조 판정은 "판정 불가" |
| 옵션 숫자 비정상(≤0) | 400 |
| F06 FATAL 존재 | 4.5 절과 결론에 그대로 나열(이미 Success 인 경우는 드묾) |

## 5. 테스트

- `tests/fixtures/unit_lifting_report/` — 실제 결과(`3496-35210-A508372`, 2026-09-07 14:57) 를 축소 복사: 부재 60개·절점 80개·와이어 7개·JSON 7종. 경로 필드는 fixture 상대경로로 치환.
- `test_unit_lifting_report_collector.py`: 데이터 모델 값(중량 6.740, SF 1.2, 그룹 3, 와이어 7, 최대응력 145.76 @3857, 최대변위 23.52 @219, Hook 별 합계·검산 오차, 지그 판정, 편집 이력 수).
- `test_unit_lifting_report_figures.py`: 6종 렌더가 PNG 시그니처·비영 크기 반환. 라벨 겹침 회피 함수 단위 테스트.
- `test_unit_lifting_report_builder.py`: 워크북 시트 4개, 목차 항목 수·쪽번호 단조 증가, 요약표 값, "허용 초과 부재 없음" 문장, 데이터 시트 행 수, 선택 JSON 제거 시 "자료 없음" 문장과 경고.
- `test_unit_lifting_report_service.py`: 새 계약으로 갱신(옵션 파일명, 경고 헤더). 라우트 테스트는 `switchable_client` 로 소유자/타인 403.
- Studio: 삭제한 캡처 테스트 제거, 모달 컴포넌트 테스트 1개. vitest 전체 통과.
- 실측: 실제 결과 폴더로 한 번 생성해 Excel 에서 열어 인쇄 미리보기 확인.

## 6. 배포·정리

- 백엔드 코드는 `git pull` 로 서버 반영. **신규 의존성: `matplotlib==3.10.7`** 을 `requirements.txt` 에 추가한다(사용자 결정 2026-09-07). 기존 주석("DoublePipe 는 exe 가 번들하므로 서버 venv 에 matplotlib 불필요")은 이 보고서가 in-process 로 렌더하므로 더 이상 성립하지 않는다 — 주석을 갱신하고, 서버(145)에서 `git pull` 후 **1회 `pip install -r requirements.txt`** 가 필요함을 배포 보고에 명시한다. 한글 폰트는 `Malgun Gothic`(Windows 기본) 을 지정한다.
- 삭제: `app/templates/unit_lifting_report_template.bin`, `.xlsx`, `README.md`, `scripts/export_report_template_bin.py`, `.gitignore` 의 templates 항목. `hd_logo.png` 만 남긴다.
- Studio 0.0.131 배포 + `MODULE_STUDIO_VERSION` 핀 — 배포 실행 전 사용자 확인.
- 커밋은 사용자가 직접.

## 7. 범위 밖

- PDF 출력, 영문판, 동적 하중 계수, 슬링 SWL 판정(요청 시 후속).
