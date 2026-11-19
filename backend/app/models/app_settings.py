from sqlalchemy import Boolean, Column, Integer, false
from app.database import Base


class AppSettings(Base):
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, index=True)
    clock_24h = Column(Boolean, nullable=False, default=False, server_default=false())
