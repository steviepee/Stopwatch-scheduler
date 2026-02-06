from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from app.database import get_db
from app.models.stopwatch_session import StopwatchSession
from app.models import schemas
from app.services.google_calendar import GoogleCalendarService

router = APIRouter()
calendar_service = GoogleCalendarService()

@router.get("/", response_model=List[schemas.StopwatchSession])
def get_sessions(
    task_id: Optional[int] = None,
    on_calendar: Optional[bool] = None,
    scheduled: Optional[bool] = None,
    db: Session = Depends(get_db)
):
    """Get all stopwatch sessions with optional filters"""
    query = db.query(StopwatchSession)

    if task_id is not None:
        query = query.filter(StopwatchSession.task_id == task_id)
    if on_calendar is not None:
        query = query.filter(StopwatchSession.is_on_calendar == on_calendar)
    if scheduled is not None:
        if scheduled:
            query = query.filter(StopwatchSession.scheduled_start.isnot(None))
        else:
            query = query.filter(StopwatchSession.scheduled_start.is_(None))

    sessions = query.order_by(StopwatchSession.created_at.desc()).all()
    return sessions

@router.get("/{session_id}", response_model=schemas.StopwatchSessionWithTask)
def get_session(session_id: int, db: Session = Depends(get_db)):
    """Get a specific stopwatch session with its task"""
    session = db.query(StopwatchSession).filter(StopwatchSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session

@router.post("/", response_model=schemas.StopwatchSession)
def create_session(session: schemas.StopwatchSessionCreate, db: Session = Depends(get_db)):
    """Create a new stopwatch session"""
    db_session = StopwatchSession(
        name=session.name,
        duration=session.duration,
        task_id=session.task_id,
        notes=session.notes,
        start_time=session.start_time,
        end_time=session.end_time
    )
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    return db_session

@router.put("/{session_id}", response_model=schemas.StopwatchSession)
def update_session(
    session_id: int,
    session: schemas.StopwatchSessionUpdate,
    db: Session = Depends(get_db)
):
    """Update a stopwatch session"""
    db_session = db.query(StopwatchSession).filter(StopwatchSession.id == session_id).first()
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")

    update_data = session.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_session, field, value)

    db.commit()
    db.refresh(db_session)
    return db_session

@router.delete("/{session_id}")
def delete_session(session_id: int, db: Session = Depends(get_db)):
    """Delete a stopwatch session"""
    db_session = db.query(StopwatchSession).filter(StopwatchSession.id == session_id).first()
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")

    db.delete(db_session)
    db.commit()
    return {"message": "Session deleted successfully"}

@router.post("/{session_id}/calendar", response_model=schemas.StopwatchSession)
def add_session_to_calendar(session_id: int, db: Session = Depends(get_db)):
    """Add a stopwatch session to Google Calendar"""
    db_session = db.query(StopwatchSession).filter(StopwatchSession.id == session_id).first()
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")

    if db_session.is_on_calendar:
        raise HTTPException(status_code=400, detail="Session is already on calendar")

    if not calendar_service.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated with Google Calendar")

    try:
        # Use scheduled_start (from calendar), then start_time, then created_at
        start_time = db_session.scheduled_start or db_session.start_time or db_session.created_at

        event = calendar_service.create_event(
            task_name=db_session.name,
            duration_seconds=db_session.duration,
            start_time=start_time.isoformat() if start_time else None
        )

        db_session.calendar_event_id = event.get('id')
        db_session.is_on_calendar = True
        db.commit()
        db.refresh(db_session)

        return db_session
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{session_id}/schedule", response_model=schemas.StopwatchSession)
def schedule_session(
    session_id: int,
    schedule: schemas.StopwatchSessionSchedule,
    db: Session = Depends(get_db)
):
    """Schedule a session on the custom calendar"""
    db_session = db.query(StopwatchSession).filter(StopwatchSession.id == session_id).first()
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")

    db_session.scheduled_start = schedule.scheduled_start
    # If no scheduled_end provided, calculate from duration
    if schedule.scheduled_end:
        db_session.scheduled_end = schedule.scheduled_end
    else:
        from datetime import timedelta
        db_session.scheduled_end = schedule.scheduled_start + timedelta(seconds=db_session.duration)

    db.commit()
    db.refresh(db_session)
    return db_session

@router.put("/{session_id}/unschedule", response_model=schemas.StopwatchSession)
def unschedule_session(session_id: int, db: Session = Depends(get_db)):
    """Remove a session from the custom calendar"""
    db_session = db.query(StopwatchSession).filter(StopwatchSession.id == session_id).first()
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")

    db_session.scheduled_start = None
    db_session.scheduled_end = None
    db.commit()
    db.refresh(db_session)
    return db_session

@router.delete("/{session_id}/calendar")
def remove_session_from_calendar(session_id: int, db: Session = Depends(get_db)):
    """Remove a stopwatch session from Google Calendar"""
    db_session = db.query(StopwatchSession).filter(StopwatchSession.id == session_id).first()
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")

    if not db_session.is_on_calendar or not db_session.calendar_event_id:
        raise HTTPException(status_code=400, detail="Session is not on calendar")

    if not calendar_service.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated with Google Calendar")

    try:
        # Delete from Google Calendar
        calendar_service.service.events().delete(
            calendarId='primary',
            eventId=db_session.calendar_event_id
        ).execute()

        db_session.calendar_event_id = None
        db_session.is_on_calendar = False
        db.commit()

        return {"message": "Session removed from calendar"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
