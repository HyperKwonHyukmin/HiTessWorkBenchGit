# 이중관 PSA 어댑터 (`hitess_adapter`)

이중관 연료배관 응력해석(PSA) 엔진은 **사내 다른 연구원이 개발**한다. 이 폴더는 그 엔진을
**한 줄도 수정하지 않고** WorkBench 백엔드에서 무인 실행하기 위한 어댑터 계층이다.

설계 배경과 결정 근거: `docs/superpowers/specs/2026-08-28-doublepipe-engine-adapter-design.md`

## 철칙

> `InHouseProgram/DoublePipe/Piping Stress Analysis for all load cases/` 는 **수정 금지**.
> 새 버전이 오면 폴더째 덮어쓴다.

WorkBench 자산(exe·서식 템플릿)은 그 폴더 밖 `InHouseProgram/DoublePipe/HiTessAdapter/` 에 둔다.

## 구성

```
hitess_adapter/
├── psa_main.py   exe 진입점 — shim 설치 후 cli 실행 (순서 중요)
├── cli.py        --load-cases CLI + 파이프라인 (연구원 Main.py 대체)
├── engine.py     엔진 심볼 import + 계약 검증 (드리프트 조기 감지)
├── patches.py    Tier-2 선언적 소스 패치 목록
├── prep.py       빌드 전처리: 스테이징 + 패치 + 템플릿 추출
└── shims/        런타임 주입 (엔진 무수정)
    ├── console.py           stdout/stderr UTF-8+replace
    ├── openpyxl_merged.py   MergedCell 쓰기 무시 (구 _set_cell 대체)
    ├── openpyxl_drm.py      load_workbook DRM 폴백 (구 preload_template 대체)
    └── abaqus_subprocess.py Popen 인코딩 교정 + ask_delete=OFF
```

## 새 엔진을 받았을 때

```powershell
# 1) 엔진 폴더를 통째로 덮어쓴다 (HiTessAdapter/ 는 건드리지 않는다)

# 2) 드리프트 검사 — 여기서 빨간 줄이 나면 patches.py / engine.py 를 갱신해야 한다
cd C:\Coding\WorkBench\HiTessWorkBenchBackEnd
.\WorkBenchEnv\Scripts\python.exe -m pytest tests/test_doublepipe_adapter.py -q

# 3) exe 재빌드 + 배포 폴더 배치
cd InHouseAdapters\doublepipe_psa
.\build.ps1 -Python "<엔진 의존성이 설치된 python.exe>"
```

빌드 파이썬에는 엔진 의존성이 필요하다: `numpy scipy openpyxl matplotlib pyNastran pyinstaller`
(엔진 문서 기준 검증 버전: numpy 1.24.4 / scipy 1.10.1 / openpyxl 3.1.5 / matplotlib 3.7.5 /
pyNastran 1.3.4, Python 3.8.8).

## 서버(145) 반영

`git pull` 로 따라오는 것: **이 폴더의 소스**, 백엔드 서비스, 테스트.

`git pull` 로 **절대 안 따라오는 것** — 수동 복사 후 백엔드 재시작 필요:

- `InHouseProgram/DoublePipe/HiTessAdapter/PSA_AllLoadCases.exe`
- `InHouseProgram/DoublePipe/HiTessAdapter/report_template.bin`
- (엔진 갱신 시) `InHouseProgram/DoublePipe/Piping Stress Analysis for all load cases/` 전체

⚠ exe 모드에서는 서버에서 엔진 `.py` 만 바꾸면 **반영되지 않는다** — 엔진 코드는 빌드 때 exe 안에 묶인다.
`.py` 수정을 바로 반영하려면 아래 소스 직접 실행 모드를 켠다.
`Piping Stress Analyiss for selected load cases/` 폴더는 백엔드가 참조하지 않는다(2026-10-23 확인).

## 소스 직접 실행 모드 (2026-10-26)

`.env` 에 `DOUBLEPIPE_PSA_PYTHON=<python.exe>` 를 두면 백엔드가 exe 대신
`python -u psa_entry.py <csv> [--load-cases ...]` 로 실행한다. 엔진 개발자가
`Piping Stress Analysis for all load cases/` 의 `.py` 를 바꾸면 **다음 해석부터 반영**된다(재빌드·재시작 없음).

- 실행할 때 `hitess_adapter/runtime.py` 가 엔진 사본을 `build/runtime/<지문>/` 에 만들고 `patches.py` 를 적용한다.
  지문 = 엔진 파일 목록·크기·수정 시각 + patches.py 내용. 엔진이 그대로면 사본을 다시 만들지 않는다.
- 패치 앵커가 안 맞으면 해석이 **종료 코드 3 + "[어댑터 패치 불일치]"** 로 실패한다(조용히 패치 없는 엔진으로 돌지 않음).
  엔진을 고친 뒤에는 70 에서 `pytest tests/test_doublepipe_adapter.py tests/test_doublepipe_source_mode.py` 를 먼저 돌릴 것.
- 값이 있는데 파일이 없으면 exe 로 몰래 돌지 않고 503. 줄을 지우고 백엔드를 재시작하면 exe 로 돌아간다.
- Python 은 3.8 + 위 '새 엔진을 받았을 때'의 검증 버전 패키지. 70 은 `.venv38`(git 미추적)에 있다.
  venv 는 기반 Python 경로를 참조하므로 폴더째 복사해서는 다른 PC 에서 안 돈다 — 145 에는 따로 설치한다.
- 서식 템플릿은 exe 와 같이 백엔드가 job 폴더에 넣고, DRM 폴백은 `build/` → `HiTessAdapter/report_template.bin` 을 본다.
- 고유진동 해석(`Run_ModalAnalysis.exe`)은 어댑터를 거치지 않는 연구원 원본 exe 라 이 모드와 무관하다.
- 확인 상태(2026-10-26): 70 에서 `.venv38` 로 inp 생성까지 실측, Abaqus 가 없어 해석·보고서는 확인 안 함. 145 미적용.

## Tier-2 패치를 늘리기 전에

`patches.py` 항목이 늘어날수록 엔진과의 결합이 강해진다. 새 항목을 넣기 전에
**"shim 으로 못 하나?"** 를 먼저 검토할 것. 환경(DRM·인코딩·라이브러리 거동) 문제는
거의 항상 shim 으로 처리할 수 있고, 그쪽이 엔진 갱신에 훨씬 강하다.

가능하면 엔진 로직 버그는 **연구원 원본에 반영을 요청**하고, 반영되면 `patches.py` 에서
해당 항목을 제거한다(`prep` 이 "이미 반영됨"으로 알려준다).
