"""작업 취소 위치 판정 + 위임 — 라우터가 붙이는 얇은 헬퍼.

취소 대상은 두 갈래다.
  * 공용 큐(JobStatusStore) — 대기 중이면 future.cancel(), 실행 중이면 Popen 트리 종료.
  * 이중관 PSA(doublepipe_psa_service) — 자체 스토어 + Abaqus 라이센스 슬롯을 함께 관리한다.
    ⚠ PSA 는 **절대** 공용 취소로 대체하지 않는다. 공용 경로는 "부모 Popen 을 회수하면 성공"인데
    PSA 는 자손(Abaqus) 소멸을 identity 로 검증해야만 라이센스를 반환할 수 있기 때문이다.
    여기서는 cancel_psa_job() 을 그대로 호출해 그 계약을 보존한다.
"""
from dataclasses import dataclass
import importlib
import logging
from typing import Any

from sqlalchemy.orm import Session

from .. import models
from . import doublepipe_psa_service
from . import job_manager

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class JobLocation:
    kind: str                 # "queue" | "psa" | "record"
    owner_id: str | None
    status: str | None


def locate_job(job_id: str, db: Session) -> JobLocation | None:
    """job_id 가 어디 있는지 찾아 소유자/상태와 함께 돌려준다.

    우선순위: doublepipe_psa_service._jobs(자체 스토어·라이센스) → JobStatusStore(공용 큐)
    → DB Analysis(스토어 만료). 아무 데도 없으면 None.

    PSA 를 먼저 보는 이유: PSA 파이프라인은 공용 취소 API 가 Popen 을 찾을 수 있도록
    job_status_store.register_process() 로 프로세스만 등록한다(상태 항목 set() 은 하지 않는다).
    혹시라도 같은 job_id 가 양쪽에 보이더라도 라이센스 슬롯을 다루는 PSA 경로가 이기게 해,
    자손 검증 없이 라이센스가 반환되는 일을 원천 차단한다.
    """
    psa_job = doublepipe_psa_service._jobs.get(job_id)
    if psa_job is not None:
        return JobLocation(kind="psa", owner_id=psa_job.get("employeeId"), status=psa_job.get("status"))

    entry = job_manager.job_status_store.get(job_id)
    if entry is not None:
        owner = entry.get("employee_id")
        if not owner:
            # 스토어에 소유자가 없으면 DB 에서 보강.
            record = db.query(models.Analysis).filter(models.Analysis.job_id == job_id).first()
            owner = getattr(record, "employee_id", None) if record else None
        return JobLocation(kind="queue", owner_id=owner, status=entry.get("status"))

    record = db.query(models.Analysis).filter(models.Analysis.job_id == job_id).first()
    if record is not None:
        return JobLocation(kind="record", owner_id=record.employee_id, status=record.status)
    return None


def cancel_located(
    job_id: str,
    location: JobLocation,
    *,
    requester: str,
    db: Session,
) -> dict[str, Any]:
    """실제 취소 수행 + 알림. 라우터는 권한 검사만 하고 이 함수를 부른다.

    반환:
      - queue/성공: {"job_id", "kind": "queue", "cancelled": True, "status": "Cancelled", "message"}
      - queue/직전에 종료됨: {"cancelled": False, "status": <실제 상태>, ...}
      - psa: doublepipe_psa_service.cancel_psa_job 의 응답 + job_id/kind (응답 필드는 그대로 보존)
    """
    if location.kind == "psa":
        # 소유자 사번을 그대로 넘겨 서비스 내부의 2차 소유자 검사를 유지한다(관리자도 동일).
        raw = doublepipe_psa_service.cancel_psa_job(job_id, location.owner_id or requester)
        response = {"job_id": job_id, "kind": "psa", **raw}
        if raw.get("cancelled"):
            _notify_cancelled(db, employee_id=location.owner_id or requester, job_id=job_id)
        return response

    if location.kind == "queue":
        ok = job_manager.job_status_store.cancel(job_id)
        entry = job_manager.job_status_store.get(job_id) or {}
        if ok:
            # cancel() 이 True 면 스토어는 Cancelled 로 확정된 상태다(계약).
            status = "Cancelled"
            message = entry.get("message") or job_manager.CANCELLED_MESSAGE
            _notify_cancelled(db, employee_id=location.owner_id or requester, job_id=job_id)
        else:
            # 취소 직전에 스스로 끝났거나(Success) 이미 terminal 인 경우 — 실제 상태를 알려준다.
            status = entry.get("status") or location.status or "Unknown"
            message = entry.get("message")
        return {
            "job_id": job_id,
            "kind": "queue",
            "cancelled": bool(ok),
            "status": status,
            "message": message,
        }

    # record 는 라우터에서 409 로 잘리므로 여기 오면 계약 위반.
    raise RuntimeError(f"cancel_located called on non-cancellable location: {location}")


def _notify_cancelled(db: Session, *, employee_id: str | None, job_id: str) -> None:
    """알림 서비스 지연 import — 알림 모듈이 없거나 실패해도 취소 자체는 되돌리지 않는다."""
    if not employee_id:
        return
    try:
        notification_service = importlib.import_module(f"{__package__}.notification_service")
    except Exception:
        return
    if notification_service is None or not hasattr(notification_service, "notify"):
        return
    try:
        record = db.query(models.Analysis).filter(models.Analysis.job_id == job_id).first()
        program = getattr(record, "program_name", None) or "해석"
        notification_service.notify(
            db,
            employee_id=employee_id,
            kind="job.cancelled",
            title=f"{program} 해석을 중단했습니다",
            body=job_id,
            link={"menu": "My Projects", "params": {"analysis_id": getattr(record, "id", None), "job_id": job_id}},
            dedupe_key=f"job.cancelled:{job_id}",
        )
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        logger.warning("job.cancelled 알림 생성 실패 job=%s", job_id, exc_info=True)
