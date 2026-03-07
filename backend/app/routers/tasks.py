from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models import task as task_model
from app.models import schemas
from app.models.time_log import TimeLog

router = APIRouter()

@router.get("/", response_model=List[schemas.Task])
def get_tasks(db: Session = Depends(get_db)):
    """Get all tasks"""
    tasks = db.query(task_model.Task).all()
    return tasks

@router.get("/{task_id}", response_model=schemas.TaskWithLogs)
def get_task(task_id: int, db: Session = Depends(get_db)):
    """Get a specific task with its time logs"""
    task = db.query(task_model.Task).filter(task_model.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task

@router.post("/", response_model=schemas.Task)
def create_task(task: schemas.TaskCreate, db: Session = Depends(get_db)):
    """Create a new task"""
    # Check if task with same name exists
    existing_task = db.query(task_model.Task).filter(task_model.Task.name == task.name).first()
    if existing_task:
        raise HTTPException(status_code=400, detail="Task with this name already exists")

    db_task = task_model.Task(name=task.name)
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task

@router.put("/{task_id}", response_model=schemas.Task)
def update_task(task_id: int, task: schemas.TaskUpdate, db: Session = Depends(get_db)):
    """Update a task"""
    db_task = db.query(task_model.Task).filter(task_model.Task.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.name:
        db_task.name = task.name

    db.commit()
    db.refresh(db_task)
    return db_task

@router.delete("/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    """Delete a task"""
    db_task = db.query(task_model.Task).filter(task_model.Task.id == task_id).first()
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    db.delete(db_task)
    db.commit()
    return {"message": "Task deleted successfully"}


@router.get("/{task_id}/stats", response_model=schemas.TaskStats)
def get_task_stats(task_id: int, db: Session = Depends(get_db)):
    """Get average, median, and previous duration for a task."""
    task = db.query(task_model.Task).filter(task_model.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    logs = (
        db.query(TimeLog)
        .filter(TimeLog.task_id == task_id)
        .order_by(TimeLog.created_at.desc())
        .all()
    )

    if not logs:
        return schemas.TaskStats(average=0.0, median=None, previous=None)

    previous = logs[0].duration

    durations = sorted(l.duration for l in logs)
    n = len(durations)
    if n % 2 == 1:
        median = durations[n // 2]
    else:
        median = (durations[n // 2 - 1] + durations[n // 2]) / 2

    return schemas.TaskStats(
        average=task.average_duration,
        median=median,
        previous=previous,
    )
