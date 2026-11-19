from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from app.database import Base, utcnow


class CoachConversation(Base):
    __tablename__ = "coach_conversations"

    id = Column(Integer, primary_key=True, index=True)
    target_date = Column(Date, nullable=False, index=True)
    tz_offset = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False, default="open")
    model = Column(String(100), nullable=False)
    effort = Column(String(20), nullable=False)
    user_turns = Column(Integer, nullable=False, default=0)
    revision_turns = Column(Integer, nullable=False, default=0)
    proposal = Column(Text, nullable=True)
    proposed_count = Column(Integer, nullable=True)
    accepted_count = Column(Integer, nullable=True)
    accepted_items = Column(Text, nullable=True)
    context = Column(Text, nullable=True)
    rating = Column(String(10), nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
    closed_at = Column(DateTime, nullable=True)

    messages = relationship("CoachMessage", back_populates="conversation", cascade="all, delete-orphan")
    calls = relationship("CoachCall", back_populates="conversation", cascade="all, delete-orphan")


class CoachMessage(Base):
    __tablename__ = "coach_messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("coach_conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    visible_text = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    conversation = relationship("CoachConversation", back_populates="messages")


class CoachCall(Base):
    __tablename__ = "coach_calls"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("coach_conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    turn_index = Column(Integer, nullable=False)
    model = Column(String(100), nullable=False)
    effort = Column(String(20), nullable=False)
    input_tokens = Column(Integer, nullable=False)
    cache_creation_input_tokens = Column(Integer, nullable=True)
    cache_read_input_tokens = Column(Integer, nullable=True)
    output_tokens = Column(Integer, nullable=False)
    stop_reason = Column(String(50), nullable=True)
    latency_ms = Column(Integer, nullable=False)
    cost_usd = Column(Float, nullable=False)
    created_at = Column(DateTime, default=utcnow)

    conversation = relationship("CoachConversation", back_populates="calls")


class CoachNote(Base):
    __tablename__ = "coach_notes"

    id = Column(Integer, primary_key=True, index=True)
    text = Column(String(300), nullable=False)
    created_at = Column(DateTime, default=utcnow)
    confirmed_at = Column(DateTime, default=utcnow)


class CoachSettings(Base):
    __tablename__ = "coach_settings"

    id = Column(Integer, primary_key=True, index=True)
    notes_enabled = Column(Boolean, nullable=False, default=True)


class ReminderSettings(Base):
    __tablename__ = "reminder_settings"

    id = Column(Integer, primary_key=True, index=True)
    enabled = Column(Boolean, nullable=False, default=True)
    minutes_before = Column(Integer, nullable=False, default=5)
