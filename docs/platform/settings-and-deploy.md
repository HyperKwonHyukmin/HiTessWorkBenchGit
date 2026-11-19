# 주요 설정 포인트 원문 (백엔드 URL, 릴리스, Electron, InHouse, Studio 배포)

> 2026-11-19 루트 `CLAUDE.md` 에서 그대로 옮긴 기록이다(한도 초과 정리). 규칙 요약은 `CLAUDE.md` 에 남아 있고, 진행 기록과 상세는 여기에 이어 쓴다.

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
  - **중복 실행 막기 (2026-11-16, 미커밋 · 다음 exe)** — `electron/single-instance.js`(+테스트): 배포 exe 만 `requestSingleInstanceLock`, 두 번째 실행은 끝나고 기존 창을 앞으로.
    이유: 이동식 exe 를 두 번 띄웠다 하나를 닫으면 `%TEMP%` 공유 폴더의 `resources.pak` 이 지워져 Studio 화면에 제목·CSS 글자가 찍히고 모델이 안 뜬다(11-04 MF, 11-16 MU 다른 사용자 PC, 추정 원인). 당장은 WorkBench 완전 종료 후 재실행으로 풀린다.
    개발 실행은 잠그지 않는다(배포 exe 와 userData 가 같아 같이 못 띄우게 됨). 단위 시험만 했고 Electron 26 으로 두 번 띄워 보는 시험은 안 했다 — 릴리스 전에 확인.
  - **번들 보안 점검 (2026-10-27)**: `app.asar`(배포 번들)를 풀어 리버스 엔지니어링 노출을 점검한 결과 **비밀값·엔진 바이너리·DB 접속정보·원본 소스맵(.map)·dev 주소(70) 모두 미유출**이었다. 토큰은 전부 런타임 세션 토큰이고, 영상 티켓 서명키·해석 엔진·DB 는 서버(145)에만 있다 — "가치는 서버, 클라이언트는 열려 있다" 전략이 코드에서 지켜지는 것을 확인. 유일한 위생 문제는 `.test.js` 7개가 번들에 실리던 것 → `package.json` `build.files` 에 `!electron/**/*.test.js`·`!electron/**/*.spec.js` 제외 추가.
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
- **발표 페이지 경로 (`app/routers/presentations.py`)**
  - `/api/presentations/hitess-launch-deck` = 런칭 덱(대시보드 소개 모달). 145 는 `INTRO_PRESENTATION_DIR` 폴더를 먼저 본다.
  - `/api/presentations/hitess-insight` = 구조 통찰 도면집(2026-11-19 `ff61a7b`, 일곱 장 선박 구조 모션 페이지, 5.4 MB). **저장소 사본 `app/static/presentations/hitess-insight.html` 만 읽는다** → 145 반영 = git pull + 재시작.
  - 원본 빌드 소스는 `E:\D_Drive\02_Structure_department\08_2026\35_HouseByLine\src`(70 PC, git 밖)이고, 고친 뒤 결과 html 을 이 경로로 복사해 커밋한다.
  - 남은 일(2026-11-19): 145 에서 `git pull` 과 재시작, 200 확인. 화면 진입 버튼은 없고 주소로만 연다.
