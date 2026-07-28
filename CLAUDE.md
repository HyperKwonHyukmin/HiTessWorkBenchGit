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
| `routers/chat.py` | `/api/chat` | 관리자↔사용자 1:1 DM (폴링 기반, WebSocket 없음) |
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
