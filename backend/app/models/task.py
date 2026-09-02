from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean
from sqlalchemy.orm import relationship
from app.database import Base, utcnow

class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, index=True, nullable=False)
    average_duration = Column(Float, default=0.0)  # in seconds
    total_recordings = Column(Integer, default=0)
    is_urgent = Column(Boolean, nullable=False, default=False)
    is_important = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    # Relationship to time logs
    time_logs = relationship("TimeLog", back_populates="task", cascade="all, delete-orphan")
