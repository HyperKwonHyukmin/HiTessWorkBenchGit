# 배포 후 페이지 오류 예방 마스터 플랜

> 작성 2026-09-23. 계기: v1.5.8 배포 직후 운영(145)에서 `Analysis Management` 가 500
> (`MySQL 1038 Out of sort memory`). 개발 PC 에서는 전체 테스트 1,680건과 실 DB 2,832행
> 직렬화가 모두 통과했는데도 운영에서만 터졌다.

---

## 0. 무엇이 문제인가 — 이번 배포에서 실제로 새어 나간 결함 6건

| # | 결함 | 언제 발견됐나 | 테스트가 왜 못 잡았나 |
|---|---|---|---|
| 1 | `Dashboard.jsx` 크래시 — lucide-react `Map` 아이콘이 전역 `Map` 생성자를 가림 | **사용자가 앱을 열어서** | 프론트 컴포넌트 테스트 러너 없음. 빌드는 통과한다 |
| 2 | `favoritesRef`/`recentRef` 를 `useEffect` 로 동기화 → 연속 조작 시 직전 변경 유실 | 배포 전 자체 감사 | 위와 같음 |
| 3 | 오프라인일 때 `PreferencesContext` 가 빈 값을 '서버 진실' 로 내려보내 즐겨찾기·최근 앱을 지울 수 있었음 | 404 조사 중 우연히 | 위와 같음 |
| 4 | `/api/notifications`·`/api/preferences` 404 | **사용자가 앱을 열어서** | 배포 절차(백엔드 재시작)가 사람 기억에 의존 |
| 5 | 모델 컬럼 추가가 이력 API 응답 키를 조용히 넓힘 | 계약 테스트 1건이 우연히 | `_serialize_analysis` 가 전 컬럼을 덤프하는 구조. 그 테스트가 없었으면 못 잡았다 |
| 6 | **`Analysis Management` 500 (MySQL 1038)** | **운영 배포 후** | 테스트가 SQLite 로 돈다. MySQL 고유 실패는 구조적으로 보이지 않는다 |

6건 중 **3건을 사용자가 먼저 발견**했다. 이게 고쳐야 할 진짜 지표다.

---

## 1. 근본 원인 — 검증 환경이 운영을 모사하지 않는다

### 1.1 (최대 구멍) 테스트는 SQLite, 운영은 MySQL

`tests/conftest.py` 는 `sqlite:///:memory:` 를, `app/database.py` 는 `mysql+pymysql` 을 쓴다.
따라서 아래 부류는 **전체 테스트 1,680건이 전부 통과해도 운영에서 터진다.**

- 정렬 버퍼 초과(1038) ← 이번 사건
- `Unknown column` (부트스트랩 누락)
- 컬럼 타입·길이 초과(`Data too long`), `utf8mb4` collation 비교
- `ONLY_FULL_GROUP_BY` 등 sql_mode 차이
- 인덱스 길이 상한, `max_allowed_packet` 초과
- 트랜잭션·락 타임아웃

### 1.2 dev 와 운영의 MySQL 이 같다는 보장이 없다 — 아무도 측정하지 않았다

이번 사건의 실측:

측정은 `HiTessWorkBenchBackEnd/scripts/measure_mysql_profile.py` 로 한다(읽기 전용).

| 항목 | dev(10.133.122.70) | 운영(10.14.42.145) |
|---|---|---|
| MySQL | 8.0.44 | **미측정** |
| `sort_buffer_size` | 262,144 (기본값) | **미측정** |
| `max_sort_length` | 1,024 | **미측정** |
| `sql_mode` | `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,…` | **미측정** |
| collation | `utf8mb4_0900_ai_ci` | **미측정** |
| `analysis` 행 수 | 2,834 | 미측정 |
| JSON 평균/최대 | 3,288 / 68,987 byte | 미측정 |
| 가장 넓은 행 | `ModuleOceanMoving` 68,987 byte | 미측정 |

**수정 후 dev 실행 계획(2026-09-23 실측):**

```
EXPLAIN SELECT id FROM analysis WHERE source <> 'WorkbenchSample'
        ORDER BY created_at DESC, id DESC LIMIT 25
→ type=index  key=ix_analysis_created_at  Extra=Using where; Backward index scan
```

`Using filesort` 가 사라졌다. 인덱스가 정렬을 대신하므로 이 쿼리는 정렬 버퍼를 **아예 쓰지 않는다** —
우회가 아니라 원인 제거다. 운영에서도 같은 EXPLAIN 이 나오는지 확인할 것.

⚠ **정정**: 커밋 `8a9e6d9` 의 메시지에 "개발 DB 는 데이터가 적어 재현되지 않았다" 고 적었으나
이는 **검증되지 않은 추정이며 아마 틀렸다.** MySQL 1038 은 정렬 버퍼가 *레코드 한 건*도 못 담을 때
나는 오류라 행 수보다 **행 폭·서버 설정**에 좌우된다. dev 는 기본값 256KB 로도 통과했으므로,
진짜 차이는 운영의 `sort_buffer_size` 설정이거나 운영 데이터의 JSON 폭이다.
**아직 isolate 되지 않았다** — 아래 T1 이 이걸 확정한다.

### 1.3 실행 검증이 없다

백엔드 GET 엔드포인트 **91개**, 프론트 페이지 **49개**. 배포 후 이걸 실제로 열어 보는 절차가 없다.
결함 1·4·6 은 전부 "사용자가 화면을 열었을 때" 발견됐다.

### 1.4 프론트에 테스트 러너가 없다

순수 유틸만 `node --test` 로 18건 돈다. 컴포넌트·컨텍스트·훅은 **빌드 통과가 유일한 검증**이다.
`Map` 섀도잉은 빌드를 통과하고 런타임에만 터진다.

### 1.5 모델 변경이 API 계약을 조용히 넓힌다

`_serialize_analysis` 가 `record.__table__.columns` 를 통째로 덤프한다. 컬럼을 더하면
모든 이력 응답이 바뀌고, **정렬 버퍼 사용량도 늘어난다**(이번 사건의 방아쇠).
현재 이를 지키는 건 계약 테스트 단 1건이다.

### 1.6 배포 절차가 사람 기억에 의존

`git pull` 만으로 끝나는지, 백엔드 재시작이 필요한지, InHouse 프로그램 수동 교체가 필요한지가
매번 판단 대상이다. CLAUDE.md 에 규칙은 있지만 **강제하는 장치가 없다.** CI 도 없다.

---

## 2. 대책 — 3단계

비용 대비 효과 순. **T1 만 해도 이번 사건은 막힌다.**

### T0 — 오늘 당장 (비용 ~0, 매 커밋 적용)

#### T0-1. 커밋 전 페이지 오류 검토 체크리스트 (필수화)

메모리 `feedback_commit_page_error_review.md` 로 저장해 매 커밋마다 적용한다.
자세한 항목은 §3.

#### T0-2. 스모크 스크립트 — 운영에 실제로 HTTP 를 쏜다

`scripts/smoke_endpoints.py` (신규). 로그인 토큰 1개로 **화면이 쓰는 주요 GET 엔드포인트**를
순회하며 200 을 확인한다. 배포 직후 1회, 30초 이내.

```
WorkBenchEnv\Scripts\python.exe scripts\smoke_endpoints.py --base http://10.14.42.145:9091 --employee-id <사번>
```

최소 대상(화면 1:1 대응):

| 화면 | 엔드포인트 |
|---|---|
| Dashboard | `/api/analysis/history/{eid}?include_summary=true` |
| My Projects | `/api/analysis/history/{eid}` + `file_status=expiring`·`pinned`·`expired` |
| Analysis Management | `/api/analysis/all?include_summary=true` ← **이번 사건 지점** |
| Usage Reports | `/api/analysis/stats/program/{대표 App}` |
| System Settings | `/api/system/status`, `/api/system/queue-status` |
| App Settings | `/api/app-settings` |
| Notice/Guide/Requests | `/api/notices`, `/api/user-guides`, `/api/feature-requests` |
| 알림·환경설정 | `/api/notifications`, `/api/preferences` |

⚠ **limit 을 기본값으로만 돌리지 말 것.** 이번 오류는 `limit=25` 에서 났고, 통계 화면은
`limit=100000` 을 쓴다. 각 목록 엔드포인트를 **작은 limit·큰 limit 두 번** 호출한다.

#### T0-3. 배포 영향 분류를 커밋 메시지에 강제

모든 커밋 말미에 한 줄. 이미 CLAUDE.md 규칙이지만 체크리스트로 끌어올린다.

```
배포: git pull + 백엔드 재시작 / 프론트 재배포 / InHouse 수동 교체 <파일> / 없음
```

---

### T1 — 이번 주 (핵심, 결함 #6 을 막는 유일한 대책)

#### T1-1. 운영 MySQL 설정을 측정하고 dev 와 맞춘다 ★최우선

먼저 원인을 확정한다. 운영에서:

```
cd C:\KHM\HiTessWorkbench\HiTessWorkBenchGit\HiTessWorkBenchBackEnd
WorkBenchEnv\Scripts\python.exe scripts\measure_mysql_profile.py
```

서버 변수 + `analysis` 행 폭 + 인덱스 유무 + 목록 쿼리 EXPLAIN 을 한 번에 찍는다(읽기 전용).

- dev 와 다르면 **dev 를 운영 값에 맞춘다**(느슨한 쪽이 아니라 빡빡한 쪽으로).
  그래야 dev 에서 먼저 터진다.
- 결과를 이 문서 §1.2 표에 기록한다. 측정값 없이 추정으로 원인을 적지 않는다.

#### T1-2. MySQL 테스트 프로파일

`conftest.py` 에 환경변수 스위치를 둔다.

```
WORKBENCH_TEST_DB=mysql  →  mysql+pymysql://…/hitessworkbench_test
(미설정 시 기존 sqlite — 평소 빠른 반복은 그대로)
```

- 운영과 같은 `sort_buffer_size`·`sql_mode` 로 띄운 로컬 MySQL 을 쓴다.
- **커밋 전 1회**, 최소한 DB 스키마·쿼리를 건드린 커밋에서는 반드시 돌린다.
- 이번 결함은 여기서 잡혔을 것이다.

#### T1-3. 대용량·대폭 데이터 시드

`tests/fixtures/seed_large_analysis.py` — `analysis` 에 **운영 최대치에 가까운 JSON 폭**
(≥70KB)을 가진 행을 수백 건 넣고 목록 엔드포인트를 호출하는 테스트.
정렬 버퍼·`max_allowed_packet`·응답 크기 문제를 재현 가능하게 만든다.

#### T1-4. 모델 컬럼 추가 가드

`Analysis` 처럼 **전 컬럼을 덤프하는 직렬화**를 가진 모델은 컬럼 추가가 곧 계약 변경이자
쿼리 비용 증가다. 다음을 테스트로 고정한다.

- 응답 키 집합 계약 테스트(이미 `test_program_registry.py` 에 있음) — **모델마다** 두기
- 목록 엔드포인트가 **JSON 컬럼을 정렬 대상에 넣지 않는지** 고정
  (`_ordered_analysis_rows` 우회를 강제. 이미 `test_analysis_list_ordering.py` 로 일부 커버)

---

### T2 — 이번 달 (구조 개선)

#### T2-1. 프론트 컴포넌트 테스트 러너 도입

Vitest + Testing Library. 전면 커버리지가 목표가 아니라 **크래시 급 결함**만 막는다.

- 각 Context Provider 가 mount → 첫 렌더까지 예외 없이 도달하는지
- 주요 페이지가 빈 데이터·에러 응답으로 렌더되는지
- 결함 1(`Map` 섀도잉)·2(ref staleness)·3(오프라인 덮어쓰기)이 전부 이 층에서 잡힌다

#### T2-2. lucide-react 아이콘 이름 린트 규칙

JS 내장(`Map`, `Set`, `Image`, `Object`, `Function`, `Promise`, `Text`, `Symbol`…)과
같은 이름의 아이콘 import 를 금지하거나 별칭(`Map as MapIcon`)을 강제하는 ESLint 규칙.
전례가 있으므로 규칙으로 못 박는다.

#### T2-3. Playwright 스모크 (선택)

`reference_studio_playwright_walkthrough` 에 이미 Studio 용 Playwright 환경이 있다.
같은 방식으로 WorkBench 주요 화면 5~6개를 열어 **콘솔 에러 0건**을 확인한다.
T2-1 로 대부분 잡히면 우선순위는 낮다.

#### T2-4. 스테이징 단계 (가장 확실하지만 가장 비쌈)

운영 DB **스냅샷**을 복원한 별도 백엔드 인스턴스에 먼저 배포 → 스모크 → 운영.
운영 데이터 특성(JSON 폭, 행 수, 이상 데이터)을 그대로 재현하는 유일한 방법이다.
사내 여건상 즉시 어렵다면, 최소한 **`analysis` 테이블만이라도** 주기적으로 dev 에 복제한다.

---

## 3. 커밋 전 페이지 오류 검토 체크리스트

메모리에 저장해 **매 커밋마다** 적용한다.

### 3.1 항상

- [ ] 백엔드 전체 테스트 통과 (기존 실패 2건 제외)
      `tests/test_drawing_image_lug_fixtures.py::test_generated_lug_image_fixtures_seed_distinct_params_and_mesh`
      `tests/test_mooring_edit_bdf.py::test_connect_rejects_node_already_dependent`
- [ ] 프론트 `npm run build` 통과
- [ ] `node --test src/utils/*.test.js` 통과
- [ ] **변경이 영향을 주는 화면을 나열**하고, 그 화면이 호출하는 API 를 실제로 1회씩 호출
- [ ] `config.js` 가 스테이징에 없음 / `Darkmode.js/` 건드리지 않음
- [ ] 커밋 메시지에 배포 영향 분류 한 줄

### 3.2 DB 모델·스키마를 건드렸다면 (추가)

- [ ] `schema_bootstrap` 에 멱등 보강이 들어갔는가
- [ ] **그 모델을 전 컬럼 덤프로 직렬화하는 곳이 있는가** → 응답 계약 테스트 갱신
- [ ] **그 테이블을 `ORDER BY` 하는 목록 쿼리가 있는가** → 정렬 대상에 JSON/TEXT 가 들어가지 않는지
- [ ] MySQL 프로파일로 테스트 1회 (`WORKBENCH_TEST_DB=mysql`)
- [ ] 목록 엔드포인트를 **작은 limit·큰 limit** 두 번 호출

### 3.3 신규 라우터·엔드포인트를 더했다면 (추가)

- [ ] `main.py` 에 `include_router` 등록
- [ ] **백엔드를 실제로 재시작하고** 해당 경로가 200 인지 확인 (404 전례)
- [ ] 백엔드 게이트가 필요한 App 이면 `GUARDED_ROUTES` 등록 (미등록은 fail-open)

### 3.4 프론트 컨텍스트·전역 상태를 건드렸다면 (추가)

- [ ] 새로 import 한 아이콘 이름이 JS 내장과 겹치지 않는가 (`Map`/`Set`/`Image`…)
- [ ] `useRef` 동기화를 `useEffect` 가 아니라 **렌더 중**에 하는가
- [ ] 서버 응답이 **없거나 실패할 때** 로컬 값을 덮어쓰지 않는가
- [ ] Provider 중첩 순서가 의존 관계와 맞는가

### 3.5 배포 직후 (운영)

- [ ] 백엔드 재시작 완료
- [ ] 스모크 스크립트 통과 (T0-2)
- [ ] 변경이 닿는 화면을 브라우저로 직접 1회 열어 **콘솔 에러 0건** 확인

---

## 4. 실행 순서

| 순서 | 항목 | 비용 | 이번 사건을 막았나 |
|---|---|---|---|
| 1 | T0-1 체크리스트 메모리화 | 즉시 | 부분 (검토 유도) |
| 2 | T1-1 운영 MySQL 측정 | 30분 | **원인 확정** |
| 3 | T0-2 스모크 스크립트 | 반나절 | **○ 배포 직후 즉시 발견** |
| 4 | T1-2 MySQL 테스트 프로파일 | 1일 | **◎ 커밋 전 발견** |
| 5 | T1-3 대폭 데이터 시드 | 반나절 | **◎** |
| 6 | T1-4 모델 변경 가드 | 반나절 | ○ |
| 7 | T2-1 Vitest | 2~3일 | 결함 1·2·3 |
| 8 | T2-2 아이콘 린트 | 2시간 | 결함 1 |
| 9 | T2-4 스테이징 | 큼 | 전부 |

---

## 5. 측정 지표

- **사용자가 먼저 발견한 결함 수** — 이번 배포 3건 → 목표 0
- 배포 후 첫 24시간 내 500 발생 건수 → 목표 0
- 스모크 스크립트 통과율 100% 를 배포 완료 조건으로 삼는다

---

## 부록 A. 이번 사건 타임라인

1. v1.5.8 배포 (`git pull` + 재시작)
2. `Analysis Management` 500 — 브라우저는 `net::ERR_FAILED` (미처리 500 은 CORS 헤더가 안 붙는다)
3. 원격에서 후보 2개(컬럼 누락 / 특정 행 데이터 이상)를 세웠으나 **둘 다 오답**
4. 서버 traceback 확보 → `analysis.py:765` 의 `.all()` 에서 `(1038, 'Out of sort memory')`
5. 수정: `_ordered_analysis_rows()` — 정렬은 `id`+`created_at` 만, 본문은 `id` 로 재조회 후 순서 복원
   + `ix_analysis_created_at` 인덱스(filesort 자체 제거)
6. 운영 재배포 후 `Analysis Management` **정상 동작 확인**(2026-09-23, 사용자 확인) — 수정은 실 데이터에서 검증됨
7. 미해결: **왜 dev 에서는 안 터졌는지 isolate 되지 않았다** → T1-1.
   증상이 사라졌다고 원인 규명을 접지 않는다 — 같은 부류(컬럼 추가 → MySQL 자원 한계)가 또 샌다.

**교훈: 원격 추측은 2번 다 틀렸고, traceback 1개가 즉시 확정했다.**
운영 오류는 추측하지 말고 traceback 을 먼저 확보한다.
