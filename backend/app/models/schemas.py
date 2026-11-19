from pydantic import BaseModel, AfterValidator, Field, PlainSerializer, model_validator
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
    intended_length: Optional[float] = Field(default=None, gt=0, le=43200)

class TaskUpdate(BaseModel):
    name: Optional[str] = None
    is_urgent: Optional[bool] = None
    is_important: Optional[bool] = None
    intended_length: Optional[float] = Field(default=None, gt=0, le=43200)

class Task(TaskBase):
    id: int
    average_duration: float
    total_recordings: int
    is_urgent: bool
    is_important: bool
    intended_length: Optional[float] = None
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
    pomodoro_work_intervals: Optional[int] = Field(default=None, ge=1)
    pomodoro_breaks: Optional[int] = Field(default=None, ge=0)
    pomodoro_break_seconds: Optional[float] = Field(default=None, ge=0)

    @model_validator(mode="after")
    def check_pomodoro_summary(self):
        summary = (self.pomodoro_work_intervals, self.pomodoro_breaks, self.pomodoro_break_seconds)
        if any(v is None for v in summary) and any(v is not None for v in summary):
            raise ValueError("pomodoro summary fields must be all set or all null")
        return self

def _check_new_activity_name(task_id: Optional[int], new_activity_name: Optional[str]) -> None:
    if new_activity_name is None:
        return
    if task_id is not None:
        raise ValueError("new_activity_name cannot be sent with task_id")
    if not new_activity_name.strip():
        raise ValueError("new_activity_name cannot be blank")


class StopwatchSessionCreate(StopwatchSessionBase):
    new_activity_name: Optional[str] = None

    @model_validator(mode="after")
    def check_new_activity_name(self):
        _check_new_activity_name(self.task_id, self.new_activity_name)
        return self

class StopwatchSessionUpdate(BaseModel):
    name: Optional[str] = None
    duration: Optional[float] = None
    task_id: Optional[int] = None
    notes: Optional[str] = None
    start_time: Optional[UTCDateTime] = None
    end_time: Optional[UTCDateTime] = None
    new_activity_name: Optional[str] = None

    @model_validator(mode="after")
    def check_new_activity_name(self):
        _check_new_activity_name(self.task_id, self.new_activity_name)
        return self

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


# Pomodoro settings schemas
class PomodoroSettingsBase(BaseModel):
    work_minutes: int = Field(ge=1, le=180)
    break_minutes: int = Field(ge=1, le=180)
    long_break_minutes: int = Field(ge=1, le=180)
    long_break_every: int = Field(ge=1, le=12)

class PomodoroSettings(PomodoroSettingsBase):
    class Config:
        from_attributes = True


class CoachSettingsBase(BaseModel):
    notes_enabled: bool

class CoachSettings(CoachSettingsBase):
    class Config:
        from_attributes = True


class ReminderSettingsBase(BaseModel):
    enabled: bool
    minutes_before: int = Field(ge=1, le=120)

class ReminderSettings(ReminderSettingsBase):
    class Config:
        from_attributes = True


class DisplaySettingsBase(BaseModel):
    clock_24h: bool

class DisplaySettings(DisplaySettingsBase):
    class Config:
        from_attributes = True


class CoachNoteBase(BaseModel):
    text: str = Field(min_length=1, max_length=300)

class CoachNote(CoachNoteBase):
    id: int
    created_at: UTCDateTime
    confirmed_at: UTCDateTime

    class Config:
        from_attributes = True


# Coaching conversation schemas
class CoachConversationOpen(BaseModel):
    target_date: date
    tz_offset: int

class CoachMessageCreate(BaseModel):
    text: str = Field(min_length=1, max_length=2000)

class CoachVisibleMessage(BaseModel):
    role: str
    visible_text: str
    created_at: UTCDateTime

class CoachDayItem(BaseModel):
    kind: Literal["event", "block"]
    name: str
    start: str
    end: str
    all_day: bool
    on_google: bool

class CoachConversation(BaseModel):
    id: int
    target_date: date
    status: str
    messages: List[CoachVisibleMessage]
    proposal: Optional[dict] = None
    changes_left: Optional[int] = None
    messages_left: Optional[int] = None
    day_items: List[CoachDayItem]
    note_suggestion: Optional[str] = None

class CoachRating(BaseModel):
    rating: Optional[Literal["up", "down"]]

class CoachCallRow(BaseModel):
    turn_index: int
    model: str
    effort: str
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: Optional[int] = None
    cache_creation_input_tokens: Optional[int] = None
    stop_reason: Optional[str] = None
    latency_ms: int
    cost_usd: float
    created_at: UTCDateTime

    class Config:
        from_attributes = True

class CoachConversationSummary(BaseModel):
    id: int
    target_date: date
    status: str
    user_turns: int
    revision_turns: int
    call_count: int
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    cache_creation_input_tokens: int
    cost_usd: float
    proposed_count: Optional[int] = None
    accepted_count: Optional[int] = None
    rating: Optional[str] = None
    created_at: UTCDateTime
    closed_at: Optional[UTCDateTime] = None

class CoachConversationDetail(CoachConversationSummary):
    messages: List[CoachVisibleMessage]
    proposal: Optional[dict] = None
    calls: List[CoachCallRow]

class CoachUsage(BaseModel):
    month: str
    conversations: int
    accepted: int
    cost_usd: float


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
    estimated_duration: float = Field(gt=0)
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
    disposition: Literal["attachment", "inline"] = "attachment"


class ExportLink(BaseModel):
    url: str
    expires_at: UTCDateTime


class WebSessionRequest(BaseModel):
    token: str
