from sqlalchemy import Column, Integer, DateTime
from app.database import Base, utcnow

class PomodoroSettings(Base):
    __tablename__ = "pomodoro_settings"

    id = Column(Integer, primary_key=True, index=True)
    work_minutes = Column(Integer, nullable=False, default=25)
    break_minutes = Column(Integer, nullable=False, default=5)
    long_break_minutes = Column(Integer, nullable=False, default=15)
    long_break_every = Column(Integer, nullable=False, default=4)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
