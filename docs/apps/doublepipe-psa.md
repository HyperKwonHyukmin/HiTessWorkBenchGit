# 이중관 연료배관 PSA

> 2026-11-19 루트 `CLAUDE.md` 에서 그대로 옮긴 기록이다(한도 초과 정리). 규칙 요약은 `CLAUDE.md` 에 남아 있고, 진행 기록과 상세는 여기에 이어 쓴다.

### 이중관 연료배관 PSA — 엔진은 외부 연구원 소유, WorkBench 개조는 어댑터로 분리 ★엔진 수정 금지

이중관 연료배관 응력해석(PSA) 엔진(`InHouseProgram/DoublePipe/Piping Stress Analysis for all load cases/`)은
**사내 다른 연구원이 개발**한다. 과거에는 WorkBench 실행에 필요한 개조(DRM 우회·인코딩·CLI 규약)를
엔진 소스에 직접 넣어서, 연구원이 새 버전을 줄 때마다 개조가 유실됐다
(실제 사례: `FuelLine_PSA_Report.preload_template()` 의 `_MEIPASS`/`report_template.bin` DRM 폴백이
2026-08 신규 엔진에서 통째로 사라짐 → 서버에서 빈 워크북 보고서).

- 🚫 **`Piping Stress Analysis for all load cases/` 는 수정하지 않는다.** 새 버전이 오면 폴더째 덮어쓴다.
- ✅ WorkBench 개조는 전부 **어댑터**에 있다: `HiTessWorkBenchBackEnd/InHouseAdapters/doublepipe_psa/`
  (**git 추적** — 이력이 남는 것이 이 설계의 핵심). 상세: `README.md` +
  `docs/superpowers/specs/2026-08-28-doublepipe-engine-adapter-design.md`
  - `shims/` — 엔진 무수정 런타임 주입: openpyxl `load_workbook` DRM 폴백 / `MergedCell.value` 쓰기 무시 /
    `subprocess.Popen` 인코딩 교정 + `ask_delete=OFF` / stdout UTF-8.
  - `cli.py` — 연구원 `Main.py` 를 대체하는 진입점(`--load-cases` 규약은 기존 exe 와 100% 동일).
  - `patches.py` — shim 으로 못 뚫는 **엔진 로직 버그 fix** 만 선언적으로. 앵커 불일치 시 빌드 중단.
    새 항목을 넣기 전에 "shim 으로 못 하나?"를 먼저 볼 것.
- **exe·서식 템플릿 위치가 바뀌었다**: `InHouseProgram/DoublePipe/HiTessAdapter/` (엔진 폴더 밖).
  엔진 폴더를 덮어써도 지워지지 않게 하려는 것. 백엔드는 어댑터 폴더 → 구 엔진 폴더 순으로 폴백 탐색한다
  (`doublepipe_psa_service._resolve_psa_exe`).
- **새 엔진 수령 절차**: ① 엔진 폴더 덮어쓰기 → ② `pytest tests/test_doublepipe_adapter.py`
  (여기가 빨개지면 드리프트 — patches.py/engine.py 갱신) → ③ `InHouseAdapters/doublepipe_psa/build.ps1`
  (엔진 의존성 설치된 Python 3.8 환경 필요) → ④ 서버(145) 수동 복사 + 백엔드 재시작.
- ⚠️ 엔진 폴더의 `Report for PSA.xlsx` 는 dev PC 에서 **DRM 암호화(HHIDRMC, +4096B)된 상태**로 존재한다.
  `prep.py` 가 PK 검사로 걸러 `HiTessAdapter/report_template.bin`(PK 정상 사본)으로 폴백한다.
- ⚠️ **exe 모드에서는 엔진 `.py` 만 서버에서 바꿔서는 반영되지 않는다** (2026-10-23 확인). 코드가 빌드 때
  `HiTessAdapter/PSA_AllLoadCases.exe` 안에 묶인다 — 위 '새 엔진 수령 절차' ②~④ 를 거쳐야 한다.
  `Piping Stress Analyiss for selected load cases/` 폴더는 **백엔드가 참조하지 않는다** — 엔진을 고칠 곳은 `...for all load cases/` 다.
- **소스 직접 실행 모드 (2026-10-26)** — `.env` `DOUBLEPIPE_PSA_PYTHON=<엔진 의존성 있는 Python 3.8>` 이면 exe 대신
  `python -u InHouseAdapters/doublepipe_psa/psa_entry.py` 로 돌아 **엔진 `.py` 수정이 다음 해석부터 반영**된다(재빌드·재시작 없음).
  어댑터 `runtime.py` 가 실행 때 엔진 사본(`build/runtime/<지문>`)에 `patches.py` 를 적용하고, 앵커 불일치면 종료 코드 3 으로 실패한다.
  줄을 지우면 exe 로 롤백, 경로가 틀리면 503(조용히 exe 로 돌지 않음). 상세: 어댑터 `README.md` '소스 직접 실행 모드'.
  145 용 Python 은 **휴대용 폴더 `PSA_Python38`**(70 의 Python 3.8.10 설치 폴더 + `.venv38` site-packages, PyInstaller 제외, 274MB)을
  `InHouseProgram/DoublePipe/PSA_Python38/` 에 폴더째 복사해 쓴다(145 에서 설치·pip 불필요, zip 은 DRM 이 암호화하므로 폴더째).
  70 원본: `outputs/PSA_Python38/`(git 미추적). 다시 만들 때도 같은 방식으로 한다.
  배포 상태(2026-10-26): v1.6.28(`c203a7d` 기능 · `e9e3024` 버전) 푸시·exe 빌드. 70 은 휴대용 Python 으로 inp 생성까지만 실측(Abaqus 없음).
  **145 는 미적용** — PSA_Python38·교체한 `FuelLine_Making_LoadCase.py` 복사 → ⟳ Update → `.env` 한 줄 → 재시작 → 해석 1회로
  `[환경] 소스 직접 실행 모드` 로그·Abaqus 해석·보고서·DRM(복사된 `.py`) 확인이 남았다.
- **보고서 다운로드 'Network Error' (2026-10-26, `095ce51`)** — 145 에서 소스 모드로 돌린 해석의 `Report for PSA.xlsx` 받기가 화면에 `Network Error` 만 남기고 실패했다.
  145 작업 폴더의 보고서는 **DRM 에 감싸져 있었고(`HHIDRMC`) 같은 폴더의 csv·inp·txt·odb 는 평문** — DRM 이 xlsx 만 감싼다.
  `FileResponse` 가 Content-Length 를 stat 크기로 약속해 실제 바이트와 어긋난 것으로 보고 `/api/download` 를 **길이 없는 chunked 전송**으로 바꿨다
  (잠긴 파일 409 · 폴더 404 · 기록은 열린 뒤). **145 반영(⟳ Update) 후 실제로 풀리는지 확인 안 함.**
  exe 모드 때도 보고서가 감싸졌는지(= 소스 모드 전환 탓인지)는 미확정 — 오늘 이전 145 이중관 작업 폴더의 xlsx 머리가 `PK` 면 소스 모드(python.exe 저장) 탓이다.
