from sqlalchemy import Column, Integer, Text, DateTime
from app.database import Base, utcnow

class GoogleCredential(Base):
    __tablename__ = "google_credentials"

    id = Column(Integer, primary_key=True, index=True)
    data = Column(Text, nullable=False)  # Fernet-encrypted Credentials.to_json()
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
