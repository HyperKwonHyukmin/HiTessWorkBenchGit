# 사용자 주도 관리자 대화 신청 (User-Initiated Admin Chat)

- 작성일: 2026-07-30
- 상태: 설계 확정 (구현 착수 전)
- 관련 코드: `app/routers/chat.py`, `app/routers/presence.py`, `components/chat/ChatDock.jsx`

## 1. 배경과 문제

현재 WorkBench의 1:1 DM은 **관리자만 대화를 시작할 수 있다.** 사용자는 관리자가 먼저
말을 걸어야만 채팅 도크를 볼 수 있어, 문의 창구가 사실상 없다.

코드를 확인한 결과 **제약은 백엔드가 아니라 UI에만 존재한다.**

| 계층 | 현재 상태 |
|---|---|
| `chat.py:67` `/api/chat/send` | 양측 **모두** 비관리자일 때만 403 → 사용자→관리자 전송은 **이미 허용** |
| `ChatDock.jsx:242` | `shouldShow = isAdmin \|\| threads.length > 0 \|\| totalUnread > 0` → 사용자는 받은 대화가 없으면 도크가 안 보임 |
| `ChatDock.jsx:178-186` | 대화 시작 경로가 `workbench:open-chat` 이벤트뿐이고, 이 이벤트는 User Management 접속자 카드(관리자 전용)에서만 발생 |
| `presence.py:100` `/api/presence/online` | `require_admin` + `last_ip`·`last_page` 포함 → 사용자에게 그대로 열 수 없음 |

즉 필요한 것은 ① 사용자용 **축소 presence 조회 경로** ② ChatDock의 **상대 선택 화면**
두 가지이며, `send`의 인증·인가 규칙은 손대지 않는다.

## 2. 목표 / 비목표

**목표**
- 사용자가 관리자 목록과 각자의 접속 상태(온라인/자리비움/오프라인)를 확인할 수 있다.
- 사용자가 원하는 관리자를 골라 먼저 대화를 시작할 수 있다.
- 관리자가 오프라인이어도 메시지를 남길 수 있고, 관리자는 다음 로그인 시 미읽음으로 받는다.

**비목표 (YAGNI — 이번 범위에서 제외)**
- 관리자별 '문의 받지 않음' 토글
- 온라인 관리자 자동 배정 / 라운드로빈
- 알림음, WebSocket 전환
- 관리자 부재 시 이메일 폴백
- 사용자↔사용자(peer-to-peer) 대화 — `send`의 "양측 중 1명은 관리자" 제약을 유지한다

## 3. 확정된 설계 결정

| 결정 항목 | 선택 | 근거 |
|---|---|---|
| 대화 상대 범위 | **관리자 목록에서 사용자가 선택** | 기존 1:1 정책·`send` 403 규칙을 그대로 유지 → 백엔드 변경 최소 |
| 관리자 오프라인 시 | **오프라인에도 전송 가능** | 메시지가 DB에 남고 관리자 로그인 시 기존 미읽음 토스트(`ChatDock.jsx:114-119`)로 전달되는 경로가 이미 동작. 문의 유실 없음 |
| 상태 세밀도 | **온라인 / 자리비움 / 오프라인 3단계** | presence의 `is_idle`(무입력 180초)을 활용해 사용자가 응답 기대치를 조절 |
| 엔드포인트 배치 | **`GET /api/chat/contacts` 신설 + presence 판정 헬퍼 추출** | "누구에게 말 걸 수 있나" 정책을 `send`와 같은 파일에 두어 드리프트 방지, 임계값 판정은 presence에 한 벌 유지 |

### 기각된 대안

- **기존 `/api/presence/online`을 역할별 분기** (`require_admin` → `require_auth` + 필드 축소):
  같은 URL이 역할에 따라 다른 스키마를 반환하게 되어, 한 번의 실수로 전 직원의 IP·현재
  페이지가 노출된다. `UserManagement.jsx`와 `test_presence_router.py`도 함께 흔들린다.
- **`GET /api/presence/admins` 신설**: 임계값과 같은 파일이라 헬퍼 추출은 불필요하지만,
  "관리자만 노출" 정책이 chat 정책과 두 파일로 흩어져 대화 상대 범위를 바꿀 때 한쪽만
  고칠 위험이 있다.

## 4. 백엔드 설계

### 4.1 `presence.py` — 판정 헬퍼 추출 (행동 보존 리팩터)

```python
def presence_status(row: models.UserPresence | None, now: datetime) -> str:
    """'online' | 'idle' | 'offline' — 기존 상수를 그대로 사용한다."""
```

판정 규칙 (기존 `/online` 로직과 동일):

1. `row` 없음 또는 `last_seen < now - ONLINE_THRESHOLD_SECONDS(150s)` → `offline`
2. `last_active_at or last_seen` 기준 경과 ≥ `IDLE_THRESHOLD_SECONDS(180s)` → `idle`
3. 그 외 → `online`

기존 `/online`의 `is_idle` 계산(`presence.py:129-135`)을 이 헬퍼 호출로 교체한다.
`/online`은 cutoff로 오프라인을 미리 걸러내므로 응답은 달라지지 않는다.

**합격 조건: `tests/test_presence_router.py`가 무수정으로 통과해야 한다.**

### 4.2 `chat.py` — `GET /api/chat/contacts` 신설

| 항목 | 내용 |
|---|---|
| 인증 | `require_auth` — 로그인한 모든 사용자 |
| 대상 | `is_admin=True` **AND** `is_active=True`, **호출자 본인 제외** |
| 정렬 | `online` → `idle` → `offline`, 동순위는 이름순 |
| 관리자 부재 | `{"items": []}` — 프론트에서 안내 문구 |

응답 스키마 (필드 화이트리스트):

```json
{
  "items": [
    {
      "employee_id": "12345",
      "name": "홍길동",
      "department": "구조해석팀",
      "status": "online",
      "is_admin": true
    }
  ]
}
```

**이 5개 필드만 반환한다.** `last_ip`·`last_page`·`app_version`은 물론
**오프라인 관리자의 `last_seen`도 포함하지 않는다** — "그 관리자가 몇 시에 퇴근했는지"를
전 직원이 조회하는 근태 추적 창구가 되지 않도록, 상태는 3단계 라벨로만 노출한다.

관리자가 호출해도 동일 응답이다(`send`가 관리자↔관리자를 이미 허용하므로 일관).
기존 User Management의 '대화' 버튼 경로는 그대로 유지한다.

### 4.3 `/api/chat/send` — 변경 없음

이미 사용자→관리자를 허용한다. 검증된 403 규칙에 회귀를 만들 이유가 없다.

### 4.4 백엔드 테스트 (TDD, `tests/test_chat_router.py`)

- 일반 사용자 호출 → 200, 활성 관리자만 포함, 호출자 본인 제외
- **응답에 `last_ip` / `last_page` / `app_version` / `last_seen` 키가 없음** (누출 회귀 방지)
- presence 행 없음 → `offline`
- 최근 하트비트 → `online`
- `last_active_at`이 180초 초과 → `idle`
- `is_active=False` 관리자 제외
- 미인증 → 401
- **정합성 계약: `contacts`가 반환한 상대에게 `send`하면 반드시 200** — 목록과 전송 정책이
  어긋나 "보이지만 못 보내는" 상대가 생기는 것을 막는다

## 5. 프론트엔드 설계

### 5.1 도크 상시 노출

- `ChatDock.jsx:242` `shouldShow` → 로그인 상태면 항상 `true`
- `UtilityDock.jsx:140` `useState(isAdmin)` → 초기값을 함께 맞춘다

진입점이 없으면 사용자가 대화를 시작할 방법 자체가 없으므로 이 변경이 기능의 전제다.

### 5.2 화면 3단 구조와 컴포넌트 분리

현재는 `activeOther ? 대화 : 목록` 2단이다. 여기에 상대 선택 화면이 추가되므로
`view` 상태(`'threads' | 'contacts' | 'conversation'`)로 분기를 명시화한다.

ChatDock은 이미 468줄이라 새 화면을 인라인으로 넣으면 600줄에 가까워진다. 상대 선택
화면은 `components/chat/ContactPicker.jsx`로 분리하되, **자체 폴링을 갖지 않는 표현
컴포넌트**(입력 `items`·`onPick`)로 두어 ChatDock이 데이터 흐름을 단독 소유하게 한다.

### 5.3 진입점과 상태 표시

- 대화 목록 헤더에 `＋`(새 대화) 버튼 — 관리자·사용자 공통
- 빈 목록 문구(`ChatDock.jsx:384-386`)를 "관리자에게 문의하기" 버튼으로 교체
- 상태 표시: 🟢 온라인 / 🟡 자리비움 / ⚪ 오프라인 — **색과 텍스트 라벨을 함께** 표시
  (색만으로 정보를 전달하지 않는다 — `PRODUCT.md` 접근성 기준)
- 오프라인 관리자도 클릭 가능하며, 대화창 상단에 "현재 부재중입니다 — 접속 후
  확인합니다" 배너를 표시한다
- 대화창 헤더에도 같은 상태 점을 표시한다. 상태의 출처는 **contacts 응답 하나뿐**이므로,
  상대가 contacts에 없으면(예: 관리자가 일반 사용자와의 대화를 열었을 때) 상태 점과
  배너를 모두 생략한다. `idle`에는 배너를 띄우지 않고 점·라벨로만 표시한다

### 5.4 폴링 정책 (유일한 실질 리스크)

threads 폴링이 이미 전 사용자 5초 주기로 돌고 있어, contacts를 같은 주기로 얹으면
상시 부하가 2배가 된다. 따라서 조건부 폴링으로 제한한다.

| 상태 | contacts 폴링 |
|---|---|
| 도크 접힘 / 대화 목록 화면 | 하지 않음 |
| 상대 선택 화면 · 대화 화면 | 진입 시 즉시 1회 + **20초 주기** |

**설계상 한계(의도된 것):** 접힌 도크에는 관리자 접속 여부가 표시되지 않는다. 뱃지는
미읽음 전용으로 남는다. 문의하려고 도크를 여는 순간 최신 상태를 받으므로 실사용은
충족되며, 전 사용자 상시 폴링(사용자 수 비례 부하)을 피한다.

### 5.5 프론트엔드 테스트

컴포넌트 테스트 관례가 없고 `src/utils/*.test.js`(순수 함수)만 존재하므로, 판정·정렬
로직을 `src/utils/chatContacts.js`로 분리해 테스트한다.

- `sortContacts(items)` — online → idle → offline, 동순위 이름순
- `statusLabel(status)` — 한국어 라벨
- `statusDotClass(status)` — 색상 클래스

렌더링은 `npm run build` 통과로 확인한다.

## 6. 데이터 흐름

```
[사용자] 도크 열기
   → GET /api/chat/threads      (기존, 5초 주기)
[사용자] ＋ 새 대화
   → GET /api/chat/contacts     (신규, 진입 시 1회 + 20초 주기)
       └ User(is_admin, is_active) ⨝ UserPresence → presence_status()
[사용자] 관리자 선택
   → GET /api/chat/conversation/{admin_id}   (기존)
[사용자] 메시지 전송
   → POST /api/chat/send        (기존, 변경 없음)
[관리자] 다음 폴링/로그인
   → /threads 의 unread 증가 → 토스트 + 도크 자동 펼침 (기존 동작)
```

## 7. 오류 처리

- `contacts` 조회 실패 → 기존 폴링 관례대로 조용히 무시하고 다음 주기에 재시도
  (`ChatDock.jsx`의 `catch {}` 패턴과 일치). 최초 진입 실패 시에만 "목록을 불러올 수
  없습니다" 표시
- 관리자 0명 → "현재 등록된 관리자가 없습니다" 안내
- `send` 실패 → 기존 토스트 경로 유지(`ChatDock.jsx:204-207`)
- 사용자가 대화 도중 상대의 관리자 권한이 해제된 경우 → `send`가 403을 반환하고 기존
  토스트로 사유가 노출된다(추가 처리 없음)

## 8. 배포 (CLAUDE.md 보고 의무)

변경 파일은 **모두 git 추적 대상**이다.

- 서버(145): **`git pull` + 백엔드 재시작 + 프론트 재배포**로 완결
- **InHouse exe 수동 교체 불필요** (`InHouseProgram/` 무관)
- **StudioProgram zip 불필요** (스튜디오 뷰어 무관)
- **DB 마이그레이션 불필요** — `user_presence`·`chat_messages` 스키마 변경 없음

## 9. 변경 파일 목록

**백엔드**
- `HiTessWorkBenchBackEnd/app/routers/presence.py` — `presence_status()` 추출 + `/online` 적용
- `HiTessWorkBenchBackEnd/app/routers/chat.py` — `GET /contacts` 신설
- `HiTessWorkBenchBackEnd/tests/test_chat_router.py` — contacts 테스트 추가

**프론트엔드**
- `HiTessWorkBench/frontend/src/api/chat.js` — `getChatContacts()` 추가
- `HiTessWorkBench/frontend/src/utils/chatContacts.js` — 신규 (순수 함수)
- `HiTessWorkBench/frontend/src/utils/chatContacts.test.js` — 신규
- `HiTessWorkBench/frontend/src/components/chat/ContactPicker.jsx` — 신규
- `HiTessWorkBench/frontend/src/components/chat/ChatDock.jsx` — 3단 view, 상시 노출, 조건부 폴링
- `HiTessWorkBench/frontend/src/components/platform/UtilityDock.jsx` — `chatAvailable` 초기값

**커밋 제외:** `frontend/src/config.js` (로컬 전용 백엔드 URL 토글)
