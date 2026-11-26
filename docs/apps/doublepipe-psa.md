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
- **엔진 갱신 = 145 엔진 폴더에 파일만 바꿔 넣기 (2026-11-26 구조 변경)**: 어댑터는 해석 흐름을 따로 갖지 않고 엔진 `Main.run_pipeline(csv_path)` 를 그대로 부른다(`hitess_adapter/cli.py`).
  Load Case 선택만 Main 이 쓰는 `HeadClass_01` 을 하위 클래스로 바꿔 끼워 처리한다(`LC_name`, `LC_name_iter01`, `LC_name_iter02`, `filename`, `datname` 을 선택한 LC 만 남김).
  그래서 개발자가 Main.py 흐름이나 보고서 함수를 바꿔도 145 에 `.py` 를 넣으면 다음 해석부터 반영된다(재시작, 재빌드 없음).
  **개발자와 지킬 약속 두 가지**: ① `Main.py` 에 `run_pipeline(csv_path)` 와 `HeadClass_01` 이름을 유지 ② `HeadClass_01` 인스턴스의 위 다섯 목록 속성 유지. 이것이 깨지면 해석이 이름을 찍고 실패한다.
  `patches.py` 7건은 옛 엔진 보호용으로 남긴다(새 엔진은 패치를 거치지 않는다). 새 흐름 판정 기준은 `Main.py` 에 `run_pipeline` 과 `make_report_pro` 가 함께 있는지다 — 10월 옛 엔진에도 `run_pipeline` 은 있어 그것만으로는 못 가른다(2026-11-26 리뷰). Load Case 선택이 적용되지 않으면 경고가 아니라 실패로 끝낸다. 새 패키지를 쓰면 `PSA_Python38` 에 넣어야 한다(70 에서 다시 만들어 폴더째 복사).
  `Main.py` 가 없거나 `run_pipeline` 이 없는 옛 엔진은 어댑터 자체 흐름(`run_adapter_pipeline`, `make_report()`)으로 돈다.
  **엔진 폴더 그대로 실행(2026-11-26 사용자 지시)**: 소스 모드에서 엔진 `Main.py` 에 `run_pipeline` 이 있으면 `psa_main` 이 엔진 사본(`build/runtime`), 패치, 서식 shim 을 모두 건너뛰고 엔진 폴더에서 바로 import 한다(한글 출력용 console shim 하나만, `__pycache__` 안 씀). WorkBench 코드가 더하는 것은 Load Case 선택뿐이다. `Piping Stress Analyiss for selected load cases` 폴더는 쓰지 않는다.
- **보고서 서식(2026-11-26)**: 새 엔진은 `make_report_pro` 가 서식 없이 보고서를 직접 만든다(엔진 폴더에 `Report for PSA.xlsx` 없음, 로고 `report_logo.png`, ISO 도면은 matplotlib).
  소스 모드에서 엔진 `Main.py` 가 `make_report_pro` 를 쓰면 백엔드가 서식 준비를 건너뛴다(옛 서식을 넣어 두면 해석이 실패해도 '보고서 있음'으로 보였다).
  옛 `make_report()` 엔진이면 엔진 폴더 서식 xlsx 를 1순위로 쓰고 `HiTessAdapter/report_template_source.bin` 에 갱신해 둔다(exe 짝 `report_template.bin` 은 건드리지 않음). DRM 에 감싸져 못 읽으면 `.bin` 으로 내려가며 경고를 남긴다. exe 모드는 예전처럼 `.bin` 1순위.
- **145 반영 순서**: 엔진 폴더 복사를 먼저, `git pull` + 재시작을 나중에. 반대로 하면 옛 엔진이 패치 없이 돈다(옛 엔진은 패치 7건이 필요했다).
- **배포 상태(2026-11-26)**: 70 에 새 엔진(연구원 11-26 판, `make_report_pro`, ISO 도면) 배치, 어댑터 위임 구조와 서식 처리 변경은 **미커밋**. 이중관 시험 109 통과 / 1 건너뜀. 70 은 Abaqus 가 없어 inp 생성과 LC 선택까지만 실측, `make_report_pro` 는 단독 실행으로 보고서 생성 확인.
  남은 일: 커밋, 푸시 → 145 엔진 폴더 교체(`.bak_20261126` 으로 rename 후 복사) → ⟳ Update + 재시작 → 145 `PSA_Python38` 의 matplotlib, PIL import 확인 → 해석 1회(로그 `[어댑터] 엔진 Main.run_pipeline 으로 실행합니다`, 보고서 ISO 시트). `HiTessAdapter\` 폴더는 손대지 않는다(exe 비상 복귀용).
  ⚠ **이 변경이 145 에 들어가기 전까지 145 는 `HiTessAdapter\report_template.bin` 이 있어야 보고서가 나온다**(지금 145 커밋판 `c203a7d` 은 옛 `make_report()` 흐름이라 그 서식을 읽는다). 2026-11-26 145 에서 그 폴더를 지웠더니 보고서가 안 나왔다 — 복원 필요. 새 판에서는 소스 모드가 이 폴더를 읽지 않는다.
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
  **145 는 소스 직접 실행 모드로 운영 중**(2026-11-26 사용자가 145 `.env` 로 확인): `DOUBLEPIPE_PSA_PYTHON=C:\KHM\HiTessWorkbench\HiTessWorkBenchGit\HiTessWorkBenchBackEnd\InHouseProgram\DoublePipe\PSA_Python38\python.exe`.
  그래서 145 는 `PSA_AllLoadCases.exe` 를 쓰지 않고 `...for all load cases/` 의 `.py` 를 해석마다 읽는다(엔진 `.py` 를 145 에 복사하면 다음 해석부터 반영).
  70 은 `.env` 에 이 줄이 없어 exe 모드다(`HiTessAdapter/PSA_AllLoadCases.exe`, 2026-09-22 빌드라 그 뒤 엔진 수정이 안 들어갔을 수 있음).
- **보고서 다운로드 'Network Error' (2026-10-26, `095ce51`)** — 145 에서 소스 모드로 돌린 해석의 `Report for PSA.xlsx` 받기가 화면에 `Network Error` 만 남기고 실패했다.
  145 작업 폴더의 보고서는 **DRM 에 감싸져 있었고(`HHIDRMC`) 같은 폴더의 csv·inp·txt·odb 는 평문** — DRM 이 xlsx 만 감싼다.
  `FileResponse` 가 Content-Length 를 stat 크기로 약속해 실제 바이트와 어긋난 것으로 보고 `/api/download` 를 **길이 없는 chunked 전송**으로 바꿨다
  (잠긴 파일 409 · 폴더 404 · 기록은 열린 뒤). **145 반영(⟳ Update) 후 실제로 풀리는지 확인 안 함.**
  exe 모드 때도 보고서가 감싸졌는지(= 소스 모드 전환 탓인지)는 미확정 — 오늘 이전 145 이중관 작업 폴더의 xlsx 머리가 `PK` 면 소스 모드(python.exe 저장) 탓이다.
