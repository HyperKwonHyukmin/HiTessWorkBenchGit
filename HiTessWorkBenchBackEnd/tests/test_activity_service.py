"""Activity log retention tests."""
from datetime import datetime, timedelta

from app import models
from app.services.activity_service import prune_activity_logs


def test_prune_activity_logs_deletes_entries_older_than_30_days(db_session):
    old_log = models.ActivityLog(
        employee_id="A001",
        action_type="LOGIN",
        status="success",
        created_at=datetime.now() - timedelta(days=31),
    )
    recent_log = models.ActivityLog(
        employee_id="A001",
        action_type="PAGE_VIEW",
        status="success",
        created_at=datetime.now() - timedelta(days=5),
    )
    db_session.add_all([old_log, recent_log])
    db_session.commit()

    deleted = prune_activity_logs(db_session)

    assert deleted == 1
    remaining = db_session.query(models.ActivityLog).all()
    assert len(remaining) == 1
    assert remaining[0].action_type == "PAGE_VIEW"
