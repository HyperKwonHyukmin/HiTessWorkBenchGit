# 알림 센터 + 해석 완료 통지 — 설계 (Plan A)

- 작성일: 2026-09-18
- 상위 규약: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §1(공통 규칙) · §2.1(알림 서비스 계약, **이 plan 이 소유**) · §2.2(`user_preferences`, Plan E 소유 — 이 plan 이 먼저 실행되므로 **모델은 이 plan 이 그 정의대로 만든다**) · §3(실행 순서 1번).
- 대상: `HiTessWorkBenchBackEnd/`(FastAPI) + `HiTessWorkBench/frontend/`(React) + `HiTessWorkBench/electron/`(main 1줄).
- 구현 plan: `docs/superpowers/plans/2026-09-18-notification-center.md`

## 1. 배경 / 문제

WorkBench 의 해석 작업은 `job_manager.JobStatusStore`(인메모리) 에 상태가 쌓이고, 프론트는 앱을 켠 동안
`usePolling`(1.5초) 과 우하단 Job Center(`components/platform/UtilityDock.jsx`) 로 그 상태를 따라간다.
그래서 다음 상황에서 사용자는 결과를 **놓친다**.

- Nastran/Abaqus 계열 해석은 수 분~수십 분이라 사용자가 **다른 앱을 쓰거나 창을 내려 둔다.**
  Job Center 는 sessionStorage 기반(`DashboardContext.jsx:323-326`) 이라 앱을 껐다 켜면 비고,
  완료 표시도 `GLOBAL_JOB_VISIBLE_MS` 뒤 사라진다.
- 서버가 남기는 알림 창구가 **없다.** 관리자↔사용자 DM(`routers/chat.py`) 은 사람이 보내는 메시지고,
  토스트(`contexts/ToastContext.jsx`) 는 화면에 떠 있을 때만 의미가 있다.
- 뒤따르는 plan(B 보관 만료 경고, D 취소, G 공유, H 배치, K 기능요청 상태) 이 전부 "사용자에게 무언가를
  알려야" 하는데, 각자 토스트를 만들면 표현·보관·읽음 상태가 제각각이 된다.

이 plan 은 **서버가 사용자별로 남기는 인앱 알림(알림 센터)** 과 그 첫 번째 발신자인
**해석 완료/실패 통지**를 만든다. 다른 plan 은 §2.1 의 `notify()` 한 함수만 호출한다.

## 2. 확정 결정

| # | 결정 | 이유 |
|---|---|---|
| 1 | **폴링 30초, WebSocket 없음.** `GET /api/notifications?since=<id>` | presence(45초)·chat(5초) 과 같은 철학(마스터 §2.1). 서버 단일 프로세스·사내망이라 충분하고 인프라 변경이 없다. |
| 2 | **발신 지점은 `job_manager.JobStatusStore._write_through` 한 곳.** `status in ("Success","Failed")` 로 DB 반영이 끝난 직후 | 모든 해석 서비스가 `update_job()` 으로 종료를 알리고, 이 함수가 `Analysis` 레코드(소유자·프로그램·id)를 이미 들고 있다. 서비스 30여 개를 개별 수정하지 않는다. |
| 3 | 알림 실패는 **상태 저장을 되돌리지 않는다.** `db.commit()` 뒤 별도 try 로 감싸고 경고 로그만 | 알림은 부가 기능이다. 알림 테이블 문제로 해석 상태가 안 남으면 본말전도. |
| 4 | `history_visible=False` 프로그램(`program_registry.internal_substep_programs()`)은 **알리지 않는다** | ModelBuilder solve 등 내부 단계 레코드는 사용자가 이력에서도 못 보는 항목이라 알림이 소음이 된다. |
| 5 | 서버 재시작으로 `Interrupted` 가 된 작업은 **알리지 않는다**(비목표) | `main.py:108-115` 가 raw UPDATE 로 처리해 `_write_through` 를 안 거친다. 취소(`job.cancelled`)는 Plan D 가 `notify()` 를 직접 부른다. |
| 6 | **링크 대상은 항상 `My Projects` 상세 모달**(`link={"menu":"My Projects","params":{"analysis_id":…}}`) | 프로그램 종류와 무관하게 결과·다운로드가 있는 유일한 공용 화면. 앱 화면으로 되돌리는 `RESUME_ENTRY_KEY` 경로는 sessionStorage 의 Job Center 기록이 살아 있을 때만 의미가 있어 알림(영속)과 맞지 않는다. |
| 7 | Dashboard→MyProjects 의 **`sessionStorage('workbench:open-project-detail')` 패턴을 그대로 재사용**하고, 같은 화면에 이미 있을 때를 위해 같은 이름의 `window` 이벤트를 하나 추가 | `Dashboard.jsx:1416-1425` / `MyProjects.jsx:673-685` 기존 계약. `setCurrentMenu` 는 같은 메뉴면 no-op(`NavigationContext.jsx:18`)이라 마운트 effect 가 다시 돌지 않는 구멍만 메운다. |
| 8 | 데스크톱 토스트는 **렌더러 `new Notification()`**, IPC 채널 추가 없음. 앱 창이 포커스를 잃었을 때만 띄우고 인앱 토스트는 항상 | 마스터 §2.1. `preload.js` 화이트리스트를 늘리지 않는다. Electron 렌더러는 `Notification.permission === 'granted'` 가 기본이며 CSP(`electron/response-security.js:2-6`)는 Notification API 와 무관하다. Windows 토스트가 앱을 식별하려면 main 에 `app.setAppUserModelId('com.hitess.workbench')`(package.json `build.appId` 와 동일) 1줄이 필요하다. |
| 9 | `dedupe_key` 는 **미읽음 중복 방지**(마스터 규약) + 작업 종료 알림만 **읽음 여부 무관 1회** | 만료 경고처럼 "매일 다시 알리되 안 읽었으면 1건" 과, 작업 종료처럼 "절대 두 번 만들지 않음" 은 다르다. 후자는 `dedupe_unread_only=False` 로 연다. |
| 10 | 보관 90일, `cleanup_service.run_all_cleanup()` 에 `notifications` 키 추가 | 마스터 §2.1. 기존 activity_logs/sessions 정리와 같은 자리·같은 형태. |
| 11 | `user_preferences` 는 **읽기만**(`prefs["notifications"]["muted_kinds"]`, `desktop_toast`). 쓰기 엔드포인트는 Plan E | 마스터 §2.2. 다만 프론트가 Plan E 없이도 `desktop_toast` 를 따르도록 `GET /api/notifications` 응답에 `prefs` 를 실어 준다. |
| 12 | `GUARDED_ROUTES` 에 **등록하지 않는다** | 플랫폼 공통 기능(마스터 §1.8). |
| 13 | 사번 정규화는 하지 않는다(들어온 문자열 `strip()` 만) | `Analysis.employee_id` 와 `require_auth` 가 돌려주는 값이 이미 같은 표기다. chat 도 같은 방식. |

## 3. 데이터 모델

### 3.1 `notifications` (신규, `app/models.py`)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | Integer PK | 폴링 커서(`since`)로도 쓴다 — 단조 증가 |
| `employee_id` | String(50) NOT NULL, **index** | 수신자 |
| `kind` | String(50) NOT NULL | §4.1 어휘 |
| `title` | String(200) NOT NULL | |
| `body` | String(1000) NOT NULL default '' | 초과분은 서비스에서 자른다 |
| `link` | JSON NULL | `{"menu": str, "params": dict}` |
| `dedupe_key` | String(200) NULL, **index** | |
| `read_at` | DateTime NULL | NULL = 미읽음 |
| `created_at` | DateTime default now, **index** | naive `datetime.now()` — chat/presence 와 동일 |

### 3.2 `user_preferences` (신규, §2.2 정의 그대로 — Plan E 소유, 이 plan 이 생성)

```python
class UserPreference(Base):
    __tablename__ = "user_preferences"
    employee_id = Column(String(50), primary_key=True)
    prefs = Column(JSON, nullable=False, default=dict)
    updated_at = Column(DateTime, nullable=True)
```

Plan E 는 `models.py` 에 `UserPreference` 가 이미 있으면 모델 추가를 건너뛴다(그쪽 plan 에 분기 명시).

### 3.3 스키마 부트스트랩

두 테이블 모두 신규라 `create_all` 로 생기지만, 마스터 §1.3 대로 `schema_bootstrap.ensure_notification_columns()`
를 두고 `run_schema_bootstrap()` 에서 호출한다(전 컬럼 멱등 ADD — 나중에 컬럼이 늘 때 손댈 자리를 미리 만든다).

## 4. 서비스 계약 (`app/services/notification_service.py`)

### 4.1 `notify()` — 마스터 §2.1 그대로 + 옵션 1개

```python
NOTIFICATION_KINDS = frozenset({
    "job.completed", "job.failed", "job.cancelled",
    "retention.expiring", "retention.expired",
    "batch.completed", "share.received",
    "feature_request.status_changed", "notice.published",
})

def notify(db, *, employee_id: str, kind: str, title: str, body: str = "",
           link: dict | None = None, dedupe_key: str | None = None,
           dedupe_unread_only: bool = True) -> models.Notification | None
```

- `kind` 가 어휘 밖이면 `ValueError`(호출자 버그를 조용히 삼키지 않는다).
- `employee_id` 가 비면 `None`. `muted_kinds` 에 든 kind 면 `None`.
- `dedupe_key` 가 있고 같은 (employee_id, dedupe_key) 의 **미읽음** 알림이 있으면 `None`.
  `dedupe_unread_only=False` 면 읽음 여부와 무관하게 1건이면 `None`.
- title/body 는 200/1000 자로 자른다. 성공 시 `commit` 까지 하고 행을 돌려준다.

### 4.2 `notify_job_terminal(db, record, status)` — job_manager 전용 헬퍼

- `status ∉ {"Success","Failed"}` · 소유자 없음 · `history_visible=False` 프로그램 → `None`.
- kind = `job.completed` / `job.failed`, title = `"<display_name> 해석 완료|실패"`
  (display_name = `program_registry.resolve_program(record.program_name).display_name`, 없으면 `program_name`).
- body = 성공: `project_name` → 없으면 `job_message`; 실패: `job_message` → 없으면 `project_name`.
- link = `{"menu": "My Projects", "params": {"analysis_id": record.id, "program_name": record.program_name, "job_id": record.job_id}}`.
- dedupe_key = `f"job:{record.job_id or record.id}:{kind}"`, `dedupe_unread_only=False`.

### 4.3 기타

- `get_notification_prefs(db, employee_id) -> {"muted_kinds": [...], "desktop_toast": bool}` — `user_preferences` 읽기, 없거나 형식이 틀리면 기본값.
- `serialize_notification(row) -> dict`.
- `prune_notifications(db, retention_days=90) -> int`.
- 다른 plan 의 호출 규약(마스터): `try: from app.services.notification_service import notify except ImportError: notify = None`.

## 5. 발신 훅

### 5.1 `job_manager._write_through` (`app/services/job_manager.py:110-138`)

`db.commit()`(현재 135행) 직후, `status in ("Success", "Failed")` 이면 `_notify_job_terminal(db, record, status)`.
헬퍼는 지연 import + 자체 try/except(`db.rollback()` + `logger.warning`) 로 감싼다. `_write_through` 의 바깥 `except`
가 알림 예외를 잡으면 이미 commit 된 상태에는 영향이 없지만, 명시적으로 분리해 의도를 남긴다.

### 5.2 `cleanup_service` (`app/services/cleanup_service.py:272-278`)

`run_notification_cleanup(dry_run)` 을 `run_session_cleanup` 아래에 추가하고 `run_all_cleanup()` 반환 dict 에
`"notifications"` 키를 더한다. 자정 루프·기동 시 1회는 기존 스케줄러가 그대로 돌린다.

## 6. API (`app/routers/notifications.py`, prefix `/api/notifications`, 전부 `require_auth`)

| 메서드·경로 | 요청 | 응답 | 비고 |
|---|---|---|---|
| `GET /api/notifications` | `since?: int(id)`, `limit?: 1..100(기본 50)`, `unread_only?: bool` | `{"items":[…], "unread_count": n, "latest_id": id, "prefs": {...}}` | `since` 가 있으면 `id > since` 만(델타). `unread_count`·`latest_id` 는 항상 전체 기준. 정렬 `id desc`. |
| `POST /api/notifications/read-all` | — | `{"updated": n}` | 내 미읽음 전부 읽음 |
| `POST /api/notifications/{id}/read` | — | `{"ok": true, "id": id}` | 남의 것이면 404(존재 노출 안 함) |
| `DELETE /api/notifications/{id}` | — | `{"ok": true}` | 남의 것이면 404 |

item = `{"id","kind","title","body","link","created_at"(iso),"read_at"(iso|null),"is_read"}`.

`main.py` 의 `include_router` 목록(현재 `reports.router` 가 마지막, 212행) 뒤에 추가. `GUARDED_ROUTES` 미등록.

## 7. 프론트 UI

### 7.1 배치

- **헤더 종 아이콘** — `components/layout/Layout.jsx` 헤더 우측, `networkEvents` 경고 버튼(316~327행) 과
  세로 구분선(328행) 사이. 새 컴포넌트 `components/platform/NotificationCenter.jsx`.
  우하단 `UtilityDock` 은 손대지 않는다(작업 진행 = 도크, 서버가 남긴 통지 = 헤더).
- **미읽음 배지** — 종 아이콘 우상단 빨간 원, `unread_count`(99+ 캡). 미읽음 0 이면 배지 없음.
- **인박스 패널** — 종 버튼 아래 드롭다운(`absolute right-0 top-full`, 폭 `w-[min(384px,calc(100vw-2rem))]`, 최대 높이 `max-h-[min(520px,calc(100vh-6rem))]`, 스크롤).
  머리: "알림" + 미읽음 수 + "모두 읽음" 버튼. 본문: 항목 리스트(kind 별 아이콘·색, 제목, 본문 1줄, 상대 시각, 미읽음 점).
  항목 클릭 = 읽음 처리 + 링크 이동 + 패널 닫기. 항목 우측 휴지통 = 삭제. 빈 상태 문구.
  바깥 클릭·Esc 로 닫힌다. 패널을 열 때 목록을 다시 받는다(`reload`).
- **인앱 토스트** — 새 알림이 폴링으로 들어오면 최신 1건을 `showToast(title, tone, 8000, {onClick: 열기, actionLabel: '열기'})`.
  tone: `job.failed`→`error`, `job.completed`→`success`, 나머지 `info`. 로그인 직후 첫 폴링은 baseline(무음, ChatDock 과 동일).
- **데스크톱 토스트** — `utils/desktopNotification.js`. 조건 = `prefs.desktop_toast` && `!document.hasFocus()` && `Notification.permission === 'granted'`.
  클릭 시 `window.focus()` 후 같은 링크 열기. `tag` 로 같은 알림 중복 표시 방지. 실패는 조용히 무시(인앱 토스트가 이미 떠 있다).

### 7.2 링크 이동 (`openNotificationLink`)

1. `link.params.analysis_id` 가 있으면 `getAnalysisById(id)`(기존 `api/analysis.js:288`) 로 행을 받아
   `sessionStorage['workbench:open-project-detail']` 에 저장(Dashboard 와 같은 payload).
2. `window.dispatchEvent(new CustomEvent('workbench:open-project-detail'))` — 이미 My Projects 화면이면 이 이벤트로 모달이 열린다.
3. `window.dispatchEvent(new CustomEvent('workbench:navigate', {detail:{menu: link.menu}}))` —
   `Layout.jsx:156-163` 의 기존 핸들러가 관리자 게이트까지 그대로 태운다.
4. 403/404(삭제됐거나 권한 없음) 면 `showToast('해석 기록을 찾을 수 없습니다', 'warning')` 만 하고 이동은 한다.

`MyProjects.jsx:673-685` 의 마운트 시 읽기를 `consumePendingProjectDetail()` 로 빼고 같은 이벤트도 듣게 한다(3줄).

### 7.3 폴링 (`hooks/useNotifications.js`)

- `POLLING_POLICY.notificationsIntervalMs = 30000`(`hooks/pollingPolicy.js` 에 추가).
- 첫 호출: `since` 없이 50건 → 전체 목록. 이후: `since=latest_id` 델타를 `mergeNotifications()`(순수 함수, id 내림차순·중복 제거·100건 캡) 로 합친다.
- 창 `visibilitychange`(visible)·`focus` 시 즉시 1회(5초 스로틀).
- 읽음/삭제는 낙관적 갱신 후 API. 실패해도 다음 폴링이 서버 값으로 덮지 않는 항목(읽음 플래그)은 그대로 둔다 — 단일 클라이언트 가정.
- `currentUserId` 가 없으면(비로그인) 폴링하지 않는다. `Layout` 은 `APP_STATE.MAIN` 에서만 렌더되므로 실질적으로 로그인 후에만 돈다.

### 7.4 순수 유틸 (`utils/notificationLink.js`, `node --test` 로 검증)

`resolveNotificationTarget(link)` · `mergeNotifications(prev, fresh)` · `notificationKindMeta(kind)` · `formatNotificationTime(iso, now)`.

## 8. 보관

- DB: 90일(`NOTIFICATION_RETENTION_DAYS`), 자정 정리. 읽음/미읽음 무관.
- 프론트: 메모리 100건 캡, 새로고침 시 서버에서 다시 50건. localStorage/sessionStorage 에 알림을 저장하지 않는다(서버가 원본).

## 9. 테스트 전략

백엔드(pytest, `tests/conftest.py` fixture 재사용 — `db_session`, `admin_client`, `make_user`, `make_analysis`):

| 파일 | 검증 |
|---|---|
| `tests/test_notification_models.py` | 두 테이블이 `create_all` 로 생기고, 컬럼을 뺀 테이블에 `ensure_notification_columns` 가 컬럼을 채운다(멱등) |
| `tests/test_notification_service.py` | kind 검증·빈 사번·muted·dedupe(미읽음/전체)·길이 자르기·`notify_job_terminal` 의 제목/링크/내부단계 스킵·`prune_notifications` |
| `tests/test_job_manager_notify.py` | `database.SessionLocal` 을 sqlite 세션으로 바꾼 뒤 `job_status_store.update_job(Success/Failed/Running)` → 알림 생성 여부, 알림 실패가 상태 저장을 막지 않음 |
| `tests/test_notification_cleanup.py` | `run_notification_cleanup(dry_run)` 카운트/삭제, `run_all_cleanup` 키 |
| `tests/test_notifications_router.py` | 목록/델타/unread_count/prefs, 읽음·모두 읽음·삭제, 타인 404, 미인증 401(실제 `require_auth`) |

프론트(러너 없음): 순수 유틸은 `node --test src/utils/notificationLink.test.js`. 나머지는 plan 의 수동 검증 절차
(npm run dev → 작업 실행 → 종 배지/토스트/링크/데스크톱 토스트).

## 10. 서버(145) 반영 구분

- 백엔드: **`git pull` + 백엔드 재시작으로 끝.** 테이블은 기동 시 `create_all`, 컬럼은 `run_schema_bootstrap`. 신규 pip 의존성 없음.
- 프론트: **재배포 필요**(WorkBench 포터블 exe — 헤더 종 아이콘·폴링). Electron main 도 1줄 바뀌므로 `npm run dist` 전체 빌드.
- InHouse 프로그램: **없음.**

## 11. 비목표

- 알림 설정 UI(음소거·데스크톱 토스트 토글) — Plan E.
- `job.cancelled`·`retention.*`·`batch.*`·`share.*`·`feature_request.*`·`notice.published` 의 **발신** — 각 소유 plan.
- 관리자 브로드캐스트, 이메일/사내 메신저 연동, WebSocket, 알림 페이지(별도 라우트) — 만들지 않는다.
