# 이중관 PSA — 엔진 무수정 어댑터 계층(`hitess_adapter`) 설계

- 작성일: 2026-08-28
- 대상: `HiTessWorkBenchBackEnd/InHouseProgram/DoublePipe/` (이중관 연료배관 해석 엔진)
- 목적: 외부 연구원이 개발하는 **오리지널 엔진이 갱신되어도** WorkBench 전용 개조가
  자동으로 유지되도록, 개조를 **엔진 밖의 별도 라이브러리**로 분리한다.

## 배경 / 문제

`InHouseProgram/DoublePipe/` 의 해석 엔진은 사내 다른 연구원이 개발한다. WorkBench 백엔드가
이 엔진을 실행하기 위해 필요한 개조(DRM 우회·인코딩·CLI 규약 등)를 **엔진 소스 파일 안에 직접**
넣어 왔기 때문에, 연구원이 새 버전을 내려줄 때마다 개조가 유실된다.

`InHouseProgram/` 은 `.gitignore` 대상이라 **이력조차 남지 않는다** — 이것이 근본 원인이다.

### 실측 (DoublePipe_Prev vs DoublePipe 전체 diff)

**이미 유실된 회귀 1건**

- `Piping Stress Analysis for all load cases/FuelLine_PSA_Report.py` → `preload_template()`
  - 유실 내용: `sys._MEIPASS` 번들 → cwd `report_template.bin` → `Report for PSA.xlsx` 순으로
    후보를 훑고 PK(zip) 매직 검사 후 `BytesIO` 로 로드하던 DRM 우회 로직.
  - 새 버전은 `openpyxl.load_workbook(path)` 한 줄로 회귀 → 서버(145)에서 템플릿이 DRM
    암호화(HHIDRMC)돼 있으면 **빈 워크북 보고서**가 나온다.

**아직 남아 있으나 다음 갱신 때 유실될 개조** (연구원 원본 = `Piping Stress Analyiss for
selected load cases/` 와 비교해 확정)

| 개조 | 위치 | 성격 |
|---|---|---|
| `--load-cases` CLI, `os.chdir` 금지, 대화형 프롬프트 제거, stdout UTF-8 reconfigure | `Main.py` | WorkBench 실행 규약 |
| `preload_template` / `_PRELOADED_WB` | `FuelLine_PSA_Report.py` | 사내 DRM |
| `_set_cell()` MergedCell 안전 쓰기 (호출부 5곳) | `FuelLine_PSA_Report.py` | 크래시 방지 |
| Summary-2 초기화 시작행 16 고정 | `FuelLine_PSA_Report.py` | 엔진 로직 버그 fix |
| `encoding=locale.getpreferredencoding(False)`, `ask_delete=OFF` | `Head_for_FuelLine_ASME_B313_v2018.py` | 무인 실행 / cp949 |

**연구원의 신규 기능 (보존 대상)**: `ExportINP.RemoveZeroLengthElements`,
`ModelAlgorithm.XZDistance`, 신규 `Piping Normal Mode Analysis/`, `pipe_section_calc.py`.

### 핵심 관찰

위 개조의 대부분은 배관 물리/해석 로직이 아니라 **실행 환경(DRM·인코딩·openpyxl·CLI 규약)**
문제다. 즉 엔진 소스를 건드리지 않고 **런타임 shim** 으로 바깥에서 주입할 수 있다.

## 확정된 결정 (사용자 승인)

1. **실행 방식**: `PSA_AllLoadCases.exe`(PyInstaller onefile) **유지**. 단 진입 스크립트를
   연구원의 `Main.py` 가 아니라 **어댑터(`psa_main.py`)** 로 교체해 빌드한다.
   서버에 파이썬 환경을 구축하지 않는 현행 운영 방식을 그대로 간다.
2. **적용 범위**: 이번에는 **PSA(all load cases) 만**. `Converting CSV/inner_pipe_transform.py`
   (`run_transform` 콜러블 API)는 현재 드리프트가 없어 다음 차례로 미룬다.
   `Piping Normal Mode Analysis/` 는 WorkBench 연동 전이라 범위 밖.
3. **shim 으로 못 뚫는 엔진 로직 fix**: 어댑터가 **선언적 소스 패치를 자동 적용**한다
   (연구원 폴더는 무수정, 빌드 스테이징 사본에만 적용). 앵커 불일치 시 **요란하게 실패**.

## 기본 원칙

> 연구원 폴더 `Piping Stress Analysis for all load cases/` 는 **단 한 줄도 수정하지 않는다.**
> 새 버전이 오면 폴더째 덮어쓰고 exe 만 다시 빌드하면 끝.

이를 위해 현재 엔진 폴더 안에 있는 WorkBench 자산(`PSA_AllLoadCases.exe`,
`report_template.bin`)을 **엔진 폴더 밖으로 이동**한다. 지금 구조에서는 폴더를 덮어쓰는 순간
exe 가 지워진다.

## 아키텍처

```
InHouseProgram/DoublePipe/
├── HiTessAdapter/                              ← 백엔드가 보는 곳 (git 미추적, 서버 수동 배포)
│   ├── PSA_AllLoadCases.exe                    ← 재빌드 산출물 (이름·CLI 규약 그대로)
│   └── report_template.bin                     ← prep 이 엔진 폴더에서 자동 추출
└── Piping Stress Analysis for all load cases/  ← 연구원 원본. 통째 교체 대상. 무수정.

HiTessWorkBenchBackEnd/InHouseAdapters/doublepipe_psa/   ← ★ git 추적 (설계의 핵심)
├── hitess_adapter/
│   ├── __init__.py
│   ├── psa_main.py        exe 진입점 (구 Main.py 대체)
│   ├── cli.py             --load-cases 파싱 + run_pipeline 오케스트레이션
│   ├── engine.py          엔진 경로 해석 + 심볼 import + 계약 검증
│   ├── patches.py         Tier-2 선언적 소스 패치 목록
│   ├── prep.py            빌드 전 스테이징 + 패치 적용 + 템플릿 추출
│   └── shims/
│       ├── __init__.py            install_all()
│       ├── console.py             stdout/stderr UTF-8+replace
│       ├── abaqus_subprocess.py   Popen encoding 교정 + ask_delete=OFF
│       ├── openpyxl_drm.py        load_workbook DRM 폴백
│       └── openpyxl_merged.py     MergedCell.value 쓰기 무시
├── PSA_AllLoadCases.spec  PyInstaller spec (지금까지 부재 → 재빌드 리스크 해소)
├── build.ps1              prep → PyInstaller → HiTessAdapter/ 배치
└── README.md              새 엔진 수령 시 절차
```

어댑터 소스를 **git 추적 폴더**에 두는 것이 이 설계의 핵심이다. 개조가 날아간 근본 원인이
`InHouseProgram/` 의 무이력 상태였기 때문이다. 서버(145)는 `HiTessAdapter/` 의 2개 파일만
수동 복사하면 되고, 어댑터 소스는 `git pull` 로 따라온다.

## Tier 1 — 런타임 shim (엔진 무수정)

`psa_main.py` 가 엔진을 import 하기 **전에** `shims.install_all()` 을 호출한다.

### `openpyxl_drm` — 기존 `preload_template` 대체

`openpyxl.load_workbook` 을 래핑한다.

1. 인자가 경로 문자열이면 바이트를 읽어 **PK(50 4B 03 04) 매직 검사**.
2. PK 이면 `BytesIO` 로 로드 — 디스크 xlsx 를 직접 열지 않으므로 DRM 무관.
3. PK 가 아니고 파일명이 `Report for PSA.xlsx` 이면 → **번들 템플릿**
   (`sys._MEIPASS/report_template.bin` → 실행 폴더 `report_template.bin` 순)으로 폴백.
4. 그 외에는 원래 예외를 그대로 올린다.

이로써 엔진의 순진한 `openpyxl.load_workbook(path)` 한 줄이 그대로 DRM-safe 해진다.
기존 `preload_template()` 방식(시작 시 선로딩)보다 견고하다 — 선로딩은 "시작 시점에 이미
암호화돼 있으면" 실패하지만, 이 방식은 언제 호출되든 번들 원본으로 폴백한다.

### `openpyxl_merged` — 기존 `_set_cell()` 대체

`openpyxl.cell.cell.MergedCell.value` 의 세터를 no-op 으로 교체해, 병합영역 비앵커 셀에
값을 쓰면 `AttributeError` 대신 조용히 무시되게 한다. 엔진의 초기화/기입 루프가 셀 범위를
훑을 때 크래시하지 않는다.

### `abaqus_subprocess` — 기존 `Head_for_...` 개조 대체

`subprocess.Popen.__init__` 을 래핑한다.

- `encoding='utf-8'` + `shell=True` 조합이면 `locale.getpreferredencoding(False)` 로 교정
  (한국어 Windows 의 cp949 콘솔 출력이 U+FFFD 로 깨져 이후 `print()` 에서 죽는 것 방지).
- 명령 문자열이 `abaqus job=` 으로 시작하고 `ask_delete` 가 없으면 `ask_delete=OFF` 를
  ` int` 앞에 삽입 (같은 폴더 재실행 시 덮어쓰기 확인 프롬프트로 무인 실행이 실패하는 것 방지).

### `console`

진입 직후 `sys.stdout/stderr.reconfigure(encoding="utf-8", errors="replace")`.

### Main.py 개조

`--load-cases` / chdir 금지 / 대화형 프롬프트 제거는 **어댑터가 진입점이 되면서 자동 해결**된다.
현행 `Main.py` 의 파이프라인 로직(사용자가 작성한 것)을 `cli.py` 로 옮긴다. 엔진 폴더의
`Main.py` 는 더 이상 사용되지 않는다.

## Tier 2 — 선언적 소스 패치 (현재 1건)

`patches.py` 가 앵커/치환을 선언하고, `prep.py` 가 **엔진 폴더의 스테이징 사본에만** 적용한다.

```python
PATCHES = [Patch(
  file="FuelLine_PSA_Report.py",
  why="Summary-2 초기화가 앞 restraint 루프의 idx 를 재사용 → OPE(L1~L16) 미선택 시 "
      "UnboundLocalError 로 보고서 생성 실패",
  anchor='for row in sheet_ope[max_node_cell+str(idx) : max_dzm_cell + str(idx+999)]:',
  replace='for row in sheet_ope[max_node_cell + "16" : max_dzm_cell + "1015"]:',
  expect=1,
)]
```

- 매치 수가 `expect` 와 다르면 **빌드 중단**. 연구원이 그 부분을 고쳤다는 신호이므로
  사람이 판단해야 한다. 조용한 통과는 절대 허용하지 않는다.
- 이미 적용된 형태(치환 결과)가 발견되면 **idempotent 로 통과**시킨다 (연구원이 upstream
  으로 반영한 경우). 이때는 안내 메시지를 출력한다.

`prep.py` 는 함께 엔진 폴더의 `Report for PSA.xlsx` → `report_template.bin` 을 재생성한다.
서식 템플릿도 엔진 버전마다 바뀌므로 어댑터에 박제하지 않고 매 빌드 추출한다.

## 조기 경보 — 계약 검증 + 테스트

### `engine.py` 런타임 계약 검증

엔진이 제공해야 할 심볼을 시작 시 검사하고, 없으면 **무엇이 사라졌는지 이름을 찍어** 즉시 실패:

- 모듈: `AbaqusModelCreator`, `Head_for_FuelLine_ASME_B313_v2018`
- 심볼: `AbaqusModelCreator`, `HeadClass_01`, `HeadClass_02`, `make_report`, `F06Format`,
  `Parse_dat_file`, `Non_fric_inp_parse`, `ModifyINP`, `Fric_inp_parse`, `INP`
- `HeadClass_01` 인스턴스 속성: `LC_name`, `LC_name_iter01`, `LC_name_iter02`,
  `filename`, `datname`, `Abaqus_Run` (인스턴스 생성 후 검사)

### 테스트 (`HiTessWorkBenchBackEnd/tests/test_doublepipe_adapter.py`, git 추적)

- shim 단위 테스트: DRM 폴백(PK/비-PK), MergedCell 쓰기 무시, abaqus 명령 재작성,
  Popen encoding 교정.
- **패치 앵커 매치 테스트**: `patches.PATCHES` 의 앵커가 현재 엔진 소스에 정확히
  `expect` 회 매치되는지 검사. 새 엔진을 폴더만 갈아끼우고 `pytest` 를 돌리면
  드리프트가 즉시 빨간 줄로 드러난다.
- 엔진 폴더가 없는 환경(CI 등)에서는 해당 테스트를 skip 한다.

## 백엔드 변경 (git 추적 — 서버는 `git pull` + 재시작)

`app/services/doublepipe_psa_service.py`

- `_PSA_DIR` 의 의미를 **엔진 폴더 → 어댑터 배포 폴더**(`InHouseProgram/DoublePipe/HiTessAdapter`)로 바꾸고,
  구 배치용 `_PSA_LEGACY_DIR`(엔진 폴더)를 추가한다. 탐색은 `_program_dirs()` = (어댑터, 구 배치) 순.
  - `_resolve_psa_exe()` — 두 폴더에서 `PSA_AllLoadCases.exe` 를 순서대로 찾는다(없으면 None → 503).
  - `_read_template_bytes()` — 두 폴더 × (`report_template.bin`, `Report for PSA.xlsx`) 를 순회하며
    첫 PK 바이트를 채택. 기존 상수 `_REPORT_TEMPLATE_BIN`/`_REPORT_TEMPLATE_SRC` 는 제거하고
    이름 상수(`_REPORT_TEMPLATE_BIN_NAME`)만 남긴다.
  - 기존 테스트가 monkeypatch 하던 `_PSA_DIR` 이름은 유지되므로 회귀 없음.
- 그 외 로직·CLI 규약(`[exe, csv] (+ --load-cases)`)·`cwd=job_dir`·템플릿 스테이징은 **변경 없음**.
- 프론트 변경 없음.

기존 exe 가 아직 옛 위치에 있을 수 있으므로, exe·템플릿 탐색은 `_ADAPTER_DIR` → 엔진 폴더 순으로
폴백해 이행 기간 중 무중단이 되게 한다.

## 새 엔진이 왔을 때의 절차 (목표 상태)

1. `Piping Stress Analysis for all load cases/` 폴더째 덮어쓰기
2. `pytest tests/test_doublepipe_adapter.py` → 초록이면 드리프트 없음
3. `./build.ps1` → prep(스테이징 + 패치 + 템플릿 추출) → PyInstaller → `HiTessAdapter/` 배치
4. 서버 145 에 `PSA_AllLoadCases.exe` + `report_template.bin` 수동 복사 + 백엔드 재시작

## 엣지 케이스 / 리스크

- **exe 재빌드 검증**: spec 을 새로 작성하지만 첫 빌드는 실동 검증이 필요하다(Abaqus 필요 →
  dev 에서 full run 불가). `DoublePipe_Prev/.../PSA_AllLoadCases.exe` 를 롤백용으로 보존한다.
- **엔진 폴더의 `Report for PSA.xlsx` 가 DRM 암호화된 경우**: `prep.py` 가 PK 검사에서
  걸러 요란하게 실패하고, 클린 사본 확보 방법을 안내한다. 기존 `report_template.bin` 이
  있으면 그것을 유지하고 경고만 낸다.
- **엔진이 `openpyxl` 이외 경로로 워크북을 만드는 경우**: shim 은 `load_workbook` 만
  가로챈다. `Workbook()` 신규 생성은 그대로 둔다(서식 없는 폴백은 엔진 의도).
- **`MergedCell` 세터 no-op 의 부작용**: 값이 조용히 버려지므로, 앵커 셀에 써야 할 값이
  비앵커로 잘못 지정되면 침묵한다. 이는 기존 `_set_cell()` 과 동일한 거동이며 실측 검증된
  방식이다.
- **PyInstaller 가 엔진 모듈을 찾는 문제**: 엔진 모듈은 flat import(`from
  Head_for_... import ...`) 이므로 spec 의 `pathex` 에 스테이징된 엔진 폴더를 넣는다.
  비-frozen 실행 시에는 `engine.py` 가 `sys.path` 에 삽입한다.

## 검증

- 어댑터 전 파일 `py_compile`.
- `pytest tests/test_doublepipe_adapter.py` 전체 통과.
- `python -m hitess_adapter.psa_main --help` 로 CLI 규약(기존 exe 와 동일) 확인.
- 백엔드 `py_compile` + 기존 `tests/test_doublepipe_psa_timeout.py` 회귀 없음.
- exe 빌드 및 실동 해석은 사용자가 수행(Abaqus 라이선스 필요).

## 배포 (CLAUDE.md 규칙 — 커밋 시 필수 고지)

- **git pull 로 반영되는 것**: 어댑터 소스(`InHouseAdapters/doublepipe_psa/`),
  백엔드 서비스 경로 변경, 테스트.
- **수동 교체가 필요한 것**: `InHouseProgram/DoublePipe/HiTessAdapter/PSA_AllLoadCases.exe`,
  `report_template.bin` → 서버(145) 동일 경로에 복사 후 **백엔드 재시작**.
- 프론트 재배포 불필요.
