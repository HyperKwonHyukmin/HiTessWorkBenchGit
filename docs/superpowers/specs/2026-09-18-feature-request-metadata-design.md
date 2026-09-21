# 기능 요청 승격·게시판 통합 — 설계 (Plan K)

- 작성일: 2026-09-18
- 상위 규약: `docs/superpowers/specs/2026-09-18-platform-feature-program-design.md` §2.11(**이 plan 이 소유**) · §2.1(알림 서비스 — 지연 import 로 발신) · §1(공통 규칙).
- 대상: `HiTessWorkBenchBackEnd/`(FastAPI + MySQL) + `HiTessWorkBench/frontend/`(React). InHouse 프로그램 무관.
- 구현 plan: `docs/superpowers/plans/2026-09-18-feature-request-metadata.md`

## 1. 배경 / 문제

기능 요청(`FeatureRequest`)은 두 화면에서 열린다. 전역은 `Support/UserRequests.jsx`, App 별은
`components/analysis/AppCommunityHub.jsx` 의 "App 게시판" 탭. 두 화면은 각자 목록·작성·상세·추천을
따로 구현했고 상태 어휘·본문 표시 규칙(진입 공지 배너·읽음 확인)마저 다르다 — 한쪽만 고치면
다른 쪽은 그대로 남는다. `admin_comment` 필드가 두 곳에서 같은 이름으로 살아 있어도, 관리자
드롭다운(전역 4개 vs App 게시판 5개)이나 "해결됨" 판별(전역 `Set(['Resolved','Completed','Done','해결 완료'])`)이
서로 어긋난다.

메타데이터는 더 심각하다. 관련 모듈·희망 중요도는 컬럼이 아니라 **본문 앞머리에 삽입된 문자열**이다
(`UserRequests.jsx:70`):

```js
const finalContent = `[관련 모듈: ${formData.module}]\n[희망 중요도: ${formData.priority}]\n\n${formData.content}`;
```

- 관리자가 "모듈별로 몰린 요청" · "긴급만" 필터링을 서버에서 걸 방법이 없다. 프론트가 클라이언트 검색으로만 처리한다.
- AppCommunityHub 는 이 접두를 애초에 붙이지 않으므로 App 게시판에서 올린 글은 모듈·중요도가 아예 없다.
- 미리보기에서 접두를 감추려고 `stripMetaPreview()` 정규식이 카드/리스트 곳곳에 흩어져 있다.

이 plan 은 `module` · `priority` 를 컬럼으로 승격하고, 두 화면이 공유하는 `FeatureRequestBoard`
컴포넌트를 뽑아 UI 를 하나로 만든다. 관리자가 상태를 바꾸면 §2.1 `notify()` 로 작성자에게 통지한다.

## 2. 확정 결정

| # | 결정 | 이유 |
|---|---|---|
| 1 | `status` 어휘를 4개로 고정: `Under Review` · `Planned` · `In Progress` · `Resolved` | 마스터 §2.11. AppCommunityHub 의 5번째 값 `Completed` 는 삭제, 전역 `resolvedStatuses` 도 단일화. |
| 2 | 마이그레이션: `schema_bootstrap.ensure_feature_request_columns()` 가 컬럼 추가 후, `module/priority` 가 NULL 인 행마다 본문 앞머리를 파싱해 컬럼으로 옮기고 본문에서 그 줄을 제거. **멱등** — 두 번째 실행은 파싱 결과가 빈 매치라 no-op | Alembic 이 없어 부트스트랩이 유일한 마이그레이션 창구. sentinel 플래그를 따로 두지 않고 "이미 옮긴 행은 본문에 접두가 없다" 는 것을 사실상 sentinel 로 삼는다. |
| 3 | 상태 정규화: `Completed` · `Done` · `해결 완료` · `완료` → `Resolved` 로 write 시 강제 | 과거 표기가 뒤섞여 있어(§1) 필터·집계가 무너진다. `_normalize_status()` 한 함수로 모든 쓰기 경로가 통과. |
| 4 | 모듈 어휘는 **자유 문자열**(String(100)). enum 강제 안 함. 관리자 필터는 서버 집계 값을 그대로 autocomplete 로 재사용 | 앱이 계속 늘어난다(현재 `ANALYSIS_DATA` 만 40+). 고정 enum 은 곧 낡는다. 오탈자 방지 대책은 프론트가 최근 사용 값을 dropdown 으로 노출하는 것으로 충분. |
| 5 | 중요도 어휘 4개 문자열: `낮음` · `보통` · `높음` · `긴급`. Enum 아님(String(20)) | 마스터 §2.11 은 벡터만 언급하고 어휘를 안 박았다. 기존 프론트는 `낮음/보통/높음` 3개 + 괄호 안 부연 문구를 붙여 저장(예: `보통 (업무 효율성 향상)`)했다 — 마이그레이션 파서가 접두어 3글자로 normalize 하고 `긴급` 을 하나 추가한다. |
| 6 | 게시판 UI = `components/community/FeatureRequestBoard.jsx` **하나**. AppCommunityHub · UserRequests 는 이 컴포넌트를 감쌀 뿐 목록/작성/상세를 자체로 그리지 않는다 | 목록·작성·추천·상세·관리자 답변이 두 벌로 존재해 fix 가 두 번 필요하다는 것이 이 plan 의 원인. `appKey` prop 유무가 유일한 분기. |
| 7 | Upvote 로직 그대로. `FeatureRequestUpvote` 유니크 제약 + 낙관적 갱신 + 실패 롤백(현행) | 이번 plan 의 범위 밖. 회귀 방지만 확인. |
| 8 | `admin_comment` 는 여전히 1슬롯. 스레드 댓글 만들지 않음 | 마스터 §11 비목표. `comments_count` 는 관리자 답변 존재 여부(0/1)로 계속 사용. |
| 9 | 관리자 상태 변경 시 `notify(kind="feature_request.status_changed", employee_id=req.author_id, dedupe_key=f"fr:{id}:status", dedupe_unread_only=True)` | §2.1. 관리자가 여러 번 상태를 흔들어도 **작성자가 아직 안 읽었으면 1건**으로 병합. 이미 읽은 상태에서 다시 바꾸면 새 알림 1건. |
| 10 | 관리자 요약 `GET /api/admin/feature-requests/summary` — `by_module_status: [(module, status, count)]` · `by_priority: [(priority, count)]` · `total` | 관리 계획을 세울 때 어느 모듈·중요도에 요청이 몰렸는지 서버 한 방으로 본다. UserRequests 상단 필터의 autocomplete 소스도 겸한다. |
| 11 | `GET /api/feature-requests?module=&priority=&status=&app_key=` 로 querystring 필터를 연다. 무필터 호출은 현행과 같은 목록 | 관리자·사용자 화면이 같은 컴포넌트를 쓰므로 필터 UX 도 하나. `app_key=null` 은 전역만, 값이 있으면 그 App 만. |
| 12 | 라우트는 **`GUARDED_ROUTES` 미등록** | 플랫폼 공통 기능(마스터 §1.8). App 별 게시판은 이미 `AppSpace.board_enabled` 로 별도 게이팅. |
| 13 | 프론트 API 는 `src/api/featureRequests.js` 로 모으고, `api/admin.js` 안의 기능요청 함수들과 `api/appCommunity.js` 안의 request 계열 함수들을 그 모듈로 이관(호출부만 교체) | 마스터 §1.10. 두 게시판이 같은 컴포넌트를 쓰려면 API 도 하나로. |
| 14 | 기존 `PUT /feature-requests/{id}/comment`(관리자 답변 + 상태) 유지. 다만 **정규화·알림 발신을 이 경로에 심는다** | 라우트 이름 변경은 프론트 위험. 기능만 강화. |

## 3. 데이터 모델

### 3.1 `feature_requests` — 컬럼 추가

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `module` | `String(100)` NULL, **index** | 자유 문자열. 마이그레이션이 본문 접두에서 채운다. |
| `priority` | `String(20)` NULL, **index** | 어휘 4개(낮음/보통/높음/긴급). |

기존 컬럼은 손대지 않는다. `content` (not `description`), `author_id/author_name` (not `employee_id`)은 그대로.

### 3.2 상태 정규화

`status` 는 String 유지 + `services/feature_request_service.py::_normalize_status(value: str) -> str`:

```
Completed | Done | 해결 완료 | 완료  →  Resolved
그 외 4개 어휘        →  그대로
어휘 밖                → ValueError
```

모든 쓰기 경로(create · update · admin comment)가 `_normalize_status()` 를 통과.

### 3.3 스키마 부트스트랩 (`app/schema_bootstrap.py`)

```
def ensure_feature_request_columns(*, engine=None) -> None:
    _add_missing_columns("feature_requests", {
        "module":   "ALTER TABLE feature_requests ADD COLUMN module VARCHAR(100) NULL",
        "priority": "ALTER TABLE feature_requests ADD COLUMN priority VARCHAR(20)  NULL",
    }, engine=engine)
    _add_missing_indexes("feature_requests", {
        "ix_feature_requests_module":   "CREATE INDEX ix_feature_requests_module   ON feature_requests (module)",
        "ix_feature_requests_priority": "CREATE INDEX ix_feature_requests_priority ON feature_requests (priority)",
    }, engine=engine)
    _migrate_feature_request_body_meta(engine=engine)  # 아래 §4.2
```

`run_schema_bootstrap()` 에서 기존 `ensure_notice_columns()` 근처에서 호출.

## 4. 서비스 (`app/services/feature_request_service.py`, 신규)

### 4.1 계약

- `_normalize_status(value: str) -> str` — §3.2.
- `parse_legacy_body(content: str) -> tuple[str | None, str | None, str]` — 본문 앞머리에서 `[관련 모듈: X]`, `[희망 중요도: Y]` 를 뽑아 `(module, priority, stripped_content)` 반환. 어느 쪽도 없으면 `(None, None, content)`.
- `count_summary(db) -> dict` — 관리자 요약. §6 응답 그대로.
- `list_autocomplete_modules(db, limit=50) -> list[str]` — 자주 쓰인 모듈 값 top-N.

### 4.2 본문 메타 파싱 규칙

| 패턴 | 추출 결과 | 정규화 | 예 |
|---|---|---|---|
| `[관련 모듈: 공통 (UI / UX / Dashboard)]\n` | module = `공통 (UI / UX / Dashboard)` | 공백 trim, 최대 100자 | 그대로 |
| `[관련 모듈: Truss Analysis]\n` | module = `Truss Analysis` | — | 그대로 |
| `[희망 중요도: 낮음 (있으면 좋음)]\n` | 원본 `낮음 (있으면 좋음)` | 첫 어휘 매치(`낮음`/`보통`/`높음`/`긴급`) | `낮음` |
| `[희망 중요도: 보통 (업무 효율성 향상)]\n` | priority | 접두 매치 | `보통` |
| `[희망 중요도: 높음 (핵심 기능 버그/부재)]\n` | priority | 접두 매치 | `높음` |
| `[관련 모듈: X]\n[희망 중요도: Y]\n\n본문` | 두 줄 모두 소비, `본문` 반환 | — | — |
| `[희망 중요도: Y]\n[관련 모듈: X]\n\n본문` | 순서 무관하게 처리 | — | — |
| 접두 없음 | `(None, None, content)` — 파싱 no-op | — | — |
| `[관련 모듈: ]` (값 비어 있음) | module = None, 그 줄만 제거 | — | — |
| `[관련 모듈: ...\n\n... ` (닫는 `]` 없음) | 매치 실패, content 그대로 | — | — |

파서는 정규식 `^\s*\[관련 모듈:\s*([^\]]*)\]\s*\n?` 와 `^\s*\[희망 중요도:\s*([^\]]*)\]\s*\n?` 를 앞머리에서
루프로 벗겨 낸다(반복해서 서로 다른 순서라도 소비). 벗겨 낸 뒤 남은 앞쪽 공백/줄바꿈은 trim.

### 4.3 `_migrate_feature_request_body_meta(engine)` — 1회 마이그레이션

- `SELECT id, content, module, priority, status FROM feature_requests WHERE module IS NULL OR priority IS NULL OR status IN (...legacy...)`
- 각 행에 `parse_legacy_body(content)` 적용. 추출된 값이 있으면 컬럼 세팅 + content 를 stripped 로 UPDATE. status 는 `_normalize_status()`.
- **파싱 결과가 (None, None) 이면 UPDATE 없음** → 두 번째 실행은 no-op(멱등).
- 부트스트랩에서 SQLAlchemy `engine.begin()` 트랜잭션 하나로.

## 5. 발신 훅

### 5.1 관리자 답변/상태 변경 (`routers/support.py::comment_feature_request`)

기존 라우트 몸통에서:

```python
old_status = req.status
new_status = _normalize_status(comment_data.status)
req.status = new_status
req.admin_comment = comment_data.admin_comment
...
db.commit()
if old_status != new_status:
    try:
        from app.services.notification_service import notify
    except ImportError:
        notify = None
    if notify is not None:
        notify(db, employee_id=req.author_id,
               kind="feature_request.status_changed",
               title=f"[{req.title}] 상태가 '{new_status}' 로 바뀌었습니다",
               body=(req.admin_comment or "")[:500],
               link={"menu": "Feature Requests", "params": {"request_id": req.id}},
               dedupe_key=f"fr:{req.id}:status")
```

지연 import 는 §2.1 규칙. 알림 실패는 상태 저장을 되돌리지 않는다(§2.1과 동일 철학).

### 5.2 생성/수정 경로

`create_feature_request` · `update_feature_request` 는 알림을 만들지 않는다(사용자 본인 행동).
단 create/update 시 payload 의 `module` · `priority` 를 받아 저장한다(§6 요청 body 참조).

## 6. API

### 6.1 요청/응답 스키마 (`app/schemas.py`)

- `FeatureRequestCreate` 에 `module: Optional[str] = None`, `priority: Optional[str] = None` 추가.
- `FeatureRequestUpdate` 에도 같은 필드 추가(작성자가 수정 시 갱신).
- `FeatureRequestResponse` 는 자동으로 두 필드 노출.
- `FeatureRequestComment` 는 변화 없음(status + admin_comment).

### 6.2 라우트

| 메서드·경로 | 요청 | 응답 | 비고 |
|---|---|---|---|
| `GET /api/feature-requests` | querystring `module?` · `priority?` · `status?` · `app_key?` · `q?` | `list[FeatureRequestResponse]` | 기존 라우트 응답 shape 그대로. 필터가 모두 없으면 현행과 동일(전역 목록, `app_key IS NULL`). `app_key=<key>` 는 그 App 만, `app_key=*` 는 전체(관리자 요약용). |
| `POST /api/feature-requests` | `{title, content, module?, priority?, app_key?}` | `FeatureRequestResponse` | 정규화 통과. 본문에서 접두를 자동 제거하지 않는다 — 프론트가 컬럼으로 넘긴다. |
| `PUT /api/feature-requests/{id}` | `{title, content, module?, priority?}` | `FeatureRequestResponse` | 작성자 or 관리자. |
| `PUT /api/feature-requests/{id}/upvote` | — | `{upvotes, upvoted}` | **현행 유지.** |
| `PUT /api/feature-requests/{id}/comment` | `{status, admin_comment}` | `FeatureRequestResponse` | 관리자. 상태 변경 시 §5.1 알림 발신. |
| `DELETE /api/feature-requests/{id}` | — | `{ok:true}` | 작성자 or 관리자. |
| `GET /api/admin/feature-requests/summary` | — | `{by_module_status:[{module,status,count}], by_priority:[{priority,count}], modules:[...], total:n}` | `require_admin`. `modules` = autocomplete 소스. |

`main.py` 의 `include_router` 목록 그대로(support 라우터에 붙음). `GUARDED_ROUTES` 등록 안 함(§2.12).

### 6.3 관리자 페이지 라우팅

Notification 링크의 `menu: "Feature Requests"` = `Support/UserRequests.jsx`. `sessionStorage['workbench:open-feature-request']`
페이로드로 특정 request_id 를 자동 오픈(Notification Center 의 `MyProjects` 오픈 패턴 그대로 재사용).

## 7. 프론트

### 7.1 공통 컴포넌트 (`components/community/FeatureRequestBoard.jsx`, 신규)

- Props: `{ appKey?: string, title?: string, subtitle?: string, adminMode?: boolean }`
  - `appKey` 미지정 → 전역 모드(`app_key IS NULL` 필터). AppCommunityHub 는 `<FeatureRequestBoard appKey={appKey} />`.
- 내부 상태·API 호출·모달을 모두 여기로 옮긴다. AppCommunityHub 의 `request*` 화면·핸들러(약 400줄)와 UserRequests 의 게시글 렌더/모달(약 300줄)이 이 컴포넌트로 통합.
- 상단 필터 바:
  - **모듈** dropdown — `count_summary().modules` 를 옵션으로. `"전체"` 기본. `datalist` 로 자유 입력 허용(관리자만).
  - **상태** dropdown — 4개 고정 어휘 + `"전체"`.
  - **중요도** dropdown — 4개 고정 + `"전체"`.
  - 텍스트 검색은 클라이언트 필터(현행).
- 목록: 카드/리스트 뷰 토글, 정렬(추천순/최신순). "진행 중" · "해결 완료" 섹션 분할은 UserRequests 방식을 유지(관리자·사용자 모두 유용).
- 상세 모달: 관리자면 상태 dropdown(4개) + admin_comment textarea + "피드백 저장" 버튼. 저장 시 §5.1 알림 자동 발생.
- 작성 모달: 제목 · **모듈**(text input + datalist) · **중요도**(select 4개) · 상세 내용. 본문에 `[관련 모듈:…]` 접두를 붙이지 않는다.

### 7.2 UserRequests.jsx 축소

```jsx
export default function UserRequests() {
  return (
    <div className="max-w-7xl mx-auto pb-10">
      <PageHeader title="User Requests" icon={Lightbulb} … />
      <FeatureRequestBoard title="진행 중인 요청" subtitle="…" />
    </div>
  );
}
```

- `stripMetaPreview()` · `finalContent = [관련 모듈…]` 접두 조합 코드 삭제.
- 모달·카드/리스트·정렬은 전부 `FeatureRequestBoard` 안.

### 7.3 AppCommunityHub.jsx 축소

- `activeTab === 'requests'` 렌더링 블록(및 관련 state — `requests`, `requestForm`, `editingRequest`, `selectedRequest`, `adminReply`, `deleteRequestCandidate`, `requestQuery`, `requestSort`)을 `<FeatureRequestBoard appKey={appKey} adminMode={isAdmin} />` 한 줄로 교체.
- 공지(Notice) 탭·진입 공지 배너 로직은 그대로 (Board 관심사 아님).

### 7.4 API 모듈 (`src/api/featureRequests.js`, 신규)

`listFeatureRequests(params)` · `createFeatureRequest(body)` · `updateFeatureRequest(id, body)` · `upvoteFeatureRequest(id)` · `deleteFeatureRequest(id)` · `commentFeatureRequest(id, body)` · `getFeatureRequestSummary()`. `api/admin.js` · `api/appCommunity.js` 안의 대응 함수는 이 모듈로 재 export(호출부는 점진적으로 이관).

## 8. 보관

- 별도 정리 없음. `feature_requests` 는 사용자가 명시적으로 지운다.
- `notifications` 는 §2.1 의 90일 정책(Plan A) 을 그대로 탄다.

## 9. 테스트

백엔드(pytest, `tests/conftest.py` fixture 재사용):

| 파일 | 검증 |
|---|---|
| `tests/test_feature_request_migration.py` | ① 컬럼 추가 멱등 · ② `[관련 모듈: X]\n[희망 중요도: Y]\n\n본문` → module/priority/content 분리 · ③ 두 줄 순서 뒤바뀐 케이스 · ④ 두 번째 부트스트랩 실행이 no-op(row 수 unchanged) · ⑤ 상태 `Completed`/`Done`/`해결 완료` → `Resolved` 정규화 |
| `tests/test_feature_request_service.py` | `parse_legacy_body()` 엣지케이스 — 메타 없음, 하나만 있음, 값 빈 대괄호, 닫는 `]` 누락(원본 유지), 중요도 부연 문구(`낮음 (있으면 좋음)` → `낮음`), `_normalize_status()` 어휘 밖은 `ValueError` |
| `tests/test_feature_request_router.py` | ① `GET /api/feature-requests?module=&priority=&status=` 필터 · ② 관리자 status 변경 시 `notification_service.notify` 가 호출(monkeypatch) — kind/dedupe_key 인자 검증 · ③ 상태 미변화면 notify 미호출 · ④ 상태값 legacy 로 PUT 시 Resolved 로 저장 · ⑤ `GET /api/admin/feature-requests/summary` 는 admin 전용 (403 for user), 응답 구조 |
| `tests/test_feature_request_schemas.py` | `FeatureRequestCreate` 가 module/priority 옵셔널 · `FeatureRequestResponse` 가 두 필드 노출 |

프론트(러너 없음) 수동 검증(plan 에 절차):

1. `npm run dev` → 로그인 → "User Requests" 이동. 기존 요청 목록이 접두 없이 module/priority 를 별도 배지로 보인다.
2. 새 요청 작성(모듈: `Truss Analysis`, 중요도: `높음`) → 저장 → 카드에 배지 표시, 본문에 접두 없음.
3. 다른 App(예: Truss Analysis) 진입 → "App 게시판" 탭에서 같은 UI (`FeatureRequestBoard`) 확인. 목록 필터 dropdown 동일 표시.
4. 관리자 계정으로 상태를 `In Progress` → `Resolved` 변경. 작성자 계정으로 재로그인해서 헤더 종 아이콘에 "feature_request.status_changed" 알림 1건 수신 → 클릭 시 해당 request 상세 모달 오픈.
5. 관리자 상태를 다시 흔들어도 (작성자 미읽음 유지 시) 알림이 1건으로 유지되는지 확인.

## 10. 서버(145) 반영 구분

- 백엔드: **`git pull` + 백엔드 재시작으로 끝.** 컬럼 추가 · 인덱스 · 본문 마이그레이션은 `run_schema_bootstrap()` 이 자동 실행(1회, 이후 no-op). 신규 pip 의존성 없음.
- 프론트: **재배포 필요.** WorkBench 포터블 exe 를 `npm run dist` 로 다시 빌드해서 사용자 PC 갱신. `FeatureRequestBoard` 신설 + 두 페이지 축소가 번들에 들어간다.
- InHouse 프로그램: **없음.**

## 11. 비목표

- 스레드 댓글(사용자 다중 응답) — `admin_comment` 1슬롯 유지.
- 공개 로드맵 페이지 · 캘린더 뷰.
- GitHub Issue · Jira · 사내 티켓 시스템 동기화.
- 이메일-in 제출(작성자가 사내 메일로 요청).
- 추천 UI 개편(반응 이모지 · 스레드 추천 등) — 현행 하트/카운트 유지.
- 모듈 어휘 강제(taxonomy 관리 화면) — 자유 문자열 + autocomplete 만.
- `notice.published` 알림 — 이 plan 의 범위 아님(별건).
