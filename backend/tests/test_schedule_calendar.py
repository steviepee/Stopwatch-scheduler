from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

from app.routers.schedules import calendar_service


def _make_schedule(client, items):
    payload = {"target_date": "2026-09-08", "items": items}
    return client.post("/api/schedules/", json=payload).json()


def test_post_unauthenticated_401(client):
    sched = _make_schedule(client, [{"estimated_duration": 300.0}])
    with patch.object(calendar_service, "is_authenticated", return_value=False):
        r = client.post(f"/api/schedules/{sched['id']}/calendar")
    assert r.status_code == 401


def test_post_unknown_schedule_404(client):
    with patch.object(calendar_service, "is_authenticated", return_value=True):
        r = client.post("/api/schedules/999999/calendar")
    assert r.status_code == 404


def test_post_creates_one_event_per_scheduled_item_and_persists_id(client):
    sched = _make_schedule(client, [
        {"custom_name": "Write report", "estimated_duration": 600.0, "scheduled_time": "2026-09-08T09:00:00Z"},
        {"custom_name": "No time set", "estimated_duration": 300.0},
    ])
    sid = sched["id"]

    with patch.object(calendar_service, "is_authenticated", return_value=True), \
         patch.object(calendar_service, "create_event") as mocked_create:
        mocked_create.return_value = {"id": "evt-1"}
        r = client.post(f"/api/schedules/{sid}/calendar")

    assert r.status_code == 200
    mocked_create.assert_called_once_with(
        task_name="Write report",
        duration_seconds=600.0,
        start_time="2026-09-08T09:00:00"
    )

    body = r.json()
    items_by_name = {i["custom_name"]: i for i in body["items"]}
    assert items_by_name["Write report"]["calendar_event_id"] == "evt-1"
    assert items_by_name["No time set"]["calendar_event_id"] is None


def test_post_skips_items_without_scheduled_time(client):
    sched = _make_schedule(client, [
        {"custom_name": "No time", "estimated_duration": 300.0},
    ])
    sid = sched["id"]

    with patch.object(calendar_service, "is_authenticated", return_value=True), \
         patch.object(calendar_service, "create_event") as mocked_create:
        r = client.post(f"/api/schedules/{sid}/calendar")

    assert r.status_code == 200
    mocked_create.assert_not_called()
    assert r.json()["items"][0]["calendar_event_id"] is None


def test_second_post_is_idempotent(client):
    sched = _make_schedule(client, [
        {"custom_name": "Write report", "estimated_duration": 600.0, "scheduled_time": "2026-09-08T09:00:00Z"},
    ])
    sid = sched["id"]

    with patch.object(calendar_service, "is_authenticated", return_value=True), \
         patch.object(calendar_service, "create_event") as mocked_create:
        mocked_create.return_value = {"id": "evt-1"}
        first = client.post(f"/api/schedules/{sid}/calendar")
        second = client.post(f"/api/schedules/{sid}/calendar")

    assert first.status_code == 200
    assert second.status_code == 200
    mocked_create.assert_called_once()
    assert second.json()["items"][0]["calendar_event_id"] == "evt-1"


def test_delete_unauthenticated_401(client):
    sched = _make_schedule(client, [{"estimated_duration": 300.0}])
    with patch.object(calendar_service, "is_authenticated", return_value=False):
        r = client.delete(f"/api/schedules/{sched['id']}/calendar")
    assert r.status_code == 401


def test_delete_unknown_schedule_404(client):
    with patch.object(calendar_service, "is_authenticated", return_value=True):
        r = client.delete("/api/schedules/999999/calendar")
    assert r.status_code == 404


def test_delete_removes_events_and_nulls_ids(client):
    sched = _make_schedule(client, [
        {"custom_name": "Write report", "estimated_duration": 600.0, "scheduled_time": "2026-09-08T09:00:00Z"},
    ])
    sid = sched["id"]

    with patch.object(calendar_service, "is_authenticated", return_value=True), \
         patch.object(calendar_service, "create_event") as mocked_create:
        mocked_create.return_value = {"id": "evt-1"}
        client.post(f"/api/schedules/{sid}/calendar")

    mock_service = MagicMock()
    with patch.object(calendar_service, "is_authenticated", return_value=True), \
         patch.object(calendar_service, "service", mock_service):
        r = client.delete(f"/api/schedules/{sid}/calendar")

    assert r.status_code == 200
    mock_service.events.return_value.delete.assert_called_once_with(
        calendarId='primary', eventId='evt-1'
    )

    fetched = client.get(f"/api/schedules/{sid}").json()
    assert fetched["items"][0]["calendar_event_id"] is None


# --- Push day patches stale Items (D43 revised, B16) ---

T9 = "2026-09-08T09:00:00Z"
T10 = "2026-09-08T10:00:00Z"
T11 = "2026-09-08T11:00:00Z"


@contextmanager
def _google():
    mock_service = MagicMock()
    with patch.object(calendar_service, "is_authenticated", return_value=True), \
         patch.object(calendar_service, "service", mock_service), \
         patch.object(calendar_service, "create_event") as create_event, \
         patch.object(calendar_service, "update_event", create=True) as update_event:
        yield {
            "create_event": create_event,
            "update_event": update_event,
            "delete": mock_service.events.return_value.delete,
            "patch": mock_service.events.return_value.patch,
            "insert": mock_service.events.return_value.insert,
        }


def _update_values(call):
    """(event_id, start as naive-UTC isoformat, duration) from an update_event call,
    whether passed positionally or by keyword, as a string or datetime."""
    values = dict(zip(["event_id", "start_time", "duration_seconds"], call.args))
    values.update(call.kwargs)
    start = values["start_time"]
    if isinstance(start, str):
        start = datetime.fromisoformat(start.replace("Z", "+00:00"))
    if start.tzinfo is not None:
        start = start.astimezone(timezone.utc).replace(tzinfo=None)
    return values["event_id"], start.isoformat(), float(values["duration_seconds"])


def _by_name(schedule):
    return {i["custom_name"]: i for i in schedule["items"]}


def _pushed_day(client):
    """Four pushed Items; then Moved is moved, Resized is resized, Kept is untouched,
    and New is added afterwards with no event."""
    sched = _make_schedule(client, [
        {"custom_name": "Moved", "estimated_duration": 600.0, "scheduled_time": T9},
        {"custom_name": "Resized", "estimated_duration": 600.0, "scheduled_time": T10},
        {"custom_name": "Kept", "estimated_duration": 600.0, "scheduled_time": T11},
    ])
    sid = sched["id"]
    with _google() as g:
        g["create_event"].side_effect = [{"id": "evt-moved"}, {"id": "evt-resized"}, {"id": "evt-kept"}]
        pushed = client.post(f"/api/schedules/{sid}/calendar").json()
    items = _by_name(pushed)
    assert all(i["calendar_stale"] is False for i in items.values())

    with patch.object(calendar_service, "is_authenticated", return_value=False):
        client.put(f"/api/schedules/{sid}/items/{items['Moved']['id']}",
                   json={"scheduled_time": "2026-09-08T12:00:00Z"})
        client.put(f"/api/schedules/{sid}/items/{items['Resized']['id']}",
                   json={"estimated_duration": 1200.0})
    client.post(f"/api/schedules/{sid}/items", json={
        "custom_name": "New", "estimated_duration": 300.0, "scheduled_time": "2026-09-08T13:00:00Z",
    })
    stale = {n: i["calendar_stale"] for n, i in _by_name(client.get(f"/api/schedules/{sid}").json()).items()}
    assert stale == {"Moved": True, "Resized": True, "Kept": False, "New": False}
    return sid


def test_push_day_patches_stale_creates_new_touches_nothing_else_and_clears_flags(client):
    sid = _pushed_day(client)

    with _google() as g:
        g["create_event"].return_value = {"id": "evt-new"}
        r = client.post(f"/api/schedules/{sid}/calendar")

    assert r.status_code == 200
    assert sorted(_update_values(c) for c in g["update_event"].call_args_list) == [
        ("evt-moved", "2026-09-08T12:00:00", 600.0),
        ("evt-resized", "2026-09-08T10:00:00", 1200.0),
    ]
    g["create_event"].assert_called_once_with(
        task_name="New", duration_seconds=300.0, start_time="2026-09-08T13:00:00"
    )
    assert not g["delete"].called
    assert not g["insert"].called
    assert all(c.kwargs.get("eventId") in {"evt-moved", "evt-resized"} for c in g["patch"].call_args_list)

    items = _by_name(r.json())
    assert {n: i["calendar_event_id"] for n, i in items.items()} == {
        "Moved": "evt-moved", "Resized": "evt-resized", "Kept": "evt-kept", "New": "evt-new",
    }
    assert all(i["calendar_stale"] is False for i in items.values())
    fetched = _by_name(client.get(f"/api/schedules/{sid}").json())
    assert all(i["calendar_stale"] is False for i in fetched.values())


def test_push_day_with_only_stale_items_creates_nothing(client):
    sid = _pushed_day(client)
    new_id = _by_name(client.get(f"/api/schedules/{sid}").json())["New"]["id"]
    client.delete(f"/api/schedules/{sid}/items/{new_id}")

    with _google() as g:
        r = client.post(f"/api/schedules/{sid}/calendar")

    assert r.status_code == 200
    assert g["update_event"].call_count == 2
    assert not g["create_event"].called
    assert all(i["calendar_stale"] is False for i in r.json()["items"])


def test_second_push_day_right_after_makes_no_google_calls(client):
    sid = _pushed_day(client)
    with _google() as g:
        g["create_event"].return_value = {"id": "evt-new"}
        client.post(f"/api/schedules/{sid}/calendar")

    with _google() as g:
        r = client.post(f"/api/schedules/{sid}/calendar")

    assert r.status_code == 200
    assert not g["create_event"].called
    assert not g["update_event"].called
    assert not g["delete"].called
    assert not g["patch"].called
    assert not g["insert"].called
