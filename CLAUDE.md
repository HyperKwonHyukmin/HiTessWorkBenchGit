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

# 70 개발 PC 바로 실행 (2026-11-10, 미커밋 · 바탕화면 바로가기 3개)
#   Dev_All_70.bat                       = 백엔드 + 클라이언트를 각자 새 창으로
#   HiTessWorkBenchBackEnd/Dev_Server_70.bat = 백엔드만(9091 이 이미 떠 있으면 그 uvicorn 트리를 끌지 묻는다, 보조 scripts_dev_find_9091.ps1)
#   HiTessWorkBench/Dev_Client_70.bat    = npm run dev 만(5173 이 이미 떠 있으면 묻는다)
#   ⚠ PyCharm 터미널에서 백엔드를 띄우지 말 것 — 백엔드가 부르는 파이썬이 DRM(HIDRMH.DLL)에서 0xC0000005 로 죽는다(전역 CLAUDE.md '이 PC 환경').

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

### 커밋 전 점검 — 테스트·빌드 통과로 끝내지 않는다

v1.5.8 에서 결함 6건이 새어 나갔고 3건을 사용자가 먼저 찾았다(MySQL 정렬 버퍼 500 · lucide `Map` 아이콘이 전역 `Map` 을 가린 크래시 · 재시작 안 한 라우터 404).
백엔드 테스트는 **SQLite** 라 MySQL 고유 실패를 못 잡고, 프론트는 컴포넌트 테스트가 없다. 그래서 커밋 직전에:
1. 백엔드 테스트 + `npm run build` + `node --test src/utils/*.test.js`. 그 위에 **변경이 닿는 화면을 나열하고 그 화면이 부르는 API 를 실제로 1회씩 호출**한다.
2. DB 모델 변경 시 — `schema_bootstrap` 멱등 보강, 그 테이블을 `ORDER BY` 하는 목록 쿼리에 JSON/TEXT 가 끼는지, 목록 API 를 작은·큰 limit 로 두 번 호출.
3. 새 라우터 — `main.py` 등록 + 실제 재시작 후 200, 필요하면 `GUARDED_ROUTES` 등록.
4. 프론트 — 아이콘 이름이 JS 내장(`Map`/`Set`/`Image`)과 겹치지 않는지, 서버 실패 때 로컬 값을 덮어쓰지 않는지.
5. 커밋 메시지 끝에 배포 영향 한 줄(`git pull + 재시작` / `프론트 재배포` / `InHouse 수동 교체 <파일>` / `없음`).
6. 운영 오류는 추측하지 말고 traceback 부터 확보한다.
7. 코드 변경 커밋 직전 `hitess-code-reviewer` 에이전트를 diff 범위로 1회 돌린다(작업 의도는 넘기지 않는다 — 독립 리뷰가 목적). '막아야 함'이 나오면 고친 뒤 커밋하고, 문서만 바뀐 커밋은 건너뛴다.
상세 계획: `docs/operations/regression-prevention-master-plan.md`.

## 아키텍처

```
[Electron shell]  →  개발: localhost:5173 로드 / 프로덕션: frontend/dist/index.html 로드
[React SPA]       →  REST API로 백엔드 서버와 통신
[FastAPI backend] →  해석 작업 수행, DB 데이터 제공, AI 질의 처리
```

### 주요 설정 포인트

- **백엔드 URL**: `HiTessWorkBench/frontend/src/config.js`의 `DEFAULT_API_BASE_URL` — 기본값 `http://10.133.122.70:9091`. 사용자가 앱 내에서 서버 주소를 변경하면 `localStorage`의 `'server_url'` 키에 저장되며 이 값이 우선 사용됨(`setApiBaseUrl()` 함수로 런타임 변경 가능).
  - ⚠️ **`config.js`의 `DEFAULT_API_BASE_URL` 변경은 항상 커밋에서 제외할 것.** 이 값은 개발자가 로컬 백엔드(`10.133.122.70` '내 컴퓨터')와 팀 서버(`10.14.42.145` '서버 컴퓨터') 사이를 토글하는 **로컬 전용 변경**이다. 커밋하면 배포 빌드의 기본 백엔드가 개발자 개인 PC로 바뀌어 팀/릴리즈가 깨진다. `/git:commit` 등 모든 커밋 작업에서 `config.js`는 스테이징하지 말고 로컬 변경으로 남겨둔다.
  - **WorkBench exe 릴리스 = `/wb-release`** (2026-10-19, `.claude/commands/wb-release.md`). `scripts/release.ps1 -Bump -BuildOnly` 가 버전 4곳을 올리고, config.js 가 어느 쪽이든 **무조건 145 줄 활성**으로 맞춰 빌드한 뒤 번들에 70 주소가 없는지 검사하고 빌드 전 상태로 되돌린다. 버전 커밋·푸시는 빌드와 동시에 진행한다.
    **2026-11 부터 1.7.x**(사용자 지시 '11월이라 버전 네이밍 변경' — 1.6.33 은 빌드만 하고 같은 내용을 1.7.0 으로 배포). 달이 바뀔 때 minor 를 올리는지는 다음 달에 사용자에게 확인.
    버전만 올릴 때는 `pwsh scripts/check-versions.ps1`(인자 없음 = patch+1 **후 바로 커밋**, `-SetVersion X.Y.Z`, 확인만은 `-Check`). 4곳을 손으로 고치지 말 것.
    ⚠ 커밋 훅은 Bash 명령 문자열(커밋 메시지 포함)에 `config.js` 가 들어 있기만 해도 막는다 — 메시지는 파일로 넘기고 config.js 확인은 Grep 도구로.
- 🚫 **`Darkmode.js/` 는 영구적으로 커밋하지 않는다 (사용자 지시).** 저장소 루트의 이 폴더는 **자체 `.git/` 를 가진 외부 라이브러리 클론**(50파일·1.3MB)이다. `git add -A` 로 넣으면 내부 파일이 아니라 **임베디드 저장소(gitlink) 한 줄**만 기록돼 다른 사람이 clone 하면 **빈 폴더가 되는 깨진 엔트리**가 된다. `.gitignore` 에 등재해 뒀으니 어떤 커밋 작업에서도 되살리지 말 것.
- **백엔드 개발 서버 포트**: `9091` (uvicorn 실행 시 `--port 9091` 사용).
- **데이터베이스**: MySQL `localhost:3306/hitessworkbench`, 접속 정보는 `HiTessWorkBenchBackEnd/app/database.py`. SQLAlchemy로 서버 시작 시 테이블 자동 생성.
- **Electron 환경 감지**: `electron/index.js`의 `app.isPackaged` 여부로 개발/프로덕션 로드 경로 분기.
  - ⚠ **배포 exe 의 Electron 버전 ≠ 개발 모드 (2026-10-19 확인)**: `package.json` 은 `electron ^36.3.2` 인데 루트 `node_modules/electron` 이 **26.0.0** 이라 exe 는 Electron 26(Chromium 116)으로 빌드된다(`dist_electron/builder-effective-config.yaml` `electronVersion`). 개발 모드(`electron/node_modules`)는 40. 화면·웹 기능 확인은 exe 기준으로 하고, 버전을 맞출 때는 루트에서 electron 을 다시 설치한다.
  - **번들 보안 점검 (2026-10-27)**: `app.asar`(배포 번들)를 풀어 리버스 엔지니어링 노출을 점검한 결과 **비밀값·엔진 바이너리·DB 접속정보·원본 소스맵(.map)·dev 주소(70) 모두 미유출**이었다. 토큰은 전부 런타임 세션 토큰이고, 영상 티켓 서명키·해석 엔진·DB 는 서버(145)에만 있다 — "가치는 서버, 클라이언트는 열려 있다" 전략이 코드에서 지켜지는 것을 확인. 유일한 위생 문제는 `.test.js` 7개가 번들에 실리던 것 → `package.json` `build.files` 에 `!electron/**/*.test.js`·`!electron/**/*.spec.js` 제외 추가(**미커밋, 다음 exe 빌드부터 효력** — v1.6.29 번들에는 아직 테스트 파일이 있음).
- ⚠️ **InHouse 프로그램 배포 규칙 (개발 위치 ≠ 실사용 위치)**: 해석 실행 파일·스크립트의 **코드 작업은 `C:\Coding\WorkBenchSubModule\<Program>\`**(예: `Nastran_bridge`, `MooringFitting`)에서 하더라도, **WorkBench 백엔드가 실제로 실행·import 하는 최종본은 반드시 `HiTessWorkBenchBackEnd/InHouseProgram/<Program>/`로 복사**해야 한다.
  - 운영 서버(145)에는 `WorkBenchSubModule/`이 없고 `InHouseProgram/`은 git 미추적이라, SubModule만 고치면 **dev에서는 되고 서버에서 깨진다**(실례: `rbe2_fixed_lines` 누락 → mooring solve HTTP 500). InHouse 관련 작업 보고에는 **"`git pull`만으로 끝나는지 / 서버 수동 교체 파일 목록 + 재시작 필요"를 항상 구분해 명시**한다.
  - 폴더명: `InHouseProgram`은 camelCase(`NastranBridge`), SubModule은 underscore 혼용(`Nastran_bridge`). `analysis.py`의 nastran_bridge 탐색은 `InHouseProgram/Nastran_bridge` → `WorkBenchSubModule/Nastran_bridge` → `InHouseProgram/NastranBridge` 순 + `NASTRAN_BRIDGE_DIR` override.
- 📦 **배포 절차(Studio zip 2곳 복사·버전 확인·버전 핀 동기화, 엔진 exe 빌드·교체, 서버 보고 형식)는 전역 `/deploy` 스킬에 있다.** "배포해" 요청 시 그 스킬을 따른다. 전역 훅(`~/.claude/hooks/workbench_guard.js`)이 config.js 커밋을 차단하고 InHouseProgram/StudioProgram 변경 시 서버 반영을 알린다.
  - Studio zip 경로 = 백엔드-로컬 `HiTessWorkBenchBackEnd\StudioProgram\` · UNC `...\[개인 자료]\권혁민 책임연구원\HiTessWorkBench\StudioProgram`(전체 경로·복사 명령은 `/deploy` 스킬 `studio.md`). 대괄호 때문에 PowerShell 은 `Copy-Item -LiteralPath`. 버전은 각 studio 의 `package.json` 한 곳만 올린다.
  - ⚠ **Studio 배포(올리기)와 릴리스(145 사용자에게 열기)는 다르다 (2026-10-29)** — 70·145 가 같은 UNC 를 봐서 올린 베타가 145 에 바로 나가던 문제를 막았다.
    역할: "배포해" = **70 로컬 `StudioProgram\` 에만**(70 테스트) · `/studio-release` = 출처 release 폴더 → **UNC 업로드** + 표 갱신(145 공개).
    UNC 에 먼저 올리지 않으므로 145 가 옛 백엔드여도 베타가 새지 않는다. "zip 빌드해서 저장해" 도 "배포해" 와 같다(70 로컬만).
    145 백엔드는 `HiTessWorkBenchBackEnd/app/studio_release.json`(`studios` = viewer id → 버전, 모든 Studio)에 적힌 버전만 내주고(`viewers.py`, 요청마다 읽음),
    70 은 `.env` `STUDIO_CHANNEL=dev`(git 미추적, **145 에는 넣지 말 것**)라 늘 최고 버전. 표 갱신 = `scripts/studio_release.py` —
    `/wb-release` 가 모든 Studio 를 UNC 최신으로, `/studio-release <id> [버전]` 이 WorkBench 버전과 무관하게 한 Studio 만(롤백 포함). 반영 = 커밋·푸시 + 145 ⟳ Update(재시작 불필요).
    표의 버전 zip 이 어느 후보 폴더에도 없으면 최고 버전으로 넘어가지 않고 404. 프론트 핀(`MODEL_BUILDER_STUDIO_VERSION` 등)은 이제 표시용 기본값일 뿐 받는 버전을 정하지 않는다.
    테스트 `tests/test_viewers_release.py`.

### Model Builder Studio — 2개 구성요소(엔진 / 스튜디오)와 배포 흐름 ★작업 전 필독

Model Builder Studio는 **별개의 두 프로젝트**로 구성된다. 작업 시 어느 쪽을 건드리는지 먼저 구분할 것.

**① 해석 엔진 (C#)**
- 소스: `C:\Coding\WorkBenchSubModule\HiTessModelBuilder\` (`Cmb.*` 솔루션, `HiTessModelBuilder.sln`)
- 빌드 산출물(실사용): `HiTessWorkBenchBackEnd\InHouseProgram\HiTessModeBuilder\Cmb.Cli.exe`
  - ⚠️ 폴더명은 `HiTessModeBuilder` ('l' 빠진 형태가 정확함, 오타 아님). InHouse 프로그램 규칙(위) 그대로 적용 — **git 미추적, 서버(145) 수동 교체 필요**.

**② 스튜디오 (React UI 뷰어)**
- 소스: `C:\Coding\WorkBenchSubModule\ModelBuilderStudio\apps\model-studio\` (viewer id=`model-studio`, 연결 메뉴=`HiTess Model Builder`)
- 사용 흐름: WorkBench가 `GET /api/viewers/manifest|download/model-studio`로 백엔드에서 최신 zip을 받아 로컬에 설치해 띄운다. `viewers.py`의 `_find_zip`은 후보 폴더를 순서대로 보고 **첫 번째 폴더(백엔드-로컬 `StudioProgram\`)의 최고 버전**을 내려준다. 배포 절차·버전 핀(`MODEL_BUILDER_STUDIO_VERSION`)은 `/deploy` 스킬.
- ⚠️ **회사 DRM**이 로컬 C:에 쓴 zip을 정확히 +4096B 암호화한다(백엔드는 `read()`로 복호화해 읽음). 그래서 `app/routers/viewers.py`는 size/sha256/다운로드 본문을 **모두 `read()`한 바이트 기준**으로 서빙해야 한다. `os.path.getsize`나 `FileResponse`(Content-Length=stat)를 쓰면 **`ERR_CONTENT_LENGTH_MISMATCH`** 로 신규 버전 다운로드가 실패한다.

**런타임 파이프라인 — 엔진↔스튜디오가 실제로 맞물리는 절차 (오케스트레이터: `app/services/hitess_modelflow_service.py`)**

배포 흐름(위)이 "프로그램을 어디 두나"라면, 이건 "사용자가 누르면 무슨 일이 일어나나"다. 두 task 로 구성된다.

1. **빌드** — `POST /api/analysis/modelflow/request` → `task_execute_modelflow`
   - 업로드: `stru_file`(필수) + `pipe_file`·`equip_file`(선택). UI 옵션 → CLI 플래그: `mesh_size→--mesh-size`, `ubolt_full_fix→--ubolt-full-fix`, `run_nastran→--run-nastran(+--nastran-path,--leg-z-tol)` 등.
   - 실행: `Cmb.Cli.exe build-full --stru <csv> [--pipe --equip] --mesh-size N [...]` (cwd=work_dir, timeout 20분).
   - 산출: `userConnection/<ts>_<id>_HiTessModelBuilder/<yyyyMMdd_HHmmss>/` 안에 **phase 파일**(`00_InputAudit.json`, `00_StageSummary.json`, `NN_*.json/.bdf` — 정규식 `^\d{2}_[A-Za-z]+\.(json|bdf)$`) + **최종 산출물** `<designName>.json/.bdf`.
   - output_dir 확정: 백엔드가 stdout 첫 줄 `출력 폴더: <path>`(또는 `폴더:`)를 파싱, 못 찾으면 성공/실패 모두 해당 요청의 work_dir 바로 아래 최신 `yyyyMMdd_HHmmss` 폴더로 폴백. exit **0=완료, 2=검증 Error, 1=실행/파이프라인 실패**. 실패해도 phase JSON/감사 경로를 보존해 진단을 표시하며, 실패 phase BDF는 최종 산출물로 제공하지 않는다.
   - 뷰: 스튜디오(`model-studio`)가 이 output_dir 을 **initialFolder 로 받아 phase JSON 을 일괄 자동 로드** → 3D 뷰/검증/편집.

2. **편집 적용** — `task_execute_apply_edit` (apply-edit 엔드포인트)
   - 스튜디오가 편집 결과를 output_dir 에 `*_edit.json`(intents)으로 기록.
   - 기본 경로: `Cmb.Cli.exe apply-edit-intent <output_dir> [--strict]` → `edited/` 에 `<base>.bdf` + `<base>.json` + `apply-trace.json`. exit **0=성공, 2=intents 빔, 64/65/70=실패**.
   - **엔진 하나만 적용한다** — 예전 Python fallback(exit 65 면 `nastran_bridge.py` 가 대신 적용)은 2026-10-29 걷어냈다. 엔진이 모르는 kind 면(`unsupported intent kind`) 실패하고 '엔진 교체 필요' 를 남긴다.
   - 후속 체인: `run_nastran` → `nastran.exe <bdf> scr=yes old=no batch=no` (f06/op2/log) → `parse_f06` → `F06Parser.Console.exe <f06> --output-dir` (`_results.json` + `_SC*_*.csv`). F06 의 `*** USER/SYSTEM FATAL|ERROR` 는 `scan_f06_diagnostics` 가 별도 수집.

**런타임에 필요한 InHouse 프로그램 3종 (Cmb.Cli 1개가 아니다 — 모두 서버(145) 수동 반영 대상)**

| 경로 | 역할 |
|------|------|
| `InHouseProgram/HiTessModeBuilder/Cmb.Cli.exe` | 엔진 (build-full + apply-edit-intent, MB 편집의 **유일한** 적용 경로) |
| `InHouseProgram/F06Parser/F06Parser.Console.exe` | F06 → 결과 JSON(`_results.json`)/CSV 파서 |
| 외부 MSC `nastran.exe` (`C:\MSC.Software\MSC_Nastran\20131\bin`, `--nastran-path` override) | 해석기. InHouse 아님 — 서버에 **MSC 설치** 필요 |

**편집 정합성 계약 (2026-10-02)** — 같은 편집 intent 를 Studio 미리보기·C# 엔진·Analysis 탭 해석 실행이 같은 모델로 만들어야 한다.
해석 실행(`modelbuilder_solve_service`)도 이제 Studio 가 보낸 `edits.intent_document` + `base_name` 으로 **편집 적용과 같은 함수**
`hitess_modelflow_service.apply_edit_intents`(C# 엔진)를 거쳐 편집 BDF 를 만든다(예전 삭제·RBE 추가 직접 반영 경로는 옛 Studio 호환용).
엔진마다 규칙을 맞추는 대신 Studio 가 결정값을 intent 에 박는다 — 회전 `pivot`, 무게중심 RBE 의 미리 거른 종속 + `independentCoord`(산술 평균),
일반 RBE 종속 중복 = 오류, 회전은 노드 추가·무게중심 RBE 보다 먼저. 상세·지원 표: Studio `docs/edit-intent-spec.md` 맨 앞 '현재 계약'.
계약 테스트 `tests/test_modelbuilder_edit_contract.py` — 새 kind 는 C# ↔ Studio 미리보기(`scripts/previewEditedModel.mjs`), 옛 kind(회전·무게중심 RBE·유체 비움)는
C# ↔ bridge 비교 2건을 독립 기준으로 남겼다(bridge 는 Mooring·SP 편집 엔진). 새 빌드 검증 시 `CMB_CLI_EXE`·`NASTRAN_BRIDGE_PY` 로 지정.
⚠ 새 intent kind 를 만들면 **Studio·C#·계약 테스트 3곳**을 함께 고칠 것(MB 경로 bridge fallback 은 2026-10-29 제거 — bridge 는 고치지 않는다).

**기본 모델 편집 기능 (2026-10-28 결정, 진행 중)** — 요소 삭제·추가, 노드 이동, 단면 변경, 질량 추가·수정·삭제, RBE 수정 등 9개.
이 작업에서 **MB 경로 엔진을 C# 하나로 통일**했다(`deleteRigid`·`addNode` C# 이식 → 145 exe 교체 뒤 MB 의 bridge fallback 제거, 2026-10-29).
결정 전체·진행 단계: Studio `docs/edit-intent-spec.md` 맨 앞 '기본 모델 편집 기능 계획'.
상태(2026-10-28 세션 끝) — 세부·버전별 경과는 Studio `docs/edit-intent-spec.md` 진행 단계 ①②.
- **완료(코드)**: ① C# 이 `deleteRigid`·`addNode` 직접 적용. ② `deleteElements`·`deleteMasses`·`deleteOrphanNodes`.
  ③④에서 앞당김(사용자 결정) `moveNodes`·`addElement`, ③ `changeSection`, ③④ `changeMasses`·`addMasses`(2026-10-29, 상세 Studio spec — **70 로컬만**: model-studio 0.1.3(0.1.2~0.1.3 = 값 수정 클릭 = 바꿔 선택·지금 값 미리 채움·다른 도구로 가면 앞 창 닫고 선택 비움)·핀 0.1.3 ·
  InHouse `Cmb.Cli.exe` sha256 8055258d…(백업 `.bak_20261029_before_mass_edits`). ⚠ 145: exe 교체 **먼저** → `/studio-release model-studio`
  (옛 exe 면 질량 편집이 `unsupported intent kind` 로 실패 — bridge fallback 없음). 화면 눈으로 확인 안 함). fallback 제거(2026-10-29) — `BRIDGE_ONLY/KNOWN_INTENT_KINDS` 없음,
  옛 엔진이면 '엔진 교체 필요' 로 실패(`test_modelbuilder_edit_fallback_guard.py`).
- **화면**: 편집 작업의 단일 진입점 = 뷰포트 왼쪽 도구 막대 `EditToolPalette`(노드·부재·질량·RBE·정리). 왼쪽 패널 = 선택 필터·수정 내역,
  아래 선택 바 = 선택 수·해제·목록. 형상 편집은 파생 모델(`data/geometryEdits.js`)로 편집 대상 뷰포트에만 그린다(원본 StageData 불변).
- **계약 테스트** = C# ↔ Studio 미리보기(`scripts/previewEditedModel.mjs`, node 필요) — `test_modelbuilder_edit_contract.py`. 옛 exe 면 해당 테스트는 건너뛴다.
- **배포(로컬 70만)**: InHouse `Cmb.Cli.exe`(sha256 12f1f3aa…, 백업 `.bak_20261028_before_delete_edits`·`.bak_20261028_before_move_add`) ·
  `model-studio-0.0.121`(로컬·UNC, **릴리스 표 0.0.121 = 145 공개**(`d27df93`, 2026-10-29) — 0.0.115 새 부재 삭제 시 새 노드도 정리, 0.0.116 '삭제' 먼저 → 고르기 도구, 0.0.117~0.0.119 '도움말·셸 정리', 0.0.120 작업 패널 통일, 0.0.121 좌하단 버전 표시) · **0.0.122 는 70 로컬만**(2026-10-29, 커밋 전 독립 리뷰 반영 — 새 구조 단면 PID 를 배관 구간(≥101) 밖에서 고름 `suggestNextPropertyId`·
  그룹 삭제 시 그 노드를 쓰는 `addElement` 도 함께 취소·대화상자 한글 조합 Enter) · 0.0.123 **부재 단면 변경**(`changeSection`, 상세 Studio `docs/edit-intent-spec.md` 진행 단계) ·
  0.0.124 단면 변경 패널 기본값이 고른 부재의 지금 단면이면 '이미 단면 P19' 가 뜨던 것 수정 · **0.1.0**(같은 내용, 사용자 지시로 번호만) = **릴리스 표 0.1.0**(`42108bb`, UNC 업로드·검증됨) · 핀 0.1.0(표시용).
  InHouse `Cmb.Cli.exe` 70 교체(sha256 c9bb1e11…, changeSection + 새 PID 가 base BDF `PipePidBase` 이상이면 65, 백업 `.bak_20261029_before_change_section`).
  **145 반영 완료**(사용자, 2026-10-29): InHouse `Cmb.Cli.exe` 교체 + ⟳ Update(표 0.1.0). exe 가 옛것이면 0.1.0 의 단면 변경·삭제·노드 이동·부재 추가가 실패한다.
  릴리스 표는 git 이라 `/studio-release` 후 145 ⟳ Update 가 늘 필요하다(사용자 확인, 2026-10-29 — 자동 pull·UNC 표는 하지 않기로). `/studio-release` 보고 첫 줄에 그 문장을 넣게 바꿨다.
  WorkBench 1.6.30(`83fef8b`) 릴리스·푸시. 145 반영(InHouse 교체·⟳ Update·재시작)은 사용자가 마침(2026-10-29).
- **도움말·셸 정리 (2026-10-29, 0.0.117~0.0.119)** — Studio 안 사용자 가이드: 상단 `도움말`(따라하기 7개 · F1 버튼 설명 모드 · 기능 찾기 · 단축키 · 용어),
  원본은 Studio `src/data/helpContent.js` 한 곳(버튼·구역 `data-help`, 테스트가 누락을 잡음). `/design` 검토(27/40) 후 사용자 결정으로 셸 규칙을 정함 —
  보이기 설정은 오른쪽 '표시' 도크 한 곳(9-11 Model 탭 배치를 되돌림) · Model Check = 보기·제안, 그룹 삭제는 Edit · 탭 푸터 = 다음 행동 1개 ·
  노드·부재 입력 창 = 뷰포트 아래 비모달 패널(3D 클릭이 주황 칸에 바로 들어감) · 노드 중점 생성 · 직교 카메라 near 음수(확대 시 모델 잘림 수정) · CSV '모델 없음' 행 점선 상자.
  규칙·남은 것·**Module Unit Studio 로 넓힐 목록** = Studio `apps/model-studio/docs/shell-conventions.md`(MB 개선을 마친 뒤 사용자가 확산 요청 예정).
  **작업 패널 통일(2026-10-29, 0.0.120~)**: 노드·부재·삭제·RBE·고립 노드 정리가 모두 같은 아래쪽 패널(`components/edit/WorkPanelFrame.jsx`) —
  모드 표시(삭제 = 빨간 테두리) · 대상 칸 · 옵션 · 주 버튼 하나 · Esc. 패널이 열린 동안 3D 클릭 = 대상 넣기/빼기(스토어 `pickTool` 이 패널 열림과 함께 움직임).
  사용자 결정: 적용 후 패널 유지 · 삭제 확인 모달 없음(Ctrl+Z, 패널이 끊김·함께 지워질 노드를 미리 보임). 선택 바 [삭제 Del] [RBE로 묶기 Enter] 로 단축키 안내.
  규칙 원본 = Studio `docs/shell-conventions.md` 11번.
- **git (2026-10-29 커밋·푸시)**: 엔진 → `HiTessModelBuilder.git` `main`(`ecfe841`, 옛 엔진 이력은 `-s ours` 병합으로 보존) ·
  Studio → `ModelBuilerStudio.git`(Private, 옛 이름 ClaudeModelBuilerViewer) **`model-studio` 브랜치**(`c0fa8db`). 그 저장소 `master` 는 **Module Unit Studio** 라
  GitHub 의 'model-studio → master' PR 제안을 누르지 말 것. ModelBuilderStudio 로컬 `master` 가 `origin/model-studio` 추적(`push.default upstream`, PC 마다 설정).
  **Module Unit Studio 는 2026-11-03 별도 저장소 `ModuleUnitStudio.git`(Private, `master`)로 옮겼다** — 로컬 옛 원격은 `legacy`. `ModelBuilerStudio.git` 의 `master` 에 옛 MU 코드가 남아 있다(정리는 사용자 결정).
  세 저장소에 시험용 샘플: 엔진 `csv/`·`samples/`(기존) · MB Studio `samples/3454-35020-A505080` · MU Studio `samples/3496-35210-A508372`. ⚠ 엔진 저장소 `HiTessModelBuilder.git` 은 **Public** 이라 사내 CSV 가 공개돼 있다(2026-11-03 확인, Private 전환 권함).
  리뷰에서 '고치면 좋음'으로 남긴 엔진 항목: 과학 표기 양수 지수 부호 빠짐(`BdfField.FormatPrecise`, 1e6 이상) · `edited/` 교체 실패 시 옛 결과 유실 · 옛 무게중심 intent null 예외.
- **남은 일**: 화면 눈으로 확인 안 함(0.0.113~0.0.116 편집 도구, 0.0.117~0.0.119 도움말·셸 정리·아래쪽 패널은 사용자 확인 중) ·
  3529_m04 실모델 미확인(이 PC 에 없음) · 단면 변경 커밋·푸시(2026-10-29): Studio `a4da5e5`(model-studio 브랜치) · 엔진 `959493f` · WorkBench 계약 테스트·핀·`studio-release.md`
  (커밋 전 독립 리뷰 마침 — 막아야 함 0) · 0.0.122~0.1.3 화면 눈으로 확인 안 함(0.1.1~0.1.3 질량 추가·값 수정은 사용자 확인 중) ·
  **145 남은 일(2026-10-29 세션 끝)**: `git pull` + 재시작 1회(`dd8f576` fallback 제거) → InHouse `Cmb.Cli.exe`(sha256 8055258d…) 교체 →
  `/studio-release model-studio`(0.1.3) → ⟳ Update. 커밋: 엔진 `2216d6a` · Studio `dbe878e`·`556a1c4` · WorkBench `dd8f576`·`8b165ab`·`8c3f651` ·
  단면 변경의 '기존 PBEAML 복사 후 치수 수정' 미구현(카탈로그 = L 만) ·
  계획의 나머지(RBE 종속 수정, 하류: BDF 편집 요약 주석·CSV 탭 '편집으로 삭제됨'·
  판정 재계산) · 질량 요약 오버레이가 편집을 반영하지 않음(기존 한계).

**Analysis 탭 재설계 (2026-11-09~10, Studio 0.1.5~0.1.8, 릴리스 표 0.1.8 `4ed1896`)** — 초보자가 따라 하도록 ① 고정 ② 힘 ③ 중력 → 푸터 [해석 실행] → 결과.
Load Case 단계 없음(스토어 `effectiveLoadCases`: 기본 '모두 한 번에', 접힌 '해석 케이스'에서 '하중마다 따로'). 고정·힘은 Edit 와 같은 아래쪽 작업 패널(`panels/analysis/AnalysisWorkPanels.jsx`, 확인 창 없음).
사용자 결정: 힘 단위 N · 중력(자중) 기본 꺼짐. 서버로 보내는 형식은 그대로. 규칙·결정 원본 = Studio `docs/shell-conventions.md` 12번.
- 확정한 항목만 실행·페이로드에 넣는다(`committedInputs` — 고르기만 한 항목이 해석에 들어가던 리뷰 '막아야 함').
- 0.1.6: **노드 클릭이 고정·힘에 안 들어가던 결함(0.1.4 부터)** — ThreeViewport 클릭 처리기가 첫 렌더의 `onPick` 을 굳혀 Model 탭에서 연 모델은 Analysis 에서도 일반 선택이 됐다 → `onPickRef`.
- 0.1.7: 자동 변형 배율이 늘 ×1 — `modelDiagonalMm` 이 실제 bbox 모양(`minX…`)을 못 읽었다(테스트 가짜 bbox 도 틀린 모양이었다). 경계조건·힘 표식은 모델 대각선 비례(`overlaySizes`, 예전 값이 상한).
- 0.1.8: 힘 화살표 꼬리에 크기 라벨(`collectForceLabels`, 노드 12개 넘으면 첫 노드에 '× N').
- 상태: 145 ⟳ Update 는 사용자 몫. WorkBench 앱 안 화면·실제 Nastran 해석은 눈으로 확인 안 함(헤드리스 Chrome 실제 클릭·캡처까지).
  ⚠ 2026-11-09 저장 중 `AnalysisInputOverlay.js`·테스트가 통째로 NUL 바이트가 된 일이 있었다(원인 미상, 커밋본으로 복구) — 이상하면 `tr -d '\000'` 로 먼저 본다.

**3D 위 자리 규칙·다크 전용 (2026-11-10, Studio 0.1.9 · MU 0.0.208, 릴리스 표 `b316b43` = 145 공개(⟳ Update 는 사용자 몫) · 두 Studio 저장소 코드는 미커밋)** — `/design` 전체 검토(25/40, 화면 실측) 후 사용자 결정 4건.
규칙·남은 P2 원본 = Studio `docs/shell-conventions.md` 13번, 진단 기록 = Studio `.impeccable/critique/2026-11-10T01-56-01Z__src-app-jsx.md`.
- **다크 전용** — 테마 단추 삭제, `palette()` 는 인자를 무시(MU·Mooring 과 같음). 컴포넌트의 `theme === 'light'` 분기는 타지 않는 옛 코드.
- **알림 = 칩**(`components/ViewportNotices.jsx`, 뷰 도구줄 아래 줄) — 분리 그룹(Model 탭, [Model Check 에서 잇기]) > 장비 COG > CSV 빈 자리. 위쪽 가운데 띠는 없앴다.
  화면의 CSV 문제 수는 '모델에 없는 행'(탭 배지 = 아래 도크 머리) 하나, 칩은 '곳'을 센다.
- **작업 패널은 뷰포트 그릇 안**(`WorkPanelFrame` 이 `data-viewport-root` 로 portal) — 떠 있는 동안 조작 안내줄 숨김. 범례는 늘 bottom 46.
- **색** — 편집 선택 = 흰색 + 어두운 외곽, 그룹 1(본 구조) = 회청색(그룹은 요소 수 내림차순이라 1번이 본 구조). 주황은 편집 도구에만.
- Model Check 는 떨어진 그룹이 있으면 '자동 연결'이 그룹 목록 위. '표시' 도크 자동 펼침은 창 폭 1400px 이상만. `EDIT MODE` 배지·Analysis 위쪽 안내줄·`InputAuditPanel.jsx`·`BottomReviewDock.jsx` 삭제.
- 상태: zip 0.1.9 = 70 로컬·UNC(검증 MATCH) · 핀 0.1.9 · 릴리스 표 0.1.9(`b316b43`, Update History 항목 포함). Studio 저장소·WorkBench 핀·이 문서는 미커밋, 커밋 전 독립 리뷰 미실행.
  헤드리스 Chrome 세 폭(1600·1280·1024)에서 겹침 측정까지 — WorkBench 앱 안 화면·Analysis 노드 클릭 흐름은 눈으로 확인 안 함.
- **MU 에도 옮김 (같은 날, `/studio-sync`, MU 0.0.206~0.0.208 · 릴리스 표 0.0.208 `b316b43` · Studio 저장소 미커밋·핀 0.0.208)** — 싱크 대장 9~12·14·15번 도입함, 13번 해당 없음.
  0.0.207~0.0.208 = **그룹 목록을 MB 모양으로**(사용자 요청 '모델 빌더 스타일로 다') — Model Check·Edit 둘 다 [전체 표시] [전체 숨김] + 색 카드 한 줄, Edit 는 오른쪽 휴지통.
  MU 의 '그룹 관리' 상자(기준 전환·확인·단독·그룹 새로고침)는 없앴다 — 되살리지 말 것. 부재 종류(구조·배관) 삭제만 목록 아래 '부재 종류로 지우기'로 남김. Edit 구역 이름 = '그룹'.
  옮긴 것 = 편집 선택 흰색(부재 굵기는 화면 픽셀 기준) · 그룹 1 회청색 · 작업 패널을 뷰포트 그릇 안으로 · 분리 그룹 칩(MU `components/ViewportNotices.jsx`, Model 탭, 막지 않음) ·
  Model Check 자동 연결을 그룹 목록 위·펼친 채 · '표시' 도크 자동 펼침 1400px 이상 · 뷰포트 머리 `N: E:` 삭제. 상세 = MU `docs/plans/2026-10-29-mb-features-to-mu.md` '3D 위 자리·선택색'.
  확인: MU 테스트 1010건·빌드 통과(lint 는 예전부터 있던 15건 그대로), MB 샘플 3454(그룹 9개)를 넣은 헤드리스 캡처. WorkBench 앱 안 화면은 눈으로 확인 안 함.
  ⚠ MU 그룹 줄을 누르는 것은 **숨김**이고 해석 모델에서 빠지지 않는다 — 지우려면 Edit 탭 오른쪽 휴지통(2026-11-10 사용자가 숨김을 삭제로 알고 해석해 FATAL 9050, 3469 M02 그룹 2).
- **프로그램 비정상 종료 문구 (2026-11-10, 미커밋)** — 외부 프로그램이 Windows 예외(종료 코드 ≥ 0xC0000000, 예 3221225477 = 0xC0000005)로 죽으면
  '입력 모델 문제가 아니라 실행 환경 문제' 로 안내한다. 판정·문구 원본 = 백엔드 `app/services/exit_codes.py` ↔ 프론트 `utils/abnormalExit.js`(사본, +테스트).
  적용 = 권상 BDF 검증(`groupmoduleunit_service`, 결과에 `abnormalExit`) · 구조 해석 편집 적용(`unit_structural_service`) · GMU 판정 카드(`gmuLiftingVerdict` `jobLog`)·알림. 다른 앱의 실패 경로는 아직 예전 문구.
  반영 = 145 `git pull + 재시작`(백엔드) · 판정 카드·알림은 다음 exe. 프론트 lint 는 `@eslint/js` 미설치로 못 돌림.

**장비 COG 위치 오류 `EQUIPMENT_COG_FAR` (2026-10-27)** — 장비 CSV 의 `cog` 가 잘못 나오면(실례 3529_m04 `=30137/754429` 715 kg, X 만 50 m 어긋남)
엔진이 그 좌표에 COG 노드를 만들고 부착점과 RBE2 로 묶어, Studio 에 모델 밖으로 길게 뻗은 RBE 가 생긴다. 같은 오류가 `3592_m10`(`=21945/1855177` 153 m)에도 있다.
- 엔진 `FinalValidationStage.CheckEquipmentCogDistance`: 장비 RBE 의 COG ↔ 가장 가까운 부착점 > **5 m** 면 **Warning**(모델은 그대로).
  기준 근거: 리뷰 모델 장비 80행 중 정상은 ≤1.4 m, 오류는 47~153 m. 질량 0 장비는 엔진이 RBE 를 만들지 않아 대상이 아니다.
  ⚠ 최종 JSON(`<designName>.json`, Studio 의 '07 Final')의 진단은 모델 상태로 **다시 계산**해 단계 경고가 빠진다 —
  Studio 는 Final 을 기본으로 열고 편집하므로 `CliCommands` 가 이 경고만 Final 에 이어 붙인다(`EquipmentCogFarOutputTests`).
  사용자가 꼭 봐야 할 단계 경고를 새로 만들면 같은 자리에 추가할 것.
  메시지 키 `SourceName=…; distance=…mm; massKg=…; cog=(x, y, z)mm` 를 `utils/modelValidation.js` `parseEquipmentCogFar`(WorkBench·Studio 사본)가 읽는다.
- WorkBench: 판정 '검토 필요'(`equipment-cog-far`, 편집 모델에 그 장비 RBE 가 sourceName 으로 남아 있을 때만) + 진단 카드.
- Studio(0.0.98, 핀 동기화): 뷰포트 상단 알림 · 그 RBE/COG 노드/장비 질량에 마우스를 올리면 말풍선 · 클릭하면 카드의 [삭제…] → 확인창 →
  `deleteRigid { removeMass: true }`(RBE + COG 노드 장비 질량 + 고립 COG 노드 제거). Model Check 진단 목록 '입력값 오류' 필터에도 [삭제…].
  바른 수정은 CSV cog 를 고치는 것이라 확인창에 질량이 함께 빠진다고 알린다.

**CSV 추적 — 빈 공간이 CSV 의 어느 줄 때문인가 (Studio 0.0.101, 2026-10-27)** — 레이어 'CSV 추적'(기본 켬), 엔진 변경 없음.
⚠ **"제외된 행 = 빈 공간" 이 아니다.** 3542_35320 의 길이 0 TEE 7건(pos=apos=lpos=p3Pos 한 점)은 앞뒤 직관이 교차부를 이미 채워
빈 공간의 원인이 아니었고, 실제 빈 공간(N74↔N173, 270 mm)은 CSV 에 **행이 아예 없는** 구간(14행 OD 318.5 끝 → 15행 FLAN → 94행 OD 508 시작)이었다.
없는 행은 그릴 수 없으므로 **끊긴 양 끝이 CSV 몇 번째 줄에서 끝나는지**를 보여 주는 것이 중심이다.
- ① 끊긴 배관 `data/pipeGaps.js`: 배관 끝(연결 1 + RBE 없음) 두 개가 1.5 m 안에서 **서로를 향할 때만**(바깥 방향 30° 이내, 벤트·드레인 오인 방지),
  서로 가장 가까운 짝 하나. 양 끝 CSV 행 = 요소 sourceName ↔ 감사 name 중 끝 좌표에 가장 가까운 줄, 사이 행 = 두 끝 상자 안 좌표.
  편집 미리보기에서 addRigid 로 그 끝을 이으면 표시를 거둔다. 실모델 3542_35320 에서 정확히 1곳.
- ② 제외 행 상자 `data/excludedRowGhosts.js`: 영역 = CSV `wvol` → 없으면 좌표 칸 범위(60 mm 미만은 픽용 확대). 정상 제외(질량 0 장비 등)는 빼고,
  **모델 부재가 지나가는 상자도 뺀다**(`ghostsOutsideModel`). 사유 문구는 WorkBench `REASON_LABELS` 사본. 회전 편집이 있으면 ②만 숨김(CSV 좌표와 어긋남).
- 표시 `three/ExcludedGhostOverlay.js`(`buildCsvTraceOverlay`) · 말풍선 `components/ExcludedRowTooltip.jsx` — 모델 부재가 안 잡히는 자리에서만 픽, 클릭 고정.
- **CSV 탭 (Studio 0.0.104, 2026-10-27)** — 하단 도크에 숨어 있던 변환 감사를 상단 탭으로 올렸다(사용자 요청: 잘 안 보이고 CSV 모양이 아님).
  배치 = 상단 `CSV ⚠n`(모델에 없는 행 수) → 왼쪽 `panels/CsvPanel`(파일별 요약·선택한 행의 원문 칸 전부·[3D에서 보기]·[원문 줄 복사]) |
  가운데 위 3D / 아래 `csv/CsvSheet`(하단 도크 자리, 위 경계로 높이 조절 — 비율 localStorage). 시트는 **CSV 칸·줄 순서 그대로**,
  왼쪽 줄·상태·name / 오른쪽 '모델 대응' 고정, 좌표는 숫자만(원문은 패널·툴팁), 보이는 행만 그림. 행 클릭·Enter = 강조 + 카메라, ↑↓ = 강조만,
  3D 부재 클릭 → 그 행으로(사용자 선택·카메라 유지). 대응 기준 = 활성 뷰포트 단계. [닫기]·Esc(0.0.105) = 들어오기 직전 탭(`modeBeforeCsv`)으로 돌아가 3D 원래 크기 + CSV 행 강조 해제. 자료 = `hooks/useCsvData`(모듈 캐시) + `data/csvSheet.js`(+test),
  상태 = `store/useCsvSheetStore`(`openCsvRow`·`openCsvTab` — 알림·말풍선·Model Check 진입점). 하단 도크 '변환 감사' 는 요약 + 이동 버튼만 남겼다.
  `InputAuditPanel.jsx` 는 이제 어디서도 쓰지 않는다(옛 `BottomReviewDock.jsx` 만 참조 — 둘 다 정리 후보).
- ⚠ **1점 TEE 는 '제외' 오류로 유지한다 (사용자 결정 2026-10-27)** — CSV 의 TEE 는 두 형식이 섞여 나온다: 3점 TEE(apos·pos·lpos·p3Pos 가 따로,
  엔진이 직관 2 + 분기 1 로 모델링)와 **1점 TEE**(네 좌표가 교차 중심 한 점 → `zero_length_pipe` 제외). 1점 TEE 는 앞뒤·분기 배관 행이 그 점에서
  직접 이어져 모델이 끊기지 않고 질량도 0 이지만(리뷰 모델 36개 중 35개가 배관 끝 3개 이상 만남), **CAD 쪽 모델링 방식의 문제라 사용자에게 알려야 하는
  항목**이다. '접합점' 같은 정상 분류로 바꾸거나 문제 건수에서 빼지 말 것(그 제안을 사용자가 거부했다).
- **CSV 행 ↔ 모델 대응 (Studio 0.0.102)** — `data/csvRowMapping.js` `mapCsvRows`. ⚠ **이름만으로 맞추지 말 것**:
  CSV 는 한 부품을 여러 줄이 같은 name 으로 쓴다(3542 는 127행 중 44행). 예전 표는 제외된 TEE 줄이 옆 줄 TUBI 부재를 `E×1` 로 가리켰다.
  규칙: 직선 행 = 시작–끝 직선 위(수직 ≤50 mm)에서 구간이 겹치는 부재(엔진이 끝을 늘여도 맞음) · 곡관 = 시작·끝·p3Pos 범위에 한쪽 끝 ·
  그 밖 = 같은 이름 질량점/RBE(행 좌표 1 m 안) · U-bolt 는 150 mm 안 다른 이름 U-bolt RBE 를 '추정'으로 · 없으면 첫 단계 trace
  `ElementSkipped` 문구('질량 8.2kg 누락: CoG 10mm 내 유효 부착 노드 없음') → 첫 단계엔 있었으면 '엔진 처리 중 지워짐' → '대응 없음'.
  제외 행은 그 자리(wvol)를 채우는 다른 행을 '이 자리에는 22행 TUBI 부재가 있음' 으로 알린다. 행 클릭은 `pickedEntity.sourceName` 에
  `elementIds·massIds·rigidIds·box·csvLine·mapLabel` 을 실어 **그 번호만** 강조·포커스하고, 모델에 없으면 그 자리에 점선 상자.
  실측: 3542 → 부재 72·질량점 33·RBE 10·제외 9·지워짐 3 / 3529 → 부재 491·질량점 96·RBE 145·제외 21·지워짐 8·엔진이 뺀 장비 5.
- **장비 질량 누락 → 입력 감사 `error` / `equipment_mass_not_attached` (엔진, 2026-10-27)** — 질량이 있는데 부착 노드를 못 찾으면
  (`BuildEquips`: interPos 10 mm 안 노드 없음, 또는 interPos 없이 CoG 10 mm 안 노드 없음) 엔진이 질량을 뺀다. 예전엔 trace 에만 남고
  입력 감사는 'converted' 라 WorkBench 판정이 못 잡았다(3529_m04 5행 84.2 kg). 이제 `FeModel.DroppedEquipment` → `InputAuditJson.Build(…, droppedEquipment)`
  가 그 행(같은 name 의 첫 converted 장비 행)을 error 로 바꾸고, 판정 `massBearingExclusions` 가 그대로 '검토 필요' 로 잡는다. 사유 문구는
  WorkBench `REASON_LABELS`·Studio `excludedRowGhosts.REASON_LABELS` 사본('장비 부착 노드 없음 — 질량 누락'). 테스트 `EquipmentMassDroppedAuditTests`.
- 남은 후보: 3D 부재 클릭 → 정보 패널에 CSV 줄 표시·표 해당 행으로 이동(CSV 탭에서는 이미 됨, 다른 탭에서도 할지).
- **배포·커밋 상태 (2026-10-27 세션 끝)** — 로컬(70)만 반영: InHouse `Cmb.Cli.exe`(sha256 04ae662a…, 백업 `.bak_20261027_before_cogfar`)·
  `NastranBridge/nastran_bridge.py`(백업 동일 접미사)·StudioProgram `model-studio-0.0.105`(로컬·UNC)·핀 0.0.105. **145 미반영**
  (zip 0.0.105 → exe·bridge 수동 교체 → WorkBench 프론트 재배포, 백엔드 재시작 불필요). **3개 저장소 미커밋** — WorkBench·ModelBuilderStudio·
  HiTessModelBuilder(→ 2026-10-29 커밋·푸시, 위 'git' 줄). `WorkBenchSubModule/Nastran_bridge` 는 git 저장소가 아니다(InHouse 사본이 실사용본, 같은 날 BAILOUT 제외까지 반영). 커밋 전 `hitess-code-reviewer` 미실행. Studio 화면은 사용자가 일부 확인(COG 말풍선·CSV 탭), 나머지는 눈으로 확인 안 함.

**RBE 노드 공유 규칙 — 추적 결과와 다음 작업 (2026-10-27)** — 사용자 고민: 간격 메움 RBE(엔진 FREE_END·GROUP_CONNECT·LOOP_CLOSE, 대부분 ≤170 mm)가 촘촘해
COG 노드 + 질량을 두고 주변 부재에 RBE 로 묶기가 어렵다(3529_m04 구조 노드 677 중 370개(55%)가 이미 RBE 에 걸림, 그중 cm=123456 274개 · U-bolt 부분 cm 96개).
- Nastran 실측(MSC 2013): **금지는 종속 중복뿐**(FATAL 5289 "DEPENDENT DOF … ON MORE THAN ONE MPC OR RIGID ELEMENT"), 사슬(종속 → 다른 RBE 의 독립)은 정상 해석.
- 프로젝트는 더 엄격한 **"한 노드 = RBE 하나"** 를 지킨다: 엔진 `RigidSharedNodeMergeStage`(Union-Find 병합, cm 합집합) · bridge `add_rigid_from_params`/`normalize_rigid_node_sharing`(흡수 병합) ·
  Studio '병합 연결'(`computeRigidMerge`). 반면 **C# `ApplyAddRigid` 는 점유 종속을 조용히 빼고 사슬은 그대로**, Studio 점유 검사(`collectOccupiedRbeNodes`)도 종속만 본다
  → 사슬 모양 RBE 가 **C# 경로=사슬, bridge 경로=병합** 으로 갈린다(편집 정합성 계약 위반, 미수정).
- 무게중심 RBE(`connectRigidCentroid`)는 RBE 멤버(독립+종속)를 전부 빼서(`collectRbeMemberNodes`) 위 모델에서 고른 노드 절반 이상이 빠진다.
- **추가 실측 (같은 날 FE 평가)**: RBE2 종속 노드를 **RBE3 독립 노드로 쓰는 것은 정상**(RBE3 종속은 COG 하나라 중복 없음). RBE3 독립 2점은 특이(FATAL 2038) —
  한 직선 위에 있지 않은 3점 이상 필요. 같은 1 t 질량에서 RBE2 스파이더는 연결점 사이 보를 강체로 만들어 처짐이 RBE3 대비 약 41% 작았다(연결점 하나 다름, 경향 비교).
  3529 U-bolt 111개 중 15개가 cm=123456 인데 공유 병합 흔적 0 — 의도(BOX 등) 미확인.
- **다음 작업(사용자 확인 대기)** — 방향을 바꿨다: 무게중심 RBE 에 **RBE2(단단한 장비) / RBE3(질량 분배) 선택지**를 두는 것이 1순위
  (강성 왜곡과 'RBE 에 걸린 노드에 묶기 어려움'을 함께 해결, Studio·C#·bridge·계약 테스트 동시 수정, 새 intent 또는 addRigid 확장).
  RBE2 를 고를 때만 cm=123456 RBE **흡수**(deleteRigid + 합친 종속, 같은 batchId, U-bolt 제외), 일반 연결의 사슬도 흡수로 맞춰 C#/bridge 어긋남 해소.
  그다음 구조 CSV `weld`·`stru` 칸이 실제 연결 근거인지 조사(근거 없는 근접 연결 = '추정 연결' 표시), 대표 모델 cm 123456 ↔ 123 민감도 해석.
  검증: 계약 테스트 + 실제 Nastran. 시험 BDF 는 세션 스크래치패드에만 있었다(필요하면 다시 작성).
- **다른 Studio 로 넓힐지 검토 (2026-10-28)** — 10-27 MB 기능(CSV 탭·제외 행 상자·끊긴 배관·COG 경고·deleteRigid removeMass)은
  "입력 = CSV + 엔진 행별 변환 감사" 전제라 **MB 전용으로 둔다**(MU·SP 는 BDF 입력, Plate 는 직접 모델링, Mooring 은 행↔요소 대응이 없고 DIAGNOSIS.json 이 빠진 행을 알림).
  후보 2가지만 남겼다: ① MU·SP Model Check 에 'RBE 독립–종속 거리 > 5 m' 기하 경고(MB 가 만든 잘못된 장비 RBE 가 BDF 로 넘어오는 경우, 삭제 intent 없이 경고만)
  ② RBE 공유 규칙·무게중심 RBE2/RBE3 는 **MB 에서 확정한 뒤** MU·SP 로 이식(중복 방지 `collectDependentNodes` 가 MU=SP, MB 는 이미 갈라짐).
  MU·SP 의 `InputAuditPanel`·`AuditTab`(MB 사본)은 BDF 입력에서 늘 비어 정리 후보. Studio 목록은 메모리 `reference_all_studios`.
- 공유 설명 페이지(비공개, Share 필요): FE 평가 https://claude.ai/artifact/81RNFK7nSMSaSSy1eEBbYG ·
  'RBE 로 잇는 이유'(문의 응대용, 3529 간격 67~114 mm vs 부재 길이 중앙 378 mm) https://claude.ai/artifact/AKo9Y5qkwqWx6fzRbtH1QD
- **새로 받은 문제(미착수)**: 앵글(L) 부재가 다리 방향이 뒤집혀 보이는 경우를 바르게 표시. 확인할 것 = 화면이 Patran 등에서 연 BDF 인지(그러면 BDF 방향 벡터 문제 → 엔진),
  모델·부재 name. 구조 CSV `ori` ↔ 엔진 `BeamOrientation.Resolve`(평행일 때만 기본 규칙) ↔ BDF v 벡터 비교로 원인을 가른다.

**Aveva Marine 연동 독립 클라이언트 (2026-10-30 구현, 145 반영 — 접수·전체 흐름 통과, Studio 안 편집·해석·저장 클릭 시험 남음)** — AM 버튼 → `HiTessMB.exe` → 서버 빌드 → 실행기 → Studio 까지 한 번에(실측 약 20초).
145 의 실행기 zip = 145 로컬 `StudioProgram\mb-launcher-<ver>.zip`(릴리스 표에 없음 → 최고 버전 — ⚠ `scripts/studio_release.py --all` 이 UNC 의 mb-launcher 를 표에 넣으려 한다(2026-11-06, 세 번 되돌림). `/wb-release` 때 그 줄은 빼고 커밋할 것, 145 = 0.1.1(WorkBench 아이콘·smoke 분리, 2026-10-30 사용자 반영·아이콘 확인), 복사는 사용자).
실행기 버전을 올리면 설치된 PC 도 다음 실행 때 새로 받는다. ⚠ `--smoke` 는 데이터 폴더(`MBLauncher\smoke-data`)·단일 인스턴스 잠금을 따로 쓴다 — 같은 잠금이면 smoke 종료가 사용자 Studio 창을 닫는다(2026-10-30 실제로 일어남). 70 로컬 zip 은 DRM 암호문이라 그대로 복사하면 깨진다 — 새 버전은 `AmLauncher\build.ps1 -OutDir <UNC>` 후 `verify-studio-zips.ps1 -ViewerId mb-launcher`.
계획서 `docs/plans/2026-10-28-aveva-marine-model-builder-client.md`(배경·결정표 D1~D6) · **구현 `docs/plans/2026-10-30-am-client-implementation-plan.md`(이것이 우선, 진행 상태 표)**.
구성 3개 — WorkBench 와 완전 별개(사용자 PC 에 WorkBench 불필요):
- 클라이언트 `C:\Coding\WorkBenchSubModule\HiTessMBClient\`(.NET 4.8, 별도 git) — 접수 후 실행기를 받아 띄우고 끝. 종료 코드 0·2~8(README).
- 서버 `app/routers/am_intake.py` `POST /api/am/submissions` — CSV 검사(sha256·인코딩·종류·행 수, DRM 검사 없음 — CSV 는 DRM 대상 아님) 통과 시 `task_execute_modelflow(program_name="AmToModelBuilder")` 로 빌드하고 `job_id` 반환.
  **AM 호출 1번 = analysis 기록 1건**(program_name·source `AmToModelBuilder`, 검사 실패는 Failed 1건) — 이중 집계 금지. 폴더 `<ts>_<사번>_AmToModelBuilder`. 같은 파일의 `GET /signup` = 미가입 사번 가입 페이지(`app/static/signup/signup.html`, 선택지는 RegisterModal 사본 — 테스트가 잡음).
- 실행기 `AmLauncher/`(Electron 40, viewer id `mb-launcher`, `build.ps1` → `StudioProgram\mb-launcher-<ver>.zip`) — WorkBench electron 코드 **사본**(원본 위치 주석, 공용 모듈화는 별도 작업). ⚠ `--server=URL` 처럼 `=` 로 붙여 넘길 것(Electron 이 URL 모양 인자 뒤 인자가 있으면 실행하지 않음) · 이름을 바꾼 exe 는 사내 보안 때문에 `no-sandbox` 로 띄운다(외부 페이지 이동·새 창 차단).
확정: 보고서는 2차(1차 = 모델 확인·편집·해석·결과·편집 BDF 저장).
확정(같은 날): 대상은 WorkBench 를 안 쓰는 AM 사용자라 **별도 클라이언트**(WorkBench 명령줄 모드 아님), AM 으로 돌려보내는 정보 없음(단방향).
호출 규약 `HiTessMB.exe <사번> --hull-no <호선> --stru <CSV> [--pipe] [--equip]` — 호선 필수·선종 없음·사번 형식 `^[A-Z]\d{5,7}$`.
미가입 사번(로그인 404)은 **웹 가입 페이지**(`<서버>/signup`, 기존 `POST /api/register` 사용, 관리자 승인 유지)를 자동으로 연다.
AM 개발팀 전달본 = UNC `[개인 자료]\권혁민 책임연구원\UnLock\HiTESS_ModelBuilder_AM연동_요청.docx`(같은 폴더 PDF 는 옛 내용).
Studio 는 `window.workbenchAPI` 만 보므로 클라이언트가 같은 API 를 주면 Studio 무수정 — 단 `finalizeEditedModel` 은 지금 `HiTessModelBuilder.jsx` 에 묶여 있어 이식 필요.

**호선 주석 (2026-10-20)** — Model Builder BDF **첫 줄**에 `$ HiTessModelBuilder: HullNo=3454` 를 남긴다(해석 무관).
권상(GMU)에 올라온 BDF 를 LogBook 으로 보낼 때 호선을 알아내는 통로다. 입력은 **선택**: Model Builder 옵션의 '호선' 칸 →
비우면 CSV 파일명 앞 4자리(`^\d{4}` 뒤에 `-`/`_`, `5PPP_-…` 같은 예외는 제안 없음) → 둘 다 없으면 주석 없음.
**실행 전 호선 확인 창 (2026-11-06, 1.7.7)** — Model Builder(칸·CSV 파일명)와 GMU 권상(BDF 호선 주석·파일명)에서 호선을 못 찾으면 실행·검증 버튼(Ctrl+Enter·대시보드 자동 실행 포함) 때
`HullPromptDialog` 가 한 번 묻는다 — 창에서 적고 진행 / '호선 없이 진행'(막지 않음, 같은 입력이면 다시 안 물음). 규칙·문구 `utils/hullNo.js`(`needsHullPrompt`·`readHullNoFromBdfText`).
GMU 검증 라우트 2개가 `hull_no` Form 을 받아 `input_info.hull_no_source = user` 로 남기고 재실행·deck-fix·다시 검증·결과 다시 열기·최근 입력에서 이어받는다. 다른 App 에서 넘어온 서버 BDF 는 묻지 않는다.
서버 호선 주석 읽기는 대소문자 무시(화면과 같게). ⚠ 서버를 먼저 반영할 것 — 옛 서버는 화면이 보낸 호선을 조용히 버린다.
- 경로: 프론트 `hull_no` → `task_execute_modelflow`(`input_info.hull_no`/`hull_no_source`=user|filename) → `Cmb.Cli build-full --hull-no`
  → BDF 주석 + JSON `meta.hullNo` → `apply-edit-intent`·bridge `lift-run`(Wire BDF)이 다시 쓴다.
  GMU 검증은 `hull_no.resolve_bdf_hull_no`(주석 → 파일명)로 `input_info.hull_no`/`hull_no_source`=comment|filename 을 남긴다.
- 정규화 규칙(대문자, 영문·숫자·`-`·`_` 20자)은 C# `FeModel.NormalizeHullNo` · bridge `normalize_hull_no` · `app/services/hull_no.py` ·
  프론트 `utils/hullNo.js` 가 같아야 한다.
- ⚠ 옛 `Cmb.Cli.exe` 는 `--hull-no` 를 모르면 인자 오류로 실패한다 → 백엔드는 `engine_supports_hull_no()`(`--help` 확인, exe mtime 캐시)로
  지원할 때만 넘긴다. 그래서 서버에서 백엔드·엔진 반영 순서가 바뀌어도 깨지지 않는다(엔진 교체 전에는 경고만 로그에 남음).
- 계약 테스트 `test_engine_keeps_hull_no` 가 편집 BDF 첫 줄 주석을 확인한다(호선 이전 엔진이면 skip).
- 배포 상태(2026-10-20): 백엔드·프론트는 v1.6.20 으로 릴리스됨. **엔진 `Cmb.Cli.exe`·`nastran_bridge.py` 는 아직 InHouseProgram(70·145) 미교체** —
  소스는 `WorkBenchSubModule\HiTessModelBuilder`(미커밋)·`WorkBenchSubModule\Nastran_bridge\nastran_bridge.py`. 교체 전까지 BDF 에 주석이 안 남는다.
  권상 Wire 포함 BDF(lift-run)의 호선 주석은 단위 테스트만 했고 실제 권상 해석으로는 확인 안 함.

**⚠️ 교정/함정 (이번 재검토에서 발견)**
- **편집 BDF 포맷 fix 의 적용 범위**: `nastran_bridge.py` 의 BDF 포맷 수정은 ModelBuilder 편집에 **효력이 없다**(MB 편집 BDF writer 는 C# `Cmb.Cli.exe` 하나, 2026-10-29 fallback 제거). MB 편집 BDF 가 깨지면 C# 엔진을 고친다. Mooring/SidePassage 스튜디오의 apply-edit 는 `analysis.py` 가 nastran_bridge 를 **기본 경로로** 직접 호출 → 그쪽 BDF 는 Python fix 로 완결.

### Module Unit Studio

viewer id=`module-unit-studio`, 연결 메뉴 = "Group & Module Unit 권상 구조 해석".
- ★ **MU Studio 개선 요청을 받으면 먼저 `ModuleUnitStudio/docs/plans/2026-10-29-mb-features-to-mu.md` 를 본다** (2026-10-29 사용자 지시).
  MB Studio 의 셸 규칙·편집 작업 패널·도움말·기본 모델 편집을 MU 로 넓히는 단계(0 저장소 정리 → 1 셸 → 2 편집 바탕 → 3 편집 기능 → 4 도움말)와 결정 대기 항목이 있다.
  요청이 그 항목과 겹치면 MB 구현을 기준으로 맞추고 문서의 '진행 상태' 표를 갱신한다.
  ⚠ MU 는 Studio 가 JS 로 편집을 적용해 `_edited.json` 을 올린다(`buildEditedStageJson`) — MB 처럼 C#·bridge 에 새 kind 를 넣는 작업이 아니다.
- ⭐ **버전 정책 (사용자 지시, 무조건):** Module Unit 코드를 고치면(스튜디오든 엔진 `ModuleUnitAnalysis`든) **항상 `module-unit-studio` 버전 bump → zip 재배포 → `GroupModuleUnitLiftingAnalysis.jsx` 의 `MODULE_STUDIO_VERSION` 동기화**를 세트로 한다. 핀은 표시용 기본값이고 받는 버전은 릴리스 표(`studio_release.json`)가 정한다(2026-10-29) — 그래도 화면 표시가 어긋나지 않게 같이 올린다. 절차는 `/deploy` 스킬.

#### MB 와 사용법 통일 (0.0.175~0.0.179, 2026-11-02)

셸 규칙·선택·작업 패널·도구 막대·도움말과 편집(삭제·질량·단면·부재·노드)을 MB 와 같은 사용법으로 맞췄다. 사용자 지시: **두 Studio 의 사용 방법은 일관돼야 한다.**
상세·결정·남은 일 = `ModuleUnitStudio/docs/plans/2026-10-29-mb-features-to-mu.md`. 커밋 `134ef8f`~. 릴리스 표 **0.0.180**(`251812a`, 2026-11-02, UNC 업로드·검증됨) — 145 ⟳ Update 는 사용자 몫, InHouse 교체 없음. 화면은 Chrome + `workbenchAPI` 대역(샘플의 실제 엔진·Nastran 결과)으로 편집 전 작업·패널 3D 고르기·가서포트 설치·평가·해석 버튼까지 실행했다. WorkBench 앱 안 실행·수정 뒤 실제 Nastran 재해석은 확인 안 함.
- ⚠ **유체 제외 intent 는 메모리 밀도와 짝이다 (0.0.180, 2026-11-02)** — 회전처럼 보호한다(`STATE_BOUND_INTENTS`: 전체 초기화·Ctrl+Z·수정 내역으로 안 지워짐, Hoist 복원은 `removeIntent(id, { force: true })`). 전에는 기록만 지워져 화면·자세안정성은 유체 제외, 구조 해석은 원본 BDF(유체 포함, 샘플 6.99 t ↔ 11.93 t)로 갈라졌다(0.0.174 부터 있던 문제).
  평가·추천에서 `_edited.json` 을 올리면 `editedModelUploaded` 를 세워 내역이 비어도 해석 전에 다시 올린다.
  **남은 문제**: 서버 `<stem>_edited.json` 은 지우는 곳이 없어, Studio 를 다시 열어 편집 0건이면 이전 세션 파일이 구조 해석에 쓰일 수 있다(코드 경로만 확인, 재현 안 함. 고치려면 백엔드 호출 필요). MB 유체 항목도 같은 구조인지 조사 안 함.
- 사용 설명서 = `outputs/MB-manual`·`outputs/MU-manual`(git 미추적). **문서 버전은 Studio 버전과 별개**(사용자 지시, 2026-11-02) — 개선할 때마다 `outputs/manual-tools` 의 `node make.mjs <MB|MU> --bump "변경 내용" [--studio X]` 로 올린다.
  **MU 설명서 사용자 제공 (2026-11-09, 사용자 결정: 모달 포함 · git 에 넣음)** — `make.mjs` 가 PDF + 웹판(한 파일 HTML)을 만들고 `publish.py MU` 가
  ① 백엔드 `Manuals/module-unit/`(manual.html · **manual.pdf.gz** · manual.json, git 추적) → `routers/manuals.py`(`/api/manuals/{id}`, `/web`, `/pdf`, 로그인 필요) →
  GMU 페이지 배너 'Studio 사용 설명서'(`components/ui/StudioManualButton.jsx`, 모달 iframe srcDoc + PDF 받기) ② Studio `public/manual/index.html` →
  **상단 탭 줄 바로 뒤 '설명서' 버튼(초록) → 3D 옆 오른쪽 패널** `components/help/ManualDock.jsx`(0.0.200~0.0.201, 2026-11-09 사용자 결정 —
  도움말 메뉴 안 모달은 숨어 있고 화면을 다 가려 버렸다. 오른쪽 끝 버튼도 못 찾아 탭 뒤로 옮김). 탭 따라가기(기본 켬)·목차/지금 탭·폭 끌기(localStorage),
  쪽 이동은 iframe 을 다시 읽지 않고 `postMessage({manualSection})`(`data/manualSections.js`). 탭 `?` 팝오버·도움말 메뉴도 이 패널을 연다(도움말 창의 설명서 탭은 없앰).
  웹판은 폭 ≤760px 에서 A4 틀을 풀고 글을 다시 흘린다(`web_build.py` `@media`, 표지 숨김 — 넓은 WorkBench 모달은 그대로). 별도 창은 모니터 2대일 때만 이득이라 보류(exe 변경 필요).
  설명서를 고치면 publish 뒤 **Studio 버전 bump·배포**가 따라야 Studio 안 설명서가 바뀐다.
  상태(2026-11-09): MU `a76b250` · 릴리스 표 0.0.201(`352db9d`) · WorkBench 1.7.11 exe(`048a358`, GMU 설명서 버튼·CSP 글꼴) 빌드. 145 ⟳ Update+재시작·exe 배포는 사용자 몫,
  WorkBench 앱 안 Studio 창·Electron PDF 저장 대화상자는 눈으로 확인 안 함. 다음 후보: 실적 '크게 보기' 패널과 함께 열면 서로 폭을 몰라 3D 가 좁아짐 · 패널 단추 data-help.
  **MB 도 같은 방식 (2026-11-09, 사용자 지시 'MU 와 동일하게')** — `publish.py MB` → 백엔드 `Manuals/model-builder/` + Studio `apps/model-studio/public/manual/`,
  HiTESS Model Builder 배너 버튼(`manualId="model-builder"`) · Studio 0.1.4 `ManualDock`(MU 사본, 색만 `palette(theme)` — MB 는 밝은/어두운 화면) · 쪽 대응 `data/manualSections.js`(탭 csv → `csv`).
  설명서 문서 버전 02(기준 0.1.4): 코드 대조 검토로 Ctrl+드래그 = 선택 빼기·`RBE 만들기 (노드 N개)`·정보 도크 자동 열림을 바로잡음. 전체 화면 그림은 캡처 원본 모델이 없어 새 버튼 조각만 합성(원본 `source/probe/overview_v01.png`).
  설명서 패널로 3D 가 좁아지면 뷰포트 위 CSV·COG 알림이 세로로 깨지던 것 수정(`ThreeViewport` 알림 최소 360px). 다시 찍기 = `MB-manual/source/caps_manual.mjs`(5199 dev 서버 + `MB_MODEL=<상대 경로>`, 저장소 샘플 3454).
  상태: Studio `29d82d8` · WorkBench `87e4ea5`(설명서·버튼) · 릴리스 표 0.1.4(`467316d`) · WorkBench 1.7.12 exe(`5ea7430`) 빌드. 145 ⟳ Update·exe 배포는 사용자 몫, Electron 앱 안 화면은 눈으로 확인 안 함.
  ⚠ PDF 를 평문으로 git 에 넣으면 안 된다 — 이름을 .bin 으로 바꿔도 DRM 이 1분 안에 내용(PDF)을 보고 다시 감싼다(실측). gzip 은 감싸지지 않아 `.pdf.gz` 로 두고 서버가 푼다(`test_repo_manual_is_plain_pdf`).
- ⚠ `/studio-release` 의 출처 `release` zip 도 DRM 에 감싸질 수 있다(크기 +4096, `HHIDRMC`, 검증 `MISMATCH CORRUPT`, 0.0.180 실례). `dist` 를 메모리에서 묶어 UNC 에 직접 쓴다(`outputs/MU-manual/source/zip_to_unc.mjs`).
- Hoist 탭은 그대로 Shift+클릭 = 권상점, Edit 탭은 MB 규칙(클릭 = 하나, Shift = 넣기/빼기, Shift+드래그 = 사각형).
- ⚠ 뷰포트의 `stageData` 는 파생 모델(`data/nodeEdits.js`)일 수 있다. 질량 기준값은 `baseStage()` 원본으로 낼 것 — 파생으로 내면 증감이 두 번 들어간다.
- ⚠ 커밋 전 eslint 를 돌릴 것 — 렌더 시험·빌드가 통과해도 no-undef 로 화면이 터지는 것을 eslint 만 잡았다.
- 지운 부재·그룹·질량, 질량·단면·부재·노드 편집은 자세안정성 입력 질량에 반영된다(엔진은 `_edited.json` 을 질량에 쓰지 않는다).
- **원본 RBE 수정·삭제 (0.0.202, 2026-11-10, 릴리스 표 `cbe3180`)** — 도구 막대 RBE › 수정 · 삭제. intent `deleteRigid`(MB 와 같은 kind)·`editRigidDependents`(Mooring 과 같은 kind).
  ⚠ 두 편집은 **파생 모델(`nodeEdits.applyNodeEdits`)의 `rigids`** 에 들어간다 — 편집과 함께 RBE 를 읽는 새 코드는 원본 `stage.rigids` 가 아니라 `mask.stage`·`applyNodeEdits` 를 볼 것.
  수정 내역 중간 삭제로 종속이 겹치면 뒤쪽 RBE 편집을 함께 취소한다. 상세·결정 = MU 계획 문서 '원본 RBE 수정·삭제'.

#### 다른 Unit 권상 Wire 참조 (Hoist 탭, 0.0.183, 2026-11-04)

Hoist 탭 STEP 2 아래 '다른 Unit 권상 참조' — LogBook 에 확정된 Wire 모델(`_lifting.bdf`)의 훅·lug·Wire 길이·슬링각을 평면 그림 카드로 본다(**보기 전용**, 노드 번호를 지금 모델에 적용하지 않는다).
경로 = Studio `host.searchLiftingReferences`·`getLiftingReference` → Electron `viewer:searchLiftingRefs`·`viewer:getLiftingRef` → 백엔드 `GET /api/logbook/lifting-refs[/{id}]`(`logbook_link.py`, as = 로그인 사번) → LogBook `/api/integration/lifting-refs*`(LogBook 계획 50).
요약은 LogBook 이 BDF 구조로 만든다(apex = 병진 123 구속 + CROD 에만 쓰임) — JSON(`_lifting_meta.json`)에 기대지 않아 옛 자료도 찾는다. 계획·상태: `docs/plans/2026-11-04-mu-studio-logbook-wire-reference.md`.
상태(2026-11-04): 커밋 LogBook `43f0540` · WorkBench `63c2165` · MU `6311d7a` · 릴리스 표 0.0.183 `8460c44`(**미푸시, 사용자가 WorkBench 와 함께 푸시**). UNC 업로드·검증됨.
동작하려면 145 LogBook `git pull`+재시작(먼저) → WorkBench 백엔드 ⟳ Update+재시작 → **새 exe**(Electron IPC). 옛 exe 는 '업데이트 안내'만. WorkBench 앱 안 실행·실제 LogBook 연결은 확인 안 함.

**실적의 구조 해석 결과 보기 (0.0.190 · WorkBench 1.7.3 · LogBook 59, 2026-11-06)** — 실적 상세의 [해석 결과 화면으로 열기] → **별도 MU Studio 창, 읽기 전용 '실적 보기'**
(탭 Model·Model Check·Analysis 만, 상단 띠, 판정·숫자 패널 `ReferenceAnalysisPanel`, 3D 응력 색·결과 표는 보통 결과 화면 그대로, 전체 초기화 숨김).
- 재해석하지 않는다 — WorkBench 가 **Wire 모델과 함께 보낸 결과 세트**(결과 JSON + 해석에 쓴 모델 JSON(`_edited.json`, 없으면 `<stem>.json`) + F06)를 LogBook 이
  **같은 자료·같은 폴더·같은 stem**(대소문자 무시)으로 짝지어 `GET /api/integration/lifting-refs/{id}/result` 로 내준다(F06 내용은 안 줌). Studio 는 BDF·F06 을 못 읽어 모델 JSON 이 꼭 필요하다.
- Electron `viewer:openLiftingRefResult`(모델 JSON → `%TEMP%/hitess-lifting-ref/<id>/`, 결과는 세션 `reference`) · `viewer:getReferenceContext`. `viewer:open` 본체는 `openViewerSession(payload, extra)`.
  실적 창은 `parentAnalysisId` 가 없어 해석·업로드 IPC 가 거부된다. 판정은 `structuralVerdict`(FATAL 이면 실패, 문구는 실제 원인만 `referenceVerdictLabel`).
- 결과 세트 없이 Wire 모델만 보관된 실적은 '결과 없음' 한 줄. 2026-11-06 기준 LogBook 확정 실적 E000078 은 결과 없음(사용자가 WorkBench 결과를 전체 다시 보내기로 함).
- 계획·상태: `docs/plans/2026-11-06-mu-lifting-reference-stress-check.md`. 145 반영 확인(2026-11-06): 서버 1.7.4 · Studio 0.0.190 공개 · LogBook 결과 라우트 있음.
  WorkBench 앱 안에서 실적 창을 실제로 연 적은 없다(헤드리스 Chrome + 실제 3496 결과로만 확인).
- **후속 (2026-11-06 오후, 사용자 결정) — 상세·근거는 계획 문서 '후속' 단락**:
  - **열람 범위**: 권상 참조(목록·상세·결과)는 LogBook 레벨과 무관(LV1 포함)하게 확정 Wire 모델 전부, 차단(blocked)만 뺀다. LogBook 화면·BDF 받기 권한은 그대로(LogBook `lifting_refs.reference_visible*`). 결과 보기가 LV1 에게 모델 JSON 을 보이는 것도 사용자 확인.
  - **'내 모델' 탭** = All Projects 로 보낸 자료 중 실행자(origin.owner)·올린 사람·담당자가 나. LogBook `?mine=true` → 응답 `mine: true`(없으면 옛 서버 → Studio 가 막음), exe 표식 `liftingReferenceFeatures`(없으면 옛 exe → 탭 막음).
  - **결과는 같은 창에서**: 실적 3D 칸 [3D | 응력 | 평면 그림] — Electron `viewer:getLiftingRefResult`(1.7.10~) → Studio `referenceStressScene`. 초과 구역 확대(구역별 빨간 상자, ‹ ›). 새 창은 '결과 표까지 보기' 보조 링크, 창은 하나만 재사용(노란 테두리·`[실적 · 읽기 전용]` 제목).
    같은 창에서 내 모델과 바꿔치기하는 안은 버렸다(Studio 저장소가 창마다 하나라 사용자 편집·결과를 덮는다).
  - ⚠ 굵은 선(LineMaterial) 꼭짓점 색은 **선형**으로 넣는다(`utils/srgbToLinear.js`) — sRGB 그대로면 두 번 밝아져 초과 빨강이 분홍이 된다(실측).
  - 상태: Studio 0.0.197 · WorkBench 1.7.10 · LogBook `9d5a669` 커밋·푸시, 릴리스 표 0.0.197(`1dd61aa`). 145 반영(LogBook pull+재시작 → ⟳ Update+재시작 → 1.7.10 exe)은 사용자 몫. 실제 Studio 화면 안 버튼은 눈으로 확인 안 함.

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

#### Find(Ctrl+F) — Node/Element/RBE 를 ID 로 찾기 (ModuleUnit 0.0.167 · ModelBuilder 0.0.91, 2026-10-02)

뷰포트 우상단 찾기 바(툴바 `찾기` 또는 `Ctrl+F`). `data/findEntity.js`·`components/FindBar.jsx` 는 **두 Studio 에서 바이트 단위로 같다** —
한쪽을 고치면 복사하고 `diff` 로 확인할 것. 상세: `ModuleUnitStudio/docs/find-by-id-ctrl-f.md`.
- ⚠ ModuleUnit 뷰포트의 `focusEntity` API 는 회전 중심 고정 정책상 no-op 이고, **`source:'find'` 선택만** 카메라·회전 중심을 옮긴다.
  이 예외를 넓히면 결과 행 클릭이 카메라를 흔든다.
- 가서포트 Element 는 해석 스냅숏(`resultElements`)을 `extraElements` 로 넘겨 찾는다(원본 → 스냅숏 순).
- **다른 단계에만 있는 Element (ModelBuilder 0.0.97 · ModuleUnit 0.0.170, 2026-10-23)** — Find 는 활성 뷰포트 **단계 안에서만** 찾는다.
  진단 CSV(예: `HiTESS_ElementSplit_진단.csv` 의 SHORT_ELEMENT E3204)는 02 ElementSplit 에서 **분할로 생긴 번호**라 01 단계에선 "없음"이었다.
  이제 `traceElementAcrossStages()` 가 가장 가까운 단계에서 찾고 `parentElemId` 체인(목록에 없는 중간 번호는 그 단계 `trace` 의 `ElementSplit`/`ElementCreated`)으로
  현재 단계의 원래 요소를 잇는다 → 찾기 바에 [이 단계의 E81 보기] / [ElementSplit 단계로 이동]. 06 Validation 메시 조각은 원래 요소가 이미 쪼개져 '단계로 이동'만 된다.
  WorkBench 진단 카드도 같은 오해를 막는다(`utils/modelValidation.js` `describeElementOrigin`): 번호 옆 '(02 ElementSplit 결과 기준 번호)',
  '01 Preprocess에는 없는 번호입니다. 원래 요소는 E81이고, 부재 교차점에서 분할되어 생겼습니다 (N2384에서 E81·E2101 교차)', 진단 CSV 에 '원래 요소' 열.
  첫 단계 JSON 을 한 번 더 읽어 요소 번호 집합을 만든다(실패하면 그 줄만 빠짐).
  배포(2026-10-23): zip 은 로컬·UNC 반영, 핀 동기화, WorkBench v1.6.27(`d8b2d2c`) exe 빌드. **145 StudioProgram zip 수동 복사(exe 보다 먼저)·exe 배포는 사용자 몫,
  두 Studio 저장소(찾기 파일·package.json) 미커밋, 화면은 눈으로 확인 안 함.**

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

#### 중심점 RBE + 집중질량 (Edit › RBE 생성, 0.0.171, 2026-10-28)

SidePassageStudio 의 Point Mass RBE 를 옮겼다(노드 3개 이상 → 평균점에 새 GRID + RBE2 + 선택 CONM2(ton)). 상세·결정표: `ModuleUnitStudio/docs/centroid-rigid-mass-0.0.171.md`.
- intent 는 SP 와 같은 `addRigid { createIndependentAtCentroid, independentCoord, mass }`. **기본 위치는 산술 평균**(SP·bridge 기본 = 경계상자 중심)이라 값을 항상 `independentCoord` 에 박는다.
- 백엔드·bridge 무수정 — `_edited.json` 에 GRID·RBE2·CONM2 가 들어가 권상 해석·Wire BDF 다운로드·Save 탭 BDF 에 모두 반영된다(실모델 Nastran 확인, 하중 +5 t 정확).
- ⚠ 자세안정성 엔진은 `_edited.json` pointMasses 를 안 읽는다 → Studio 가 `_posture.json` 질량·COG 에 편집 질량을 더한다(`withEditedMasses`, `massSource …+editedPointMass`).
  질량 패널·하중 조건·COG 마커·권상 후보도 같은 함수. 평가 결과에서 온 COG 에는 다시 더하지 말 것.
- 이미 RBE 에 걸린 노드(독립·종속)는 종속에서 뺀다. RBE2/RBE3 선택은 MB 확정 후 이식(위 'RBE 노드 공유 규칙').
- ⚠ `_posture.json` 에 편집 전 `baseTotalMassTon`·`baseCenterOfGravityMm` 을 함께 싣는다 — Studio 가 폴더의 posture/stability JSON 을 질량 요약으로 다시 읽을 때 이중 합산 방지.
- 화면(사용자 지적 반영, 0.0.172~0.0.174): 연결선 노란 실선, 중심점은 화면 고정 크기 점(월드 크기 구·상자는 확대 시 주변을 덮음),
  회전 중심(`applyCogPivot`)에는 편집 질량을 넣지 않음(넣으면 RBE 만들 때마다 카메라가 튐), Shift 다중 선택은 노드 번호 라벨 없이 편집 패널에 번호 나열.
- 배포 상태(2026-10-28 세션 끝): zip **0.0.174** 로컬·UNC + 핀 동기화. **145 미반영**(zip 수동 복사 → WorkBench 프론트 재배포, 백엔드 재시작 불필요).
  ModuleUnitStudio·WorkBench 핀·이 문서 **미커밋**. 독립 리뷰 1회(막아야 함 1건 수정) 후 0.0.172~174 화면 수정은 리뷰 안 함. 사용자가 화면을 보고 만족 확인(최종 0.0.174 의 라벨 변경은 눈으로 확인 안 함).

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
- **가서포트 PBEAML 의 PID 는 구조 구간 안 다음 번호다** (`suggestNextPropertyId`, 2026-11-02 MB 와 맞춤 — 예전 2026-09-17 결정 '최대값+1' 은
  배관 구간(≥101)으로 넘어가 보고서가 배관색으로 칠해 바꿨다). 레거시
  `BdfToCsv.py` 의 매직넘버 **PID 1000** 을 예약하지 않는다 — 기존 모델이 이미 그 번호를 쓰고
  있을 수 있고(실제로 `3370_M04.bdf` 의 1000 번이 그 모델의 가서포트다), 단면 3종이라 가서포트
  PBEAML 이 최대 3장이라 단일 번호로는 담기지도 않는다. 가서포트 식별은 요소의
  `remark: '가서포트'` 로 한다.
  ⚠ 그래서 **스튜디오가 낸 BDF 를 레거시 `BdfToCsv.py` 에 넣으면 가서포트를 못 찾는다.**
  그 경로 대신 스튜디오의 "가서포트 CSV 내보내기" 를 쓸 것.
- ⚠ **구조 해석 결과의 elementId 는 '편집 모델' 기준이다** (2026-09-28). 가서포트는 원본 `stageData.elements`
  에 없어서, 결과를 원본에서만 찾으면 응력 색·결과 표 행 클릭·3D 선택이 조용히 빠진다(실제 장애).
  해석 실행 순간 `snapshotResultElements()`(`data/resultElements.js`)가 편집 모델에만 있는 부재를 떠서
  `useUnitStructuralStore.resultElements` 에 결과와 함께 둔다 — 결과를 조회하는 곳은 **원본 → 이 스냅숏** 순으로
  찾을 것(`buildResultElementIndex`, `buildElementsHighlight` 의 `fallbackElements`, 오버레이 `pickTargets`).
  결과가 있는 가서포트는 청록 미리보기 선(renderOrder 999)을 빼야 응력 색이 보인다.

#### Wire 포함 BDF · 결과 OP2 다운로드 (Analysis/Save 탭, 2026-09-28)

- **Analysis 탭 '해석 파일'** = Wire 포함 BDF(자세안정성 PASS/WARN 후 활성) + 결과 OP2(구조 해석 성공 후).
  **Save 탭**에도 OP2. 편집 모델 BDF(Wire 없음, `BdfExportSection`)는 Save·Edit 탭에만 남겼다.
  활성 조건은 `utils/structuralDownloads.js`(순수 함수 + 테스트).
- 백엔드: `POST /api/analysis/unit-structural/lifting-bdf` · `GET /api/analysis/unit-structural/{id}/op2`.
  Electron IPC: `viewer:downloadLiftingBdf` · `viewer:downloadUnitOp2` (저장 대화상자는 main 이 띄운다).
- ⚠ **BDF 와 OP2 가 짝이 맞게 하는 규칙**: 해석 전 BDF 는 해석 실행과 **같은 함수**
  `unit_structural_service.build_lifting_bdf()` 로 **임시 하위 폴더**에 같은 파일명으로 만들어 내려준다
  (실측: 해석본 `_lifting.bdf` 와 바이트 동일). 해석 성공 후에는 `analysisId` 로 **실제로 푼** `_lifting.bdf`
  를 준다. Studio 는 해석 전 다운로드 때도 `syncEditedModel()` 로 현재 편집을 먼저 올린다 — 안 올리면
  서버의 옛 `_edited.json` 으로 만든 BDF 가 나간다. 임시 폴더를 `<stem>_lifting.*` 자리에 쓰지 말 것
  (해석 task 가 그 glob 으로 이전 산출물을 지운다).
- OP2 는 lifting BDF 의 `PARAM,POST,-1` 산출물(Nastran 이 **소문자 파일명**으로 씀 → `find_lifting_op2`
  가 대소문자 무시로 찾는다). `result_info.liftingOp2` 는 이 기능 이후 실행분부터 있고, 이전 결과는
  `liftingBdf` 옆에서 찾는다. 두 라우트 모두 `read()` 바이트로 응답한다(DRM Content-Length 함정).
- **WorkBench 쪽(Studio 를 안 거쳐도)**: Step 3 `ResultArtifactsCard` 와 **My Projects 상세 모달**
  (GroupModuleUnit/SidePassage 부모 프로젝트)이 같은 카드로 `GET .../groupmoduleunit/{id}/artifacts` 를 쓴다.
  Wire 해석 전이면 `scan_lifting_artifacts(source_bdf=…)` 가 원본 BDF 를 `sourceBdf` 로 대신 준다.
  구조 해석 자식 레코드(UnitStructuralAnalysis)는 My Projects 목록에서 숨겨져 있어 이 카드가 유일한 통로다.

#### 권상 위치 자동 선정 — 핵심 동작·함정 (2026-07-01 세션, ★ 넓은 면적/PASS 관련)

- **Z 밴드(tolMm) 이중 용도 분리**: `hoistToleranceMm`(UI "가상판 ±값")는 **수동 선택 강조용**일 뿐인데, 과거엔 이 좁은 값(모델높이×0.004 ≈ 10mm)이 **엔진 자동 최적화의 Z 클러스터링 tol** 로도 재사용돼 같은 데크의 근소 Z편차 노드가 서로 다른 레벨로 쪼개져 **좁고 작은 그룹만** 나왔다. → `useEditStore.js zoneSelectHoistPositions`는 이제 auto 시 **`tolMm: null`** 을 보내고(사용자가 명시하면 그 값 존중), 엔진(`HoistPositionOptimizer.RunRegionsSearch`)이 **Z 밴드 스윕**(`BuildZBandSweep` = {60,120,200,300}mm)을 돌려 **축적된 후보 중 랭킹으로 '가장 넓은 PASS'** 를 고른다. (payload 직렬화 시 `Number(null)===0` 함정 주의 — `opt.tolMm != null` 가드 필수.)
- **면적 vs 상태(비단조)**: 밴드를 넓힐수록 면적↑ 이지만 **너무 넓으면 `wireConflictCount`(와이어 간섭)↑ → warn**(stage6 안정성 margin 은 오히려 동일). 실측(3496-35210-A508372): tol 10mm→3.07㎡ pass, 100→12.78 pass, 200→**16.84㎡ pass**, 350→2.38(붕괴), 500→23.72㎡ **warn(간섭29)**. 단일 고정 밴드는 keep-K/greedy 클러스터 경계 때문에 **비단조**라 스윕으로 회피. 스윕은 **조기 종료 없음**(모든 밴드 시도 후 랭킹) — 백엔드 `--optimize` 타임아웃 **300s** 이내(실측 ~15s).
- **2D 방향 = 앱 3D '평면도(A키)' 와 동일 = 화면 →X(종, 가로)·↑Y(횡, 세로)** (2026-10-01 사용자 요청으로 변경). 평면도는 `STANDARD_VIEWS.top.up=+Y`·−Z 내려봄 — ModelBuilderStudio(`three/viewportGeometry.js`)·ModuleUnitStudio(`three/viewportFraming.js`) **둘 다 같은 값**이어야 한다. 후보 썸네일(`HoistCandidateThumbnail` + `planViewProjector`)·구역 미니맵(`buildZonePartitionView`)도 같은 방향이라 세 화면이 일치한다(이전엔 평면도·썸네일이 ↑X·←Y, 미니맵만 →X·↑Y 였다). 형상 지표(면적/정사각형도/축편차)는 화면방향과 무관한 모델좌표 계산이라 불변.

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

**② 스튜디오 (React 뷰어)** — `C:\Coding\WorkBenchSubModule\MooringFittingStudio\` (로컬 git 만, `npm run package` 없음 → 수동 zip). `MooringFittingAssessment.jsx` 에는 **버전 핀이 없고** 백엔드 manifest 로 최신 버전을 동적으로 읽는다. 빌드·배포 절차는 `/deploy` 스킬.

**런타임 InHouse 의존 (서버 145 수동 반영 대상):** `InHouseProgram/MooringFitting/MooringFitting.exe` + `InHouseProgram/NastranBridge/nastran_bridge.py`(rbe2_fixed_lines 등 편집 BDF fix, `analysis.py` apply-edit 기본 경로) + `InHouseProgram/F06Parser/` + 외부 MSC `nastran.exe`.

⚠ **엔진·Studio 는 원격이 없고 코드가 70 PC 에만 있다** (2026-11-03 확인). 마지막 커밋은 엔진 2026-05-28, Studio 2026-06-15(0.1.59)이고 그 뒤 변경(Studio 0.1.73·엔진 9-04 exe)이 미커밋이다. 구현 전에 스냅숏 커밋부터 한다.

**정응력 상·하면 평가 (2026-11-03, P0-1 해소)** — `σ상면 = N/A − M1/Wt`, `σ하면 = N/A + M1/Wb`, 판정은 큰 쪽. 예전 식 `N/A + M1/min(W)` 는 하면만 본 값이었다.
부호는 NewCase_02 F06 회복점 응력 3.7만 station 과 0.0001 MPa 까지 일치 확인(I 상면 = C·F, T 상면 = D·F, `FiberStressTests` 에 고정). 엔진 `BeamForcePostProcessor.StrongAxisFiberStress` 한 곳이고,
CalcVerify 끝에 `Sn_Top,Sn_Bottom` 이 붙었다. 이 칸이 없는 옛 결과는 보고서가 '다시 해석하세요' 로 거절한다. ⚠ csv/NewCase_01·03 의 F06 은 BDF 보다 오래돼 대조에 쓰면 안 된다.

**재질별 판정 (2026-11-03)** — 규칙 원본 = 엔진 `SteelGrade`(`Core/Model`), 백엔드 `judge_member` 가 사본이라 **한쪽을 고치면 양쪽 다**.
- 등급: A·B·D·E 235 · AH·DH·EH·AH32·DH32·EH32·LT-60 315 · AH36·DH36·EH36 355 · 표에 없거나 비면 235 + '등급 미확인' 경고. **면별 판정(2026-11-03 사용자 결정)** — 상면(갑판 쪽)은 부착판 등급, 하면·전단은 보강재 등급(`SteelGrade.Resolve/JudgeFibers`, 백엔드 `judge_member_fibers`, 재질표 1.1 `plateGrade·plateYieldMPa`). 예전 '낮은 등급 하나' 는 AH 보강재 + A 갑판을 235 로 봐 계산서(보강재 315)보다 1.34배 엄했다. 3496 FORE: 재질 변경 20 → 12, 최대 1.711 → 1.527.
- 등급 칸(0부터): ANGLE·FLATBAR·TBAR 6·26 · PLATE·BRACKET below 6 · above 16. ⚠ above 의 6번 칸은 좌표다.
- 판정: OK / `MATERIAL_CHANGE`(일반 강재가 315 기준이면 만족) / NOT OK. 315 부재를 355 로 올려야 하는 경우는 NOT OK(사용자 결정). 전단 허용 0.6 × σy/γM.
- 흐름: build-full 이 `out/MEMBER_MATERIAL.json`(부재별 재질) → solve-bdf·report 가 이 파일만 읽는다(`MemberMaterialMap.LoadForModel`). 엔진이 만든 부재는 CSV 행이 없어 235 + 미확인, 보강 클론은 원본을 따른다.
  백엔드 `recompute_sigma_ny` 가 element 마다 `verdict` 를 붙이고 Studio `utils/verdict.js` 가 표시한다. σy 입력칸은 없앴다(`--yield` 는 재질표 없는 옛 결과의 일괄값). γM 은 그대로.
- NewCase 샘플 실측(SampleFile 호선 3516): OK 1,924 → 1,898 · 재질 변경 필요 26(전부 기존 OK) · NOT OK 35 그대로 · 최대 Usage 4.852 → 6.504(같은 E2121, A급).

**부재 ↔ CSV 행 대응 (2026-11-03)** — `element_names.json` 이 이제 엔진 출신 기록(`MODEL_EVIDENCE.json`)에서 나온다. 좌표 매칭은 겹친 부재를 첫 행으로 몰아 1,904개 중 160개가 틀렸다(증거 파일 없는 옛 결과에서만 폴백).

**CSV 행 단위 단면·재질 편집 (2026-11-03)** — Studio 편집 패널 '단면·재질 (CSV 행)'. 대상은 부재가 아니라 행이다(그 행의 조각이 함께 바뀜). intent `editCsvRow { csvLine, cells:{칸:값} }`.
`app/services/mooring_row_edit.py` 가 적용한다(`nastran_bridge` 수정 없음 — `git pull` 로 반영). 대상 요소는 서버가 출신 기록으로 찾고, 새 PBEAML 은 기존 치수에서 CSV 가 정하는 칸만 바꾼다(유효폭·갑판 두께 유지).
등급은 글자만 `mooring_solve.grades.json` 으로 넘기고 엔진이 `SteelGrade` 로 해석한다. '바뀐 행 CSV' = 원본 행에서 그 칸만 바꾼 글자(`utils/csvRowEdit.js`, BOM+CRLF). 3D 단면 표시·인스펙터 단면 값은 편집을 반영하지 않는다(해석 결과에는 반영).
실측: E2206 등급 B→AH(응력 불변) U 1.33 → 0.99 OK · E2121 웹 11→30 mm 재해석 U 6.50 → 4.15. 샘플 전 행 크기 편집 386행 예외·이상 치수 0.
⚠ 겹친 부재 병합(01_CollinearOverlap)으로 출신 행과 다른 행의 단면을 쓰는 요소가 있다(샘플 1,939개 중 135개). `_section_is_from_row` 가 행 값으로 재계산해 같을 때만 크기를 바꾸고, 다르면 건너뛴다 — 등급은 출신 행을 따른다. 화면이 `foreignElements` 로 알린다.
보강 클론 재질은 `LoadForModel` 이 `<bdf 이름>.model.json` 의 reinforceOf 로 물려받는다(해석·보고서 공통). 재질표 없는 옛 모델은 결과 JSON `materialTable:false` → Studio 가 일괄 σy 경고.
화면은 Chrome 헤드리스로 실제 viewer-zip·결과를 넣어 편집~CSV 저장~최종 검토까지 확인. WorkBench 앱 안 실행·3D 뷰포트 표시·OS 저장 대화상자는 확인 안 함. Studio 시험: `node --test src/utils/csvRowEdit.test.js src/store/useCsvRowStore.test.js`.
남은 공학 검토: `RecordMD/2026-09-07-mooring-fitting-engineering-review.md` P0-3 · P0-4 · P1. 적합 판정 보고서 발행 보류는 그대로다. P0-2 는 Studio 쪽만 막았다(아래).

**MB·MU 와 같은 셸로 개편 (Studio 0.1.78, 2026-11-03, 70 로컬만·미커밋)** — 사용자 지시: Studio 사용법을 MB·MU 와 통일. 개편 전 기준점 = MF 저장소 커밋 `6b323e9`·태그 `mf-before-shell-rework`.
- 배치: 상단 탭 Model │ Model Check │ Loads │ Edit │ Analysis │ Save(탭 상태 점) · 왼쪽 `shell/TabPanel`(300px, 푸터 = 다음 행동 하나, 좌하단 버전) · 오른쪽 `shell/RightDock` 표시/정보(Ctrl+B, 보이기 설정은 전부 여기) · 아래 `shell/BottomDock`(높이 끌기·Ctrl+J·Ctrl+Shift+J). 편집 모드 토글·소메뉴 리본은 없앴다.
- 사용자 확인 후 조정(같은 날): 아래 도크의 검토/경고·진단 탭 삭제 — Model Check 패널이 진단 묶음 펼침(대상 클릭 = 이동)과 엔진 원인 진단을 직접 보인다. 메시지 탭은 기록이 있을 때만 · 뷰포트(Model 비교·카메라 동기화) 삭제 · **부재를 고르면 늘 '정보' 탭으로**(MB·MU 셸 규칙 6 과 다른 MF 만의 결정) · 직교 이동 1:1(TrackballControls 가 직교에서도 카메라 거리를 곱하고 감속 모드가 총 이동을 1/dynamicDampingFactor 배로 키워 모델이 날아갔다 — 조작 시작 때 panSpeed 를 맞춘다).
- `/design` 재검토(28/40, 기록 MF 저장소 `.impeccable/critique/`): 판정 칩(OK·재질 변경·NOT OK 건수, 누르면 최종 검토 표 필터) · 11px 미만 글자 90곳 → 11px · 보조색 `#64748b`→`#8b98ab`(AA) · `:focus-visible` · Usage 를 소수로 통일(% 폐기) · 하중 kN 라벨 축소(사용자 결정: 끄지 않고 작게) · 단추 Fit/Reset → 전체 보기/처음 시점(XY·PNG 는 유지) · 작업 패널 접기 · 사각형 선택을 캔버스 밖에서 놓아도 끝나게.
- 0.1.79(같은 날, 사용자 지적 4건): ① 정보 패널 T 단면 D3·D4 이름이 뒤바뀌어 있었다(엔진 T = [유효폭, H, 갑판 두께, 웹 두께]) — 단면 그림(`components/SectionSketch.jsx`, 규칙 `utils/sectionSketch.js`+테스트, 새 치수 계산은 백엔드 `mooring_row_edit._new_dims` 사본)으로 바꾸고, 부재의 출신 기록 행과 단면을 만든 행이 다르면 그 행을 알린다(같은 치수 대칭 행은 부재 위치로 고름, 0.1.80). 실례 E2526: 출신 기록은 226행(PLATE below)인데 단면은 우현 133행 WID-WEB-A(PLATE above, 좌표 높이 15 mm)다. 226행 자체는 같은 절점의 E2491~2493(I, H 370 = 10+350+10)으로 바르게 들어가 있어, E2526 의 '226행' 은 엔진 출신 기록(MODEL_EVIDENCE) 오류로 보인다(미수정). ⚠ **CSV 오류가 아니다(정정, 같은 날)** — PLATE above 는 POS1~POS4 네 점 판이고(4~6·7~9·10~12·13~15칸, THK 16칸, 등급 17칸) WID-WEB-A 는 POS1 쪽 15 mm(스닙) ↔ POS2 쪽 234 mm 로 높이가 변하는 사다리꼴 판이다. 엔진 `ParsePlate` above 는 높이 = |POS1−POS4| 하나만 써서 ① 사다리꼴이면 한쪽 끝 높이를 전 길이에 쓰고 ② 변이 기울면 수직 높이 대신 빗변 길이를 쓴다(샘플 above 50행 중 31행이 수직 높이와 10 mm 넘게 다름, 예 WID-WEB-A_1 엔진 343 ↔ 실제 271). **엔진 수정(같은 날, 사용자 지시)**: 높이 = POS1–POS2 직선에서 POS4(POS1 쪽)·POS3(POS2 쪽)까지 수직 거리(CAD Height 와 일치, `Core/Model/PlateAboveGeometry` + 테스트), 조각마다 두 끝 사이 보간 — `PlateTaperKeys` 를 ExtraData 에 싣고 05_MeshRefinement 마지막 sub-stage `PlateTaperHeightModifier` 가 T 단면 H 만 바꾼다(단계 수·요소 수 불변). Studio `sectionSketch.aboveHeights` 가 사본. NewCase_01 실측: T 요소 145개 H 변경(E2526 25 → 165.5), 판정 OK 1,821→1,819 · 재질 변경 26→27 · NOT OK 35→36(E610·E3175 OK→재질 변경, E2484 재질 변경→NOT OK), 최대 Usage 6.504 그대로. 70 InHouse 교체(sha256 6133e058…, 백업 `.bak_20261103_before_plate_taper`), 145 미반영.
- **부재 출신 기록 오류 수정 (엔진, 같은 날)** — `ModelDiffTracer.FindParent` 가 겹친 부재(같은 선 위 아래 판·위 판)를 위치만으로 골라 동점이면 먼저 나온 행이 이겼다 → 샘플 135개 요소의 출신 행이 남의 행. 출신 기록을 따르는 **재질표(MEMBER_MATERIAL)도 133개가 남의 행 등급**이었고, 행 편집·element_names 도 틀렸다(샘플 NewCase_01 은 판정 변화 0, Usage 만 일부 변화). 이제 같은 단면·같은 부재 이름(ExtraData ID) 후보를 먼저 고른다(`OverlappingMembers_ChildKeepsOwnRow`, 수정 전 실패 확인). build-full 이 `[origin-check] 출신 행 이름 불일치 N건` 을 찍는다(0 이 정상). 모델(BDF)은 바이트 동일. 70 InHouse sha256 d9a75bd6…(백업 `.bak_20261103_before_origin_fix`). 옛 결과는 모델을 다시 만들어야 고쳐진다.
- **전 과정 검증·현업 검토 (2026-11-03 끝)** — 샘플 6건(중복 제거) 모두 build-full→Studio 자료→해석→판정 통과(FATAL 0, 평형 잔차 ≤5e-7, 하중 = SWL×9806.65×1.25 정확, Studio 경로 ↔ 엔진 CalcVerify 응력 차 0.01 MPa, 보고서 C01 47쪽 판정 건수 일치, 행 편집 대상 정확). **결론: 공식 판정 발행은 아직 불가, 예비 검토로만 조건부.** 남은 결함 — 입력에서 행을 통째로 복사하면 강성이 2배인데 경고 없음(C05P 75행, KeepAsDuplicates) · 0 하중 Winch 케이스가 다음 LoadCaseID 와 겹쳐 이름이 틀리게 보임(C03 1003 이 'CableLifter') · MF 하중 CSV 끝 설명 글이 Studio 에 행·유령 케이스 '0' 으로 들어옴(라우터 DictReader) · 위·아래 판이 같은 절점이면 출신 기록 1건 남음(C04) · 결과 JSON propertyId ≠ BDF PID. 공학 쪽 P0 = ADEQUATE 문구가 해 건전성과 무관(9-07 P0-4) · 보고서 실행 묶음(P0-3) · 약축 굽힘 제외 근거(갑판 판 요소 없음) · 하중 방향이 RigidRange 첫 변 기준(실제 로프 방향 아님) · 하중 기준 1.25×SWL 고정 · 자동 6자유도 구속. 가장 싼 결정적 검증 = 기존 제출 계산서(3445 AFT `csv/NewCase_04`, 3496 FORE `csv/NewCase_03`)와 같은 입력 비교(아직 한 적 없음). C03·C04 Winch 입력 700~1350 t 은 단위 확인 필요.
- **사용자 결정·후속 수정 (같은 날)** — 결정: Winch 입력은 **ton 이 맞다**(실입력 F1 = 69 t; 테스트 CSV 700 은 옛 계산서 kN 값을 옮긴 것) · 하중 방향(RigidRange 첫 변) 유지 · 자동 구속 유지 · **강축 굽힘만으로 판정이 현 평가 방식** · 테스트 CSV 는 공학적으로 불완전할 수 있다. 수정(엔진 70 InHouse sha256 610d0609…, 백업 `.bak_20261103_before_dup_zero_hold` / Studio 0.1.84 / 백엔드):
  ① 통째로 복사된 부재 행(PLATE·BRACKET·FLATBAR·ANGLE·TBAR, 칸 내용 같음)은 앞 행만 쓰고 `DuplicateRow` 로 뺀다(`StructureCsvParser.RowKey`) — 누락과 따로 `caseFacts.duplicateRows` → 진단 `INPUT_ROW_DUPLICATE`, CSV 표 '중복 행 · 뺌(N행)'. C05P 75행·C01 2행(333·408) 제외, C05P 142행 OK 0.54 → 재질 변경 1.01(전에는 강성 2배로 덜 보수적).
  ② 하중 0 Winch 케이스는 해석 케이스를 만들지 않고 하중표 LoadCaseID `-` + 경고 `WINCH_ZERO_LOAD_CASE`, Studio Loads 패널·Winch 표에 '해석 제외' 로 따로 보인다(전에는 번호를 안 올려 다음 케이스와 같은 번호).
  ③ MF 하중표 부록은 `Report_LoadCalculation_MF_Method.txt` 로 분리, 백엔드 `clean_load_rows` 와 Studio 가 옛 결과의 잡행·유령 케이스 '0' 도 거른다.
  ④ 01 정렬이 자식 끝을 부모 선분 밖으로 당기는 경우 같은 단면·이름 부모를 겹침(≥50%)으로 인정(`ModelDiffTracer.MostlyOverlaps`) — 6건 모두 origin-check 0.
  ⑤ 보고서 결론: 해가 건전하지 않거나(FATAL·특이·평형) 적합인데 하중 없는 fitting 이 있으면 ADEQUATE 대신 'ASSESSMENT ON HOLD'(`ReportSheet.VerdictHold`). 보류 경로는 실제 보고서로 확인 못 함(샘플 중 해당 케이스 없음).
- **갑판 두께 = 행의 부착판 두께(26번째 칸)** (2026-11-03 사용자 결정, 예전 10 mm 고정) — 칸이 없는 PLATE·BRACKET 행은 보강재 행 값의 중앙값. SF 는 WorkBench 화면 입력칸이 이미 있다(기본 1.25). 엔진 70 InHouse sha256 6a5dd152…(백업 `.bak_20261103_before_fiber_grade`), Studio 0.1.85(정보 패널에 '보강재 AH σy 315 · 갑판 A σy 235').
- **PLATE below = 면재 없는 T · Chock 두 가닥 (2026-11-03 사용자 결정)** — ① 90×10 면재는 근거 없는 초기 가정이었다(첫 커밋부터, 출처 없음) → `PbeamlDimMapper.PlateBelowToTBeam` [유효폭, 갑판+높이, 갑판, 두께]. 백엔드 `_new_dims`·Studio `rowDims` 는 옛 결과(I)와 새 결과(T) 둘 다 받는다. ② Chock 은 도면('IN HORIZONTAL / VERTICAL LOAD')대로 두 가닥 동시 — LC1 수평 = P·t + P·(n 을 a° t 쪽으로), LC2 수직 = (0,0,−P) + P·(−n), n = v1, t = (0,0,1)×n. **CSV b·c 칸은 쓰지 않는다**(사용자 지시). 하중 합력 점검은 `MooringLoadGenerator.ForcesPer`(CHOCK 4). ③ Roller 는 도면 정의(두 가닥 사이 각 α, 합력 2P·cos(α/2))와 이미 같아 그대로 — 3496 계산서 F08 은 α=144 와 맞지 않는 값(약 58°)을 썼다. 3496 FORE 결과: NOT OK 10 → 22(PLATE below 6 → 17), 재질 변경 20 → 18, 최대 1.711 → 1.815. 엔진 70 InHouse sha256 f9105a0b…(백업 `.bak_20261103_before_envelope` — 부재 집계를 최악 판정 순으로 고친 Envelope 포함, 커밋 전 리뷰 2026-11-03), Studio 0.1.86.
- **릴리스 (2026-11-04)** — Studio **0.1.87 = 릴리스 표**(`ad73a92`, 설명서 문서버전 03·04 기준 버전). MF 출처 `release\` 폴더는 0.1.73 에서 멈춰 있어 `dist` 를 메모리에서 zip 으로 묶어 UNC 에 직접 썼다(`reference_studio_release_drm_zip`). 사용자가 145 ⟳ Update 후 화면 확인(엔진 exe 교체 여부는 미확인).
  사용 설명서 = `outputs/MF-manual/MooringFitting_사용설명서_문서버전04.pdf`(2026-11-04, 문장 다듬기·내부 동작 설명 정리). 같은 폴더의 문서버전03 은 DRM 잠금으로 못 옮겨 `이전본\` 에 복사만 했다.
- **남은 일 (2026-11-04 갱신)** — ① 커밋: 엔진(MooringFitting, 로컬 git·원격 없음)·Studio(MooringFittingStudio, 로컬 git, 스냅숏 `6b323e9` 이후 0.1.74~0.1.87 전부) 미커밋. WorkBench 는 `79eff65` 로 대부분 커밋됐고, **해석 뒤 WorkBench 판정**(백엔드 `solve-summary` API·`mooring_solve.summary.json`, 프론트 `MooringFittingAssessment.jsx`·`mooringVerdict.js`, 테스트)만 미커밋 — 커밋 전 `hitess-code-reviewer` 1회, 반영은 145 재시작 + exe 릴리스(설명서 03·04 에 이미 적힌 동작). ② 145: 엔진 exe(sha256 f9105a0b…) 교체 확인. OP2 받기는 1.7.0 exe 부터. ③ 실제 ton 단위 Winch 가 든 CSV 로 3445·3496 계산서와 다시 비교(이번 비교는 테스트 CSV Winch 가 kN 값이라 무효) — ±15% 안에 들어오기 전에는 공식 판정 발행 금지. ④ 보고서 'ASSESSMENT ON HOLD' 경로·chock 새 문구가 든 보고서는 실제로 열어 보지 않음. ⑤ 결과 JSON propertyId ≠ BDF PID(잠재, 미수정).
- **기존 제출 계산서 비교 (같은 날, 에이전트)** — 3445 AFT(SeaTrust-Frame3D) = C04, 3496 FORE(Nauticus 3D-Beam) = C02. 하중 크기는 Bollard·Roller 1.00(3496 은 SF 1.15 라 1.087). **응력은 대부분 1.4~4.5배 높게 나와 ±15% 재현 못 함.** 주원인 후보: PLATE below 면재 90×10 고정(실제 150×16 등) · 갑판 두께 10 mm 고정(CSV 12.5) · 등급을 보강재·부착판 중 낮은 쪽(계산서는 보강재 HT32 315) · SF 1.25 고정(3496 은 1.15) · Chock 두 가닥 합력·수직+수평 동시(계산서) vs P 하나 따로(도구) · Roller 각도 해석 차(F08 0.38배, S04 방향 반대). Towing·ETS 케이스·fairlead 행 없음. 원문 추출 `scratchpad/bench`(세션 한정).
- **구조 CSV 탭 (Studio 0.1.82, 0.1.83 원문 시트로)** — 아래 도크 '구조 CSV': CSV 원문을 줄·칸 그대로(행 = 파일 줄 = 엑셀 행 번호, 열 = A, B, C…, 머리글·corrosion·MF 줄 포함, 편집 예정 칸은 새 값 강조) + 오른쪽 고정 '모델 대응'(조각 수·상태·고치기). 원문은 백엔드가 `csv_rows.json` 의 `lines`(`mooring_row_edit.read_csv_lines`)로 싣는다 — 옛 백엔드면 부재 행만 보이고 안내가 뜬다. MF 줄 클릭 = 그 좌표에 가장 가까운 절점으로. 행 클릭 = 그 행 조각 전부 선택 + 행 양 끝으로 카메라, 3D 부재 클릭 = 그 행 강조, [고치기] = Edit 단면·재질로. 상태 = 정상/편집됨/다른 행 단면/모델에 없음(샘플 5행 — 같은 좌표의 다른 행과 합쳐짐 등). MB CSV 탭의 제외 행 상자·끊김 표시는 MF 에 쓸 일이 없어 넣지 않았다. 규칙 `utils/csvTable.js`+테스트. PLATE below 칸 대응(Width = POS1–POS2 길이라 미사용, Height = 웹 높이, THK = 웹 두께, 면재 90×10·갑판 유효폭은 엔진 가정)은 사용자 정의와 일치 확인 ② 해석 중 전체 화면 안내(`SolveProgressOverlay`, Esc = 뒤에서 계속 → 창 맨 위 진행 막대, 상단 '해석 중' 누르면 다시 펼침) ③ 단면·재질 작업 패널에 단면 그림 — 입력칸 번호 ↔ 그림 부위, 바꾸면 점선(지금)/채움(바뀔 단면) 비교 + PBEAML 치수 변화 ④ 결과 색이 안 보이던 것 — 빨간 절점 1,900개가 1px 부재 색을 덮었다(MU 와 같은 교훈) → 결과 표시 중 절점 회색·반투명, 해석 완료 시 07 단계·색 표시를 켠다. 탭에 따라 색이 안 입혀지는 현상은 재현 못 함(어느 탭이든 색은 입혀짐을 확인). 개발 모드에서 3D 첫 화면이 비던 원인 = StrictMode 재마운트 때 정리 코드가 예약 번호를 비우지 않아 다시 그리기가 막힘(배포본 무관, 수정).
- 사용자 결정: **다크 전용**(라이트 토글 삭제, MB·MU 와 같음) · MF 전용 탭 이름 `Loads` 유지. 셸 CSS `zoom`(useUiScale)은 배율이 두 번 곱해지는 문제(MU 0.0.148 기록)로 걷고 미디어쿼리로 바꿨다.
- 3D: 직교(기본)/원근 · 노드 = 화면 고정 4px 점(고르기는 `three/screenPick.js` 화면 거리) · 호버 말풍선 · Shift+드래그 사각형 · 선택 필터 · 선택만 보기 · 잘라 보기 · X-ray · 찾기(Ctrl+F, `data/findEntity.js` 는 MB 원본 무수정 사본 — 한쪽 고치면 세 곳) · Model Check 진단 표식.
- 편집: 뷰포트 왼쪽 도구 막대 5개(단면·재질 · 참조 복사 · RBE 연결 · RBE 수정 · 그룹 삭제) + 아래쪽 작업 패널(`edit/WorkPanelFrame`) · Ctrl+Z/Y · 참조 복사는 `batchId` 로 함께 지움 · RBE 연결 전 종속 중복은 막고 독립 노드 사슬은 병합 안내(`utils/rigidCheck.js`) · 수정 내역 저장·불러오기(모델 지문이 다르면 경고) · CSV 로 안 돌아가는 수정 수를 상태 줄에 표시. 노드·질량 편집은 MF 에 넣지 않는다(CSV 재빌드와 어긋남).
- **낡은 결과(P0-2, Studio 쪽)**: 결과에 입력 지문(수정 내역 + γM, `utils/resultFreshness.js`)을 붙여 바뀌면 '결과 낡음' 표시 · 보고서 단추와 `useReportStore.generate` 가 막는다. 서버 쪽 결과·보고서 묶음(P0-3)은 그대로다.
- **T 단면 3D 두께 뒤바뀜 수정** — 엔진 `PbeamlDimMapper` T = [플랜지 폭, 높이, 플랜지 두께, 웹 두께]. 표시만 틀렸고 해석값 영향 없음(`three/sectionShapes.test.js`).
- 실패 위치 안내: 백엔드 `mooring_fitting_service._solve_failure_message` 가 실패 문구 첫 줄에 `위치 후보 절점: …`(이번 실행 F06 만), 다음 줄에 엔진 '• 원인·조치' 를 싣는다(예전엔 job.message 가 고정 문구라 Studio 의 원인 상자가 늘 비었다). Studio `utils/solveFailure.js` 가 읽어 표식·이전/다음.
- OP2 받기: `GET /api/analysis/mooring-fitting/op2?output_dir=` + Electron `viewer:downloadMooringOp2`(**exe 재빌드 필요**, 옛 exe 면 '앱 업데이트 필요' 안내).
- 도움말: `data/helpContent.js`(MF 내용) + MU `components/help/*` 사본, `utils/theme.js` 는 MU 색 이름표 → MF CSS 변수 연결뿐. 테스트가 설명 없는 data-help 를 잡는다. Studio 테스트 `npm test`(38건).
- 화면은 Chrome 헤드리스 + 실제 viewer-zip 자료로 탭·도크·편집·찾기·도움말을 눌러 확인. WorkBench 앱 안 실행·실제 해석 실패 F06 으로 위치 안내·OP2 실제 저장은 확인 안 함. 헤드리스에서는 개편 전 코드도 첫 화면 3D 가 조작 전까지 비어 보인다(환경 특성으로 판단, 앱에서 확인 필요).

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

### Truss Structural Assessment — 허용응력 Property ID 테이블은 두 곳에서 참조된다 ★수정 시 동기화 필수

엔진(`WorkBenchSubModule/TrussAssessment`, C#)의 허용응력 테이블은 **Property ID 1~18만** 하드코딩돼 있고(`ElementStressChecker.cs:28-48`, `AllowableInfo.propertiesInfo`), 테이블 밖 ID 는 `catch (KeyNotFoundException) { continue; }` 로 **아무 흔적 없이 스킵**된다.

- 실제 장애(2026-08-28, `177K-01.bdf`): FEGate 5.03.21 이 PBAR/PBARL 을 **+1000 오프셋(1001~1019)** 으로 내보내 23,035 개 CBAR 가 전부 스킵 → F06 에 FATAL 도 없고 엔진도 exit 0 인데 엑셀의 `Summary_LC*` / `부재평가_LC*` 시트만 헤더만 남음. 하중분산판·SideSupport 는 SPC 반력만 쓰므로 정상 출력돼 "일부만 안 나오는" 모양이 된다.
- ⚠ **ID 집합이 백엔드에도 있다**: `app/services/assessment_diagnostics.py` 의 `_ALLOWABLE_PROPERTY_IDS = frozenset(range(1, 19))`. **C# 테이블에 Property ID 를 추가·삭제하면 이 상수도 같이 고칠 것.** (허용응력 *값* 은 복제하지 않는다 — 판정에 필요한 건 ID 집합뿐이라 중복을 정수 리스트 한 줄로 묶어 뒀다.)
- 검사는 **CBAR 가 참조하는 PID** 기준이다. PBAR/PBARL 카드 기준으로 바꾸지 말 것 — 정상 참조 모델 `3321_2tk_moving_04.bdf` 에는 어떤 CBAR 도 쓰지 않는 PBARL 37/38/39 가 카드로만 존재해서 카드 기준이면 **정상 모델이 차단된다.**
- 방어선 2겹(둘 다 백엔드, `git pull` 로 서버 반영): ① `preflight_property_ids()` — 업로드 직후 차단(전량 미매핑) 또는 경고(부분 미매핑, 해석은 진행). ② `_count_element_rows()` — 엔진이 exit 0 + JSON 까지 냈는데 부재평가가 0 행이면 Success 를 Failed 로 뒤집는다.

### D Type Lug Assessment — Bracket 형식 선택 · W1'·W2' 0 고정 (2026-10-30, v1.6.32)

엔진 = `WorkBenchSubModule/D_TypeLugCalculation`(Python, 별도 git, 기여 김연태) → `InHouseProgram/D_TypeLugCalculation/D_TypeLugCalculation.exe`(git 미추적). 엔진은 **세 형식을 한 번에** 계산한다.
- 화면(`pages/analysis/DTypeLugAssessment.jsx`, 규칙 `utils/dTypeLug.js`+테스트): 입력 맨 위 형식 선택 → E 단면 그림 교체, 결과는 고른 형식 기준(다른 두 형식은 한 줄 비교, 바꿔도 재계산 없음).
  형식 대응: 4EA = `bracket_4EA` · **2EA Opposite side = `bracket_2EA_double`**(양면, 대칭) · **2EA Same side = `bracket_2EA_single`**(단면, 비대칭). 그림 원본 = 엔진 저장소 `Figure/`.
- ⚠ **W1'·W2' 는 입력 칸 없이 항상 0 을 보낸다(사용자 결정).** 엔진 목두께 = (W+W')/√2 라 Excel 기본값(W1'=12)과 E 단면 결과가 다르다 —
  기본값에서 4EA 0.60→0.98, 2EA Opposite 0.89→**1.47 실패**, Same 0.87→**1.42 실패**(나머지 단면·입력은 같음, exe 로 확인). 그래서 단추 이름이 '기본값으로'('Excel' 을 뺌).
  W1·W2 가 둘 다 0 이면 엔진이 0 으로 나누므로 화면(`weldError`)과 라우터(422)가 막는다.
- 요청의 `bracket_type`(선택값) 은 `input_info` 에만 기록하고 엔진 입력(input.json)에는 넣지 않는다(`test_d_type_lug_bracket_type.py`).
- 헤더는 다른 Parametric 앱과 같은 에메랄드 그라데이션, 안쪽 강조(계산 버튼·형식 선택·'지배')는 Trust Blue(사용자 결정 — 판정 초록과 구분).
- 상태: 커밋 `d1aab40` · 릴리스 1.6.32(`a436e0a`) 푸시·exe 빌드. **145 ⟳ Update + 재시작**(라우터 스키마) · exe 배포는 사용자. 화면은 눈으로 확인 안 함.
  남은 후보: 입력 프리셋(`PresetPicker`)·배치 실행(2026-09-18 계획의 후속) 미부착.

### 외부 웹 App 프록시 — 사용자 신원 전달 (2026-11-03, 계획만)

Block Weld·Independent Tank·Heavy Block Lifting·App Settings 등록 App 은 백엔드 `routers/external_apps.py` 가 `/external-apps/<key>` 로 프록시한다
(grant 45초 → HttpOnly 쿠키 세션 8시간, `services/external_app_access.py`). 이 세션은 브라우저↔게이트웨이 사이에만 있고 `Authorization`·`wb_ext_*` 쿠키는 업스트림에 안 간다.
⚠ 외부 App 은 **주소 첫 칸(`/A123456`)으로 사용자를 정한다** — 업스트림 포트(145:31860/31870/31880)로 직접 들어오면 사번을 바꿔 들어갈 수 있다(방화벽 의존, 실제 열림 여부 미확인).
결정(사용자, 2026-11-03): **A안 = 게이트웨이가 요청마다 `X-HiTESS-Assertion`(RS256 JWT, aud = App 키/slug, exp 60초)을 붙이고 공개키를 JWKS 로 공개**, 외부 App 이 검증.
계획서·외부 개발자 전달본 = `RecordMD/2026-11-03-external-app-signed-identity-plan.md`(부록 = WorkBench 내부 작업, 전달 시 뺌).
**WorkBench 쪽 구현됨(2026-11-03, 미커밋)** — `services/external_app_identity.py`(RS256 서명·JWKS, 키 = `.env` `EXTERNAL_APP_SIGNING_KEY_PATH` 기본 `<백엔드>/.secrets/`, git 제외) ·
`external_apps.py` 가 요청마다 `X-HiTESS-Assertion` 을 붙이고 브라우저의 `x-hitess-*` 는 지움 · 쓰기 요청은 같은 출처(Origin/Referer)만 통과(403) · `GET /api/external-apps/jwks`(`jwks_router`, main.py 등록).
⚠ 쓰기 요청 출처 확인이 생겨 Origin 없는 POST 는 프록시가 403 — 테스트에서 쓰기 요청을 보낼 때 `Origin: http://testserver` 를 붙일 것. 반영 = 145 `git pull` + 재시작(키 파일은 처음 요청 때 자동 생성).
모든 외부 App(코드 3개 + 등록 App)이 같은 `_proxy_request` 를 지나 따로 할 일 없음(`test_every_external_app_gets_its_own_audience`). 70 반영·사용자가 Block Weld 연결 상태 확인(2026-11-03).
**외부 개발자 전달본 = `RecordMD/2026-11-03-external-app-integration-handoff.md`**(현재 작동 체계 + 검증 예제, 예제는 계획서 코드 블록을 그대로 옮겨 재실행 확인). 계획서는 내부 기록용.
커밋 `87322fd`(독립 리뷰 막아야 함 0) · **WorkBench 1.7.0 에 포함**(2026-11-03 빌드·푸시, 145 미반영).
남은 일: 145 반영(⟳ Update + 재시작) 후 Block Weld 를 열어 145 `.secrets/` 키 생성·쓰기 동작(저장·계산) 403 없음 확인 → 반영일을 적어 전달본 송부. 외부 App 쪽 검증 코드는 각 개발자 몫.
개정 2(같은 날): 45번 Cookie Manager(`HanByul/45_Cookie_Manager`, 별도 로그인 플랫폼 + 서버 간 세션 확인)는 운영에 세우지 않고(HTTP 거부·로그인 이중화·앱 포트 노출) 모듈 쪽 구조만 쓴다 —
claims 이름을 그 사용자 정보(`employee_id`·`display_name`·`role`·`modules`)와 맞춤, CSRF 는 게이트웨이 Origin 확인, .NET 은 NuGet 없는 RS256 검증 예제(Python·.NET 예제 실행 확인) — 개발자 안내문 `utils/externalAppDeveloperNotes.js` 도 구현 때 함께 바꾼다.

**보안 점검 (2026-11-04, 읽기 전용 — 코드 변경 없음)** — 위 '외부 웹 App 프록시' 절의 "실제 열림 여부 미확인" 중 **무인증 직접 접근·경로 첫 칸 사번 위장은 닫힘 확인**:
업스트림에 직접 붙어도 `/`·`/A<사번>` 모두 **401 `SESSION_INVALID`**(앱이 유효 WorkBench 세션을 요구, 경로 칸을 신뢰 안 함). 참조 검증기 `outputs/external-app-assertion-testkit/sample_app.py` 는
`algorithms=["RS256"]`+`require=[iss,aud,sub,iat,exp]`+aud·iss 핀+JWKS kid 조회로 alg:none·RS/HS 혼동·kid 주입·unknown-key·tampered·expired·wrong-aud/iss·no-exp **7종 거부** — 토큰 위조 경로는 견고.
- **남은 결함은 암호화가 아니라 전송/배포** (WorkBench.exe 무관, exe 재빌드 불필요): JWKS(`9091/api/external-apps/jwks`)·게이트웨이→App 이 **평문 HTTP**(`external_apps.py` 35~39행 `http://10.14.42.145:318xx`).
  **공격자가 LAN 온-패스일 때만** ① assertion 재생(exp60+leeway30 ≈ 90초 창, 검증기에 jti 재생 캐시 없음) ② 위조 JWKS 로 아무 사번 토큰 위조. 둘 다 401 을 뚫는 게 아니라 "401 통과 재료(토큰·공개키)"를 평문 구간에서 조작하는 방식.
- **심각도 열쇠 = 운영 .145 의 318xx 바인딩이 loopback 이냐 0.0.0.0 이냐** (미확인). `.114:31880` 이 응답한 건 **개발자 PC 테스트 인스턴스**(운영 누수 아님)이고, 그게 0.0.0.0 바인딩이라 타 PC 에서 닿았다 — 운영도 같은 식이면 ①② 성립, loopback 이면 사실상 닫힘. 확인: 145 에서 `netstat -ano | findstr :31880` 또는 타 PC 에서 `.145:31880` 접근.
- **막는 순서**: ① 업스트림 포트(31880/31870/31860)를 게이트웨이에서만(방화벽 또는 loopback 바인딩, **코드 아님·사용자 수동**, 가장 싸고 효과 큼) ② JWKS·업스트림 HTTPS/mTLS ③ 외부 App 에 공개키 핀 ④ 검증기 `leeway` 30→5~10s + jti 단기 캐시(참조 샘플 + 각 외부 App=타 개발자, 샘플만 조여선 운영 보안 안 바뀜) ⑤ 핸드오프 문서에 검증 3대 불변식(RS256 전용·aud/iss/exp 필수·JWKS 인증 채널).
- ⚠ 라이브 서버(10.14.42.x) 침투·재생 **실제 시연은 안 함** — 승인·테스트 계정 전까지 하지 말 것. ①(방화벽)은 공격 없이도 적용되는 네트워크 설정이라 선행 가능.
- **백엔드 보안 수정 커밋·푸시 `35fc57b`** (2026-11-04 — 145 `git pull`+재시작 반영, exe 무관·프론트 무관): ① `app_settings.py` `effective_external_endpoint` 가 `external_host` 오버라이드의 loopback/link-local/unspecified/localhost 거부(`_is_blocked_external_host`) — 관리자 오버라이드로 프록시를 내부 포트(MySQL 3306·Ollama 11434)로 돌리는 SSRF 피벗 차단, 신원/세션 경로 무관 ② `GUARDED_ROUTES` 에 `modelbuilder/solve`·`module-unit/export-bdf`·`groupmodule/cog` 등록(점검·개발 중 앱 우회 실행 fail-open 메움) ③ `viewers.py` `_find_zip` 의 `viewer_id` 를 `^[A-Za-z0-9_-]+$` 로 제한(백슬래시 `%5C`·`..` 경로탈출). 커밋 전 독립 리뷰 막아야함 0, 백엔드 테스트 169 통과. ⚠ 레거시 `hitessbeam.py` 무인증 다운로드는 **닫지 않음**(배포 exe 계약 `test_hitessbeam_legacy_client.py`, 2026-07-28 401 사고) — 네트워크 격리로만.
- **외부 App 등록 규약 = `aud` 는 등록 slug** (2026-11-04 진단, BlockWeld_Test 401). 외부 App 이 `aud` 를 하드코딩하면(testkit `sample_app.py:16` 기본 `block-weld`) 등록 slug(예 `blockweld-test`)와 어긋나 App 이 **401 `SESSION_INVALID`** 를 낸다 — **WorkBench 수정 아님**, App 이 `aud` 를 등록 slug(설정값)로 맞춰야. 등록하면 `/external-apps/<slug>` 프록시·카탈로그 카드가 **동적 생성**(App 별 코드 변경 불필요)이고, 매 App 조건은 host=사설 IPv4(`is_private_ipv4`)·slug 비예약(`RESERVED_SLUGS`)·상태 Active·양방향 네트워크(게이트웨이→App, App→`145:9091/jwks`). 진단·외부 개발자 전달문서 `RecordMD/2026-11-04-external-app-aud-mismatch-handoff.md`.

### 프론트엔드 내비게이션 구조

React Router 대신 **NavigationContext** (`src/contexts/NavigationContext.jsx`)를 사용합니다. `useReducer` 기반으로 `history[]` 배열과 `currentIndex`를 원자적으로 관리합니다. 페이지 컴포넌트에서 `useNavigation()` 훅으로 `setCurrentMenu(name)`, `goBack()`, `goForward()` 등에 접근합니다(이전의 props drilling 방식 제거). 전체 라우팅 분기는 `App.jsx:renderPage()`의 switch문에 있습니다.

키보드 단축키: **Alt + ←** (뒤로), **Alt + →** (앞으로), **F5** (새로고침 방지).

⚠ **한글 입력칸의 Enter 처리에는 조합 검사를 붙인다** (2026-10-19, v1.6.16): `if (e.nativeEvent.isComposing || e.keyCode === 229) return;`.
빠지면 글자 조합을 확정하는 Enter 가 전송·저장까지 실행해 마지막 글자가 두 번 보내지거나 빠진다. 적용된 곳은 `ChatDock`·`CommandPalette`·`AppSettings` 의 편집칸이다. Enter 로 보내거나 저장하는 입력칸을 새로 만들 때도 같이 넣을 것.

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

**대시보드(2026-09-30 개편, 되돌리기 기준 태그 `dashboard-v1-backup`)**: `pages/dashboard/Dashboard.jsx` = 인사 줄(실행 중·확인할 실패·서버 칩 + '자료' 메뉴) →
공지 한 줄 → **새 해석 시작 | 내 작업**(5:7) → **내 월별 실행 | 많이 쓰는 앱**(5:7, 위아래 경계를 맞춘 같은 격자).
공지 줄·로드맵/소개/영상 모달·섹션 제목은 `dashboardShared.jsx`. 실패 사유는 DB `analysis.job_message`(job_manager 가 마지막 진행 메시지를 기록)를 쓴다.
- **실패 사유 규칙(2026-10-29)** = `utils/dashboardResults.js` `failureReason`(+테스트) — 진행 문구('…중...'·'45%')는 원인으로 쓰지 않고(결과 오류 → 없으면 '마지막 메시지:'),
  '해석 실패'·'Analysis Failed' 같은 일반 문구는 `result_info` 의 구체적 오류를 먼저 쓴다. 한 칸 배치(xl 미만·고배율)에서 확인할 실패가 있으면 '내 작업'을 '새 해석 시작' 위로 올린다.
  같은 날 `/design` 다듬기: 보조 글자 11px·slate-500, 공지 줄 버튼 분리(버튼 안 버튼 제거), 탭·메뉴의 미완성 ARIA 역할 제거, lucide `Map` → `MapIcon`.
  **2026-10-30 커밋(독립 리뷰 막아야 함 0, 진행 문구 `(n/m)`·진행률 % 정규식 보강) · 화면 눈으로 확인 안 함**. 남은 후보(사용자가 이번에 고르지 않음): 실패 → 같은 입력으로 다시 열기, '진행 중 N' 중복·누적 성공률·장식 효과 덜어내기. 비평 기록 `.impeccable/critique/*dashboard-jsx*`(26/40).
- **파일 전달**: '새 해석 시작'에 놓은 파일 → 추천 앱을 고르면 `utils/dashboardFileHandoff.js` 가 파일을 들고 이동하고, 앱 페이지의
  `useDashboardFileHandoff`(1개) / `useDashboardFilesHandoff`(여러 개)가 **그 페이지의 기존 업로드 처리 함수**에 태운다.
  ⚠ 새 파일 입력 앱을 만들면 페이지에 훅을 붙이고 `FILE_HANDOFF_MENUS` 에 메뉴명을 등록할 것(미등록 앱은 추천 목록에 '다시 선택').
  **자동 실행(2026-10-01)**: 파일 적용 뒤 `useDashboardAutoRun(menu, ready, run)` 이 그 페이지의 실행 버튼 핸들러를 한 번 부른다.
  `ready` 는 실행 버튼이 열리는 조건 && **입력 파일 객체**(값이 바뀌어야 다시 판정된다), 대시보드 전달로 들어온 경우만·15초 안에
  ready 가 안 되면 해제. 권상·Side Passage·해상 운송은 'BDF 검증', Model Builder 는 비동기 배정(형제 CSV 스캔) 완료 후 실행.
  ⚠ 훅은 run·ready 에 쓰는 변수 **선언 뒤**에 둘 것(앞에 두면 렌더 시 TDZ 오류로 페이지가 죽는다). 새 앱도 이 훅을 같이 붙일 것.
  ⚠ 대시보드→앱 이동은 fresh-entry 리셋으로 페이지가 1~2번 **재마운트**된다(DashboardContext 가 페이지 상태 삭제, App.jsx 인스턴스 키 증가).
  그래서 보관소는 꺼내도 지우지 않고(TTL 8s), 적용은 60ms 미뤄 언마운트 시 취소한다 — 바로 적용하면 리셋에 지워지거나 자동 배정 토스트가 여러 번 뜬다.
  다중 슬롯 앱의 배정 규칙은 각 페이지 것을 그대로 쓴다(Truss NODE/WAY 파일명, Mooring `load` 파일명, Model Builder 헤더 ori/outdia/cog, 이중관은 UBOLT 행 유무로 탭 선택).
- **내 작업 목록 규칙**은 `utils/dashboardResults.js`(+테스트)에 있다: 같은 앱·같은 입력의 **연속** 실행은 한 줄로 묶고(실패는 안 묶음),
  판정 칩은 결과에 판정 값이 실제로 있는 앱만(Mooring `summary.ok`, 권상 `step1/2_status`, Column Buckling, Carling) 읽는다.
  '확인할 실패' = 최근 7일 실패 중 이후 같은 앱이 성공하지 않은 것 — 상단 칩과 큰 실패 카드가 같은 기준이다.
  **본 실패는 내린다(2026-10-26)**: 큰 카드의 '확인'·'상세·로그'·'같은 앱에서 새로 시작' 또는 상단 칩(실패 목록 이동)을 누르면 그 실패 id 를
  localStorage `workbench:dashboard-ack-failures:<사번>`(최근 200개)에 넣고 칩·큰 카드에서 뺀다 — 목록에는 한 줄 '실패' 표기로만 남는다(사용자 요청: 인지한 뒤엔 눈에 띄지 않게).
  PC별 기록이라 다른 PC 에서는 다시 큰 카드로 보인다(서버 저장은 과하다고 판단).
  ⚠ 새 앱이 판정 값을 내면 `resultHighlight()` 에 한 줄 추가할 것(없으면 칩이 안 뜰 뿐 깨지진 않는다).
- **월별 건수**(`/analysis/stats/monthly`)는 이력 목록과 같은 기준(샘플·권상 세부 검토 제외)이다. 예전 값(세부 검토 포함)과 비교하지 말 것.
- **버전 체크**는 서버 버전이 **더 높을 때만** 업데이트를 요구한다(`utils/versionCompare.js`, App.jsx·LoginScreen 공통) — exe 를 서버보다 먼저 배포해도 새 클라이언트가 막히지 않는다.

**파일 기반 해석 앱 공통 틀(2026-10-01, 기준 앱 = HiTESS Model Builder · GMU 권상)**: 새 앱·기존 앱 개편은 `components/analysis/runFrame/` 부품을 먼저 쓴다.
★ **표준 문서 = `docs/standards/file-based-app-page-standard.md`** — 골격·부품 props·상태 규칙·체크리스트. 새 페이지/개편은 이 문서와 두 기준 페이지에서 더하고 빼서 시작한다.
골격 = 왼쪽 레일(`StepRail` · `InputSummary` · 옵션 · 주 실행 버튼 1개 + 보조 링크) + 오른쪽 작업면(`JobProgressCard` → `VerdictHeader` → `NextActionBar` → 단계 본문 → `EngineLogPanel`).
- **판정은 통과 / 검토 필요 / 실패 한 가지**(색+아이콘+글자). 판정 함수는 순수 함수 + 테스트로 둔다(Model Builder = `utils/modelBuilderVerdict.js`).
  Model Builder '검토 필요' = 질량 있는 입력 행 제외 · 분리 그룹 · 미해결 U-bolt(사용자 결정). 자유단·경고 수는 판정에 쓰지 않되 **숨기지 않는다**(경고 N '판정 미반영').
- **단계 완료는 실제 사건으로만** — 실행 성공 / 판정 통과·'확인함'·편집 적용 / BDF 받기·후속 전달. 탭을 열었다고 완료로 바꾸지 말 것(예전 600ms 가짜 완료 제거).
- 실행이 끝나면 **판정 화면(2단계)으로 이동**한다. ⚠ 옛 코드 주석의 '사용자 요구: 완료 시 1단계로 이동', '경고 화면에서 삭제'는 2026-10-01 사용자가 뒤집었다 — 되살리지 말 것.
- `NextActionBar` 는 판정 머리 **바로 아래**에 둔다. 화면 하단 sticky 로 두면 오른쪽 아래 전역 작업·메시지 도크가 주 버튼을 가린다(실측). 페이지 루트는 `pb-28`.
- 편집 적용 등 긴 후속 작업에 **전체 화면 잠금 오버레이를 쓰지 않는다** — 해당 패널 안 `JobProgressCard` + 결과에 의존하는 버튼만 잠근다.
- **재실행**: 실행 후 주 버튼은 '옵션 바꿔 다시 실행'. 브라우저에 File 이 있으면 다시 올리고, 없으면 `POST /api/analysis/{id}/rerun` 에 옵션 덮어쓰기(`mesh_size`·`ubolt_full_fix`·`run_nastran`, 현재 Model Builder 만 읽음)를 보낸다. 빈 본문 `{}` 은 원본 옵션 그대로(My Projects 호환).
- **결과 다시 열기**: `utils/resultReentry.js` — My Projects 상세 '결과 화면에서 열기'와 대시보드 '내 작업' 행(성공·파일 보관 중)이 `offerResultReentry(menu, id)` 후 이동, 페이지의 `useResultReentry` 가 `GET /api/analysis/{id}` 의 result_info(산출 폴더)로 결과 상태를 복원한다. 새 앱을 붙이려면 `RESULT_REENTRY_MENUS` 등록 + 페이지에 훅.
- 보조 텍스트 최소 11px · slate-500 이상, 자간 대문자 라벨·그라데이션 카드·2px 색 테두리·측면 색 띠·이모지 금지(대시보드 2026-10 문법과 동일). 비평 기록: `.impeccable/critique/*hitessmodelbuilder*`.
- **적용 앱 2호 = GMU 권상**(`GroupModuleUnitLiftingAnalysis.jsx`, 2026-10-01). 단계 = BDF 입력 검증 → Studio 권상 검토 → 결과·보고서.
  판정은 두 시점: 검증 직후(`basis:'validation'` — 오류·Nastran FATAL=실패, 분리 그룹=검토 필요) / Studio 구조 해석 후(`basis:'structural'`, 우선).
  구조 판정 규칙은 `utils/gmuLiftingVerdict.js` 와 Electron `viewer:runUnitStructural` 의 status 계산이 **같아야 한다**(재진입 때 DB `result_info.summary` 로 다시 계산). 한쪽 고치면 양쪽 다.
  **BDF 구간 경계 검사·자동 수정(2026-10-02)**: 검증이 `services/bdf_deck_check.py` 로 Executive/Case Control/Bulk 경계를 보고 step1 JSON `deckIssues` 에 싣는다 —
  `missing_begin_bulk`(경고) · `case_control_in_bulk`(오류, SOL·CEND·SUBCASE·'키 = 값' 줄이 Bulk 안에 있음). 고칠 수 있는 문제가 있으면 판정은 최소 '검토 필요'이고 화면은 1단계에 남아
  '다음 행동 바'에 'BDF 자동 수정 후 다시 검증'을 띄운다 → `window.confirm` 으로 무엇을 고치는지 보여 준 뒤 `POST /api/analysis/groupmoduleunit/{id}/deck-fix` 가
  **새 작업 폴더에 같은 파일명의 수정본**을 만들고 검증 작업을 띄운다(원본 불변, 고치지 않은 줄은 latin-1 로 바이트 그대로). 이후 '다시 검증' 입력은 수정본(`handoffBdfPath`)이다.
  실례: `3542_m09.bdf` 는 BEGIN BULK 가 없어 검증은 통과했는데 Wire 포함 구조 해석에서 Nastran FATAL 9994/300 — nastran_bridge `bulk_start_index` 도 함께 고쳐 이제는 그대로 둬도 해석된다.
  새 검사 규칙은 이 모듈에 추가하고, 오탐 확인은 `userConnection/**/*.bdf` 전수 스캔으로 할 것(도입 시 925개 중 오탐 0).
  **PARAM BAILOUT 은 사용자에게 주는 권상 BDF 에 넣지 않는다 (2026-10-27, 사용자 요청)** — BAILOUT 은 mechanism(연결이 끊긴 부분)이 남아도 계속 풀게 한다.
  실측: 3454-35020 권상 BDF 가 BAILOUT 으로 '정상 종료'했지만 최대 변위 1.27e13 mm(검증 BDF 6.3e12 mm), 빼면 FATAL 9050.
  정상 모델 3496·3542 는 있든 없든 결과가 같았다(검증·Wire 해석 모두 백엔드 실제 경로로 확인). 그래서:
  ① Wire 포함 BDF(bridge `build_lifting_bdf` = 다운로드·해석 공용 최종본)의 안정화 PARAM 은 **AUTOSPC 만**,
  입력에서 온 PARAM BAILOUT(Case Control·Bulk, 자유·고정·큰 필드)도 지운다(`param_name`/`bdf_param_name` 같은 규칙, 메타 `removedInputBailout`).
  ⚠ **검증 BDF(`_ensure_validation_stabilization_params`, `_validation.bdf`)는 BAILOUT 을 유지한다**(리뷰 후 되돌림, 사용자 확인 2026-10-28) —
  검증은 최저 Z 노드만 임시 구속해 떨어진 소그룹이 mechanism 이 되므로, 빼면 FATAL 9050 '실패' 로 끝나 그 소그룹을 고치는 Studio 에 못 들어간다.
  검증 변위는 판정에 쓰지 않고, `_validation.bdf` 는 다운로드 목록(`lifting_artifacts.ARTIFACT_SPECS`)에 없다. 두 곳을 같은 정책으로 '통일'하지 말 것.
  ② 입력에 있으면 덱 검사 경고 `bailout_param`(자동 수정 아님) → 판정 '검토 필요' + 단계 힌트 '통과 · PARAM BAILOUT 제외'.
  ③ `unit_structural_service._FATAL_HINTS` 9050 = 연결 끊김/구속 부족(Studio Model Check 안내), 2101 = RBE 종속 자유도에 SPC(UM·US, 실측),
  5289 = 종속 중복(예전 2101 문구가 틀렸었다). 해상 운송(`module_ocean_bdf`)은 BAILOUT 을 유지하고 피벗비 점검(`trustworthy`)으로 거른다 — 범위 밖.
  ⚠ 입력 BDF 의 `PARAM MAXRATIO 1.0+15`(예: 3542_m09)도 피벗비 검사를 사실상 끄는 설정이다 — 아직 손대지 않았다.
  구조 해석 실패 시 job.message 는 고정 문구가 아니라 원인이다(`unit_structural_service.describe_f06_fatal` — FATAL 건수·코드·첫 메시지). Studio 는 이 문구를 '실행 실패' 옆에 보여 준다.
  단계 상태는 저장하지 않고 사건(검증 결과·Studio 열기·`viewer:unit-structural-completed`·산출물/보고서 받기 = `ResultArtifactsCard onDownloaded`)에서 매번 계산한다.
- **첫 화면(입력 전)은 `runFrame/RunStartPanel`** — 진행 순서(단계별 하는 일) + 이 앱의 내 최근 실행 5건(`program_name` 필터, '결과 열기' = 페이지의 `applyResultReentry`,
  '입력 불러오기' = 페이지의 `applyRecentInput` — 실패한 실행도 허용, 보관 만료면 끔). 입력 경로는 `input_info` 에서 읽는다:
  GMU `bdf_model` → 다시 올리지 않고 `handoffBdfPath`(request-from-path), Model Builder `stru/pipe/equip_csv` → `/api/download` 로 받아 File 로 만들어 칸에 넣는다(옵션도 그 실행 값).
  첫 화면에서만 레일의 `xl:self-start` 를 풀어 두 칸 높이를 맞춘다(화면 높이까지 늘리지 않는다 — 늘리면 카드 안이 다시 빈다). 입력 칸이 덩그러니 있는 빈 화면을 꾸밈으로 채우지 말 것.
- **적용 3·4호 = Truss Model Builder · Truss Structural Assessment**(2026-10-02). 판정 = `utils/trussVerdict.js`(+테스트).
  Assessment 의 Side Support 허용 반력 `SIDE_SUPPORT_ALLOWABLE` 은 이 파일 한 곳 — 결과 표(`AssessmentResultTable`)도 여기서 import 한다.
  예전 검은 콘솔은 `runFrame/RunLogPanel`(접힘, 실패 시 펼침)로 바꿨다. `AssessmentProjectModal` 에 `onDownloaded`·`onOpenResult`(My Projects '결과 화면에서 열기') prop 추가.
- **작업 탭(2026-10-02) — Model Builder · GMU 권상** — 한 페이지에서 그 앱의 해석 과정을 **최대 4개 동시에** 진행한다(탭별 Studio 창·탭별 Job Center 기록).
  페이지 컴포넌트 = 배너 + `WorkspaceTabBar` + `WorkspaceFrame` 안에 탭마다 작업 화면 1개(`ModelBuilderWorkspace` / `GmuLiftingWorkspace` = 예전 페이지 본문).
  숨은 탭도 언마운트하지 않아 폴링이 계속 돈다. 탭 UI·저장 훅은 `runFrame/WorkspaceTabs.jsx`(`useWorkspaceStore`), 탭 규칙은 `utils/appWorkspaces.js` 의
  `createWorkspaceKit({ isIdle })` + 앱별 `utils/modelBuilderWorkspaces.js` · `utils/gmuLiftingWorkspaces.js`(+테스트).
  저장소는 DashboardContext `modelBuilderPageState` · `gmuLiftingPageState`(`{activeId, workspaces, states}`). GMU 는 더 이상 `analysisPageStates[GMU]` 를 쓰지 않는다.
  **다른 앱에 붙일 때**: kit(isIdle·label·status) + 컨텍스트 저장소 + `resetAnalysisEntryState` 의 freshEntry + 페이지 분리 + `MULTI_INSTANCE_VIEWERS` 등록.
  - **메뉴 재진입은 탭을 지우지 않는다** — 진행 중·결과 있는 탭은 남기고 빈 탭을 하나 열어 그리로 간다. 대시보드 파일 전달·결과 다시 열기·**다른 App 연계(gmuHandoff)** 는
    **마운트 시점에 활성이고 비어 있던 탭만** 받는다(`useDashboardFileHandoff`·`useDashboardFilesHandoff`·`useDashboardAutoRun`·`useResultReentry` 의 `enabled` 인자).
    탭이 가득 차면 토스트로 알리고 GMU 연계 BDF 는 버린다. ⚠ '가득 찼는가'는 **마운트 시점 값**(`entryBlocked`)으로 판정할 것 — 미뤄서 보면 방금 전달을 받은 빈 탭이 채워져 있어 오판한다(실측).
  - **Studio 는 모델마다 창이 따로다** — Electron `viewer-sessions.js` 의 `MULTI_INSTANCE_VIEWERS`(`model-studio`·`module-unit-studio`)는 세션 키가 `viewerId::sourceKey`
    (MB = 산출 폴더, GMU = 검증한 서버 BDF 경로). 다른 Studio 는 viewerId 당 창 1개. 탭에서 재빌드·재검증 후 Studio 를 다시 열면 그 탭의 옛 모델 창을 닫는다.
  - ⚠ **Studio → WorkBench 이벤트는 반드시 탭을 특정해서 받는다.** 탭이 여러 개라 '현재 페이지 상태' 로 처리하면 **다른 탭 모델에 오류 없이 적용된다.**
    MB `modelflow:finalize-edit-request` = 세션 `outputDir` ↔ 탭 `bdfResult.outputDir`(탭이 닫혔으면 페이지가 Studio 에 실패 회신).
    GMU `viewer:unit-structural-completed` = `parentAnalysisId` ↔ 탭 `bdfAnalysisId`(`isOwnStructuralEvent` — id 가 없으면 받지 않는다. 예전 코드는 id 가 없을 때 통과시켰다).
  - **작업 번호(1~4, `ws.slotNo`)가 탭의 고정 정체성**이다 — 번호별 색 칩, 이름 `작업 N · <입력 파일 이름>`을 탭·Job Center 카드·**Studio 창 제목**
    (`viewer:open` 의 `windowTitle`)이 함께 쓴다. 탭을 닫아도 다른 탭 번호는 그대로, 새 탭은 빈 가장 작은 번호. 위치 순번으로 바꾸지 말 것(이미 뜬 Studio 창 제목과 어긋난다).
  - 탭 모양 = 폴더 탭(활성 탭이 `bg-slate-50` 작업 영역과 이어짐) + 작업 영역 머리(`작업 N · 이름 · 상태`). 상태 문구는 앱별 `statusText` 로 바꾼다.
  - Job Center 는 `startGlobalJob(jobId, menu, { slot, label })` 로 **탭당 1개** 기록(같은 App 이라도 slot 이 다르면 공존). 카드를 누르면 `workbench:job-slot-focus` 이벤트로 그 탭으로 간다.
  - ⚠ Electron 변경이 있어 **WorkBench exe 재빌드가 있어야 Studio 다중 창이 동작**한다(웹 쪽 탭·동시 실행은 프론트만으로 동작).
- **Studio 열기 카드는 공용** `runFrame/StudioLauncherCard`(Model Builder·GMU 공통). 앱마다 그라데이션 카드를 새로 만들지 말 것.
- **결과 다시 열기 조건**은 `canOpenResult(project)` 한 곳 — 앱마다 기준 키가 다르다(Model Builder `output_dir`, GMU `bdf`). 새 앱은 `RESULT_KEYS` 에도 등록.
- ⚠ **앱 페이지는 전부 keep-alive**(`App.jsx KEEP_ALIVE_MENUS`)라 window 키 단축키(Ctrl+Enter)는 `currentMenu === 자기 메뉴`일 때만 반응하게 할 것 — 안 그러면 다른 앱 화면에서 숨은 페이지의 실행이 눌린다.
- `ValidationStepLog`(BDF 검증 본문, BdfScanner·GMU·Side Passage·해상 운송 공용)도 같은 문법으로 바꿨다: 근거 없는 '건전도 %' 게이지 삭제, 카드 분류는 표. 미참조·고립 GRID 는 엔진이 오류로 세지 않으므로 **경고**로 표시한다(판정 머리와 같은 기준). 공통 틀 페이지 안에서는 `bare` prop.

**사용 통계 합산(2026-09-30)**: 권상 App 의 세부 검토 레코드(`ModuleStability`·`ModuleHoistOptimize`·`UnitStructuralAnalysis`)는
통계에서 부모 App(`GroupModuleUnit`/`SidePassage`) 한 줄로 합산되고 세부 건수는 `steps`/`stepBreakdown` 으로 나간다
(대시보드 Top·Analysis Management·프로그램 상세 모달·Usage Reports 4곳 공통, 규칙은 `services/usage_rollup.py`).
부모 판별: UnitStructural = `input_info.parent_analysis_id`, 나머지 = `input_info.posture` 경로의 `<ts>_<사번>_<부모>` 폴더명
(Studio 가 보내는 `source` 는 두 App 모두 `ModuleUnitStudio` 라 못 쓴다). ⚠ 새 세부 검토 program_name 을 만들면 `SUBSTEP_LABELS` 에 등록할 것.

**해석 오류 유형 기록(2026-10-02)** — 반복되는 Nastran/엔진 오류를 코드로 막아 가기 위한 영구 기록. 절차·규칙 원본: `docs/operations/nastran-diagnostics.md`, 대응 스킬 `/nastran-triage`(70 로컬).
작업 종료(`mark_complete`·Model Builder 편집 적용)마다 `services/nastran_diagnostics.py` 가 F06 FATAL/WARNING·엔진 실패를 DB `diagnostic_signatures`(유형)·`diagnostic_occurrences`(발생)에 쌓고,
**처음 보는 유형(또는 handled 후 재발 = regressed)일 때만** 입력 BDF·F06 발췌를 `DataStorage/DiagnosticsArchive/cases/` 에 보관한다(30일 정리 제외). 경고는 세기만 한다.
유형 = Nastran **코드 + 모듈**(본문으로 묶으면 한 원인이 수십 유형으로 갈라진다), 연쇄 코드(6498·6624·9002·208·102·285)는 원인 FATAL 이 있으면 뺀다,
F06 은 **작업 시작~끝 사이**만(권상 계열은 부모 GMU 폴더를 같이 써서 다음 작업 F06 을 가져가는 오귀속이 실측됐다).
운영(145) 기록은 70 에서 `scripts/pull_diagnostics.py`(관리자 사번 로그인, 로그아웃 안 함 — 로그아웃 API 가 외부 앱 세션을 끊는다)로 가져오고 대응 후 `mark` 로 handled 표시.
⚠ 새 Nastran 실행 경로가 `mark_complete` 를 안 거치면 `schedule_collection(job_id, …, extra_dirs=[산출 폴더])` 를 직접 부를 것(편집 적용이 그 예). 테스트는 conftest 가 `HITESS_DIAGNOSTICS=0` 으로 끈다.

**HiTESS Story 영상 — 보호 재생 (2026-10-26)** — 저작권 때문에 영상 파일을 넘기지 않고 WorkBench 안에서만 보게 한다.
- 백엔드 `routers/videos.py`: `GET /api/videos`(목록) → `POST /api/videos/{id}/ticket`(로그인 사용자에게 3시간짜리 서명 표 + 워터마크 '이름 사번', 시청 기록 `VIDEO_PLAY`)
  → `GET /api/videos/stream/{id}?t=`(Range 지원). **`/static/videos` 공개 경로는 없앴다** — 되살리지 말 것(`test_database_lifecycle` 이 잡는다).
  표의 비밀값은 프로세스마다 새로 만들어 재시작하면 재생 중이던 창은 다시 열어야 한다.
- 영상 추가 = 서버 `HiTessWorkBenchBackEnd/Videos/`(git 미추적)에 mp4 + 같은 폴더 `videos.json`(`[{file,category,title,subtitle}]`, 순서=목록 순서). 재시작 불필요.
  **목록 화면은 category 별 묶음**(2026-10-26 오후, 분류 = HiTESS 소개 · 구조 해석 · 생산 지원 자동화) — 묶음 제목에 편수·전체 길이, 행마다 제목·설명·재생 시간.
  재생 시간은 서버가 mp4 `moov/mvhd` 에서 읽는다(`_mp4_duration`, 못 읽으면 표시 안 함). 묶기·시간 표기 = `utils/videoCatalog.js`(+테스트).
  `videos.json` 이 없으면 파일명에서 `HiTESS-`·`_` 를 걷은 제목 + '기타 영상' 한 묶음이 된다 — 145 에서 파일명 제목이 보이면 `videos.json` 이 안 들어간 것이다.
  ⚠ 이 목록 개편(백엔드 `videos.py`·프론트 `dashboardShared.jsx`·`videoCatalog.js`)은 **미커밋**이고 v1.6.29 exe 에는 없다.
- Electron `electron/video-window.js`: 영상 전용 창에만 `setContentProtection(true)`(캡처·녹화·화면 공유에 검게 나감), 메모리 세션에서 다운로드 취소,
  새 창·이동 금지, 패키징본 개발자 도구 끔, 영상 위 떠다니는 워터마크, 전체 화면은 영상+워터마크 무대째로. ⚠ 본체 창에는 걸지 않는다(Teams 원격 지원 화면이 검게 나감).
  휴대폰 촬영·가상머신·캡처보드는 못 막는다 — 워터마크는 그때 누구 화면인지 남기려는 것이다.
- 브라우저·옛 exe 에서는 재생하지 않고 '최신 WorkBench 앱에서만' 안내만 한다(보호 없는 재생 경로를 만들지 않으려고). 로그아웃 때 영상 창도 닫는다.
- 상태(2026-10-26): 커밋·릴리스에 포함(백엔드 1760 통과, Electron 검증 3건, 독립 리뷰 반영 — 영상 응답도 Content-Length 없이 chunked, 본체 종료 시 영상 창 닫기). 영상 창·캡처 차단은 **눈으로 확인 안 함**.
  배포 순서 = **새 exe 먼저**(서버를 먼저 올리면 옛 exe 의 영상이 404) → 145 `Videos\` 에 mp4 10개 + `videos.json` 수동 복사 → ⟳ Update.

**사용자 유입 시험 기능 3종 (2026-11-03, 미커밋·확정 대기)** — 목표는 체류 시간이 아니라 재방문과 앱 확산이다(10월 실행의 72%가 상위 7명, 80%가 상위 3개 앱). 사용자가 확인 후 기능별로 확정하거나 뒤로 돌린다. 쇼츠 라이브러리(`claude-animated-shorts`)는 쓰지 않기로 했다(Remotion 유료 라이선스).
- **결과 공개 연출·권상 재생**: Module Unit Studio 0.0.182(70 로컬, 핀 동기화, 145 미공개). 모델이 바닥에서 들려 올라오며 와이어가 해석 장력 색으로 바뀐다. 들리는 동작은 연출이고(화면에 표시) 색·변형·장력만 해석 결과다. `data/resultReveal.js`(+테스트) · `three/ResultRevealOverlay.js` · `components/ResultRevealStamp.jsx`, 해석 완료와 결과 도크 '다시 재생'에서만 재생. 판정 규칙은 Electron·`gmuLiftingVerdict.js` 와 같아야 한다.
  ⚠ 연출 동안 기본 모델·절점을 숨긴다 — 절점 빨강이 응력 초과로 읽혔다. 변형은 과장이라 배율을 항상 표시한다.
- **해석 실패 위치 안내 (2026-11-03)**: FATAL 9050 본문에는 번호가 없고 앞선 경고 4698 표가 문제 절점을 말한다. `services/f06_location.py` 가 실패 문구에 `위치 후보 절점: …` 을 붙이고(Electron 무수정), Studio `data/structuralFailure.js` · `StructuralFailureGuide.jsx` 가 읽어 카메라를 옮기고 표식한다. 낱말을 바꾸면 양쪽 다 고칠 것.
  **떨어진 부재 묶음 안내 (MU 0.0.205, 2026-11-10, 릴리스 표 `821e150`·MU `ee7fcb9` — 145 ⟳ Update 는 사용자 몫, 화면 눈으로 확인 안 함(렌더 시험만))**
  리뷰 '고치면 좋음' 미반영: 이을 자리 계산이 묶음×본 구조 절점 전수(큰 모델 편집 때 느려질 수 있음) · 묶음 절점이 전부 RBE 에 걸려 있으면 걸린 절점을 제안(패널이 종속 중복으로 막음 → link 없이 '지우기'만 보일 것) · 이 경로 RBE 의 remark 기본값 UBOLT. — 실패 절점이 본 구조와 이어지지 않은 묶음에 있으면 카드에 묶음 크기·가장 가까운 이을 자리를 보이고
  [RBE 로 잇기](본 구조 절점 = 독립으로 채운 RBE 패널) · [묶음 지우기](그 부재를 고른 삭제 패널)로 Edit 탭에 넘긴다. 확정은 사용자(분리 그룹 자동 차단·자동 연결 안 함 결정 유지).
  연결은 편집 모델로 다시 센다(`structuralFailure.detachedFailureGroups` — 원본 그룹은 RBE 삭제·추가를 모름). 실례 3469 M02: N737 평강 4개 묶음, 자리 N738 ↔ N2805 40 mm(그 RBE 로 Nastran 정상 종료 확인).
  실측: 3454 실제 F06 → 9곳 전부 모델에서 찾음. 표가 없는 오류(9994·2101·5289 등)는 위치 안내 없이 기존 문구만 나온다(2101·5289 는 실제 F06 샘플이 없어 미구현). 후보는 Nastran 이 지목한 절점이지 고칠 자리 확정이 아니다.
- **대시보드 '3D 보기'**(코드명 ModelWall, 화면에 '모델 벽'이라 쓰지 말 것 — 사용자 지시): `GET /api/analysis/{id}/model-preview` 는 서버가 기록에서 BDF 를 고르고(`find_model_bdf`), 썸네일은 브라우저가 그려 IndexedDB 에 둔다. 같은 앱·같은 BDF 이름은 최신 1칸.
  실패는 기억하지 않는다 — '다시 시도' 또는 보기 전환으로 다시 그리고, 실패 칸은 '미리보기 없음' + 안내 줄로 말한다.
- **앱 카드 미리보기**: `Videos/previews/` 무음 클립 8개 + `previews.json`(git 미추적, 145 수동 복사), `GET /api/videos/previews` · `preview-stream`. 로그인 표는 쓰지만 `VIDEO_PLAY` 는 남기지 않고, 녹화 방지·워터마크는 없다(보호 수준은 사용자 판단 대기). `AppCard`·대시보드 타일(`QuickAppTile`) 공용 훅 `hooks/useAppPreviewClips.js`. 대시보드는 계속 떠 있어 목록이 비면 60초마다, 있으면 1시간마다 다시 받는다(재생 표 3시간 만료).
  HiTESS Model Builder 클립은 권상 쇼릴 18~26초라 `HiTESS Module Unit` 머리글이 보인다.
- **상태**: 9091 은 `--reload` 인데도 새 경로를 읽지 못해 404 였다가, 재시작 뒤 새 경로가 401 로 응답한다(F06 위치 문구 수정까지 읽었는지는 미확인). 임시 서버 + Chrome 으로만 확인했고 Electron 앱·실제 Nastran 완료·실패 시점·남의 작업 403 은 미확인. 세 기능 + 실패 안내 모두 사용자 확정 전.

**사용 기록 — 접속 이력·화면 오류·해석 소요시간 (2026-10-20)** — `activity_logs` 는 30일 뒤 지워지고 `user_presence` 는 현재값뿐이라, 장기 기록을 따로 둔다.
- **접속 이력 `access_sessions`**(기간 제한 없음): 로그인~앱 닫기 1행. 하트비트(45초)마다 `services/access_session_service.record_heartbeat` 가
  직전 간격을 `online_seconds` 에, 유휴(3분)가 아니면 `active_seconds` 와 **직전 화면**의 `page_seconds` 에 더한다(화면 이동 즉시 하트비트라 간격 = 직전 화면 몫).
  간격이 150초를 넘으면 새 세션. 닫는 곳 = 로그아웃(logout)·창 닫기 beacon(closed)·강제 로그아웃(forced)·재로그인(relogin)·정리 스케줄러/다음 하트비트(timeout).
  PC 정보(`hostname`·`os_user`·`platform`)는 Electron `app:client-info` → 하트비트 `client` 로 온다. 관리 화면 = User Management '접속 이력'(`/api/presence/sessions[/summary]`).
  ⚠ 임계값(150·180초)은 `presence.py` 와 같아야 한다(`test_thresholds_match_presence_router`).
- **화면 오류 `CLIENT_ERROR`**(activity_logs, 30일): React `window.onerror`·`unhandledrejection`(`api/clientTelemetry.js`, 같은 메시지 3회·세션 30건 상한)과
  Electron `render-process-gone`·`child-process-gone`(main 이 userData `pending-client-errors.json` 에 쌓고 다음 로그인 때 화면이 꺼내 보냄).
  `POST /api/activity/client-error` 는 로그인 전 오류도 받으려고 **인증 없음**(유효 토큰이면 사번, IP당 분당 20건).
- **`analysis.finished_at`**: `_write_through`·`record_analysis` 가 Success/Failed/Cancelled 때 기록. 소요시간 = finished_at − started_at. 도입 전 기록·Interrupted 는 NULL.
  화면 표시는 하지 않는다(2026-10-20 사용자 결정 — 필요 없음). 기록만 유지.
- 배포(2026-10-20): v1.6.21(`733d3dc`). 145 Server Manager ⟳ Update 와 exe 배포는 사용자가 한다. 접속 이력 패널·exe 실행은 눈으로 확인 안 함.
- 강제 로그아웃은 이제 `FORCE_LOGOUT` 감사 로그를 남긴다. ⚠ PC 정보·크래시 수집은 **새 exe 부터** 동작한다(Electron 변경).

작업 상태는 인메모리(`job_status_store`)가 1차 저장소이고, status·progress·message 는 변경마다 DB `analysis.job_status/progress/job_message` 에 write-through 된다(`_write_through`). 상태 조회 API 는 메모리에 없으면 DB 값으로 응답하고, 서버 시작 시 Pending/Running 으로 남은 레코드는 `Interrupted`(실패)로 바뀐다(`main.py` lifespan). 재시작 시 잃는 것은 실행 중이던 프로세스 자체와 대기열 순번·취소 핸들뿐이다 — Redis 는 필요 없다(2026-10-19 확인).

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

**사내 AD 로그인 (2026-11-04 — ★145 운영 켜짐: `.env` `AUTH_MODE=ad`, WorkBench 1.7.1 · mb-launcher 0.1.2 반영)**
145 확인(같은 날): `/api/login/options` → `ad`, 사번만 `POST /api/login` → 401 `password_required`(보안 테스트 1단계 차단), 사용자가 1.7.1 로 로그인 성공.
되돌리기 = 145 `.env` 의 그 줄 삭제 + Server Manager 재시작(⟳ Update 만으로는 `.env` 를 다시 읽지 않는다).
남은 일: AM 사용자 PC 에 `HiTessMB.exe` 0.2.0 배포(옛 0.1.0 은 AD 서버에서 로그인 못 함) · AM 개발팀에 종료 코드 9 알림 · hitess-core 로그인 계약 문서 갱신 · `HiTessMBClient` 원격 저장소 없음(이 PC 에만 있음). — 보안 테스트(`HanByul/99_Security_Test_Re`)가 `POST /api/login {employee_id}` 만으로 토큰을 받아
외부 App 을 브라우저로 열었다. 원인은 세션 설계가 아니라 **인증 부재**(사번은 비밀이 아님, 9091 은 전사 개방). 그래서 `.env` `AUTH_MODE=ad` 이면 `/api/login` 이
사번 + 회사 PC(AD) 비밀번호를 요구한다. 비우면 예전 계약 그대로(`test_auth_contract.py`).
- 서버 `app/services/ad_auth.py`: ldaps `HHIWVRA06.HHI.co.kr:636`, bind `HHI\<사번 소문자>`(AD 계정명 = 사번 확인). 비밀번호는 저장·기록 안 함(`schemas.LoginRequest.password` = `SecretStr`).
  ⚠ 사내 AD 인증서가 **RSA 1024** 라 OpenSSL 기본이 거부한다 → 검증·이름 확인은 켠 채 `SECLEVEL=1`(`.env` `AD_LDAP_TLS_SECLEVEL`). 빈 비밀번호는 AD 에 보내지 않는다(익명 bind 함정).
  틀린 시도는 **AD 에 묻기 전에** 사번별 15분 4회·IP별 20회로 끊는다(429) — AD 잠금이 직원 회사 PC 계정까지 잠그기 때문. AD 확인을 DB 사번 조회보다 먼저 해 '등록된 사번인지' 를 흘리지 않는다.
  ⚠ 횟수는 **프로세스 메모리**에 센다 — 145 는 `server_manager.py` 가 uvicorn 을 워커 1개로 띄워 맞다. `--workers N` 으로 바꾸면 제한이 N배로 느슨해져 AD 잠금 기준을 넘으니 그때는 DB 로 옮긴다.
  반대로 남이 내 사번으로 4번 틀리면 나도 15분 WorkBench 에 못 들어온다(회사 계정 잠금을 막으려고 감수한 절충 — 문의 오면 이 설명).
  응답 detail: `password_required`·`invalid_credentials`·`account_locked`·`password_expired`·`account_disabled`(401) · `too_many_attempts`(429) · `auth_unavailable`(502). 화면 문구 = `LoginScreen.jsx` `AD_LOGIN_MESSAGES`.
- 로그인 방식 조회 `GET /api/login/options` → `{auth_mode}`(`/api/version` 은 키 하나 계약이라 건드리지 않음). 프론트 `getLoginOptions` 가 옛 서버(404)면 사번만.
- 테스트 `tests/test_ad_login.py`(AD 대역). 실제 AD 확인(2026-11-04, 70): 사번만 → 401 password_required, 없는 계정 틀린 비번 → 401 invalid_credentials. 맞는 비밀번호 → 사용자가 개발 WorkBench 로그인 화면에서 직접 입력해 로그인 성공 확인(같은 날).
- **AM 연동 2단계 (2026-11-04 구현)**: `HiTessMB.exe` **0.2.0**(`HiTessMBClient`, 별도 git)이 AD 서버면 비밀번호 창(최대 3회, 종료 코드 9)을 띄우고,
  받은 토큰을 **환경 변수 `HITESS_WB_TOKEN`** 으로 실행기에 넘긴다. 실행기 `mb-launcher` **0.1.2**(`AmLauncher/`)가 그 토큰을 `GET /api/session/context` 로
  확인(같은 사번만)해 쓰고, 이미 떠 있는 실행기에는 single-instance additionalData 로 넘긴다. 토큰이 없으면 예전 사번 로그인(스위치 꺼진 서버에서는 그대로 동작).
  실사용 확인(2026-11-04, 70 AD 모드): 비밀번호 창 → `로그인 200 (AD)` → 접수 #3207 → 실행기 0.1.2 `넘겨받은 로그인 정보 사용` → Studio 3454 열림(사용자 확인).
  같은 시험에서 기존 결함 2건이 드러나 고쳤다 — 작은따옴표 경로(cmd)에서 .NET `NotSupportedException` 으로 로그 없이 종료 → 인자 오류(종료 코드 2),
  실행기 폴더 이름 바꾸기가 방금 푼 파일을 보안 검사가 잡아 '액세스 거부' → 최대 9회·약 21초 재시도(재시도 경로는 실제로 타 보지 못함, 빌드만 확인).
  상세: 각 README. ⚠ 배포 순서 = 145 `StudioProgram\mb-launcher-0.1.2.zip`(UNC 경로로 `AmLauncher\build.ps1 -OutDir` — 70 로컬 zip 은 DRM 암호문) → 새 `HiTessMB.exe` 배포 → 스위치.
- **회사 PC 계정 자동 로그인 (2026-11-05, `ca3e1c4`, WorkBench 1.7.2 에 포함)** — 계획·0단계 시험 = `RecordMD/2026-11-05-https-certificate-pinning-plan.md`.
  `POST /api/login/windows`(Windows 통합 인증 Negotiate, `services/windows_auth.py`): 비밀번호·사번을 받지 않고 Windows 가 만든 토큰을 SSPI(pywin32 `sspi`)로 확인해
  `HHI\<사번>` 에서 사번을 얻는다 → 기존 세션 발급(`auth._complete_login`). NTLM 은 같은 연결에서 두 번 오가서 연결(IP+포트)별 상태를 30초 든다.
  `AUTH_MODE=ad` 면 저절로 켜지고 `AD_WINDOWS_LOGIN=0` 으로 끈다. `/api/login/options` 에 `windows_login` 이 붙었다.
  클라이언트: WorkBench Electron main `electron/windows-login.js`(화면 axios 는 교차 출처라 HTTP 인증이 안 실림 → IPC `auth:windowsLogin`) · 로그인 화면 '회사 PC 계정으로 로그인' + 화면이 뜨면 1회 자동(직접 로그아웃한 뒤엔 앱을 다시 켤 때까지 안 함) ·
  Studio 세션 갱신 `refreshWorkbenchSession` 도 먼저 자동 로그인(같은 사번만) · HiTessMB 0.3.0(`UseDefaultCredentials`, 사번 다르면 비밀번호 창) · mb-launcher 0.1.3(`lib/windows-login.js` 사본).
  실측(70): 145 → 70·70 → 145 시험 서버 모두 성공(IP = NTLM, FQDN = Kerberos), Electron 26 `net.request`·.NET 4.8 이 스스로 Negotiate 처리. 145 는 도메인 가입 PC(로컬 계정 `CF40Admin` 으로 돌아도 도메인 계정 확인됨).
  화면(사용자 결정 2026-11-05): 별도 버튼·'회사 PC 계정' 문구 없음 — 사번 칸 + ACCESS 만, 누르면 Windows 계정으로 확인하고 안 되면 그때 비밀번호 칸.
  **쿼리 `?employee_id=` 로 입력 사번을 보내고, 서버가 Windows 계정과 다르면 세션을 만들기 전에 403 `windows_account_mismatch`**
  (커밋 전 리뷰 — 남의 PC 에서 그 PC 주인 이름으로 로그인 처리·미가입 오판이 일어났다). ⚠ 본문(JSON)으로 보내면 **Electron 40 이 NTLM 3번째 메시지를 보내지 않고 멈춘다**(실측, 26 은 정상) — 본문을 싣지 말 것.
  NTLM 3번째 메시지에 평문으로 든 사용자 이름(`ntlm_claimed_account`)으로 **SSPI 에 묻기 전에** 비밀번호 로그인과 같은 횟수 제한(사번 15분 4회·IP 20회, 두 경로 합산)을 건다 — 없으면 이 경로로 직원 계정을 잠글 수 있다. 누군지 모르는 실패는 IP 별 키(`windows-ip:<ip>`).
  Electron IPC 는 본창만 받고(`event.sender`), Windows 자격 증명은 사내 주소(사설 IPv4·`*.hhi.co.kr`)로만 보낸다(`isInternalHost`).
  개발 앱에서 한 번 15초 시간 초과가 났다 — 원인 미확정(본문 문제 이전 코드에서도 1회 발생). 실패해도 ACCESS 재시도 → 비밀번호 칸으로 막히지 않는다.
  70 AD 모드 실제 로그인 확인함. 비밀번호 로그인은 예비로 유지.
  **보안 재시험(2026-11-05, 145:9443, `HanByul/Open-ModuleTest-InBrowser`)**: 남의 사번 `?employee_id=` → 403 `windows_account_mismatch` · 사번만 `/api/login`(9443·9091) → 401 · 토큰 없는 `__wb_bootstrap` → 401.
  본인 AD 계정으로 로그인한 Windows 세션에서 본인 사번이면 통과해 외부 App 을 브라우저로도 열 수 있다 — 앱과 같은 권한이라 취약점으로 보지 않음(사용자 확인). 시험 사번은 동료 대신 없는 계정 `Z999998`(실패 횟수가 동료 계정에 쌓이지 않게).
  **VMDC(가상 PC) 계정 (2026-11-09)** — AM 사용자 A453013 이 HiTessMB 0.4.0 에서 계속 비밀번호 창을 봤다. 145 활동 로그 = `account_not_employee`·`account: VMDC\A453013`(IP 10.14.45.74).
  145 가 트러스트로 인증까지 마친 뒤 도메인이 HHI 가 아니라 거절한 것이고, 비밀번호 창은 HHI 비밀번호를 묻기 때문에 VMDC 사용자에게 맞지 않는다.
  → `.env` `AD_WINDOWS_DOMAINS=HHI,VMDC`(`AD_NETBIOS_DOMAIN` 은 늘 포함 — 리뷰 반영)로 자동 로그인이 받을 도메인을 넓혔다(`windows_auth.windows_domains`). 비밀번호 로그인(LDAP bind)은 그대로 HHI.
  ⚠ 넣는 도메인은 **계정 이름 = 본인 사번** 이 보장되는 곳만(VMDC 는 IT 확인 권장, 아직 안 함). 클라이언트 재배포 불필요 — 145 `git pull` + `.env` 한 줄 + 재시작.
  상태: `1888654` 푸시 · **145 반영(`.env AD_WINDOWS_DOMAINS=VMDC`) 후 VMDC 사용자 자동 로그인 동작 확인**(사용자, 같은 날).
  같은 날 로그에 AM 이 CSV 인자 없이 HiTessMB 를 부른 기록(인자 오류) 3건 — AM 쪽 호출 문제.
  **계열사 PC = 등록한 PC 로그인 (2026-11-10, `9946fc7` · 릴리스 1.7.17 `228995d`)** — 계열사 직원 PC 는 도메인에 가입하지 않은 **로컬 계정**이다(`whoami` = `a590063\a590063`, A590063·A540031 확인).
  그래서 Windows 자동 로그인은 원리상 안 되고(`windows_auth_failed`), 비밀번호 칸이 떴다. 비밀번호 로그인 자체는 HHI AD 로 된다(A590063 성공 확인).
  사용자 결정: **회사 Windows 비밀번호를 계열사 직원에게 입력하게 하지 않는다**(보안 이슈로 주목받을 수 있음) · **본사(도메인) PC 는 지금 그대로**.
  → 앱이 PC 마다 Ed25519 열쇠를 만들어 비밀 열쇠는 safeStorage(DPAPI, Windows 사용자 단위)로 잠가 두고, 관리자가 한 번 승인하면 이후 서명으로 들어온다.
  - 판별: Electron `electron/device-login.js` `isLocalAccount` = `USERDOMAIN == COMPUTERNAME`. 이 PC 는 Windows 자동 로그인을 시도하지 않고 비밀번호 칸도 없다(`utils/deviceLogin.js` `isDeviceMode`).
  - 서버 `services/device_login.py` · `routers/device_login.py`(`/api/login/device/enroll|challenge`, `/api/login/device`, 관리자 `/api/admin/devices[/{id}/approve|reject|revoke]`), 표 `trusted_devices`(create_all).
    서명 글 = `hitess-device-login:<device_id>:<nonce>`(nonce 60초·한 번), 앱은 이 머리의 글만 서명한다. 상태(대기·해지)는 서명이 맞은 뒤에만 알려 준다. 90일 안 쓰면 만료.
    ⚠ 문제는 **nonce 값으로** 찾는다(기기 번호로 하나만 들면 남이 같은 번호로 문제를 받아 정상 PC 의 문제를 덮어써 401 → 앱이 승인된 열쇠를 지웠다, 커밋 전 리뷰 '막아야 함').
    낡은 문제 = 409 `challenge_stale`, 서명 불일치 = 401. 앱은 401·409 에 새 문제로 한 번 더 시도한 뒤에만 열쇠를 버린다. 사용자 삭제 시 그 사번 PC 등록도 해지.
    **기본 확인 = 회사 메일 코드**(사용자 결정 2026-11-10: 관리자가 직원에게 코드를 묻지 않게) — 등록 요청 때 `users.email` 로 6자리 코드를 보내고(`services/mailer.py`, `.env` `SMTP_HOST`·`SMTP_PORT`·`SMTP_FROM`·`SMTP_USER`·`SMTP_PASSWORD`·`SMTP_STARTTLS`),
    직원이 앱에 입력하면 바로 승인(`/api/login/device/verify`, 10분·5회 틀리면 무효, `/resend` 60초·5통). 확인·다시 보내기도 그 PC 열쇠 서명(`hitess-device-login:verify|resend:<id>:<nonce>`)이 필요하다.
    메일이 없거나 SMTP 설정이 없거나 발송 실패면 **관리자 승인**으로 넘어간다 — 확인 코드(공개 열쇠 지문 `XXX-XXX`)를 관리자가 이미 아는 연락처로 직원에게 물어 적어야 승인(`confirm_code_mismatch`).
    두 번째 커밋 전 리뷰 반영: 틀린 횟수는 비교 전에 한 줄 UPDATE 로 올린다(읽고 더하면 동시 요청에서 유실 → 5회 제한 우회, '막아야 함' — MySQL 동시 20건 = 틀림 5·잠김 15 확인) · 확인 요청 IP당 시간 60회 ·
    대기 요청 24시간 만료(남이 대기 3건을 채워 본인 등록 막기 방지) · 메일 본문 PC 이름은 NetBIOS 모양만(`safe_hostname`) + 요청 IP · 메일 방식 화면에도 관리자용 확인 코드 작게 · STARTTLS 인증서 확인.
    남긴 것: 등록 요청 응답이 사번 가입 여부·메일 앞 2자를 드러냄(`/check_user` 와 같은 수준이라 그대로), 계정이 있는데 STARTTLS 를 안 켜면 SMTP AUTH 가 평문(사내망).
    SMTP: 사내 메일 서버 `exmail.hhi.co.kr:25` 는 `AUTH LOGIN` 만 받고 **STARTTLS 미지원**(`SMTP_STARTTLS` 넣지 말 것 — 계정은 사내망 평문, 기존 `Postman_Console` 과 같음).
    계정·보내는 주소는 `Postman_Console/Program.cs` 의 발송 계정(21·22·25행)을 사용자가 70 `.env` 에 넣음(2026-11-10). **70 실제 발송 확인**: 본인 메일(`@hd.com`)로 코드 수신 → 코드 입력 승인 → 로그인 토큰까지 통과.
    145 는 `.env` 에 같은 SMTP 줄 + 145 에서 25번 접속 확인이 남았다(**없으면 메일 대신 관리자 승인으로 넘어간다** — 공지 메일은 '메일로 코드가 온다'고 안내하므로 넣은 뒤 보낼 것). 계열사 직원 메일함 도착은 확인 안 함.
    상태(2026-11-10): 145 서버 1.7.17 반영(사용자 ⟳ Update+재시작). 공지 메일(새 exe 받기 + PC 등록 방법)은 Outlook 초안으로만 만들었고 발송은 사용자 몫.
  - 화면: 로그인 화면 '이 PC 등록 요청' → (메일) 6자리 코드 칸·코드 다시 보내기 / (관리자) 확인 코드 표시 + 15초마다 확인, 승인되면 저절로 들어감. 관리자 = User Management 'PC 등록 [대기 N]'(`TrustedDevicesModal`). 활동 로그 `DEVICE_ENROLL/APPROVE/REJECT/REVOKE`, 로그인 기록 `method: device`.
  - 끄기 `.env DEVICE_LOGIN=0`(AD 모드에서만 켜짐). 반영 = 145 ⟳ Update + 재시작(새 표) + **새 exe**(Electron IPC `device:info`·`device:op`). 옛 exe 는 예전처럼 비밀번호 칸.
  - 확인: 서버 시험 + 70 MySQL 임시 서버로 등록~승인~서명 로그인~해지 실제 호출, Electron 26 에서 만든 서명을 서버가 검증. **로그인 화면·관리 창은 눈으로 확인 안 함**, 실제 계열사 PC 시험 안 함.
  - 범위 밖: Studio 세션 갱신(`refreshWorkbenchSession`)은 등록 PC 로 재로그인하지 않는다(만료 시 본창 로그인 화면으로 — 거기서 자동으로 들어감). AM 실행기·HiTessMB 는 미적용.
- **HTTPS + 인증서 고정 (2026-11-05, 통합 계획 2·3단계)** — 2단계 `0823543`: 같은 프로세스가 9091 옆에 9443 HTTPS(`services/https_listener.py`, `.env` `HTTPS_PORT`, 인증서 `scripts/make_tls_cert.py` — 145 에서 실행, 키는 `.secrets/tls/`).
  3단계(`9a14ec7`·`881eeb3`, 릴리스 1.7.2 `6045358`): 앱이 145 인증서의 공개키 지문(지금 `y5rO…`·예비 `u1mZ…`)이 같을 때만 연결 — **원본 `electron/server-pins.js`**, 사본 `AmLauncher/lib/server-pins.js`·HiTessMB `src/ServerPins.cs`·프론트 `utils/secureServerUrl.js`(주소 바꾸기만). 지문·주소를 바꾸면 네 곳 다.
  규칙: 지문 일치 = 통과 · 145 주소인데 불일치 = 거부(회사가 믿는 Somansa 인증서여도) · 그 밖 = 기본 검사. 개발 실행만 70 시험 지문(`DEV_PINS`)도 받는다.
  ⚠ Electron main 의 Node `fetch`·`https.get` 은 고정 검사를 거치지 않는다 → 서버 요청은 `serverFetch`(net.fetch)·`net.request` 로만. 검사 함수는 첫 요청 전에 건다(Chromium 이 세션별로 결과를 기억).
  화면은 시작 때(`secureServerBootstrap.js`) 저장된 `http://10.14.42.145:9091` 을 `https://…:9443` 으로 바꾼다. 사용자가 서버 설정에 직접 넣은 주소(`wb_server_url_manual`)는 그대로 — 145 HTTPS 장애 때 평문으로 되돌리는 비상구.
  이중관 Mode Shape 뷰어·HiTessMB 가입 페이지(브라우저)는 평문 그대로. 버전: 실행기 0.1.4 · HiTessMB 0.4.0. 실측(70:9443): 개발 앱 로그인·내 작업·Studio, Electron 26·40 Windows 로그인·FormData·자체 업데이트 다운로드, HiTessMB 지문 있음/없음.
  **상태(2026-11-05 세션 끝)**: 145 HTTPS 켜짐(`.env HTTPS_PORT=9443`, 70 에서 지문 일치·앱 코드로 Windows 로그인 200) · 145 `StudioProgram\mb-launcher-0.1.4.zip` 복사됨 · exe 1.7.2 빌드·푸시(`dist_electron\HiTESS-WorkBench-v1.7.2.exe`).
  **같은 포트 HTTPS (2026-11-10, 1.7.16)** — 계열사 다른 위치가 보안 정책으로 145 의 **9091 만** 방화벽을 열어 둬, 1.7.2~ 앱이 9443 에 못 붙었다
  (로그인 화면 '서버 연결을 복구해야…', AD 와 무관 — 버전 확인 단계에서 실패). 사용자 결정: 수동 주소 변경은 번거로워 안 하고, **9091 이 평문과 HTTPS 를 함께 받게** 한다.
  `app/services/port_mux.py` `MuxHTTPProtocol` — 연결의 첫 바이트가 0x16(TLS)이면 그 자리에서 asyncio `SSLProtocol` 로 바꾸고 받은 바이트를 넘긴다(scheme=https·접속 IP 그대로), 아니면 uvicorn 기본 처리.
  켜짐 = `server_manager.py` `SERVER_CMD` 의 `--http app.services.port_mux:MuxHTTPProtocol` + `.env HTTPS_PORT`(같은 인증서), 끔 = `HTTP_PORT_TLS=0`. ⚠ `asyncio.sslproto` 내부 API — 파이썬을 올리면 `tests/test_port_mux.py` 로 확인.
  앱 주소표(`electron/server-pins.js`·`utils/secureServerUrl.js`): `http://…145:9091` 과 1.7.2~1.7.15 가 저장한 `https://…145:9443` → **`https://…145:9091`**. 인증서 고정은 그대로(호스트 기준).
  9443 은 옛 exe·실행기(AmLauncher)·HiTessMB 용으로 계속 연다 — 그 둘은 9443 그대로(사용자 결정: 외부 쪽은 안 바꿈). 직접 넣은 주소(수동)는 바꾸지 않는다.
  ⚠ **반영 순서**: 145 `git pull` → **서버 관리자 창을 닫고 다시 열기**(⟳ Update 는 메모리의 옛 `SERVER_CMD` 로 재시작해 `--http` 가 안 붙는다) → 다른 PC 에서 `curl -k https://10.14.42.145:9091/api/version` 확인 → 새 exe 배포.
  서버보다 exe 가 먼저 나가면 **모든 사용자가 접속 못 한다**. 계열사 사용자는 지금 접속이 안 돼 자동 업데이트를 못 받으니 새 exe 를 따로 전달해야 한다.
  확인: 실제 uvicorn(시험·명령줄)에서 평문·TLS·keep-alive·3MB 업로드·깨진 TLS 뒤 회복, 헤드리스 Chrome 이 같은 포트 HTTPS 로 받음.
  **145 반영(2026-11-10)**: 1.7.16(`2493283`) ⟳ Update 만 한 동안은 9091 이 TLS 에 평문으로 답해(`SEC_E_INVALID_TOKEN`) 새 exe 가 '서버 연결을 복구해야…' 로 막혔고,
  서버 관리자를 끄고 다시 연 뒤 70 에서 `https://…145:9091`·`http://…145:9091`·`https://…145:9443` 모두 1.7.16, 사용자 1.7.16 exe 로그인 확인.
  ⚠ 옛 exe(1.7.2~1.7.15)는 9443 으로만 붙어 그 계열사에서 **업데이트 창도 안 뜬다**(2026-11-10 실제 문의) — 새 exe 를 직접 전달하는 것이 기본.
  **메일용 내려받기 주소 `http://10.14.42.145:9091/download`** (2026-11-10, `c39e8b2`) — 로그인 없이 `LastestVersionProgram` 의 가장 새 exe(mtime 기준)를 준다(`system.public_router`, `/api/download/client` 와 같은 `_serve_latest_client`, 활동 로그 type `direct_link`). 145 반영·1.7.17 내려받기 확인함. 메일 미리보기가 링크를 먼저 열면 내려받기 기록이 부풀 수 있다. ⚠ '최신' = 버전 번호가 아니라 **파일 수정 시각**(`system.py` `_serve_latest_client`) — 옛 exe 를 나중에 그 폴더로 복사하면 옛것이 나간다. 폴더에는 최신 exe 하나만 둔다(사용자 운영 방식, 이름 버전 정렬로 바꾸는 안은 보류).
  예비: 옛 exe 서버 주소를 `http://10.14.42.145:9091` 로 직접 넣어 업데이트를 받은 뒤, 새 exe 에서 `https://10.14.42.145:9091` 을 다시 직접 넣는다
  (직접 넣은 주소는 '수동' 이라 새 exe 도 바꾸지 않아 평문으로 남는다. 서버 설정 '기본값' 은 config 기본 9443 이라 누르지 말 것).
  남은 일: 계열사 PC 에 1.7.16 exe 따로 전달 후 접속 확인 — 안 되면 그 PC 에서 `curl.exe -skv https://10.14.42.145:9091/api/version`
  (TLS 단계 실패면 그쪽 보안 장비의 HTTPS 가로채기 → 인증서 고정이 끊는 경우). HiTessMB `ServerPins.cs` 주석은 실행기처럼 '9443 유지' 로 고치지 않았다(별도 저장소).
  남은 일: exe 1.7.2 배포 → 145 ⟳ Update + 재시작(서버 버전 1.7.2) · HiTessMB 0.4.0(`cab9bf7`, 원격 없음) AM PC 배포 · 외부 App 저장·계산 확인(화면 열림만 확인) · 외부 개발자에게 `RecordMD/2026-11-05-external-app-https-pinning-handoff.md`(+11-03 문서) 전달 · 70 `.env` 시험 줄(`AUTH_MODE=ad`·`HTTPS_PORT=9443`) 정리 · 4단계(9091 로그인 거부)는 1.7.2 가 퍼진 뒤.
  릴리스 스크립트는 로컬 145 줄이 `https://10.14.42.145:9443`·`http://…:9091` 어느 쪽이든 받는다(`2266080`). `http://…:9443` 은 네 사본 모두 https 로 고친다(`881eeb3`).
  ⚠ **배포 순서**: 145 HTTPS 켜기(인증서 → `.env HTTPS_PORT=9443` → 재시작 → 방화벽 9443 → 다른 PC 에서 확인) → 145 `mb-launcher-0.1.4.zip` → WorkBench exe → HiTessMB 0.4.0(0.1.3 실행기는 HTTPS 를 못 받는다). 새 exe 를 한 번 켠 PC 는 옛 exe 로 되돌리면 접속 못 한다(저장 주소가 https).
- ⚠ **스위치를 켜기 전에 반드시**: ① 새 WorkBench exe(1.7.1, 비밀번호 칸) 배포 ② 위 AM 연동 두 프로그램 배포
  ③ 145 `pip install -r requirements.txt`(`ldap3`) + 145 에서 AD 636 접속 확인(70 만 확인함).
  Electron `refreshWorkbenchSession`(401 때 사번만 재로그인)은 고치지 않았다 — AD 모드에선 실패하고, 본체 화면 하트비트 401 → `App.jsx` 인터셉터가 로그인 화면으로 보낸다.
  `check_user`(토큰 안 줌)·`hitessbeam` 익명 업로드는 이번 범위 밖. 켤 때 hitess-core 로그인 계약 문서(`docs/20-phase2-identity.md`)도 갱신.

### 가입자 단체 메일 (2026-11-09, WorkBench 1.7.13)

User Management 버튼 줄의 **'메일 주소 복사'** — **지금 목록(검색·필터 반영, 2026-11-10 변경)** 의 승인(is_active) 사용자 `users.email` 을 `; ` 로 이어 복사한다(검색·필터가 없으면 전원, 페이지 나눔과는 무관). 이 변경은 `1d856e0`, 1.7.16 이후라 다음 exe 부터 반영·버튼은 눈으로 확인 안 함.
Outlook **숨은 참조(BCC)** 에 붙여 보낸다(주소 노출·전체 회신 방지). 그룹·배포 목록은 만들지 않기로 했다 — 200명대는 Exchange 기본 한도(1통 500명) 안이고 DL 은 신청·수동 유지가 든다.
주소가 없거나 모양이 틀린 사람은 토스트로 이름을 알린다(PLM 미등록·협력사 X 사번 — 메일은 PLM 백필, 메모리 `reference_plm_user_directory`). 규칙 `utils/userMailList.js`(+테스트), 프론트만(`027dfec`).
**메일 손으로 넣기 (2026-11-09, 미커밋)** — 필터 칩 '메일 없음'(승인 사용자 중 쓸 주소 없음) · 행의 '메일 없음 · 넣기' → 정보 수정 창 '메일' 칸.
`PUT /api/users/{id}` 에 `email` 이 오면 **값이 바뀐 때만** `users.email_manual` 을 세운다(비우면 해제 → 다음 PLM 갱신이 다시 채움, 모양 틀리면 422 `invalid_email`).
**한 번에 넣기**(같은 날, 미커밋): 버튼 '메일 없는 N명 넣기' → `components/admin/BulkEmailModal.jsx` — 그 사람들만 표로 모아 줄마다 메일 칸, 빈 칸은 건너뛰고 아는 사람만 저장(사람마다 같은 PUT), 저장된 줄은 빠지고 실패 줄은 남음, '이름 목록 복사'(탭 구분, 주소록 찾기용). 서버 변경 없음.
`user_directory_sync.apply_plm_profile` 이 `email_manual` 인 사람의 email 은 건너뛴다(전체·단건·주기 갱신 공통, 다른 필드는 반영). 목록에 '수동' 배지. 주소 규칙은 백엔드 `_MANUAL_EMAIL_PATTERN` ↔ 프론트 `EMAIL_PATTERN` 사본.
컬럼은 `schema_bootstrap` 이 붙인다(70 MySQL 두 번 실행 확인). 반영 = 145 ⟳ Update + **재시작**(컬럼) + 새 exe. 옛 exe 로 정보 수정해도 email 을 안 보내 표시는 안 바뀐다. ⚠ 서버를 먼저 — 옛 서버는 새 exe 가 보낸 email 을 조용히 버린다.
회사 한도를 낮춰 뒀는지는 미확인(넘으면 반송으로 알 수 있음). 1.7.13 exe(`ddf4633`) 배포·145 ⟳ Update+재시작(VMDC 자동 로그인 `1888654` 포함)은 사용자 몫, 버튼은 눈으로 확인 안 함.
⚠ 미추적 `Postman_Console/Program.cs` 에 메일 계정 비밀번호가 평문으로 있다 — 커밋하지 말 것.

### 웹 뉴스레터 — 로그인 없이 여는 공개 페이지 (2026-11-09, 26년 11월호 = 통합 3호)

주소 `http://10.14.42.145:9091/newsletter` → 최신 호로 이동(307). 사내 누구나 브라우저로 연다(인증 없음, 메일 본문에는 이 링크).
- 라우터 `app/routers/newsletter_web.py`: `/newsletter` · `/newsletter/issues.json`(호 목록, 최신이 앞 — **다음 작업: 페이지 왼쪽 '지난 호' 목록이 이것을 쓴다**) ·
  `/newsletter/{호}/`(index.html) · `/newsletter/{호}/{그림·글꼴}`(확장자 허용 표만, 경로 탈출 404, read() 바이트 + DRM 머리면 500).
- 호 = `HiTessWorkBenchBackEnd/NewsLetterWeb/<YYYY-MM>[-n]/`(**git 추적** → 145 `git pull` 만으로 반영, 재시작 불필요) — `index.html` · `issue.json`(title·number·date·summary) · `img/` · `fonts/`(SUIT 자체 포함).
  새 호 = 폴더 하나 추가, 가장 큰 id 가 최신. 그림 경로는 상대(`img/…`)라 호 주소 끝 `/` 가 필요하다(없으면 붙여 이동).
- 작업 원본·그림 준비 = `outputs/newsletter-2026-11/`(git 미추적). 대시보드 '자료 › News Letter'(PDF·PNG 아카이브, `routers/newsletters.py`, UNC)와는 별개다.
- 11월호 내용 결정(사용자): 가입자 200명 돌파(사용자가 준 숫자) · HiTESS Story 영상 10편 강조 · 새 앱 = Independent Tank·Heavy Block Lifting(김한별 책임연구원)·선체 가속도(정병훈 책임연구원) + 중량물 권상 시뮬레이터 '개발 예고' ·
  Studio 설명서 · 더 편해진 Workbench. BCC·D Type Lug·로그인 방식은 뺐다. 사람 이름 뒤에 직책. 테스트 `tests/test_newsletter_web.py`(저장소의 실제 호와 그림 경로까지 확인).
- **1분 영상판 (2026-11-10, 사용자 지시 '페이지에 영상을 넣고 아래는 지금처럼')** — 제호 바로 아래 `section.reel`(id `reel`) 에 `media/workbench-news.mp4`(10 MB, 자막 박음 — vtt 를 붙이면 두 번 나옴) + `media/workbench-news-poster.jpg`.
  라우터가 `.mp4` 를 내주고 **Range(206) 를 받는다**(없으면 넘겨 보기가 안 됨). 통계 구획에 `video`(재생함)·`video_end`(끝까지 봄)가 붙었다 — 화면 구역이 아니라 측정 스크립트가 재생 사건으로 넣는다(맨 위라 '보였다'는 늘 100%).
  제작 = `outputs/workbench-news-2026-11/`(git 미추적): `script.py`(대본, say=발음용·sub=자막) → `tts.py`(edge-tts SunHi, 문장별 mp3 + 낱말 시각, 전용 `venv`) → `build.py all`(Pillow 모션그래픽 + ffmpeg, 약 30초). 낱말 시각으로 화면 강조를 말에 맞춘다.
  ⚠ edge-tts 는 공식 API 가 아니라 막힐 수 있다(대안: Azure 같은 목소리 유료 · Windows Heami 무료·기계음). 선체 가속도 카드의 배 그림은 연출(실제 앱 화면 아님). 다음 호는 대본과 장면 함수를 새로 쓴다.
  상태: `b1506e0` 푸시 · 145 반영 후 사용자가 재생 확인(2026-11-10). **사용자 요청: 다음 호부터 매번 영상판을 만든다.** 영상이 매달 약 10 MB 씩 git 에 쌓이니 몇 호 뒤 UNC 로 옮길지 그때 묻는다.
- **조회 통계 (2026-11-10, 사용자 지시 '나만 보게')** — `services/newsletter_stats.py`. 호 페이지 GET 마다 `newsletter_views`(호 × 방문자 × 날짜 한 행, 기간 제한 없음)에 기록하고,
  서버가 보낼 때 측정 스크립트를 `</body>` 앞에 끼워 넣는다(HTML 원본은 그대로) → 화면을 떠날 때 `POST /newsletter/{호}/beacon` 으로 읽은 깊이·보인 시간·본 구획(lead·story·apps·manuals·easier).
  방문자 = IP 해시(되돌릴 수 있어 익명 보장 아님, 사람 수가 아니라 PC 수). 기록 실패는 삼켜 페이지는 늘 열린다. 열람 행이 없으면 beacon 은 무시.
  통계 `GET /api/admin/newsletter-stats` = `.env` `NEWSLETTER_STATS_VIEWERS`(기본 `A476854`) 사번만, 다른 사람은 **200 `{allowed:false}`**(403 이면 화면 네트워크 진단이 경고를 쌓는다).
  화면 = Usage Reports 맨 아래 `NewsletterStatsPanel`(allowed 일 때만 그림): 조회수·방문 PC·읽은 깊이·머문 시간·날짜별·구획 도달·**발송 전후 14일**(신규 가입·접속 사용자·해석 실행(월별 건수와 같은 기준)·영상 재생).
  발송 기준일 = 호 `issue.json` `sentDate`(YYYY-MM-DD) → 없으면 첫 조회일 — ⚠ 미리 열어 본 날이 잡히므로 **메일을 보낸 날 sentDate 를 적을 것**. 영상 재생은 activity_logs 라 30일 뒤 지워진다.
  반영 = 서버(git pull + 재시작, 새 테이블은 시작 때 생성)만으로 수집 시작, 화면 칸은 새 exe 부터. 테스트 `tests/test_newsletter_stats.py` · `utils/newsletterStats.test.js`.
  상태(2026-11-10): 커밋·1.7.16 에 포함(코드 9파일), 독립 리뷰 2회 막아야 함 0(두 번째 리뷰의 비콘 이벤트 루프 막힘 → `run_in_threadpool` 반영), 백엔드 2053 통과. 같은 IP 첫 동시 조회 1건 누락(유니크 충돌)은 통계라 그대로 둠.
  남은 일: 145 ⟳ Update+재시작 → 메일 발송일에 11월호 `sentDate` → 발송 메일(Outlook 초안은 만들어 둠). 통계 칸 화면은 눈으로 확인 안 함.
- 커밋 `0afa1bc`(뉴스레터) · `6f8ed6f`(아래). 145 반영 = ⟳ Update + **재시작**, 반영 뒤 다른 PC 브라우저로 글꼴·그림이 보이는지(git 이 받은 파일의 DRM 여부) 확인 남음.
- **API 설명서 화면(`/docs`·`/redoc`·`/openapi.json`)은 기본으로 꺼져 있다**(2026-11-10, 사용자 결정) — 9091 은 전사 개방이라 로그인 없이 API 전체 목록이 보였다.
  개발 PC 에서 쓰려면 `.env` `API_DOCS=1` + 재시작(`main.py create_app`, 테스트 `test_api_docs_switch.py`). 이 경로를 쓰는 코드는 없다.

### Hi-TESS 개발 연대기 — 로그인 없이 여는 공개 페이지 `/history` (2026-11-10)

주소 `http://10.14.42.145:9091/history` — 처음부터 지금까지 어떤 순서로 만들어졌는지(한 장 그래프 + 용어 풀이 + 월별 기록, 최근이 위). 해석·평가 문단('기록에서 읽히는 것')은 사용자가 필요 없다고 해 뺐다 — 되살리지 말 것. 팀원·타 부서 공유용이라 **프로젝트를 모르는 사람도 읽을 수 있는 말로** 쓴다(사용자 지시).
- 라우터 `app/routers/history_web.py`(웹 뉴스레터와 같은 방식 — 인증 없음, 허용 확장자 표, read() 바이트 + DRM 머리면 500, `/history` → `/history/` 307).
- 폴더 `HiTessWorkBenchBackEnd/HistoryWeb/`(**git 추적** → 145 `git pull` 로 내용 반영): `index.html`(그리기만) · `data.events.js`(사람이 쓰는 내용 — 시기·앱 등장·주요 변화, 큰 변화는 줄 끝 `true`) ·
  `data.auto.js`(숫자 — **`python -X utf8 scripts/history_build.py`** 가 WorkBench·WorkBenchSubModule·Logbook git 기록에서 뽑는다. 70 에서만 실행, 145 에는 하위 저장소가 없다) · `fonts/`.
  새 일이 생기면 `data.events.js` 에 한 줄 + 스크립트 실행 + 커밋.
- 앱 안: `Administration > Development History`(`pages/Administration/DevelopmentHistory.jsx`) 가 같은 페이지를 `?embed=1` iframe 으로 넣는다(머리 띠 축소 · 페이지가 postMessage 로 제 높이를 알려 스크롤 한 겹).
  '주소 복사'·'브라우저로 열기' 의 주소는 `utils/publicPageUrl.js`(+테스트) — 앱이 쓰는 https(자체 인증서)를 브라우저용 `http://…:9091` 로 바꾼다. 관리자 메뉴 등록 5곳 = `adminMenus.js`·`Sidebar.jsx`·`App.jsx`·`Layout.jsx`·`MySettings.jsx`.
- 공개 페이지라 내부 주소·계정·보안 세부(예: 옛 로그인 방식)는 적지 않는다. 동료 이름은 앱 만든 사람으로 나온다.
- ⚠ 로그인 없는 파일 경로(`/history/{파일}`·`/newsletter/{호}/{파일}`)는 `resolve()` 전에 경로 모양(`_SAFE_ASSET_RE` — 이름 글자와 `/` 만)부터 거른다.
  `//호스트/공유/x.js` 같은 UNC 경로가 오면 404 를 내기 전에 서버가 그 호스트로 접속했다(커밋 전 리뷰 '막아야 함', 뉴스레터 라우터도 함께 고침). 공개 파일 경로를 새로 만들면 같은 검사를 넣을 것.
- 디자인 평가(2026-11-10, 독립 리뷰 2건 19/32): 낱말 중간 줄바꿈·그래프 글자 크기·키보드/터치 접근·앱 이름 풀이·용어 통일('코드 수정 횟수') 반영.
  **사용자 결정 대기**: 사용 쪽 숫자(가입자·월별 실행 수)를 넣을지.
- 반영 = 145 `git pull + 재시작`(새 라우터) → 공개 주소 동작 · 관리자 메뉴는 다음 exe. 테스트 `tests/test_history_web.py`.
  ⚠ 70 서버가 꺼져 있어 **실제 서버 호출·앱 안 iframe 화면은 확인 안 함**(TestClient·빌드·헤드리스 캡처까지).
  앱 안에서 볼 것: 끼워 넣은 화면의 '월별 기록' 이동·시기 띠 클릭이 바깥 스크롤을 움직이는지(exe = Electron 26).

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

### 업데이트 이력 — 관리자 Update History · 솔버별 개발 이력 (2026-10-22)

- **관리자 `Update History`**(ADMINISTRATION 메뉴, `pages/Administration/UpdateHistory.jsx`) — 내용은 백엔드 `app/changelog/changelog.json`
  (`GET /api/admin/updates`, `require_admin`, 요청마다 다시 읽음). **json 만 고쳐 서버에 올리면 exe 재배포·재시작 없이 바뀐다.**
  항목 = `{date, version?, kind(기능|개선|수정|정리|운영), title, summary, screen?, requester?('이름 직급'), points?}`.
  ⚠ **`status`(확인 남음) 칸·필터는 없앴다**(2026-10-22 사용자 결정) — '화면 눈으로 확인 안 함' 같은 검증 상태를 이력에 쓰지 않는다. 테스트가 막는다.
  최신이 맨 앞, 화면 문구에 em dash 금지(`tests/test_admin_updates.py` 가 잡는다). 기능을 릴리스하면 여기에 한 줄 더한다.
  **2026년 10월부터 기록**한다(사용자 결정). version 은 그 변경이 처음 실린 릴리스.
- ★ **"업데이트 이력 작성해" · "변경사항 기록해" = `git log` 를 보고 `changelog.json` 만 고친다**(사용자 지시, LogBook 과 같은 규칙).
  **큰 범주로 쓴다**(2026-10-22 사용자 지시): 항목 하나 = 주간 보고에 한 줄로 쓸 만한 기능·문제 영역 하나. 기본값 변경·문구·작은 버그 수정·안내 보강은
  따로 항목을 만들지 않고 관련 기능 항목의 `points` 에 합치거나 뺀다. 기능 단위로 묶고 작은 수정은 그 기능에 합친다,
  문서·데모·발표자료·테스트만 바뀐 커밋은 뺀다, 날짜는 실제 커밋일, 요청한 사람이 있으면 `requester`. 커밋·푸시까지 하고 145 Server Manager ⟳ Update 로 반영(exe 재배포 불필요).
- **Studio 개발 이력도 같은 json 에 적는다**(2026-10-29 결정 — Studio 별 파일·화면을 따로 두지 않는다. 솔버별 이력처럼 적을 곳이 흩어지면 멈춘다).
  항목에 `studio`(viewer id, `studio_release.json` 의 키) + `version`(그 Studio 버전). 화면은 '대상' 단(전체 · WorkBench · Studio별)으로 거른다.
  **`/studio-release` 로 145 에 공개할 때만** 이전 공개 버전 이후를 한 항목으로 적는다(스킬 4단계, 70 로컬 빌드마다 쓰지 않음). 기능 단위 항목, version = 그 기능이 처음 145 에 공개된 Studio 버전(70 로컬만 거친 버전은 쓰지 않음, 예: 단면 변경 = 0.1.0).
  2026-10 분은 소급해 적었다(MB 0.0.89~0.1.0 · MU 0.0.163~0.0.174, SP·Plate·Mooring 은 10월 빌드 없음). MB 0.1.1~0.1.3(질량 편집)은 145 공개 때 적는다.
  상태(2026-10-29, `ff15ebd`): 70 dev 화면에서 사용자가 항목 표시 확인. 145 ⟳ Update 는 사용자 몫, 대상 필터·Studio 배지는 다음 exe(1.6.31)부터 — 옛 exe 에서는 Studio 항목이 섞여 보일 뿐 깨지지 않음.
- 화면 문구는 LogBook 과 맞춘다: 여러 조건을 한 번에 푸는 단추 = **필터 초기화**, 요청자는 정보 줄에 `요청 <이름 직급>`(찾기 대상).
  화면의 기간 필터는 **LogBook 46 과 같은 두 단**이다(LogBook `9f3ac8a` 참조): 첫 단 `전체 · 최근 7일 · 최근 30일 | 해`, 둘째 단 = 보고 있는 해의 달.
  기본은 **전체**(처음부터 끝까지 달 제목으로 나눠 이어 보기). 단추마다 건수, 0건은 막음. 고른 기간 밖에 맞는 항목이 있으면 '전체에서 보기'.
  규칙(`inPeriod`·`listYears`·`viewYearFor`)은 `utils/updateHistory.js`. LogBook 의 `?period=` 주소 공유는 앱 안 화면이라 넣지 않았다.
- LogBook 46 처럼 서버가 주는 독립 HTML(`/updates`)로 만들지 않았다(사용자 결정) — WorkBench 화면은 `file://` Electron 이라 서버 페이지가
  앱 로그인 토큰을 못 읽고, 브라우저 로그인 폼은 관리자 게이트를 우회하게 된다.
- **솔버별 개발 이력**(`ChangelogModal` + `constants/changelog.js`)과 같은 규칙을 `utils/updateHistory.js`(+테스트)로 공유한다:
  '새 항목' = 이 PC 에서 지난번에 연 맨 위 항목보다 위(localStorage `wb_admin_updates_seen` · `wb_changelog_seen:<programKey>`), 처음 연 PC 는 새 항목 없음.
  분류는 한글 중립 배지(기능·개선·수정), `break` 만 주의 배지('사용 방식 변경').
- 배포(2026-10-22): v1.6.25(`a16a216` 기준으로 **같은 버전 exe 재빌드** — '확인 남음' 필터 제거분 포함). 이력 json 은 `74fe2e9`(큰 범주 15건).
  145 ⟳ Update·exe 배포는 사용자. Update History 화면·솔버별 개발 이력 모달은 **눈으로 확인 안 함**. 솔버별 이력 내용(`constants/changelog.js`)은 4월에서 멈춰 있다.

### All Projects → Hi-TESS LogBook 보내기 (2026-10-13)

관리자가 `ADMINISTRATION > All Projects` 에서 **모든 사용자의 해석 기록**(My Projects 와 같은 기준 — 샘플·권상 세부 검토 제외)을 보고,
기록을 열면 **작업 폴더의 모든 파일**(입력/결과/기타 산출물)을 받거나 체크한 파일을 LogBook 으로 보낸다.
- 작업 폴더 = `input_info`/`result_info` 안 userConnection 경로(중첩 dict·list 포함)의 최상위 폴더 + 권상 부모면 세부 검토 자식(`parent_analysis_id`)의 폴더.
  파일 받기는 기존 `GET /api/download`(관리자는 남의 작업 폴더도 통과).
- 보내기는 **서버끼리 전송**: WB → LogBook `/api/integration/uploads*`(공유 비밀키 `LOGBOOK_INTEGRATION_SECRET`, `as=<관리자 사번>`).
  LogBook 에는 **보낸 관리자 이름의 '정리 대기' 묶음**이 생기고 정리·확정은 LogBook 에서 한다. 계약 원본: LogBook 저장소
  `docs/plans/2026-10-08-logbook-18-workbench-link.md` 9절. 보낸 기록은 `logbook_exports`(실패도 남긴다).
  목록의 'LogBook 보낸 것만' 토글(`GET /api/admin/projects?logbook=sent`, 2026-10-19 v1.6.19)은 'N번 보냄' 표시와 같은 기준 — failed 만 있는 기록 제외, blocked 포함.
  **App 필터 = App 한 줄(2026-11-06, 1.7.8)**: 내부 키가 여러 개인 App(예: HiTESS Model Builder 4개)은 한 줄로 합치고 `program_names`(`|` 구분)로 묻는다, 키가 하나면 예전 `program_name`(`utils/programFilterOptions.js`). 드롭다운은 공용 `components/ui/FilterListbox.jsx`(headlessui) — 다른 목록 화면 필터도 이것으로.
- LogBook 이 받지 않는 것: 이미 LogBook 에 있는 것과 **완전 동일한 BDF**(blocked), 회사 **DRM 암호문**(`HHIDRMC` 머리, rejected). 둘 다 화면에 그대로 보인다.
  ⚠ 개발 PC 는 DRM 에이전트가 python 의 읽기를 가로채 `HHIDRMC` 흉내 파일을 0바이트로 돌려준다(실측) — DRM 거절 확인은 단위 테스트로 한다.
- ⚠ 배포 순서: **LogBook 을 먼저** `git pull` + 재시작. 옛 LogBook 이면 WB 가 404 를 받아 "보내기 기능이 없거나 연동이 꺼져 있습니다" 로 알린다.
- 해석 여권 함께 싣기(Hi-TESS Core 1단계, 2026-10-19): `.env` `LOGBOOK_SEND_PASSPORT=1` 이면 `origin.passport`(검증된 산출물 sha256)를 싣고,
  LogBook 자료 화면이 'WB 산출물과 같음'을 보인다. 비우면 예전 본문. 두 플랫폼 연동 약속은 `hitess-core` 저장소 — 바꾸기 전에 먼저 본다.
- **권상 결과 세트 권장 (2026-11-06, 1.7.3)** — 권상 해석 상세를 열면 Wire 모델(`_lifting.bdf`·meta·posture) + 구조 해석 결과(결과 JSON·해석에 쓴 모델 JSON·F06)를
  미리 체크하고 안내한다(`admin_projects.lifting_recommendation` → 파일 목록 응답 `liftingSet`). 강제 첨부는 예전 Wire 3종만. 해석 뒤 모델 JSON 만 바뀌었거나 결과 JSON 이 DRM 이면 경고.
- **여러 건 보내기 (2026-11-06, 1.7.4~1.7.6)** — App = 권상(GroupModuleUnit·SidePassage)이면 [여러 건 보내기] → 선택 모드('LogBook 안 보낸 것만' `logbook=unsent`·해석 완료·파일 보관 중, 최대 50)
  → `POST /api/admin/projects/logbook/plan`(기록마다 입력 BDF + Wire 세트 + 결과 세트, 묶음 이름 `<호선> <모델> 권상 · WB #id`) → 화면이 기존 1건 보내기를 **차례로** 부른다(새 작업 대기열 없음).
  해석 1건 = LogBook 묶음 1개(합치지 않음). **Wire 없는(검증만 한) 기록도 원본 모델만** 보낸다(`… 권상(Wire 없음)`). 같은 사용자·호선·BDF 이름의 여러 실행은 **Wire 있는 실행 중 최근 1건**만 체크(결과 유무는 앞세우지 않음 — 고친 모델의 새 실행이 옛 판 결과에 밀리지 않게).
  멈춘 뒤 이어 보내도 보낸 기록은 다시 안 보낸다. LogBook 정리 대기 카드 머리에 'Wire 없음 / Wire 포함 / Wire · 결과 포함'(LogBook `lifting.brief.has_result`).
  계획: `docs/plans/2026-11-06-all-projects-bulk-logbook-send.md`. 70 DB 는 권상 기록 대부분이 30일 지나 보낼 수 없었다 — 145 도 만료 전에 보내야 한다. 실제 LogBook 보내기·화면(눈)은 확인 안 함(미리 보기 창은 헤드리스 캡처로 확인).
- **BDF 3D 미리보기(2026-10-21)** — 보내기 전에 모델을 본다. 파일 행의 3D 버튼 / 체크한 BDF '선택한 BDF 3D 보기' → `BdfPreviewDialog`
  (중첩 headlessui Dialog — 부모 모달이 바깥 클릭으로 닫히지 않게). 뷰어 안 'LogBook 으로 보낼 파일에 포함' 이 부모 체크와 같은 상태다.
  `GET /api/admin/projects/{id}/model-preview?path=` 가 BDF → `model.lbm`(gzip, `Content-Encoding: gzip`)을 메모리에서 만든다(디스크 안 씀 — DRM).
  INCLUDE 는 그 작업 폴더 안에서만 따라가고, 상한 200MB·최근 4개 메모리 캐시. 실측: 7MB 판 모델(CQUAD4 6.3만) 1.3s.
  ⚠ 변환기(`app/services/bdf_preview/` deck·fields·coords·model·lbm)와 엔진·계산(`frontend/src/components/bdfPreview/lb/`)은
  **LogBook 무수정 사본**이다(lbm 형식 v2). 여기서 고치지 말고 LogBook 에서 고친 뒤 다시 복사한다. WorkBench 코드는 `service.py`·`useBdfPreview.js`·`BdfPreviewDialog.jsx` 뿐.
  이 때문에 **WorkBench three 를 LogBook 과 같은 `~0.184.0` 으로 올렸다**(0.155 → 0.184, 2026-10-21). r163 부터 WebGL1 이 빠져 WebGL2 가 없는 PC 에서는 기존 3D 화면도 안 뜬다.
  배포(2026-10-21): v1.6.22(`0f729a1`·`cd2d5c1`). 145 ⟳ Update·exe 배포는 사용자. ⚠ 미리보기 화면과 three 업그레이드 뒤 기존 3D 화면(Truss·Assessment·My Projects BDF·이중관 뷰어)은 **눈으로 확인 안 함**.
- ⚠ 작업 폴더에 `nul` 파일이 생기는 해석이 있다 — 만드는 쪽은 WorkBench 밖의 레거시 해석 엔진(.exe, `Cmb.Cli`·Nastran 임시 파일,
  d33e9fd·e25c20c 기록)이라 이 저장소에서 근원을 막을 수 없다. Python 3.13+ 에서 이 경로가 `\\.\nul` 장치로 바뀌어 목록 전체가 500 이었다
  → 목록에서 예약 이름(nul·con·aux·prn·com/lpt)을 뺀다(1ee564c, 2026-10-19).
  작업 폴더를 훑는 곳은 이렇게 지킨다: 파일마다 `relpath`·`abspath` 를 부르면 예약 이름을 먼저 거르거나 prefix 자르기
  (`admin_projects`·`analysis.py` result-zip·`cleanup_service._extended_path`). 확장자로 먼저 거르는 곳은 안전(2026-10-19 전수 확인).
  해석 뒤 `nul` 을 자동으로 지우는 것은 하지 않는다(작업 폴더 자동 삭제 위험 > 이득).

### DB 모델 (`app/models.py`)

| 모델 | 테이블 | 주요 컬럼 |
|------|--------|-----------|
| `User` | `users` | employee_id, is_active, is_admin, login_count |
| `Analysis` | `analysis` | program_name, input_info (JSON), result_info (JSON), source |
| `Notice` | `notices` | type, is_pinned |
| `UserGuide` | `user_guides` | category, content |
| `FeatureRequest` | `feature_requests` | status, upvotes, admin_comment |
| `AppSetting` | `app_settings` | app_key(=ANALYSIS_DATA title), dev_status, maintenance, maintenance_message, description, tags(JSON), contributor |
| `LogbookExport` | `logbook_exports` | analysis_id, sent_by, batch_key, state(staged/blocked/failed), file_count, blocked/rejected(JSON) |

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
| `routers/chat.py` | `/api/chat` | 관리자↔사용자 1:1 DM (폴링 기반, WebSocket 없음). `GET /contacts` 는 대화 가능한 활성 관리자 + 접속 상태(online/idle/offline)를 필드 화이트리스트로 반환 — 사용자가 먼저 대화를 걸 수 있는 진입점. 동명이인 구분용으로 contacts `department`·`position`, threads·conversation `other_department`·`other_position` 을 준다 → 화면은 이름 옆 `부서 · 직책`, 말풍선 `YYYY.MM.DD HH:MM`, 목록 시각은 오늘이면 시각·아니면 날짜(`utils/chatContacts.js`, 2026-10-23, v1.6.26 릴리스 — 채팅 화면은 눈으로 확인 안 함) |
| `routers/app_settings.py` | `/api/app-settings`, `/api/admin/app-settings` | App별 서비스 상태·점검·표시 메타 오버라이드 |
| `routers/admin_projects.py` | `/api/admin/projects` | 관리자 All Projects — 전체 이력·작업 폴더 파일 목록·LogBook 보내기 |

**`/member/check_user`**: 사번(`userID`) + 회사(`company`) 기반으로 사용자 등록·승인 여부 확인. `/api/check_user`로도 동일하게 접근 가능. Electron 앱 초기 로그인에 사용.

### 프론트엔드 페이지 구조

`HiTessWorkBench/frontend/src/pages/`에 위치하며 `App.jsx:renderPage()`의 switch문으로 라우팅됩니다.

**File-Based / 해석 앱**

| 메뉴 이름 | 컴포넌트 | 설명 |
|-----------|----------|------|
| `'Dashboard'` | `dashboard/Dashboard.jsx` | 메인 대시보드 — 새 해석 시작(파일 전달)·내 작업·월별 실행 |
| `'My Project'` / `'My Projects'` | `analysis/MyProjects.jsx` | 내 해석 이력 및 프로젝트 관리 |
| `'New Analysis'` / `'File-Based Apps'` | `analysis/NewAnalysis.jsx` | 파일 업로드 기반 해석 선택 |
| `'Truss Analysis'` | `analysis/TrussAnalysis.jsx` | CSV 업로드 + 3D 모델 뷰어 |
| `'Truss Structural Assessment'` | `analysis/TrussAssessment.jsx` | BDF 업로드 + 구조 안정성 평가 |
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
| `'All Projects'` | `Administration/AllProjects.jsx` | 관리자: 모든 사용자의 My Projects — 작업 폴더 파일 받기·LogBook 보내기 |
| `'Usage Reports'` | `Administration/UsageReports.jsx` | 관리자: 일/주/월 사용량 정형 리포트, Excel 내보내기 |
| `'System Settings'` | `Administration/SystemSettings.jsx` | 관리자: 시스템 모니터링 |
| `'App Settings'` | `Administration/AppSettings.jsx` | 관리자: App별 서비스 상태·점검 모드·표시 정보 |
| `'API Apps'` | `Administration/ApiApps.jsx` | 관리자: API 연동 앱 관리 |
