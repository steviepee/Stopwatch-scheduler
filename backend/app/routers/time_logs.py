from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models import task as task_model
from app.models import time_log as time_log_model
from app.models import schemas

router = APIRouter()

@router.get("/", response_model=List[schemas.TimeLog])
def get_time_logs(task_id: int = None, db: Session = Depends(get_db)):
    """Get all time logs, optionally filtered by task_id"""
    query = db.query(time_log_model.TimeLog)
    if task_id:
        query = query.filter(time_log_model.TimeLog.task_id == task_id)
    return query.all()

@router.post("/", response_model=schemas.TimeLog)
def create_time_log(time_log: schemas.TimeLogCreate, db: Session = Depends(get_db)):
    """Create a new time log and update task average"""
    # Verify task exists
    task = db.query(task_model.Task).filter(task_model.Task.id == time_log.task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Create time log
    db_time_log = time_log_model.TimeLog(
        task_id=time_log.task_id,
        duration=time_log.duration,
        notes=time_log.notes
    )
    db.add(db_time_log)

    # Update task average duration
    total_duration = task.average_duration * task.total_recordings
    task.total_recordings += 1
    task.average_duration = (total_duration + time_log.duration) / task.total_recordings

    db.commit()
    db.refresh(db_time_log)
    return db_time_log

@router.delete("/{time_log_id}")
def delete_time_log(time_log_id: int, db: Session = Depends(get_db)):
    """Delete a time log and recalculate task average"""
    db_time_log = db.query(time_log_model.TimeLog).filter(time_log_model.TimeLog.id == time_log_id).first()
    if not db_time_log:
        raise HTTPException(status_code=404, detail="Time log not found")

    # Get the task
    task = db.query(task_model.Task).filter(task_model.Task.id == db_time_log.task_id).first()

    # Recalculate average duration
    if task.total_recordings > 1:
        total_duration = task.average_duration * task.total_recordings
        task.total_recordings -= 1
        task.average_duration = (total_duration - db_time_log.duration) / task.total_recordings
    else:
        task.total_recordings = 0
        task.average_duration = 0.0

    db.delete(db_time_log)
    db.commit()
    return {"message": "Time log deleted successfully"}
