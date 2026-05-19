# 감사 로그 정책

## 기본 원칙

- **업무 감사 의미 있는 이벤트 위주**로 기록합니다. 모든 클릭을 기록하지 않습니다.
- 조회 범위는 **최근 30일**로 고정합니다 (`routers/activity.py:25` `_bounded_date_range`).
- 로그 데이터는 DB에 영구 보존됩니다. 30일 제한은 조회 API에만 적용됩니다.

---

## 현재 자동 기록 이벤트

| 이벤트 | 기록 위치 | 설명 |
|--------|-----------|------|
| `LOGIN` | `routers/auth.py` | 사번 기반 로그인 |
| `LOGOUT` | `App.jsx` | 세션 종료 |
| `PAGE_VIEW` | `NavigationContext.jsx` | 30초 디바운싱, 중복 제거 |
| `ANALYSIS_REQUEST` | `api/analysis.js` wrapper | 해석 작업 제출 |
| `ANALYSIS_COMPLETE` | `analysis_runner.py` | 해석 성공 완료 |
| `ANALYSIS_FAILED` | `analysis_runner.py` | 해석 오류 |
| `EXPORT_XLSX` | `routers/analysis.py` | TrussAssessment Excel 내보내기 |
| `FILE_DOWNLOAD` | `routers/analysis.py` | 결과 파일 다운로드 |
| `PROGRAM_DOWNLOAD` | `routers/system.py` | 클라이언트 exe 다운로드 |
| `VERSION_UPDATE` | `routers/system.py` | 클라이언트 버전 업데이트 확인 |

---

## 추가 기록 권장 이벤트

아직 구현되지 않은 이벤트입니다. 향후 별도 PR로 추가합니다.

| 이벤트 | 트리거 | 이유 |
|--------|--------|------|
| `USER_APPROVE` | 관리자 사용자 승인 | 승인 이력 감사 필요 |
| `USER_DEACTIVATE` | 관리자 사용자 비활성 | 비활성화 이력 감사 필요 |
| `NOTICE_EDIT` | 공지 생성/수정/삭제 | 관리자 콘텐츠 변경 추적 |
| `GUIDE_EDIT` | 사용자 가이드 변경 | 관리자 콘텐츠 변경 추적 |
| `REQUEST_STATUS_CHANGE` | 기능 요청 상태 변경 | 처리 이력 관리 |
| `DOWNLOAD_EXPIRED` | 만료 파일 다운로드 시도 | 사용자 UX 개선 + 감사 |

---

## 조회 제한 구현

```python
# routers/activity.py:25
def _bounded_date_range(start: date | None, end: date | None) -> tuple[date, date]:
    today  = date.today()
    _end   = min(end or today, today)
    _start = max(start or today - timedelta(days=30), _end - timedelta(days=30))
    return _start, _end
```

30일을 초과하는 범위 요청은 자동으로 최근 30일로 클리핑됩니다.

---

## 관련 코드

- `app/routers/activity.py` — 로그 조회 API
- `app/services/activity_service.py` — `log_activity()` 함수
- `app/models.py` — `ActivityLog` 모델
- `pages/Administration/UserManagement.jsx` — 관리자 활동 로그 뷰
