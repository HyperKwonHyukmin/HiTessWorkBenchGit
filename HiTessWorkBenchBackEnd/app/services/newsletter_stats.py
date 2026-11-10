"""웹 뉴스레터 조회 통계(2026-11-10) — 기록·측정 스크립트·집계.

공개 페이지(/newsletter, 로그인 없음)라 '누가'는 알 수 없다. 방문자는 IP 해시로 센다 —
  원문 대신 해시를 두지만 사내 IP 대역은 좁아 마음먹으면 되돌릴 수 있다(익명 보장이 아니다).
- 페이지를 열 때 `record_view` 가 (호, 방문자, 날짜) 한 행을 만들거나 views 를 올린다.
- 페이지에 끼워 넣는 측정 스크립트(`TRACKER_SCRIPT`)가 화면을 떠날 때 읽은 깊이·머문 시간·본 구획을 보낸다(`record_beacon`).
- 집계(`build_stats`)는 지정한 사번만 본다(`NEWSLETTER_STATS_VIEWERS`, 기본 A476854 — 사용자 지시 '나만 보게').
  발송 효과는 새 기록 없이 기존 DB 로 본다: 첫 조회일 앞뒤 14일의 신규 가입·해석 실행·접속 사용자·영상 재생.

측정이 실패해도 뉴스레터는 늘 열려야 한다 — 기록 함수는 예외를 삼키고 로그만 남긴다.
"""
import hashlib
import logging
import os
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.services.program_registry import internal_substep_programs

logger = logging.getLogger(__name__)

DEFAULT_VIEWERS = "A476854"
SECTION_IDS = ("lead", "story", "apps", "manuals", "easier")
MAX_DWELL_PER_BEACON = 1800      # 한 번에 받는 머문 시간 상한(초) — 창을 띄워 두고 자리를 비운 경우
MAX_DWELL_PER_DAY = 6 * 3600
COMPARE_DAYS = 14
SAMPLE_SOURCE_TAG = "WorkbenchSample"   # routers/analysis.py 와 같은 값 — 월별 건수와 같은 기준으로 센다


def stats_viewers() -> set[str]:
    raw = os.getenv("NEWSLETTER_STATS_VIEWERS")
    raw = DEFAULT_VIEWERS if raw is None else raw
    return {v.strip().upper() for v in raw.split(",") if v.strip()}


def visitor_key(ip: str | None) -> str:
    return hashlib.sha256(f"newsletter:{ip or '-'}".encode("utf-8")).hexdigest()[:16]


def _safe_rollback(db: Session) -> None:
    try:
        db.rollback()
    except Exception:  # noqa: BLE001 — DB 연결 자체가 없을 때
        pass


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def record_view(db: Session, issue: str, ip: str | None) -> None:
    """페이지 열람 1회. 같은 방문자·같은 날은 views 만 올린다."""
    try:
        key, day, now = visitor_key(ip), _today(), datetime.now()
        row = db.query(models.NewsletterView).filter_by(issue=issue, visitor=key, day=day).first()
        if row:
            row.views = (row.views or 0) + 1
            row.last_at = now
        else:
            db.add(models.NewsletterView(issue=issue, visitor=key, day=day, views=1,
                                         max_depth=0, dwell_seconds=0, sections=[], first_at=now, last_at=now))
        db.commit()
    except Exception:  # noqa: BLE001 — 측정 실패가 페이지를 막으면 안 된다
        _safe_rollback(db)
        logger.exception("[newsletter] 조회 기록 실패")


def _clamp_int(value, low: int, high: int) -> int:
    try:
        return max(low, min(high, int(float(value))))
    except (TypeError, ValueError):
        return low


def record_beacon(db: Session, issue: str, ip: str | None, payload: dict) -> bool:
    """측정 스크립트가 보낸 값 반영. 오늘 그 방문자의 열람 행이 있을 때만(열람 없이 행을 만들 수 없게)."""
    try:
        row = db.query(models.NewsletterView).filter_by(issue=issue, visitor=visitor_key(ip), day=_today()).first()
        if row is None or not isinstance(payload, dict):
            return False
        depth = _clamp_int(payload.get("depth"), 0, 100)
        dwell = _clamp_int(payload.get("dwell"), 0, MAX_DWELL_PER_BEACON)
        seen = payload.get("sections") if isinstance(payload.get("sections"), list) else []
        known = [s for s in seen if s in SECTION_IDS]
        row.max_depth = max(row.max_depth or 0, depth)
        row.dwell_seconds = min(MAX_DWELL_PER_DAY, (row.dwell_seconds or 0) + dwell)
        merged = list(dict.fromkeys(list(row.sections or []) + known))
        row.sections = merged
        row.last_at = datetime.now()
        db.commit()
        return True
    except Exception:  # noqa: BLE001
        _safe_rollback(db)
        logger.exception("[newsletter] 측정값 기록 실패")
        return False


# 페이지에 끼워 넣는 측정 스크립트 — 화면에 보인 시간만 세고, 화면을 떠날 때(숨김·닫기) 한 번씩 보낸다.
TRACKER_SCRIPT = """<script>
(function(){
  var url = 'beacon', maxDepth = 0, shown = {}, visibleSince = Date.now(), pending = 0;
  function depth(){ var h = document.documentElement.scrollHeight - window.innerHeight;
    var d = h <= 0 ? 100 : Math.round(100 * window.scrollY / h); if (d > maxDepth) maxDepth = Math.min(100, d); }
  function mark(el){ var id = el.id || (el.getAttribute('aria-labelledby') || '').replace(/-h$/, ''); if (id) shown[id] = 1; }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function(es){ es.forEach(function(e){ if (e.isIntersecting) mark(e.target); }); }, { threshold: 0.25 });
    document.querySelectorAll('section').forEach(function(s){ io.observe(s); });
  }
  function flush(){
    if (visibleSince) { pending += (Date.now() - visibleSince) / 1000; visibleSince = 0; }
    depth();
    var body = JSON.stringify({ depth: maxDepth, dwell: Math.round(pending), sections: Object.keys(shown) });
    pending = 0;
    try { navigator.sendBeacon(url, new Blob([body], { type: 'application/json' })); } catch (e) {}
  }
  window.addEventListener('scroll', depth, { passive: true });
  document.addEventListener('visibilitychange', function(){
    if (document.visibilityState === 'hidden') flush(); else visibleSince = Date.now();
  });
  window.addEventListener('pagehide', flush);
  depth();
})();
</script>"""


def inject_tracker(html: bytes) -> bytes:
    marker = b"</body>"
    idx = html.rfind(marker)
    script = TRACKER_SCRIPT.encode("utf-8")
    return html[:idx] + script + html[idx:] if idx >= 0 else html + script


def _count_between(db: Session, column, start: datetime, end: datetime, *filters) -> int:
    q = db.query(func.count()).select_from(column.class_).filter(column >= start, column < end, *filters)
    return int(q.scalar() or 0)


def _outcomes(db: Session, sent_day: str) -> dict:
    """첫 조회일(=발송일로 본다) 앞뒤 14일 비교 — 새 기록 없이 기존 DB 로."""
    sent = datetime.strptime(sent_day, "%Y-%m-%d")
    before = (sent - timedelta(days=COMPARE_DAYS), sent)
    after = (sent, sent + timedelta(days=COMPARE_DAYS))

    def window(start, end):
        active = db.query(func.count(func.distinct(models.AccessSession.employee_id))).filter(
            models.AccessSession.started_at >= start, models.AccessSession.started_at < end).scalar()
        return {
            "signups": _count_between(db, models.User.created_at, start, end),
            # 대시보드 월별 건수와 같은 기준: 샘플·권상 세부 검토 제외
            "runs": _count_between(db, models.Analysis.created_at, start, end,
                                   models.Analysis.source != SAMPLE_SOURCE_TAG,
                                   models.Analysis.program_name.notin_(internal_substep_programs())),
            "activeUsers": int(active or 0),
            "videoPlays": _count_between(db, models.ActivityLog.created_at, start, end,
                                         models.ActivityLog.action_type == "VIDEO_PLAY"),
        }

    days_after = max(0, min(COMPARE_DAYS, (datetime.now() - sent).days))
    return {
        "sentDay": sent_day, "days": COMPARE_DAYS, "daysElapsed": days_after,
        "before": window(*before), "after": window(*after),
        # 영상 재생 기록(activity_logs)은 30일 뒤 지워진다 — 오래된 호의 '전' 값은 비어 보일 수 있다.
        "videoRetentionNote": True,
    }


def build_stats(db: Session, sent_dates: dict | None = None) -> dict:
    """sent_dates = {호: 'YYYY-MM-DD'} — issue.json 의 sentDate. 없으면 첫 조회일을 발송일로 본다
    (배포 직후 내가 미리 열어 본 날이 잡히면 '발송 전' 에 발송 뒤 수치가 섞이므로 sentDate 를 적는 것이 맞다)."""
    sent_dates = sent_dates or {}
    rows = db.query(models.NewsletterView).all()
    by_issue: dict[str, list] = {}
    for r in rows:
        by_issue.setdefault(r.issue, []).append(r)
    issues = []
    for issue, items in sorted(by_issue.items(), reverse=True):
        visitors = {r.visitor for r in items}
        days: dict[str, dict] = {}
        for r in items:
            d = days.setdefault(r.day, {"day": r.day, "views": 0, "visitors": set()})
            d["views"] += r.views or 0
            d["visitors"].add(r.visitor)
        measured = [r for r in items if (r.dwell_seconds or 0) > 0 or (r.max_depth or 0) > 0]
        depth_buckets = {"25": 0, "50": 0, "75": 0, "100": 0}
        for r in measured:
            for k in depth_buckets:
                if (r.max_depth or 0) >= int(k):
                    depth_buckets[k] += 1
        section_reach = {s: 0 for s in SECTION_IDS}
        for r in items:
            for s in (r.sections or []):
                if s in section_reach:
                    section_reach[s] += 1
        dwell = sorted(r.dwell_seconds or 0 for r in measured)
        sent_day = sent_dates.get(issue) or min(r.day for r in items)
        issues.append({
            "issue": issue,
            "views": sum(r.views or 0 for r in items),
            "visitors": len(visitors),
            "visits": len(items),        # 방문자 × 날짜
            "measured": len(measured),
            "medianDwell": dwell[len(dwell) // 2] if dwell else 0,
            "avgDepth": round(sum(r.max_depth or 0 for r in measured) / len(measured)) if measured else 0,
            "depthReach": depth_buckets,
            "sectionReach": section_reach,
            "daily": [{"day": d["day"], "views": d["views"], "visitors": len(d["visitors"])}
                      for d in sorted(days.values(), key=lambda x: x["day"])],
            "outcomes": _outcomes(db, sent_day),
            "sentDayFromIssue": bool(sent_dates.get(issue)),
        })
    return {"issues": issues, "sections": list(SECTION_IDS)}
