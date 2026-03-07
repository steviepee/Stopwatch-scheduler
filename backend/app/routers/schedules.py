from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from app.database import get_db
from app.models.schedule import Schedule, ScheduleItem
from app.models import schemas

router = APIRouter()


@router.get("/", response_model=List[schemas.Schedule])
def get_schedules(
    is_regimen: Optional[bool] = None,
    db: Session = Depends(get_db)
):
    query = db.query(Schedule)
    if is_regimen is not None:
        query = query.filter(Schedule.is_regimen == is_regimen)
    return query.order_by(Schedule.created_at.desc()).all()


@router.get("/{schedule_id}", response_model=schemas.Schedule)
def get_schedule(schedule_id: int, db: Session = Depends(get_db)):
    schedule = db.query(Schedule).filter(Schedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return schedule


@router.post("/", response_model=schemas.Schedule)
def create_schedule(schedule: schemas.ScheduleCreate, db: Session = Depends(get_db)):
    db_schedule = Schedule(
        name=schedule.name,
        schedule_type=schedule.schedule_type,
        target_date=schedule.target_date,
        notes=schedule.notes,
        is_regimen=schedule.is_regimen,
    )
    db.add(db_schedule)
    db.flush()  # get id before adding items

    for i, item in enumerate(schedule.items):
        db_item = ScheduleItem(
            schedule_id=db_schedule.id,
            task_id=item.task_id,
            custom_name=item.custom_name,
            estimated_duration=item.estimated_duration,
            position=item.position if item.position else i,
            scheduled_time=item.scheduled_time,
        )
        db.add(db_item)

    db.commit()
    db.refresh(db_schedule)
    return db_schedule


@router.put("/{schedule_id}", response_model=schemas.Schedule)
def update_schedule(
    schedule_id: int,
    schedule: schemas.ScheduleUpdate,
    db: Session = Depends(get_db)
):
    db_schedule = db.query(Schedule).filter(Schedule.id == schedule_id).first()
    if not db_schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    update_data = schedule.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_schedule, field, value)

    db.commit()
    db.refresh(db_schedule)
    return db_schedule


@router.delete("/{schedule_id}")
def delete_schedule(schedule_id: int, db: Session = Depends(get_db)):
    db_schedule = db.query(Schedule).filter(Schedule.id == schedule_id).first()
    if not db_schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    db.delete(db_schedule)
    db.commit()
    return {"message": "Schedule deleted successfully"}


@router.patch("/{schedule_id}/rate", response_model=schemas.Schedule)
def rate_schedule(schedule_id: int, rating: int, db: Session = Depends(get_db)):
    if rating < 1 or rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")
    db_schedule = db.query(Schedule).filter(Schedule.id == schedule_id).first()
    if not db_schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    db_schedule.rating = rating
    db.commit()
    db.refresh(db_schedule)
    return db_schedule


# --- ScheduleItem endpoints ---

@router.post("/{schedule_id}/items", response_model=schemas.ScheduleItem)
def add_item(
    schedule_id: int,
    item: schemas.ScheduleItemCreate,
    db: Session = Depends(get_db)
):
    db_schedule = db.query(Schedule).filter(Schedule.id == schedule_id).first()
    if not db_schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    db_item = ScheduleItem(
        schedule_id=schedule_id,
        task_id=item.task_id,
        custom_name=item.custom_name,
        estimated_duration=item.estimated_duration,
        position=item.position,
        scheduled_time=item.scheduled_time,
    )
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item


@router.put("/{schedule_id}/items/{item_id}", response_model=schemas.ScheduleItem)
def update_item(
    schedule_id: int,
    item_id: int,
    item: schemas.ScheduleItemUpdate,
    db: Session = Depends(get_db)
):
    db_item = db.query(ScheduleItem).filter(
        ScheduleItem.id == item_id,
        ScheduleItem.schedule_id == schedule_id
    ).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Item not found")

    update_data = item.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_item, field, value)

    db.commit()
    db.refresh(db_item)
    return db_item


@router.delete("/{schedule_id}/items/{item_id}")
def delete_item(schedule_id: int, item_id: int, db: Session = Depends(get_db)):
    db_item = db.query(ScheduleItem).filter(
        ScheduleItem.id == item_id,
        ScheduleItem.schedule_id == schedule_id
    ).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(db_item)
    db.commit()
    return {"message": "Item deleted successfully"}


# --- Apply regimen to a date ---

@router.post("/{schedule_id}/apply", response_model=schemas.Schedule)
def apply_regimen(
    schedule_id: int,
    body: schemas.ApplyRegimen,
    db: Session = Depends(get_db)
):
    """Create a new schedule from a regimen template applied to a specific date."""
    regimen = db.query(Schedule).filter(
        Schedule.id == schedule_id,
        Schedule.is_regimen == True
    ).first()
    if not regimen:
        raise HTTPException(status_code=404, detail="Regimen not found")

    new_schedule = Schedule(
        name=body.name or regimen.name,
        schedule_type=regimen.schedule_type,
        target_date=body.target_date,
        notes=regimen.notes,
        is_regimen=False,
    )
    db.add(new_schedule)
    db.flush()

    for item in regimen.items:
        db_item = ScheduleItem(
            schedule_id=new_schedule.id,
            task_id=item.task_id,
            custom_name=item.custom_name,
            estimated_duration=item.estimated_duration,
            position=item.position,
        )
        db.add(db_item)

    db.commit()
    db.refresh(new_schedule)
    return new_schedule
