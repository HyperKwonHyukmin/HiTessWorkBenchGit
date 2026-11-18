# 관리자 기능 (메일, 메뉴, 웹 콘솔, App Settings, Update History, All Projects)

> 2026-11-19 루트 `CLAUDE.md` 에서 그대로 옮긴 기록이다(한도 초과 정리). 규칙 요약은 `CLAUDE.md` 에 남아 있고, 진행 기록과 상세는 여기에 이어 쓴다.

### 가입자 단체 메일 (2026-11-09, WorkBench 1.7.13)

User Management 버튼 줄의 **'메일 주소 복사'** — **지금 목록(검색·필터 반영, 2026-11-10 변경)** 의 승인(is_active) 사용자 `users.email` 을 `; ` 로 이어 복사한다(검색·필터가 없으면 전원, 페이지 나눔과는 무관). 이 변경은 `1d856e0`, 1.7.16 이후라 다음 exe 부터 반영·버튼은 눈으로 확인 안 함.
Outlook **숨은 참조(BCC)** 에 붙여 보낸다(주소 노출·전체 회신 방지). 그룹·배포 목록은 만들지 않기로 했다 — 200명대는 Exchange 기본 한도(1통 500명) 안이고 DL 은 신청·수동 유지가 든다.
주소가 없거나 모양이 틀린 사람은 토스트로 이름을 알린다(PLM 미등록·협력사 X 사번 — 메일은 PLM 백필, 메모리 `reference_plm_user_directory`). 규칙 `utils/userMailList.js`(+테스트), 프론트만(`027dfec`).
**App 사용자 필터 (2026-11-12, `ffa6a36` · 70 개발 앱 화면 확인)** — 필터 줄 'App 사용자' 드롭다운 = 그 App 을 한 번이라도 실행한 사람만(성공·실패 모두, 샘플·권상 세부 검토 제외 = All Projects 기준, 내부 키 여러 개인 App 은 합침). 고른 뒤 '메일 주소 복사' 가 그 사람들만 복사한다(업데이트 안내용).
  서버 `GET /api/admin/projects/program-users`(관리자, App×사번 실행 수) · 묶기 `utils/userMailList.js` `buildProgramUserSets`. 반영 = 145 `git pull + 재시작` + 새 exe. 옛 서버면 드롭다운이 '모든 App 사용자' 하나뿐.
**메일 손으로 넣기 (2026-11-09, 미커밋)** — 필터 칩 '메일 없음'(승인 사용자 중 쓸 주소 없음) · 행의 '메일 없음 · 넣기' → 정보 수정 창 '메일' 칸.
`PUT /api/users/{id}` 에 `email` 이 오면 **값이 바뀐 때만** `users.email_manual` 을 세운다(비우면 해제 → 다음 PLM 갱신이 다시 채움, 모양 틀리면 422 `invalid_email`).
**한 번에 넣기**(같은 날, 미커밋): 버튼 '메일 없는 N명 넣기' → `components/admin/BulkEmailModal.jsx` — 그 사람들만 표로 모아 줄마다 메일 칸, 빈 칸은 건너뛰고 아는 사람만 저장(사람마다 같은 PUT), 저장된 줄은 빠지고 실패 줄은 남음, '이름 목록 복사'(탭 구분, 주소록 찾기용). 서버 변경 없음.
`user_directory_sync.apply_plm_profile` 이 `email_manual` 인 사람의 email 은 건너뛴다(전체·단건·주기 갱신 공통, 다른 필드는 반영). 목록에 '수동' 배지. 주소 규칙은 백엔드 `_MANUAL_EMAIL_PATTERN` ↔ 프론트 `EMAIL_PATTERN` 사본.
컬럼은 `schema_bootstrap` 이 붙인다(70 MySQL 두 번 실행 확인). 반영 = 145 ⟳ Update + **재시작**(컬럼) + 새 exe. 옛 exe 로 정보 수정해도 email 을 안 보내 표시는 안 바뀐다. ⚠ 서버를 먼저 — 옛 서버는 새 exe 가 보낸 email 을 조용히 버린다.
회사 한도를 낮춰 뒀는지는 미확인(넘으면 반송으로 알 수 있음). 1.7.13 exe(`ddf4633`) 배포·145 ⟳ Update+재시작(VMDC 자동 로그인 `1888654` 포함)은 사용자 몫, 버튼은 눈으로 확인 안 함.
⚠ 미추적 `Postman_Console/Program.cs` 에 메일 계정 비밀번호가 평문으로 있다 — 커밋하지 말 것.


### 관리자 메뉴 정리 (2026-11-11, `3681d63` · WorkBench 1.7.19)

145 화면 체류 기록(`access_sessions.page_seconds`, 10-20~11-11)을 근거로 사이드바 ADMINISTRATION 을 10칸 → 7칸으로 줄였다.
거의 안 쓰던 App Community(0분)·API Apps(5회 1분 미만)는 **App Settings 의 탭**, Update History·Development History 는 **History 메뉴의 탭**.
탭도 옛 메뉴 이름으로 이동한다(`constants/adminMenus.js` `ADMIN_TAB_GROUPS` + `components/admin/AdminTabHub.jsx`) — 저장된 시작 화면·체류 기록·뒤로 가기가 탭 단위로 그대로다.
옛 별칭 `System Settings` 는 지웠다. 관리자 화면을 새로 묶을 때는 `ADMIN_TAB_GROUPS` 에 더하고 이름을 `ADMIN_MENUS` 에도 넣을 것(빠지면 비관리자 가드 우회, 시험이 잡음).
**사용자 결정(같은 날): 이 7칸 구성으로 유지** — Analysis Management 통합(이력 표 → All Projects, 통계 → Usage Reports)은 하지 않기로 했다. 다시 꺼낼 때는 주 사용자인 김한별 책임에게 쓰는 용도부터 확인. 조회 스크립트는 UNC `UnLock\admin_menu_usage.py`(145 백엔드 폴더에서 실행).

### 관리자 웹 콘솔 `/admin/` + 스트림덱 가입 대기 키 (2026-11-18, `35f9b95` · 145 반영 · 동작 확인)

exe 없이 회사 PC 크롬에서 관리자 화면을 쓴다(사용자 본인 전용). 결정·진행 = `docs/plans/2026-11-18-admin-web-console-plan.md`.
145 에서 크롬 Windows 계정 자동 로그인이 인트라넷 등록 없이 된다(사용자 확인). 이 PC 는 145 인증서를 내 계정 신뢰 루트에 넣었다(`certutil -user -addstore Root`). LogBook 관리는 콘솔에 넣지 않는다(사용자 결정 — LogBook 에 들어가서 한다).
- 같은 React 페이지를 진입점만 따로(`frontend/admin.html` + `src/admin/`), 빌드본 = `HiTessWorkBenchBackEnd/AdminWeb/`(**git 추적, 생성물** — 손으로 고치지 말고 `pwsh scripts/build-admin-web.ps1`). `/wb-release` 가 다시 빌드하고 같은 커밋에 넣는다.
- 서버 `routers/admin_web.py`: 페이지·자원은 로그인 없이(화면 코드는 exe 와 같아 비밀 없음), 입구 `GET /api/admin-console/access` 와 `GET /api/admin-console/pending-count` 만 `is_admin` + `.env ADMIN_CONSOLE_VIEWERS`(기본 A476854). 관리 API 는 exe 와 같아 `is_admin` 만 — 사번 검사를 덧대지 말 것(다른 관리자가 exe 에서 막힘).
- 스트림덱 열쇠 = `.env ADMIN_CONSOLE_STREAMDECK_KEY_SHA256`(해시만, 헤더 `X-Admin-Console-Key`, 숫자 하나만 읽힘). 플러그인 = claude-control `deck/streamdeck-plugin` `WB Sign-ups`.
- **LB New 키 (2026-11-18)** — 내가 마지막으로 확인한 뒤 다른 사람이 LogBook 에 올린 묶음 수. 스트림덱 → `GET /api/admin-console/logbook-new?since=`(같은 열쇠, 열쇠 요청엔 묶음 이름 안 줌) → LogBook `GET /api/integration/new-uploads`(서버끼리, LogBook 은 평문이라 스트림덱이 직접 안 감). 두 번 누름 = LogBook 열기 + 확인 시각 저장. LogBook `received_at` 은 올리기 시작 시각이라 확인 시각을 올리는 중인 묶음의 시작(`uploading_since`)까지 당긴다. 상세 = 계획 문서 'LB New'. 반영 = LogBook 먼저 → WorkBench 재시작 → Stream Deck 재시작.

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
