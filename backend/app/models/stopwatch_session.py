from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean, func
from sqlalchemy.orm import relationship
from app.database import Base

class StopwatchSession(Base):
    __tablename__ = "stopwatch_sessions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    duration = Column(Float, nullable=False)  # in seconds
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    notes = Column(String(500), nullable=True)
    calendar_event_id = Column(String(255), nullable=True)  # Google Calendar event ID
    is_on_calendar = Column(Boolean, default=False)
    start_time = Column(DateTime, nullable=True)  # When the session started
    end_time = Column(DateTime, nullable=True)  # When the session ended
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationship to task (optional)
    task = relationship("Task", backref="stopwatch_sessions")
