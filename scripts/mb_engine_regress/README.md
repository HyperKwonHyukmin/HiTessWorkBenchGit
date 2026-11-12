# Model Builder 엔진 회귀 측정 장치

계획서 `docs/plans/2026-11-12-modelbuilder-engine-overhaul-plan.md` 0단계 산출물.
수집한 실제 CSV 묶음마다 엔진을 돌리고, **사용자가 받는 BDF 그대로** Nastran 을 돌려 '바로 해석되는 모델인가'를 숫자로 낸다.

## 쓰는 법

```bash
# 70 InHouse 엔진으로 전체(약 62묶음, Nastran 포함 약 20~30분, 동시 3개)
python -X utf8 regress.py run --label base_v0
# 새로 빌드한 엔진
python -X utf8 regress.py run --label step2_wvol --exe <publish 폴더>\Cmb.Cli.exe
# 엔진만(빠름, Nastran 없이) / 일부 묶음만
python -X utf8 regress.py run --label quick --no-nastran --only 3469-1b41eb0c,8242-fa993eaa
# 두 실행 비교 → <새 폴더>/compare_to_<기준>.md
python -X utf8 regress.py compare ../../outputs/mb-engine-regress/base_v0 ../../outputs/mb-engine-regress/step2_wvol
# 지표 코드만 고쳤을 때(엔진, Nastran 다시 안 돌림)
python -X utf8 regress.py remeasure --label base_v0
```

- 시험 자료: `--corpus` 또는 환경 변수 `MB_CSV_CORPUS`(기본 `E:\HiTESS\ModelBuilderCsv`, manifest.csv 기준). **엔진 저장소(Public)에 CSV 를 넣지 않는다.**
- 결과: `outputs/mb-engine-regress/<label>/`(git 미추적) — `summary.md`(표), `result.json`, 묶음마다 `metrics.json`(떠 있는 그룹 목록, RBE 목록, 겹친 노드).
- 묶음 ID = `<호선>-<입력 sha 8자리>`. 입력 내용이 같으면 실행이 여러 번이어도 한 묶음.
- 엔진 옵션은 화면 기본값(`--mesh-size 500 --ubolt-full-fix`). `--run-nastran` 은 쓰지 않는다 — 떨어진 그룹마다 SPC 를 덧붙여 결함을 가린다.
- 엔진 결과는 결정적이다(같은 입력 → 같은 BDF). 비교는 주석을 뺀 BDF 해시로 한다.

## 판정(계획서 4절 초안)과 참고 항목

판정 미달 사유: 엔진 종료 코드 ≠ 0, 입력 오류 행, 연결 그룹 2개 이상, 자중 해석 FATAL, 자동 구속(AUTOSPC), 자유-자유 0 Hz 모드 ≠ 6(그룹 1개일 때만 돌림).
질량 대조(1%)는 아직 없다 — CSV 질량 합계를 배관 밀도 규칙과 같게 세는 법을 정한 뒤 넣는다.

참고(판정 미반영, 편입은 사용자 결정): 과대 변위(자중 > 500 mm), 사라진 구조 행, 겹친 노드(1 mm 안), 요소와 같은 두 노드를 잇는 RBE, 꺾인 U-bolt RBE(배관 축 수직에서 10° 넘게).

- **사라진 구조 행** = 입력 감사에 'converted' 인데 그 행의 축선 위 표본 5점(10~90%) 모두에서 5 mm 안에 모델 부재가 없는 행. 이름이 아니라 형상으로 본다(CSV 는 한 이름을 여러 줄이 함께 쓰고, 같은 선 위 부재를 합치면 이름 하나만 남는다). 엔진이 그룹을 병진 이동한 경우도 여기에 잡힐 수 있다.
- **노이즈 제거로 지운 요소** = 단계 진단 `NOISE_REMOVED` 합계(계획서 B11).

⚠ 2026-11-12 블루스크린(ZsFw)으로 그 전 약 25분 동안 쓴 `regress.py` 와 `metrics.json` 26개가 NUL 로 손상됐다. 결과가 이상하면 `tr -cd '\000' < 파일 | wc -c` 로 먼저 본다. `remeasure` 로 `metrics.json` 은 다시 만들 수 있다.

## 사람 검토 자료와의 대응

| 출처 | 지적 | 지표 |
|---|---|---|
| 엔진 저장소 `csv/모델 변환 결과 검토.xlsx`(2026-05, 13개 모델) | 사다리 등이 그룹으로 빠짐 | 떠 있는 그룹(원인 분류) |
| 같은 곳 | U-bolt 누락으로 과대 변위(2,574~7,800 mm), Box U-bolt 누락 | 과대 변위, 받칠 구조 없는 U-bolt 노드 |
| 같은 곳 | RBE 순환 구조 중복 | 엔진 진단 `RBE2_CIRCULAR_DEPENDENCY` |
| `csv/KangSangHoonReview/CARGO COMP ROOM CSV 오류 정리.pptx`(2026-05-08) | RBE 가 꺾인 상태로 생성(예전 CSVtoBDF 보다 늘어남) | 꺾인 U-bolt RBE |
| 같은 곳 | Equivalence 안 됨 | 겹친 노드 쌍 |
| 같은 곳 | 같은 노드를 쓰는 요소와 RBE 가 동시에 있음 | 요소와 겹친 RBE |
| 같은 곳 | Stru, Pipe, RBE 번호가 구별 안 됨(HyperMesh 권상 해석 때 필요) | 지표 아님 — 번호 규칙 요청(계획서 정할 것) |

두 자료는 DRM 이라 UNC `UnLock\XLSX` 에 셸 복사해 읽었다.
