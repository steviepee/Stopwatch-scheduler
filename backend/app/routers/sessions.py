from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from app.database import get_db
from app.models.stopwatch_session import StopwatchSession
from app.models import task as task_model
from app.models import time_log as time_log_model
from app.models import schemas
from app.services.task_stats import add_recording, remove_recording

router = APIRouter()

@router.get("/", response_model=List[schemas.StopwatchSession])
def get_sessions(
    task_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Get all stopwatch sessions with optional filters"""
    query = db.query(StopwatchSession)

    if task_id is not None:
        query = query.filter(StopwatchSession.task_id == task_id)

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
    db.flush()

    if session.task_id is not None:
        task = db.query(task_model.Task).filter(task_model.Task.id == session.task_id).first()
        if task:
            log = time_log_model.TimeLog(
                task_id=session.task_id,
                session_id=db_session.id,
                duration=session.duration,
            )
            db.add(log)
            add_recording(task, session.duration)

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

    if 'task_id' in update_data and update_data['task_id'] != db_session.task_id:
        old_task_id = db_session.task_id
        new_task_id = update_data['task_id']
        linked_log = db.query(time_log_model.TimeLog).filter(
            time_log_model.TimeLog.session_id == session_id
        ).first()
        if linked_log and old_task_id is not None:
            old_task = db.query(task_model.Task).filter(task_model.Task.id == old_task_id).first()
            if old_task:
                remove_recording(old_task, linked_log.duration)
            linked_log.task_id = new_task_id
        if linked_log and new_task_id is not None:
            new_task = db.query(task_model.Task).filter(task_model.Task.id == new_task_id).first()
            if new_task:
                add_recording(new_task, linked_log.duration)

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

    linked_log = db.query(time_log_model.TimeLog).filter(
        time_log_model.TimeLog.session_id == session_id
    ).first()
    if linked_log:
        if db_session.task_id is not None:
            task = db.query(task_model.Task).filter(task_model.Task.id == db_session.task_id).first()
            if task:
                remove_recording(task, linked_log.duration)
        db.delete(linked_log)

    db.delete(db_session)
    db.commit()
    return {"message": "Session deleted successfully"}
