from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models import task as task_model
from app.models import schemas

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
