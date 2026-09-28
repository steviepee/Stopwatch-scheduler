from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base, utcnow

class StopwatchSession(Base):
    __tablename__ = "stopwatch_sessions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    duration = Column(Float, nullable=False)  # in seconds
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    notes = Column(String(500), nullable=True)
    start_time = Column(DateTime, nullable=True)  # When the session started (actual)
    end_time = Column(DateTime, nullable=True)  # When the session ended (actual)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    # Relationship to task (optional)
    task = relationship("Task", backref="stopwatch_sessions")
