# 관리자 웹 콘솔 + 스트림덱 연동 계획 (2026-11-18)

## 목적
WorkBench.exe 를 켜지 않고 **회사 PC 크롬**에서 관리 업무를 하고, **스트림덱**으로 가입 승인 대기를 보고 바로 들어간다.
불편의 원인은 exe 시작 절차와 해석 화면과의 전환이지 관리 화면 자체가 아니다 → 새 화면 설계가 아니라 **기존 관리 화면을 브라우저에 그대로** 올린다.

## 결정 (사용자 확정 2026-11-18, `/grill-me`)
| 항목 | 결정 |
|---|---|
| 형태 | 145 가 `https://10.14.42.145:9091/admin/` 에서 관리 페이지를 내준다. 크롬 '앱으로 설치'로 독립 창처럼 쓴다. 같은 출처라 CORS 변경 없음 |
| 화면 | exe 와 같은 React 코드, 진입점만 `admin.html` 로 따로. 관리자 7칸 + 채팅(DM) + 공지 + 기능 요청 답변. 대시보드, 해석 앱, Studio, 영상, 버전 검사는 뺀다 |
| 요약 화면 | 만들지 않는다. 사이드바 User Management 옆 가입 대기 배지만 |
| 사용자 | 본인만. **페이지 입구와 스트림덱 API 만** `is_admin` + `.env ADMIN_CONSOLE_VIEWERS`(기본 A476854) 검사. 관리 API 자체는 지금처럼 `is_admin` (exe 를 쓰는 다른 관리자 보호) |
| exe | 관리 메뉴 그대로 유지(웹이 안 열릴 때 비상구) |
| 로그인 | 145 를 내 PC 로컬 인트라넷 영역에 등록 → 크롬 Windows 자동 로그인(`POST /api/login/windows`). 안 되면 AD 비밀번호(세션 8시간 고정) |
| 인증서 | 145 자체 서명 인증서를 내 계정 '신뢰할 수 있는 루트'에. 넣기 전에 `electron/server-pins.js` 지문과 대조. 넣는 작업은 사용자 |
| 스트림덱 | 직접 만든 플러그인 HyperKwon Monitor(`com.hyperkwon.claudelimits`, Node)에 '가입 승인 대기' 액션 추가. 60초 갱신, 0 초과면 주황, 누르면 승인 대기만 거른 User Management. '관리 페이지 열기'는 기존 웹사이트 버튼에 주소만. 서버 상태 버튼은 이미 있어 그대로 |
| 스트림덱 인증 | 숫자 API 하나만 읽는 전용 열쇠. 145 `.env` 에 해시만(`ADMIN_CONSOLE_STREAMDECK_KEY_SHA256`), 원문은 스트림덱 설정 칸에 사용자가 직접. 열쇠는 스크립트가 만든다. 대화창에 원문을 붙이지 않는다 |
| 새 API | 가입 대기 숫자만 주는 가벼운 API (`/api/users` 는 사용자마다 통계를 계산해 무겁다) |
| 배포 | 웹 빌드 결과를 `HiTessWorkBenchBackEnd/AdminWeb/` 에 넣어 git 추적, 145 는 `git pull` + 재시작(새 라우터). `/wb-release` 때 자동 재빌드 + 따로 실행하는 짧은 명령 |
| 범위 | 회사 PC 전용(집에서는 145 가 안 보인다) |

브라우저에서 빠지는 기능(받아들임): LogBook 창에서 결과를 앱으로 돌려받는 연결(보내기 자체는 서버끼리라 됨), 즐겨찾기 저장, 접속 이력의 PC 이름.

## 사실 (조사 2026-11-18)
- 관리자 화면은 `window.workbenchAPI`·`ipcRenderer` 를 쓰지 않는다. `window.electron` 사용은 모두 `?.` + 브라우저 대체가 있다.
- 브라우저에서 Windows 자동 로그인(`api/auth.js`)과 등록한 PC 로그인은 Electron IPC 전용이다. AD 비밀번호 로그인은 된다.
- CORS 는 `localhost:5173/5174`, `app://.`, `file://` 만 허용 → 145 가 직접 내주면(같은 출처) 상관없다.
- 세션 = DB `user_sessions`, uuid, 8시간 고정, Bearer 헤더만.
- 크롬 통합 인증 정책 없음, 145 가 인트라넷 영역에 없음 → 지금은 IP 로 부르면 자격 증명을 안 보낼 것(추정).
- `POST /api/login/windows`: 401 + `WWW-Authenticate: Negotiate`, `employee_id` 쿼리 선택. 본문을 싣지 말 것.
- 인증서: `scripts/make_tls_cert.py`, SAN = IP 10.14.42.145 + `HHIPW170658.HDShipGroup.HHI.co.kr`, 5년, CA 아님(서버 하나만 신뢰 가능).

## 단계
1. **서버**: `/admin/` 라우터(`routers/admin_web.py`, `AdminWeb/` 서빙 — 기존 `history_web.py` 와 같은 경로 검사) ·
   `GET /api/admin-console/access`(입구 검사) · `GET /api/admin-console/pending-count`(Bearer 관리자 viewer 또는 스트림덱 열쇠) · 시험.
2. **프론트**: `admin.html` + `src/admin/main.jsx`(관리자 전용 틀). 서버 주소 = 현재 출처. 로그인 화면은 브라우저용 —
   Windows 자동 로그인을 `fetch(…, {credentials:'include'})` 로 먼저 시도, 안 되면 AD 비밀번호. 입구 검사 실패면 '권한 없음'.
   마지막 화면 기억, `?menu=User Management&filter=pending` 같은 주소로 바로 열기.
3. **빌드와 배포**: `scripts/build-admin-web.ps1`(빌드 → `AdminWeb/` 갈아 끼우기), `/wb-release` 연동.
4. **PC 설정(사용자)**: 인증서 대조 후 신뢰 루트에 넣기 · 145 를 인트라넷 영역에 등록 · 크롬 '앱으로 설치'. → 자동 로그인 시험.
5. **스트림덱**: 열쇠 만드는 스크립트 → 145 `.env` → HyperKwon Monitor 에 액션 추가 → 버튼 배치.

## 진행 기록
- 2026-11-18: 계획 확정, 1단계 착수.
- 2026-11-18 (코드, 미커밋): 1·2·3·5단계 코드 완료.
  - 서버 `routers/admin_web.py` + 시험 `tests/test_admin_web.py`(7건). 가입 대기 수 = `is_active` false 또는 NULL(화면 `!u.is_active` 와 같음).
  - 프론트 `admin.html` + `src/admin/`(adminBootstrap·main·AdminApp·AdminLogin) + `utils/adminConsole.js`(+시험) + `utils/loginMessages.js`(LoginScreen 과 공용).
    빌드본은 서버 주소 = 페이지 출처(`import.meta.env.DEV` 일 때만 config), http 로 열면 https 로 다시 연다.
    Windows 로그인은 버튼으로 먼저 한 번 성공해야 다음부터 자동(인트라넷 등록 전 크롬 로그인 창 방지).
    exe 의 관리자 비밀번호 게이트는 넣지 않음(입구 검사가 더 좁다).
  - 빌드 `vite build --mode admin` → `dist-admin`(git 제외) → `scripts/build-admin-web.ps1` 이 `AdminWeb/` 을 갈아 끼우고 DRM 머리를 검사. `release.ps1` 4단계가 exe 빌드 직후(같은 config 상태) 부른다.
  - 스트림덱: claude-control `deck/streamdeck-plugin` HyperKwon Monitor 1.10 에 `WB Sign-ups` 액션(`pi-signups.html`) — 60초, 0 초록 / 1+ 주황, 누르면 `/admin/?menu=User Management`. 열쇠 = `scripts/new-streamdeck-key.ps1`(원문은 클립보드만).
  - 확인: 같은 DB 를 쓰는 임시 서버(`WORKBENCH_DISABLE_RUNTIME_SERVICES=1`, 9098 HTTPS)에서 헤드리스 Chrome 으로 로그인 화면, **Windows 로그인 실제 성공(127.0.0.1 — 크롬이 원래 인트라넷으로 보는 주소)**, 9개 메뉴 이동, `?menu=`, 새로 고침 뒤 마지막 화면. 오류는 LogBook 502(70 개발 환경, exe 도 같음)뿐. exe 빌드에 admin.html 이 섞이지 않음, 프론트 유틸 시험 566 통과.
  - 확인 안 함: 145 주소에서 인트라넷 등록 뒤 Windows 자동 로그인, 실제 스트림덱 키(플러그인 설치 = claude-control `setup.ps1` + Stream Deck 재시작, 사용자 몫).
  - 남은 일: 커밋(WorkBench + claude-control) → 145 `git pull + 재시작`(새 라우터) → `.env` 에 `ADMIN_CONSOLE_STREAMDECK_KEY_SHA256` → 4단계 PC 설정.
- 2026-11-18 커밋 전 독립 리뷰 반영(막아야 함 2, 고치면 좋음 4):
  - 관리자 토큰이 같은 출처(9091)의 외부 App(`/external-apps/*`)에서 읽힐 수 있던 것 → 콘솔만 로그인 키 4개를 sessionStorage 로(`adminBootstrap.js` 가 Storage 메서드를 그 네 키에 한해 돌림, exe 무관). 탭을 닫으면 로그아웃, Windows 자동 로그인으로 복귀. 남은 틈: 콘솔 탭에서 `window.open` 으로 같은 출처 외부 App 을 열면 sessionStorage 가 복사될 수 있다(콘솔에 그런 링크는 없음).
  - 콘솔 로그아웃 = `POST /api/admin-console/logout`(그 토큰만). `/api/logout` 은 exe 의 외부 App 세션·접속 표시까지 닫는다. 콘솔은 하트비트를 보내지 않는다(접속 표시가 사용자당 한 줄이라 exe 와 섞임) — 콘솔만 쓰는 동안은 '접속 중'에 안 보인다. 로그인할 때 exe 의 열린 접속 이력이 'relogin' 으로 닫히는 것은 그대로(이력 쪽만 영향).
  - 번들에 70 주소 → admin 모드에서만 config.js 의 70 주소 글자를 지움(`vite.config.js` `stripDevPcAddress`), `build-admin-web.ps1` 이 다시 검사하고 커밋 안 된 화면 코드를 경고.
  - 스트림덱: https 아니면 열쇠를 안 보냄, 인증서 지문(`WB_PINS`, server-pins.js 사본) 대조 뒤에만 헤더 전송, 브라우저는 `explorer.exe <URL>`(cmd 안 거침). 실측: 70 9443 → 지문 통과, http → `use https`, github → `bad cert`.
  - ⚠ 커밋할 때 `app/main.py` 는 admin_web 두 줄만(`git add -p`) — 다른 세션의 `psa_report` import 가 같이 들어 있고 그 라우터 파일은 미추적이라, 통째로 넣으면 145 가 시작하지 못한다.
  - ⚠ 지금 `AdminWeb/` 번들에는 다른 세션의 미커밋 화면 코드(DashboardContext 의 Truss Module Lifting·PSA 등)가 섞여 있다 — 첫 커밋 전에 그 변경이 커밋된 뒤 다시 빌드하거나 worktree 에서 빌드한다.
  - 다시 확인: 서버 시험 8, 백엔드 전체 통과(실패 0), 프론트 유틸 566, 임시 서버 + 헤드리스로 Windows 로그인 → 토큰이 sessionStorage 에만 → 로그아웃 뒤 그 토큰 401 → 9개 메뉴.
