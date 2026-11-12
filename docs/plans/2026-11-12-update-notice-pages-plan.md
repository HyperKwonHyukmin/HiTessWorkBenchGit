# 기능 업데이트 공지 페이지 + 조회 통계 계획 (2026-11-12)

## 목표

기능 업데이트가 나갈 때마다 사용자가 주소 하나로 여는 짧은 안내 페이지를 만들고,
웹 뉴스레터처럼 "얼마나 봤는가"를 잰다. 뉴스레터(월 1회, 여러 소식)와 달리
**기능 하나, 그 기능을 쓰는 사람**이 대상이다.

판단 기준: 공지 페이지는 **사용 방법이 바뀌는 기능만** 만든다(월 1~3건 예상).
작은 수정은 지금처럼 Update History(`changelog.json`)에만 적는다.

## 이미 있는 것 (재사용)

| 있는 것 | 위치 | 이번에 쓰는 방식 |
|---|---|---|
| 공개 페이지 서빙(인증 없음, 허용 확장자 표, DRM 머리 검사, UNC 경로 차단) | `routers/newsletter_web.py` | 같은 방식으로 `/updates` 라우터 |
| 측정 스크립트 끼워 넣기, 읽은 깊이·머문 시간·본 구획 | `services/newsletter_stats.py` | 기록과 집계 함수를 페이지 종류와 무관하게 일반화 |
| 나만 보는 통계 칸 | `NEWSLETTER_STATS_VIEWERS`, `NewsletterStatsPanel.jsx` | 같은 권한, 패널 하나 더 |
| 앱 안 끼워 보기(`?embed=1`, postMessage 높이) | `/history` + `DevelopmentHistory.jsx` | 같은 방식 |
| 업데이트 이력 | `app/changelog/changelog.json` | 항목에 `page` 칸을 더해 연결 |

## 설계

### 1. 주소와 폴더
- `/updates` = 목록(최신이 위), `/updates/{slug}/` = 공지 한 건, `/updates/{slug}/{그림}`, `/updates/{slug}/beacon`.
- 폴더 `HiTessWorkBenchBackEnd/UpdateWeb/<YYYY-MM-DD-주제>/`(git 추적, 145 는 `git pull` 만으로 반영).
  - `update.json` = 제목, 날짜, 대상 앱(`app` = ANALYSIS_DATA 제목 또는 studio viewer id), 버전, 요약, 구획 목록 `sections[{id, heading, body, image?}]`.
  - `img/` = 화면 캡처.
- **페이지는 공통 틀 하나로 서버가 그린다**(`UpdateWeb/_template/`). 호마다 HTML 을 새로 쓰지 않는다.
  이유: 자주 나가는 짧은 글이라 모양을 맞추고 만드는 비용을 줄인다. 구획 id 가 json 에 있으니 측정할 구획도 저절로 정해진다.

### 2. 조회 기록
- 새 표 `update_page_views`(뉴스레터 표와 같은 모양 + `employee_id` 빈칸 허용). `create_all` 로 생기고 뉴스레터 표는 건드리지 않는다.
- 두 경로:
  - **브라우저(메일 링크)**: 뉴스레터와 같다. 방문자 = IP 해시, 사람이 아니라 PC 수.
  - **앱 안에서 열기**: iframe 속 페이지는 로그인 헤더를 못 싣는다. 그래서 페이지의 측정 값을 postMessage 로 앱에 넘기고,
    앱이 로그인 API(`POST /api/updates/{slug}/seen`)로 사번과 함께 보낸다. (결정 1 에 따라 달라짐)
- 측정 스크립트는 뉴스레터 것을 일반화: 구획 id 는 `data-section` 에서 읽고, 서버는 `update.json` 의 구획 id 만 받는다.

### 3. 사용자에게 닿는 길
- 대시보드 공지 줄에 '새 기능 안내' 한 줄(최근 14일 공지, 누르면 앱 안 보기).
- 그 앱 화면 배너 옆 작은 칩 '새 기능'(14일, 본 사람은 숨김 — 사번 기록이 있을 때만 가능).
- Update History 항목에 '안내 페이지' 링크(`changelog.json` 항목의 `page`).
- 메일: 주소 `http://10.14.42.145:9091/updates/<slug>/` 를 사용자 메일 본문에 넣는다(보내기는 사용자).
- 강제 팝업은 하지 않는다(로그인 때마다 막히면 닫기만 누르게 된다).

### 4. 통계 화면
Usage Reports 맨 아래 '업데이트 안내 조회'(나만 보는 칸). 공지마다:
- 조회수, 본 PC 수, 본 사람 수(앱 안), 읽은 깊이, 머문 시간, 구획 도달.
- **대상 앱 사용자 도달률** = 최근 30일 그 앱을 실행한 사람 중 공지를 본 사람 비율(사번 기록이 있을 때만).
- 공지 전후 14일 그 앱 실행 수와 실행한 사람 수(뉴스레터의 '발송 전후' 와 같은 계산을 앱 하나로 좁힘).

## 진행 단계

| 단계 | 내용 | 반영 |
|---|---|---|
| 1 | 백엔드: `/updates` 라우터, 공통 틀, 표, 측정 일반화(뉴스레터 동작은 그대로, 기존 시험 통과), 시험 | 145 `git pull + 재시작` |
| 2 | 첫 공지 1건 작성(예: MU 가서포트 제거) 후 브라우저로 열어 기록 확인 | `git pull` |
| 3 | 통계 패널, Update History 링크, 대시보드 공지 줄 | 다음 exe |
| 4 | 앱 안 보기(사번 기록), 앱 화면 '새 기능' 칩 | 다음 exe |

1~2단계만으로 메일 링크 공지와 익명 통계가 동작한다. 3~4단계는 exe 릴리스 때 함께.

## 결정 (2026-11-12, 사용자)
1. 앱 안에서 연 경우 사번으로 기록한다. 브라우저(메일 링크)는 IP 해시로 익명.
2. **안내는 누적, HTML 은 하나**: `UpdateWeb/index.html` 한 장이 `updates.json` 을 읽어 왼쪽 목록(달별)과 본문을 그린다.
   목록을 누르면 이전 안내를 보여 준다. 위 설계 1절의 '안내마다 폴더' 는 쓰지 않는다.
   **주소마다 첫 화면이 다르다**(같은 날 사용자 지시): `/updates/<안내 id>` 도 같은 HTML 을 주고 페이지가 주소를 읽어 그 안내를 먼저 보인다.
   `/updates/` 는 최신, 없는 id(지운 안내의 옛 링크)도 최신으로. 목록을 누르면 주소가 바뀌고 브라우저 뒤로 가기가 이전 안내로 간다. 옛 방식 `#<id>` 도 받는다.
3. 첫 내용은 시험용(가짜 기능 '권상 해석 두 번의 결과 비교', `test: true`) + 실제 changelog 2건.

## 진행 상태 (2026-11-12)
- 끝남(미커밋): `routers/updates_web.py`(`/updates`, `/updates/updates.json`, `/updates/beacon`, `/api/updates/beacon`, `/api/admin/update-stats`) ·
  `services/update_page_stats.py` · 표 `update_page_views` · `UpdateWeb/`(index.html, updates.json, img, fonts) · 시험 `tests/test_updates_web.py`.
- 측정: 안내를 보여 줄 때 `view`, 다른 안내로 넘어가거나 화면을 떠날 때 `measure`(읽은 깊이 = 본 구획 위치, 머문 시간, 본 구획).
  `?embed=1` 이면 기록을 `postMessage({type:'hitess-update-beacon'})` 로 앱에 넘기고, 앱이 `/api/updates/beacon` 으로 사번과 함께 보낸다(앱 쪽은 아직).
- 70 서버에서 확인: 페이지 1440·390 폭 캡처, MySQL 에 view·measure 기록.
- 통계 화면(같은 날, 미커밋): Usage Reports 맨 아래 '업데이트 안내'(`UpdateStatsPanel.jsx`) + '웹 뉴스레터'(`NewsletterStatsPanel.jsx`) — 공용 조각 `StatBits.jsx`.
  **사용자 결정: '얼마나 읽었는지'(읽은 깊이, 머문 시간, 구획 도달)는 두 패널 모두 화면에서 뺀다.** 서버는 계속 모은다(되살리기 쉬움).
  업데이트 안내 = 안내별 표(조회, 앱 안 사람, 브라우저 PC, 대상 앱 사용자 도달) + 고른 안내의 날짜별 조회와 안내 전후 14일 그 앱 실행.
  뉴스레터 = 조회수, 방문 PC, 마지막 조회 + 날짜별 조회 + 발송 전후 14일. 화면은 눈으로 확인 안 함(로그인 필요, 70 서버 재시작 전이라 API 도 아직 없음).
- 앱 안 보기(같은 날, 미커밋): 대시보드 공지 줄 아래 '새 기능 안내' 한 줄(`components/UpdateNoticeStrip.jsx`) — 최근 30일 최신 안내, NEW = 14일 안이고 이 PC 에서 이 사번이 안 연 것(localStorage `workbench:update-seen:<사번>`).
  누르면 `UpdateNoticeModal.jsx`(iframe `/updates/<id>?embed=1`). 페이지가 postMessage 로 넘긴 기록을 앱 전체 한 번 설치한 리스너가 받아(출처 = 서버 주소) `/api/updates/beacon` 으로 사번과 함께 보낸다.
  `test: true` 안내는 개발 화면(`import.meta.env.DEV`)의 대시보드 줄에만 — ⚠ 공개 페이지 목록에는 그대로 보이므로 **커밋 전에 시험용 안내를 지울 것**.
  규칙 `utils/updateNotices.js`(+테스트). 확인: 헤드리스로 embed 페이지가 view 를 postMessage 로 넘기고 서버로 직접 보내지 않음. 창을 닫는 순간의 measure 는 전달되지 않을 수 있다(머문 시간만 영향, 화면에서 안 씀).
  대시보드 줄과 창은 눈으로 확인 안 함(로그인 필요).
- **App 분류와 누가 봤는지(같은 날 사용자 지시)**: 안내의 `programs` = App 분류. 대상 = 그 App 을 한 번이라도 실행한 사람
  (User Management 'App 사용자' 필터 `admin_projects.program_users` 와 같은 기준 — 샘플과 권상 세부 검토 제외, 안내 뒤 새로 쓴 사람 포함, 70 DB 로 같은 명단 확인).
  통계 표 'App 사용자 중 본 사람' = 본 사람 / 대상, 줄을 고르면 명단(안 본 사람, 본 사람과 처음 본 날) + 안 본 사람 메일 복사(숨은 참조용). 사람은 앱 안에서 연 기록으로만 안다.
- 같은 날 후속(사용자 결정): 안내 전후 14일 실행 비교를 서버와 화면에서 뺐다. 시험용 가짜 안내 삭제(실제 2건만 남김).
  Update History 항목의 `page` → '사용자 안내 페이지' 단추. 작성 규칙은 CLAUDE.md '사용자 업데이트 안내 페이지'.
- 남은 것(이전 줄 기준, 일부 끝남): Update History 링크 · 시험용 안내 정리 · 145 반영(git pull + 재시작, 화면은 다음 exe).

## 진행 (2026-11-12 세션 끝)
- 커밋 `fdd3cef`(페이지와 통계) · `57057db`(주소 복사와 열기, 145 확인용 시험 안내 3건) · `16663fd`(App 별로 보기), WorkBench 1.7.20(`fad582a`) 포함.
- 남은 것: 145 ⟳ Update + 재시작 → 브라우저와 개발 앱(서버 145)으로 확인 → 시험 안내 3건 삭제 커밋 → 1.7.20 exe 배포 → 실제 첫 안내 작성.
- 미룬 것: 통계 표가 10건을 넘으면 '이전 안내 더 보기'로 접기 · App 별 주소(`?app=`) · 로그인 없는 `/updates/beacon` 횟수 제한(리뷰 '고치면 좋음').
