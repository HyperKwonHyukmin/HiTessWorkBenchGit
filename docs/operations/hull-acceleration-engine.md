# 선급 Rule 기반 선체 가속도 Calculation — 엔진 위치·주요 치수 추출 규칙

최종 갱신 2026-10-30. 화면 = `pages/analysis/HullAccelerationPage.jsx`, 백엔드 = `app/services/hull_acceleration_service.py`(엔진을 요청마다 새 프로세스로 실행 → 엔진 교체에 재시작 불필요).

## 엔진 위치
| 구분 | 경로 | 비고 |
|---|---|---|
| 원본 | `C:\Coding\WorkBenchSubModule\TS\` | **git 저장소가 아니다**. 테스트 `tests/` (`WorkBenchEnv` python 으로 `-m pytest tests -q`) |
| 실사용(배포본) | `HiTessWorkBenchBackEnd/InHouseProgram/TS/` | **git 미추적** → 145 수동 교체. 원본과 바이트가 같아야 한다(`cmp`) |

- `WorkBenchSubModule\TS\HANDOFF_hull_acceleration.md` 는 2026-06-23 기준("DNVGL만 완성")이라 옛 내용이다. 실제로는 5개 선급(dnvgl·csr·bv·igc·lr)이 모두 들어 있다.
- 시험용 T&S PDF 는 `Data/PDF` 사본이 모두 DRM 이라 이 PC 에서 열리지 않는다. 해제본은 UNC `[개인 자료]\권혁민 책임연구원\UnLock\TS_PDF\`(8척: 3252·3314·3459·3398·H3441·H3592s·H3606 + 상위 폴더 TEST2).

## 주요 치수(LBP·B·D·Tsc) 추출 규칙 (2026-10-30 통일)
H3606 PRE. T&S 표지는 텍스트 순서가 '라벨 5줄 → 숫자 5줄'로 섞여 나와 옛 순서 기준 파서가 실패했다. 그래서 순서·제목·고정 좌표 의존을 모두 걷어 냈다.

- **값 읽기**: `extract_ship_particulars._extract_dimensions_by_rows` 하나로 처리한다. 단어 좌표로 같은 줄(세로 중심 ±4pt)을 묶고, 라벨 오른쪽의 첫 숫자를 값으로 쓴다. 표지와 본문 표 모두 같은 규칙이다. 옛 순서 기준(`_extract_dimensions_sequential`)과 x 400~500pt 고정(`_extract_dimensions`) 방식은 삭제했다.
- **쪽 고르기**: 제목으로 찾지 않는다. `_find_dimension_pages` 가 모든 쪽을 읽어 필수 치수를 가장 많이 읽은 쪽(3개 이상)을 고르고, 빈 칸만 다음 쪽으로 채운다.
- **라벨 판별** `_classify_dimension`:
  - `SCANT` 가 들어 있으면 Scantling draft 다.
  - ⚠ **`SUMMER` 단독은 Scantling 이 아니다.** 3459·3398 표지에는 `SUMMER` 와 `SCANT.` 줄이 따로 있다(12.45 / 13.60). 별도 키 `summer_draft` 로 둔다.
  - `TRUNK`·`AIR`·`EXTREME`·`LOAD` 가 든 줄은 치수 줄이 아니다.
- **타당성 검사** `dimension_problems`: LBP 30~450 m, L/B 3.5~9, B/D 1~3, Tsc/D 0.3~1, Td ≤ Tsc, 0 이하 금지. 걸리면 계산하지 않는다. 잘못 읽은 값으로 조용히 계산되지 않게 하는 마지막 안전망이다.
- **검증 기준**: 위 8척에서 바꾸기 전과 Cb 까지 값이 같다. 규칙을 바꾸면 이 8척으로 전후 값을 비교할 것.
- **근거 이미지**(`ShipParticulars.png`)는 고정 영역 대신 실제로 읽은 줄들의 영역을 잘라 낸다.

## 주요 치수 직접 입력 (2026-10-30, `0fb26e9`)
- 치수를 못 읽었거나 타당성 검사에 걸리면 엔진은 실패하지 않고 `dimensions_missing` 결과를 쓴다. 함께 싣는 값은 `dimension_issue`(사유 문장)와 `manual_dimension_keys` 다. Cb 미검출(`cb_missing`)과 같은 방식이다.
- 화면은 결과 맨 위에 LBP·B·D·Tsc 입력 카드를 띄운다. 입력 칸은 PDF 에서 읽은 값으로 미리 채운다. 입력값은 constants `manual_dimensions` 로 보내고, PDF 값보다 우선한다.
  - ⚠ 화면 기본 상수(`DEFAULT_CONSTANTS` 의 lbp·breadth…, H3441 값)는 엔진이 쓰지 않는다. 명시 입력만 믿는다.
  - 결과의 `ship_constants` 에는 이 기본값이 섞여 있다. 그래서 입력 칸은 `ship_particulars.values` 로만 채운다.
- 직접 입력한 Tsc 가 있으면:
  - 그 흘수로 Hydrostatic 표에서 Cb 를 다시 보간한다(`draft_overrides`).
  - PDF 의 Design draft 와는 비교하지 않는다. Design draft 는 입력 칸이 없어서, 잘못 읽힌 경우 끝없이 보류되기 때문이다. 계산에는 Design draft 를 쓰지 않는다.
- **옛 화면 호환**: 새 화면만 `manual_dimensions_supported: true` 를 보낸다. 이 표시가 없으면 엔진은 예전처럼 `[USER_ERROR]` 실패와 사유를 낸다. 그래서 엔진과 exe 중 어느 쪽을 먼저 반영해도 깨지지 않는다.
- ⚠ `main()` 은 입력 대기 결과(`dimensions_missing`·`cb_missing`)에서 요약 출력 전에 돌아가야 한다. 빠지면 `KeyError: 'envelope'` → exit 1 → 백엔드가 실패 처리해 입력 카드가 뜨지 않는다(독립 리뷰가 잡음, 테스트 `test_main_returns_normally_for_pending_results`).

## 계산에서 빼는 적재 상태
`ts_hull_acceleration._NON_SEAGOING_RULES`: LIGHTSHIP · DOCKING · INSPECTION · **HARBOUR/HARBOR**(2026-10-30 추가, 예: Alternative ballast at harbour). 화면 제외 목록에 사유가 함께 나온다.

## 배포 상태 (2026-10-30)
- 70: 엔진 2개 파일(`extract_ship_particulars.py`·`ts_hull_acceleration.py`) 반영 완료. 프론트는 커밋 `0fb26e9`(**아직 푸시 안 함**).
- 145: 엔진 2개 파일 수동 교체 필요(재시작 불필요). 사용자가 시험할 예정이다.
- exe: `/wb-release` 를 멈춘 상태다. 작업 폴더에 다른 세션의 미커밋 프론트 변경(대시보드 4파일·`DashboardContext.jsx` AM 줄)이 있어, 그것을 빼고 빌드할지 사용자 결정을 기다린다(추천: 5개 파일 stash → 빌드 → 복원).
- 화면(직접 입력 카드)은 눈으로 확인 안 함. 치수 미검출 경로는 실제 PDF 가 없어서 H3606 추출 결과에서 치수를 지우는 방식으로만 확인했다.

## 남은 의존·후보
- 적재 상태 Summary 표(`SUMMARY OF LOADING CONDITIONS`)와 Cb 표(`LIGHTSHIP WEIGHT`·`HYDROSTATIC PARTICULARS`)는 여전히 제목으로 찾는다. Cb 는 못 찾으면 화면에서 직접 입력할 수 있다.
- 같은 줄에 두 칸이 있는 배치(`BREADTH 32.25 DRAUGHT 12.0`)는 첫 숫자만 읽는다. 누락이 나면 입력 카드로 넘어간다.
- `manualDims`·`manualCb` 는 페이지 상태에 저장하지 않는다. 화면을 다시 띄우면 다시 입력해야 한다.
