from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List

# Task Schemas
class TaskBase(BaseModel):
    name: str

class TaskCreate(TaskBase):
    pass

class TaskUpdate(BaseModel):
    name: Optional[str] = None

class Task(TaskBase):
    id: int
    average_duration: float
    total_recordings: int
    created_at: datetime
    updated_at: datetime

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
    created_at: datetime

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
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None

class StopwatchSessionCreate(StopwatchSessionBase):
    pass

class StopwatchSessionUpdate(BaseModel):
    name: Optional[str] = None
    duration: Optional[float] = None
    task_id: Optional[int] = None
    notes: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    is_on_calendar: Optional[bool] = None
    calendar_event_id: Optional[str] = None

class StopwatchSession(StopwatchSessionBase):
    id: int
    calendar_event_id: Optional[str] = None
    is_on_calendar: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class StopwatchSessionSchedule(BaseModel):
    scheduled_start: datetime
    scheduled_end: Optional[datetime] = None

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
    scheduled_time: Optional[datetime] = None

class ScheduleItemCreate(ScheduleItemBase):
    pass

class ScheduleItemUpdate(BaseModel):
    task_id: Optional[int] = None
    custom_name: Optional[str] = None
    estimated_duration: Optional[float] = None
    position: Optional[int] = None
    scheduled_time: Optional[datetime] = None

class ScheduleItem(ScheduleItemBase):
    id: int
    schedule_id: int
    task: Optional[Task] = None
    created_at: datetime

    class Config:
        from_attributes = True


# Schedule schemas
class ScheduleBase(BaseModel):
    name: str
    schedule_type: str = "day"
    target_date: Optional[datetime] = None
    notes: Optional[str] = None
    is_regimen: bool = False

class ScheduleCreate(ScheduleBase):
    items: List[ScheduleItemCreate] = []

class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    schedule_type: Optional[str] = None
    target_date: Optional[datetime] = None
    rating: Optional[int] = None
    notes: Optional[str] = None
    is_regimen: Optional[bool] = None

class Schedule(ScheduleBase):
    id: int
    rating: Optional[int] = None
    items: List[ScheduleItem] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# For applying a regimen to a date
class ApplyRegimen(BaseModel):
    target_date: datetime
    name: Optional[str] = None
