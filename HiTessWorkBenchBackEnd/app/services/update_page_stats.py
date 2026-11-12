"""기능 업데이트 안내 페이지(/updates) 조회 기록과 집계(2026-11-12).

한 페이지(UpdateWeb/index.html)에 안내가 쌓이고, 왼쪽 목록으로 고른 안내 하나를 보여 준다.
그래서 서버가 페이지 요청만으로는 '어느 안내를 봤는지' 모른다 — 페이지가 안내를 보여 줄 때 'view',
다른 안내로 넘어가거나 화면을 떠날 때 'measure'(읽은 깊이·머문 시간·본 구획)를 보낸다.

- 브라우저(메일 링크): POST /updates/beacon → 방문자 = IP 해시(사람이 아니라 PC).
- 앱 안: 앱이 페이지에서 받은 값을 POST /api/updates/beacon 으로 로그인과 함께 보낸다 → employee_id 가 남는다.
- 집계는 뉴스레터 통계와 같은 사람만(NEWSLETTER_STATS_VIEWERS).
측정이 실패해도 페이지는 늘 열려야 한다 — 기록 함수는 예외를 삼키고 로그만 남긴다.
"""
import hashlib
import logging
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.services.newsletter_stats import SAMPLE_SOURCE_TAG, stats_viewers  # noqa: F401 — 라우터가 stats_viewers 를 여기서 쓴다
from app.services.program_registry import internal_substep_programs

logger = logging.getLogger(__name__)

MAX_DWELL_PER_BEACON = 1800
MAX_DWELL_PER_DAY = 6 * 3600


def visitor_key(ip: str | None = None, employee_id: str | None = None) -> str:
    raw = f"update-emp:{employee_id.upper()}" if employee_id else f"update-ip:{ip or '-'}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _safe_rollback(db: Session) -> None:
    try:
        db.rollback()
    except Exception:  # noqa: BLE001
        pass


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _clamp_int(value, low: int, high: int) -> int:
    try:
        return max(low, min(high, int(float(value))))
    except (TypeError, ValueError):
        return low


def record(db: Session, entries: dict, payload: dict, ip: str | None = None,
           employee_id: str | None = None) -> bool:
    """entries = {안내 id: 구획 id 집합}. payload = {entry, type: view|measure, depth?, dwell?, sections?}.
    measure 는 오늘 그 방문자의 view 행이 있을 때만 반영한다(열람 없이 행을 만들 수 없게)."""
    try:
        if not isinstance(payload, dict):
            return False
        entry = payload.get("entry")
        if not isinstance(entry, str) or entry not in entries:
            return False
        kind = payload.get("type")
        key, day, now = visitor_key(ip, employee_id), _today(), datetime.now()
        row = db.query(models.UpdatePageView).filter_by(entry=entry, visitor=key, day=day).first()
        if kind == "view":
            if row:
                row.views = (row.views or 0) + 1
                row.last_at = now
            else:
                db.add(models.UpdatePageView(entry=entry, visitor=key, employee_id=(employee_id or None) and employee_id.upper(),
                                             day=day, views=1, max_depth=0, dwell_seconds=0, sections=[],
                                             first_at=now, last_at=now))
            db.commit()
            return True
        if kind != "measure" or row is None:
            return False
        seen = payload.get("sections") if isinstance(payload.get("sections"), list) else []
        known = [s for s in seen if isinstance(s, str) and s in entries[entry]]
        row.max_depth = max(row.max_depth or 0, _clamp_int(payload.get("depth"), 0, 100))
        row.dwell_seconds = min(MAX_DWELL_PER_DAY,
                                (row.dwell_seconds or 0) + _clamp_int(payload.get("dwell"), 0, MAX_DWELL_PER_BEACON))
        row.sections = list(dict.fromkeys(list(row.sections or []) + known))
        row.last_at = now
        db.commit()
        return True
    except Exception:  # noqa: BLE001 — 측정 실패가 페이지를 막으면 안 된다
        _safe_rollback(db)
        logger.exception("[updates] 조회 기록 실패")
        return False


def _app_runs(db: Session, programs: list[str]):
    """그 App 실행 기록 — User Management 'App 사용자' 필터(admin_projects.program_users)와 같은 기준:
    샘플·권상 세부 검토 제외, 성공·실패 모두 '사용'."""
    return db.query(models.Analysis).filter(
        models.Analysis.program_name.in_(programs),
        models.Analysis.source != SAMPLE_SOURCE_TAG,
        models.Analysis.program_name.notin_(internal_substep_programs()),
    )


def _app_effect(db: Session, entry: dict, seen_people: dict) -> dict | None:
    """안내에 App 분류(programs = Analysis.program_name 목록)가 걸려 있을 때만.
    대상 = 지금까지 그 App 을 한 번이라도 실행한 사람 — User Management 'App 사용자' 필터와 같은 사람들(안내 뒤 새로 쓴 사람도 포함).
    seen_people = {사번: 처음 본 날} — 앱 안에서 연 기록(브라우저 기록은 사람을 모른다)."""
    programs = [p for p in (entry.get("programs") or []) if isinstance(p, str)]
    if not programs:
        return None
    eid = func.upper(func.trim(models.Analysis.employee_id))
    target_ids = {e for (e,) in _app_runs(db, programs).filter(
        models.Analysis.employee_id.isnot(None)).with_entities(eid).distinct() if e}
    users = {u.employee_id.strip().upper(): u for u in db.query(models.User).filter(
        func.upper(func.trim(models.User.employee_id)).in_(target_ids)).all()} if target_ids else {}
    targets = []
    for emp in sorted(target_ids):
        u = users.get(emp)
        targets.append({
            "employeeId": emp,
            "name": (u.name if u else None) or emp,
            "department": u.department if u else None,
            "position": u.position if u else None,
            "email": u.email if u else None,
            "seenDay": seen_people.get(emp),
        })
    # 본 사람 먼저(먼저 본 순), 안 본 사람은 이름순
    targets.sort(key=lambda t: (t["seenDay"] is None, t["seenDay"] or "", t["name"]))
    return {
        "programs": programs,
        "targetUsers": len(targets),
        "viewedTargets": sum(1 for t in targets if t["seenDay"]),
        "otherViewers": len(set(seen_people) - target_ids),
        "targets": targets,
    }


def build_stats(db: Session, entries: list[dict]) -> dict:
    """entries = updates.json 의 안내 목록(최신이 앞). 기록이 없는 안내도 0 으로 나온다."""
    rows = db.query(models.UpdatePageView).all()
    by_entry: dict[str, list] = {}
    for r in rows:
        by_entry.setdefault(r.entry, []).append(r)
    out = []
    for entry in entries:
        items = by_entry.get(entry["id"], [])
        measured = [r for r in items if (r.dwell_seconds or 0) > 0 or (r.max_depth or 0) > 0]
        seen_people: dict[str, str] = {}
        for r in sorted(items, key=lambda x: x.day):
            if r.employee_id:
                seen_people.setdefault(r.employee_id.strip().upper(), r.day)
        section_ids = [s["id"] for s in entry.get("sections") or [] if isinstance(s, dict) and s.get("id")]
        reach = {s: 0 for s in section_ids}
        for r in items:
            for s in r.sections or []:
                if s in reach:
                    reach[s] += 1
        dwell = sorted(r.dwell_seconds or 0 for r in measured)
        days: dict[str, dict] = {}
        for r in items:
            d = days.setdefault(r.day, {"day": r.day, "views": 0, "visitors": set()})
            d["views"] += r.views or 0
            d["visitors"].add(r.visitor)
        out.append({
            "entry": entry["id"],
            "title": entry.get("title") or entry["id"],
            "date": entry.get("date"),
            "app": entry.get("app"),
            "views": sum(r.views or 0 for r in items),
            "browserVisitors": len({r.visitor for r in items if not r.employee_id}),
            "people": len(seen_people),
            "measured": len(measured),
            "avgDepth": round(sum(r.max_depth or 0 for r in measured) / len(measured)) if measured else 0,
            "medianDwell": dwell[len(dwell) // 2] if dwell else 0,
            "sections": [{"id": s["id"], "heading": s.get("heading") or s["id"], "reached": reach.get(s["id"], 0)}
                         for s in entry.get("sections") or [] if isinstance(s, dict) and s.get("id")],
            "daily": [{"day": d["day"], "views": d["views"], "visitors": len(d["visitors"])}
                      for d in sorted(days.values(), key=lambda x: x["day"])],
            "appEffect": _app_effect(db, entry, seen_people),
        })
    return {"entries": out}
