from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel

from app.database import get_db
from app.services.task_stats import peak_hours

router = APIRouter()


class HourBucket(BaseModel):
    hour: int
    seconds: float
    count: int


class PeakHoursResponse(BaseModel):
    hours: List[HourBucket]
    peak_hour: Optional[int]
    total_seconds: float


@router.get("/peak-hours", response_model=PeakHoursResponse)
def get_peak_hours(
    tz_offset: int = Query(0),
    db: Session = Depends(get_db),
):
    hours_data = peak_hours(db, tz_offset)

    total_seconds = sum(b["seconds"] for b in hours_data)
    peak_hour = max(range(24), key=lambda h: hours_data[h]["seconds"]) if total_seconds > 0 else None

    return PeakHoursResponse(
        hours=[HourBucket(**b) for b in hours_data],
        peak_hour=peak_hour,
        total_seconds=total_seconds,
    )
