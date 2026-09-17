# CLAUDE.md

이 파일은 Claude Code(claude.ai/code)가 이 저장소에서 작업할 때 참고하는 지침서입니다.

## 프로젝트 개요

**HiTESS WorkBench**는 사내 구조 해석 플랫폼입니다. 기존의 레거시 구조 해석 실행 파일(`.exe`)들을 현대적인 웹 UI로 감싸고 AI 어시스턴트를 결합한 시스템으로, Electron 데스크톱 앱(포터블 `.exe`)으로 배포되며 팀 공용 서버와 통신합니다.

## 디자인 컨텍스트 (Impeccable)

UI/디자인 작업 시 다음 문서를 우선 참고합니다 (impeccable 디자인 도구로 관리):

- **`PRODUCT.md`** (repo 루트) — register=`product`, 사용자·목적·브랜드 personality(신뢰·정밀·전문 엔지니어링)·anti-reference(낡은 레거시 엔터프라이즈 회피)·디자인 원칙 5가지·접근성 기준
- **`DESIGN.md`** (생성 시) — 시각 시스템: 브랜드 컬러(Trust Blue `#002554` 등)·타이포(Inter+SUIT)·컴포넌트 토큰
- 디자인 의사결정은 DESIGN.md(시각) > PRODUCT.md(전략/보이스) 순으로 우선. `/impeccable` 명령으로 critique·polish·live 등 수행

## 개발 명령어

### 백엔드 (FastAPI)

```bash
# 가상환경 활성화 (Windows)
HiTessWorkBenchBackEnd/WorkBenchEnv/Scripts/activate

# 개발 서버 실행 (HiTessWorkBenchBackEnd/ 에서)
uvicorn app.main:app --host 0.0.0.0 --port 9091 --reload

# 의존성 설치
pip install -r requirements.txt
```

### 프론트엔드 (React + Vite)

```bash
# 개발 서버 단독 실행 (HiTessWorkBench/frontend/ 에서)
npm run dev

# Electron 패키징용 빌드
npm run build
```

### Electron 데스크톱 앱

```bash
# 전체 개발 환경 실행 (HiTessWorkBench/ 에서)
# concurrently로 React 개발 서버(5173 포트)와 Electron을 동시에 실행
npm run dev

# 배포용 포터블 .exe 생성
npm run dist
```

## 아키텍처

```
[Electron shell]  →  개발: localhost:5173 로드 / 프로덕션: frontend/dist/index.html 로드
[React SPA]       →  REST API로 백엔드 서버와 통신
[FastAPI backend] →  해석 작업 수행, DB 데이터 제공, AI 질의 처리
```

### 주요 설정 포인트

- **백엔드 URL**: `HiTessWorkBench/frontend/src/config.js`의 `DEFAULT_API_BASE_URL` — 기본값 `http://10.133.122.70:9091`. 사용자가 앱 내에서 서버 주소를 변경하면 `localStorage`의 `'server_url'` 키에 저장되며 이 값이 우선 사용됨(`setApiBaseUrl()` 함수로 런타임 변경 가능).
  - ⚠️ **`config.js`의 `DEFAULT_API_BASE_URL` 변경은 항상 커밋에서 제외할 것.** 이 값은 개발자가 로컬 백엔드(`10.133.122.70` '내 컴퓨터')와 팀 서버(`10.14.42.145` '서버 컴퓨터') 사이를 토글하는 **로컬 전용 변경**이다. 커밋하면 배포 빌드의 기본 백엔드가 개발자 개인 PC로 바뀌어 팀/릴리즈가 깨진다. `/git:commit` 등 모든 커밋 작업에서 `config.js`는 스테이징하지 말고 로컬 변경으로 남겨둔다.
- 🚫 **`Darkmode.js/` 는 영구적으로 커밋하지 않는다 (사용자 지시).** 저장소 루트의 이 폴더는 **자체 `.git/` 를 가진 외부 라이브러리 클론**(50파일·1.3MB)이다. `git add -A` 로 넣으면 내부 파일이 아니라 **임베디드 저장소(gitlink) 한 줄**만 기록돼 다른 사람이 clone 하면 **빈 폴더가 되는 깨진 엔트리**가 된다. `.gitignore` 에 등재해 뒀으니 어떤 커밋 작업에서도 되살리지 말 것.
- **백엔드 개발 서버 포트**: `9091` (uvicorn 실행 시 `--port 9091` 사용).
- **데이터베이스**: MySQL `localhost:3306/hitessworkbench`, 접속 정보는 `HiTessWorkBenchBackEnd/app/database.py`. SQLAlchemy로 서버 시작 시 테이블 자동 생성.
- **Electron 환경 감지**: `electron/index.js`의 `app.isPackaged` 여부로 개발/프로덕션 로드 경로 분기.
- ⚠️ **InHouse 프로그램 배포 규칙 (개발 위치 ≠ 실사용 위치)**: 해석 실행 파일·스크립트의 **코드 작업은 `C:\Coding\WorkBenchSubModule\<Program>\`**(예: `Nastran_bridge`, `MooringFitting`)에서 하더라도, **WorkBench 백엔드가 실제로 실행·import 하는 최종본은 반드시 `HiTessWorkBenchBackEnd/InHouseProgram/<Program>/`로 복사**해야 한다.
  - 이유: 운영 서버(`10.14.42.145`, 경로 `C:\KHM\HiTessWorkbench\HiTessWorkBenchGit\HiTessWorkBenchBackEnd\`)에는 **`WorkBenchSubModule/` 폴더가 존재하지 않는다.** 서버는 `git pull`로 백엔드 레포만 받고 InHouse 프로그램은 `InHouseProgram/`에서만 찾는다. 따라서 `WorkBenchSubModule`만 고치고 `InHouseProgram`에 반영하지 않으면 **dev에서는 되지만 서버에서 깨진다** (실제 사례: `nastran_bridge.py`의 신규 함수 `rbe2_fixed_lines` 누락 → mooring solve가 HTTP 500).
  - 실천: `WorkBenchSubModule/<Program>` 소스를 수정하면 **대응하는 `InHouseProgram/<Program>` 사본도 항상 같이 갱신**해 버전 드리프트를 막을 것.
  - 폴더명 주의: `InHouseProgram`은 camelCase(`NastranBridge`, `TrussAssessment`…), `WorkBenchSubModule`은 underscore 혼용(`Nastran_bridge`). 백엔드 `analysis.py`의 nastran_bridge 탐색은 `InHouseProgram/Nastran_bridge` → `WorkBenchSubModule/Nastran_bridge` → `InHouseProgram/NastranBridge` 후보를 모두 보고, `NASTRAN_BRIDGE_DIR` 환경변수 override도 지원한다(commit `146db53`).
  - 🔔 **커밋 시 보고 의무(필수)**: `InHouseProgram/`은 git 미추적(`.gitignore`에 `*.exe` 및 `HiTessWorkBenchBackEnd/InHouseProgram/`)이라 **`git pull`로 서버에 절대 안 따라온다.** 따라서 InHouse 프로그램(exe/py)이 변경되거나 관련된 작업을 커밋할 때마다, 커밋 보고에 **"서버(145)에 수동 교체해야 할 프로그램 파일 목록 + 교체 후 백엔드 재시작 필요"를 항상 함께 명시**할 것. 또 **"`git pull`만으로 끝나는지 / 수동 교체가 추가로 필요한지"를 커밋마다 분명히 구분**해 알릴 것. (실제 사례: `nastran_bridge.py`는 rbe2_fixed_lines 포함본, `MooringFitting.exe`는 solve-bdf 지원본으로 서버 `InHouseProgram/`에 덮어쓰고 재시작해야 mooring 구조해석이 동작.)

### Model Builder Studio — 2개 구성요소(엔진 / 스튜디오)와 배포 흐름 ★작업 전 필독

Model Builder Studio는 **별개의 두 프로젝트**로 구성된다. 작업 시 어느 쪽을 건드리는지 먼저 구분할 것.

**① 해석 엔진 (C#)**
- 소스: `C:\Coding\WorkBenchSubModule\HiTessModelBuilder\` (`Cmb.*` 솔루션, `HiTessModelBuilder.sln`)
- 빌드 산출물(실사용): `HiTessWorkBenchBackEnd\InHouseProgram\HiTessModeBuilder\Cmb.Cli.exe`
  - ⚠️ 폴더명은 `HiTessModeBuilder` ('l' 빠진 형태가 정확함, 오타 아님). InHouse 프로그램 규칙(위) 그대로 적용 — **git 미추적, 서버(145) 수동 교체 필요**.

**② 스튜디오 (React UI 뷰어)**
- 소스: `C:\Coding\WorkBenchSubModule\ModelBuilderStudio\apps\model-studio\` (viewer id=`model-studio`, 연결 메뉴=`HiTess Model Builder`)
- zip 빌드: 해당 폴더에서 `npm run package` → `release/model-studio-<ver>.zip` (+ `.sha256`). 버전은 `package.json` 한 곳만 올림.
- **배포 위치 2곳 — 둘 다 복사해야 함:**
  1. **`HiTessWorkBenchBackEnd\StudioProgram\` (백엔드-로컬)** — ★ WorkBench 앱이 백엔드 `viewers.py`로 **실제 읽는 곳, UNC보다 우선 스캔**. 여기에 안 넣으면 앱은 새 버전을 못 본다(과거 실수 사례).
  2. **UNC** `\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\StudioProgram` — 운영 표준 아카이브. (한글·대괄호 때문에 PowerShell은 `Copy-Item -LiteralPath ... -Destination '<경로>' -Force`)
- 사용 흐름: WorkBench가 `GET /api/viewers/manifest|download/model-studio`로 **백엔드에서 최신 버전 zip을 다운로드 → 로컬 PC에 설치**해 띄운다. `viewers.py`의 `_find_zip`은 후보 폴더를 순서대로 보고 **첫 번째 폴더에서 최고 버전**을 내려준다(백엔드-로컬이 1순위 → 거기 최고 버전이 곧 앱이 보는 버전).

**배포 시 체크리스트 / 함정(이번 세션 실측):**
- 버전 bump 전 **StudioProgram 양쪽의 기존 배포 버전을 먼저 확인**할 것. 로컬 `package.json`이 실제 배포본보다 **뒤처져 있을 수 있다**(ModelBuilderStudio는 `src/`가 git 미추적이라 버전·코드 드리프트 발생). 로컬 버전+1만 하면 배포본보다 낮아질 수 있음.
- ⚠️ **회사 DRM**이 로컬 C: 디스크에 쓴 zip을 at-rest로 **정확히 +4096 byte 암호화** → PowerShell엔 "EOCD 없음(손상)"으로 보인다(UNC 네트워크 경로엔 안 걸림). 백엔드(DRM 화이트리스트)는 `read()`로 복호화해 정상으로 읽는다.
- 그래서 `app/routers/viewers.py`는 size/sha256/다운로드 본문을 **모두 `read()`한 바이트 기준**으로 서빙해야 한다. `os.path.getsize`(stat=암호화된 on-disk 크기)나 `FileResponse`(Content-Length를 stat로 잡음)를 쓰면 본문(복호화)과 길이가 어긋나 앱이 **`ERR_CONTENT_LENGTH_MISMATCH`** 로 다운로드 실패한다. (이미 설치된 버전은 재다운로드가 없어 증상이 안 보이고, **신규 버전 다운로드에서만** 터짐.)
- 서버(145) 반영: `viewers.py` 등 git 추적 백엔드 코드는 `git pull`+백엔드 재시작, 스튜디오 zip은 서버 `HiTessWorkBenchBackEnd\StudioProgram\`에 **수동 복사**.

**런타임 파이프라인 — 엔진↔스튜디오가 실제로 맞물리는 절차 (오케스트레이터: `app/services/hitess_modelflow_service.py`)**

배포 흐름(위)이 "프로그램을 어디 두나"라면, 이건 "사용자가 누르면 무슨 일이 일어나나"다. 두 task 로 구성된다.

1. **빌드** — `POST /api/analysis/modelflow/request` → `task_execute_modelflow`
   - 업로드: `stru_file`(필수) + `pipe_file`·`equip_file`(선택). UI 옵션 → CLI 플래그: `mesh_size→--mesh-size`, `ubolt_full_fix→--ubolt-full-fix`, `run_nastran→--run-nastran(+--nastran-path,--leg-z-tol)` 등.
   - 실행: `Cmb.Cli.exe build-full --stru <csv> [--pipe --equip] --mesh-size N [...]` (cwd=work_dir, timeout 20분).
   - 산출: `userConnection/<ts>_<id>_HiTessModelBuilder/<yyyyMMdd_HHmmss>/` 안에 **phase 파일**(`00_InputAudit.json`, `00_StageSummary.json`, `NN_*.json/.bdf` — 정규식 `^\d{2}_[A-Za-z]+\.(json|bdf)$`) + **최종 산출물** `<designName>.json/.bdf`.
   - output_dir 확정: 백엔드가 stdout 첫 줄 `출력 폴더: <path>`(또는 `폴더:`)를 파싱, 못 찾으면 work_dir의 최신 `yyyyMMdd_HHmmss` 폴더로 폴백. exit **0/2=산출 OK, 1=실패**.
   - 뷰: 스튜디오(`model-studio`)가 이 output_dir 을 **initialFolder 로 받아 phase JSON 을 일괄 자동 로드** → 3D 뷰/검증/편집.

2. **편집 적용** — `task_execute_apply_edit` (apply-edit 엔드포인트)
   - 스튜디오가 편집 결과를 output_dir 에 `*_edit.json`(intents)으로 기록.
   - 기본 경로: `Cmb.Cli.exe apply-edit-intent <output_dir> [--strict]` → `edited/` 에 `<base>.bdf` + `<base>.json` + `apply-trace.json`. exit **0=성공, 2=intents 빔, 64/65/70=실패**.
   - ★ **Python fallback**: exit==65 + intents 에 `deleteRigid` 포함 + 로그에 `unsupported intent kind` 면 → `InHouseProgram/NastranBridge/nastran_bridge.py` 의 `write_edited_model_outputs()` 로 edited BDF/JSON 생성(Cmb.Cli 가 모르는 신규 intent 를 Python 이 처리).
   - 후속 체인: `run_nastran` → `nastran.exe <bdf> scr=yes old=no batch=no` (f06/op2/log) → `parse_f06` → `F06Parser.Console.exe <f06> --output-dir` (`_results.json` + `_SC*_*.csv`). F06 의 `*** USER/SYSTEM FATAL|ERROR` 는 `scan_f06_diagnostics` 가 별도 수집.

**런타임에 필요한 InHouse 프로그램 4종 (Cmb.Cli 1개가 아니다 — 모두 서버(145) 수동 반영 대상)**

| 경로 | 역할 |
|------|------|
| `InHouseProgram/HiTessModeBuilder/Cmb.Cli.exe` | 엔진 (build-full + apply-edit-intent **기본** 경로) |
| `InHouseProgram/NastranBridge/nastran_bridge.py` | deleteRigid 등 **미지원 intent 의 Python fallback** (편집 BDF 포맷 fix 가 사는 곳) |
| `InHouseProgram/F06Parser/F06Parser.Console.exe` | F06 → 결과 JSON(`_results.json`)/CSV 파서 |
| 외부 MSC `nastran.exe` (`C:\MSC.Software\MSC_Nastran\20131\bin`, `--nastran-path` override) | 해석기. InHouse 아님 — 서버에 **MSC 설치** 필요 |

**⚠️ 교정/함정 (이번 재검토에서 발견)**
- **nastran_bridge 폴더명 불일치(잠재 `FileNotFoundError`)**: `hitess_modelflow_service.py` 의 `_load_nastran_bridge_module()` 은 **오직 `InHouseProgram/NastranBridge`(camelCase) 하드코딩, 폴백 없음**. 반면 `analysis.py` 는 `InHouseProgram/Nastran_bridge`(**underscore**)를 1순위로 본다. → nastran_bridge.py 를 **underscore 폴더에만** 두면 modelflow 의 deleteRigid 폴백이 깨진다. **둘 다 만족하려면 `NastranBridge`(camelCase)에 둘 것**(또는 양쪽 복사). [이상적으론 modelflow service 도 analysis.py 처럼 다중 후보 탐색으로 통일 권장.]
- **편집 BDF 포맷 fix 의 적용 범위**: `nastran_bridge.py` 의 BDF 포맷 수정은 **fallback(deleteRigid) 경로에만** 효력. ModelBuilder 일반 편집의 기본 BDF writer 는 **C# `Cmb.Cli.exe`** 다. 깨진 BDF 가 Cmb.Cli 산출물이면 **C# 엔진 쪽도 같은 수정 필요**. (단 Mooring/SidePassage 스튜디오의 apply-edit 는 `analysis.py` 가 nastran_bridge 를 **기본 경로로** 직접 호출 → 그쪽 BDF 는 이 Python fix 로 완결.)

### Module Unit Studio — 배포 시 버전 핀 동기화 (★필수, 안 하면 스튜디오 안 뜸)

ModuleUnitStudio(viewer id=`module-unit-studio`, 연결 메뉴 = "Group & Module Unit 권상 구조 해석")를 배포할 때는 **zip 배포 + WorkBench 버전 핀 수정을 항상 세트로** 해야 한다. zip만 올리면 버전 불일치로 새 스튜디오가 뜨지 않는다.

- ⭐ **버전 정책 (사용자 지시, 무조건):** Module Unit 관련 코드를 수정하면 — **스튜디오(React) 뿐 아니라 엔진(`ModuleUnitAnalysis` → `InHouseProgram/GroupModuleAnalysis`) 등 어느 쪽을 고쳤든** — **항상 `module-unit-studio` 버전을 bump 해서 zip을 재배포하고, WorkBench의 `MODULE_STUDIO_VERSION`도 같은 버전으로 올린다.** 엔진에는 사용자 눈에 보이는 버전 표면이 없으므로, 스튜디오 버전을 이 기능 전체의 단일 릴리스 번호로 삼는다(엔진-only 수정이라 zip 내용이 동일해도 버전만 올려 재배포·재다운로드를 강제). 즉 "코드 수정 → 버전 bump → 배포 → WorkBench 핀 동기화"는 예외 없는 세트다.

- **버전 핀 위치:** `HiTessWorkBench/frontend/src/pages/analysis/GroupModuleUnitLiftingAnalysis.jsx` 상단 상수 `const MODULE_STUDIO_VERSION = '<버전>'` (약 line 21). 이 값이 이 페이지가 기대·설치하는 워크벤치 버전이자, 백엔드 manifest 미가용 시 fallback, UI 표시 버전(약 line 1000)이다.
- **배포 절차 (2스텝 세트):**
  1. `apps/module-unit-studio/package.json` 버전 bump → `npm run package` → `release/module-unit-studio-<ver>.zip`(+`.sha256`)을 **StudioProgram 2곳**(백엔드-로컬 `HiTessWorkBenchBackEnd/StudioProgram/` + UNC `\\storage.hpc.hd.com\...\StudioProgram`)에 복사.
  2. `GroupModuleUnitLiftingAnalysis.jsx`의 `MODULE_STUDIO_VERSION`을 **같은 버전**으로 수정.
- 버전 bump 전 StudioProgram 양쪽의 기존 최고 버전을 먼저 확인(충돌 시 앱이 재다운로드 안 함).
- 서버(145) 반영: StudioProgram zip 수동 복사 + (프론트 변경이므로) WorkBench 프론트 재배포 대상.

#### 화면 배율 대응 — 셸을 `transform: scale()` 로 키우지 말 것 (0.0.148, 2026-09-09)

0.0.147 에 "1920×1080 을 논리 작업면으로 고정하고 셸 전체를 균일 확대"하는 발표 모드
(`utils/resolutionFrame.js`)가 들어갔다가 **폐기**됐다. Chromium/Electron 이 Windows 디스플레이
배율을 이미 `devicePixelRatio` 에 반영하므로 **배율이 두 번 곱해진다**:

- 상단 리본(42px)·좌측 도크(301px) 같은 고정 치수까지 확대돼 4K 에서 메뉴가 비정상적으로 커진다.
- 스케일된 셸의 CSS 박스와 실제 뷰포트가 어긋나 정보 패널 좌표가 밀린다.
- 렌더 픽셀비가 `dpr × scale` 이 돼 캔버스 버퍼가 과도하게 커진다.

현재 규약: 셸은 `width/height: 100%` 유동 레이아웃 + 미디어쿼리(폭 ≤1100·≤820, 높이 ≤680)만 쓰고,
3D 는 `utils/renderPixelRatio.js` 의 `studioRenderPixelRatio(devicePixelRatio)` = `min(max(dpr,1),2)`
로 **GPU 상한만** 건다. WorkBench `electron/index.js` 는 메인·뷰어 창 모두 `zoomFactor: 1.0` +
`did-finish-load` 재고정으로 Electron 확대가 겹치지 않게 한다.
검증은 빌드 산출물을 Playwright 로 띄워 셸 박스 == 뷰포트, 리본 높이 42(높이 ≤680 이면 36),
캔버스 버퍼 == CSS 크기 × min(dpr,2) 를 4K/QHD/일반 창에서 실측한다(`docs/display-scaling-0.0.148.md`).
⚠ 4K 를 Windows 배율 100% 로 쓰면 UI 가 작게 보이는 건 **의도된 동작**이다(실사용은 통상 150~200%).

#### 화면 구성 = ModelBuilderStudio 와 같은 셸 (0.0.150, 2026-09-11)

사용자 요청으로 **ModelBuilderStudio 의 공통 구성을 그대로 들여왔다.** 두 Studio 를 같이 고칠 때는
셸 코드를 한쪽에서 고치고 다른 쪽에 옮기는 것이 기본이다(파일명·prop 이름을 일부러 같게 뒀다).
상세: `ModuleUnitStudio/docs/shell-alignment-and-auto-connect-0.0.150.md`

- **탭 6개** — Model │ Model Check │ Edit │ Hoist │ Analysis │ Save. (ModuleUnit 고유 = Hoist 탭 + 탭별 상태 점)
- **좌측 `components/shell/TabPanel.jsx`** — 4구역 고정(헤더+목적 한 줄+`?` 팝오버 / 상태 스트립 /
  아코디언 본문 / 고정 액션 푸터), 폭 300. `StatusLine`·`Accordion`·`HelpList`·`FooterNote` 동봉.
  기존 패널의 지역 `Section` 은 **호출부를 그대로 두고 `Accordion` 위임으로만 교체**했다(Sidebar·AnalyzePanel).
- **우측 `shell/RightDock.jsx`** — 표시/정보 2탭, 세로 레일 36px ↔ 펼침 280px, `Ctrl+B`.
  질량·COG·인스펙터는 `embedded` prop 으로 여기 들어간다(3D 위 floating 은 걷었다).
  ⚠ **카메라 프리셋·내비게이션 모드는 뷰포트 좌상단 툴바에 그대로 둔다** — 뷰포트별 조작이라 3D 옆에 있어야 하고,
  분할 뷰에서 "어느 뷰에 적용되나"가 흐려진다. 도크에는 전역 설정(표시 방식·3D 단면·선택만 보기)만.
- **하단 `shell/BottomDock.jsx`** — 구조 해석 결과 / 입력 감사 / 메시지 3탭, `Ctrl+J`·`Ctrl+Shift+J`(최대화).
  예전엔 결과 도크(position:fixed)와 변환 감사 도크가 **따로 쌓여** 화면 아래를 두 겹으로 먹었다.
  `BottomReviewDock.jsx` 는 삭제됐고 내용은 `dock/AuditTab.jsx` 로 옮겼다. '메시지' = `store/useErrorLogStore.js`.
- ⚠ **`utils/theme.js` 는 다크 전용이다.** 라이트/다크 토글은 가져오지 않았다(사용자 결정). `palette()` 는
  인자를 무시하고 항상 같은 값을 준다 — 이식 코드가 `palette(theme)` 로 호출해도 되게 한 호환 장치다.
  색의 원본은 여전히 `utils/tokens.js` 이고 theme.js 는 그것을 셸 이름으로 다시 묶은 것뿐이다.
- **멀티뷰포트가 되살아났다** — `2f6281f`(2026-06-23) 에서 지웠던 뷰 추가/삭제·카메라 동기화를 복구.
  ⚠ `hooks/useCameraSync.js` 는 **ModelBuilder 판**(직교용 `camera.zoom` 동기화 포함)을 써야 한다.
  ModuleUnit 카메라는 Orthographic 이라 position/quaternion/up/target 만 맞추면 **배율이 어긋난다.**

#### 독립 그룹 자동 연결 (Edit › 자동 연결, 0.0.150)

`data/groupAutoConnect.js`(+테스트 14건)를 ModelBuilderStudio 에서 **무수정 이식**했다 — 두 Studio 의
`StageData` 모양(nodeMap=원본 mm·propertyMap·finalGroups/groups·rigids·element.category/propertyId)이
같아서 그대로 통과한다. **한쪽을 고치면 다른 쪽도 같이 고칠 것.**

- 규칙: 요소 수 최대 그룹 = 주 구조. 소그룹의 **자유단(Free) 노드**를 반경(기본 450mm) 안 최근접
  **주 구조 Structure 부재 노드**에 RBE2(독립=주 구조, 종속=소그룹)로 잇는다.
  **배관(`category==='Pipe'`) 노드는 타깃 제외** — 배관에 묶으면 배관이 하중을 받는다.
- ⚠ **커밋 직전에 종속 중복을 다시 본다**(`useEditStore.applyGroupConnectProposals` → `collectDependentNodes`).
  후보 계산 이후 수동 RBE 가 생겼을 수 있고, 한 노드가 두 RBE2 의 종속이면 Nastran **FATAL 2101** 이다.
  한 번의 적용은 같은 `batchId` 라 Ctrl+Z 로 통째로 되돌아간다.
- ⚠ ModuleUnit 에는 ModelBuilder 의 `groupPreview`(적용 즉시 그룹 병합 표시)가 **없다.** 적용 결과 문구로
  "실제 반영은 Hoist 탭 자세안정성 평가 실행 시점"을 알린다(적용된 RBE 는 `AddRigidPreview` 노란 점선으로 보인다).
- 실측(주 구조 3,657 요소 + 소그룹 80/78/48/14/1): 후보 8건, 거리 190~211mm, 타깃 L·Rod.
  건너뜀 = 반경 밖 10 · 이미 RBE 20 · 소그룹 내부 노드 161.

#### 가서포트 단면 3종 + 가서포트 CSV 내보내기 (Edit › 가서포트, 0.0.151)

상세: `ModuleUnitStudio/docs/support-sections-and-csv-0.0.151.md`

- **단면 카탈로그는 `data/supportSections.js` 한 곳** — `ANG_100x100x10`(기본) · `ANG_100x100x13` ·
  `ANG_130x130x12`. 사내 구조 CSV 의 `size` 열에 실재하는 규격만 연다. **임의 치수 입력을 열지 말 것** —
  CSV 로 되돌렸을 때 ModelBuilder 의 `ANG_<w>x<h>x<t>` 파서를 통과해야 한다.
- **dims 규약**: `FeModelBuilder.NormalizeDims` 가 L 의 3개 dims 를 `[d0,d1,d2,d2]` 로 늘리므로
  PBEAML L = [수평다리, 수직다리, tw, tf](두 두께 동일). `computeCrossSectionAreaMm2('L')`·`makeSection('L')`
  과 같은 순서다.
- 단면은 **설치 시점 값이 intent(`params.sectionId`+`dims`)에 박힌다.** 도중에 바꿔도 기존 부재는
  그대로라 한 모델에 규격을 섞을 수 있다. `sectionId` 가 없는 0.0.150 이전 intent 는
  `resolveSupportSection()` 이 dims → 기본값 순으로 해석한다(구 JSON 호환).
- ⚠ `applyEditedModel` 은 **규격별 PBEAML 을 1장만** 만들고 같은 규격끼리 PID 를 공유한다.
- ⚠ `three/SupportBeamPreview.buildSupportBeam3D` 의 반환형이 **InstancedMesh → Group** 으로 바뀌었다
  (치수별 InstancedMesh). InstancedMesh 는 geometry 가 하나뿐이라 한 덩어리로 묶으면 굵기가 다른
  앵글이 같은 굵기로 보인다. 그 Group 에는 **중심선도 함께** 들어간다 — 솔리드만 두면 100mm 앵글이
  주위 부재에 가려져 "3D 단면으로 바꾸면 사라진다"(0.0.153 수정). 선의 투명도를 낮추거나 솔리드를
  `depthTest:false` 로 만들지 말 것.
- ⚠ **가서포트 CSV 는 항상 저장 위치를 묻는다**(`saveTextFile(..., { askLocation: true })`, 0.0.153).
  사용자가 CAD 로 가져가는 산출물이라 모델 폴더 무단 저장 금지 — 편집 의도 JSON(폴더 직접 쓰기)과
  정책이 다르다. Electron 뷰어는 `file://` 이라 showSaveFilePicker 가 막힐 수 있는데, blob 다운로드가
  `will-download` 를 발화시켜 OS 저장 대화상자를 띄운다(실측). 저장 대화상자는 사용자 제스처가
  필요하므로 호출 직전에 `await` 를 끼우지 말 것.
- **CSV 내보내기** = `useEditStore.exportSupportCsv()` → `data/supportCsv.js`. 기준 구현은
  HiTessCloud `PythonModule/BdfToCsv.py`, 기준 출력은 `ModuleUnit/BDFtoCSV/3370_M04_csv.csv`.
  열은 ModelBuilder `Cmb.Io.Csv.StructureCsv` 와 1:1, CRLF + 마지막 줄 개행(pandas 동일).
  **BDF 를 거치지 않는다** — intent 에서 바로 만들어 구조 해석 전에도 뽑힌다.
  - ⚠ `name`(` =30137/384565`)·`stru`(`0.0308360511306552`)는 BdfToCsv.py 가 박아 둔 예시 CAD 참조라
    그대로 상수로 쓴다. 엔진은 `stru` 를 읽지 않고(`StructureCsv.ParentStru` 상수만 존재) `name` 은 라벨뿐.
  - ⚠ `ori` 는 국부축 **기준 벡터**(엔진이 직교화)라 축 단위벡터를 쓰되 **수직 부재(|dz|>0.9)에서는
    [1,0,0]** 으로 갈아탄다 — `0 0 1` 고정이면 축과 평행해 퇴화한다.
  - 저장 경로는 편집 의도 JSON 과 같은 `saveTextFile()` 3단 폴백(폴더 → 파일 선택 → 다운로드).
- **가서포트 PBEAML 의 PID 는 기존 최대값+1 을 유지한다** (2026-09-17 사용자 결정). 레거시
  `BdfToCsv.py` 의 매직넘버 **PID 1000** 을 예약하지 않는다 — 기존 모델이 이미 그 번호를 쓰고
  있을 수 있고(실제로 `3370_M04.bdf` 의 1000 번이 그 모델의 가서포트다), 단면 3종이라 가서포트
  PBEAML 이 최대 3장이라 단일 번호로는 담기지도 않는다. 가서포트 식별은 요소의
  `remark: '가서포트'` 로 한다.
  ⚠ 그래서 **스튜디오가 낸 BDF 를 레거시 `BdfToCsv.py` 에 넣으면 가서포트를 못 찾는다.**
  그 경로 대신 스튜디오의 "가서포트 CSV 내보내기" 를 쓸 것.

#### 권상 위치 자동 선정 — 핵심 동작·함정 (2026-07-01 세션, ★ 넓은 면적/PASS 관련)

- **Z 밴드(tolMm) 이중 용도 분리**: `hoistToleranceMm`(UI "가상판 ±값")는 **수동 선택 강조용**일 뿐인데, 과거엔 이 좁은 값(모델높이×0.004 ≈ 10mm)이 **엔진 자동 최적화의 Z 클러스터링 tol** 로도 재사용돼 같은 데크의 근소 Z편차 노드가 서로 다른 레벨로 쪼개져 **좁고 작은 그룹만** 나왔다. → `useEditStore.js zoneSelectHoistPositions`는 이제 auto 시 **`tolMm: null`** 을 보내고(사용자가 명시하면 그 값 존중), 엔진(`HoistPositionOptimizer.RunRegionsSearch`)이 **Z 밴드 스윕**(`BuildZBandSweep` = {60,120,200,300}mm)을 돌려 **축적된 후보 중 랭킹으로 '가장 넓은 PASS'** 를 고른다. (payload 직렬화 시 `Number(null)===0` 함정 주의 — `opt.tolMm != null` 가드 필수.)
- **면적 vs 상태(비단조)**: 밴드를 넓힐수록 면적↑ 이지만 **너무 넓으면 `wireConflictCount`(와이어 간섭)↑ → warn**(stage6 안정성 margin 은 오히려 동일). 실측(3496-35210-A508372): tol 10mm→3.07㎡ pass, 100→12.78 pass, 200→**16.84㎡ pass**, 350→2.38(붕괴), 500→23.72㎡ **warn(간섭29)**. 단일 고정 밴드는 keep-K/greedy 클러스터 경계 때문에 **비단조**라 스윕으로 회피. 스윕은 **조기 종료 없음**(모든 밴드 시도 후 랭킹) — 백엔드 `--optimize` 타임아웃 **300s** 이내(실측 ~15s).
- **2D 방향 = 앱 3D '평면도(A키)' 와 동일**: 앱 평면도는 `camera.up=+X`·−Z 내려봄 → 화면 **↑X(종)·←Y(횡)**. 썸네일(`HoistCandidateThumbnail` + `planViewProjector`)과 구역 미니맵(`buildZonePartitionView`) 모두 이 방향으로 통일(과거 ↑Y·→X 라 3D와 90° 어긋나 "대칭"처럼 보였음). 형상 지표(면적/정사각형도/축편차)는 화면방향과 무관한 모델좌표 계산이라 불변.

#### 'Strict 평가' 토글 — 형상 FAIL 완화 (2026-07-27 세션, 0.0.121)

Hoist 좌측 도크 패널 상단의 토글. **기본 OFF(= 완화)** 이며 `localStorage('mu.hoist.strictEvaluation.v1')` 로 세션 간 유지된다.

- **완화 O — Stage 1(형상 분류) · Stage 2(Z단차·convex·평면도·Trolley 단변·삼각형 내각) → `fail` 대신 `warn`.**
- **완화 X — Stage 3(`wireLengthMm ≤ 0`) · Stage 6(전도) 는 항상 `fail`.** 전자는 정점 자체를 못 만들고, 후자는 모듈이 실제로 넘어지는 위험이라 성격이 다르다(사용자 결정).
- 전달 경로: 스튜디오 `buildPostureStabilityPayload` → `_posture.json` 최상위 `strictEvaluation` → `Stage0_InputParser` → `StabilityContext.RelaxShapeGate` → Stage 1·2 판정 + `GroupShapeValidator.IsComboAcceptable(relaxShape)`. `WithGroups` 전파 필수(빠지면 후보를 strict 로 재평가해 전부 fail).
- ⚠️ **옵티마이저 게이트도 반드시 같이 열어야 한다.** `GroupShapeValidator` 는 평가 *이전에* 조합을 버리므로, 여기를 안 열면 스튜디오에서 완화해도 **고를 후보 자체가 생성되지 않는다.** 단 4점 왜곡 게이트(`ExtremeMinInteriorDeg`/squareness/`ExceedsQuadDistortionLimits`)는 형상 판정이 아니라 추천 품질 필터라 **완화하지 않는다**(열면 후보 폭증).
- ⚠️ **완화 표식을 Stage 0 `warningNotes` 에 넣지 말 것.** Stage 0 이 warn 이 되면 형상이 멀쩡한 후보까지 `overall=warn` 이 되어 옵티마이저의 **PASS/WARN 랭킹 계층이 무너진다.** 대신 상태를 바꾸지 않는 `summary` 에만 기록한다 — Stage 0 `strictEvaluation`, Stage 1·2 `shapeGateRelaxed`(실제 강등이 일어났을 때만 true).
- **단위 구조해석 게이트는 손대지 않았다.** `useUnitStructuralRunner.js` 의 `stabilityOk = pass || warn` 이 그대로라, Stage 1·2 가 warn 으로 내려오면 자동으로 열리고 전도 fail 은 계속 막힌다.
- 실측 검증(A505080 골든 모델, 배포 exe): 정점편차 1mm·Z단차 6868mm 4점 조합 → **Strict ON** stage2=fail·overall=fail(진행 불가) / **Strict OFF** stage2=warn·stage6=pass·overall=warn(**진행 가능**, apex/wire 산출). 전도가 실패하는 조합은 OFF 여도 overall=fail 로 막힘.
- 추적성: 화면 상시 경고 배너(`StrictEvaluationControl`) + `_posture.json` 플래그 + 단위 구조해석 준비 문구(`isShapeGateRelaxed(report)`). 토글을 바꾸면 이전 엄격도로 평가된 결과를 `useStabilityStore.reset()` 으로 무효화한다.

#### Unit 권상 구조 검토 보고서 (2026-09-08 전면 재구성)

`POST /api/analysis/unit-structural/report` (payload = `{analysisId, options}`) → `app/services/unit_lifting_report/` 패키지가 **결과 폴더 JSON 만으로** 다장(多章) xlsx 를 메모리에서 만든다. 표지·요약·목차·1~6장·부록 A/B/C + 데이터 시트 3개(`Members`/`Displacements`/`Wires`).

- **패키지 4모듈**: `collector.py`(JSON 7종 → `ReportData` dataclass) · `figures.py`(matplotlib 2D 도면 → PNG bytes) · `sheet.py`(openpyxl 레이아웃 프리미티브·두 패스 목차) · `builder.py`(장 조립). `unit_lifting_report_service.py` 는 위임 껍데기(라우터 import 경로 보존).
- ⚠️ **그림은 백엔드가 그린다 — Studio 3D 캡처를 쓰지 않는다.** 사용자 결정(Mooring 과 같은 철학). 그래서 Studio 가 안 떠 있어도, 서버에서도 재생성된다. codex 가 만들었던 캡처 경로(`ThreeViewport.captureReportViews`, `LiftingArrangementReport.js`, `DisplacementResultOverlay.js`, store `reportCapture`)는 **전부 삭제**했다.
- **3D 캡처(`solid3d.py` + `figures3d.py`, 2026-09-08 재구축)** — 결과 레포트(사내 서식) 캡처 4~6장과 상세 레포트의 `*_iso` 그림이 같은 코드다. 부재는 PBEAML 단면 치수대로 세운 각기둥, 와이어·COG(◆) 도 **솔리드**로 만들어 같은 `Poly3DCollection` 에 넣는다(scatter/line 은 깊이 정렬에 끼지 못해 부재에 가려지거나 항상 앞에 뜬다). 라벨(`G1·N34 77.9°`, `HOOK G1`, `COG`)·지지 다각형·좌표축은 3D→픽셀로 투영해 **2D 로 맨 위에** 그리고, 겹침 회피는 `figures.place_label` 을 그대로 쓴다.
  - ⚠️ **`Axes3D` 는 지정 영역 안에서 항상 정사각형으로 줄어든다**(`apply_aspect`). 가로로 넓은 자리를 채우려면 `render()` 처럼 축을 가시 영역보다 큰 정사각형으로 놓고 가시 영역 기준으로 zoom 을 '그려 보고 재서' 맞춰야 한다. `ax.set_position` 만 넓혀서는 절반밖에 안 쓴다(과거 증상: 모델이 슬롯의 45%).
  - ⚠️ 서식의 캡처 자리는 `TwoCellAnchor` 라 그림을 **자리 비율(1243:719)로 늘린다.** `fit_aspect()` 로 흰 여백을 덧대 비율을 먼저 맞춰야 왜곡이 없다(`test_result_figures_match_template_slot_ratio`).
  - 권상 배치 그림의 **와이어는 3D 솔리드에 더해 2D 중심선(`overlays`, `avoid=True`)을 겹쳐 그린다.** 평면도에서는 와이어가 거의 수직이라 솔리드가 눌려 흐릿해지기 때문이다. `avoid` 는 그 선을 따라 점유 상자를 깔아 **라벨이 권상 선을 덮지 못하게** 한다(사용자 요청: 선을 진하게, 라벨은 비켜서).
  - **라벨에 슬링각을 넣지 않는다**(사용자 요청 — 도면이 난잡해진다). 최소 슬링각은 부제에, 그룹별 전량은 상세 레포트 표 11 에 있다. 상세 레포트의 2D 평면도(`figures.py`)는 여백이 넉넉해 각도를 그대로 둔다.
  - 결과 그림(변위·응력·가서포트)의 와이어는 `clip_z` 로 모델 상단+12% 에서 잘라 훅을 생략한다 — 훅 정점(모델 위 수 m)까지 그리면 모델이 작아진다. 권상 배치 그림만 훅까지 그린다.
  - **배관은 둥근 기둥 + 붉은색**(2026-09-08 사용자 요청). ① 모양 — `section_profile()` 이 TUBE·ROD 를 `round=True` 로 돌려 `_tube()`(정8각기둥)로 세운다. ② ⚠ **TUBE·ROD 의 DIM1 은 반지름이라 지름 = 2·DIM1**(Studio `computeCrossSectionAreaMm2` 와 같은 규약, Hypermesh 질량 99% 일치로 검증). 과거엔 DIM1 을 지름으로 써서 배관을 **실제의 절반 굵기**로 그렸다. ③ 색 — `_pipe_colors()` 가 **PID ≥ 101**(`PIPE_PID_MIN`, ModelBuilder 의 배관 property 대역. 실제 모델은 1000번대이고 요소 `category=='Pipe'` 와 정확히 일치)만 붉은색으로 칠하고 구조·가서포트는 강재색(회색)으로 남긴다. **변위·응력 그림에는 적용하지 않는다** — 거기선 요소 색이 곧 해석 결과다(사용자 결정).
  - ⚡ **배치를 잡는 draw 동안 `Poly3DCollection` 을 숨긴다**(`render()` 의 `coll.set_visible(False)` → savefig 직전 True). 줌 맞춤 반복·범례/좌표축 계산에 쓰는 `fig.canvas.draw()` 는 투영 행렬만 필요한데, 3만 면을 매번 깊이 정렬해 그리고 있었다. 그림 1장 3.3s → 1.4s, 결과 레포트 14.4s → 6.2s, 상세 17.5s → 9.1s (출력 PNG 는 바이트까지 동일).
  - ⚠️ 마구리 면은 끄고(`TUBE_CAPS = False`) 옆면 8장만 그린다. 배관끼리 이어져 끝이 거의 안 보이는데 면 수가 3배(1장 렌더 3.4s → 6.7s)가 된다.
  - **체결 위치는 가득 찬 원(●), 훅은 빈 원(○)** — 2D 도면(`figures.py`)과 같은 기호다(사용자 요청, `Figure/1.png`·`2.png`). 솔리드 큐브·다이아는 평면도에서 부재에 묻혀 서로 구분이 안 됐다. `_Rig.meshes(solid_markers=False)` + `_Rig.points2d()` → `render(points2d=...)` 가 투영해 **2D 로 맨 위에** 찍고, 그 자리를 점유로 등록해 라벨이 마커를 덮지 않게 한다.
  - **결과 레포트 Hook/Trolley 표도 같은 표기**를 쓴다(`result_report._fill_hook_table`): 1열 = `G1`·`G2`·`G3`, 2열 = `G1-N34`·`G1-N2873`… (그룹+러그 절점). 그림 라벨(`G1·N34`)과 글자가 같아야 표의 한 줄이 그림의 어느 와이어인지 찾을 수 있다. 와이어가 없는 행은 2열을 비운다.
- **바닥글 '문의' 줄 = 보고서를 만든 WorkBench 로그인 사용자**(2026-09-08). 라우터가 `models.User` 에서 이름·직급(`position`)·부서를 읽어 `generator={name, position, department}` 로 넘기고, `collector.format_contact()` 가 `권혁민/책임연구원/구조시스템연구실` 로 조립한다(빠진 항목은 건너뛰고, 전부 없으면 사번). 표지 입력 폼의 '작성자/부서' 와는 **별개** — 폼에는 직급이 없다.
  - 결과 레포트는 페이지 바닥글이 `본 보고서는 Hi-TESS WorkBench를 통해 자동 생성되었습니다.
문의 | …   생성일 …` 두 줄.
  - ⚠️ 상세 레포트는 **표지의 '문의' 줄에만** 넣는다. 페이지 바닥글(`sheet._close_page`)은 8열(≈36자) 한 줄이 한계라 문의처를 붙이면 **줄바꿈되어 페이지 프레임 밖으로 새어 나온다**(실측).
#### 보고서 PDF 출력 — 서버 Excel 로 인쇄해 변환 (2026-09-17)

보고서는 여전히 **openpyxl 이 메모리에서 만든 xlsx 가 원본**이고, PDF 는 그 xlsx 를 서버의 MS Excel 로
열어 인쇄한 결과다(`app/services/xlsx_to_pdf.py`). 라우터 payload 에 `format: "pdf" | "xlsx"` 가 붙었고
**기본은 xlsx**(구 클라이언트 호환), 화면의 기본 선택은 **PDF** 다. 실측: 결과 2p·상세 21p, A4 세로,
한글 폰트 임베드, 프레임·그림·컬러바 그대로. 소요는 xlsx 생성 위에 **결과 +4s · 상세 +12s**(Excel 기동 2.6s 포함).

- 서식을 새로 그리지 않고 Excel 인쇄를 쓰는 이유: 이 보고서는 이미 `fitToPage=False + scale=100 +
  수동 페이지 나누기`로 **인쇄를 확정**해 둔 레이아웃이라(위 '고정 페이지 틀'), Excel 이 찍는 페이지가
  곧 설계한 프레임이다. reportlab 등으로 다시 그리는 건 `sheet.py` 전면 재작성이다.
- ⚠ **`Worksheets("Report")` 만 내보낸다.** 워크북째 `ExportAsFixedFormat` 하면 상세 레포트의
  데이터 시트(`Members`/`Displacements`/`Wires`)까지 인쇄돼 21p 가 **29p** 로 나온다(프레임 바닥글의
  "Page n / 21" 과 어긋남).
- ⚠ **회사 DRM 때문에 PDF 되읽기를 변환 함수 안에서 끝내야 한다.** 디스크에 쓴 파일은 `HHIDRMC`+4096B 로
  감싸지고 **평범한 python 프로세스는 암호문을 읽는다**. 그런데 **Excel COM 인스턴스를 띄운 프로세스**는
  DRM 훅이 붙어 `read()` 가 평문을 준다(실측 stat 466,080 / read 461,984 = `%PDF-1.7`). 경로만 밖으로
  넘기면 호출자가 암호문을 읽는다. 안전장치로 `%PDF` 매직을 확인하고 아니면 예외를 던진다.
- ⚠ Excel 은 동시 실행에 안전하지 않다 — 모듈 락으로 직렬화하고 인스턴스는 **호출마다 띄우고 닫는다**
  (상주시키면 대화상자 하나에 영구히 멈춘다). Excel 이 없으면 깨진 파일 대신 **503 + 사유**가 나간다.
- ⚠ **Excel 확장자 규칙**: `ExportAsFixedFormat` 는 대상이 `.pdf` 가 아니면 **아무 파일도 쓰지 않는다**
  (실측 `.pdfdata`/`.dat` 는 조용히 실패). DRM 회피용으로 확장자를 바꾸는 우회는 여기선 못 쓴다.
- `sheet.py` 는 openpyxl 기본 바닥글(`Page &P / &N`)을 **비운다** — 프레임 안에 자체 쪽번호가 있어
  PDF 에서 두 겹이 된다. 단 **결과 레포트는 사내 서식 템플릿(.bin)이 그 바닥글을 갖고 있어 그대로 둔다**
  (우리 레이아웃이 아니라 회사 서식이다).
- 진입점 양쪽 모두 형식 선택이 있다(PDF 기본): Studio `UnitStructuralReportDialog` ·
  WorkBench `UnitLiftingReportDialog`. 두 파일은 같은 선택지를 사본으로 갖는다 — **한쪽 고치면 양쪽 다.**
  서버 응답 헤더에 `X-Report-Format` 이 실린다.
- ⚠ **결과 레포트 그림은 절대 크기(OneCellAnchor + ext)로 붙인다** — `result_report._absolute_anchor`.
  서식의 캡처 자리는 TwoCellAnchor 인데, 이 서식은 1.71자짜리 좁은 열 56개라 Excel **인쇄** 엔진이 열 폭을
  화면(정수 px)과 다르게(소수 px) 계산해 셀 박스가 ~8% 넓어지고, 거기 늘려 붙은 3D 그림이 PDF 에서 옆으로
  **11% 늘어났다**(실측 1.731 → 1.932; 원본 서식도 동일). Zoom/맞춤 등 페이지 설정으로는 안 바뀐다(실측).
  셀 박스 px 는 Excel 규칙(열 `int((256w+int(128/7))/256·7)`, 행 `pt·96/72`)으로 계산하고, 그림은 그 안에
  비율을 지켜 가운데 놓는다. 1페이지 로고도 같은 이유로 함께 고정했다(1.10배 늘어났었다).
  표·박스 자체는 여전히 인쇄에서 ~8% 넓다 — 셀 폭은 우리가 못 고친다(Excel 반올림).
- ⚠ **상세 레포트는 다른 원인으로 같은 증상이 있었다** — `sheet.figure()` 가 `FIG_W×FIG_H`(640×410, 1.56)를
  표시 크기로 그대로 써서 3D 그림(1.73)·2D 도면(1.44)이 **xlsx 에서부터 ±10%** 눌려 있었다(인쇄 무관).
  이제 그 값은 **최대 상자**이고 그림은 항상 PNG 원본 비율이다(3D 640×369 · 2D 590×410). 21p 그대로.
- 서식 글자는 `_fit_form_text` 가 **shrinkToFit** 을 켠다(제목 O·HULL·UNIT·권상방식·부서 AS·주의사항 F행).
  주의사항 셋째 줄이 12pt 로는 박스를 넘쳐 테두리를 덮고 인쇄 영역 끝에서 잘렸다 → 10.8pt 로 줄어 들어간다.
  넘치지 않는 칸은 그대로다. 인쇄는 `_print_setup` 이 좌우 가운데 + 여백 L 0.22in/R 0.56in — 서식 왼쪽에
  빈 여백 열(A~C ≈ 23pt)이 있어 인쇄 영역을 그냥 가운데 맞추면 보이는 내용이 오른쪽으로 12pt 치우친다.
- **가서포트 배치 그림에서만 배관을 반투명(α 0.22)** 으로 누른다(사용자 요청, 2026-09-17) —
  `figures3d.PIPE_ALPHA_SUPPORT`, `solid3d.face_colors(alpha_per_element=…)` 가 (N,4) RGBA 를 돌려주고
  `render()` 는 모서리에도 같은 α 를 준다. 8각 기둥은 앞·뒷면이 겹쳐 체감 α 는 약 1.8배. 권상 배치·변위·응력
  그림은 그대로 불투명(RGB). 범례는 좁아서 '배관 (반투명)' 짧은 라벨을 쓴다('PID ≥ 101 · 반투명' 은 잘린다).
  테스트: `tests/test_unit_lifting_report_pdf_layout.py`.

- ⚠ **페이지 외곽선이 끊겨 보이던 원인은 두 보고서가 서로 달랐다** (사용자 신고·수정 2026-09-17).
  둘 다 `tests/test_unit_lifting_report_pdf_layout.py` 가 잡는다.
  - **상세 레포트 — 그림이 외곽선을 덮었다.** `sheet.py` 가 그림·로고를 문자열 앵커(`"A5"`)로 붙이면
    왼쪽 끝이 인쇄 원점(왼쪽 여백 0.4in = 28.8pt)과 **정확히 같아진다.** 그런데 A열의 왼쪽 medium
    테두리는 눈금선을 걸치고 그려져 28.32~30.24pt 를 차지하므로, 그림의 흰 배경이 그 선의 안쪽
    3/4 을 덮는다 → **그림이 있는 페이지에서만** 세로 외곽선이 토막난다(실측 21쪽 중 5·6·9·10·14·16·17쪽).
    이제 `ReportSheet._place()` 가 `OneCellAnchor` 로 `FRAME_CLEAR_PX`(3px) 만큼 안으로 밀어 붙인다.
    문자열 앵커를 다시 쓰지 말 것. 그림 폭은 여유(오른쪽 ~50pt)가 있어 밀어도 잘리지 않는다.
  - **결과 레포트 — 서식의 외곽선이 hairline 이었다.** 좌우 외곽선은 D열 오른쪽·BC열 왼쪽에
    있는데 머리글 블록(3~4행)만 thin(0.96pt)이고 나머지는 **hair(0.12pt)** 라, 한 선의 굵기가
    페이지 중간에서 8배 바뀌고 PDF 뷰어 배율에 따라 사라졌다 나타난다. `_solid_frame()` 이 hair 를
    thin 으로 올린다. ⚠ 같은 선이 **열 스타일**(`column_dimensions['D'].border`)과 **셀 테두리**
    (23~43행 등)에 나뉘어 있어 둘 다 봐야 한다 — 열 스타일은 openpyxl 의 셀 테두리 조회에 안 잡히고
    (Excel COM 으로만 보인다), 셀 테두리는 열 스타일을 덮는다. 한쪽만 고치면 가운데 토막만 남는다.

- **Studio 보고서 버튼은 전체 화면 안내막을 띄운다**(`ReportProgressOverlay.jsx`, 0.0.138~). 백엔드가 3D 그림을 그리는 동안 화면이 멀쩡해 보이면 사용자가 버튼을 다시 누른다. 예상 시간(결과 25s·상세 35s — dev PC 실측은 6.2s/9.1s 이고 서버·전송·저장을 감안한 값)과 경과를 보여 주고 `zIndex 4000` 으로 조작을 막는다. 진행률은 서버 값이 아니라 예상 대비 경과라 **95% 에서 멈추고** 초과 시 '마무리 중' 으로 바꾼다. WorkBench 쪽 버튼(`UnitLiftingReportDialog`)은 기존대로 제출 버튼 스피너만 쓴다.
- ⚠️ **신규 의존성 `matplotlib==3.10.7`** (`requirements.txt`). 서버(145)는 `git pull` 후 **1회 `pip install -r requirements.txt`** 필요. 한글 폰트는 `Malgun Gothic`.
- ⚠️ **절 제목 문자열은 `builder.toc_entries()` 와 `_write()` 가 글자 단위로 같아야** 목차 쪽번호가 채워진다(다르면 그 절이 0쪽으로 나옴). `tests/test_unit_lifting_report_builder.py::test_toc_pages_monotonic` 이 잡는다.
- **고정 페이지 틀** — 원본 사내 서식처럼 한 페이지가 (머리글 3행 + HULL/UNIT/권상방식 1행 + 본문 50행 + 바닥글 2행) = **57행 프레임**이고 외곽선·머리글·바닥글이 페이지마다 반복된다. `sheet.ReportSheet` 가 `_open_page`/`_close_page`/`_ensure(rows)` 로 관리하며, **모든 행 높이가 ROW_PT(13.5pt)로 같아야** '행 수 = 세로 공간' 이 성립한다(여러 줄 텍스트는 행 세로 병합).
- ⚠️ **인쇄 설정 3가지가 서로 맞물린다. 하나만 바꾸면 레이아웃이 깨진다.**
  1. `fitToPage` 를 켜면 Excel 이 **수동 페이지 나누기를 무시**해 프레임 2개가 한 장에 겹친다 → `ps.scale = 100` 고정.
  2. `ROW_PT` 는 픽셀에 정확히 떨어지는 값이어야 한다(13.5pt = 18px). 14pt 는 18.67px → 19px 로 반올림돼 프레임이 예상보다 높아지고 페이지가 쪼개진다.
  3. 프레임 높이(769.5pt)와 인쇄 높이(여백 0.42 → 781pt) 사이 여유에 **다음 페이지 첫 행이 비친다**. 그래서 로고는 프레임 첫 행이 아니라 **둘째 행에 앵커**한다.
- 그림은 폭 640px 고정(12열 ≈ 660px 을 넘으면 컬러바가 테두리를 뚫는다). 남은 공간이 부족하면 비율을 유지해 축소하고, `FIG_MIN_ROWS`(20행)보다도 좁으면 다음 페이지로 넘긴다. 표는 페이지를 넘어가면 머리행을 다시 그린다.
- 표 셀은 `wrap=False` 라 열 폭을 넘으면 **잘린다**. 긴 문자열(자세안정성 단계 요약 등)은 `collector._stage_metric` 에서 짧게 만들고 열 폭(`widths`, 합계 ≤ 12)을 함께 조정할 것.
- **진입점 2곳**: Studio `UnitStructuralReportButton`(→ `UnitStructuralReportDialog`) · WorkBench `ResultArtifactsCard` 의 "검토 보고서" 버튼(→ `UnitLiftingReportDialog`). 후자는 artifacts 응답의 **`unitStructuralAnalysisId`** 로 대상 해석을 찾는다(`GET /api/analysis/groupmoduleunit/{parent_id}/artifacts`).
- **입력 옵션 키**(백엔드 `ReportOptions.from_payload` 와 1:1): `hullNo, unitNo, drawingNo, revision, author, department, jigLimitTon`(기본 6.2) `, yieldStrengthMpa`(기본 275) `, notes, extraNotice`. 폼 로직은 `frontend/src/utils/unitLiftingReport.js` 와 Studio `src/utils/unitLiftingReportForm.js` 에 **같은 내용의 사본**으로 있다(저장소가 달라서) — 한쪽 고치면 양쪽 다.
- **판정**: σ허용 = σy × 0.8(결과 JSON 의 `structuralAllowableMPa` 우선), 활용도 > 1.0 이면 NG · 와이어 장력 > 지그 기준이면 "지그 필요" · **변위는 참고치(판정 없음)** · 자세안정성은 엔진 overall 그대로.
- 필수 JSON 은 `nastranResultJson`·`stabilityJson` 둘뿐. 나머지(posture·hoist_optimization·validation·edited·원본 json·f06)는 없으면 해당 절을 "자료 없음"으로 쓰고 경고에 남긴다 — **과거 결과에도 보고서가 나온다.** 그림 렌더 실패도 그 그림만 자리표시로 대체.
- 테스트: `tests/test_unit_lifting_report_{collector,figures,sheet,builder,service,route}.py` + `test_groupmoduleunit_artifacts_unit_id.py`. fixture 는 실측 결과를 축소한 `tests/fixtures/unit_lifting_report/`(`build_fixture.py` 로 재생성).

#### 결과 레포트 '주의 사항' 5줄 — 서식 1페이지를 재배치했다 (2026-09-17, 0.0.154)

사내 표준 서식의 주의 사항은 원래 3줄(`F7`·`F8`·`F9`, F~BA 병합)이었다. 여기에 고정 문구 1줄과
**사용자가 모달에 직접 적는 1줄**을 더해 5줄(`F7`~`F11`)로 만들었다.

- 문구 4행은 `result_report.NOTICE_ADDED_LINE` 상수다. **1~3행은 서식이 갖고 있는 문구라 코드에
  없다** — 그 세 줄을 고치려면 서식(.bin)을 고쳐야 하고, 4행은 여기만 고치면 된다.
- 5행은 `extraNotice` 옵션. **비면 그 행을 `hidden` 처리하고 박스 아랫변을 4행으로 올린다**
  (`_move_bottom_border`) — 빈 줄을 남기면 서식에 한 줄이 뚫린 것처럼 보인다(사용자 결정).
  글자 수 상한 **36자**(`collector.EXTRA_NOTICE_MAX_CHARS` = 프런트 `EXTRA_NOTICE_MAX`): 서식의
  F~BA 박스가 576px 이고 12pt 한글이 정확히 36자 들어간다. 넘으면 `_fit_form_text` 의 shrinkToFit
  이 글자를 줄여 다른 줄보다 작아 보인다. 프런트 `maxLength` 를 붙여넣기로 우회해도 백엔드가 자른다.
- ⚠ **서식(.bin) 1페이지를 실제로 재배치했다.** 행 수(1~54)와 페이지 나누기(54·108)는 그대로지만
  안쪽 배치가 바뀌었다 — 주의 사항 7~11행(높이 20.1 → **18.0pt**), 요약표 11~13행 → **13~15행**,
  각주 14 → 16행, 3D 그림 두 장은 16~33·34~51행 → **17~33·34~50행**(크기 17행 그대로, 각주 아래와
  두 그림 사이의 빈 행을 하나씩 내줬다). 그래서 `_fill_summary` 의 셀 좌표와 서식 수식
  (`V15=N15*0.8`, `AT15=IF(AL15<=V15…)`)·조건부 서식(`AT15:BA15`)도 같이 옮겼다.
  - 1페이지 높이 여유는 20pt 뿐이다(759.95 → **762.65pt**, 97% 배율 기준 상한 780pt). 주의 사항
    행 높이를 원래 20.1pt 로 두면 넘쳐서 페이지가 쪼개진다 — **18.0pt(24px)로 줄인 이유가 이것이다.**
  - ⚠ **바닥글 위 빈 행(51)을 없애지 말 것.** Excel 인쇄 엔진은 그림을 계산상 자리보다 ~9px 아래에
    찍어서, 등각 그림을 51행까지 끌어내리면 **바닥글 첫 줄이 그림 흰 배경에 덮인다**(실측).
  - 사내 서식이 새 버전으로 배포되면 이 재배치를 처음부터 다시 해야 한다. 재배치 스크립트는
    세션 스크래치패드에만 있으므로, 서식 갱신 시에는 위 좌표표를 보고 다시 만들 것.
- 검증: `tests/test_unit_lifting_result_report.py` 의 `test_notice_*` 2건 + PDF 실측(입력 있음/없음/
  36자 꽉참 세 경우 모두 **2쪽**, 박스가 닫히고 바닥글이 가려지지 않음).

### Mooring Fitting Assessment — 3개 구성요소(엔진 / exe배포본 / 스튜디오)와 배포 흐름 ★작업 전 필독

Mooring Fitting Assessment(연결 메뉴 = "Mooring Fitting Assessment", viewer id=`mooring-fitting-studio`)는 **별개의 세 위치**로 구성된다. 어느 쪽을 건드리는지 먼저 구분할 것.

**① 해석 엔진 (C# .NET)**
- 소스: `C:\Coding\WorkBenchSubModule\MooringFitting\` (`MooringFitting.sln`, `src/`, `publish/`, `CONTEXT.md`, `README.md`).
- 빌드 산출물(실사용): `HiTessWorkBenchBackEnd\InHouseProgram\MooringFitting\MooringFitting.exe` — 엔진 개발이 끝나면 여기로 복사. InHouse 규칙 그대로 적용 — **git 미추적 → 운영 서버(145)에 수동 교체 + 백엔드 재시작 필요**. (폴더에 기능단계별 `.bak_*` 백업 존재)
- CLI 태스크 2종 (`app/services/mooring_fitting_service.py`가 호출):
  - `build-full` — 모델/BDF 생성. 안전계수 `--mf-sf`(기본 1.25), Angle_H/Angle_V force 역산 기록.
  - `solve-bdf <bdf> <model.json> -o <result.json> --yield <σy기본315 AH32> --gamma <γM기본1.0>` — Nastran SOL 101 해석, von Mises Usage=σeff/(σy/γM). `SOLVE_TIMEOUT=1800s`.

**② 스튜디오 (React 뷰어)**
- 소스: `C:\Coding\WorkBenchSubModule\MooringFittingStudio\` (viewer id=`mooring-fitting-studio`). 버전은 `package.json` 한 곳만 올림. 빌드 시 `mooring-fitting-studio-<ver>.zip`(+`.sha256`).
- **배포 위치:**
  1. **UNC(사용자 지정 표준 아카이브)**: `\\storage.hpc.hd.com\a476854\00_PROJECT\AA_300_CF44\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\StudioProgram` — 버전 올려 zip+sha256 저장. (한글·대괄호 → PowerShell `Copy-Item -LiteralPath ... -Destination '<경로>' -Force`)
  2. **★ 권장 + 서버 필수**: 백엔드-로컬 `HiTessWorkBenchBackEnd\StudioProgram\` 에도 복사. 백엔드 `viewers.py` `_candidate_dirs` 우선순위 = (env override) → **백엔드-로컬 StudioProgram → UNC**. '첫 후보가 존재하는 폴더'에서 멈춰 최고 버전을 서빙한다. 운영 서버(145)는 UNC 접근 불가 가정이므로 **서버 `StudioProgram\` 수동 복사가 실제 배포 통로**다.

**③ WorkBench 버전 동기화 — ★ ModuleUnit/ModelBuilder와 다름 (수동 핀 없음)**
- `HiTessWorkBench/frontend/src/pages/analysis/MooringFittingAssessment.jsx` 에는 **하드코딩 버전 상수(예 `MOORING_STUDIO_VERSION`)가 없다.** `latestVersion`을 백엔드 manifest(`GET /api/viewers/manifest/mooring-fitting-studio`)에서 **동적으로** 읽는다(`studioLatestVersion`). 설치본은 `studioInstalledVersion`. 불일치 시 "업데이트 후 열기" 버튼 노출.
- 즉 **버전 맞춤 = zip을 StudioProgram(UNC/백엔드-로컬)에 올리면 백엔드 `_find_zip`이 최고 버전을 manifest로 서빙 → 프론트가 자동으로 그 버전을 latest로 인식.** 프론트 수동 핀 수정 불필요(ModuleUnit처럼 세트로 상수 bump 하는 절차가 여기엔 없음).

**런타임 InHouse 의존 (서버 145 수동 반영 대상):** `InHouseProgram/MooringFitting/MooringFitting.exe` + `InHouseProgram/NastranBridge/nastran_bridge.py`(rbe2_fixed_lines 등 편집 BDF fix, `analysis.py` apply-edit 기본 경로) + `InHouseProgram/F06Parser/` + 외부 MSC `nastran.exe`.

**배포 세트 요약:** 엔진 수정 → publish → `InHouseProgram/MooringFitting/` 복사(+서버145 수동·재시작) / 스튜디오 수정 → `package.json` bump → `npm` 빌드 zip → **UNC + 백엔드-로컬** 복사 → WorkBench는 manifest로 **자동 버전 인식**(프론트 수동 핀 없음).

**현재 상태(2026-07-23 확인):** 엔진 git 최신 `0494258`(CSV parse skip grouping). 스튜디오 `package.json`=`0.1.59`, UNC StudioProgram에 `0.1.58/0.1.59` 배포됨. ⚠ 백엔드-로컬 `HiTessWorkBenchBackEnd\StudioProgram\` 에는 mooring zip이 없어 현재 **UNC로 폴백 서빙 중** — 다음 배포 때 백엔드-로컬에도 복사할 것. 기능 이력: 최초 API(`52bc2ad`) → Studio Phase1 BDF뷰어(`37a50c6`) → solve-bdf 연동(`2d62be2`) → Safety Factor·v1.2.5(`79d9611`) → 편집 BDF solve PID패치·SPC충돌해소(`728b66e`).

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

### Truss Structural Assessment — 허용응력 Property ID 테이블은 두 곳에서 참조된다 ★수정 시 동기화 필수

엔진(`WorkBenchSubModule/TrussAssessment`, C#)의 허용응력 테이블은 **Property ID 1~18만** 하드코딩돼 있고(`ElementStressChecker.cs:28-48`, `AllowableInfo.propertiesInfo`), 테이블 밖 ID 는 `catch (KeyNotFoundException) { continue; }` 로 **아무 흔적 없이 스킵**된다.

- 실제 장애(2026-08-28, `177K-01.bdf`): FEGate 5.03.21 이 PBAR/PBARL 을 **+1000 오프셋(1001~1019)** 으로 내보내 23,035 개 CBAR 가 전부 스킵 → F06 에 FATAL 도 없고 엔진도 exit 0 인데 엑셀의 `Summary_LC*` / `부재평가_LC*` 시트만 헤더만 남음. 하중분산판·SideSupport 는 SPC 반력만 쓰므로 정상 출력돼 "일부만 안 나오는" 모양이 된다.
- ⚠ **ID 집합이 백엔드에도 있다**: `app/services/assessment_diagnostics.py` 의 `_ALLOWABLE_PROPERTY_IDS = frozenset(range(1, 19))`. **C# 테이블에 Property ID 를 추가·삭제하면 이 상수도 같이 고칠 것.** (허용응력 *값* 은 복제하지 않는다 — 판정에 필요한 건 ID 집합뿐이라 중복을 정수 리스트 한 줄로 묶어 뒀다.)
- 검사는 **CBAR 가 참조하는 PID** 기준이다. PBAR/PBARL 카드 기준으로 바꾸지 말 것 — 정상 참조 모델 `3321_2tk_moving_04.bdf` 에는 어떤 CBAR 도 쓰지 않는 PBARL 37/38/39 가 카드로만 존재해서 카드 기준이면 **정상 모델이 차단된다.**
- 방어선 2겹(둘 다 백엔드, `git pull` 로 서버 반영): ① `preflight_property_ids()` — 업로드 직후 차단(전량 미매핑) 또는 경고(부분 미매핑, 해석은 진행). ② `_count_element_rows()` — 엔진이 exit 0 + JSON 까지 냈는데 부재평가가 0 행이면 Success 를 Failed 로 뒤집는다.

### 프론트엔드 내비게이션 구조

React Router 대신 **NavigationContext** (`src/contexts/NavigationContext.jsx`)를 사용합니다. `useReducer` 기반으로 `history[]` 배열과 `currentIndex`를 원자적으로 관리합니다. 페이지 컴포넌트에서 `useNavigation()` 훅으로 `setCurrentMenu(name)`, `goBack()`, `goForward()` 등에 접근합니다(이전의 props drilling 방식 제거). 전체 라우팅 분기는 `App.jsx:renderPage()`의 switch문에 있습니다.

키보드 단축키: **Alt + ←** (뒤로), **Alt + →** (앞으로), **F5** (새로고침 방지).

### 주요 Context

| 파일 | 훅 | 역할 |
|------|-----|------|
| `contexts/NavigationContext.jsx` | `useNavigation()` | 페이지 히스토리 스택 관리, 뒤로/앞으로 이동 |
| `contexts/DashboardContext.jsx` | `useDashboard()` | 해석 앱 메타데이터, 전역 작업 추적, 즐겨찾기 |
| `contexts/ToastContext.jsx` | `useToast()` | 전역 토스트 알림 |

**DashboardContext** 주요 값:

- `ANALYSIS_DATA` — 전체 해석 앱 메타데이터 목록 (mode, category, title, devStatus, contributor)
- `globalJob` / `startGlobalJob` / `clearGlobalJob` — 화면 우측 하단 고정 백그라운드 작업 추적 위젯
- `assessmentPageState` / `setAssessmentPageState` — 페이지 이탈 시에도 TrussAssessment 상태 유지
- `favorites` / `toggleFavorite` — 사용자 즐겨찾기 앱 목록

### 해석 작업 흐름

1. 프론트엔드에서 파일 업로드 → `POST /api/analysis/{type}/request` (type: `truss`, `assessment`, `beam`)
2. 백엔드가 `userConnection/{timestamp}_{employee_id}_{ProgramName}/` 폴더에 파일 저장
3. `app/services/job_manager.py`의 `ThreadPoolExecutor`(최대 5개 동시 실행)에 작업 제출
4. 서비스 파일(`truss_service.py`, `assessment_service.py`, `beam_service.py`, `bdfscanner_service.py`, `hitess_modelflow_service.py`)이 `InHouseProgram/`의 `.exe` 실행
5. 프론트엔드에서 1.5초마다 `GET /api/analysis/status/{job_id}` 폴링 (0~100%)
6. 완료 후 결과 파일 경로를 DB `result_info` (JSON 컬럼)에 저장, `GET /api/download?filepath=...`로 다운로드

작업 상태는 인메모리(`job_status_store` dict)에 저장됩니다. 서버 재시작 시 진행 중인 작업 상태가 소실되는 구조적 한계가 있습니다(프로덕션에서는 Redis 권장).

**다운로드 보안**: `GET /api/download`는 `os.path.abspath` 프리픽스 검사로 `userConnection/` 디렉토리 외부 경로 접근을 차단합니다.

**Excel 내보내기**: `GET /api/analysis/export-xlsx`는 TrussAssessment JSON 결과를 BytesIO 메모리에서 XLSX로 변환하여 반환합니다. 디스크에 저장하지 않아 회사 DRM 소프트웨어의 자동 암호화를 우회합니다.

### AI 파이프라인

- 관리자가 `POST /api/ai/ingest` 호출 → `app/AI/ingest.py`가 문서를 청킹하여 FAISS 인덱스 + BM25 피클 생성 (`app/AI/vectorstore/`에 저장)
- 채팅: `POST /api/ai/chat` → `app/AI/chain.py`에서 멀티 쿼리 재구성 → 하이브리드 검색(BM25 30% + 벡터 70%) → Ollama LLM(`qwen2.5:7b`, `localhost:11434`)으로 답변 생성
- 임베딩 모델: BGE-M3 (다국어)

### 인증

- 사번(employee_id)만으로 로그인 (별도 비밀번호 없음). 신규 사용자는 기본 비활성 상태이며 관리자 승인 후 사용 가능.
- 세션은 `localStorage`의 `'user'` 키에 저장되고 props/context로 전달. JWT 없음.
- `User` 모델의 `is_admin` 플래그로 관리자 페이지 접근 제어.

### App Settings — App별 서비스 상태·접근 통제 ★API가 403이면 여기부터 확인

관리자가 App을 **개발 중 / 출시 예정 / 점검 중**으로 내리면 해당 App의 화면 진입과 **해석 요청 API가 서버에서 403으로 거부**된다. 원인 불명의 403을 만나면 `app_settings` 테이블부터 볼 것.

- **카탈로그의 원본은 여전히 코드**: `DashboardContext.jsx`의 `ANALYSIS_DATA`. DB(`app_settings`)에는 **오버라이드만** 저장한다. 행이 없으면 코드 기본값, 행을 지우면 초기화. 그래서 코드에 앱을 추가해도 DB를 미리 손댈 필요가 없다.
- **프론트에서 실효값을 읽는 법**: 반드시 `useAppCatalogue()`(DashboardContext) 사용. `ANALYSIS_DATA`를 직접 import 하면 **코드 기본값이 고정**돼 관리자 변경이 화면에 반영되지 않는다. 오버라이드 map 자체는 `useAppSettings()`(`hooks/useAppSettings.js`).
- **차단 판정 우선순위**: `maintenance` > `dev_status ∈ {Developing, Planned}`. 관리자는 항상 통과(개발·점검 중인 앱을 확인해야 하므로).
- **차단 지점 3곳**:
  1. 목록 카드 클릭 → `AdminGateModal` (Dashboard / AppCataloguePage)
  2. `App.jsx:renderPage()`의 단일 게이트 — 최근 앱·명령 팔레트·토스트 링크 등 `setCurrentMenu`로 곧장 들어오는 모든 경로를 여기서 막는다
  3. 백엔드 미들웨어 `services/app_settings_gate.py`
- ⚠ **백엔드 게이트에 새 App을 걸려면 `services/app_settings.py`의 `GUARDED_ROUTES`에 경로 접두사를 등록해야 한다.** 미등록 경로는 **fail-open**(통과)이다. 상태만 바꾸고 여기를 빠뜨리면 화면은 막히는데 API는 열려 있다.
- 게이트는 **POST/PUT/PATCH/DELETE 만** 검사한다. 진행 중 작업의 상태 폴링(GET)까지 막으면 관리자가 스위치를 내리는 순간 남의 작업이 끊긴다.
- ⚠ **미들웨어 등록 순서**: `main.py`에서 `install_app_availability_guard()`를 **CORSMiddleware보다 먼저** 호출해야 한다. Starlette은 나중에 추가한 미들웨어가 바깥쪽이라, 순서가 바뀌면 게이트의 403에 CORS 헤더가 안 붙어 앱이 차단 사유를 못 읽는다.
- 관리 UI: `Administration > App Settings`(전체 표) + 앱 카드/행의 톱니바퀴(관리자에게만 노출) → `components/admin/AppSettingsModal.jsx`.
- 설정 캐시 TTL 5초(쓰기 시 즉시 invalidate) + 프론트 60초 폴링 → 다른 관리자의 변경이 최대 1분 내 반영.

### DB 모델 (`app/models.py`)

| 모델 | 테이블 | 주요 컬럼 |
|------|--------|-----------|
| `User` | `users` | employee_id, is_active, is_admin, login_count |
| `Analysis` | `analysis` | program_name, input_info (JSON), result_info (JSON), source |
| `Notice` | `notices` | type, is_pinned |
| `UserGuide` | `user_guides` | category, content |
| `FeatureRequest` | `feature_requests` | status, upvotes, admin_comment |
| `AppSetting` | `app_settings` | app_key(=ANALYSIS_DATA title), dev_status, maintenance, maintenance_message, description, tags(JSON), contributor |

### 백엔드 라우터 구조

| 파일 | 프리픽스 | 역할 |
|------|----------|------|
| `routers/auth.py` | `/api`, `/member` | 로그인, 회원가입, 사번+회사 기반 사용자 확인 (`/check_user`) |
| `routers/users.py` | `/api/users` | 사용자 CRUD, 승인 |
| `routers/analysis.py` | `/api/analysis` | 작업 제출, 상태 조회, 이력, 다운로드, xlsx 내보내기 |
| `routers/support.py` | `/api` | 공지사항, 사용자 가이드, 기능 요청 |
| `routers/system.py` | `/api/system` | CPU/메모리/DB 상태, 큐 현황 |
| `routers/ai.py` | `/api/ai` | 채팅, 인덱싱, 문서 목록 |
| `routers/davit.py` | `/api/davit` | Mast Post / Jib Rest 다빗 구조 계산 |
| `routers/column_buckling.py` | (별도 프리픽스) | AISC 기둥 좌굴 하중 계산 |
| `routers/chat.py` | `/api/chat` | 관리자↔사용자 1:1 DM (폴링 기반, WebSocket 없음). `GET /contacts` 는 대화 가능한 활성 관리자 + 접속 상태(online/idle/offline)를 필드 화이트리스트로 반환 — 사용자가 먼저 대화를 걸 수 있는 진입점 |
| `routers/app_settings.py` | `/api/app-settings`, `/api/admin/app-settings` | App별 서비스 상태·점검·표시 메타 오버라이드 |

**`/member/check_user`**: 사번(`userID`) + 회사(`company`) 기반으로 사용자 등록·승인 여부 확인. `/api/check_user`로도 동일하게 접근 가능. Electron 앱 초기 로그인에 사용.

### 프론트엔드 페이지 구조

`HiTessWorkBench/frontend/src/pages/`에 위치하며 `App.jsx:renderPage()`의 switch문으로 라우팅됩니다.

**File-Based / 해석 앱**

| 메뉴 이름 | 컴포넌트 | 설명 |
|-----------|----------|------|
| `'Dashboard'` | `dashboard/Dashboard.jsx` | 메인 대시보드, 통계 및 즐겨찾기 |
| `'My Project'` / `'My Projects'` | `analysis/MyProjects.jsx` | 내 해석 이력 및 프로젝트 관리 |
| `'New Analysis'` / `'File-Based Apps'` | `analysis/NewAnalysis.jsx` | 파일 업로드 기반 해석 선택 |
| `'Truss Analysis'` | `analysis/TrussAnalysis.jsx` | CSV 업로드 + 3D 모델 뷰어 |
| `'Truss Structural Assessment'` | `analysis/TrussAssessment.jsx` | BDF 업로드 + 구조 안정성 평가 |
| `'HiTess ModelFlow'` | `analysis/HiTessModelFlow.jsx` | CSV → BDF → Nastran 전체 FEM 파이프라인 (개발 중) |
| `'BDF Scanner'` | `analysis/BdfScanner.jsx` | BDF 유효성 검증 + 선택적 Nastran 해석 |

**Interactive / Parametric 앱**

| 메뉴 이름 | 컴포넌트 | 설명 |
|-----------|----------|------|
| `'Interactive Apps'` | `analysis/InteractiveApps.jsx` | 대화형 해석 앱 진입점 |
| `'Component Wizard'` / `'Simple Beam Assessment'` / `'Simple Beam Analyzer'` | `analysis/SimpleBeamAssessmentPage.jsx` | 단면 입력 기반 보(Beam) 응력·변위 평가 |
| `'Parametric Apps'` | `analysis/ParametricApps.jsx` | 파라메트릭 해석 앱 진입점 |
| `'Mast Post Assessment'` | `analysis/MastPostAssessment.jsx` | Post 높이·하중 입력 → 최적 파이프 후보 산출 |
| `'Jib Rest Assessment'` | `analysis/JibRestAssessment.jsx` | Jib Rest 1단/2단 파이프 설계 후보 산출 |
| `'Column Buckling Load Calculator'` | `analysis/ColumnBucklingCalculator.jsx` | AISC 기준 기둥 좌굴 허용 하중 계산 |
| `'Productivity Apps'` | `analysis/ProductivityApps.jsx` | 생산성 도구 모음 진입점 |
| `'Beam Result Viewer'` | `analysis/BeamAnalysisViewer.jsx` | JSON/CSV 결과 시각화 |

**Support / 관리자**

| 메뉴 이름 | 컴포넌트 | 설명 |
|-----------|----------|------|
| `'Notice & Updates'` | `Support/NoticeBoard.jsx` | 공지사항 게시판 |
| `'Feature Requests'` / `'User Requests'` | `Support/UserRequests.jsx` | 기능 요청 및 건의 |
| `'User Guide'` | `Support/UserGuide.jsx` | 사용자 가이드 |
| `'AI Lab Assistant'` / `'AI Assistant'` | `AI/AiAssistantHub.jsx` | RAG 기반 AI 채팅 |
| `'Hi-Lab Insight'` | `AI/HiLabInsight.jsx` | AI 인사이트 페이지 |
| `'User Management'` | `Administration/UserManagement.jsx` | 관리자: 사용자 승인/관리 |
| `'Analysis Management'` | `Administration/AnalysisManagement.jsx` | 관리자: 전체 해석 이력 |
| `'Usage Reports'` | `Administration/UsageReports.jsx` | 관리자: 일/주/월 사용량 정형 리포트, Excel 내보내기 |
| `'System Settings'` | `Administration/SystemSettings.jsx` | 관리자: 시스템 모니터링 |
| `'App Settings'` | `Administration/AppSettings.jsx` | 관리자: App별 서비스 상태·점검 모드·표시 정보 |
| `'API Apps'` | `Administration/ApiApps.jsx` | 관리자: API 연동 앱 관리 |
