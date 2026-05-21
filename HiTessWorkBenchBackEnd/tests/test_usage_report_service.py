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
