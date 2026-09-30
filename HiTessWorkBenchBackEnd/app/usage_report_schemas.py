"""Usage Report API 응답 스키마."""
from datetime import datetime
from typing import List, Optional, Literal
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


class ProgramStep(BaseModel):
    """권상 App 세부 검토 1줄 (services/usage_rollup.serialize_steps)."""
    label: str
    program: Optional[str] = None
    count: int
    success: int = 0
    userCount: int = 0
    share: Optional[int] = None


class ProgramRow(BaseModel):
    name: str
    count: int
    share: int
    userCount: int
    lastRun: Optional[str] = None
    # ⚠ 여기 없으면 response_model 이 steps 를 조용히 떨군다(화면에 세부 검토가 안 보임).
    steps: List[ProgramStep] = []


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
