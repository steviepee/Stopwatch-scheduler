from fastapi import APIRouter, HTTPException
from app.services.google_calendar import GoogleCalendarService

router = APIRouter()

# This will be used for Google Calendar OAuth
calendar_service = GoogleCalendarService()

@router.get("/google/login")
def google_login():
    """Initiate Google OAuth flow"""
    try:
        auth_url = calendar_service.get_auth_url()
        return {"auth_url": auth_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/callback")
def auth_callback(code: str):
    """Handle OAuth callback from Google"""
    try:
        calendar_service.authenticate(code)
        return {"message": "Successfully authenticated with Google Calendar"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/calendar/event")
def create_calendar_event(task_name: str, duration_seconds: float, start_time: str = None):
    """Create a Google Calendar event with the task duration"""
    try:
        event = calendar_service.create_event(
            task_name=task_name,
            duration_seconds=duration_seconds,
            start_time=start_time
        )
        return {"message": "Event created", "event": event}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status")
def auth_status():
    """Check if user is authenticated with Google Calendar"""
    is_authenticated = calendar_service.is_authenticated()
    return {"authenticated": is_authenticated}


@router.get("/calendar/events")
def get_calendar_events(date: str, tz_offset: int = 0):
    """Fetch Google Calendar events for a given date (YYYY-MM-DD) in the caller's local day."""
    if not calendar_service.is_authenticated():
        raise HTTPException(status_code=401, detail="Not authenticated with Google Calendar")
    try:
        events = calendar_service.get_events_for_date(date, tz_offset)
        return events
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
