# 릴리즈 Smoke Test 범위

## 현재 자동화 항목

`scripts/smoke-test.ps1` 이 다음을 검증합니다:

| # | 항목 | 명령/방법 | 실패 조건 |
|---|------|-----------|-----------|
| 1 | Python 문법 | `python -m compileall -q app/` | `compileall` exit code ≠ 0 |
| 2 | 필수 파일 존재 | `Test-Path` 7개 파일 | 누락 파일 있음 |
| 3 | Frontend build | `npm run build` + `dist/index.html` | build 실패 또는 index.html 없음 |
| 4 | exe 산출물 | `dist_electron/HiTESS-WorkBench-v{ver}*.exe` | 파일 없음 |
| 5 | 버전 4곳 동기화 | `check-versions.ps1` exit code | exit 1 |
| 6* | GET / (health) | `http://127.0.0.1:9099/` | HTTP ≠ 200 |
| 7* | GET /api/version | 응답 `.version` == `SERVER_VERSION` | 버전 불일치 |

\* `-WithServerCheck` 플래그 필요 (임시 포트 9099, uvicorn 기동)

---

## 추후 자동화 후보

### POST /member/check_user

- **목적**: 비로그인 사용자 식별 API 동작 확인
- **요청**: `{ "userID": "TEST001", "company": "HHI" }`
- **기대**: `{ "exists": false }` 또는 `{ "exists": true, "is_active": ... }`
- **의존 자원**: DB 접속 (users 테이블)
- **비고**: 테스트용 더미 사번 필요

### POST /api/analysis/beam/request

- **목적**: 비동기 큐 진입 확인 (실제 exe 미실행)
- **요청**: 최소 CSV + 파라미터 페이로드
- **기대**: `{ "job_id": "...", "status": "queued" }`
- **의존 자원**: DB + `InHouseProgram/BeamAnalysis/` exe 존재

### GET /api/analysis/status/{job_id}

- **목적**: 위에서 받은 job_id 로 상태 폴링 1회
- **기대**: `{ "status": "queued"|"running"|"completed" }`
- **의존 자원**: in-memory JobStatusStore (서버 재시작 불가)

### GET /api/download?filepath=../etc/passwd (음성 케이스)

- **목적**: path traversal 차단 확인
- **기대**: HTTP 403 또는 400
- **근거**: `routers/analysis.py` `os.path.abspath` 프리픽스 검사

### GET /api/analysis/history

- **목적**: 빈 DB에서도 응답 형태 정상 여부
- **기대**: `{ "items": [], "total": 0 }` 형태

### GET /api/activity/logs (관리자)

- **목적**: 30일 제한 적용 확인
- **요청**: 관리자 세션 헤더 필요
- **기대**: `started_at` 범위가 최근 30일 이내
- **근거**: `routers/activity.py:25` `_bounded_date_range`

---

## 동적 테스트 실행 방법 (수동)

```powershell
# 정적 검증
pwsh scripts/smoke-test.ps1

# 동적 서버 헬스까지
pwsh scripts/smoke-test.ps1 -WithServerCheck
```
