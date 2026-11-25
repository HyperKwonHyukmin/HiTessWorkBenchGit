# 구조해석 자동화 협의체 과제 현황 페이지 (2026-11-25)

협의체에서 발굴한 부서별 자동화 과제를 팀장, 실장님, Hi-TESS 개발진이 함께 보고 의견을 남기는 페이지.

## 결정 (사용자, 2026-11-25)
- WorkBench 관리자 메뉴에 두고, 따로 브라우저 주소로도 연다.
- **관리자 계정(is_admin)만** 본다. 전사 공개 아님. 팀장과 실장님 계정에는 사용자가 직접 관리자 권한을 준다.
- 과제와 기록의 생성, 수정, 삭제는 관리자 누구나.
- 볼 것: 과제 목록, 의뢰 부서, 진행 상황, 팀장과 실장님 의견.
- 화면 구성 참고 = Team Planner(`E:\Apps\team-planner`) 의 '목록 + 한 장의 상세', 14일 멈춤 표시, 변경 기록.

## 구성
| 부분 | 위치 |
|---|---|
| 표 | `models.CouncilTask`(council_tasks), `models.CouncilNote`(council_notes). 새 표라 시작 때 create_all 로 생긴다 |
| API | `app/routers/council.py` `/api/council/*` — 모두 `require_admin`. `/access` 만 비관리자에게 200 {allowed:false} |
| 브라우저 페이지 | `/council/` = `AdminWeb/council.html`(관리자 콘솔과 같은 빌드, `routers/admin_web.py`). 입구 `src/council/CouncilApp.jsx` |
| 앱 메뉴 | ADMINISTRATION > `Automation Council` (`pages/Administration/AutomationCouncil.jsx`, 관리자 콘솔 /admin/ 에도) |
| 화면 규칙 | `utils/councilTasks.js`(+테스트): 상태, 지연, 14일 멈춤, 거르기, 부서별과 상태별 묶기 |

- 상태 = 검토 중, 개발 중, 시험 운영, 완료, 보류. 상태를 바꾸면 서버가 '상태 변경' 기록을 남긴다(고치거나 지울 수 없음).
- 기록 = 의견, 진행 기록. 쓴 사람의 이름, 직급, 부서는 쓴 순간 값으로 남긴다.
- 과제 지우기는 `deleted_at` 만 채운다(DB 에서 되살릴 수 있게). 기록 지우기는 실제로 지운다.
- 표가 비어 있으면 '1차 회의 수요 10건 넣기' 단추(`POST /api/council/seed-first-meeting`, 과제가 하나라도 있으면 409).
- 목록은 ORDER BY 없이 읽고 파이썬에서 정렬한다(TEXT 칸 MySQL 정렬 버퍼 함정).

## 2차: Team Planner 과제 관리 기능 (2026-11-25 오후, 사용자 지시 "항목도 있고 타임테이블도 있어야")

1차는 과제 한 줄과 의견뿐이라 모자랐다. Team Planner(`E:\Apps\team-planner`)의 과제 관리에서 아래를 옮겼다.

| 기능 | 내용 | 위치 |
|---|---|---|
| 항목 | 과제 아래 할 일. 이름, 담당, 예정/진행/완료, 시작일(선택), 마감일(필수), 메모, 중요. 상태 원을 누르면 다음 상태로, 이름 쓰고 Enter 로 바로 추가 | 표 `council_items`, `components/admin/council/CouncilItems.jsx` |
| 마일스톤 | 날짜와 이름(착수, 시제품 시연 등 추천) | 표 `council_milestones` |
| 타임라인 | 과제마다 한 줄(의뢰 부서로 묶음), 항목은 막대(시작 ~ 마감) 또는 마름모(마감일만), 마일스톤, 과제 기간 띠, 2주/6주/분기, 주말 숨기기, 공휴일. 막대를 누르면 편집, 빈 곳을 누르면 그날 마감 항목 추가 | `CouncilTimeline.jsx`, 계산 `utils/councilTimeline.js` |
| 과제 기간 | 과제에 시작일 칸(`council_tasks.start_date`). 145 에는 표가 먼저 생겨 `schema_bootstrap.ensure_council_columns` 가 보강한다 | |
| 목록 집계 | 과제 줄에 항목 완료/전체, 지연 수, 다음 마감. 과제 '지연' = 목표일이 지났거나 지연 항목이 있음 | `utils/councilTasks.js` |

- 가져오지 않은 것(필요하면 다음에): 타임라인에서 끌어 옮기기와 늘이기(되돌리기가 없어 실수로 일정이 바뀔 수 있어 뺐다), 보드(예정/진행/완료 열), 주간 보고, 담당자별 현황판, 부재.
- 담당은 명부 없이 글자로 적는다(이미 쓴 이름을 추천). Team Planner 의 팀 멤버 표는 옮기지 않았다.

## 주의
- 브라우저 페이지는 관리자 콘솔처럼 http 로 열면 같은 포트의 https 로 넘어간다(`adminBootstrap.js`). 145 인증서는 자체 서명이라
  인증서를 신뢰 목록에 넣지 않은 PC 는 크롬 경고가 뜬다.
  **결정(사용자 2026-11-25): https 유지 + PC 마다 인증서 한 번 등록.** http 로 바꾸면 관리자 권한 토큰이 사내망에 평문으로 오간다.
  - 배치 파일 = `scripts/council-cert/` 의 `Hi-TESS 인증서 등록.cmd` + `hitess-145.crt`(두 파일을 함께 복사해 실행). 관리자 권한 불필요(`certutil -user -addstore Root`), Windows 가 띄우는 '보안 경고'에서 [예].
  - 넣기 전에 파일 지문(SHA1 `E5C5C3C6…7E49`)을 대조한다. 공개키 지문은 앱 고정값 `y5rO…`(electron/server-pins.js 첫 값)과 같음을 2026-11-25 확인. 만료 2031-11-04.
  - ⚠ 145 가 예비 키로 바꾸거나 인증서를 다시 만들면 이 두 파일도 새로 만들어 다시 돌려야 한다.
  - 확인(2026-11-25, 이 PC): 이미 등록된 PC 에서 '이미 등록', 지문을 바꾼 사본은 거부, crt 없으면 안내. 인증서가 등록된 이 PC 의 크롬은 https://10.14.42.145:9091 을 secure 로 연다.
    **새 PC 에서 실제로 등록하는 갈래는 시험하지 않음**(이 PC 에는 이미 있음).
- exe 의 관리자 메뉴는 관리자 비밀번호 게이트를 거친다(Automation Council 도 `ADMIN_MENUS` 라 같음).
- 팀장, 실장님에게 is_admin 을 주면 다른 관리 기능(가입 승인, App Settings, All Projects 등)도 열린다. 사용자가 알고 정함.

## 상태
- 2026-11-25: 구현, 백엔드 시험 8건, 화면 규칙 시험 8건, 임시 서버(SQLite) + 헤드리스 Chrome 으로 /council/ 화면과 등록, 수정, 지우기 확인. 커밋 전.
- 반영 = 145 `git pull + 재시작`(새 라우터와 표) + `AdminWeb` 재빌드(`pwsh scripts/build-admin-web.ps1`) 커밋 + 앱 메뉴는 다음 exe.
