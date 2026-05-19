# Job 상태 안정성 설계

> 이 문서는 설계 명세입니다. 코드 변경은 별도 PR로 진행합니다.

## 현재 한계

`app/services/job_manager.py` `JobStatusStore` (라인 17~76):

- **인메모리 dict** — 서버 재시작 시 진행 중 job 상태 전부 소실
- 폴링 클라이언트가 `404 Not Found` 또는 빈 응답을 받으며 UI 멈춤
- `Analysis` 테이블에 `status` 컬럼은 있으나 `progress`, `message`, 타임스탬프 없음

```python
# 현재 구조 (job_manager.py:17)
class JobStatusStore:
    _store: dict[str, dict] = {}   # job_id → {status, progress, message, _created_at}
```

---

## 제안 설계

### 1. Analysis 테이블 컬럼 추가

```sql
ALTER TABLE analysis
  ADD COLUMN job_status  VARCHAR(20)  DEFAULT 'completed',
  ADD COLUMN progress    SMALLINT     DEFAULT 100,
  ADD COLUMN job_message TEXT         DEFAULT NULL,
  ADD COLUMN started_at  DATETIME     DEFAULT NULL,
  ADD COLUMN updated_at  DATETIME     DEFAULT NULL;
```

> SQLAlchemy `Base.metadata.create_all` 은 ALTER를 실행하지 않습니다.
> 수동 SQL 또는 Alembic migration 필요 (본 PR 미포함).

### 2. JobStatusStore write-through

`set` 시 DB에도 동시 기록합니다:

```python
def set(self, job_id: str, status: str, progress: int, message: str = ""):
    self._store[job_id] = {...}   # 기존 인메모리 유지
    # 추가: DB Analysis 레코드의 job_status, progress, job_message, updated_at 갱신
    with SessionLocal() as db:
        analysis = db.query(Analysis).filter_by(job_id=job_id).first()
        if analysis:
            analysis.job_status  = status
            analysis.progress    = progress
            analysis.job_message = message
            analysis.updated_at  = datetime.utcnow()
            db.commit()
```

### 3. 서버 시작 시 Interrupted 마킹

`app/main.py` lifespan startup hook에서:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 시작 시: Running 상태 잔여 job → Interrupted
    with SessionLocal() as db:
        db.query(Analysis)\
          .filter(Analysis.job_status == "running")\
          .update({"job_status": "interrupted", "job_message": "서버 재시작으로 중단됨"})
        db.commit()
    yield
```

### 4. My Projects UI — Interrupted 상태 뱃지

`pages/analysis/MyProjects.jsx` `FileRetentionBadge` 옆에 추가:

| 상태 | 색상 | 아이콘 | 툴팁 |
|------|------|--------|------|
| `interrupted` | 회색 | ⚠ AlertTriangle | 서버 재시작 시 중단됨 |

---

## 마이그레이션 절차 (추후)

1. Alembic 도입: `pip install alembic`, `alembic init alembic`
2. revision 생성: `alembic revision --autogenerate -m "add job status columns"`
3. 검토 후 적용: `alembic upgrade head`
4. 롤백: `alembic downgrade -1`

---

## 관련 코드

- `app/services/job_manager.py:17-76` — JobStatusStore 인메모리 구현
- `app/models.py` — Analysis 모델
- `app/main.py` — lifespan hook
- `pages/analysis/MyProjects.jsx` — FileRetentionBadge, 상태 뱃지
