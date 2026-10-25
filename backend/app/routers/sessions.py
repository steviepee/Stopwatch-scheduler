from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List, Optional

from app.database import get_db
from app.models.stopwatch_session import StopwatchSession
from app.models import task as task_model
from app.models import time_log as time_log_model
from app.models import schemas
from app.services.task_stats import add_recording, remove_recording

router = APIRouter()


def _resolve_activity(db: Session, new_activity_name: str) -> task_model.Task:
    """Resolve a Recording's new_activity_name to an Activity, creating one (Q4) if none matches."""
    name = new_activity_name.strip()
    task = db.query(task_model.Task).filter(
        func.lower(task_model.Task.name) == name.lower()
    ).first()
    if task is None:
        task = task_model.Task(name=name)
        db.add(task)
        db.flush()
    return task

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
    resolved_task_id = session.task_id
    if session.new_activity_name is not None:
        resolved_task_id = _resolve_activity(db, session.new_activity_name).id

    db_session = StopwatchSession(
        name=session.name,
        duration=session.duration,
        task_id=resolved_task_id,
        notes=session.notes,
        start_time=session.start_time,
        end_time=session.end_time
    )
    db.add(db_session)
    db.flush()

    if resolved_task_id is not None:
        task = db.query(task_model.Task).filter(task_model.Task.id == resolved_task_id).first()
        if task:
            log = time_log_model.TimeLog(
                task_id=resolved_task_id,
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

    new_activity_name = update_data.pop('new_activity_name', None)
    if new_activity_name is not None:
        update_data['task_id'] = _resolve_activity(db, new_activity_name).id

    if 'task_id' in update_data and update_data['task_id'] != db_session.task_id:
        old_task_id = db_session.task_id
        new_task_id = update_data['task_id']
        linked_log = db.query(time_log_model.TimeLog).filter(
            time_log_model.TimeLog.session_id == session_id
        ).first()

        if linked_log is None:
            if new_task_id is not None:
                linked_log = time_log_model.TimeLog(
                    task_id=new_task_id,
                    session_id=db_session.id,
                    duration=db_session.duration,
                )
                db.add(linked_log)
                new_task = db.query(task_model.Task).filter(task_model.Task.id == new_task_id).first()
                if new_task:
                    add_recording(new_task, db_session.duration)
        else:
            if old_task_id is not None:
                old_task = db.query(task_model.Task).filter(task_model.Task.id == old_task_id).first()
                if old_task:
                    remove_recording(old_task, linked_log.duration)
            if new_task_id is not None:
                linked_log.task_id = new_task_id
                new_task = db.query(task_model.Task).filter(task_model.Task.id == new_task_id).first()
                if new_task:
                    add_recording(new_task, linked_log.duration)
            else:
                db.delete(linked_log)

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
