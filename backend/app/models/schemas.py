from pydantic import BaseModel
from datetime import datetime
from typing import Optional

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
