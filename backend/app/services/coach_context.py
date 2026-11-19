import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from app.database import utcnow
from app.models.app_settings import AppSettings
from app.models.coach import CoachNote, CoachSettings
from app.models.schedule import Schedule, ScheduleItem
from app.models.stopwatch_session import StopwatchSession
from app.models.task import Task
from app.models.time_log import TimeLog
from app.services.google_calendar import GoogleCalendarService
from app.services.task_stats import median, peak_hours

logger = logging.getLogger(__name__)

RECORDING_DAYS = 14
QUADRANTS = {
    (True, True): "Q1 urgent and important",
    (False, True): "Q2 important, not urgent",
    (True, False): "Q3 urgent, not important",
    (False, False): "Q4 neither urgent nor important",
}


def now_utc() -> datetime:
    return utcnow()


def local_now(tz_offset: int) -> datetime:
    return now_utc() - timedelta(minutes=tz_offset)


def time_line(tz_offset: int) -> str:
    now = local_now(tz_offset)
    return f"Current local date and time: {now:%Y-%m-%d} {now:%H:%M} ({now:%A})"


def fmt_duration(seconds) -> str:
    minutes = round(seconds / 60)
    hours, minutes = divmod(minutes, 60)
    if hours and minutes:
        return f"{hours} h {minutes} min"
    if hours:
        return f"{hours} h"
    return f"{minutes} min"


def _to_local(utc: datetime, tz_offset: int) -> datetime:
    return utc - timedelta(minutes=tz_offset)


def _parse_event_time(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def existing_events(target_date: date, tz_offset: int):
    """The date's Google events as dicts with local start/end, or None if Google is not authorized."""
    calendar = GoogleCalendarService()
    if not calendar.is_authenticated():
        return None
    try:
        raw = calendar.get_events_for_date(target_date.isoformat(), tz_offset)
    except Exception:
        logger.exception("Could not read Google Calendar events for the Coach")
        return None
    events = []
    for e in raw:
        if not e.get("start") or "T" not in e["start"]:
            events.append({"name": e.get("summary", ""), "all_day": True, "start": e.get("start"), "end": e.get("end")})
            continue
        start_utc = _parse_event_time(e["start"])
        end_utc = _parse_event_time(e["end"])
        events.append({
            "name": e.get("summary", ""), "all_day": False,
            "start_utc": start_utc, "end_utc": end_utc,
            "start": _to_local(start_utc, tz_offset), "end": _to_local(end_utc, tz_offset),
        })
    return events


def day_blocks(db, target_date: date, tz_offset: int) -> list:
    schedule = db.query(Schedule).filter(Schedule.is_regimen == False, Schedule.target_date == target_date).first()
    if not schedule:
        return []
    blocks = []
    for item in db.query(ScheduleItem).filter(ScheduleItem.schedule_id == schedule.id).all():
        block = {
            "name": item.task.name if item.task else (item.custom_name or ""),
            "duration": item.estimated_duration,
            "is_frog": item.is_frog,
            "on_google": item.calendar_event_id is not None,
            "start_utc": item.scheduled_time,
            "start": None,
            "end": None,
        }
        if item.scheduled_time is not None:
            block["end_utc"] = item.scheduled_time + timedelta(seconds=item.estimated_duration)
            block["start"] = _to_local(item.scheduled_time, tz_offset)
            block["end"] = _to_local(block["end_utc"], tz_offset)
        blocks.append(block)
    return blocks


def _utc_iso(dt: datetime) -> str:
    return dt.isoformat() + "Z"


def day_items(events, blocks) -> list:
    timed = []
    all_day = []
    for e in events or []:
        if e["all_day"]:
            all_day.append({"kind": "event", "name": e["name"], "start": e["start"], "end": e["end"],
                            "all_day": True, "on_google": True})
        else:
            timed.append((e["start_utc"], {"kind": "event", "name": e["name"], "start": _utc_iso(e["start_utc"]),
                                           "end": _utc_iso(e["end_utc"]), "all_day": False, "on_google": True}))
    for b in blocks:
        if b["start_utc"] is None:
            continue
        timed.append((b["start_utc"], {"kind": "block", "name": b["name"], "start": _utc_iso(b["start_utc"]),
                                       "end": _utc_iso(b["end_utc"]), "all_day": False, "on_google": b["on_google"]}))
    timed.sort(key=lambda pair: pair[0])
    return all_day + [d for _, d in timed]


def notes_enabled(db) -> bool:
    row = db.query(CoachSettings).first()
    return row.notes_enabled if row else True


def _clock_24h(db) -> bool:
    row = db.query(AppSettings).first()
    return row.clock_24h if row else False


def build_context(db, target_date: date, tz_offset: int, events, blocks) -> str:
    day = target_date.isoformat()
    lines = [
        f"Planned dates: {day}",
        f"Clock: {'24-hour' if _clock_24h(db) else '12-hour'}",
        "",
        "Activities (id, name, average, median, Quadrant, Recordings, Intended length):",
    ]

    durations = defaultdict(list)
    for log in db.query(TimeLog).all():
        durations[log.task_id].append(log.duration)
    tasks = db.query(Task).order_by(Task.name).all()
    for t in tasks:
        has_history = t.total_recordings > 0
        average = fmt_duration(t.average_duration) if has_history else "none"
        med = median(durations[t.id]) if has_history else None
        intended = fmt_duration(t.intended_length) if t.intended_length else "none"
        lines.append(
            f"- {t.id}, {t.name}, average {average}, median {fmt_duration(med) if med is not None else 'none'}, "
            f"{QUADRANTS[(bool(t.is_urgent), bool(t.is_important))]}, {t.total_recordings} Recordings, "
            f"Intended length {intended}"
        )
    if not tasks:
        lines.append("- none")

    lines += ["", f"Schedule Items on {day} (Blocks already placed):"]
    for b in sorted(blocks, key=lambda b: (b["start"] is None, b["start"] or datetime.min)):
        when = f"{b['start']:%H:%M}-{b['end']:%H:%M}" if b["start"] else "no start time"
        frog = ", Frog" if b["is_frog"] else ""
        lines.append(f"- {b['name']}, {when}, {fmt_duration(b['duration'])}{frog}")
    if not blocks:
        lines.append("- none")
    if not any(b["is_frog"] for b in blocks):
        lines.append("This date has no Frog yet.")

    lines.append("")
    if events is None:
        lines.append("Existing events: Google Calendar is not connected, so Existing events are not known.")
    else:
        lines.append(f"Existing events on {day} (from Google Calendar):")
        for e in events:
            if e["all_day"]:
                lines.append(f"- {e['name']}, all day")
            else:
                lines.append(f"- {e['name']}, {e['start']:%H:%M}-{e['end']:%H:%M}")
        if not events:
            lines.append("- none")

    hours = [h for h in peak_hours(db, tz_offset) if h["seconds"] > 0]
    top = sorted(hours, key=lambda h: h["seconds"], reverse=True)[:3]
    lines.append("")
    if top:
        lines.append("Peak hours (local hours with the most recorded time): " + ", ".join(
            f"{h['hour']:02d}:00 ({fmt_duration(h['seconds'])})" for h in top
        ))
    else:
        lines.append("Peak hours: none recorded yet.")

    if notes_enabled(db):
        lines += ["", "Coach notes:"]
        notes = db.query(CoachNote).order_by(CoachNote.created_at, CoachNote.id).all()
        lines += [f"- {n.text}" for n in notes] or ["- none"]

    today = local_now(tz_offset).date()
    first_day = today - timedelta(days=RECORDING_DAYS - 1)
    names = {t.id: t.name for t in tasks}
    recordings = []
    for s in db.query(StopwatchSession).all():
        local = _to_local(s.start_time or s.created_at, tz_offset)
        if first_day <= local.date() <= today:
            recordings.append((local, names.get(s.task_id, "no Activity"), s.duration))
    recordings.sort(key=lambda r: r[0])
    lines += ["", f"Recordings, last {RECORDING_DAYS} days (Activity, duration, local date):"]
    lines += [f"- {name}, {fmt_duration(seconds)}, {local:%Y-%m-%d}" for local, name, seconds in recordings] or ["- none"]

    return "\n".join(lines)
