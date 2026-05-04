"""DevRunbook 시드 — upsert + obsolete 자동 정리.

서버 시작 시 호출되며 다음을 수행한다.

1) `_OBSOLETE_SEED_TITLES` 에 등록된 폐기 항목 중 owner='seed' 인 것은 자동 삭제
   (사용자가 owner 를 다른 값으로 바꾼 경우는 보존)
2) `_DEFAULT_RUNBOOKS` 의 각 항목을 title 기준으로 upsert
   - DB 에 없으면 → 새로 삽입 (owner='seed')
   - DB 에 있고 owner='seed' → 시드 정의로 강제 갱신 (코드가 단일 진실원)
   - DB 에 있고 owner!='seed' → 사용자 편집으로 간주, 건드리지 않음

따라서 시드 항목을 직접 편집·보존하고 싶다면 UI 에서 owner 필드를 바꾸면 된다
(예: 'seed' → 'khm7529'). 그러면 다음 재시작에 갱신되지 않는다.
"""
from . import models

SEED_OWNER = "seed"

# 시드로 간주되는 owner 들. 첫 번째 시드 반복에서 'khm7529' 로 잘못 박혔던 레거시
# 항목까지 함께 정리하기 위해 두 값을 모두 인정한다. 사용자가 UI 에서 owner 를
# 위 두 값과 다른 값으로 바꿔 두면 코드가 더 이상 건드리지 않는다.
LEGACY_SEED_OWNERS = ("seed", "khm7529")

# 더 이상 시드에서 관리하지 않는 폐기 항목 — owner 가 LEGACY_SEED_OWNERS 일 때만 자동 삭제.
# 별도 항목으로 유지하지 않고 다른 런북에 통합된 경우, 그리고 옛 제목으로 박힌
# orphan(현 시드의 새 제목으로 바뀌어 더 이상 매칭되지 않는) 항목도 여기 포함.
_OBSOLETE_SEED_TITLES = [
    # 기능 자체 폐기
    "AI 파이프라인 — 인덱싱·하이브리드 검색·LLM",
    "아이콘 파이프라인 — 투명 PNG → 멀티사이즈 ICO",
    "Nastran 경로 표준",
    # 다른 런북에 통합되어 단독 항목 폐기
    "F06 Parser — Nastran 결과 자동 파싱",       # → 'HiTess Model Builder' 안으로 이동
    "Electron 패키징 — npm run dist",             # → 'Workbench 빌드·버전 관리' 안으로 이동
    # 옛 제목 — 현재 시드는 더 자세한 제목으로 바뀌어 매칭되지 않음 (orphan 정리)
    "HiTess Model Builder — Cmb.Cli build-full",          # → "… Cmb.Cli 단일 단계 FE 모델 생성"
    "HiTess Model Studio — 빌드·배포·설치 흐름",         # → "… Viewer 빌드·배포·설치 전체 흐름"
    "Workbench 버전 관리 — Frontend·Backend 동기화",     # → "Workbench 빌드·버전 관리 — …"
]


_DEFAULT_RUNBOOKS = [
    # ────────────────────────────────────────────────────────────────────
    # 1. Workbench 빌드·버전 관리
    #    (Frontend/Backend 버전 동기화 + .exe 빌드 흐름 통합)
    # ────────────────────────────────────────────────────────────────────
    {
        "title": "Workbench 빌드·버전 관리 — .exe 빌드 + Frontend·Backend 동기화",
        "category": "Build",
        "summary": ".exe 아티팩트, 클라이언트 UI, 백엔드 API 세 곳의 버전을 동시에 올려야 정상 동작. 한 곳이라도 어긋나면 사용자에게 무한 업데이트 모달이 뜬다. 빌드는 npm run dist.",
        "paths": [
            # 버전 명시 위치 ─────────────────────────────
            {"label": ".exe 아티팩트 버전",                "value": "HiTessWorkBench\\package.json",                                    "kind": "file"},
            {"label": "클라이언트 UI 버전(CLIENT_VERSION)", "value": "HiTessWorkBench\\frontend\\package.json",                          "kind": "file"},
            {"label": "서버 버전(SERVER_VERSION, line 19)", "value": "HiTessWorkBenchBackEnd\\app\\routers\\system.py",                   "kind": "file"},
            {"label": "(보조) Electron sub-package",        "value": "HiTessWorkBench\\electron\\package.json",                          "kind": "file"},
            # 비교 로직 위치 ─────────────────────────────
            {"label": "버전 비교 호출(App)",                "value": "HiTessWorkBench\\frontend\\src\\App.jsx",                          "kind": "file"},
            {"label": "버전 비교 호출(Login)",              "value": "HiTessWorkBench\\frontend\\src\\pages\\auth\\LoginScreen.jsx",      "kind": "file"},
            # 빌드 핵심 파일 ─────────────────────────────
            {"label": "Electron 메인",                      "value": "HiTessWorkBench\\electron\\index.js",                              "kind": "file"},
            {"label": "preload (IPC 화이트리스트)",          "value": "HiTessWorkBench\\electron\\preload.js",                            "kind": "file"},
            {"label": "아이콘 (.exe 트레이/창)",             "value": "HiTessWorkBench\\electron\\icon.ico",                              "kind": "file"},
            {"label": "빌드 산출물",                         "value": "HiTessWorkBench\\dist_electron",                                   "kind": "folder"},
        ],
        "commands": [
            {"label": "버전 비교 API",            "value": "GET /api/version  →  {\"version\": SERVER_VERSION}"},
            {"label": "개발 (Vite + Electron)",   "value": "npm run dev   (HiTessWorkBench/ 에서)"},
            {"label": "프런트만 빌드",             "value": "npm run build:frontend"},
            {"label": "포터블 .exe 빌드",          "value": "npm run dist  →  dist_electron\\HiTESS-WorkBench-v{version}.exe"},
            {"label": "백엔드 재시작",             "value": "uvicorn app.main:app --host 0.0.0.0 --port 9091 --reload"},
        ],
        "content": (
            "# 한눈에 보는 그림\n\n"
            "**버전 1개를 올릴 때 수정해야 하는 곳은 4개 파일** (3개 필수 + 1개 보조).\n"
            "**.exe 빌드는** `npm run dist` 한 줄.\n\n"
            "## 1. 버전이 명시된 곳\n\n"
            "| # | 파일 | 필드 | 용도 |\n"
            "|---|---|---|---|\n"
            "| 1 ★ | `HiTessWorkBench/package.json` | `version` | electron-builder 가 `HiTESS-WorkBench-v{version}.exe` 형태로 .exe 아티팩트 명명 |\n"
            "| 2 ★ | `HiTessWorkBench/frontend/package.json` | `version` | `CLIENT_VERSION` 으로 import 되어 UI 표시(좌측 패널·사이드바)와 서버와의 비교에 사용 |\n"
            "| 3 ★ | `HiTessWorkBenchBackEnd/app/routers/system.py` | `SERVER_VERSION = \"1.0.0\"` (line 19) | `GET /api/version` 응답으로 노출 |\n"
            "| 4 | `HiTessWorkBench/electron/package.json` | `version` | 거의 사용 안 됨(root package.json 의 main 만 참조됨). 일관성 위해 같이 올리는 것 권장 |\n\n"
            "★ = 어긋나면 사용자에게 무한 업데이트 모달.\n\n"
            "## 2. 비교 로직 (App.jsx 라인 59~67, 163~171)\n\n"
            "```js\n"
            "const res = await checkVersion();           // GET /api/version\n"
            "const serverVersion = res.data?.version;\n"
            "if (serverVersion && serverVersion !== CLIENT_VERSION) {\n"
            "  reportVersionUpdate(CLIENT_VERSION, serverVersion, employeeId);\n"
            "  setLatestVersion(serverVersion);\n"
            "  setUpdateAvailable(true);  // ← UpdateModal 표시\n"
            "  return;\n"
            "}\n"
            "```\n\n"
            "## 3. 릴리즈 절차 (1.0.0 → 1.0.1 예시)\n\n"
            "1. `system.py` 의 `SERVER_VERSION = \"1.0.1\"` 갱신\n"
            "2. `frontend/package.json` 의 `version` → `\"1.0.1\"`\n"
            "3. `package.json` (루트) 의 `version` → `\"1.0.1\"`\n"
            "4. `electron/package.json` 의 `version` → `\"1.0.1\"` (옵션이지만 일관성 위해)\n"
            "5. 백엔드 재배포 (uvicorn 재시작)\n"
            "6. `npm run dist` → `HiTESS-WorkBench-v1.0.1.exe` 산출\n"
            "7. 새 .exe 를 백엔드 다운로드 디렉터리(`/api/download/client` 가 서빙하는 위치)에 업로드\n"
            "8. 기존 사용자 .exe → 부팅 시 1.0.0 vs 1.0.1 감지 → UpdateModal → 자동 다운로드/실행\n\n"
            "## 4. 빌드 시 주의해야 할 자산 경로 함정\n\n"
            "- **JSX `<img src=...>` 절대경로 금지**: `/icon.ico` 는 file:// 컨텍스트에서 OS 루트로 해석되어 패키지 .exe 에서 깨진다. **반드시 `${import.meta.env.BASE_URL}icon.ico` 사용**.\n"
            "- `vite.config.js` 의 `base: './'` 는 import 자산만 영향. raw `src` 는 BASE_URL 을 직접 적용해야 한다 (스플래시·로그인에서 한 번 데인 적 있음).\n\n"
            "## 5. extraResources vs files (package.json 빌드 설정)\n\n"
            "- `files`: app.asar 안에 박제됨. 변경하려면 .exe 재빌드 필수.\n"
            "- `extraResources`: `<설치폴더>/resources/` 에 외부 파일로 배치. 재빌드 없이 교체 가능.\n"
            "- 예: IntroductionPage 의 발표 deck 은 자주 갱신되므로 extraResources 로 분리. .exe 재빌드 없이 HTML 만 교체하면 반영됨.\n\n"
            "## 6. 흔한 실수\n\n"
            "- **백엔드만 올리고 .exe 빌드 누락** → 모든 사용자에게 무한 업데이트 모달 (서버는 1.0.1 이라고 답하는데 새 .exe 가 다운로드 폴더에 없음)\n"
            "- **`frontend/package.json` 만 올리고 root `package.json` 누락** → CLIENT_VERSION 은 새거지만 빌드 산출물 파일명이 옛 버전\n"
            "- **백엔드 `SERVER_VERSION` 만 깜빡** → 새 .exe 사용자도 옛 서버라 판정 → UpdateModal 무한 표시\n"
            "- **로컬 dev 서버를 새 백엔드로 띄우지 않은 채 새 프런트로 테스트** → 위와 동일한 무한 모달. 개발 시점에도 항상 두 쪽 모두 새 버전으로 동기화.\n"
            "- **app.setName 변경 시 사용자 데이터 경로 이동**: `electron/index.js` 상단의 `app.setName(\"HiTESS WorkBench\")` 를 바꾸면 `%APPDATA%` 폴더 위치가 달라져 Studio 같은 viewer 재설치 1회 강요됨.\n"
        ),
        "owner": SEED_OWNER,
    },

    # ────────────────────────────────────────────────────────────────────
    # 2. HiTess Model Builder
    #    (Cmb.Cli + Nastran 자동 실행 + F06 Parser 결과 파싱까지 통합)
    # ────────────────────────────────────────────────────────────────────
    {
        "title": "HiTess Model Builder — Cmb.Cli 단일 단계 FE 모델 생성",
        "category": "Builder",
        "summary": "구조 CSV(stru/pipe/equip) 3종 → Cmb.Cli build-full 한 번 호출 → phase JSON+BDF + InputAudit + StageSummary + 최종 BDF/JSON. --run-nastran 옵션으로 Nastran 자동 실행 + F06 결과 자동 파싱(F06Parser.Console.exe)까지 한 큐에 끝냄.",
        "paths": [
            # 핵심 실행파일 ──────────────────
            {"label": "Cmb.Cli.exe (메인 엔진, 67MB)",      "value": "HiTessWorkBenchBackEnd\\InHouseProgram\\HiTessModeBuilder\\Cmb.Cli.exe", "kind": "file"},
            {"label": "F06Parser.Console.exe",              "value": "HiTessWorkBenchBackEnd\\InHouseProgram\\F06Parser\\F06Parser.Console.exe", "kind": "file"},
            {"label": "Nastran (사내 표준 경로)",            "value": "C:\\MSC.Software\\MSC_Nastran\\20131\\bin\\nastran.exe",                  "kind": "file"},
            # 워크벤치 통합 코드 ─────────────
            {"label": "백엔드 서비스 래퍼",                   "value": "HiTessWorkBenchBackEnd\\app\\services\\hitess_modelflow_service.py",     "kind": "file"},
            {"label": "분석 라우터 modelflow 엔드포인트",     "value": "HiTessWorkBenchBackEnd\\app\\routers\\analysis.py",                       "kind": "file"},
            {"label": "프런트 페이지",                        "value": "HiTessWorkBench\\frontend\\src\\pages\\analysis\\HiTessModelBuilder.jsx", "kind": "file"},
            # 외부 리소스 ───────────────────
            {"label": "Cmb.Cli README (CLI 옵션 명세)",      "value": "HiTessWorkBenchBackEnd\\InHouseProgram\\HiTessModeBuilder\\README.md",   "kind": "file"},
            {"label": "Cmb 소스(개발용 .NET 8 솔루션)",      "value": "C:\\Coding\\WorkBenchSubModule\\ModelBuilder",                            "kind": "folder"},
            {"label": "사용자 작업 폴더 루트",                "value": "HiTessWorkBenchBackEnd\\userConnection",                                  "kind": "folder"},
        ],
        "commands": [
            {"label": "단일 호출 (CSV 폴더 자동 매칭)",     "value": "Cmb.Cli.exe build-full --input <CSV_DIR>"},
            {"label": "옵션 풀 호출",                        "value": "Cmb.Cli.exe build-full --stru <S.csv> --pipe <P.csv> --equip <E.csv> --mesh-size 500 --ubolt-full-fix --run-nastran"},
            {"label": "백엔드 작업 제출 API",                "value": "POST /api/analysis/modelflow/request  (multipart: stru_file, pipe_file?, equip_file?, employee_id, mesh_size, ubolt_full_fix, run_nastran)"},
            {"label": "작업 상태 폴링 API",                  "value": "GET /api/analysis/status/{job_id}"},
            {"label": "Nastran 단일 실행",                   "value": "nastran.exe <input.bdf> scr=yes old=no batch=no"},
            {"label": "F06 Parser 단일 호출",                "value": "F06Parser.Console.exe <path/to/file.f06>"},
            {"label": "F06 FATAL 감지 정규식",                "value": "\\*\\*\\*\\s*(USER|SYSTEM)\\s+FATAL\\b"},
            {"label": "Exit Code",                           "value": "0=정상, 2=Validation Error 있음(산출물 OK), 1=실패"},
        ],
        "content": (
            "# 무엇을 하는 도구인가\n\n"
            "사용자가 업로드한 **구조 CSV(stru) + 배관 CSV(pipe) + 의장 CSV(equip)** 3종을 입력으로 받아, "
            "단 한 번의 `Cmb.Cli build-full` 호출로 **6개 phase 의 JSON+BDF + 입력 검증 + phase 메트릭 + 최종 BDF/JSON + (옵션) Nastran 실행 + F06 결과 자동 파싱**까지 한꺼번에 산출한다.\n\n"
            "## 핵심 흐름 (3 stage)\n\n"
            "```\n"
            "[Stage 1] CSV → 모델 빌드   (Cmb.Cli build-full)\n"
            "[Stage 2] BDF → Nastran 해석   (--run-nastran 옵션, 사내 nastran.exe 호출)\n"
            "[Stage 3] F06 → 결과 파싱    (F06Parser.Console.exe, *_results.json + CSV)\n"
            "```\n\n"
            "1·2·3 stage 모두 **한 번의 `--run-nastran` 호출로 자동 chain** 됨. 옵션 끄면 Stage 1 만.\n\n"
            "## 데이터 흐름 다이어그램\n\n"
            "```\n"
            "[프런트] CSV 3종 업로드\n"
            "   ↓ POST /api/analysis/modelflow/request (multipart)\n"
            "[백엔드 라우터] userConnection/<ts>_<emp>_HiTessModelBuilder/ 에 파일 저장\n"
            "   ↓ analysis_executor.submit(task_execute_modelflow, ...)\n"
            "[ThreadPool 워커]\n"
            "   ↓ subprocess.run([Cmb.Cli.exe, 'build-full', ...])\n"
            "[Cmb.Cli] Phase 1~6 + Audit + Summary + 최종 모델 산출\n"
            "          (--run-nastran 시) Nastran.exe 호출 → *.f06/op2/log 생성\n"
            "          (Nastran 후) F06Parser.Console.exe 호출 → *_results.json + CSV\n"
            "   ↓ stdout 첫 줄 '출력 폴더: <path>' 캡처\n"
            "[백엔드] DB 에 audit_path/summary_path/json_path/bdf_path 기록\n"
            "   ↓ job_status_store.update_job(... 100%)\n"
            "[프런트] 폴링 → '01 CSV 입력 검증' 화면 자동 표시\n"
            "   ↓ 사용자: 'Studio 열기' 클릭\n"
            "[Studio] 별도 풀스크린 창 (런북 'HiTess Model Studio' 참조)\n"
            "```\n\n"
            "## 옵션 매핑 (UI ↔ CLI)\n\n"
            "| UI 항목 | CLI 플래그 | 기본값 |\n"
            "|---|---|---|\n"
            "| Mesh Size | `--mesh-size <MM>` | 500 |\n"
            "| U-bolt Rigid 자동 고정 | `--ubolt-full-fix` | OFF (체크박스) |\n"
            "| Nastran 자동 실행 | `--run-nastran` | ON (체크박스) |\n"
            "| (자동, 코드에서 강제) | `--nastran-path C:\\MSC.Software\\MSC_Nastran\\20131\\bin\\nastran.exe` | 사내 표준 |\n\n"
            "예전엔 고급 옵션(Mesh 구조/Mesh 배관/Leg Z Tol/Nastran 경로 4종)을 UI 에 노출했으나, "
            "기본 mesh_size 가 모두 커버 + Nastran 경로 사내 표준이라 **현재는 모두 제거**됨. UI 에는 위 3가지 + Mesh Size 만 남음.\n\n"
            "## Stage 1 산출물 (timestamp 폴더 안)\n\n"
            "| 파일 | 의미 |\n"
            "|---|---|\n"
            "| `00_InputAudit.json` | CSV 행 단위 입력 검증 (mappingConfidence, skip 사유 등) |\n"
            "| `00_StageSummary.json` | phase 메트릭 + total mass + CG + totalErrors |\n"
            "| `01_Preprocess.{json,bdf}` ~ `06_Validation.{json,bdf}` | phase별 중간 산출물 |\n"
            "| `{designName}.{json,bdf}` | 최종 모델 (phase prefix 가 **없는** 파일이 최종) |\n\n"
            "## Stage 2 산출물 (--run-nastran 시)\n\n"
            "| 파일 | 의미 |\n"
            "|---|---|\n"
            "| `*.f06` | Nastran 텍스트 결과/진단 (FATAL/ERROR 검색 대상) |\n"
            "| `*.op2` | Nastran 바이너리 결과 |\n"
            "| `*.log` | Nastran 실행 로그 |\n\n"
            "Nastran 호출 형태: `nastran.exe <input.bdf> scr=yes old=no batch=no`\n"
            "`batch=no` 로 실행해야 콘솔 점유 없이 끝까지 실행됨.\n\n"
            "## Stage 3 산출물 (F06 Parser 후)\n\n"
            "| 파일 | 의미 |\n"
            "|---|---|\n"
            "| `<basename>_results.json` | 전체 메트릭 + Subcase 요약 |\n"
            "| `<basename>_SC{n}_{type}.csv` | Subcase 별 결과 테이블 |\n\n"
            "백엔드의 `scan_f06_diagnostics()` 가 `*** USER FATAL`, `*** SYSTEM FATAL` 같은 마커를 정규식으로 스캔해 fatalCount/errorCount/sample 을 반환. "
            "Edit 탭에서 **fatal/error 유무만 표시** (정상이면 '깨끗', 아니면 샘플 라인 노출).\n\n"
            "## stdout 캡처 규약 (백엔드가 출력 폴더를 찾아내는 방식)\n\n"
            "- **첫 줄** 형태: `출력 폴더: <full path>` 또는 `폴더: <full path>` (한글 콜론 `：` 도 허용)\n"
            "- 후반부: `BDF: <path>` / `JSON: <path>`\n"
            "- 정규식: `^(?:출력\\s*폴더|폴더)\\s*[:：]\\s*(.+)$`\n"
            "- **실패 폴백**: `_scan_latest_timestamp_dir()` 가 work_dir 안 `[0-9]{8}_[0-9]{6}` 패턴 폴더 중 mtime 최신을 자동 선택 (1초 내 재실행이면 같은 폴더라 idempotent)\n\n"
            "## Exit Code 의미\n\n"
            "| code | 의미 | 백엔드 처리 |\n"
            "|---|---|---|\n"
            "| 0 | 정상 종료 | status=\"Success\" |\n"
            "| 1 | 실패 (산출물 없음) | status=\"Failed\" |\n"
            "| 2 | Validation 단계 Error 발견 (단 산출물은 정상) | status=\"Success\" + 사용자에게 진단 표시 |\n\n"
            "## 백엔드에서 더 이상 하지 않는 것 (구버전 잔재 주의)\n\n"
            "이전 버전 워크벤치는 **BdfScanner 변환, STAGE_07 merge, Geometry_Stage3 분류, 연결성분 계산, U-bolt RBE2 재시도, 그룹 삭제** 같은 어댑터 로직을 직접 했었다. "
            "이건 **모두 Cmb.Cli 내부에서 처리**되므로 백엔드는 **단순 래퍼만 한다**.\n\n"
            "라우터에서 다음 4개는 삭제됨:\n"
            "- `/api/analysis/modelflow/nastran-request` (→ `--run-nastran` 플래그로 흡수)\n"
            "- `/api/analysis/modelflow/ubolt-retry` (→ `--ubolt-full-fix` 플래그로 흡수)\n"
            "- `/api/analysis/modelflow/rbe-retry` (→ Studio 의 apply-edit-intent 로 이전)\n"
            "- `/api/analysis/modelflow/group-delete` (→ 동일)\n\n"
            "프런트 페이지도 1500줄+ 의 인라인 FemModelViewer / 수동 RBE 편집 UI / U-bolt 재시도 UI 가 모두 제거되어 단순한 `[입력] → [실행/요약/Studio 버튼] → [Nastran(선택)]` 3단계 구조로 환원됨.\n\n"
            "## 자주 막히는 부분\n\n"
            "**Q. Cmb.Cli.exe 가 실행 안 됨**\n"
            "A. 위 경로(`InHouseProgram/HiTessModeBuilder/`) 확인. .exe 67MB. .NET 8 런타임 필요(자체 포함 single-file).\n\n"
            "**Q. 한글 폴더명에서 stdout 깨짐**\n"
            "A. `subprocess.run(..., text=True, encoding=\"utf-8\")` 로 호출. 정규식이 한글 콜론 `：` 허용. README §5.4 참고.\n\n"
            "**Q. exit code 2 인데 status=Success 로 떠 헷갈림**\n"
            "A. 의도한 동작. Validation Error 가 있어도 산출물은 정상이라 viewer 오픈 가능. UI 에서 진단 패널로 별도 표시.\n\n"
            "**Q. Nastran 경로가 사용자 PC 마다 다름**\n"
            "A. 현재 UI 에서는 override 불가 (사내 표준 강제). Cmb.Cli stderr 메시지 확인 후 그 사용자 PC 환경 자체를 표준 경로로 정렬할 것.\n\n"
            "**Q. F06 에 FATAL 이 있는데 status=Success 로 뜸**\n"
            "A. exit code 와 별개. `scan_f06_diagnostics()` 가 fatal/error count 를 따로 추출해 Edit 탭에 표시. Stage 1 산출물은 정상이라 Success 유지하되 진단으로 알림.\n"
        ),
        "owner": SEED_OWNER,
    },

    # ────────────────────────────────────────────────────────────────────
    # 3. HiTess Model Studio
    # ────────────────────────────────────────────────────────────────────
    {
        "title": "HiTess Model Studio — Viewer 빌드·배포·설치 전체 흐름",
        "category": "Studio",
        "summary": "Studio 는 Workbench 와 별개의 React 앱. zip 으로 빌드해 사내 storage 에 올리면 Workbench 가 자동 다운로드/압축 해제/버전 동기화 후 풀스크린으로 띄움. Studio 내 편집 결과는 IPC 로 Workbench 백엔드에 자동 적용.",
        "paths": [
            {"label": "Studio 소스 루트(개발)",          "value": "C:\\Coding\\WorkBenchSubModule\\ModelBuilderStudio",                                "kind": "folder"},
            {"label": "Studio 앱 디렉터리",              "value": "C:\\Coding\\WorkBenchSubModule\\ModelBuilderStudio\\apps\\model-studio",            "kind": "folder"},
            {"label": "Studio 버전 위치 ★",              "value": "C:\\Coding\\WorkBenchSubModule\\ModelBuilderStudio\\apps\\model-studio\\package.json", "kind": "file"},
            {"label": "Vite 빌드 산출물",                "value": "C:\\Coding\\WorkBenchSubModule\\ModelBuilderStudio\\apps\\model-studio\\dist",         "kind": "folder"},
            {"label": "Vite emit manifest (빌드 결과)",  "value": "C:\\Coding\\WorkBenchSubModule\\ModelBuilderStudio\\apps\\model-studio\\dist\\manifest.json", "kind": "file"},
            {"label": "패키징 스크립트",                  "value": "C:\\Coding\\WorkBenchSubModule\\ModelBuilderStudio\\apps\\model-studio\\scripts\\package-viewer.mjs", "kind": "file"},
            {"label": "빌드 zip 출력 폴더",               "value": "C:\\Coding\\WorkBenchSubModule\\ModelBuilderStudio\\apps\\model-studio\\release",     "kind": "folder"},
            {"label": "사내 storage 배포 위치(UNC)",     "value": "\\\\storage.hpc.hd.com\\a476854\\00_PROJECT\\AA_300_CF44\\[개인 자료]\\권혁민 책임연구원\\HiTessWorkBench\\StudioProgram", "kind": "unc"},
            {"label": "Workbench viewers 라우터",        "value": "HiTessWorkBenchBackEnd\\app\\routers\\viewers.py",                                  "kind": "file"},
            {"label": "Workbench VIEWER_ID 상수 위치",   "value": "HiTessWorkBench\\frontend\\src\\pages\\analysis\\HiTessModelBuilder.jsx",            "kind": "file"},
            {"label": "사용자 PC 설치 폴더",              "value": "%APPDATA%\\HiTESS WorkBench\\viewers\\model-studio",                                "kind": "folder"},
            {"label": "Electron viewer:install 핸들러",  "value": "HiTessWorkBench\\electron\\index.js",                                              "kind": "file"},
            {"label": "Electron preload(workbenchAPI)",  "value": "HiTessWorkBench\\electron\\preload.js",                                            "kind": "file"},
        ],
        "commands": [
            {"label": "1. Studio 개발 모드",            "value": "cd apps/model-studio && npm run dev"},
            {"label": "2. Studio Vite 빌드",            "value": "cd apps/model-studio && npm run build"},
            {"label": "3. Studio zip 패키징(빌드+zip)", "value": "cd apps/model-studio && npm run package"},
            {"label": "4. zip 결과 위치",                "value": "release/model-studio-<version>.zip + .sha256"},
            {"label": "5. 사내 배포 (zip 만 올림)",      "value": "복사 → \\\\storage.hpc.hd.com\\...\\StudioProgram\\"},
            {"label": "Workbench 측 viewer 강제 재설치", "value": "%APPDATA%\\HiTESS WorkBench\\viewers\\model-studio\\ 폴더 삭제 후 'Studio 열기' 재클릭"},
            {"label": "VIEWER_DIR 환경변수 override",   "value": "VIEWER_DIR=<다른경로>  (백엔드 viewers.py:28 참조)"},
        ],
        "content": (
            "## Studio 와 Workbench 의 관계\n\n"
            "Studio 는 Workbench 와 **완전 독립된 React 앱**이다 (별도 리포: `C:\\Coding\\WorkBenchSubModule\\ModelBuilderStudio`). "
            "빌드 결과 zip 을 Workbench 가 받아 사용자 PC 에 설치하고, Electron BrowserWindow 로 풀스크린으로 띄운다. "
            "두 앱 사이의 통신은 **IPC(`window.workbenchAPI`)** 로만 일어난다.\n\n"
            "## Studio 자체 버전 vs Workbench 버전 — 헷갈리지 말 것 ★\n\n"
            "**Studio 의 version 은 Workbench Client version 과 별개로 진화한다.**\n\n"
            "| 무엇 | 어디 | 현재 |\n"
            "|---|---|---|\n"
            "| Workbench Client version | `frontend/package.json` + `system.py SERVER_VERSION` 동시 (런북 'Workbench 빌드·버전 관리' 참조) | 1.0.0 |\n"
            "| Studio version | `apps/model-studio/package.json` 의 `version` **단 하나** | 0.0.1 |\n\n"
            "둘은 같이 안 올라가도 된다. Workbench 1.0.0 사용자가 Studio 0.0.5 를 받아 쓰는 상황도 정상.\n\n"
            "**자동 동기화 메커니즘**:\n"
            "- 사용자 PC `%APPDATA%\\HiTESS WorkBench\\viewers\\model-studio\\manifest.json` 의 `version`\n"
            "- 서버(사내 storage) zip 안 `manifest.json` 의 `version`\n"
            "- 둘이 **다르면** Workbench 가 자동 재설치 (옛 폴더 삭제 → 새 zip 다운로드 → sha256 검증 → 압축 해제)\n\n"
            "## 6 단계 흐름 (한 번 자세히 읽으면 다시 안 헷갈리도록)\n\n"
            "### 1단계 — Studio 소스 수정\n\n"
            "경로: `C:\\Coding\\WorkBenchSubModule\\ModelBuilderStudio\\apps\\model-studio\\`\n\n"
            "**이때만 바꾸는 게 좋은 파일**: `package.json` 의 `version` 필드. "
            "기능 변경 후 반드시 bump (예: `0.0.1` → `0.0.2`). **안 올리면 사용자 PC 의 옛 설치본이 그대로 살아 자동 갱신이 안 일어난다.**\n\n"
            "### 2단계 — Vite 빌드\n\n"
            "```\n"
            "cd apps/model-studio\n"
            "npm run build\n"
            "```\n\n"
            "산출: `dist/` 폴더. 핵심은 `dist/manifest.json` — vite.config.js 가 빌드 시점에 `package.json` 의 id/version 을 자동 emit. **수동으로 편집 금지** (다음 빌드에서 덮어써짐).\n\n"
            "### 3단계 — zip 패키징\n\n"
            "```\n"
            "npm run package\n"
            "# = npm run build && node scripts/package-viewer.mjs\n"
            "```\n\n"
            "`package-viewer.mjs` 가 하는 일:\n"
            "1. `dist/manifest.json` 의 id/version 읽음\n"
            "2. `release/<id>-<version>.zip` 생성. **zip 루트에 `manifest.json` / `index.html` / `assets/` 가 바로 위치** (폴더 래퍼 없음 — Workbench 가 viewers/<id>/ 폴더를 미리 만들어 그 안에 풀기 때문)\n"
            "3. `<id>-<version>.zip.sha256` 도 같이 생성\n"
            "4. 결과(경로/크기/해시)를 콘솔 출력\n\n"
            "### 4단계 — 사내 storage 업로드\n\n"
            "대상 폴더 (UNC):\n"
            "```\n"
            "\\\\storage.hpc.hd.com\\a476854\\00_PROJECT\\AA_300_CF44\\[개인 자료]\\권혁민 책임연구원\\HiTessWorkBench\\StudioProgram\\\n"
            "```\n\n"
            "**zip 파일 1개만 올리면 충분** (sha256 파일은 옵션). "
            "Workbench 백엔드 `_find_zip()` 이 `model-studio` prefix 매칭으로 시작 + 역정렬해서 **이름이 가장 큰 (= 가장 최신 버전)** zip 을 자동 선택한다.\n\n"
            "환경변수 `VIEWER_DIR` 로 다른 위치 지정 가능 (`viewers.py:28`).\n\n"
            "### 5단계 — Workbench 자동 다운로드/설치\n\n"
            "사용자가 Workbench 에서 'Studio 열기' 클릭하는 시점:\n\n"
            "1. `viewer:check-installed` IPC → 사용자 PC manifest.json 의 version 확인\n"
            "2. `GET /api/viewers/manifest/model-studio` → 서버 zip 의 manifest.version 받음\n"
            "3. **버전 비교**\n"
            "   - 미설치 → 신규 설치\n"
            "   - 동일 → 그대로 오픈\n"
            "   - 다름 → **자동 재설치** (옛 폴더 통째로 삭제 → 새 zip 다운로드 → sha256 검증 → 압축 해제)\n"
            "4. 압축 해제 후 `manifest.json` + `index.html` 존재 검증\n"
            "5. `viewer:open` IPC → 풀스크린 BrowserWindow 로 `index.html` 로드 + `initialFolder` (해석 산출 폴더) 인자 전달\n\n"
            "### 6단계 — Studio ↔ Workbench 통신 (Studio 편집 → Workbench 자동 처리)\n\n"
            "Studio 에서 사용자가 '최종 모델 출력' 클릭 시:\n\n"
            "```\n"
            "[Studio renderer]\n"
            "   ↓ 1. *_edit.json 을 해석 산출 폴더에 저장\n"
            "   ↓ 2. window.workbenchAPI.finalizeEditedModel(folderPath, request)\n"
            "[Workbench main process]\n"
            "   ↓ 3. ipcMain.handle('viewer:finalizeEditedModel')\n"
            "   ↓ 4. mainWindow.webContents.send('modelflow:finalize-edit-request', ...)\n"
            "[Workbench mainWindow renderer]\n"
            "   ↓ 5. POST /api/analysis/modelflow/edit-apply (apply-edit-intent)\n"
            "   ↓ 6. Job ID 반환받자마자 main 에 응답 (Phase 1 종료)\n"
            "[Workbench main]\n"
            "   ↓ 7. Studio 에 ok:true 응답\n"
            "[Studio]\n"
            "   ↓ 8. 즉시 닫힘\n"
            "[Workbench renderer (백그라운드)]\n"
            "   ↓ 9. 폴링으로 Phase 2 처리: apply-edit → Nastran → F06Parser 체인\n"
            "   ↓ 10. 완료 시 Edit 탭에 결과 자동 표시\n"
            "```\n\n"
            "**핵심 원칙**: Phase 1 (POST 만) 끝나면 Studio 닫음. Phase 2 (Nastran+F06, 수 분) 는 백그라운드. "
            "**이걸 분리 안 하면 Studio 가 수 분간 먹통**이 된다 (사용자가 닫지 못함).\n\n"
            "## 변경 시 주의해야 할 핵심 파일\n\n"
            "### Workbench 측\n"
            "- `frontend/src/pages/analysis/HiTessModelBuilder.jsx`\n"
            "  - `VIEWER_ID = 'model-studio'` (라인 ~23). **이 값이 zip 파일명 prefix 와 일치해야 함**\n"
            "  - `launchAlgorithmViewer()` (라인 ~2511): install + open 진입점\n"
            "  - `startApplyEditJob` / `pollEditJobInBackground`: Phase 1/2 분리 핵심\n"
            "- `electron/index.js`\n"
            "  - `viewer:install` 핸들러 (라인 ~456): zip 다운로드 + sha256 검증 + 압축 해제\n"
            "  - `viewer:open` 핸들러 (라인 ~526): 풀스크린 BrowserWindow 생성\n"
            "  - `viewer:finalizeEditedModel` 핸들러: Studio → main → renderer 위임\n"
            "  - `app.setName(\"HiTESS WorkBench\")` (상단): 다이얼로그 제목 + userData 경로 결정\n"
            "- `electron/preload.js`\n"
            "  - `VALID_INVOKE_CHANNELS`: viewer:* 채널 화이트리스트\n"
            "  - `contextBridge.exposeInMainWorld(\"workbenchAPI\", { ... })`\n"
            "- `HiTessWorkBenchBackEnd/app/routers/viewers.py`\n"
            "  - `VIEWER_DIR` (UNC 경로, 라인 28)\n"
            "  - `/api/viewers/manifest/{viewer_id}` + `/api/viewers/download/{viewer_id}`\n\n"
            "### Studio 측\n"
            "- `apps/model-studio/package.json` 의 `version` ★ **여기만 올리면 새 빌드의 자동 갱신이 작동**\n"
            "- `apps/model-studio/scripts/package-viewer.mjs` (zip 생성)\n"
            "- `apps/model-studio/dist/manifest.json` (빌드 시 자동 emit, 직접 편집 X)\n\n"
            "## 자주 막히는 부분\n\n"
            "**Q. 빌드/배포 후에도 사용자에게 옛 Studio 가 계속 뜸**\n"
            "A. `apps/model-studio/package.json` 의 version 을 안 올린 것. dist/manifest.json 에 박힌 version 이 사용자 PC 의 manifest 와 같아 자동 갱신 트리거 안 됨. **반드시 bump**.\n\n"
            "**Q. Studio 가 닫히는데 수 분 걸림 / 페이지 비활성화 안 됨**\n"
            "A. Phase 1/2 분리가 깨졌다는 뜻. `HiTessModelBuilder.jsx` 의 `startApplyEditJob` (Phase 1, POST만) 와 `pollEditJobInBackground` (Phase 2, 폴링) 가 분리돼 있는지 확인. finalize IPC 응답이 Phase 1 종료 직후 즉시 와야 함.\n\n"
            "**Q. Studio 다이얼로그 제목이 'electron-app' 으로 뜸**\n"
            "A. `electron/index.js` 상단의 `app.setName(\"HiTESS WorkBench\")` 가 빠졌거나 미적용. **단** 이걸 바꾸면 userData 경로(`%APPDATA%\\HiTESS WorkBench\\` vs `%APPDATA%\\electron-app\\`) 도 같이 바뀌어 사용자에게 Studio 재설치 1회 강요됨 (옛 경로 viewers 폴더가 안 보임).\n\n"
            "**Q. zip 파일이 사내 storage 에 있는데 Workbench 가 못 찾음**\n"
            "A. zip 파일명 prefix 가 정확히 `model-studio-` 로 시작하는지 확인. `_find_zip()` 이 prefix 매칭 + 역정렬로 가장 큰 버전을 선택한다. 예: `model-studio-0.0.1.zip` ✅ / `Studio-0.0.1.zip` ❌\n\n"
            "**Q. zip 압축 해제 후 \"manifest.json 또는 index.html 발견 안 됨\" 에러**\n"
            "A. zip 루트 구조 잘못. `package-viewer.mjs` 가 만든 zip 은 manifest.json/index.html/assets/ 가 zip 루트에 바로 있어야 함. 다른 도구로 압축했다면 폴더 래퍼가 들어갔을 가능성 높음.\n\n"
            "**Q. SHA256 불일치 에러**\n"
            "A. zip 파일이 손상됐거나 회사 DRM 이 zip 을 변형한 경우. 사내 storage(UNC) 위치는 DRM 우회 목적으로 선택된 위치이므로, 다른 곳에 보관 중이면 storage 로 옮길 것.\n"
        ),
        "owner": SEED_OWNER,
    },
]


def seed_default_dev_runbooks(db) -> None:
    """폐기 항목 정리 + title 기반 upsert.

    LEGACY_SEED_OWNERS 에 속한 owner 의 항목만 시드로 간주한다.
    사용자가 owner 를 그 외 값으로 바꿔 두면 코드가 덮어쓰지 않는다(사용자 편집 보존).
    """
    # 1) 폐기된 시드 항목 제거 (LEGACY_SEED_OWNERS 모두 대상)
    if _OBSOLETE_SEED_TITLES:
        (
            db.query(models.DevRunbook)
            .filter(
                models.DevRunbook.owner.in_(LEGACY_SEED_OWNERS),
                models.DevRunbook.title.in_(_OBSOLETE_SEED_TITLES),
            )
            .delete(synchronize_session=False)
        )

    # 2) 시드 항목 upsert
    for entry in _DEFAULT_RUNBOOKS:
        existing = (
            db.query(models.DevRunbook)
            .filter(models.DevRunbook.title == entry["title"])
            .first()
        )
        if existing is None:
            db.add(models.DevRunbook(**entry))
            continue
        if existing.owner not in LEGACY_SEED_OWNERS:
            # 사용자가 owner 를 명시적으로 바꿈 → 보존
            continue
        # 코드 정의로 강제 갱신 (id/created_at 은 그대로 유지, owner 는 'seed' 로 정규화)
        for key, value in entry.items():
            setattr(existing, key, value)

    db.commit()
