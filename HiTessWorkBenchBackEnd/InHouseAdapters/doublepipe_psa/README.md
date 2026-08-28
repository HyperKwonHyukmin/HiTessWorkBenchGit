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

## Tier-2 패치를 늘리기 전에

`patches.py` 항목이 늘어날수록 엔진과의 결합이 강해진다. 새 항목을 넣기 전에
**"shim 으로 못 하나?"** 를 먼저 검토할 것. 환경(DRM·인코딩·라이브러리 거동) 문제는
거의 항상 shim 으로 처리할 수 있고, 그쪽이 엔진 갱신에 훨씬 강하다.

가능하면 엔진 로직 버그는 **연구원 원본에 반영을 요청**하고, 반영되면 `patches.py` 에서
해당 항목을 제거한다(`prep` 이 "이미 반영됨"으로 알려준다).
