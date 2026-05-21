"""Daily/Weekly/Monthly 사용량 리포트 — 기간 계산·집계·Excel 빌더."""
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from calendar import monthrange
from typing import Optional, Literal

PeriodType = Literal["daily", "weekly", "monthly"]
_WEEKDAY_KR = ["월", "화", "수", "목", "금", "토", "일"]


@dataclass(frozen=True)
class PeriodBounds:
    type: PeriodType
    start: datetime
    end: datetime
    prev_start: datetime
    prev_end: datetime
    label: str
    prev_label: str


def _end_of_day(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, 23, 59, 59, 999999)


def _start_of_day(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, 0, 0, 0)


def resolve_period(
    period: str,
    target: Optional[date],
    today: Optional[date] = None,
) -> PeriodBounds:
    """`period`가 가리키는 달력 기간의 경계를 반환.

    target이 None이면 '직전의 완료된 기간'을 기본값으로 사용한다.
    today는 테스트용 주입 포인트(없으면 실제 오늘).
    """
    if period not in ("daily", "weekly", "monthly"):
        raise ValueError(f"period는 daily, weekly, monthly 중 하나여야 합니다 (받은 값: {period!r})")

    today = today or date.today()

    # 기본값 보정
    if target is None:
        if period == "daily":
            target = today - timedelta(days=1)
        elif period == "weekly":
            target = today - timedelta(days=7)
        else:  # monthly
            target = today.replace(day=1) - timedelta(days=1)

    if target > today:
        raise ValueError("미래 기간은 조회할 수 없습니다.")

    if period == "daily":
        start_d = target
        end_d = target
        prev_start_d = target - timedelta(days=1)
        prev_end_d = prev_start_d
        weekday = _WEEKDAY_KR[start_d.weekday()]
        label = f"{start_d.isoformat()} ({weekday})"
        prev_label = prev_start_d.isoformat()

    elif period == "weekly":
        # Monday=0
        start_d = target - timedelta(days=target.weekday())
        end_d = start_d + timedelta(days=6)
        prev_start_d = start_d - timedelta(days=7)
        prev_end_d = end_d - timedelta(days=7)
        label = f"{start_d.isoformat()} ~ {end_d.isoformat()}"
        prev_label = f"{prev_start_d.isoformat()} ~ {prev_end_d.isoformat()}"

    else:  # monthly
        start_d = target.replace(day=1)
        last_day = monthrange(start_d.year, start_d.month)[1]
        end_d = start_d.replace(day=last_day)
        prev_end_d = start_d - timedelta(days=1)
        prev_start_d = prev_end_d.replace(day=1)
        label = f"{start_d.year}-{start_d.month:02d}"
        prev_label = f"{prev_start_d.year}-{prev_start_d.month:02d}"

    return PeriodBounds(
        type=period,
        start=_start_of_day(start_d),
        end=_end_of_day(end_d),
        prev_start=_start_of_day(prev_start_d),
        prev_end=_end_of_day(prev_end_d),
        label=label,
        prev_label=prev_label,
    )
