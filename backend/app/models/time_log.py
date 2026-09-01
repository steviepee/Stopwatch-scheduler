from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base, utcnow

class TimeLog(Base):
    __tablename__ = "time_logs"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    duration = Column(Float, nullable=False)  # in seconds
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=utcnow)

    # Relationship to task
    task = relationship("Task", back_populates="time_logs")
