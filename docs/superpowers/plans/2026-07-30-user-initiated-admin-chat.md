# 사용자 주도 관리자 대화 신청 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 메시지 패널을 열면 등록된 활성 관리자 전원의 접속 상황(온라인/자리비움/오프라인)을 보고 원하는 관리자에게 먼저 대화를 걸 수 있게 한다.

**Architecture:** 백엔드는 `presence.py`의 온라인 판정을 `presence_status()` 헬퍼로 뽑고, `chat.py`에 필드 화이트리스트 방식의 `GET /api/chat/contacts`를 신설한다(`/api/chat/send`는 이미 사용자→관리자를 허용하므로 무변경). 프론트엔드는 ChatDock 목록 화면을 '관리자 로스터 + 기타 대화' 통합 목록으로 바꾸고, 병합·정렬 로직은 순수 함수로 분리해 테스트한다.

**Tech Stack:** FastAPI + SQLAlchemy + pytest(인메모리 SQLite) / React 18 + Vite + `node:test`(순수 함수만)

**설계 스펙:** `docs/superpowers/specs/2026-07-30-user-initiated-admin-chat-design.md`

---

## 사전 지식 (이 코드베이스를 처음 보는 사람을 위해)

**백엔드 실행·테스트** — 작업 디렉터리 `C:\Coding\WorkBench\HiTessWorkBenchBackEnd`

```bash
./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_chat_router.py -q
```

- 테스트는 인메모리 SQLite + `app.dependency_overrides`로 동작한다(`tests/conftest.py`).
- `admin_client` fixture는 `require_auth`와 `require_admin`을 **둘 다** `"ADMIN001"`로 고정하고,
  `ADMIN001`(name=`관리자`, is_admin=True) 행을 시드한다.
- `test_chat_router.py:12` 의 `_act_as(employee_id)`는 `require_auth` override만 갈아끼워
  '다른 사용자 시점'을 만든다. DB override는 유지되므로 같은 세션을 계속 쓴다.
- ⚠️ `admin_client`가 `require_auth`를 항상 덮어쓰므로 **미인증(401) 테스트는 이 인프라로
  작성할 수 없다.** 인증은 `require_auth` 의존성이 보장하며, 기존 라우터 테스트들도 401을
  검증하지 않는다. 이 계획도 401 테스트를 만들지 않는다.

**프론트엔드 실행·테스트** — 작업 디렉터리 `C:\Coding\WorkBench\HiTessWorkBench\frontend`

```bash
node --test src/utils/chatContacts.test.js     # 순수 함수 테스트 (vitest 아님, node:test)
npm run build                                  # 렌더링/임포트 검증
```

- 프론트엔드에는 **컴포넌트 테스트 관례가 없다.** `src/utils/*.test.js`(순수 함수)만 존재하며
  `node:test` + `node:assert/strict`를 쓴다(`src/utils/modelRegistryUtils.test.js` 참고).

**커밋 금지 파일**

- `HiTessWorkBench/frontend/src/config.js` — 개발자 로컬 백엔드 URL 토글. **절대 스테이징하지 말 것.**
- `git status`에 이미 `Figure/*.png`, `Darkmode.js/` 등 무관한 변경이 있다. **각 커밋에서 해당
  태스크의 파일만 명시적으로 `git add`** 한다(`git add -A` 금지).

---

## File Structure

| 파일 | 책임 |
|---|---|
| `app/routers/presence.py` (수정) | 하트비트 수집 + 접속 판정. **판정 규칙의 단일 소유자** — `presence_status()`를 export |
| `app/routers/chat.py` (수정) | DM 전송·조회 + **대화 가능 상대 목록**. "누구에게 말 걸 수 있나" 정책을 `send`의 403 규칙과 한 파일에 둔다 |
| `tests/conftest.py` (수정) | `make_user`에 `is_admin`/`is_active` 파라미터 추가 |
| `tests/test_chat_router.py` (수정) | contacts 계약 테스트 |
| `tests/test_presence_router.py` (수정) | `presence_status()` 단위 테스트 |
| `src/utils/chatContacts.js` (신규) | 순수 함수: contacts+threads 병합, 정렬, 상태 라벨/색, 시각 포맷 |
| `src/utils/chatContacts.test.js` (신규) | 위 함수들의 테스트 |
| `src/components/chat/ChatRosterList.jsx` (신규) | 목록 화면 **표현 전용** 컴포넌트(자체 조회·폴링 없음) |
| `src/components/chat/ChatDock.jsx` (수정) | 데이터 소유: threads·contacts 폴링, 대화창, 토스트 |
| `src/components/platform/UtilityDock.jsx` (수정) | '메시지' 버튼 상시 노출 초기값 |
| `src/api/chat.js` (수정) | `getChatContacts()` 추가 |
| `CLAUDE.md` (수정) | 라우터 표의 chat 행 갱신 |

---

## Task 1: `presence_status()` 헬퍼 추출 (행동 보존 리팩터)

**Files:**
- Modify: `HiTessWorkBenchBackEnd/app/routers/presence.py` (헬퍼 추가 + `get_online_users` 내부 적용, 현재 `presence.py:129-135`)
- Test: `HiTessWorkBenchBackEnd/tests/test_presence_router.py` (파일 끝에 추가)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/test_presence_router.py` 맨 끝에 추가:

```python
def test_presence_status_classifies_online_idle_offline():
    """presence_status 는 하트비트/유휴 경과로 세 상태를 구분한다."""
    from app.routers.presence import presence_status

    now = datetime.now()
    fresh = models.UserPresence(employee_id="A", last_seen=now, last_active_at=now)
    idle = models.UserPresence(
        employee_id="B", last_seen=now, last_active_at=now - timedelta(seconds=300),
    )
    stale = models.UserPresence(employee_id="C", last_seen=now - timedelta(seconds=600))

    assert presence_status(fresh, now) == "online"
    assert presence_status(idle, now) == "idle"
    assert presence_status(stale, now) == "offline"
    assert presence_status(None, now) == "offline"


def test_presence_status_falls_back_to_last_seen_without_last_active_at():
    """last_active_at 이 없는 구 행은 last_seen 을 활동 기준으로 사용한다."""
    from app.routers.presence import presence_status

    now = datetime.now()
    row = models.UserPresence(employee_id="A", last_seen=now, last_active_at=None)
    assert presence_status(row, now) == "online"
```

- [ ] **Step 2: 실패를 확인한다**

Run (`HiTessWorkBenchBackEnd/`에서):
```bash
./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_presence_router.py -q -k presence_status
```
Expected: FAIL — `ImportError: cannot import name 'presence_status'`

- [ ] **Step 3: 헬퍼를 구현한다**

`presence.py`의 `_client_ip()` 정의 **바로 위**(현재 `presence.py:42` 앞)에 추가:

```python
def presence_status(row: Optional[models.UserPresence], now: datetime) -> str:
    """접속 상태를 'online' | 'idle' | 'offline' 로 분류한다.

    임계값 판정을 이 함수 하나로 모아, /online 과 chat 의 대화 상대 목록이 서로 다른
    기준으로 온라인을 판정하는 드리프트를 막는다.
    """
    if row is None or row.last_seen is None:
        return "offline"
    if (now - row.last_seen).total_seconds() > ONLINE_THRESHOLD_SECONDS:
        return "offline"
    # 앱은 켜져 있으나 마지막 상호작용이 오래됐으면 '자리비움'.
    active_ref = row.last_active_at or row.last_seen
    if (now - active_ref).total_seconds() >= IDLE_THRESHOLD_SECONDS:
        return "idle"
    return "online"
```

- [ ] **Step 4: 테스트 통과를 확인한다**

Run:
```bash
./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_presence_router.py -q -k presence_status
```
Expected: PASS (2 passed)

- [ ] **Step 5: `/online`이 헬퍼를 쓰도록 바꾼다**

`presence.py` `get_online_users()` 안에서 아래 한 줄을

```python
        is_idle = bool(idle_seconds is not None and idle_seconds >= IDLE_THRESHOLD_SECONDS)
```

다음으로 교체한다:

```python
        # 유휴 판정은 presence_status 로 단일화한다(/online 은 이미 cutoff 로 오프라인을 걸러냄).
        is_idle = presence_status(presence, now) == "idle"
```

`idle_seconds`는 응답 필드로 계속 쓰이므로 위쪽 계산 코드는 **그대로 둔다**.

- [ ] **Step 6: 기존 presence 테스트가 무수정 통과함을 확인한다 (리팩터 합격 조건)**

Run:
```bash
./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_presence_router.py -q
```
Expected: PASS — 기존 11개 + 신규 2개 = 13 passed

- [ ] **Step 7: 커밋**

```bash
git add HiTessWorkBenchBackEnd/app/routers/presence.py HiTessWorkBenchBackEnd/tests/test_presence_router.py
git commit -m "♻️ refactor: 접속 상태 판정을 presence_status() 헬퍼로 추출

/online 의 유휴 판정을 헬퍼로 단일화해, 곧 추가되는 chat 대화 상대
목록이 같은 임계값(150초/180초)을 재사용하도록 준비한다. 응답은
달라지지 않으며 기존 presence 테스트가 무수정 통과한다."
```

---

## Task 2: `GET /api/chat/contacts` — 활성 관리자 목록

**Files:**
- Modify: `HiTessWorkBenchBackEnd/tests/conftest.py:125-136` (`make_user`에 `is_admin`/`is_active` 추가)
- Modify: `HiTessWorkBenchBackEnd/app/routers/chat.py` (엔드포인트 추가)
- Test: `HiTessWorkBenchBackEnd/tests/test_chat_router.py` (파일 끝에 추가)

- [ ] **Step 1: `make_user` fixture에 관리자·비활성 옵션을 추가한다**

`tests/conftest.py`의 `make_user`를 아래로 교체한다(기본값이 기존 동작과 동일하므로 기존 호출부는 영향받지 않는다):

```python
@pytest.fixture()
def make_user(db_session):
    """User 행 생성 헬퍼."""
    def _make(employee_id, name="홍길동", department="구조해석팀", is_developer=False,
              is_admin=False, is_active=True):
        u = models.User(
            employee_id=employee_id, name=name, company="HHI",
            department=department, is_active=is_active, is_admin=is_admin,
            is_developer=is_developer,
        )
        db_session.add(u)
        db_session.commit()
        return u
    return _make
```

- [ ] **Step 2: fixture 변경이 기존 테스트를 깨지 않았는지 확인한다**

Run:
```bash
./WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
Expected: 변경 전과 동일한 결과. ⚠️ 이 저장소에는 **Task와 무관한 기존 실패 2건**이 있을 수
있다(과거 세션에서 baseline으로 확인됨). 실패 목록을 이 시점에 기록해 두고, 이후 단계에서
같은 목록이 유지되는지만 비교한다.

- [ ] **Step 3: 실패하는 테스트를 쓴다**

`tests/test_chat_router.py` 맨 끝에 추가:

```python
def test_contacts_lists_active_admins_excluding_self(admin_client, make_user):
    """사용자는 활성 관리자 전원을 대화 상대로 받는다(일반 사용자·본인은 제외)."""
    make_user("ADMIN002", name="김철수", is_admin=True)
    make_user("USER001", name="홍길동")

    _act_as("USER001")
    r = admin_client.get("/api/chat/contacts")
    assert r.status_code == 200
    ids = [i["employee_id"] for i in r.json()["items"]]
    assert set(ids) == {"ADMIN001", "ADMIN002"}
    assert "USER001" not in ids


def test_contacts_excludes_caller_when_caller_is_admin(admin_client, make_user):
    """관리자가 호출하면 자신은 목록에서 빠지고 다른 관리자만 남는다."""
    make_user("ADMIN002", name="김철수", is_admin=True)

    items = admin_client.get("/api/chat/contacts").json()["items"]
    assert [i["employee_id"] for i in items] == ["ADMIN002"]


def test_contacts_excludes_inactive_admin(admin_client, make_user):
    """승인되지 않은(is_active=False) 관리자는 노출하지 않는다."""
    make_user("ADMIN003", name="이영희", is_admin=True, is_active=False)
    make_user("USER001")

    _act_as("USER001")
    items = admin_client.get("/api/chat/contacts").json()["items"]
    assert [i["employee_id"] for i in items] == ["ADMIN001"]


def test_contacts_returns_empty_list_when_no_other_admin(admin_client):
    """대화 가능한 관리자가 없으면 빈 배열을 반환한다(프론트가 안내 문구를 띄운다)."""
    assert admin_client.get("/api/chat/contacts").json()["items"] == []


def test_contacts_includes_name_and_department(admin_client, make_user):
    """행 표시에 필요한 이름·부서가 함께 내려온다."""
    make_user("USER001")

    _act_as("USER001")
    item = admin_client.get("/api/chat/contacts").json()["items"][0]
    assert item["employee_id"] == "ADMIN001"
    assert item["name"] == "관리자"
    assert item["is_admin"] is True
    # conftest 의 ADMIN001 은 department 를 지정하지 않으므로 None 이다.
    assert "department" in item
```

- [ ] **Step 4: 실패를 확인한다**

Run:
```bash
./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_chat_router.py -q -k contacts
```
Expected: FAIL — 5 failed, `assert 404 == 200` (라우트 없음)

- [ ] **Step 5: 엔드포인트를 구현한다**

`chat.py` 상단 import 블록에 presence 헬퍼를 추가한다:

```python
from .. import database, models
from ..dependencies import require_auth
from .presence import presence_status
```

그리고 `send_message()` **아래**, `_serialize()` **위**에 추가한다:

```python
# 목록 정렬 우선순위 — 지금 응답 가능한 사람이 위로 온다.
_STATUS_ORDER = {"online": 0, "idle": 1, "offline": 2}


@router.get("/contacts")
def get_contacts(
    db: Session = Depends(database.get_db),
    me: str = Depends(require_auth),
):
    """대화를 걸 수 있는 상대(활성 관리자) 목록 + 접속 상태.

    send 의 '양측 중 1명은 관리자' 규칙과 짝을 이루는 목록이라 같은 파일에 둔다.
    응답 필드는 화이트리스트로 최소화한다 — last_ip / last_page / app_version 은 물론
    last_seen(마지막 접속 시각)도 넣지 않는다. 전 직원이 관리자의 근태를 조회하는
    창구가 되면 안 되므로 상태는 3단계 라벨로만 노출한다.
    """
    now = datetime.now()
    rows = (
        db.query(models.User, models.UserPresence)
        .outerjoin(
            models.UserPresence,
            models.User.employee_id == models.UserPresence.employee_id,
        )
        .filter(
            models.User.is_admin.is_(True),
            models.User.is_active.is_(True),
            models.User.employee_id != me,
        )
        .all()
    )

    items = [
        {
            "employee_id": user.employee_id,
            "name": user.name,
            "department": user.department,
            "status": presence_status(presence, now),
            "is_admin": True,
        }
        for user, presence in rows
    ]
    items.sort(
        key=lambda x: (
            _STATUS_ORDER.get(x["status"], 3),
            x["name"] or x["employee_id"],
        )
    )
    return {"items": items}
```

- [ ] **Step 6: 테스트 통과를 확인한다**

Run:
```bash
./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_chat_router.py -q
```
Expected: PASS — 기존 11개 + 신규 5개 = 16 passed

- [ ] **Step 7: 커밋**

```bash
git add HiTessWorkBenchBackEnd/app/routers/chat.py HiTessWorkBenchBackEnd/tests/test_chat_router.py HiTessWorkBenchBackEnd/tests/conftest.py
git commit -m "✨ feat: GET /api/chat/contacts — 대화 가능한 활성 관리자 목록

사용자가 먼저 대화를 걸 수 있도록 활성 관리자 목록과 접속 상태를
내려준다. 응답 필드는 화이트리스트로 최소화해 IP·마지막 페이지·마지막
접속 시각이 사용자 경로로 새지 않게 했다. send 의 403 규칙과 같은
파일에 둬 '대화 가능 상대' 정책이 갈라지지 않게 한다."
```

---

## Task 3: 상태 판정·정렬·정보 누출·전송 정합성 계약

**Files:**
- Test: `HiTessWorkBenchBackEnd/tests/test_chat_router.py` (파일 끝에 추가)

이 태스크는 **테스트만 추가**한다. Task 2의 구현이 이미 만족해야 하며, 실패하면 구현을 고친다.

- [ ] **Step 1: import를 보강한다**

`tests/test_chat_router.py` 상단을 다음으로 교체한다:

```python
from datetime import datetime, timedelta

from app import models
from app.dependencies import require_auth
from app.main import app
```

- [ ] **Step 2: 상태 판정 테스트를 쓴다**

파일 끝에 추가:

```python
def test_contacts_status_reflects_presence(admin_client, make_user, db_session):
    """하트비트 유무와 유휴 경과에 따라 online / idle / offline 이 구분된다."""
    make_user("ADMIN_ON", name="가온라인", is_admin=True)
    make_user("ADMIN_IDLE", name="나유휴", is_admin=True)
    make_user("ADMIN_OFF", name="다오프", is_admin=True)
    make_user("USER001")

    now = datetime.now()
    db_session.add_all([
        models.UserPresence(employee_id="ADMIN_ON", last_seen=now, last_active_at=now),
        models.UserPresence(
            employee_id="ADMIN_IDLE", last_seen=now,
            last_active_at=now - timedelta(seconds=300),
        ),
        models.UserPresence(
            employee_id="ADMIN_OFF", last_seen=now - timedelta(seconds=600),
        ),
    ])
    db_session.commit()

    _act_as("USER001")
    items = admin_client.get("/api/chat/contacts").json()["items"]
    status = {i["employee_id"]: i["status"] for i in items}
    assert status["ADMIN_ON"] == "online"
    assert status["ADMIN_IDLE"] == "idle"
    assert status["ADMIN_OFF"] == "offline"
    assert status["ADMIN001"] == "offline"  # presence 행이 아예 없는 경우


def test_contacts_sorted_online_then_idle_then_offline(admin_client, make_user, db_session):
    """지금 응답 가능한 관리자가 목록 위로 온다."""
    make_user("ADMIN_ON", name="가온라인", is_admin=True)
    make_user("ADMIN_IDLE", name="나유휴", is_admin=True)
    make_user("USER001")

    now = datetime.now()
    db_session.add_all([
        models.UserPresence(employee_id="ADMIN_ON", last_seen=now, last_active_at=now),
        models.UserPresence(
            employee_id="ADMIN_IDLE", last_seen=now,
            last_active_at=now - timedelta(seconds=300),
        ),
    ])
    db_session.commit()

    _act_as("USER001")
    ids = [i["employee_id"] for i in admin_client.get("/api/chat/contacts").json()["items"]]
    # ADMIN001 은 presence 가 없어 offline → 항상 마지막.
    assert ids == ["ADMIN_ON", "ADMIN_IDLE", "ADMIN001"]
```

- [ ] **Step 3: 정보 누출 회귀 테스트를 쓴다**

파일 끝에 추가:

```python
def test_contacts_never_exposes_sensitive_presence_fields(admin_client, make_user, db_session):
    """사용자 경로로 IP·마지막 페이지·앱 버전·마지막 접속 시각이 새지 않는다."""
    make_user("USER001")
    db_session.add(models.UserPresence(
        employee_id="ADMIN001",
        last_seen=datetime.now(),
        last_ip="10.1.2.3",
        last_page="System Settings",
        app_version="1.3.40",
    ))
    db_session.commit()

    _act_as("USER001")
    r = admin_client.get("/api/chat/contacts")
    item = r.json()["items"][0]
    assert set(item.keys()) == {"employee_id", "name", "department", "status", "is_admin"}
    # 값 단위로도 확인 — 필드명을 바꿔 우회하는 회귀까지 잡는다.
    body = r.text
    assert "10.1.2.3" not in body
    assert "System Settings" not in body
    assert "1.3.40" not in body
```

- [ ] **Step 4: 전송 정합성 계약 테스트를 쓴다**

파일 끝에 추가:

```python
def test_contacts_entries_are_all_sendable(admin_client, make_user):
    """contacts 가 준 상대에게는 send 가 반드시 성공한다(목록↔전송 정책 정합성).

    '화면에 보이지만 보내면 403' 인 상대가 생기지 않도록 못박는다.
    """
    make_user("ADMIN002", name="김철수", is_admin=True)
    make_user("USER001")

    _act_as("USER001")
    items = admin_client.get("/api/chat/contacts").json()["items"]
    assert items, "테스트 전제: 대화 가능한 관리자가 최소 1명 있어야 한다"
    for i in items:
        r = admin_client.post(
            "/api/chat/send",
            json={"recipient_id": i["employee_id"], "body": "문의합니다"},
        )
        assert r.status_code == 200, f"{i['employee_id']} 에게 전송 실패"
```

- [ ] **Step 5: 전체 chat 테스트를 돌린다**

Run:
```bash
./WorkBenchEnv/Scripts/python.exe -m pytest tests/test_chat_router.py -q
```
Expected: PASS — 20 passed. 실패하면 **테스트가 아니라 Task 2 구현을 고친다**(정렬 키, 필드
화이트리스트, `me` 제외 조건 순서로 확인).

- [ ] **Step 6: 커밋**

```bash
git add HiTessWorkBenchBackEnd/tests/test_chat_router.py
git commit -m "✅ test: contacts 상태 판정·정렬·정보 비노출·전송 정합성 계약 고정

- presence 유무/유휴 경과 → online·idle·offline 분류 검증
- 응답 키 화이트리스트 + IP·페이지·앱버전 값이 본문에 없음을 회귀 테스트
- contacts 가 반환한 상대는 send 가 반드시 200 (보이지만 못 보내는 상대 방지)"
```

---

## Task 4: 프론트엔드 순수 함수 `chatContacts.js`

**Files:**
- Create: `HiTessWorkBench/frontend/src/utils/chatContacts.js`
- Test: `HiTessWorkBench/frontend/src/utils/chatContacts.test.js`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/utils/chatContacts.test.js` 신규 작성:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChatSections,
  formatChatTime,
  sortRoster,
  statusDotClass,
  statusLabel,
} from './chatContacts.js';

const CONTACTS = [
  { employee_id: 'A1', name: '가온라인', department: '구조해석팀', status: 'online' },
  { employee_id: 'A2', name: '나유휴', department: '구조해석팀', status: 'idle' },
  { employee_id: 'A3', name: '다오프', department: '설계지원팀', status: 'offline' },
];

test('buildChatSections 는 대화 이력이 없는 관리자도 로스터에 포함한다', () => {
  const { roster, others } = buildChatSections(CONTACTS, []);
  assert.deepEqual(roster.map((r) => r.other_id), ['A1', 'A2', 'A3']);
  assert.deepEqual(others, []);
  assert.equal(roster[0].unread, 0);
  assert.equal(roster[0].last_message, '');
});

test('buildChatSections 는 대화 이력을 관리자 행에 병합하고 중복시키지 않는다', () => {
  const threads = [
    { other_id: 'A3', other_name: '다오프', last_message: '확인했습니다', last_at: '2026-07-30T09:00:00', unread: 0 },
  ];
  const { roster, others } = buildChatSections(CONTACTS, threads);
  const a3 = roster.find((r) => r.other_id === 'A3');
  assert.equal(a3.last_message, '확인했습니다');
  assert.equal(a3.last_at, '2026-07-30T09:00:00');
  // 관리자 행이 곧 대화 행 — 기타 대화로 중복 노출되지 않는다.
  assert.deepEqual(others, []);
});

test('buildChatSections 는 로스터에 없는 상대를 기타 대화로 분리한다', () => {
  const threads = [
    { other_id: 'U9', other_name: '일반사용자', last_message: '문의합니다', last_at: '2026-07-30T10:00:00', unread: 1 },
  ];
  const { roster, others } = buildChatSections(CONTACTS, threads);
  assert.deepEqual(roster.map((r) => r.other_id), ['A1', 'A2', 'A3']);
  assert.deepEqual(others.map((o) => o.other_id), ['U9']);
  assert.equal(others[0].name, '일반사용자');
  // 상태 출처가 contacts 뿐이라 알 수 없음 → null (점·라벨을 생략하기 위한 신호)
  assert.equal(others[0].status, null);
});

test('buildChatSections 는 contacts 가 비어도 기존 대화를 잃지 않는다', () => {
  const threads = [
    { other_id: 'A1', other_name: '가온라인', last_message: 'hi', last_at: '2026-07-30T10:00:00', unread: 2 },
  ];
  const { roster, others } = buildChatSections([], threads);
  assert.deepEqual(roster, []);
  assert.deepEqual(others.map((o) => o.other_id), ['A1']);
  assert.equal(others[0].unread, 2);
});

test('buildChatSections 는 인자가 없어도 빈 섹션을 준다', () => {
  assert.deepEqual(buildChatSections(), { roster: [], others: [] });
});

test('sortRoster 는 미읽음 있는 행을 접속 상태보다 먼저 올린다', () => {
  const rows = [
    { other_id: 'A1', name: '가온라인', status: 'online', unread: 0 },
    { other_id: 'A3', name: '다오프', status: 'offline', unread: 3 },
    { other_id: 'A2', name: '나유휴', status: 'idle', unread: 0 },
  ];
  assert.deepEqual(sortRoster(rows).map((r) => r.other_id), ['A3', 'A1', 'A2']);
});

test('sortRoster 는 같은 조건이면 이름순이며 원본을 변경하지 않는다', () => {
  const rows = [
    { other_id: 'B', name: '나나', status: 'online', unread: 0 },
    { other_id: 'A', name: '가가', status: 'online', unread: 0 },
  ];
  const sorted = sortRoster(rows);
  assert.deepEqual(sorted.map((r) => r.other_id), ['A', 'B']);
  assert.deepEqual(rows.map((r) => r.other_id), ['B', 'A']);
});

test('statusLabel 은 한국어 라벨을 주고 알 수 없는 상태는 빈 문자열이다', () => {
  assert.equal(statusLabel('online'), '온라인');
  assert.equal(statusLabel('idle'), '자리비움');
  assert.equal(statusLabel('offline'), '오프라인');
  assert.equal(statusLabel(null), '');
  assert.equal(statusLabel('bogus'), '');
});

test('statusDotClass 는 상태별로 다른 색을 주고 기본값은 회색이다', () => {
  assert.equal(statusDotClass('online'), 'bg-emerald-500');
  assert.equal(statusDotClass('idle'), 'bg-amber-400');
  assert.equal(statusDotClass('offline'), 'bg-slate-300');
  assert.equal(statusDotClass(undefined), 'bg-slate-300');
});

test('formatChatTime 은 빈 값·잘못된 값에 빈 문자열을 준다', () => {
  assert.equal(formatChatTime(null), '');
  assert.equal(formatChatTime(''), '');
  assert.equal(formatChatTime('not-a-date'), '');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run (`HiTessWorkBench/frontend/`에서):
```bash
node --test src/utils/chatContacts.test.js
```
Expected: FAIL — `Cannot find module ... chatContacts.js`

- [ ] **Step 3: 구현한다**

`src/utils/chatContacts.js` 신규 작성:

```js
/**
 * 채팅 도크 목록 화면용 순수 함수 모음.
 *
 * 서버의 두 응답을 화면 구조로 합친다:
 *  - contacts: 대화 가능한 활성 관리자 전원 + 접속 상태 (GET /api/chat/contacts)
 *  - threads : 내가 관여한 대화 이력 (GET /api/chat/threads)
 *
 * 관리자 행이 곧 대화 행이므로 같은 상대가 두 섹션에 중복되지 않는다. contacts 조회가
 * 실패해 빈 배열이 들어와도 threads 만으로 목록이 성립해야 한다(기존 대화가 사라지면 안 됨).
 */

/** 정렬 우선순위 — 지금 응답 가능한 사람이 위로. */
const STATUS_ORDER = { online: 0, idle: 1, offline: 2 };

const STATUS_LABELS = { online: '온라인', idle: '자리비움', offline: '오프라인' };

/** 상태 라벨(한국어). 알 수 없는 값은 아무것도 표시하지 않는다. */
export function statusLabel(status) {
  return STATUS_LABELS[status] || '';
}

/** 상태 점 색상 클래스. 색만으로 정보를 전달하지 않으므로 항상 라벨과 함께 쓴다. */
export function statusDotClass(status) {
  if (status === 'online') return 'bg-emerald-500';
  if (status === 'idle') return 'bg-amber-400';
  return 'bg-slate-300';
}

/** 'HH:MM' 로컬 시각. 빈 값·잘못된 값은 빈 문자열. */
export function formatChatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * 미읽음 있음 → online → idle → offline → 이름순.
 * 답장을 기다리는 대화가 접속 상태 때문에 목록 아래로 묻히지 않게 한다.
 */
export function sortRoster(rows) {
  return [...rows].sort((a, b) => {
    const unreadDiff = (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0);
    if (unreadDiff !== 0) return unreadDiff;
    const statusDiff = (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3);
    if (statusDiff !== 0) return statusDiff;
    return String(a.name || a.other_id).localeCompare(String(b.name || b.other_id), 'ko');
  });
}

/** 목록 화면의 두 섹션(관리자 로스터 / 기타 대화)을 만든다. */
export function buildChatSections(contacts = [], threads = []) {
  const threadById = new Map((threads || []).map((t) => [t.other_id, t]));

  const roster = sortRoster(
    (contacts || []).map((c) => {
      const t = threadById.get(c.employee_id);
      return {
        other_id: c.employee_id,
        name: c.name || c.employee_id,
        department: c.department || '',
        status: c.status || 'offline',
        last_message: t?.last_message || '',
        last_at: t?.last_at || null,
        unread: t?.unread || 0,
      };
    }),
  );

  const rosterIds = new Set(roster.map((r) => r.other_id));
  // threads 는 서버가 최신순으로 정렬해 주므로 순서를 그대로 유지한다.
  const others = (threads || [])
    .filter((t) => !rosterIds.has(t.other_id))
    .map((t) => ({
      other_id: t.other_id,
      name: t.other_name || t.other_id,
      department: '',
      status: null, // 상태 출처는 contacts 뿐 → 점·라벨을 생략하라는 신호
      last_message: t.last_message || '',
      last_at: t.last_at || null,
      unread: t.unread || 0,
    }));

  return { roster, others };
}
```

- [ ] **Step 4: 테스트 통과를 확인한다**

Run:
```bash
node --test src/utils/chatContacts.test.js
```
Expected: PASS — 10 tests passed

- [ ] **Step 5: 커밋**

```bash
git add HiTessWorkBench/frontend/src/utils/chatContacts.js HiTessWorkBench/frontend/src/utils/chatContacts.test.js
git commit -m "✨ feat: 채팅 로스터 병합·정렬 순수 함수 추가

contacts(관리자 전원+상태) 와 threads(대화 이력) 를 한 목록으로 합치는
buildChatSections 와 정렬·라벨 헬퍼. 관리자 행이 곧 대화 행이라 중복이
없고, contacts 조회가 실패해도 threads 만으로 목록이 성립한다."
```

---

## Task 5: `ChatRosterList.jsx` 표현 컴포넌트 + API 함수

**Files:**
- Create: `HiTessWorkBench/frontend/src/components/chat/ChatRosterList.jsx`
- Modify: `HiTessWorkBench/frontend/src/api/chat.js` (함수 추가)

- [ ] **Step 1: API 함수를 추가한다**

`src/api/chat.js` 의 `getChatThreads` **아래**에 추가:

```js
/** 대화 가능한 활성 관리자 목록 + 접속 상태 (패널 열려 있는 동안 폴링) */
export const getChatContacts = () =>
  axios.get(`${API_BASE_URL}/api/chat/contacts`, { headers: getAuthHeaders() });
```

- [ ] **Step 2: 목록 컴포넌트를 만든다**

`src/components/chat/ChatRosterList.jsx` 신규 작성:

```jsx
/**
 * @fileoverview 채팅 도크 목록 화면 — 관리자 로스터 + 기타 대화.
 *
 * 자체 조회·폴링을 하지 않는 표현 전용 컴포넌트다. 데이터는 ChatDock 이 소유하고
 * buildChatSections() 결과를 sections 로 받는다.
 */
import React from 'react';
import { Trash2 } from 'lucide-react';
import { formatChatTime, statusDotClass, statusLabel } from '../../utils/chatContacts';

function Avatar({ name, id }) {
  const label = (name || id || '?').trim().charAt(0).toUpperCase();
  return (
    <div className="h-9 w-9 shrink-0 rounded-xl bg-blue-100 text-blue-700 border border-blue-200 flex items-center justify-center font-bold">
      {label}
    </div>
  );
}

function Row({ row, onPick, onDelete }) {
  // 대화 이력이 없는 관리자에게는 삭제할 대화가 없다 → 삭제 버튼을 숨긴다.
  const hasHistory = !!row.last_at;
  return (
    <div className="group/row flex items-center gap-2 px-3 py-3 hover:bg-slate-50 border-b border-slate-100">
      <button
        type="button"
        onClick={() => onPick(row)}
        className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
      >
        <Avatar name={row.name} id={row.other_id} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-slate-700 truncate">{row.name}</span>
            {row.status && (
              <span className="inline-flex items-center gap-1 shrink-0 text-[10px] text-slate-500">
                <span
                  className={`h-2 w-2 rounded-full ${statusDotClass(row.status)}`}
                  aria-hidden="true"
                />
                {statusLabel(row.status)}
              </span>
            )}
            {hasHistory && (
              <span className="text-[10px] text-slate-400 ml-auto shrink-0">
                {formatChatTime(row.last_at)}
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 truncate">
            {row.last_message || row.department || '대화를 시작해 보세요.'}
          </div>
        </div>
      </button>
      {row.unread > 0 && (
        <span className="min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
          {row.unread}
        </span>
      )}
      {hasHistory && (
        <button
          type="button"
          onClick={() => onDelete(row)}
          className="shrink-0 rounded-lg p-1.5 text-slate-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover/row:opacity-100 cursor-pointer"
          title="대화 삭제"
          aria-label={`${row.name} 대화 삭제`}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div className="px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
      {children}
    </div>
  );
}

export default function ChatRosterList({ sections, onPick, onDelete, error = false }) {
  const { roster, others } = sections;

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      <SectionTitle>관리자</SectionTitle>
      {roster.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-slate-400">
          {error
            ? '관리자 목록을 불러올 수 없습니다. 잠시 후 다시 시도합니다.'
            : '현재 등록된 관리자가 없습니다.'}
        </p>
      ) : (
        roster.map((row) => (
          <Row key={row.other_id} row={row} onPick={onPick} onDelete={onDelete} />
        ))
      )}

      {others.length > 0 && (
        <>
          <SectionTitle>기타 대화</SectionTitle>
          {others.map((row) => (
            <Row key={row.other_id} row={row} onPick={onPick} onDelete={onDelete} />
          ))}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 빌드로 임포트·문법을 검증한다**

Run (`HiTessWorkBench/frontend/`에서):
```bash
npm run build
```
Expected: `built in ...` 성공 메시지. 새 컴포넌트는 아직 아무도 쓰지 않으므로 동작 변화는 없다.

- [ ] **Step 4: 커밋**

```bash
git add HiTessWorkBench/frontend/src/components/chat/ChatRosterList.jsx HiTessWorkBench/frontend/src/api/chat.js
git commit -m "✨ feat: 채팅 목록 화면 컴포넌트(ChatRosterList) + contacts API 함수

관리자 로스터와 기타 대화를 렌더하는 표현 전용 컴포넌트. 상태는 색 점과
한국어 라벨을 함께 표시하고(색 단독 전달 금지), 대화 이력이 없는 관리자
행에는 삭제 버튼을 숨긴다."
```

---

## Task 6: ChatDock 통합 — contacts 폴링 · 로스터 목록 · 상태 배너 · 상시 노출

**Files:**
- Modify: `HiTessWorkBench/frontend/src/components/chat/ChatDock.jsx`

- [ ] **Step 1: 파일 헤더 주석과 import를 갱신한다**

`ChatDock.jsx:1-24`의 헤더 주석과 import를 아래로 교체한다:

```jsx
/**
 * @fileoverview 우하단 상주 채팅 도크 — 관리자↔사용자 1:1 DM.
 *
 * polling 기반(WebSocket 없음).
 *  - /threads   : 5초 주기. 미읽음/최근 메시지 → 새 메시지 토스트·자동 펼침
 *  - /contacts  : 패널이 열려 있는 동안 20초 주기. 활성 관리자 전원 + 접속 상태
 *  - /conversation : 대화를 열면 4초 주기. 자신에게 온 미읽음을 읽음 처리
 *
 * 목록 화면은 '관리자 로스터 + 기타 대화' 통합 목록이다(ChatRosterList). 사용자는 패널을
 * 여는 것만으로 누가 지금 응답 가능한지 보고 먼저 대화를 걸 수 있다.
 *
 * 외부에서 특정 사용자와 대화를 열려면 window 커스텀 이벤트를 발생시킨다:
 *   window.dispatchEvent(new CustomEvent('workbench:open-chat',
 *     { detail: { employeeId, name } }))
 * (User Management 접속자 카드의 '대화' 버튼이 이 방식으로 도크를 연다.)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Send, ChevronLeft, Minus, Trash2 } from 'lucide-react';
import {
  getChatThreads,
  getChatContacts,
  getChatConversation,
  sendChatMessage,
  deleteChatConversation,
} from '../../api/chat';
import ChatRosterList from './ChatRosterList';
import {
  buildChatSections,
  formatChatTime,
  statusDotClass,
  statusLabel,
} from '../../utils/chatContacts';
import { useToast } from '../../contexts/ToastContext';

const THREADS_POLL_MS = 5000;
const CONVERSATION_POLL_MS = 4000;
// 관리자 접속 상태 갱신 주기. 패널이 열려 있는 동안만 돌아 접힘 상태에서는 부하가 없다.
const CONTACTS_POLL_MS = 20000;
```

- [ ] **Step 2: contacts 상태와 폴링을 추가한다**

`const [confirmDelete, setConfirmDelete] = useState(null);` **아래**에 상태를 추가한다:

```jsx
  const [contacts, setContacts] = useState([]);
  const [contactsError, setContactsError] = useState(false);
```

그리고 '열린 대화 폴링' effect **아래**에 새 effect를 추가한다:

```jsx
  // 관리자 로스터 폴링 — 패널이 열려 있는 동안만 돌린다.
  // threads(5초)에 합치지 않는 이유: 합치면 패널을 열지 않은 전 사용자가 5초마다
  // 관리자 명단·접속 상태를 받아 상시 부하가 사용자 수에 비례해 늘어난다.
  useEffect(() => {
    if (!currentUserId || !open) return undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await getChatContacts();
        if (cancelled) return;
        setContacts(res.data.items || []);
        setContactsError(false);
      } catch {
        // 실패해도 threads 로 만든 목록은 유지된다(기존 대화가 사라지면 안 됨).
        if (!cancelled) setContactsError(true);
      }
    };

    poll();
    const timer = setInterval(poll, CONTACTS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [currentUserId, open]);
```

- [ ] **Step 3: 섹션과 상대 상태를 파생시킨다**

`handleConfirmDelete` 정의 **아래**, `shouldShow` 계산 **위**에 추가한다:

```jsx
  const sections = useMemo(() => buildChatSections(contacts, threads), [contacts, threads]);
  // 대화창 헤더·배너용 상태. 출처가 contacts 뿐이라 상대가 관리자가 아니면 null 이다.
  const activeStatus = activeOther
    ? (contacts.find((c) => c.employee_id === activeOther.id)?.status || null)
    : null;
```

- [ ] **Step 4: 도크를 상시 노출로 바꾼다**

`ChatDock.jsx:241-252`의 아래 블록

```jsx
  // 도크 자체를 노출할지: 관리자는 항상, 일반 사용자는 대화가 있을 때만.
  const shouldShow = isAdmin || threads.length > 0 || totalUnread > 0;

  useEffect(() => {
    onUnreadChange?.(totalUnread);
  }, [onUnreadChange, totalUnread]);

  useEffect(() => {
    onAvailabilityChange?.(!!currentUserId && shouldShow);
  }, [currentUserId, onAvailabilityChange, shouldShow]);

  if (!currentUserId || !shouldShow) return null;
```

를 다음으로 교체한다:

```jsx
  // 도크는 로그인한 모든 사용자에게 노출한다 — 사용자가 관리자에게 먼저 문의할 수 있어야
  // 하므로, '받은 대화가 있을 때만' 이라는 기존 조건은 진입점 자체를 없애 버린다.
  useEffect(() => {
    onUnreadChange?.(totalUnread);
  }, [onUnreadChange, totalUnread]);

  useEffect(() => {
    onAvailabilityChange?.(!!currentUserId);
  }, [currentUserId, onAvailabilityChange]);

  if (!currentUserId) return null;
```

`isAdmin` prop은 더 이상 쓰이지 않지만 **호출부 호환을 위해 시그니처에 남겨둔다**(제거하면
UtilityDock 수정이 함께 필요해 태스크 경계가 흐려진다).

- [ ] **Step 5: 대화창 헤더에 상태 점을, 오프라인이면 배너를 붙인다**

헤더의 상대 이름 표시(`ChatDock.jsx:292-294`)

```jsx
            <span className="font-bold text-sm flex-1 truncate">
              {activeOther.name || activeOther.id}
            </span>
```

를 다음으로 교체한다:

```jsx
            <span className="font-bold text-sm truncate">
              {activeOther.name || activeOther.id}
            </span>
            {activeStatus && (
              <span className="inline-flex items-center gap-1 shrink-0 text-[10px] text-white/70">
                <span
                  className={`h-2 w-2 rounded-full ${statusDotClass(activeStatus)}`}
                  aria-hidden="true"
                />
                {statusLabel(activeStatus)}
              </span>
            )}
            <span className="flex-1" />
```

메시지 스크롤 영역(`ChatDock.jsx:329`의 `<div ref={scrollRef} ...>`) **바로 위**에 배너를 추가한다:

```jsx
          {activeStatus === 'offline' && (
            <div className="shrink-0 bg-amber-50 border-b border-amber-200 px-3 py-2 text-[11px] text-amber-800">
              현재 부재중입니다. 메시지는 저장되며 접속 후 확인합니다.
            </div>
          )}
```

- [ ] **Step 6: 목록 화면을 로스터로 교체한다**

`ChatDock.jsx:380-430`의 목록 렌더 블록(`) : (` 이후 `<div className="flex-1 overflow-y-auto bg-white">` 전체)을 다음으로 교체한다:

```jsx
      ) : (
        <ChatRosterList
          sections={sections}
          error={contactsError}
          onPick={(row) => openConversation({ id: row.other_id, name: row.name })}
          onDelete={(row) => setConfirmDelete({ id: row.other_id, name: row.name })}
        />
      )}
```

- [ ] **Step 7: 쓰이지 않게 된 로컬 `formatTime`·`Avatar`를 제거한다**

**이 순서를 지킬 것** — Step 6에서 목록 블록을 교체한 뒤에야 `Avatar`의 마지막 사용처가
사라진다. 먼저 지우면 중간 단계에서 파일이 깨진다.

`ChatDock.jsx:26-44`의 `formatTime` 함수와 `Avatar` 컴포넌트 정의를 **삭제**한다. 시각 포맷은
`formatChatTime`(utils)으로, 아바타는 `ChatRosterList` 내부 정의로 대체된다.

이제 남은 `formatTime` 사용처는 메시지 버블 한 곳뿐이다(`ChatDock.jsx:351` 부근). 다음으로 바꾼다:

```jsx
                      {formatChatTime(m.created_at)}
```

Run: `grep -n "formatTime\|<Avatar" src/components/chat/ChatDock.jsx`
Expected: 출력 없음(모든 참조가 `formatChatTime`으로 교체됨)

- [ ] **Step 8: 빌드로 검증한다**

Run:
```bash
npm run build
```
Expected: 성공. `formatTime`·`Avatar`·`threads.map` 잔여 참조가 있으면 여기서 에러로 잡힌다.

- [ ] **Step 9: 순수 함수 테스트가 여전히 통과함을 확인한다**

Run:
```bash
node --test src/utils/chatContacts.test.js
```
Expected: PASS — 10 tests passed

- [ ] **Step 10: 커밋**

```bash
git add HiTessWorkBench/frontend/src/components/chat/ChatDock.jsx
git commit -m "✨ feat: 채팅 도크를 상시 노출 + 목록을 관리자 로스터로 교체

패널을 열면 활성 관리자 전원의 접속 상태가 보이고 바로 대화를 걸 수
있다. contacts 폴링은 패널이 열려 있는 동안만 20초 주기로 돌려 접힘
상태의 상시 부하를 만들지 않는다. 대화창에는 상대 상태 점과 오프라인
안내 배너를 표시한다."
```

---

## Task 7: '메시지' 버튼 상시 노출 + 문서 갱신

**Files:**
- Modify: `HiTessWorkBench/frontend/src/components/platform/UtilityDock.jsx:140`
- Modify: `CLAUDE.md` (라우터 표의 `routers/chat.py` 행)

- [ ] **Step 1: 버튼 노출 초기값을 바꾼다**

`UtilityDock.jsx:140`의

```jsx
  const [chatAvailable, setChatAvailable] = useState(isAdmin);
```

를 다음으로 교체한다:

```jsx
  // 로그인한 모든 사용자에게 '메시지' 버튼을 노출한다(ChatDock 이 로그인 여부로 최종 확정).
  // UtilityDock 자체가 APP_STATE.MAIN(로그인 상태)에서만 렌더되므로 true 로 시작해도
  // 비로그인 화면에 버튼이 새지 않고, 첫 렌더에 버튼이 깜빡이는 현상도 없다.
  const [chatAvailable, setChatAvailable] = useState(true);
```

- [ ] **Step 2: 빌드로 검증한다**

Run (`HiTessWorkBench/frontend/`에서):
```bash
npm run build
```
Expected: 성공

- [ ] **Step 3: CLAUDE.md 라우터 표를 갱신한다**

`CLAUDE.md`의 아래 행

```markdown
| `routers/chat.py` | `/api/chat` | 관리자↔사용자 1:1 DM (폴링 기반, WebSocket 없음) |
```

을 다음으로 교체한다:

```markdown
| `routers/chat.py` | `/api/chat` | 관리자↔사용자 1:1 DM (폴링 기반, WebSocket 없음). `GET /contacts` 는 대화 가능한 활성 관리자 + 접속 상태(online/idle/offline)를 필드 화이트리스트로 반환 — 사용자가 먼저 대화를 걸 수 있는 진입점 |
```

- [ ] **Step 4: 전체 백엔드 테스트를 돌린다**

Run (`HiTessWorkBenchBackEnd/`에서):
```bash
./WorkBenchEnv/Scripts/python.exe -m pytest tests -q
```
Expected: Task 2 Step 2에서 기록한 baseline 실패 목록과 **동일**. 새로 깨진 테스트는 없어야 한다.

- [ ] **Step 5: 커밋**

```bash
git add HiTessWorkBench/frontend/src/components/platform/UtilityDock.jsx CLAUDE.md
git commit -m "✨ feat: '메시지' 버튼을 모든 로그인 사용자에게 노출 + 문서 갱신

기존에는 관리자이거나 받은 대화가 있을 때만 버튼이 보여 사용자가 먼저
문의할 진입점이 없었다. CLAUDE.md 라우터 표에 GET /api/chat/contacts 를
기록한다."
```

- [ ] **Step 6: `config.js`가 스테이징되지 않았는지 확인한다**

Run:
```bash
git status --short
git log --stat -1
```
Expected: `config.js`가 커밋에 **포함되지 않음**. `Figure/*.png`, `Darkmode.js/`는 unstaged로 남아 있어야 한다.

---

## 완료 후 보고 (사용자에게 반드시 전달)

- **서버(145) 반영: `git pull` + 백엔드 재시작 + 프론트 재배포로 완결.**
- **InHouse 프로그램 수동 교체 불필요** — `InHouseProgram/` 파일 변경 없음.
- **StudioProgram zip 불필요** — 스튜디오 뷰어 무관.
- **DB 마이그레이션 불필요** — `user_presence`·`chat_messages` 스키마 변경 없음.
- 알려진 한계: 도구 바 '메시지' 버튼 자체에는 접속 표시가 없다(뱃지는 미읽음 전용).
  관리자 접속 상황은 패널을 여는 순간부터 20초 주기로 갱신된다.
