# 공유 데이터베이스(`hitessworkbench`) 사용 가이드

> **대상 독자**: WorkBench의 외부 앱(별도 백엔드)을 개발하는 개발자, 그리고 그 작업을 돕는 AI 에이전트(Claude Code 등)
> **범위**: **DB 사용법만** 다룬다. 화면(iframe) 임베딩·프론트엔드 연동은 이 문서 범위 밖이다.
> **목표**: 이 문서만 보고 공유 DB를 올바르게 **조회·생성·수정·삭제**하고, 기록한 데이터가 WorkBench의 **통계·MyProject 이력**에 자동으로 나타나게 한다.

> 예시는 **언어/드라이버 중립적인 순수 SQL**로 제공한다. 사용하는 언어(Java/C#/Go/PHP/Python/...)의 **파라미터 바인딩(prepared statement)** 으로 실행한다. `:name` 은 바인딩 자리표시자다.

---

## 1. 통합 모델 (한 줄 요약)

- 외부 앱은 **자체 백엔드**에서 **공유 MySQL DB(`hitessworkbench`)에 직접** 조회/저장/삭제한다. **WorkBench 백엔드(API)는 사용하지 않는다.**
- WorkBench와 외부 앱의 **유일한 데이터 접점은 이 공유 DB** 이며, 이를 **Shared Database(공유 데이터베이스) 패턴**이라 한다.
- 모든 기록은 **사번(`employee_id`)** 으로 태깅한다. 이 사번은 호스트(WorkBench)에서 외부로 전달되는 로그인 사용자 식별자다. *(전달 방법은 프론트엔드 연동 사안 — 이 문서 범위 밖. 백엔드는 "사번 문자열을 입력으로 받는다"로만 알면 된다.)*
- 외부 앱이 위 규칙대로 `analysis` 테이블에 기록하면, **별도 연동 코드 없이** WorkBench 화면(통계·MyProject)에 자동 반영된다.

---

## 2. 접속 정보

| 항목 | 값 | 비고 |
|------|-----|------|
| 엔진 | MySQL 8.x | |
| 호스트 | *(운영팀 발급)* | 개발 기본값 `localhost`, 운영은 팀 공용 서버 |
| 포트 | `3306` | |
| 데이터베이스 | `hitessworkbench` | |
| 계정/비밀번호 | *(외부 앱 전용 계정 발급 요청)* | WorkBench 백엔드 계정 재사용 금지 (→ 8장) |
| 문자셋 | `utf8mb4` | 한글·이모지 안전 |

**접속 문자열(드라이버 무관 형식)**
```
mysql://<user>:<password>@<host>:3306/hitessworkbench
```

**언어 공통 권장 설정**
- `charset` / `collation` = **utf8mb4** (한글·이모지 깨짐 방지)
- **파라미터 바인딩(prepared statement) 필수** — 문자열 결합으로 SQL을 만들지 말 것(인젝션 방지)
- **커넥션 풀** 사용, idle 커넥션은 MySQL `wait_timeout`보다 짧게 재활용(recycle, 예: 3600초)
- 쓰기 작업은 **트랜잭션**으로 묶고 성공 시 `COMMIT`, 실패 시 `ROLLBACK`

---

## 3. 스키마 레퍼런스

**굵은 테이블**이 외부 앱과 직접 관련된다.

### 3.1 ★ `analysis` — 작업/해석 이력 (WorkBench 통계·MyProject의 원천)

| 컬럼 | 타입 | NULL | 기본값 | 외부 앱이 넣을 값 / 의미 |
|------|------|:---:|--------|--------------------------|
| `id` | INT PK AI | | | 자동 증가. 직접 넣지 않음 |
| `job_id` | VARCHAR(50) UNIQUE | ✓ | NULL | 작업 고유 ID. 외부 앱 UUID 권장 (`ext-<uuid>`) |
| `project_name` | VARCHAR(200) | ✓ | NULL | MyProject에 표시될 작업 이름 |
| `program_name` | VARCHAR(100) | | | **통계 집계 키.** 내 기능 고정명 (예: `'MoorMaster'`) |
| `employee_id` | VARCHAR(50) (idx) | | | **입력받은 사번.** 누가 한 작업인지 |
| `status` | VARCHAR(50) | | | 사람이 읽는 상태 (예: `'completed'`, `'Failed'`) |
| `job_status` | VARCHAR(20) | | `'completed'` | 머신 상태: `Pending`/`Running`/`completed`/`Failed` |
| `progress` | INT | | `100` | 진행률 0~100 |
| `job_message` | TEXT | ✓ | NULL | 진행/오류 메시지 |
| `input_info` | JSON | | | 입력 요약(JSON) |
| `result_info` | JSON | | | 결과 요약(JSON). **결과를 여기에 인라인 저장 권장** (→ 5.3) |
| `source` | VARCHAR(50) | | `'Workbench'` | **출처 태그.** 내 앱 식별자 고정값 (예: `'MoorMaster'`). **`'WorkbenchSample'` 금지**(통계·이력에서 제외되는 예약값) |
| `created_at` | DATETIME | | **CURRENT_TIMESTAMP** | 생성 시각. **DB 기본값 있음 → 생략 가능**(자동 입력) |
| `started_at` | DATETIME | ✓ | NULL | 시작 시각 (선택) |
| `updated_at` | DATETIME | ✓ | NULL | 갱신 시각 (선택) |

### 3.2 `users` — 사용자 (읽기 전용 권장)

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `id` | INT PK | |
| `employee_id` | VARCHAR(50) UNIQUE | 사번 (= 입력 사번과 매칭) |
| `name` | VARCHAR(50) | 이름 |
| `company` | VARCHAR(100) | 회사 |
| `department` | VARCHAR(100) NULL | 부서 — **WorkBench 부서별 통계가 이 값을 사용** |
| `position` | VARCHAR(50) | 직급 |
| `is_active` | BOOL | 승인/활성 여부 |
| `is_admin` | BOOL | 관리자 |
| `is_developer` | BOOL | 개발자 — **true면 통계에서 자동 제외** |
| `login_count` / `last_login` / `created_at` | | 로그인 통계 |

> 외부 앱은 `users`를 **조회만** 한다(사번 검증·이름/부서 표시). 사용자 생성/삭제는 WorkBench 로그인·승인 흐름 소관이므로 외부 앱이 건드리지 않는다.

### 3.3 `activity_logs` — 활동 로그 (선택적 기록 가능)

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `id` | INT PK | |
| `employee_id` | VARCHAR(50) (idx) NULL | 사번 |
| `action_type` | VARCHAR(50) (idx) | 커스텀 가능 (예: `'EXT_RUN'`) |
| `action_detail` | JSON NULL | 상세 |
| `status` | VARCHAR(20) NULL | `'success'`/`'failure'` |
| `ip_address` | VARCHAR(50) NULL | |
| `created_at` | DATETIME | **DB 기본값 CURRENT_TIMESTAMP → 생략 가능** |

### 3.4 기타 테이블 (외부 앱 접근 불필요)

`notices`, `user_guides`, `feature_requests`, `user_sessions`.

> ⚠️ `notices`/`user_guides`/`feature_requests`/`users`의 `created_at`은 **DB 기본값이 없다**(애플리케이션이 채움). 이 테이블에 INSERT한다면 `created_at`을 **명시적으로 넣어야** 한다. 반면 `analysis`/`activity_logs`는 DB 기본값(`CURRENT_TIMESTAMP`)이 있어 생략 가능하다.

---

## 4. 조회 (SELECT)

### 4.1 사번 유효성 검증 (작업 전 권장)

```sql
SELECT employee_id, name, department, is_active
FROM users
WHERE employee_id = :eid;
```
바인딩 값 예시: `:eid = '12345'`

반환 예시:
| employee_id | name   | department | is_active |
|-------------|--------|------------|:---------:|
| `12345`     | 홍길동 | 의장설계부 | `1`       |

→ 행이 없거나 `is_active = 0`이면 미등록/미승인 사용자이므로 작업을 거부한다.

### 4.2 내 앱이 만든 이력만 조회

```sql
SELECT id, job_id, project_name, status, result_info, created_at
FROM analysis
WHERE employee_id = :eid
  AND source = :app            -- 내 앱 것만
ORDER BY created_at DESC
LIMIT 50;
```
바인딩 값 예시: `:eid = '12345'`, `:app = 'MoorMaster'`

반환 예시 (1행):
| id   | job_id            | project_name             | status      | result_info                          | created_at            |
|------|-------------------|--------------------------|-------------|--------------------------------------|-----------------------|
| `1024` | `ext-9f3a2b1c4d5e` | `Mooring Case A — 11K TEU` | `completed` | `{"summary":{"maxStress":235.6,...}}` | `2026-06-08 09:12:43` |

> JSON 컬럼(`input_info`/`result_info`)은 드라이버에 따라 문자열 또는 객체로 반환된다. 문자열이면 애플리케이션에서 JSON 파싱한다.

---

## 5. 생성 (INSERT) — WorkBench에 노출시키기

> 이 장이 핵심이다. 아래 규칙대로 `analysis`에 INSERT해야 작업이 WorkBench의 **MyProject 이력**과 **사용 통계/리포트**에 자동으로 나타난다.

### 5.1 노출 조건 (반드시 충족)

| 조건 | 이유 |
|------|------|
| `employee_id` = 입력받은 사번 | MyProject가 `employee_id`로 필터링 |
| `source` ≠ `'WorkbenchSample'` | 이 값만 모든 이력·통계에서 *제외*됨 |
| `program_name` 채움 | Top Programs / 사용 리포트의 집계 키 |
| 해당 사번 `users.is_developer = 0` | 개발자 계정 작업은 통계에서 자동 제외(테스트용) |
| `created_at` 유효 | 통계는 기간(`created_at`)으로 집계. 생략 시 DB가 현재시각 자동 입력 |

> 부서별 통계의 **부서**는 외부 앱이 넣지 않는다. WorkBench가 `analysis.employee_id ↔ users.department`를 조인해 가져오므로 **사번만 정확하면** 부서 통계는 자동으로 맞는다.

### 5.2 표준 INSERT

```sql
INSERT INTO analysis
    (job_id, project_name, program_name, employee_id,
     status, job_status, progress, input_info, result_info, source)
VALUES
    (:job_id, :project_name, :program_name, :employee_id,
     'completed', 'completed', 100,
     :input_info, :result_info, :source);
-- created_at 은 DB 기본값(CURRENT_TIMESTAMP)으로 자동 입력 → 생략
```

바인딩 값 예시:
| 자리표시자 | 예시 값 | 의미 |
|-----------|---------|------|
| `:job_id` | `'ext-9f3a2b1c4d5e'` | 외부 앱 UUID (`ext-` prefix 권장) |
| `:project_name` | `'Mooring Case A — 11K TEU'` | MyProject에 표시될 이름 |
| `:program_name` | `'MoorMaster'` | 통계 집계 키 (내 기능 고정명) |
| `:employee_id` | `'12345'` | 입력받은 사번 |
| `:input_info` | `'{"vesselType":"11K_TEU","loadCaseCount":3,"unit":"kN"}'` | 입력 요약 JSON 문자열 |
| `:result_info` | `'{"summary":{"maxStress":235.6,"unit":"MPa","pass":true}}'` | 결과 요약 JSON 문자열 |
| `:source` | `'MoorMaster'` | 출처 태그 (**`'WorkbenchSample'` 금지**) |

→ 이렇게 INSERT하면 사번 `12345` 사용자의 MyProject에 `Mooring Case A — 11K TEU`(`completed`)가 즉시 뜨고, 통계의 `MoorMaster` 프로그램 사용 건수가 1 증가한다.

### 5.3 결과 파일 처리 — 중요

WorkBench의 파일 다운로드는 **WorkBench 서버의 `userConnection/` 폴더 내부 파일만** 서빙한다. 외부 앱이 다른 위치에 저장한 파일은 **WorkBench를 통해 다운로드되지 않는다.** 따라서:

- **(권장) 결과 데이터를 `result_info` JSON에 인라인 저장** — 표·수치·요약을 직접 담으면 WorkBench가 그대로 읽어 표시 가능.
- 또는 **외부 앱이 자체 다운로드 URL 제공** — `result_info`에 `{"download_url": "..."}`를 넣고 외부 앱이 직접 내려준다.

```json
// result_info 예시
{
  "summary": { "maxStress": 235.6, "unit": "MPa", "pass": true },
  "table": [ { "member": "M1", "stress": 120.3 }, { "member": "M2", "stress": 98.1 } ],
  "download_url": "https://<외부앱>/files/report-abc123.pdf"
}
```

### 5.4 진행 중 작업 표시 (선택)

장시간 작업이면 시작 시 `job_status='Running', progress=0`으로 INSERT 후 진행에 따라 UPDATE(→ 6장).

> ⚠️ WorkBench 서버가 **재시작되면** `job_status`가 `Pending`/`Running`인 모든 행을 `Interrupted`/`Failed`로 일괄 변경한다. 외부 앱의 장시간 작업이 영향받지 않게 하려면 완료 즉시 `completed`로 마감하거나, 진행 상태는 외부 앱 자체 테이블에서 관리한다.

---

## 6. 수정·삭제 (UPDATE / DELETE)

**안전 규칙**: 항상 `employee_id = :eid AND source = :app` 조건을 함께 건다 → *내 앱이 만든, 그 사용자 본인의* 행만 대상. `WHERE` 없는 UPDATE/DELETE 금지.

### 6.1 수정
```sql
UPDATE analysis
SET status = :status, job_status = :job_status,
    progress = :progress, result_info = :result_info, updated_at = NOW()
WHERE job_id = :job_id
  AND employee_id = :eid
  AND source = :app;
```
바인딩 값 예시 (진행 중 작업을 완료로 마감):
`:status = 'completed'`, `:job_status = 'completed'`, `:progress = 100`,
`:result_info = '{"summary":{"maxStress":235.6,"pass":true}}'`,
`:job_id = 'ext-9f3a2b1c4d5e'`, `:eid = '12345'`, `:app = 'MoorMaster'`

### 6.2 삭제
```sql
DELETE FROM analysis
WHERE id = :id
  AND employee_id = :eid
  AND source = :app;
```
바인딩 값 예시: `:id = 1024`, `:eid = '12345'`, `:app = 'MoorMaster'`

→ `id = 1024` 행이 *사번 12345가 만든 MoorMaster 기록일 때만* 삭제된다. 다른 사용자나 다른 앱(`source`)의 행이면 `WHERE` 조건이 어긋나 0건 삭제되어 안전하다.

---

## 7. 외부 앱 전용 데이터 (자체 테이블)

`analysis`로 표현하기 어려운 외부 앱 고유 데이터는 **공유 테이블을 변형하지 말고** 별도 테이블을 만든다.

- 이름에 **앱 prefix**를 붙인다: `ext_<app>_<entity>` (예: `ext_moormaster_cases`).
- `employee_id`는 같은 형식(VARCHAR(50))으로 두면 나중에 `users`와 조인하기 쉽다.
- **공유 테이블에 FK(외래키)를 걸지 않는다** — WorkBench 마이그레이션과 충돌 위험. 정합성은 애플리케이션에서 관리.
- 자체 테이블 생성 전 **운영팀에 이름·용도를 공유**한다.

```sql
CREATE TABLE IF NOT EXISTS ext_moormaster_cases (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  employee_id  VARCHAR(50)  NOT NULL,
  case_name    VARCHAR(200) NOT NULL,
  payload      JSON         NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_emp (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 8. 금지 사항 & 권한

### ✅ 허용
- `analysis`, `activity_logs`에 **내 `source` 태그로 INSERT**
- 내가 만든 행(`employee_id` + `source` 일치) **조회·수정·삭제**
- `users` **조회**
- `ext_<app>_*` **자체 테이블 자유 생성·운영**

### ⛔ 금지
- 공유 테이블(`users`, `analysis`, `notices` 등) **`ALTER` / `DROP` / 컬럼 추가** (WorkBench가 시작 시 스키마를 검사·보강 → 충돌)
- **다른 `source`(다른 앱/WorkBench)가 만든 행** 수정·삭제
- `source = 'WorkbenchSample'` 사용 (예약값)
- `WHERE` 없는 UPDATE/DELETE, 문자열 결합 SQL
- `users` 행 임의 생성/삭제
- WorkBench 백엔드 DB 계정 재사용

### 🔐 권장 DB 권한 (운영팀에 요청)
```sql
GRANT SELECT                         ON hitessworkbench.users            TO '<ext_account>'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON hitessworkbench.analysis         TO '<ext_account>'@'%';
GRANT SELECT, INSERT                 ON hitessworkbench.activity_logs    TO '<ext_account>'@'%';
GRANT ALL PRIVILEGES                 ON hitessworkbench.ext_<app>_*       TO '<ext_account>'@'%';
```

---

## 9. 체크리스트 (DB)

- [ ] 외부 앱 전용 DB 계정으로 접속 (최소 권한)
- [ ] 모든 쿼리 파라미터 바인딩 사용
- [ ] 작업 전 `users`에서 사번 유효성(`is_active`) 검증
- [ ] `analysis` INSERT 시 `employee_id`(사번) + `program_name` + `source`(앱명) 채움, `source != 'WorkbenchSample'`
- [ ] 결과는 `result_info` JSON 인라인 저장(또는 자체 다운로드 URL)
- [ ] UPDATE/DELETE는 `employee_id` + `source` 조건 동반
- [ ] 자체 데이터는 `ext_<app>_*` 테이블에, 공유 테이블 스키마는 변경 안 함
- [ ] (운영팀 협의) DB 접속정보·전용계정·권한, `program_name`/`source` 식별자 등록, 자체 테이블 이름·용도 공유

---

### 부록. WorkBench가 이 DB를 읽는 위치 (왜 위 규칙을 지켜야 하는가)

| WorkBench 기능 | 읽는 조건 |
|------|-----------|
| MyProject 이력 | `employee_id = 사번 AND source != 'WorkbenchSample'`, `created_at DESC` |
| 대시보드 Top Programs | `program_name` 그룹 카운트 |
| 사용 리포트(D/W/M) | 기간 내 `source != 'WorkbenchSample'`, `users.is_developer = 0`, `program_name`·`department`·시간대 집계 |
| 월별 사용자 해석 건수 | `employee_id` + `created_at` 월 범위 카운트 |
