from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import schemas
from app.models.pomodoro_settings import PomodoroSettings

router = APIRouter()


def _get_or_create(db: Session) -> PomodoroSettings:
    row = db.query(PomodoroSettings).first()
    if row is None:
        row = PomodoroSettings()
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.get("/pomodoro", response_model=schemas.PomodoroSettings)
def get_pomodoro_settings(db: Session = Depends(get_db)):
    return _get_or_create(db)


@router.put("/pomodoro", response_model=schemas.PomodoroSettings)
def update_pomodoro_settings(settings: schemas.PomodoroSettingsBase, db: Session = Depends(get_db)):
    row = _get_or_create(db)
    for key, value in settings.model_dump().items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row
