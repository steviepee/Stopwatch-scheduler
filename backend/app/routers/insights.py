from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List, Optional
from pydantic import BaseModel

from app.database import get_db
from app.models.stopwatch_session import StopwatchSession
from app.models.time_log import TimeLog

router = APIRouter()


class HourBucket(BaseModel):
    hour: int
    seconds: float
    count: int


class PeakHoursResponse(BaseModel):
    hours: List[HourBucket]
    peak_hour: Optional[int]
    total_seconds: float


def _distribute(start_utc: datetime, end_utc: datetime, offset: timedelta, hours_data: list):
    if start_utc >= end_utc:
        return
    start_local = start_utc - offset
    end_local = end_utc - offset
    touched = set()
    cursor = start_local
    while cursor < end_local:
        h = cursor.hour
        next_hour = datetime(cursor.year, cursor.month, cursor.day, cursor.hour) + timedelta(hours=1)
        seg_end = min(next_hour, end_local)
        hours_data[h]["seconds"] += (seg_end - cursor).total_seconds()
        touched.add(h)
        cursor = seg_end
    for h in touched:
        hours_data[h]["count"] += 1


@router.get("/peak-hours", response_model=PeakHoursResponse)
def get_peak_hours(
    tz_offset: int = Query(0),
    db: Session = Depends(get_db),
):
    hours_data = [{"hour": h, "seconds": 0.0, "count": 0} for h in range(24)]
    offset = timedelta(minutes=tz_offset)

    for s in db.query(StopwatchSession).all():
        if s.start_time is not None:
            start_utc = s.start_time
            end_utc = s.start_time + timedelta(seconds=s.duration)
        else:
            end_utc = s.created_at
            start_utc = s.created_at - timedelta(seconds=s.duration)
        _distribute(start_utc, end_utc, offset, hours_data)

    for tl in db.query(TimeLog).all():
        end_utc = tl.created_at
        start_utc = tl.created_at - timedelta(seconds=tl.duration)
        _distribute(start_utc, end_utc, offset, hours_data)

    total_seconds = sum(b["seconds"] for b in hours_data)
    peak_hour = max(range(24), key=lambda h: hours_data[h]["seconds"]) if total_seconds > 0 else None

    return PeakHoursResponse(
        hours=[HourBucket(**b) for b in hours_data],
        peak_hour=peak_hour,
        total_seconds=total_seconds,
    )
