from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import schemas
from app.models.coach import CoachSettings, ReminderSettings
from app.models.pomodoro_settings import PomodoroSettings

router = APIRouter()


def _get_or_create(db: Session, model):
    row = db.query(model).first()
    if row is None:
        row = model()
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _update(db: Session, model, settings):
    row = _get_or_create(db, model)
    for key, value in settings.model_dump().items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


@router.get("/pomodoro", response_model=schemas.PomodoroSettings)
def get_pomodoro_settings(db: Session = Depends(get_db)):
    return _get_or_create(db, PomodoroSettings)


@router.put("/pomodoro", response_model=schemas.PomodoroSettings)
def update_pomodoro_settings(settings: schemas.PomodoroSettingsBase, db: Session = Depends(get_db)):
    return _update(db, PomodoroSettings, settings)


@router.get("/coach", response_model=schemas.CoachSettings)
def get_coach_settings(db: Session = Depends(get_db)):
    return _get_or_create(db, CoachSettings)


@router.put("/coach", response_model=schemas.CoachSettings)
def update_coach_settings(settings: schemas.CoachSettingsBase, db: Session = Depends(get_db)):
    return _update(db, CoachSettings, settings)


@router.get("/reminders", response_model=schemas.ReminderSettings)
def get_reminder_settings(db: Session = Depends(get_db)):
    return _get_or_create(db, ReminderSettings)


@router.put("/reminders", response_model=schemas.ReminderSettings)
def update_reminder_settings(settings: schemas.ReminderSettingsBase, db: Session = Depends(get_db)):
    return _update(db, ReminderSettings, settings)
