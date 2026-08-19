# HiTESS 통합 소개자료 및 145 자동 배포 실행 계획

> 작성일: 2026-08-19  
> 상태: 구현 전 계획  
> 목표: 대시보드의 `Discover HiTESS`와 `HiTESS WorkBench` 소개자료를 하나의 런칭 덱으로 통합하고, 이후 HTML 변경을 `main`에 push하면 145 서버에 자동 반영한다.

## 1. 결론과 목표 구조

현재 소개자료는 Electron 실행 파일 안에 포함되는 로컬 파일이므로 HTML만 바꿔도 사용자가 새 Electron 버전을 받아야 한다. 이를 **서버 권위형 단일 소개자료**로 전환한다.

```text
대시보드의 단일 "HiTESS WorkBench 소개" 배너
  → 기존 IntroModal 재사용
  → ${API_BASE_URL}/api/presentations/hitess-launch-deck
  → 145 서버의 런타임 HTML 파일

작성 원본
  C:\Coding\ClaudeCode\Huashu_Design\huashu-design\Results\HiTESS-Launch-Deck.revised.html
      ↓ 검증·가져오기
Git 추적 기준본
  HiTessWorkBenchBackEnd/app/static/presentations/hitess-launch-deck.html
      ↓ main push / 전용 배포 job
145 런타임 파일
  C:\KHM\HiTessWorkbench\deployed-assets\presentations\hitess-launch-deck.html
```

최초 전환 때만 백엔드 1회 재시작과 Electron 1회 릴리스가 필요하다. 이후 소개 HTML만 바꾸는 배포에는 백엔드 재시작과 Electron 재빌드가 모두 필요 없다.

## 2. 조사로 확인한 현재 상태

- 대시보드의 두 진입점은 별도 페이지가 아니라 같은 `DiscoverHiTessBanner`를 두 번 렌더링한다: `Dashboard.jsx:358`, `Dashboard.jsx:1631-1646`.
- 기존 `IntroModal`은 iframe, 전체화면, 재시도 UI를 이미 제공한다: `Dashboard.jsx:1020-1131`.
- 로딩 분기는 `handleDiscoverHiTess(target)`와 `introTarget`에 묶여 있다: `Dashboard.jsx:1167-1218`.
- Electron은 `get-intro-page-html` IPC로 두 로컬 파일을 읽는다: `electron/index.js:502-520`, `preload.js`의 invoke whitelist.
- Vite 개발 서버도 별도 플러그인으로 `IntroductionPage`를 서빙한다: `frontend/vite.config.js:10-32`.
- Electron 패키지는 `IntroductionPage`를 `extraResources`로 복사한다: `HiTessWorkBench/package.json:25-30`.
- 그러나 `HiTessWorkBench/IntroductionPage/`는 `.gitignore:90`에서 제외된다. 여기에 새 HTML을 복사하는 것만으로는 push 또는 145 배포가 되지 않는다.
- 백엔드는 이미 `StaticFiles`와 고정 파일 응답 패턴을 사용한다: `app/main.py:7,211-220`, `routers/system.py:167-201`, `routers/viewers.py:240-258`.
- 운영 배포는 현재 자동이 아니다. push 후 145의 Server Manager에서 Update를 눌러 `git pull origin main`을 실행한다: `docs/OPERATIONS_GUIDE.md:92-110`, `server_manager.py:809-861`.
- 대상 HTML은 82,423 bytes, 21개 슬라이드, 1280×720 자동 축소형 단일 파일이다. 이미지·동영상·외부 JS·fetch 의존성은 없고, 유일한 외부 의존성은 7행 Google Fonts import다.

## 3. Phase 0 — 보안·배포 전제 확정

### 구현할 내용

1. **HTML 커밋 전 저장소 공개 범위를 먼저 해결한다.** 현재 GitHub 저장소는 공개 상태이고, 런칭 덱에는 내부 사용량과 등록 사용자 수가 포함된다.
   - 우선안: `HyperKwonHyukmin/HiTessWorkBenchGit`를 private으로 전환한다.
   - 대안: WorkBench 저장소를 공개로 유지해야 한다면 덱만 별도 private 저장소에서 관리한다. 공개 WorkBench 저장소에는 HTML을 커밋하지 않는다.
2. `main` 직접 push 권한을 최소화하고 branch protection/review 정책을 설정한다.
3. 145에서 GitHub outbound HTTPS, Windows 서비스 설치 허용 여부, runner 서비스 계정, 배포 폴더 ACL을 확인한다.
4. 현재 작업 브랜치 `feature/analysis-report-generator`와 기존 수정 파일을 보존한다. 구현은 별도 브랜치 또는 별도 worktree에서 시작하고 `frontend/src/config.js`의 로컬 변경은 커밋하지 않는다.

### 문서 근거

- 현재 원격/운영 브랜치: `git remote -v`, `docs/OPERATIONS_GUIDE.md:68-71,102-107`.
- GitHub는 self-hosted runner를 private 저장소에서만 사용할 것을 권고하며, 공개 저장소 runner는 신뢰하지 않은 코드에 의해 손상될 수 있다고 경고한다: GitHub Docs의 *Adding self-hosted runners* 및 *Secure use reference*.

### 검증 체크리스트

- [ ] 덱이 들어갈 GitHub 저장소가 private이다.
- [ ] `main` 보호 정책과 배포 권한 보유자가 문서화됐다.
- [ ] 145가 `github.com`/Actions 서비스에 outbound 연결할 수 있다.
- [ ] runner 계정은 관리자 계정이 아니며 배포 폴더 외 쓰기 권한이 없다.
- [ ] 기존 dirty worktree 파일 목록을 기록하고 구현 브랜치와 분리했다.

### 금지사항

- 공개 저장소에 내부 런칭 덱을 먼저 커밋하지 않는다.
- 공개 저장소에 연결된 범용 self-hosted runner를 145에 설치하지 않는다.
- PAT, runner 등록 토큰, 비밀번호를 YAML·코드·`.env.example`에 넣지 않는다.
- 현재 작업 트리를 `reset --hard` 또는 `clean`으로 정리하지 않는다.

## 4. Phase 1 — 런칭 덱을 Git 추적 기준본으로 가져오기

### 구현할 내용

1. 지정된 외부 HTML을 다음 경로로 복사한다.
   - `HiTessWorkBenchBackEnd/app/static/presentations/hitess-launch-deck.html`
2. 사내망·Electron에서의 외부 접속 실패와 글자 폭 변동을 막기 위해 원본 7행의 Google Fonts `@import`를 제거하고 기존 `Malgun Gothic`, `system-ui` 폴백을 사용한다.
3. 외부 저작 경로에서 기준본으로 가져오는 절차를 `scripts/import-launch-deck.ps1`로 고정한다.
   - 입력 경로를 매개변수로 받는다.
   - `.html` 확장자, UTF-8, 최소/최대 크기, `<!DOCTYPE html>`, 예상 `<title>`, `.deck`, 인라인 `<script>`를 검사한다.
   - 외부 URL/상대 자산 의존성을 검사하고 실패 시 기준본을 덮어쓰지 않는다.
   - 임시 파일을 검증한 뒤 기준본을 교체한다.
4. 기준본만 배포 원본으로 취급한다. 외부 절대 경로를 런타임이나 CI가 직접 참조하지 않는다.

### 문서·복사 기준

- 원본 덱의 고정 캔버스/축소 로직: 원본 21-24행, 1273-1295행.
- 기존 ignored 폴더 규칙: `.gitignore:90`.
- PowerShell 검증·설치 스크립트 구성 예시: `scripts/install_watchdog_task.ps1`.

### 검증 체크리스트

- [ ] 기준본이 Git 추적 대상이다(`git check-ignore` 결과가 비어 있음).
- [ ] `<div class="S ...">` 슬라이드가 21개이고 제목/키보드 이동/전체 화면용 스크립트가 보존됐다.
- [ ] `http://`, `https://`, 상대 `src`/`href`, `fetch`, WebSocket 의존성이 없다.
- [ ] 원본과 기준본의 의도된 차이는 Google Fonts 제거와 provenance 주석뿐이다.
- [ ] import 스크립트 실패 시 기존 기준본 hash가 변하지 않는다.

### 금지사항

- ignored `HiTessWorkBench/IntroductionPage/`를 새 기준본 위치로 재사용하지 않는다.
- 외부 원본과 서버 파일을 각각 손으로 수정하는 이중 원본 구조를 만들지 않는다.
- HTML을 JSX 문자열이나 Python 문자열로 내장하지 않는다.

## 5. Phase 2 — 백엔드에 고정 소개자료 엔드포인트 추가

### 구현할 내용

1. `HiTessWorkBenchBackEnd/app/routers/presentations.py`를 추가한다.
2. 고정 라우트 `GET /api/presentations/hitess-launch-deck`만 제공한다.
   - 운영 우선: 환경변수 `INTRO_PRESENTATION_DIR` 아래 `hitess-launch-deck.html`.
   - 개발 폴백: `app/static/presentations/hitess-launch-deck.html`.
   - 파일이 없으면 명시적인 404를 반환한다.
   - 응답은 `text/html; charset=utf-8`, `Cache-Control: no-store`로 제공한다.
3. `app/main.py`에 새 router를 등록하고 `.env.example` 및 운영 문서에 `INTRO_PRESENTATION_DIR`를 추가한다.
4. 파일명/path 매개변수를 받지 않아 임의 파일 다운로드 가능성을 원천 차단한다.
5. 145에서는 다음 값으로 고정한다.
   - `INTRO_PRESENTATION_DIR=C:\KHM\HiTessWorkbench\deployed-assets\presentations`

### 문서·복사 기준

- router 등록 패턴: `app/main.py:20-50,186-208`.
- 환경변수 → 로컬 폴백 탐색 패턴: `routers/viewers.py:32-64,97-121`.
- 고정 파일 응답 패턴: `routers/system.py:167-201`.
- application contract 테스트 패턴: `tests/test_database_lifecycle.py:146-161`.

### 검증 체크리스트

- [ ] 운영 환경변수 경로가 로컬 기준본보다 우선한다.
- [ ] 정상 파일은 200, 올바른 Content-Type, `no-store`로 응답한다.
- [ ] 파일 누락은 404이며 서버 시작 자체는 실패하지 않는다.
- [ ] URL에 임의 경로나 파일명을 주입할 수 없다.
- [ ] 파일 교체 후 백엔드 재시작 없이 다음 요청에서 새 hash가 반환된다.
- [ ] `test_database_lifecycle.py`와 신규 `test_presentations.py`가 통과한다.

### 금지사항

- iframe 표시를 위해 `webSecurity: false` 또는 `nodeIntegration: true`를 켜지 않는다.
- `X-Frame-Options: DENY/SAMEORIGIN`을 이 응답에 추가하지 않는다. 부모 Electron 페이지는 `file://`이므로 표시가 차단된다.
- 소개자료 갱신 때 백엔드 전체 `git pull + restart`를 실행하지 않는다. 진행 중 해석 작업을 끊을 수 있다.

## 6. Phase 3 — 대시보드를 단일 서버 자료로 전환

### 구현할 내용

1. `Dashboard.jsx:1629-1647`의 두 배너를 하나의 `HiTESS WorkBench 소개` 배너로 교체한다.
2. 기존 `IntroModal`의 시각 구조, 닫기, 전체화면, 키보드 포커스, 소개 섹션 접힘 상태는 유지한다.
3. URL은 하드코딩하지 않고 이미 import 중인 `API_BASE_URL`을 사용한다.
   - `${API_BASE_URL}/api/presentations/hitess-launch-deck`
4. `introTarget`, target별 캐시, 두 파일명 매핑, modal title 삼항식, `history.pushState` 문자열 치환을 제거한다.
5. iframe은 서버 URL을 `src`로 열고 `sandbox="allow-scripts"`와 `allowFullScreen`만 부여한다. `allow-same-origin`은 새 덱에 필요하지 않다.
6. 로딩/실패/재시도 상태를 분리하고 오류 문구를 “Electron 재시작”이 아니라 “145 서버 연결 및 서버 주소 확인”으로 바꾼다.
7. 더 이상 사용하지 않는 로컬 전달 경로를 제거한다.
   - `electron/index.js`의 `get-intro-page-html`
   - `preload.js` invoke whitelist 항목
   - `vite.config.js`의 `serveIntroductionPage()`
   - Electron `package.json`의 `IntroductionPage` `extraResources`
8. ignored 로컬 `IntroductionPage` 파일은 자동 삭제하지 않는다. 새 경로 검증 후 운영자에게 별도 정리 대상으로 보고한다.

### 문서·복사 기준

- 단일 카드 UI: `Dashboard.jsx:333-397`.
- modal/iframe/fullscreen: `Dashboard.jsx:1020-1131`.
- 런타임 서버 주소: `frontend/src/config.js`, `Dashboard.jsx:17,492-493`.
- 디자인 원칙: `DESIGN.md`의 restrained 카드/모달 규칙, `PRODUCT.md`의 신뢰·정밀·전문 엔지니어링 톤.

### 검증 체크리스트

- [ ] 소개 섹션에 소개 배너가 정확히 한 개 표시된다.
- [ ] 클릭하면 21장 덱이 modal 안에서 열린다.
- [ ] 이전/다음 버튼, 점 이동, `←/→/Space/Home/End`, 전체화면이 동작한다.
- [ ] `localStorage.server_url`이 70 개발 서버이면 70을, 145이면 145를 사용한다.
- [ ] 1280×720, 1440×900, Electron 창 크기에서 잘림 없이 축소된다.
- [ ] 서버 실패 시 로딩이 영구 지속되지 않고 재시도 UI가 표시된다.
- [ ] `npm run build`가 통과하고 기존 `get-intro-page-html` 참조가 0건이다.

### 금지사항

- React에 `10.14.42.145`를 하드코딩하지 않는다.
- 새 React Router/App.jsx route를 만들지 않는다. 현재 기능은 dashboard modal이다.
- 서버 HTML을 `srcdoc`으로 재주입하거나 `allow-same-origin`을 부여하지 않는다.
- 두 target enum과 두 제목을 호환 코드로 계속 유지하지 않는다.

## 7. Phase 4 — main push → 145 HTML 자동 배포

### 구현할 내용

> 이 단계는 Phase 0에서 저장소가 private으로 확인된 뒤에만 self-hosted runner 방식으로 진행한다.

1. 145에 repository-scoped GitHub Actions Windows runner를 전용 저권한 서비스 계정으로 설치한다.
   - 권장 설치 경로: `C:\actions-runner`.
   - 라벨: `self-hosted`, `windows`, `x64`, `hitess-145`, `presentation-deploy`.
   - 계정의 쓰기 권한은 `C:\KHM\HiTessWorkbench\deployed-assets\presentations`와 runner 작업 폴더로 제한한다.
2. `.github/workflows/deploy-hitess-launch-deck.yml`을 추가한다.
   - trigger: `push` to `main`.
   - paths: 기준 HTML, 배포 검증 스크립트, 해당 workflow만.
   - `workflow_dispatch`를 복구/재시도용으로 허용한다.
   - `permissions: contents: read`.
   - `runs-on: [self-hosted, windows, x64, hitess-145, presentation-deploy]`.
   - `concurrency`로 중복 배포를 직렬화하고 오래된 실행을 취소한다.
   - `actions/checkout`은 검증된 full commit SHA로 pin한다.
3. 배포 단계는 다음 순서로 고정한다.
   - 기준본 존재/크기/DOCTYPE/title/외부 의존성 검사.
   - 대상과 SHA-256이 같으면 성공으로 종료.
   - 같은 볼륨의 임시 파일로 복사.
   - 임시 파일 hash가 원본과 같은지 확인.
   - 기존 파일을 `.bak`으로 보존하고 원자 교체.
   - `http://127.0.0.1:9091/api/presentations/hitess-launch-deck`의 200, Content-Type, title, 새 hash 확인.
   - smoke test 실패 시 `.bak` 복원 후 job 실패.
4. 덱 갱신 job에서는 서버 repo를 pull하거나 백엔드를 재시작하지 않는다.
5. Actions 실행 이력과 145 로컬 배포 로그에 commit SHA, hash, 시간, 결과를 남긴다.

### 공개 저장소를 유지해야 하는 경우의 대안

self-hosted runner를 연결하지 않는다. 145의 **고정된 로컬 pull-only 스크립트**를 Windows Scheduled Task로 1분마다 실행한다. 이 스크립트는 private 덱 저장소의 `main`에서 정확히 한 HTML만 읽고 검증·원자 교체하며, 내려받은 workflow/PowerShell/Python 코드는 실행하지 않는다. 작업 스케줄러 등록은 `scripts/install_watchdog_task.ps1`의 관리자 확인, `IgnoreNew`, 실행 결과 재검증 패턴을 복사한다. 이 경우 자동 반영 SLA는 push 후 최대 1분이다.

### 문서 근거

- GitHub runner 설치/Windows 서비스: GitHub Docs, *Adding self-hosted runners*.
- label 조합: GitHub Docs, *Using self-hosted runners in a workflow*.
- branch/path filter: GitHub Docs, *Workflow syntax for GitHub Actions*.
- full SHA pin과 최소 권한: GitHub Docs, *Secure use reference*.
- 기존 Windows Scheduled Task 설치 패턴: `scripts/install_watchdog_task.ps1`.

### 검증 체크리스트

- [ ] 일반 feature branch push 및 PR은 145 job을 실행하지 않는다.
- [ ] `main`의 HTML 변경 push만 배포를 실행한다.
- [ ] 잘못된 HTML은 기존 운영 파일을 보존한 채 job이 실패한다.
- [ ] 정상 push 후 145 파일 hash와 commit 기준본 hash가 같다.
- [ ] 배포 중/후 백엔드 PID와 진행 중 job이 유지된다.
- [ ] runner 계정이 `.env`, DB, `InHouseProgram`, 라이브 Git worktree를 수정할 수 없다.
- [ ] 이전 `.bak`으로 수동 rollback한 뒤 endpoint가 즉시 이전 내용을 제공한다.

### 금지사항

- 공개 저장소의 arbitrary workflow를 145 self-hosted runner에서 실행하지 않는다.
- `pull_request`/`pull_request_target` 이벤트를 이 runner에 연결하지 않는다.
- `update.bat`이나 Server Manager Update 전체를 deck 배포 job에서 호출하지 않는다.
- 라이브 worktree에서 `git reset --hard`, `git clean`, 강제 checkout을 실행하지 않는다.
- GitHub-hosted runner가 사설 IP 145에 직접 SCP/SSH할 수 있다고 가정하지 않는다.

## 8. Phase 5 — 최초 전환 배포

### 순서

1. Phase 1~2를 먼저 main에 반영한다.
2. 145에서 기존 운영 절차로 1회 `git pull`, `INTRO_PRESENTATION_DIR` 설정, 배포 폴더 생성, 백엔드 재시작을 수행한다.
3. 새 endpoint를 localhost와 개발 PC에서 확인한다.
4. Phase 4 runner/workflow를 등록하고 기준 HTML을 145 런타임 폴더에 최초 배포한다.
5. Phase 3 프론트 변경을 포함한 Electron 버전을 1회 빌드하여 `LastestVersionProgram`에 배포한다.
6. 사용자 클라이언트가 새 버전으로 업데이트된 뒤 단일 배너와 원격 덱을 확인한다.
7. 이후 HTML-only 변경은 `import → commit → main push → 자동 배포`만 수행한다.

### 검증 체크리스트

- [ ] 기존 두 소개자료 대신 단일 자료만 보인다.
- [ ] 클라이언트 exe를 다시 빌드하지 않고 덱 문구 한 줄을 바꿔 push했을 때 새 내용이 보인다.
- [ ] 소개자료 갱신 중 분석 작업이 중단되지 않는다.
- [ ] 145가 오프라인이면 앱 본체는 유지되고 소개 modal만 명확한 오류를 표시한다.
- [ ] rollback 절차를 운영자가 문서만 보고 수행할 수 있다.

## 9. Phase 6 — 테스트와 문서 마감

### 자동 검증

- 백엔드: `python -m pytest tests/test_presentations.py tests/test_database_lifecycle.py`.
- 프론트엔드: `npm run build`.
- 정적 검사:
  - 기존 두 파일명, `introTarget`, `get-intro-page-html`, `serveIntroductionPage`, `extraResources` intro 항목 참조 0건.
  - 기준 HTML의 외부 URL/상대 자산 참조 0건.
- 배포 smoke test: localhost endpoint status/title/hash와 운영 파일 hash 일치.

### 수동 검증

- Vite 개발 브라우저와 Electron 개발 모드에서 modal을 각각 확인한다.
- 패키징된 Electron에서 145를 바라보게 한 뒤 키보드 이동, 전체화면, 닫기/재열기, 서버 오류/복구를 확인한다.
- 100%, 125%, 150% Windows 배율에서 주요 텍스트와 하단 navigation이 잘리지 않는지 확인한다.

### 문서 업데이트

- `docs/OPERATIONS_GUIDE.md`: 소개자료 변경·자동 배포·rollback·runner 점검 절차.
- `.env.example`: `INTRO_PRESENTATION_DIR` 설명.
- `AGENTS.md`: 소개자료의 기준본 경로와 “HTML-only 변경은 클라이언트 재빌드 불필요” 규칙.
- 기존 `IntroductionPage` 로컬 전달 구조 설명이 있다면 제거하거나 deprecated로 표시한다.

## 10. 완료 정의

- 대시보드에는 소개 진입점이 하나뿐이다.
- 지정된 21장 런칭 덱이 기존 modal 안에서 정상 동작한다.
- 앱은 하드코딩된 IP가 아니라 configured `API_BASE_URL`에서 덱을 읽는다.
- `main`에 정상 HTML을 push하면 145 런타임 파일이 자동 교체되고 endpoint hash가 일치한다.
- HTML-only 갱신 시 백엔드 재시작과 Electron 재배포가 없다.
- 실패한 배포는 기존 파일을 유지하거나 자동 복구하며, 운영 로그에서 원인을 찾을 수 있다.
- 내부 발표자료가 공개 GitHub에 노출되지 않는다.

