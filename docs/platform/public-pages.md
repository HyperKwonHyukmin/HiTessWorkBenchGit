# 로그인 없는 공개 페이지 (뉴스레터, 개발 연대기, 업데이트 안내)

> 2026-11-19 루트 `CLAUDE.md` 에서 그대로 옮긴 기록이다(한도 초과 정리). 규칙 요약은 `CLAUDE.md` 에 남아 있고, 진행 기록과 상세는 여기에 이어 쓴다.

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


### 사용자 업데이트 안내 페이지 `/updates` (2026-11-12)

기능 업데이트를 사용자에게 알리는 공개 페이지 **한 장**(로그인 없음). 안내는 누적되고 왼쪽 목록으로 이전 안내를 본다.
주소 `/updates/<안내 id>` 로 들어오면 그 안내가 첫 화면(없는 id 면 최신). 계획과 결정 = `docs/plans/2026-11-12-update-notice-pages-plan.md`.
- 내용 = `HiTessWorkBenchBackEnd/UpdateWeb/updates.json`(git 추적, 145 는 `git pull` 만, 재시작 불필요) + `img/`. 페이지 틀 `UpdateWeb/index.html` 은 고치지 않아도 된다.
- 서버 `routers/updates_web.py` + `services/update_page_stats.py`, 표 `update_page_views`. 앱 대시보드 '새 기능 안내' 줄(`components/UpdateNoticeStrip.jsx`) → 앱 안 창(`UpdateNoticeModal.jsx`, iframe `?embed=1`)에서 본 기록은 사번으로 남는다(브라우저는 IP 해시라 PC 수만).
- 통계 = Usage Reports '업데이트 안내'(뉴스레터 통계와 같은 사람만): 안내별 조회, 앱 안 본 사람, 브라우저 PC, **App 사용자 가운데 본 사람**과 명단(안 본 사람 메일 복사).
  '얼마나 읽었는지'(깊이, 머문 시간, 구획)와 전후 실행 비교는 화면에 넣지 않는다(사용자 결정).
- **명령어 `/update-notice` (2026-11-19)** — 아래 절차를 한 번에 한다(`.claude/commands/update-notice.md`). 그림은 `scripts/update_notice_annotate.py`(자르기, 주황 상자, 번호) + `outputs/update-notice/spec-<날짜>.json`.
- ★ **"업데이트 안내 써줘" = Claude 가 쓴다**: `git log`와 `changelog.json` 으로 바뀐 것을 확인 → `updates.json` 맨 앞에 한 항목
  (`id` = `YYYY-MM-DD-영문주제`, `date`, `app` = 화면에 보일 App 이름, **`programs` = App 분류** = User Management 'App 사용자' 필터와 같은 `Analysis.program_name` 키(빠지면 명단을 못 셈), `version`, `title`, `summary`,
  `sections[{id, heading, body|facts|steps|points|image|images|note}]`) → 필요하면 헤드리스 Chrome 캡처를 `img/` 에 → 페이지 캡처로 모양 확인 → 보여 주고 확인받은 뒤 커밋.
  그 기능의 `changelog.json` 항목에 `"page": "<안내 id>"` 를 달면 Update History 에 '사용자 안내 페이지' 단추가 생긴다(`test_changelog_pages_point_to_real_entries`).
  사용자 눈높이로 쓴다(내부 파일명, 버전 경과 금지). **사용 방법이 바뀌는 기능만** 안내하고, 작은 수정은 `changelog.json` 에만.
  Studio 기능의 App 분류 = 그 Studio 를 여는 App(MU Studio = `GroupModuleUnit`).
- `test: true` 안내는 개발 화면의 대시보드 줄에만 나오지만 공개 페이지 목록에는 보인다 — 시험 안내는 커밋 전에 지운다.
- 페이지 왼쪽 'App 별로 보기'(전체 + App 별 안내 수, 고르면 목록과 이전·다음이 그 App 안에서만). 고른 App 은 주소에 남지 않는다.
  통계 표와 앱 안 창에 주소 [복사]·[열기] — 복사 주소는 사내 브라우저용 `http://…:9091/updates/<id>`(`api/updates.js` `updateShareUrl`).
- 상태(2026-11-12): 커밋 `fdd3cef`·`57057db`·`16663fd`, **WorkBench 1.7.20**(`fad582a`)에 포함. 145 ⟳ Update + **재시작**(새 라우터와 표) → exe 배포는 사용자 몫.
  통계 표 = App 마다 최신 안내 한 줄, 이전 안내는 '이 App 의 이전 안내 N건' 으로 펼침(`groupEntriesByApp`, `7c64518` · 1.7.22 `da9f892`).
  **미커밋(같은 날 끝)**: 표 맨 앞 'App' 칸(굵은 App 이름 + 이전 안내 단추), '안내' 칸은 제목과 날짜만, 상세 제목 앞 App 이름표 — `UpdateStatsPanel.jsx` 한 파일, 빌드와 임시 캡처만 확인, 커밋 전 리뷰와 exe(1.7.23) 남음.
  **첫 실제 안내 = 2026-11-16 Mooring Fitting 현업 요청 5건**(`c03cc23`, 사용자 지시 '이거부터 시작') — 시험 안내 3건과 본격 작성 전 MU 안내 2건(11-11, 11-12)은 지웠다.
  작성 기준(같은 날 사용자 지적): 항목마다 `facts` 표(무엇이 바뀌었나 / 어디서 보나 / 결과에 미치는 영향)를 두고, 화면 그림은 **위치를 상자, 번호로 표시**해 넣는다(원본 캡처 그대로 넣으면 칩 같은 작은 요소를 못 찾는다).
  그림은 Pillow 로 원본(`HiTessWorkBenchBackEnd/UpdateNotice/`, 사용자가 둔 캡처)을 잘라 주황 상자와 번호를 얹는다. 회신 메일과 같은 번호를 제목에 붙인다.
  ⚠ 390px 확인은 헤드리스 Chrome `--window-size=390` 으로 하지 말 것 — 창이 그보다 좁아지지 않아 글이 잘린 것처럼 찍힌다. 390px iframe 에 넣어 찍는다.
  확인 안 함: 대시보드 줄, 앱 안 창, 통계 명단, 복사·열기 단추를 눈으로 본 적 없음(개발 앱에서 통계 표가 나오는 것만 사용자 확인). 앱 안 창을 닫는 순간의 머문 시간 기록은 전달되지 않을 수 있다(화면에서 안 씀).
- **릴리스를 커밋된 상태로 빌드한 방법(2026-11-12, 1.7.20)** — 작업 폴더에 다른 세션의 미커밋 변경(진행 중 DrawingToAnalysis)이 있으면 exe 에 섞인다.
  `git worktree add --detach C:\Coding\WorkBench-release HEAD` → `node_modules` 3곳과 `WorkBenchEnv` 를 junction 으로 연결 → 그 폴더에서 `release.ps1 -Bump -BuildOnly -Yes`
  → 본 폴더는 `check-versions.ps1` 로 같은 버전을 올려 4파일만 커밋 → exe 복사 → **junction 을 먼저 끊고**(`[IO.Directory]::Delete(p,$false)`) `git worktree remove --force`
  (그대로 지우면 원본 node_modules 까지 지울 수 있다).
