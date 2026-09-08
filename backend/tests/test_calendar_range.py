from unittest.mock import patch

from app.routers.calendar_auth import calendar_service


def test_single_date_unauthenticated_401(client):
    with patch.object(calendar_service, "is_authenticated", return_value=False):
        r = client.get("/api/auth/calendar/events", params={"date": "2026-09-08"})
    assert r.status_code == 401


def test_single_date_includes_id(client):
    with patch.object(calendar_service, "is_authenticated", return_value=True), \
         patch.object(calendar_service, "get_events_for_date") as mocked:
        mocked.return_value = [
            {"id": "evt-1", "summary": "Standup", "start": "2026-09-08T09:00:00Z", "end": "2026-09-08T09:15:00Z"}
        ]
        r = client.get("/api/auth/calendar/events", params={"date": "2026-09-08", "tz_offset": 300})

    assert r.status_code == 200
    events = r.json()
    assert events[0]["id"] == "evt-1"
    mocked.assert_called_once_with("2026-09-08", 300)


def test_range_returns_events_tagged_with_day(client):
    with patch.object(calendar_service, "is_authenticated", return_value=True), \
         patch.object(calendar_service, "get_events_for_range") as mocked:
        mocked.return_value = [
            {"id": "evt-1", "summary": "Day 1", "start": "2026-09-08T09:00:00Z", "end": "2026-09-08T09:15:00Z", "day": "2026-09-08"},
            {"id": "evt-2", "summary": "Day 2", "start": "2026-09-09T09:00:00Z", "end": "2026-09-09T09:15:00Z", "day": "2026-09-09"},
        ]
        r = client.get(
            "/api/auth/calendar/events",
            params={"date": "2026-09-08", "end_date": "2026-09-09", "tz_offset": 300},
        )

    assert r.status_code == 200
    events = r.json()
    assert [e["day"] for e in events] == ["2026-09-08", "2026-09-09"]
    mocked.assert_called_once_with("2026-09-08", "2026-09-09", 300)


def test_range_unauthenticated_401(client):
    with patch.object(calendar_service, "is_authenticated", return_value=False):
        r = client.get(
            "/api/auth/calendar/events",
            params={"date": "2026-09-08", "end_date": "2026-09-09"},
        )
    assert r.status_code == 401


def test_end_date_before_date_is_400(client):
    with patch.object(calendar_service, "is_authenticated", return_value=True):
        r = client.get(
            "/api/auth/calendar/events",
            params={"date": "2026-09-08", "end_date": "2026-09-07"},
        )
    assert r.status_code == 400


def test_service_get_events_for_range_tags_local_day():
    from unittest.mock import MagicMock
    from app.services.google_calendar import GoogleCalendarService

    with patch.object(GoogleCalendarService, "_load_credentials", return_value=None):
        service = GoogleCalendarService()

    service.creds = MagicMock(expired=False)
    service.service = MagicMock()
    service.service.events.return_value.list.return_value.execute.return_value = {
        "items": [
            {
                "id": "evt-1",
                "summary": "Late UTC event, earlier local day",
                "start": {"dateTime": "2026-09-09T02:00:00Z"},
                "end": {"dateTime": "2026-09-09T02:30:00Z"},
            },
            {
                "id": "evt-2",
                "summary": "All day",
                "start": {"date": "2026-09-08"},
                "end": {"date": "2026-09-09"},
            },
        ]
    }

    with patch.object(GoogleCalendarService, "is_authenticated", return_value=True):
        # tz_offset 300 == UTC-5 (US Eastern in DST terms), so 02:00 UTC is still
        # the previous local day.
        events = service.get_events_for_range("2026-09-08", "2026-09-09", tz_offset=300)

    assert events[0]["day"] == "2026-09-08"
    assert events[1]["day"] == "2026-09-08"


def test_get_events_for_date_still_works_unchanged():
    from unittest.mock import MagicMock
    from app.services.google_calendar import GoogleCalendarService

    with patch.object(GoogleCalendarService, "_load_credentials", return_value=None):
        service = GoogleCalendarService()

    service.creds = MagicMock(expired=False)
    service.service = MagicMock()
    service.service.events.return_value.list.return_value.execute.return_value = {
        "items": [
            {
                "id": "evt-1",
                "summary": "Standup",
                "start": {"dateTime": "2026-09-08T09:00:00Z"},
                "end": {"dateTime": "2026-09-08T09:15:00Z"},
            }
        ]
    }

    with patch.object(GoogleCalendarService, "is_authenticated", return_value=True):
        events = service.get_events_for_date("2026-09-08", tz_offset=0)

    assert events == [
        {
            "id": "evt-1",
            "summary": "Standup",
            "start": "2026-09-08T09:00:00Z",
            "end": "2026-09-08T09:15:00Z",
        }
    ]
