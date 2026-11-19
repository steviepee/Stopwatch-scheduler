from datetime import datetime, timedelta

from app.models.stopwatch_session import StopwatchSession
from app.models.time_log import TimeLog


def add_recording(task, duration: float) -> None:
    total = task.average_duration * task.total_recordings
    task.total_recordings += 1
    task.average_duration = (total + duration) / task.total_recordings


def remove_recording(task, duration: float) -> None:
    if task.total_recordings > 1:
        total = task.average_duration * task.total_recordings
        task.total_recordings -= 1
        task.average_duration = (total - duration) / task.total_recordings
    else:
        task.total_recordings = 0
        task.average_duration = 0.0


def median(durations):
    durations = sorted(durations)
    n = len(durations)
    if n == 0:
        return None
    if n % 2 == 1:
        return durations[n // 2]
    return (durations[n // 2 - 1] + durations[n // 2]) / 2


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


def peak_hours(db, tz_offset: int) -> list:
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

    for tl in db.query(TimeLog).filter(TimeLog.session_id.is_(None)).all():
        end_utc = tl.created_at
        start_utc = tl.created_at - timedelta(seconds=tl.duration)
        _distribute(start_utc, end_utc, offset, hours_data)

    return hours_data
