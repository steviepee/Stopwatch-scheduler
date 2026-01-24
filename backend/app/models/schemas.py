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
