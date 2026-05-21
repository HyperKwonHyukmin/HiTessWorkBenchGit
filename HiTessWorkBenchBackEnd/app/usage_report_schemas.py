"""Usage Report API 응답 스키마."""
from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel


class PeriodMeta(BaseModel):
    type: Literal["daily", "weekly", "monthly"]
    start: datetime
    end: datetime
    label: str


class PrevPeriodMeta(BaseModel):
    start: datetime
    end: datetime
    label: str


class DeltaValue(BaseModel):
    abs: float
    pct: Optional[float] = None


class Summary(BaseModel):
    total: int
    activePrograms: int
    activeUsers: int
    activeDepartments: int
    avgPerDay: float
    maxDay: int
    busiestProgram: Optional[str] = None
    peakHour: Optional[str] = None
    newUsers: int


class ProgramRow(BaseModel):
    name: str
    count: int
    share: int
    userCount: int
    lastRun: Optional[str] = None


class UserRow(BaseModel):
    employeeId: str
    name: str
    department: str
    count: int
    share: int
    programCount: int
    lastRun: Optional[str] = None


class DeptRow(BaseModel):
    name: str
    count: int


class TimeBucketItem(BaseModel):
    label: str
    count: int


class TimeBuckets(BaseModel):
    type: Literal["hour", "weekday", "dayOfMonth"]
    data: list[TimeBucketItem]


class UsageReportResponse(BaseModel):
    period: PeriodMeta
    previous: PrevPeriodMeta
    summary: Summary
    deltas: dict[str, DeltaValue]
    programs: list[ProgramRow]
    users: list[UserRow]
    departments: list[DeptRow]
    timeBuckets: TimeBuckets
