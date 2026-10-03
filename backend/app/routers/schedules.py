from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, datetime, timedelta
from googleapiclient.errors import HttpError

from app.database import get_db
from app.models.schedule import Schedule, ScheduleItem
from app.models.task import Task
from app.models import schemas
from app.services.strategies import STRATEGY_REGISTRY, _build_timeline
from app.services.google_calendar import GoogleCalendarService

router = APIRouter()
calendar_service = GoogleCalendarService()


def _day_schedule(db: Session, target_date: date) -> Schedule:
    """The one Schedule for a date, created if the date has none."""
    schedule = db.query(Schedule).filter(
        Schedule.is_regimen == False,
        Schedule.target_date == target_date
    ).first()
    if not schedule:
        schedule = Schedule(target_date=target_date, is_regimen=False)
        db.add(schedule)
        db.flush()
    return schedule


def _require_google():
    if not calendar_service.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated with Google Calendar")


def _delete_event(event_id: str):
    try:
        calendar_service.service.events().delete(calendarId='primary', eventId=event_id).execute()
    except HttpError as e:
        if e.resp.status not in (404, 410):
            raise HTTPException(status_code=500, detail=str(e))


def _clear_other_frogs(db: Session, item: ScheduleItem):
    db.query(ScheduleItem).filter(
        ScheduleItem.schedule_id == item.schedule_id,
        ScheduleItem.id != item.id
    ).update({ScheduleItem.is_frog: False})


@router.get("/", response_model=List[schemas.Schedule])
def get_schedules(
    is_regimen: Optional[bool] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db)
):
    query = db.query(Schedule)
    if is_regimen is not None:
        query = query.filter(Schedule.is_regimen == is_regimen)
    if start_date is not None or end_date is not None:
        query = query.filter(Schedule.is_regimen == False)
        if start_date is not None:
            query = query.filter(Schedule.target_date >= start_date)
        if end_date is not None:
            query = query.filter(Schedule.target_date <= end_date)
        return query.order_by(Schedule.target_date).all()
    return query.order_by(Schedule.created_at.desc()).all()


@router.get("/{schedule_id}", response_model=schemas.Schedule)
def get_schedule(schedule_id: int, db: Session = Depends(get_db)):
    schedule = db.query(Schedule).filter(Schedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return schedule


@router.post("/", response_model=schemas.Schedule)
def create_schedule(schedule: schemas.ScheduleCreate, db: Session = Depends(get_db)):
    if schedule.is_regimen:
        db_schedule = Schedule(
            name=schedule.name,
            schedule_type=schedule.schedule_type,
            target_date=schedule.target_date,
            notes=schedule.notes,
            is_regimen=schedule.is_regimen,
        )
        db.add(db_schedule)
        db.flush()  # get id before adding items
    else:
        db_schedule = _day_schedule(db, schedule.target_date)
        if schedule.notes is not None and db_schedule.notes is None:
            db_schedule.notes = schedule.notes

    offset = len(db_schedule.items)
    for i, item in enumerate(schedule.items):
        db_item = ScheduleItem(
            schedule_id=db_schedule.id,
            task_id=item.task_id,
            custom_name=item.custom_name,
            estimated_duration=item.estimated_duration,
            position=item.position if item.position else offset + i,
            scheduled_time=item.scheduled_time,
            is_frog=item.is_frog,
        )
        db.add(db_item)
        if item.is_frog:
            db.flush()
            _clear_other_frogs(db, db_item)

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
def delete_schedule(schedule_id: int, delete_events: bool = False, db: Session = Depends(get_db)):
    db_schedule = db.query(Schedule).filter(Schedule.id == schedule_id).first()
    if not db_schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    if delete_events:
        exported = [item for item in db_schedule.items if item.calendar_event_id is not None]
        if exported:
            _require_google()
            for item in exported:
                _delete_event(item.calendar_event_id)
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
        is_frog=item.is_frog,
    )
    db.add(db_item)
    db.flush()
    if db_item.is_frog:
        _clear_other_frogs(db, db_item)
    db.commit()
    db.refresh(db_item)
    return db_item


@router.post("/days/{target_date}/items", response_model=schemas.ScheduleItem)
def place_item(
    target_date: date,
    item: schemas.ScheduleItemPlace,
    db: Session = Depends(get_db)
):
    task = db.query(Task).filter(Task.id == item.task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    estimated_duration = item.estimated_duration
    if estimated_duration is None:
        estimated_duration = task.average_duration or 600

    db_schedule = _day_schedule(db, target_date)
    db_item = ScheduleItem(
        schedule_id=db_schedule.id,
        task_id=item.task_id,
        estimated_duration=estimated_duration,
        position=len(db_schedule.items),
        scheduled_time=item.scheduled_time,
        is_frog=item.is_frog,
    )
    db.add(db_item)
    db.flush()
    if db_item.is_frog:
        _clear_other_frogs(db, db_item)
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
    if db_item.calendar_event_id is not None and (
        "scheduled_time" in update_data or "estimated_duration" in update_data
    ):
        db_item.calendar_stale = True

    for field, value in update_data.items():
        setattr(db_item, field, value)
    if db_item.is_frog:
        _clear_other_frogs(db, db_item)

    db.commit()
    db.refresh(db_item)
    return db_item


@router.delete("/{schedule_id}/items/{item_id}")
def delete_item(
    schedule_id: int,
    item_id: int,
    delete_event: bool = False,
    db: Session = Depends(get_db)
):
    db_item = db.query(ScheduleItem).filter(
        ScheduleItem.id == item_id,
        ScheduleItem.schedule_id == schedule_id
    ).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Item not found")
    if delete_event and db_item.calendar_event_id is not None:
        _require_google()
        _delete_event(db_item.calendar_event_id)
    db.delete(db_item)
    db.commit()
    return {"message": "Item deleted successfully"}


@router.delete("/{schedule_id}/items/{item_id}/calendar", response_model=schemas.ScheduleItem)
def remove_item_from_calendar(schedule_id: int, item_id: int, db: Session = Depends(get_db)):
    db_item = db.query(ScheduleItem).filter(
        ScheduleItem.id == item_id,
        ScheduleItem.schedule_id == schedule_id
    ).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Item not found")
    if db_item.calendar_event_id is not None:
        _require_google()
        _delete_event(db_item.calendar_event_id)
        db_item.calendar_event_id = None
        db_item.calendar_stale = False
        db.commit()
        db.refresh(db_item)
    return db_item


@router.post("/{schedule_id}/calendar", response_model=schemas.Schedule)
def push_schedule_to_calendar(schedule_id: int, db: Session = Depends(get_db)):
    """Create a Google Calendar event for each scheduled item that doesn't have one yet,
    and update the event of each item edited since it was pushed"""
    db_schedule = db.query(Schedule).filter(Schedule.id == schedule_id).first()
    if not db_schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    if not calendar_service.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated with Google Calendar")

    try:
        for item in db_schedule.items:
            if item.calendar_event_id is not None:
                if item.calendar_stale:
                    calendar_service.update_event(
                        item.calendar_event_id,
                        item.scheduled_time.isoformat(),
                        item.estimated_duration
                    )
                    item.calendar_stale = False
                continue
            if item.scheduled_time is None:
                continue

            title = item.custom_name or (item.task.name if item.task else "Untitled")
            event = calendar_service.create_event(
                task_name=title,
                duration_seconds=item.estimated_duration,
                start_time=item.scheduled_time.isoformat()
            )
            item.calendar_event_id = event.get('id')

        db.commit()
        db.refresh(db_schedule)
        return db_schedule
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{schedule_id}/calendar")
def remove_schedule_from_calendar(schedule_id: int, db: Session = Depends(get_db)):
    """Remove every pushed item's Google Calendar event and clear its id"""
    db_schedule = db.query(Schedule).filter(Schedule.id == schedule_id).first()
    if not db_schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    if not calendar_service.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated with Google Calendar")

    try:
        for item in db_schedule.items:
            if item.calendar_event_id is None:
                continue
            _delete_event(item.calendar_event_id)
            item.calendar_event_id = None
            item.calendar_stale = False

        db.commit()
        return {"message": "Schedule removed from calendar"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Apply regimen to a date ---

@router.post("/{schedule_id}/apply", response_model=schemas.Schedule)
def apply_regimen(
    schedule_id: int,
    body: schemas.ApplyRegimen,
    db: Session = Depends(get_db)
):
    """Copy a regimen's timed items onto a date's schedule, keeping each item's local time of day."""
    regimen = db.query(Schedule).filter(
        Schedule.id == schedule_id,
        Schedule.is_regimen == True
    ).first()
    if not regimen:
        raise HTTPException(status_code=404, detail="Regimen not found")

    new_schedule = _day_schedule(db, body.target_date)
    offset = timedelta(minutes=body.tz_offset)
    position = len(new_schedule.items)

    for item in regimen.items:
        if item.scheduled_time is None:
            continue
        local_time = (item.scheduled_time - offset).time()
        db_item = ScheduleItem(
            schedule_id=new_schedule.id,
            task_id=item.task_id,
            custom_name=item.custom_name,
            estimated_duration=item.estimated_duration,
            position=position,
            scheduled_time=datetime.combine(body.target_date, local_time) + offset,
            is_frog=item.is_frog,
        )
        db.add(db_item)
        position += 1
        if item.is_frog:
            db.flush()
            _clear_other_frogs(db, db_item)

    db.commit()
    db.refresh(new_schedule)
    return new_schedule


@router.post("/generate", response_model=schemas.GenerateResponse)
def generate_schedules(body: schemas.GenerateRequest, db: Session = Depends(get_db)):
    requested = body.strategies if body.strategies is not None else list(STRATEGY_REGISTRY.keys())
    unknown = [s for s in requested if s not in STRATEGY_REGISTRY]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown strategies: {unknown}")

    activities = [a.model_dump() for a in body.activities]
    task_ids = [a["task_id"] for a in activities if a["task_id"] is not None]
    if task_ids:
        tasks_by_id = {t.id: t for t in db.query(Task).filter(Task.id.in_(task_ids)).all()}
        for a in activities:
            if a["task_id"] is not None and a["task_id"] in tasks_by_id:
                task = tasks_by_id[a["task_id"]]
                if not a["is_urgent"]:
                    a["is_urgent"] = task.is_urgent
                if not a["is_important"]:
                    a["is_important"] = task.is_important
    existing_events = [e.model_dump() for e in body.existing_events]
    start_time = body.start_time

    options = []
    for name in requested:
        fn = STRATEGY_REGISTRY[name]
        result = fn(
            activities=activities,
            start_time=start_time,
            day_start=body.day_start,
            day_end=body.day_end,
            existing_events=existing_events,
        )
        if "timeline" in result:
            timeline = result["timeline"]
        else:
            timeline = _build_timeline(result["ordered"], start_time)
        options.append(schemas.StrategyOption(
            strategy=name,
            label=result["label"],
            description=result["description"],
            timeline=[schemas.TimelineEntry(**e) for e in timeline],
            flagged=[schemas.FlaggedEntry(**f) for f in result["flagged"]],
            excluded=[schemas.FlaggedEntry(**e) for e in result["excluded"]],
        ))

    return schemas.GenerateResponse(options=options)
