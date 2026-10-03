from pydantic import BaseModel, AfterValidator, PlainSerializer, model_validator
from datetime import date, datetime, timezone
from typing import Optional, List, Annotated, Literal


def _to_utc_naive(v: datetime) -> datetime:
    """Normalize incoming datetimes to naive UTC for storage."""
    if v.tzinfo is not None:
        v = v.astimezone(timezone.utc).replace(tzinfo=None)
    return v


def _serialize_utc(v: datetime) -> str:
    """Emit stored naive-UTC datetimes with an explicit Z offset."""
    if v.tzinfo is not None:
        v = v.astimezone(timezone.utc).replace(tzinfo=None)
    return v.isoformat() + "Z"


# All API datetimes: accepted in any offset, stored as UTC, returned with Z
UTCDateTime = Annotated[
    datetime,
    AfterValidator(_to_utc_naive),
    PlainSerializer(_serialize_utc, return_type=str, when_used="json"),
]

# Task Schemas
class TaskBase(BaseModel):
    name: str

class TaskCreate(TaskBase):
    is_urgent: bool = False
    is_important: bool = False

class TaskUpdate(BaseModel):
    name: Optional[str] = None
    is_urgent: Optional[bool] = None
    is_important: Optional[bool] = None

class Task(TaskBase):
    id: int
    average_duration: float
    total_recordings: int
    is_urgent: bool
    is_important: bool
    created_at: UTCDateTime
    updated_at: UTCDateTime

    class Config:
        from_attributes = True

# TimeLog Schemas
class TimeLogBase(BaseModel):
    task_id: int
    duration: float
    notes: Optional[str] = None

class TimeLogCreate(TimeLogBase):
    pass

class TimeLog(TimeLogBase):
    id: int
    session_id: Optional[int] = None
    created_at: UTCDateTime

    class Config:
        from_attributes = True

# Response schemas
class TaskWithLogs(Task):
    time_logs: list[TimeLog] = []

    class Config:
        from_attributes = True

# StopwatchSession Schemas
class StopwatchSessionBase(BaseModel):
    name: str
    duration: float
    task_id: Optional[int] = None
    notes: Optional[str] = None
    start_time: Optional[UTCDateTime] = None
    end_time: Optional[UTCDateTime] = None

class StopwatchSessionCreate(StopwatchSessionBase):
    pass

class StopwatchSessionUpdate(BaseModel):
    name: Optional[str] = None
    duration: Optional[float] = None
    task_id: Optional[int] = None
    notes: Optional[str] = None
    start_time: Optional[UTCDateTime] = None
    end_time: Optional[UTCDateTime] = None

class StopwatchSession(StopwatchSessionBase):
    id: int
    created_at: UTCDateTime
    updated_at: UTCDateTime

    class Config:
        from_attributes = True

class StopwatchSessionWithTask(StopwatchSession):
    task: Optional[Task] = None

    class Config:
        from_attributes = True


# TaskStats schema
class TaskStats(BaseModel):
    average: float
    median: Optional[float] = None
    previous: Optional[float] = None


# ScheduleItem schemas
class ScheduleItemBase(BaseModel):
    task_id: Optional[int] = None
    custom_name: Optional[str] = None
    estimated_duration: float
    position: int = 0
    scheduled_time: Optional[UTCDateTime] = None
    is_frog: bool = False

class ScheduleItemCreate(ScheduleItemBase):
    pass

class ScheduleItemUpdate(BaseModel):
    task_id: Optional[int] = None
    custom_name: Optional[str] = None
    estimated_duration: Optional[float] = None
    position: Optional[int] = None
    scheduled_time: Optional[UTCDateTime] = None
    is_frog: Optional[bool] = None

class ScheduleItemPlace(BaseModel):
    task_id: int
    scheduled_time: UTCDateTime
    estimated_duration: Optional[float] = None
    is_frog: bool = False

class ScheduleItem(ScheduleItemBase):
    id: int
    schedule_id: int
    task: Optional[Task] = None
    calendar_event_id: Optional[str] = None
    calendar_stale: bool = False
    created_at: UTCDateTime

    class Config:
        from_attributes = True


# Schedule schemas
class ScheduleBase(BaseModel):
    name: Optional[str] = None
    schedule_type: str = "day"
    target_date: Optional[date] = None
    notes: Optional[str] = None
    is_regimen: bool = False

class ScheduleCreate(ScheduleBase):
    items: List[ScheduleItemCreate] = []

    @model_validator(mode="after")
    def check_kind(self):
        if self.is_regimen:
            if not self.name:
                raise ValueError("A Regimen needs a name")
            if self.target_date is not None:
                raise ValueError("A Regimen has no date")
        else:
            if self.target_date is None:
                raise ValueError("A day Schedule needs a target_date")
            self.name = None
        return self

class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    schedule_type: Optional[str] = None
    target_date: Optional[date] = None
    rating: Optional[int] = None
    notes: Optional[str] = None
    is_regimen: Optional[bool] = None

class Schedule(ScheduleBase):
    id: int
    rating: Optional[int] = None
    items: List[ScheduleItem] = []
    created_at: UTCDateTime
    updated_at: UTCDateTime

    class Config:
        from_attributes = True


# For applying a regimen to a date
class ApplyRegimen(BaseModel):
    target_date: date
    tz_offset: int


class GenerateActivity(BaseModel):
    task_id: Optional[int] = None
    name: str
    estimated_duration: float
    is_urgent: bool = False
    is_important: bool = False
    is_frog: bool = False


class GenerateEvent(BaseModel):
    name: str
    start: UTCDateTime
    end: UTCDateTime


class GenerateRequest(BaseModel):
    start_time: UTCDateTime
    day_start: UTCDateTime
    day_end: UTCDateTime
    activities: List[GenerateActivity]
    existing_events: List[GenerateEvent] = []
    strategies: Optional[List[str]] = None
    avoid_existing: bool = False


class TimelineEntry(BaseModel):
    task_id: Optional[int] = None
    name: str
    start: UTCDateTime
    end: UTCDateTime


class FlaggedEntry(BaseModel):
    name: str
    reason: str


class StrategyOption(BaseModel):
    strategy: str
    label: str
    description: str
    timeline: List[TimelineEntry]
    flagged: List[FlaggedEntry] = []
    excluded: List[FlaggedEntry] = []


class GenerateResponse(BaseModel):
    options: List[StrategyOption]


# Export schemas
class ExportRequest(BaseModel):
    resource: Literal["sessions", "tasks"]
    format: Literal["csv", "json"]


class ExportLink(BaseModel):
    url: str
    expires_at: UTCDateTime
