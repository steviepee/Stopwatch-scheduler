from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean, Text, func
from sqlalchemy.orm import relationship
from app.database import Base


class Schedule(Base):
    __tablename__ = "schedules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    schedule_type = Column(String(20), default="day")  # day | week | month
    target_date = Column(DateTime, nullable=True)
    rating = Column(Integer, nullable=True)  # 1-5
    notes = Column(Text, nullable=True)
    is_regimen = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    items = relationship("ScheduleItem", back_populates="schedule", cascade="all, delete-orphan", order_by="ScheduleItem.position")


class ScheduleItem(Base):
    __tablename__ = "schedule_items"

    id = Column(Integer, primary_key=True, index=True)
    schedule_id = Column(Integer, ForeignKey("schedules.id"), nullable=False)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    custom_name = Column(String(255), nullable=True)  # used when no task match
    estimated_duration = Column(Float, nullable=False)  # seconds
    position = Column(Integer, default=0)
    scheduled_time = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    schedule = relationship("Schedule", back_populates="items")
    task = relationship("Task")
