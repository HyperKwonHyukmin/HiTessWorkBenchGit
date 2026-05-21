"""Usage Report Service unit tests."""
from datetime import datetime, date
import pytest

from app.services.usage_report_service import resolve_period, PeriodBounds


class TestResolvePeriodDaily:
    def test_daily_single_day(self):
        b = resolve_period("daily", date(2026, 5, 20))
        assert b.start == datetime(2026, 5, 20, 0, 0, 0)
        assert b.end   == datetime(2026, 5, 20, 23, 59, 59, 999999)
        assert b.prev_start == datetime(2026, 5, 19, 0, 0, 0)
        assert b.prev_end   == datetime(2026, 5, 19, 23, 59, 59, 999999)
        assert "2026-05-20" in b.label
        assert b.type == "daily"

    def test_daily_default_is_yesterday(self):
        b = resolve_period("daily", None, today=date(2026, 5, 21))
        assert b.start.date() == date(2026, 5, 20)


class TestResolvePeriodWeekly:
    def test_weekly_simple(self):
        # 2026-05-13 is a Wednesday → week is Mon 05-11 to Sun 05-17
        b = resolve_period("weekly", date(2026, 5, 13))
        assert b.start == datetime(2026, 5, 11, 0, 0, 0)
        assert b.end   == datetime(2026, 5, 17, 23, 59, 59, 999999)
        assert b.prev_start == datetime(2026, 5, 4, 0, 0, 0)
        assert b.prev_end   == datetime(2026, 5, 10, 23, 59, 59, 999999)

    def test_weekly_crosses_month(self):
        # 2026-05-31 is Sunday → week is Mon 05-25 to Sun 05-31
        b = resolve_period("weekly", date(2026, 5, 31), today=date(2026, 6, 1))
        assert b.start.date() == date(2026, 5, 25)
        assert b.end.date()   == date(2026, 5, 31)
        assert b.prev_start.date() == date(2026, 5, 18)
        assert b.prev_end.date()   == date(2026, 5, 24)

    def test_weekly_default_is_last_week(self):
        # today = 2026-05-21 (Thursday) → last week = Mon 05-11 ~ Sun 05-17
        b = resolve_period("weekly", None, today=date(2026, 5, 21))
        assert b.start.date() == date(2026, 5, 11)
        assert b.end.date()   == date(2026, 5, 17)


class TestResolvePeriodMonthly:
    def test_monthly_simple(self):
        b = resolve_period("monthly", date(2026, 5, 13))
        assert b.start == datetime(2026, 5, 1, 0, 0, 0)
        assert b.end.date() == date(2026, 5, 31)
        assert b.prev_start.date() == date(2026, 4, 1)
        assert b.prev_end.date()   == date(2026, 4, 30)

    def test_monthly_leap_year(self):
        b = resolve_period("monthly", date(2024, 2, 15))
        assert b.start.date() == date(2024, 2, 1)
        assert b.end.date()   == date(2024, 2, 29)

    def test_monthly_non_leap(self):
        b = resolve_period("monthly", date(2025, 2, 15))
        assert b.end.date() == date(2025, 2, 28)

    def test_monthly_default_is_last_month(self):
        b = resolve_period("monthly", None, today=date(2026, 5, 21))
        assert b.start.date() == date(2026, 4, 1)
        assert b.end.date()   == date(2026, 4, 30)


class TestResolvePeriodGuards:
    def test_invalid_period_raises(self):
        with pytest.raises(ValueError, match="period"):
            resolve_period("yearly", date(2026, 5, 13))

    def test_future_date_raises(self):
        with pytest.raises(ValueError, match="미래"):
            resolve_period("daily", date(2099, 1, 1), today=date(2026, 5, 21))


from app.services.usage_report_service import aggregate_period


class TestAggregatePeriod:
    def test_empty_period_returns_zero(self, db_session):
        result = aggregate_period(
            db_session, "daily",
            start=datetime(2026, 5, 20, 0, 0, 0),
            end=datetime(2026, 5, 20, 23, 59, 59, 999999),
        )
        assert result["total"] == 0
        assert result["programs"] == []
        assert result["users"] == []
        assert result["departments"] == []

    def test_basic_counts(self, db_session, make_user, make_analysis):
        make_user("E001", name="홍길동", department="구조해석팀")
        make_user("E002", name="김철수", department="설계팀")
        make_analysis("E001", "Truss Assessment", datetime(2026, 5, 20, 9, 0))
        make_analysis("E001", "Truss Assessment", datetime(2026, 5, 20, 10, 0))
        make_analysis("E001", "BDF Scanner",     datetime(2026, 5, 20, 11, 0))
        make_analysis("E002", "Truss Assessment", datetime(2026, 5, 20, 14, 0))

        result = aggregate_period(
            db_session, "daily",
            start=datetime(2026, 5, 20, 0, 0, 0),
            end=datetime(2026, 5, 20, 23, 59, 59, 999999),
        )
        assert result["total"] == 4
        assert result["activePrograms"] == 2
        assert result["activeUsers"] == 2
        assert result["activeDepartments"] == 2
        assert result["programs"][0]["name"] == "Truss Assessment"
        assert result["programs"][0]["count"] == 3
        assert result["programs"][0]["userCount"] == 2
        assert result["users"][0]["employeeId"] == "E001"
        assert result["users"][0]["count"] == 3
        assert result["users"][0]["programCount"] == 2
        assert result["busiestProgram"] == "Truss Assessment"

    def test_excludes_developers_from_stats(self, db_session, make_user, make_analysis):
        make_user("E001", department="구조해석팀", is_developer=False)
        make_user("E002", department="개발팀",   is_developer=True)
        make_analysis("E001", "Truss Assessment", datetime(2026, 5, 20, 9, 0))
        make_analysis("E002", "Truss Assessment", datetime(2026, 5, 20, 10, 0))

        result = aggregate_period(
            db_session, "daily",
            start=datetime(2026, 5, 20, 0, 0, 0),
            end=datetime(2026, 5, 20, 23, 59, 59, 999999),
        )
        assert result["total"] == 1
        assert result["activeUsers"] == 1
        assert "raw_rows" in result
        assert len(result["raw_rows"]) == 2


class TestNewUsersDetection:
    def test_first_run_in_period_counts_as_new(self, db_session, make_user, make_analysis):
        make_user("E001"); make_user("E002")
        # E001은 5/10에 첫 실행(범위 밖)
        make_analysis("E001", "Truss Assessment", datetime(2026, 5, 10, 9, 0))
        make_analysis("E001", "Truss Assessment", datetime(2026, 5, 20, 9, 0))
        # E002는 5/20에 첫 실행(범위 안)
        make_analysis("E002", "BDF Scanner",      datetime(2026, 5, 20, 10, 0))

        result = aggregate_period(
            db_session, "daily",
            start=datetime(2026, 5, 20, 0, 0, 0),
            end=datetime(2026, 5, 20, 23, 59, 59, 999999),
        )
        assert result["newUsers"] == 1  # E002만


class TestComputeDeltas:
    def test_basic_delta(self):
        from app.services.usage_report_service import compute_deltas
        current = {"total": 122, "activeUsers": 23, "activePrograms": 8, "avgPerDay": 17.4}
        previous = {"total": 100, "activeUsers": 20, "activePrograms": 9, "avgPerDay": 14.3}
        d = compute_deltas(current, previous)
        assert d["total"]["abs"] == 22
        assert d["total"]["pct"] == 22.0
        assert d["activePrograms"]["abs"] == -1
        assert d["activePrograms"]["pct"] == pytest.approx(-11.1, abs=0.1)

    def test_previous_zero_yields_null_pct(self):
        from app.services.usage_report_service import compute_deltas
        d = compute_deltas({"total": 5}, {"total": 0})
        assert d["total"]["abs"] == 5
        assert d["total"]["pct"] is None
