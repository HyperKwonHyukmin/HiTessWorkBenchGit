# 실시간 접속 사용자 모니터링 — 설계 문서

- 날짜: 2026-07-10
- 대상: HiTESS WorkBench — User Management (관리자) 페이지
- 요구: "현재 접속하여 사용 중인 사용자를 실시간으로 확인"

## 1. 목표 / 비목표

**목표**
- 관리자가 User Management 페이지에서 **지금 앱을 켜고 사용 중인 사용자**를 실시간으로 확인.
- 각 접속자의 **이름·사번, 마지막 활동 경과시간, IP, 현재 보고 있는 페이지**를 표시.
- 기존 사용자 테이블 각 행에 온라인 여부(초록 도트)를 함께 표시.

**비목표**
- WebSocket/SSE 실시간 푸시(과설계). 폴링으로 충분.
- 사용자 강제 로그아웃/세션 종료 기능.
- 접속 이력 장기 저장/분석(활동 로그가 이미 담당).

## 2. 접속 판정 방식 — 하트비트

진짜 "지금 사용 중"을 판정하기 위해 **클라이언트 하트비트** 방식을 채택한다.
- 앱이 열려 있는 동안 클라이언트가 주기적으로 ping → 서버가 `last_seen` 갱신.
- "온라인" = `last_seen`이 임계시간 이내.

대안 비교(채택 안 함):
- *유효 세션 기반*: `user_sessions.expires_at > now`. 구현은 쉬우나 8시간 TTL이라 앱을 닫아도 최대 8시간 "접속 중"으로 오표시 → 부정확.
- *최근 활동 로그 기반*: 가만히 보고만 있는 사용자는 이벤트가 없어 오프라인처럼 보임.

## 3. 데이터 모델 — 신규 `user_presence` 테이블

기존 `user_sessions`에 컬럼을 추가하지 않고 **새 테이블**을 만든다.
- `create_all`은 신규 테이블을 자동 생성하므로 서버 재시작만으로 스키마 반영(수동 ALTER/마이그레이션 불필요).
- presence 관심사를 세션 인증과 분리해 결합도 감소.

```
user_presence
  employee_id  VARCHAR(50)  PK      -- 사용자당 1행 (대문자 정규화된 사번)
  last_seen    DATETIME     index   -- 마지막 하트비트 시각
  last_ip      VARCHAR(50)  null    -- 서버가 관측한 client IP (위조 불가)
  last_page    VARCHAR(200) null    -- 하트비트 시점의 currentMenu(현재 페이지)
```

## 4. 백엔드 API — `routers/presence.py` (신규, prefix `/api/presence`)

| 엔드포인트 | 인증 | 동작 |
|---|---|---|
| `POST /heartbeat` | `require_auth` | body `{ page }` → 현재 사용자 presence 행 upsert (`last_seen=now`, `last_ip=서버 관측 IP`, `last_page=page`). `{ ok: true }` 반환 |
| `GET /online` | `require_admin` | `last_seen >= now - 150s` 행을 `users`와 outerjoin → `{ count, threshold_seconds, items[] }` |

`items[]` 원소: `employee_id, name, department, company, is_admin, last_seen, seconds_ago, last_ip, last_page`.

- IP는 클라이언트가 못 위조하도록 서버 측 `req.client.host`(+`x-forwarded-for` 첫 값) 사용 — 기존 `/api/session/context` 패턴 재사용.
- `POST /api/logout`(auth.py)에서 현재 사용자 presence 행 **삭제** → 즉시 오프라인 처리.
- `main.py`에 라우터 등록. 재시작 시 `user_presence` 자동 생성.

## 5. 프론트엔드 하트비트 — `App.jsx`

- 신규 `api/presence.js`: `sendHeartbeat(page)`, `getOnlineUsers()`.
- `AppInner`에 `useEffect` 추가 (deps `[appState, currentMenu]`):
  - `appState === MAIN`일 때 즉시 1회 + **45초 주기**로 `sendHeartbeat(currentMenu)`.
  - 페이지 이동 시 effect 재실행 → 즉시 하트비트 → "무엇을 사용 중인지"가 실시간 반영.
  - 실패는 조용히 무시(`.catch(()=>{})`, 기존 패턴).

## 6. UI — `UserManagement.jsx`

**(a) 전용 패널** — PageHeader 아래, KPI 위.
- 헤더: 펄스 도트 + "현재 접속 중 N명" + "실시간 · 15초마다 갱신" + 수동 새로고침.
- 접속자 카드 그리드(반응형 1/2/3열): 아바타(초록 상태점), 이름·사번, 소속, **현재 페이지 배지**, "N분 전 활동", IP.
- 0명이면 조용한 빈 상태 문구.
- `getOnlineUsers()`를 **15초 주기 자동 폴링** + 언마운트 시 정리.

**(b) 테이블 도트** — 기존 사용자 테이블 User/ID 열 아바타에 온라인이면 초록 펄스 도트.
- `onlineSet = Set(items.map(u => u.employee_id.toUpperCase()))`로 판정(사번 대문자 정규화 일치).

## 7. 파라미터(기본값)

| 항목 | 값 | 근거 |
|---|---|---|
| 하트비트 주기 | 45s | 실시간감 vs 서버 부하 균형 |
| 온라인 임계 | 150s | 하트비트 1회 누락 허용(45s×3 여유) |
| 관리자 패널 폴링 | 15s | 접속/이탈 반영 지연 최소화 |

## 8. 테스트

`tests/test_presence_router.py` (in-memory SQLite + `admin_client` fixture):
- 하트비트 후 `/online`에 사용자가 뜨고 `last_page`가 반영된다.
- `last_seen`이 임계 초과(오래된)면 `/online`에서 제외된다.
- 하트비트 재호출은 새 행을 만들지 않고 기존 행을 갱신한다(upsert).

## 9. 배포 영향

- 순수 git 추적 백엔드(`models.py`, `presence.py`, `main.py`, `auth.py`) + 프론트엔드. **InHouseProgram 교체 불필요.**
- 서버(145): `git pull` + 백엔드 재시작(→ `user_presence` 자동 생성) + 프론트 재배포. **수동 파일 교체 없음.**
- `config.js`는 수정하지 않음(커밋 제외 규칙 유지).
