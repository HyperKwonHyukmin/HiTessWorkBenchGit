# 관리자용 사용량 리포트 (Daily / Weekly / Monthly) 설계 문서

- **작성일**: 2026-05-21
- **상태**: 설계 승인 대기
- **요청자**: KwonHyukMin (관리자 사용량 가시성 향상)
- **대상 기능**: HiTESS WorkBench Administration ▸ Usage Reports

---

## 1. 배경 & 목표

### 1-1. 배경

현재 `Administration ▸ Analysis Management` 페이지는 전체 해석 이력 위에 자유로운 날짜 필터를 얹어 통계를 보여주는 **탐색형 대시보드**다. 관리자는 모든 기간의 데이터를 한 화면에서 검색·드릴다운할 수 있다.

그러나 관리자는 정기적으로 "지난 하루/지난 한 주/지난 한 달의 자동화 사용 현황"을 정형화된 형태로 확인하고 싶어 한다. 정형 리포트는 다음의 가치를 준다:

1. **정해진 기간 단위로의 명확한 단절** — "오늘은 어제 데이터를, 월요일엔 지난주 데이터를 본다"
2. **전 기간 대비 비교** — 사용량 증감 추세를 한눈에
3. **외부 공유 가능한 산출물** — Excel로 내려받아 회의 자료·경영진 보고에 활용

### 1-2. 목표

- 관리자 전용 `Usage Reports` 페이지 신설
- Daily / Weekly / Monthly 탭 제공, 각 탭은 달력 기준 기간(어제 / 지난주 월~일 / 지난달 1~말일)
- 모든 KPI에 전 기간 대비 증감(▲▼ %) 표시
- 임의 과거 기간을 날짜 피커로 조회 가능
- Excel(.xlsx) 다운로드 — 6개 시트 구성

### 1-3. 비목표 (이번 범위에서 제외)

- PDF/메일 자동 발송 — v2 후보
- 스냅샷 저장(과거 시점 수치 보존) — v2 후보, 현 단계는 항상 live 계산
- `activity_logs` 테이블 활용 — 본 리포트는 "해석 실행" 중심 (구조해석 자동화 사용률)
- 트레일링 기간(최근 N일) 모드 — 달력 기준만 지원
- YoY(전년 동기) 비교 — 데이터 누적 부족

---

## 2. 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│ Frontend (React)                                              │
│   Administration ▸ Usage Reports                              │
│   ├─ PeriodTabs        [Daily | Weekly | Monthly]            │
│   ├─ PeriodNavigator   ◀ 2026-05-20 (어제) ▶  [📅 날짜 선택]  │
│   ├─ KPI 카드 (전 기간 대비 ▲▼ 포함)                          │
│   ├─ 기간 맞춤 시간축 차트 (시간/요일/일자)                    │
│   ├─ 프로그램 랭킹  /  사용자 랭킹  /  부서 분포              │
│   └─ [⬇ Excel 다운로드]                                       │
└──────────────────────────────────────────────────────────────┘
                          ▲ JSON
                          │
┌──────────────────────────────────────────────────────────────┐
│ Backend (FastAPI)  routers/analysis.py                        │
│   GET  /api/analysis/report?period=&date=                    │
│   GET  /api/analysis/report/export-xlsx?period=&date=        │
└──────────────────────────────────────────────────────────────┘
                          ▲ SQLAlchemy
                          │
                ┌────────────────────┐
                │ analysis (MySQL)   │  ← 기존 테이블, 변경 없음
                └────────────────────┘
```

**핵심 결정**

- DB 스키마 변경 없음 — 기존 `analysis` 테이블만 사용
- 신규 백엔드 엔드포인트 2개 (조회 / 엑셀)
- '개발자 제외' 정책은 기존 AnalysisManagement와 동일 (통계엔 제외, raw data 시트엔 포함)
- 권한: 사이드바에서 admin만 보이지만 백엔드도 `is_admin` 검증 추가 (이중 방어)

---

## 3. 컴포넌트 분해 & 파일 배치

### 3-1. 프론트엔드

```
HiTessWorkBench/frontend/src/
├─ pages/Administration/
│   └─ UsageReports.jsx                    [신규] 페이지 컨테이너
├─ components/admin/reports/                [신규 디렉토리]
│   ├─ PeriodTabs.jsx                      Daily/Weekly/Monthly 탭
│   ├─ PeriodNavigator.jsx                 ◀ 기간라벨 ▶ + 날짜 피커
│   ├─ ReportKpiGrid.jsx                   KPI 카드 + 전기간 대비 델타
│   ├─ PeriodTimeChart.jsx                 기간별 시간축 차트(시간/요일/일자)
│   ├─ ReportProgramsTable.jsx             프로그램 랭킹
│   ├─ ReportUsersTable.jsx                사용자 랭킹
│   ├─ ReportDepartmentChart.jsx           부서 분포
│   └─ ExportXlsxButton.jsx                Excel 다운로드 버튼
├─ api/
│   └─ reports.js                          [신규] getUsageReport, downloadUsageReportXlsx
├─ App.jsx                                  [수정] case 'Usage Reports' 라우팅 추가
└─ (sidebar/menu 설정 파일)                 [수정] Administration 카테고리에 메뉴 추가
```

### 3-2. 백엔드

```
HiTessWorkBenchBackEnd/app/
├─ routers/analysis.py                     [수정] 엔드포인트 2개 추가
├─ services/
│   └─ usage_report_service.py             [신규] 집계 + xlsx 빌더
│       ├─ resolve_period(period, date) → PeriodBounds
│       ├─ aggregate_period(db, start, end) → ReportSummary dict
│       └─ build_report_xlsx(current, previous, raw_rows) → BytesIO
└─ schemas/usage_report.py                  [신규] Pydantic 응답 모델
```

### 3-3. 기존 코드 재활용

- `AnalysisStatsDashboard.jsx`의 내부 함수(`KpiCard`, `ProgramTable`, `UserTable`)를 동일 파일에서 export하도록 살짝 리팩토링 → 신규 Report 컴포넌트가 import해서 재사용
- `routers/analysis.py`의 기존 `export-xlsx` 인프라(BytesIO + DRM 우회 패턴)를 그대로 차용

### 3-4. 원칙

- 한 컴포넌트 = 한 책임. 페이지 컨테이너는 데이터 패칭과 레이아웃만, 시각화는 각 컴포넌트가 독립적으로 렌더
- 파일당 200줄 안쪽 목표

---

## 4. 백엔드 API 명세

### 4-1. `GET /api/analysis/report`

**쿼리 파라미터**

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `period` | `"daily" \| "weekly" \| "monthly"` | ✓ | 리포트 기간 단위 |
| `date` | `YYYY-MM-DD` | ✗ | 이 날짜가 속한 기간 (미지정 시 기본값) |

**기본값 규칙** (date 미지정 시)

- daily → 어제
- weekly → 지난주 (오늘이 속한 주의 이전 주, 월~일)
- monthly → 지난달

**응답 (200 OK)** — `application/json`

```jsonc
{
  "period": {
    "type": "weekly",
    "start": "2026-05-11T00:00:00",
    "end":   "2026-05-17T23:59:59",
    "label": "2026-05-11 ~ 2026-05-17 (지난주)"
  },
  "previous": {
    "start": "2026-05-04T00:00:00",
    "end":   "2026-05-10T23:59:59",
    "label": "2026-05-04 ~ 2026-05-10"
  },
  "summary": {
    "total":            145,
    "activePrograms":   8,
    "activeUsers":      23,
    "activeDepartments": 5,
    "avgPerDay":       20.7,
    "maxDay":          34,
    "busiestProgram":  "Truss Assessment",
    "peakHour":        "14시",
    "newUsers":        2
  },
  "deltas": {
    "total":          { "abs":  22, "pct":  18.0 },
    "activeUsers":    { "abs":   3, "pct":  15.0 },
    "activePrograms": { "abs":  -1, "pct": -11.1 },
    "avgPerDay":      { "abs": 3.1, "pct":  17.6 }
  },
  "programs": [
    { "name": "Truss Assessment", "count": 48, "share": 33, "userCount": 9, "lastRun": "2026-05-17T16:32:00" }
  ],
  "users": [
    { "employeeId": "12345", "name": "홍길동", "department": "구조해석팀",
      "count": 18, "share": 12, "programCount": 3, "lastRun": "2026-05-16T11:08:00" }
  ],
  "departments": [
    { "name": "구조해석팀", "count": 87 }
  ],
  "timeBuckets": {
    "type": "weekday",
    "data": [
      { "label": "월", "count": 24 },
      { "label": "화", "count": 31 }
    ]
  }
}
```

`deltas`의 `pct`는 이전 기간 값이 0이면 `null`.

**오류**

- `400` — `period` 값 오류, 미래 날짜
- `401` — 인증 토큰 누락/만료 (기존 `require_auth`)
- `403` — admin 권한 없음 (`require_admin`)
- `500` — DB 오류

### 4-2. `GET /api/analysis/report/export-xlsx`

**쿼리 파라미터**: 위와 동일.

**응답**: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

**Excel 시트 구성**

| 시트 | 내용 |
|------|------|
| `Summary` | 기간 라벨, 모든 KPI, 전 기간 대비 델타 |
| `Programs` | 순위/이름/실행수/점유율/사용자수/최근실행 |
| `Users` | 순위/사번/이름/부서/실행수/점유율/사용프로그램수/최근실행 |
| `Departments` | 부서명/실행수/점유율 |
| `Time Distribution` | period에 따라 시간대(0~23시) / 요일(월~일) / 일자(1~말일) 막대 데이터 |
| `Raw Data` | 기간 내 모든 해석 행 (ID/프로젝트/프로그램/사번/이름/부서/상태/실행시각/개발자여부) |

**파일명**: `WorkBench_UsageReport_{Daily|Weekly|Monthly}_{startYYYYMMDD}_{endYYYYMMDD}.xlsx`

**구현**: 기존 `export-xlsx` 엔드포인트와 동일 — `openpyxl`로 BytesIO에 작성 → `StreamingResponse`로 반환 (디스크 저장 X, DRM 우회).

### 4-3. 공유 서비스 로직

두 엔드포인트는 `usage_report_service.py`의 `resolve_period()` + `aggregate_period()`를 공유해 화면과 엑셀 수치가 100% 일치하도록 한다.

---

## 5. 데이터 흐름 & 기간 계산 로직

### 5-1. 사용자 시나리오 흐름

```
1. 관리자 로그인 → 사이드바 'Administration ▸ Usage Reports' 클릭
       │
       ▼
2. UsageReports.jsx 마운트
       │  · 초기 state: period='daily', date=어제
       │  · useEffect → getUsageReport({period, date})
       ▼
3. 응답 도착 → KPI, 차트, 테이블 렌더
       │
       ├─ [탭 전환] 'Weekly' 클릭
       │     · period='weekly', date=오늘 (서버가 지난주로 보정)
       │     · 재요청
       │
       ├─ [날짜 변경] PeriodNavigator의 ◀/▶ 또는 📅
       │     · date 갱신 → 재요청
       │     · 미래 날짜는 비활성화
       │
       └─ [⬇ Excel] 클릭
             · fetch + Blob → a.click() (기존 export-xlsx 패턴과 동일)
             · 진행 중엔 버튼 spinner, 실패 시 토스트
```

### 5-2. 기간 경계 계산 (`resolve_period`)

모든 경계는 **로컬 타임(KST)** 기준.

| period | start | end | label |
|--------|-------|-----|-------|
| `daily` | `date` 00:00:00 | `date` 23:59:59.999999 | `"YYYY-MM-DD (요일)"` |
| `weekly` | `date`가 속한 주의 **월요일** 00:00:00 | 같은 주 **일요일** 23:59:59 | `"YYYY-MM-DD ~ YYYY-MM-DD"` |
| `monthly` | `date`가 속한 달의 **1일** 00:00:00 | 같은 달 **말일** 23:59:59 | `"YYYY-MM"` |

**이전 기간(previous)** — 비교 델타 계산용

- daily: 하루 전
- weekly: 7일 전 ~ 13일 전 (직전 주)
- monthly: 직전 달 1일~말일 (`relativedelta(months=-1)`)

**기본 date (date 미지정)** — '완료된' 기간을 보여주기 위한 보정

- daily: `today - 1`
- weekly: `today - 7` → resolve_period가 지난주 월~일로 보정
- monthly: `today.replace(day=1) - 1` → 지난달로 보정

**미래 차단**: `start > now` 면 400 응답 ("미래 기간은 조회할 수 없습니다")

### 5-3. 집계 로직 (`aggregate_period`)

```python
def aggregate_period(db, start, end, period):
    base_q = (
        db.query(Analysis, User)
          .outerjoin(User, Analysis.employee_id == User.employee_id)
          .filter(Analysis.created_at >= start)
          .filter(Analysis.created_at <= end)
    )
    stats_rows = [(a, u) for a, u in base_q.all() if not (u and u.is_developer)]

    total = len(stats_rows)
    programs = Counter()
    users = {}
    depts = Counter()

    for a, u in stats_rows:
        programs[a.program_name] += 1

    if period == 'daily':
        buckets = count_per_hour(stats_rows)
    elif period == 'weekly':
        buckets = count_per_weekday(stats_rows)
    else:
        buckets = count_per_day_of_month(stats_rows)

    return ReportSummary(...)
```

**왜 in-memory 집계?**
- 사내 도구라 기간당 행 수가 수십~수백 수준
- DB GROUP BY를 여러 번 던지는 것보다 한 번 SELECT 후 Python 가공이 단순하고 충분히 빠름
- 행 수가 폭증하면 그때 SQL GROUP BY로 옮긴다 (YAGNI)

### 5-4. 신규 사용자 계산

해당 기간이 그 사용자의 **첫 실행 기간**이면 `newUser`로 카운트.

```sql
(SELECT MIN(created_at) FROM analysis WHERE employee_id = u) BETWEEN start AND end
```

기존 AnalysisManagement의 '최근 30% 구간 컷오프'보다 정확하고 정형 리포트에 어울리는 정의.

### 5-5. 캐싱

- **하지 않음.** 기간이 짧고 admin만 보는 페이지라 부하 무시 가능. 항상 fresh.
- 실측 부하 문제 발생 시 Redis 또는 in-process LRU 도입 (YAGNI)

---

## 6. 오류 처리

### 6-1. 백엔드

| 상황 | 응답 | 동작 |
|------|------|------|
| `period` 값 오류 | `400` `{"detail": "period는 daily, weekly, monthly 중 하나여야 합니다"}` | Pydantic Literal 자동 검증 |
| `date` 포맷 오류 | `400` `{"detail": "date는 YYYY-MM-DD 형식이어야 합니다"}` | Pydantic 검증 |
| `date`가 미래 | `400` `{"detail": "미래 기간은 조회할 수 없습니다"}` | `resolve_period`에서 명시적 raise |
| admin 권한 없음 | `403` `{"detail": "관리자 권한이 필요합니다"}` | `require_admin` 의존성 |
| 토큰 누락/만료 | `401` (기존 `require_auth`) | 기존 패턴 |
| DB 오류 | `500` `{"detail": "리포트 데이터를 불러오지 못했습니다"}` | try/except → 로깅 + 일반화 메시지 |
| 기간 내 데이터 0건 | `200` (정상, summary.total=0) | 오류 아님 |
| Excel 빌드 실패 | `500` `{"detail": "Excel 생성 중 오류가 발생했습니다"}` | try/except |

5xx만 stack trace 로깅, 4xx는 정상 흐름이라 로그 안 남김.

### 6-2. 프론트엔드

```
UsageReports.jsx 상태 머신

  loading=true  →  스피너 (RefreshCw 회전)
  error≠null    →  중앙에 에러 카드 + [다시 시도] 버튼
  data && total=0 → "{기간 라벨}에 해석 기록이 없습니다"
  data && total>0 → 정상 렌더

  Excel 다운로드:
    - 진행중: 버튼 disabled + spinner
    - 실패: 토스트 "Excel 다운로드 실패 — 다시 시도해주세요"
```

**경합 방지**: 탭/날짜 빠른 전환 시 이전 요청이 늦게 도착해 화면을 덮어쓰지 않도록 AbortController 사용.

**미래 날짜 가드**: PeriodNavigator의 ▶ 버튼은 다음 기간이 오늘보다 뒤면 disabled. 사용자가 datepicker로 직접 미래 입력 시 즉시 토스트 + 요청 안 보냄.

**에러 메시지**: 백엔드 `detail`(이미 한글)을 그대로 노출. 네트워크 오류 시 `"네트워크 연결을 확인해주세요"` 폴백.

---

## 7. 테스트 전략

### 7-1. 백엔드 (pytest)

신규 파일 `HiTessWorkBenchBackEnd/tests/test_usage_report.py`:

| 테스트 | 검증 내용 |
|--------|-----------|
| `test_resolve_period_daily` | 어제 경계 (월·연 경계 포함) |
| `test_resolve_period_weekly_crosses_month` | 월 경계에 걸친 주(예: 5/31이 일요일) |
| `test_resolve_period_monthly_leap_year` | 2024년 2월 = 29일, 2025년 2월 = 28일 |
| `test_resolve_period_future_raises` | 미래 date 입력 시 예외 |
| `test_aggregate_excludes_developers` | is_developer=True 행이 통계에서 빠지고 raw에는 포함 |
| `test_aggregate_empty_period` | 0건 기간 → total=0, 빈 배열, 예외 없음 |
| `test_aggregate_deltas_against_previous` | abs/pct 계산 정확성, 이전=0일 때 pct=null |
| `test_new_users_detection` | 첫 실행이 해당 기간 내인 사용자만 카운트 |
| `test_report_endpoint_requires_admin` | 일반 사용자 토큰 → 403 |
| `test_export_xlsx_sheets_present` | 응답 XLSX를 다시 openpyxl로 열어 6개 시트명/헤더 검증 |
| `test_export_xlsx_summary_matches_json` | 동일 (period, date)에서 JSON·Excel KPI 수치 일치 |

**Fixture**: 인메모리 SQLite + 가짜 Analysis/User 시드. 기존 테스트 패턴 확인 후 일치시킨다.

### 7-2. 프론트엔드

코드베이스에 frontend 자동 테스트 인프라가 없어(`vitest`/`jest` 미설정) **자동 테스트는 추가하지 않음**. 대신 수동 체크리스트:

- [ ] 사이드바에 'Usage Reports' 메뉴가 admin에게만 보임
- [ ] Daily 탭 기본 진입 시 어제 날짜로 데이터 로드
- [ ] Weekly/Monthly 탭 전환 시 올바른 기간으로 보정
- [ ] ◀/▶ 버튼으로 이전/다음 기간 이동, 미래는 disabled
- [ ] 날짜 피커로 임의 과거 날짜 선택 가능
- [ ] 빈 기간 → "기록이 없습니다" 메시지
- [ ] KPI 카드의 ▲▼ 델타가 음/양수에 따라 색·아이콘 변화
- [ ] 시간축 차트가 period별로 24시간/요일/일자로 바뀜
- [ ] Excel 다운로드 → 파일 열어 시트 6개 모두 데이터 있음
- [ ] 일반 사용자 계정으로 직접 URL 접근 시 차단 (사이드바에 안 보이고 API도 403)

### 7-3. 검증 명령

```powershell
# 백엔드
cd HiTessWorkBenchBackEnd
WorkBenchEnv\Scripts\activate
pytest tests/test_usage_report.py -v

# 프론트엔드 (수동)
cd HiTessWorkBench
npm run dev
# → admin 계정으로 로그인 → Administration ▸ Usage Reports
```

---

## 8. 구현 시 확인 필요 사항

설계가 가정한 항목 중, 구현 단계에서 코드를 보고 확정해야 할 것:

1. **사이드바 메뉴 설정 위치** — Administration 카테고리에 메뉴 추가하는 파일 (Sidebar 컴포넌트 또는 `ANALYSIS_DATA` 외 별도 설정)
2. **`require_admin` 의존성 존재 여부** — 없다면 신규 추가 (`require_auth` + User 조회 + `is_admin` 검증)
3. **백엔드 테스트 fixture 패턴** — 인메모리 SQLite 사용 여부, factory 라이브러리 종류
4. **created_at 타임존 정책** — `DateTime(timezone=True)` 컬럼이 실제 어떤 tz로 저장되는지 (KST 변환 필요 여부)
5. **`User.is_developer` 컬럼 존재 확인** — AnalysisManagement에서 사용 중이므로 확실하지만, 이름 정확히 일치 검증

---

## 9. 향후 확장(v2 후보)

본 설계는 의도적으로 단순화. 다음은 별도 사이클에서 검토:

- **자동 메일/사내 메신저 발송** — APScheduler + SMTP 또는 사내 알림 API
- **스냅샷 보존** — `usage_report_snapshots` 테이블 신설, 매일 0시 cronjob
- **사용자 자기 통계** — 일반 사용자가 본인 사용 패턴을 보는 미니 위젯
- **`activity_logs` 결합** — 페이지뷰·다운로드까지 포함한 종합 engagement 리포트
- **PDF 경영진 요약** — A4 1~2장, WeasyPrint 도입

---

## 10. 부록: 메뉴 카피

- 한글 표기 없음, 영문 단일화 (CLAUDE.md 정책)
- Administration 카테고리 아래 정렬 순서: User Management → Analysis Management → **Usage Reports** → System Settings → API Apps
