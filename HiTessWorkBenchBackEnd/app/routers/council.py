"""구조해석 자동화 협의체 과제 현황 API(2026-11-25).

부서별 자동화 수요(과제)와 그 진행 기록, 팀장과 실장님의 의견을 관리자 계정끼리 함께 보고 고친다.
화면 = WorkBench 관리자 메뉴 'Automation Council' + 브라우저 주소 /council/ (페이지는 routers/admin_web.py 가 내준다).
계획 = docs/plans/2026-11-25-automation-council-tasks-plan.md

권한: 모든 경로가 is_admin(require_admin). 과제와 기록의 생성, 수정, 삭제도 관리자라면 누구나(사용자 결정).
/api/council/access 만 비관리자에게 200 {allowed:false} 를 준다(브라우저 입구 검사 — 403 이면 화면 네트워크 진단이 경고를 쌓는다).

⚠ 목록은 ORDER BY 없이 읽고 파이썬에서 정렬한다(TEXT 칸이 낀 표의 MySQL 정렬 버퍼 오류 회피).
"""
from __future__ import annotations

import re
import threading
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import database, models
from app.dependencies import require_admin
from app.sessions import session_store

router = APIRouter(prefix="/api/council", tags=["council"])

STATUSES = ("reviewing", "developing", "piloting", "done", "hold")
STATUS_LABELS = {
    "reviewing": "검토 중",
    "developing": "개발 중",
    "piloting": "시험 운영",
    "done": "완료",
    "hold": "보류",
}
NOTE_KINDS_WRITABLE = ("progress", "comment")   # status 는 서버만 남긴다
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MAX_BODY = 5000
# 넣기를 두 관리자가 동시에 눌러도 한 번만(uvicorn 워커 1개 전제 — 인증의 틀린 시도 제한과 같은 전제).
_seed_lock = threading.Lock()

# 1차 회의(2026-11-24)에서 부서가 말한 후속 검토 10건. 표가 비어 있을 때만 '1차 회의 수요 넣기'로 들어간다.
FIRST_MEETING_SOURCE = "1차 회의 (2026-11-24)"
FIRST_MEETING_TASKS = [
    {"department": "선장설계", "title": "Hi-TESS 사용 피드백 창구",
     "summary": "현업이 쓰다가 생긴 문제와 요청을 바로 전달할 창구가 필요하다."},
    {"department": "선장설계", "title": "권상 시뮬레이션 속도 개선",
     "summary": "부서 해석 의뢰의 70~80% 가 권상이다. 권상 해석 시간을 줄이는 방안."},
    {"department": "선장설계", "title": "정반 해석 2D 모델",
     "summary": "정반 해석을 2D 모델로 빠르게 검토하는 방안."},
    {"department": "선장설계", "title": "부서 플랫폼 개발 컨설팅", "requester": "조혜민 책임",
     "summary": "부서 자체 플랫폼 개발에 대한 기술 자문."},
    {"department": "미래기술개발부", "title": "Nastran 해석 완료와 오류 알림",
     "summary": "해석 완료 알림, 오류가 났을 때 알림과 처리 안내. 선급 프로그램과 FEGate 탑재 계획과 연계."},
    {"department": "전장설계", "title": "호선 국부 전장품 진동 해석",
     "summary": "현재 외부에 의뢰하는 호선 국부 전장품 진동 해석을 자체 수행하는 방안."},
    {"department": "기장설계", "title": "모듈 유닛과 그룹 유닛 구조 및 권상 해석", "important": True,
     "summary": "모듈 유닛과 그룹 유닛의 구조 해석과 권상 해석. 부서 우선순위 높음."},
    {"department": "기장설계", "title": "탱크 구조 해석 Pass, Fail 표시",
     "summary": "탱크 구조 해석 결과를 Pass, Fail 로 바로 보이게."},
    {"department": "건조기술기획부", "title": "추출 모델 기반 해석 모델 보관과 활용",
     "summary": "추출 모델로 만든 해석 모델을 보관하고 다시 활용하는 방안."},
    {"department": "선체설계1부", "title": "작은 탱크 스캔틀링 자동화",
     "summary": "작은 탱크의 스캔틀링 검토를 자동화."},
]


# ── 입력 모양 ─────────────────────────────────────────────────────────────

class TaskIn(BaseModel):
    title: str = Field(..., max_length=200)
    department: str = Field(..., max_length=100)
    requester: str | None = Field(default=None, max_length=100)
    owner: str | None = Field(default=None, max_length=100)
    status: str = "reviewing"
    important: bool = False
    summary: str | None = Field(default=None, max_length=_MAX_BODY)
    next_step: str | None = Field(default=None, max_length=300)
    due_date: str | None = None
    source: str | None = Field(default=None, max_length=100)


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    department: str | None = Field(default=None, max_length=100)
    requester: str | None = Field(default=None, max_length=100)
    owner: str | None = Field(default=None, max_length=100)
    status: str | None = None
    important: bool | None = None
    summary: str | None = Field(default=None, max_length=_MAX_BODY)
    next_step: str | None = Field(default=None, max_length=300)
    due_date: str | None = None
    source: str | None = Field(default=None, max_length=100)


class NoteIn(BaseModel):
    kind: str = "comment"
    body: str = Field(..., max_length=_MAX_BODY)


class NotePatch(BaseModel):
    body: str = Field(..., max_length=_MAX_BODY)


# ── 도우미 ───────────────────────────────────────────────────────────────

def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def _required(value: str | None, label: str) -> str:
    text = _clean(value)
    if not text:
        raise HTTPException(status_code=422, detail=f"{label}을(를) 입력하세요.")
    return text


def _check_status(status: str) -> str:
    if status not in STATUSES:
        raise HTTPException(status_code=422, detail="알 수 없는 상태입니다.")
    return status


def _check_date(value: str | None) -> str | None:
    text = _clean(value)
    if text is None:
        return None
    if not _DATE_RE.match(text):
        raise HTTPException(status_code=422, detail="목표일은 YYYY-MM-DD 형식이어야 합니다.")
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=422, detail="없는 날짜입니다.")
    return text


def _iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="seconds") if value else None


def _user(db: Session, employee_id: str) -> models.User | None:
    return db.query(models.User).filter(models.User.employee_id == employee_id).first()


def _live_task(db: Session, task_id: int) -> models.CouncilTask:
    task = db.query(models.CouncilTask).filter(models.CouncilTask.id == task_id).first()
    if not task or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="과제를 찾을 수 없습니다.")
    return task


def _note_row(note: models.CouncilNote) -> dict:
    return {
        "id": note.id,
        "task_id": note.task_id,
        "kind": note.kind,
        "body": note.body,
        "author_id": note.author_id,
        "author_name": note.author_name,
        "author_position": note.author_position,
        "author_department": note.author_department,
        "created_at": _iso(note.created_at),
        "updated_at": _iso(note.updated_at),
    }


def _task_row(task: models.CouncilTask, notes: list[dict]) -> dict:
    return {
        "id": task.id,
        "title": task.title,
        "department": task.department,
        "requester": task.requester,
        "owner": task.owner,
        "status": task.status,
        "important": bool(task.important),
        "summary": task.summary,
        "next_step": task.next_step,
        "due_date": task.due_date,
        "source": task.source,
        "created_by": task.created_by,
        "updated_by": task.updated_by,
        "created_at": _iso(task.created_at),
        "updated_at": _iso(task.updated_at),
        "notes": notes,
    }


def _add_note(db: Session, task_id: int, kind: str, body: str, user: models.User | None, employee_id: str) -> models.CouncilNote:
    note = models.CouncilNote(
        task_id=task_id,
        kind=kind,
        body=body,
        author_id=employee_id,
        author_name=(user.name if user else None),
        author_position=(user.position if user else None),
        author_department=(user.department if user else None),
        created_at=datetime.now(),
    )
    db.add(note)
    return note


def _task_with_notes(db: Session, task: models.CouncilTask) -> dict:
    notes = db.query(models.CouncilNote).filter(models.CouncilNote.task_id == task.id).all()
    notes.sort(key=lambda n: (n.created_at or datetime.min, n.id), reverse=True)
    return _task_row(task, [_note_row(n) for n in notes])


# ── 경로 ─────────────────────────────────────────────────────────────────

@router.get("/access")
def council_access(
    authorization: str | None = Header(default=None),
    db: Session = Depends(database.get_db),
):
    """브라우저 입구 검사. 로그인 안 됨 = 401, 관리자가 아님 = 200 {allowed:false}."""
    employee_id = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        employee_id = session_store.get_employee_id(token) if token else None
    if not employee_id:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")
    user = _user(db, employee_id)
    allowed = bool(user and user.is_admin and user.is_active)
    return {
        "allowed": allowed,
        "employee_id": employee_id,
        "name": user.name if (user and allowed) else None,
    }


@router.get("/board")
def council_board(
    employee_id: str = Depends(require_admin),
    db: Session = Depends(database.get_db),
):
    """과제 전체와 각 과제의 기록(최신이 앞). 과제는 수십 건 규모라 한 번에 준다."""
    tasks = db.query(models.CouncilTask).filter(models.CouncilTask.deleted_at.is_(None)).all()
    ids = [t.id for t in tasks]
    notes_by_task: dict[int, list[models.CouncilNote]] = {i: [] for i in ids}
    if ids:
        for note in db.query(models.CouncilNote).filter(models.CouncilNote.task_id.in_(ids)).all():
            notes_by_task.setdefault(note.task_id, []).append(note)
    rows = []
    for task in tasks:
        notes = notes_by_task.get(task.id, [])
        notes.sort(key=lambda n: (n.created_at or datetime.min, n.id), reverse=True)
        rows.append(_task_row(task, [_note_row(n) for n in notes]))
    rows.sort(key=lambda r: r["id"])
    me = _user(db, employee_id)
    return {
        "tasks": rows,
        "statuses": [{"key": k, "label": STATUS_LABELS[k]} for k in STATUSES],
        "me": {"employee_id": employee_id, "name": me.name if me else None},
        # 지운 과제까지 하나라도 있었는가 — 화면이 '1차 회의 수요 넣기'(그때는 409)를 보여 줄지 정한다.
        "has_any": db.query(models.CouncilTask.id).first() is not None,
        "checked_at": datetime.now().isoformat(timespec="seconds"),
    }


@router.post("/tasks")
def create_task(
    payload: TaskIn,
    employee_id: str = Depends(require_admin),
    db: Session = Depends(database.get_db),
):
    now = datetime.now()
    task = models.CouncilTask(
        title=_required(payload.title, "과제 이름"),
        department=_required(payload.department, "의뢰 부서"),
        requester=_clean(payload.requester),
        owner=_clean(payload.owner),
        status=_check_status(payload.status),
        important=bool(payload.important),
        summary=_clean(payload.summary),
        next_step=_clean(payload.next_step),
        due_date=_check_date(payload.due_date),
        source=_clean(payload.source),
        created_by=employee_id,
        updated_by=employee_id,
        created_at=now,
        updated_at=now,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return _task_with_notes(db, task)


@router.patch("/tasks/{task_id}")
def update_task(
    task_id: int,
    payload: TaskPatch,
    employee_id: str = Depends(require_admin),
    db: Session = Depends(database.get_db),
):
    task = _live_task(db, task_id)
    fields = payload.model_dump(exclude_unset=True)
    old_status = task.status
    if "title" in fields:
        task.title = _required(fields["title"], "과제 이름")
    if "department" in fields:
        task.department = _required(fields["department"], "의뢰 부서")
    for key in ("requester", "owner", "summary", "next_step", "source"):
        if key in fields:
            setattr(task, key, _clean(fields[key]))
    if "due_date" in fields:
        task.due_date = _check_date(fields["due_date"])
    if fields.get("important") is not None:
        task.important = bool(fields["important"])
    if fields.get("status") is not None:
        task.status = _check_status(fields["status"])
    task.updated_by = employee_id
    task.updated_at = datetime.now()
    if task.status != old_status:
        body = f"{STATUS_LABELS.get(old_status, old_status)} → {STATUS_LABELS[task.status]}"
        _add_note(db, task.id, "status", body, _user(db, employee_id), employee_id)
    db.commit()
    db.refresh(task)
    return _task_with_notes(db, task)


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: int,
    employee_id: str = Depends(require_admin),
    db: Session = Depends(database.get_db),
):
    task = _live_task(db, task_id)
    task.deleted_at = datetime.now()
    task.updated_by = employee_id
    db.commit()
    return {"ok": True, "id": task_id}


@router.post("/tasks/{task_id}/notes")
def add_note(
    task_id: int,
    payload: NoteIn,
    employee_id: str = Depends(require_admin),
    db: Session = Depends(database.get_db),
):
    task = _live_task(db, task_id)
    if payload.kind not in NOTE_KINDS_WRITABLE:
        raise HTTPException(status_code=422, detail="기록 종류는 진행 기록 또는 의견이어야 합니다.")
    body = _required(payload.body, "내용")
    _add_note(db, task.id, payload.kind, body, _user(db, employee_id), employee_id)
    task.updated_at = datetime.now()
    task.updated_by = employee_id
    db.commit()
    db.refresh(task)
    return _task_with_notes(db, task)


def _live_note(db: Session, note_id: int) -> tuple[models.CouncilNote, models.CouncilTask]:
    note = db.query(models.CouncilNote).filter(models.CouncilNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="기록을 찾을 수 없습니다.")
    task = _live_task(db, note.task_id)
    if note.kind == "status":
        raise HTTPException(status_code=422, detail="상태 변경 기록은 고치거나 지울 수 없습니다.")
    return note, task


@router.patch("/notes/{note_id}")
def update_note(
    note_id: int,
    payload: NotePatch,
    employee_id: str = Depends(require_admin),
    db: Session = Depends(database.get_db),
):
    note, task = _live_note(db, note_id)
    note.body = _required(payload.body, "내용")
    note.updated_at = datetime.now()
    db.commit()
    return _task_with_notes(db, task)


@router.delete("/notes/{note_id}")
def delete_note(
    note_id: int,
    employee_id: str = Depends(require_admin),
    db: Session = Depends(database.get_db),
):
    note, task = _live_note(db, note_id)
    db.delete(note)
    db.commit()
    return _task_with_notes(db, task)


@router.post("/seed-first-meeting")
def seed_first_meeting(
    employee_id: str = Depends(require_admin),
    db: Session = Depends(database.get_db),
):
    """1차 회의 수요 10건을 넣는다. 지운 것을 포함해 과제가 하나라도 있으면 409(두 번 넣지 않게)."""
    with _seed_lock:
        return _seed_first_meeting(db, employee_id)


def _seed_first_meeting(db: Session, employee_id: str) -> dict:
    if db.query(models.CouncilTask.id).first() is not None:
        raise HTTPException(status_code=409, detail="이미 과제가 있어 넣지 않았습니다. (지운 과제도 셉니다)")
    now = datetime.now()
    for item in FIRST_MEETING_TASKS:
        db.add(models.CouncilTask(
            title=item["title"],
            department=item["department"],
            requester=item.get("requester"),
            status="reviewing",
            important=bool(item.get("important")),
            summary=item.get("summary"),
            source=FIRST_MEETING_SOURCE,
            created_by=employee_id,
            updated_by=employee_id,
            created_at=now,
            updated_at=now,
        ))
    db.commit()
    return {"ok": True, "count": len(FIRST_MEETING_TASKS)}
