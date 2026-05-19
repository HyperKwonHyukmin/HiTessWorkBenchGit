# My Projects / 파일 만료 정책

## 요약

| 항목 | 정책 |
|------|------|
| 실제 파일 보관 기간 | **30일** |
| DB 이력 보관 | **영구** |
| 만료 후 조회 | 메타데이터·요약 가능, 파일 다운로드 불가 |
| 삭제 스케줄 | 서버 시작 직후 + **매일 자정** |

---

## 파일 생명주기

```
해석 요청 → userConnection/{timestamp}_{employee_id}_{ProgramName}/ 생성
           → 입력 파일, 결과 파일 저장
           → DB Analysis 레코드 생성 (result_info JSON)

30일 후  → cleanup_service.py 가 폴더 삭제
           → DB 레코드는 유지
           → UI에서 "파일 만료" 뱃지 표시
```

---

## 구현 세부

### cleanup_service.py

```python
# app/services/cleanup_service.py:22-130
RETENTION_DAYS = 30
_USER_CONN_DIR = BASE_DIR / "userConnection"

# 서버 시작 직후 1회 + 매일 자정 반복 (daemon thread)
def _cleanup_loop():
    _do_cleanup()
    while True:
        now = datetime.now()
        next_midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0)
        time.sleep((next_midnight - now).total_seconds())
        _do_cleanup()
```

### _files_available() 체크

```python
# routers/analysis.py:121-137
def _files_available(result_info: dict) -> bool:
    """result_info 의 input/result 경로 파일이 실제로 존재하는지 확인."""
    paths = []
    paths += result_info.get("input_files", [])
    paths += result_info.get("result_files", [])
    return all(os.path.exists(p) for p in paths)
```

### My Projects UI

`pages/analysis/MyProjects.jsx` `FileRetentionBadge`:

- **파일 보관 중**: 초록 뱃지, 다운로드 버튼 활성
- **파일 만료**: 회색 뱃지, 다운로드 버튼 비활성, 툴팁 "30일 경과"

---

## 만료 후 남는 정보

DB `Analysis` 테이블에서 영구 조회 가능:

- 해석 유형, 프로그램명, 제출자(user_id), 제출일시
- `result_info` JSON 요약 (파일명, 파라미터, 수치 결과 요약 등)
- 완료 상태 및 소요 시간

## 만료 후 사라지는 정보

- 입력 파일 (CSV, BDF 등)
- 결과 파일 (xlsx, F06, 로그 등)
- `userConnection/{...}/` 폴더 전체

---

## 미래 고려사항 (본 PR 미포함)

- **만료 임박 알림**: 25일차 이후 "X일 후 파일 만료" 경고 뱃지
- **영구 보관 마킹**: 중요 프로젝트는 삭제 제외 옵션
- **관리자 수동 정리**: 어드민 페이지에서 특정 프로젝트 즉시 삭제

---

## 관련 코드

- `app/services/cleanup_service.py` — RETENTION_DAYS, `_cleanup_loop`, `_do_cleanup`
- `app/routers/analysis.py:121-137` — `_files_available()`
- `pages/analysis/MyProjects.jsx` — `FileRetentionBadge` 컴포넌트
