from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

import httplib2
import pytest
from googleapiclient.errors import HttpError

from app.models.schedule import Schedule, ScheduleItem
from app.routers.schedules import calendar_service

DAY = "2026-09-08"
T9 = "2026-09-08T09:00:00Z"
T10 = "2026-09-08T10:00:00Z"
T11 = "2026-09-08T11:00:00Z"


@contextmanager
def _google(authenticated=True):
    """Every way the routers reach Google, mocked. Yields the mocks by name."""
    mock_service = MagicMock()
    with patch.object(calendar_service, "is_authenticated", return_value=authenticated), \
         patch.object(calendar_service, "service", mock_service), \
         patch.object(calendar_service, "create_event") as create_event, \
         patch.object(calendar_service, "update_event", create=True) as update_event:
        yield {
            "service": mock_service,
            "create_event": create_event,
            "update_event": update_event,
            "delete": mock_service.events.return_value.delete,
            "patch": mock_service.events.return_value.patch,
        }


def _exported_schedule(client, items, event_ids):
    """A day Schedule whose timed Items were pushed, taking `event_ids` in order."""
    sched = client.post("/api/schedules/", json={"target_date": DAY, "items": items}).json()
    with _google() as g:
        g["create_event"].side_effect = [{"id": e} for e in event_ids]
        r = client.post(f"/api/schedules/{sched['id']}/calendar")
    assert r.status_code == 200
    return r.json()


def _item(schedule, name):
    return next(i for i in schedule["items"] if i["custom_name"] == name)


def _no_google_calls(g):
    assert not g["create_event"].called
    assert not g["update_event"].called
    assert not g["delete"].called
    assert not g["patch"].called


def _deleted_event_ids(g):
    return [c.kwargs.get("eventId") for c in g["delete"].call_args_list]


def _update_values(call):
    """(event_id, start as naive-UTC isoformat, duration) from an update_event call,
    whether the route passed them positionally or by keyword, as a string or datetime."""
    names = ["event_id", "start_time", "duration_seconds"]
    values = dict(zip(names, call.args))
    values.update(call.kwargs)
    start = values["start_time"]
    if isinstance(start, str):
        start = datetime.fromisoformat(start.replace("Z", "+00:00"))
    if start.tzinfo is not None:
        start = start.astimezone(timezone.utc).replace(tzinfo=None)
    return values["event_id"], start.isoformat(), float(values["duration_seconds"])


# --- GoogleCalendarService.update_event ---

def test_update_event_patches_start_and_end():
    mock_service = MagicMock()
    with patch.object(calendar_service, "is_authenticated", return_value=True), \
         patch.object(calendar_service, "service", mock_service):
        calendar_service.update_event("evt-1", "2026-09-08T10:00:00Z", 900)

    events = mock_service.events.return_value
    events.patch.assert_called_once()
    kwargs = events.patch.call_args.kwargs
    assert kwargs["calendarId"] == "primary"
    assert kwargs["eventId"] == "evt-1"
    assert kwargs["body"]["start"]["dateTime"] == "2026-09-08T10:00:00"
    assert kwargs["body"]["end"]["dateTime"] == "2026-09-08T10:15:00"
    assert kwargs["body"]["start"]["timeZone"] == "UTC"
    assert kwargs["body"]["end"]["timeZone"] == "UTC"
    events.patch.return_value.execute.assert_called_once()
    assert not events.insert.called
    assert not events.delete.called


# --- PUT item: moving and resizing wait for Push (D43 revised, B16) ---

def _stale(client, sid, name):
    return _item(client.get(f"/api/schedules/{sid}").json(), name)["calendar_stale"]


@pytest.mark.parametrize("change", [
    {"scheduled_time": T10},
    {"estimated_duration": 1500.0},
    {"scheduled_time": T11, "estimated_duration": 300.0},
])
def test_editing_exported_item_makes_no_google_call_needs_no_auth_and_marks_stale(client, change):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    item = _item(sched, "Write")
    assert item["calendar_stale"] is False

    with _google(authenticated=False) as g:
        r = client.put(f"/api/schedules/{sched['id']}/items/{item['id']}", json=change)

    assert r.status_code == 200
    _no_google_calls(g)
    body = r.json()
    assert body["calendar_stale"] is True
    assert body["calendar_event_id"] == "evt-1"
    for field, value in change.items():
        assert body[field] == value
    assert _stale(client, sched["id"], "Write") is True


def test_editing_exported_item_authenticated_still_makes_no_google_call(client):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    item = _item(sched, "Write")

    with _google() as g:
        r = client.put(f"/api/schedules/{sched['id']}/items/{item['id']}", json={"scheduled_time": T10})

    assert r.status_code == 200
    _no_google_calls(g)
    assert r.json()["calendar_stale"] is True


def test_put_changing_only_is_frog_leaves_flag_false(client):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    item = _item(sched, "Write")

    with _google(authenticated=False) as g:
        r = client.put(f"/api/schedules/{sched['id']}/items/{item['id']}", json={"is_frog": True})

    assert r.status_code == 200
    _no_google_calls(g)
    assert r.json()["is_frog"] is True
    assert r.json()["calendar_stale"] is False
    assert _stale(client, sched["id"], "Write") is False


def test_editing_non_exported_item_calls_no_google_method_and_is_not_stale(client):
    sched = client.post("/api/schedules/", json={"target_date": DAY, "items": [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ]}).json()
    item = _item(sched, "Write")

    with _google(authenticated=False) as g:
        moved = client.put(f"/api/schedules/{sched['id']}/items/{item['id']}", json={"scheduled_time": T10})
        resized = client.put(f"/api/schedules/{sched['id']}/items/{item['id']}", json={"estimated_duration": 900.0})

    assert moved.status_code == 200
    assert resized.status_code == 200
    _no_google_calls(g)
    assert resized.json()["scheduled_time"] == T10
    assert resized.json()["estimated_duration"] == 900.0
    assert resized.json()["calendar_stale"] is False


# --- DELETE item, with and without delete_event ---

def test_delete_exported_item_with_delete_event_deletes_event_then_item(client):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    item = _item(sched, "Write")

    with _google() as g:
        r = client.delete(f"/api/schedules/{sched['id']}/items/{item['id']}", params={"delete_event": "true"})

    assert r.status_code == 200
    g["delete"].assert_called_once_with(calendarId="primary", eventId="evt-1")
    assert client.get(f"/api/schedules/{sched['id']}").json()["items"] == []


def test_delete_exported_item_with_delete_event_false_leaves_event(client):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    item = _item(sched, "Write")

    with _google() as g:
        r = client.delete(f"/api/schedules/{sched['id']}/items/{item['id']}", params={"delete_event": "false"})

    assert r.status_code == 200
    _no_google_calls(g)
    assert client.get(f"/api/schedules/{sched['id']}").json()["items"] == []


def test_delete_exported_item_defaults_to_leaving_event(client):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    item = _item(sched, "Write")

    with _google() as g:
        r = client.delete(f"/api/schedules/{sched['id']}/items/{item['id']}")

    assert r.status_code == 200
    _no_google_calls(g)
    assert client.get(f"/api/schedules/{sched['id']}").json()["items"] == []


def test_delete_item_without_delete_event_needs_no_google_auth(client):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    item = _item(sched, "Write")

    with _google(authenticated=False) as g:
        r = client.delete(f"/api/schedules/{sched['id']}/items/{item['id']}")

    assert r.status_code == 200
    _no_google_calls(g)


def test_delete_non_exported_item_with_delete_event_calls_no_google_method(client):
    sched = client.post("/api/schedules/", json={"target_date": DAY, "items": [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ]}).json()
    item = _item(sched, "Write")

    with _google() as g:
        r = client.delete(f"/api/schedules/{sched['id']}/items/{item['id']}", params={"delete_event": "true"})

    assert r.status_code == 200
    _no_google_calls(g)
    assert client.get(f"/api/schedules/{sched['id']}").json()["items"] == []


def test_delete_exported_item_with_delete_event_unauthenticated_401_nothing_deleted(client):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    item = _item(sched, "Write")

    with _google(authenticated=False) as g:
        r = client.delete(f"/api/schedules/{sched['id']}/items/{item['id']}", params={"delete_event": "true"})

    assert r.status_code == 401
    _no_google_calls(g)
    items = client.get(f"/api/schedules/{sched['id']}").json()["items"]
    assert [i["calendar_event_id"] for i in items] == ["evt-1"]


# --- DELETE one Item's calendar event ---

def test_item_calendar_removal_deletes_event_and_keeps_item(client):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
        {"custom_name": "Read", "estimated_duration": 300.0, "scheduled_time": T10},
    ], ["evt-1", "evt-2"])
    item = _item(sched, "Write")

    with _google() as g:
        r = client.delete(f"/api/schedules/{sched['id']}/items/{item['id']}/calendar")

    assert r.status_code == 200
    g["delete"].assert_called_once_with(calendarId="primary", eventId="evt-1")
    fetched = client.get(f"/api/schedules/{sched['id']}").json()
    assert _item(fetched, "Write")["calendar_event_id"] is None
    assert _item(fetched, "Write")["scheduled_time"] == T9
    assert _item(fetched, "Read")["calendar_event_id"] == "evt-2"


def test_item_calendar_removal_unauthenticated_401_keeps_id(client):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    item = _item(sched, "Write")

    with _google(authenticated=False) as g:
        r = client.delete(f"/api/schedules/{sched['id']}/items/{item['id']}/calendar")

    assert r.status_code == 401
    _no_google_calls(g)
    fetched = client.get(f"/api/schedules/{sched['id']}").json()
    assert _item(fetched, "Write")["calendar_event_id"] == "evt-1"


def test_item_calendar_removal_unknown_item_404(client):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])

    with _google() as g:
        r = client.delete(f"/api/schedules/{sched['id']}/items/999999/calendar")

    assert r.status_code == 404
    _no_google_calls(g)


# --- DELETE schedule: Clear all ---

def test_clear_all_deletes_exactly_the_stored_events_then_schedule_and_items(client, db):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
        {"custom_name": "Read", "estimated_duration": 300.0, "scheduled_time": T10},
        {"custom_name": "Untimed", "estimated_duration": 300.0},
    ], ["evt-1", "evt-2"])
    sid = sched["id"]

    with _google() as g:
        r = client.delete(f"/api/schedules/{sid}", params={"delete_events": "true"})

    assert r.status_code == 200
    assert sorted(_deleted_event_ids(g)) == ["evt-1", "evt-2"]
    assert all(c.kwargs.get("calendarId") == "primary" for c in g["delete"].call_args_list)
    assert not g["update_event"].called
    assert client.get(f"/api/schedules/{sid}").status_code == 404
    assert db.query(Schedule).filter(Schedule.id == sid).count() == 0
    assert db.query(ScheduleItem).filter(ScheduleItem.schedule_id == sid).count() == 0


def test_delete_schedule_defaults_to_leaving_events(client, db):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    sid = sched["id"]

    with _google(authenticated=False) as g:
        r = client.delete(f"/api/schedules/{sid}")

    assert r.status_code == 200
    _no_google_calls(g)
    assert db.query(Schedule).filter(Schedule.id == sid).count() == 0
    assert db.query(ScheduleItem).filter(ScheduleItem.schedule_id == sid).count() == 0


def test_clear_all_with_delete_events_false_leaves_events(client, db):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    sid = sched["id"]

    with _google() as g:
        r = client.delete(f"/api/schedules/{sid}", params={"delete_events": "false"})

    assert r.status_code == 200
    _no_google_calls(g)
    assert db.query(Schedule).filter(Schedule.id == sid).count() == 0


def test_clear_all_unauthenticated_401_nothing_deleted(client, db):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
        {"custom_name": "Untimed", "estimated_duration": 300.0},
    ], ["evt-1"])
    sid = sched["id"]

    with _google(authenticated=False) as g:
        r = client.delete(f"/api/schedules/{sid}", params={"delete_events": "true"})

    assert r.status_code == 401
    _no_google_calls(g)
    fetched = client.get(f"/api/schedules/{sid}").json()
    assert len(fetched["items"]) == 2
    assert _item(fetched, "Write")["calendar_event_id"] == "evt-1"


def test_clear_all_with_nothing_exported_needs_no_google_auth(client, db):
    sched = client.post("/api/schedules/", json={"target_date": DAY, "items": [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ]}).json()
    sid = sched["id"]

    with _google(authenticated=False) as g:
        r = client.delete(f"/api/schedules/{sid}", params={"delete_events": "true"})

    assert r.status_code == 200
    _no_google_calls(g)
    assert db.query(Schedule).filter(Schedule.id == sid).count() == 0


def test_remove_from_google_only_is_unchanged(client):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    sid = sched["id"]

    with _google() as g:
        r = client.delete(f"/api/schedules/{sid}/calendar")

    assert r.status_code == 200
    g["delete"].assert_called_once_with(calendarId="primary", eventId="evt-1")
    fetched = client.get(f"/api/schedules/{sid}").json()
    assert len(fetched["items"]) == 1
    assert fetched["items"][0]["calendar_event_id"] is None


# --- Only stored ids ever reach Google ---

def test_no_route_touches_an_event_id_not_stored_on_its_item(client):
    """Two days, each with an Exported Item. Every operation on the first day may only
    touch the first day's event id; the second day's event is never updated or deleted."""
    day_a = _exported_schedule(client, [
        {"custom_name": "A1", "estimated_duration": 600.0, "scheduled_time": T9},
        {"custom_name": "A2", "estimated_duration": 600.0, "scheduled_time": T10},
        {"custom_name": "A3", "estimated_duration": 600.0, "scheduled_time": T11},
        {"custom_name": "A-local", "estimated_duration": 600.0},
    ], ["evt-a1", "evt-a2", "evt-a3"])
    day_b = client.post("/api/schedules/", json={"target_date": "2026-09-09", "items": [
        {"custom_name": "B1", "estimated_duration": 600.0, "scheduled_time": "2026-09-09T09:00:00Z"},
    ]}).json()
    with _google() as g:
        g["create_event"].return_value = {"id": "evt-b1"}
        client.post(f"/api/schedules/{day_b['id']}/calendar")

    sid = day_a["id"]
    a1, a2, a3 = (_item(day_a, n)["id"] for n in ("A1", "A2", "A3"))
    local = _item(day_a, "A-local")["id"]
    b1 = day_b["items"][0]["id"]

    with _google() as g:
        # An item id from another Schedule is not found under this one.
        assert client.put(f"/api/schedules/{sid}/items/{b1}", json={"scheduled_time": T10}).status_code == 404
        assert client.delete(f"/api/schedules/{sid}/items/{b1}", params={"delete_event": "true"}).status_code == 404
        assert client.delete(f"/api/schedules/{sid}/items/{b1}/calendar").status_code == 404

        g["create_event"].return_value = {"id": "evt-a-local"}
        client.put(f"/api/schedules/{sid}/items/{local}", json={"scheduled_time": T10})
        client.put(f"/api/schedules/{sid}/items/{a1}", json={"scheduled_time": T11})
        client.post(f"/api/schedules/{sid}/calendar")
        client.delete(f"/api/schedules/{sid}/items/{a2}/calendar")
        client.delete(f"/api/schedules/{sid}/items/{a3}", params={"delete_event": "true"})
        client.delete(f"/api/schedules/{sid}", params={"delete_events": "true"})

    updated = [_update_values(c)[0] for c in g["update_event"].call_args_list]
    deleted = _deleted_event_ids(g)
    patched = [c.kwargs.get("eventId") for c in g["patch"].call_args_list]
    assert updated == ["evt-a1"]
    assert g["create_event"].call_count == 1
    assert sorted(deleted) == ["evt-a-local", "evt-a1", "evt-a2", "evt-a3"]
    assert deleted.count("evt-a2") == 1
    assert all(e in {"evt-a1"} for e in patched)
    assert "evt-b1" not in updated + deleted + patched

    fetched_b = client.get(f"/api/schedules/{day_b['id']}").json()
    assert fetched_b["items"][0]["calendar_event_id"] == "evt-b1"


# --- Google deletes tolerate events that are already gone (B13) ---

def _http_error(status):
    return HttpError(httplib2.Response({"status": status}), b"{}")


def _delete_fails(g, statuses):
    """Google's delete raises HttpError(status) for each eventId in `statuses` (read at call
    time, so a test can change it between requests); every other id deletes cleanly."""
    def delete(*args, **kwargs):
        request = MagicMock()
        status = statuses.get(kwargs.get("eventId"))
        if status is not None:
            request.execute.side_effect = _http_error(status)
        return request
    g["delete"].side_effect = delete


def _three_exported(client):
    return _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
        {"custom_name": "Read", "estimated_duration": 600.0, "scheduled_time": T10},
        {"custom_name": "Run", "estimated_duration": 600.0, "scheduled_time": T11},
    ], ["evt-1", "evt-2", "evt-3"])


def _event_ids(client, sid):
    items = client.get(f"/api/schedules/{sid}").json()["items"]
    return {i["custom_name"]: i["calendar_event_id"] for i in items}


@pytest.mark.parametrize("status", [404, 410])
def test_item_delete_treats_gone_event_as_deleted(client, status):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    item = _item(sched, "Write")

    with _google() as g:
        _delete_fails(g, {"evt-1": status})
        r = client.delete(f"/api/schedules/{sched['id']}/items/{item['id']}", params={"delete_event": "true"})

    assert r.status_code == 200
    assert _deleted_event_ids(g) == ["evt-1"]
    assert client.get(f"/api/schedules/{sched['id']}").json()["items"] == []


@pytest.mark.parametrize("status", [404, 410])
def test_item_calendar_removal_treats_gone_event_as_deleted(client, status):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    item = _item(sched, "Write")

    with _google() as g:
        _delete_fails(g, {"evt-1": status})
        r = client.delete(f"/api/schedules/{sched['id']}/items/{item['id']}/calendar")

    assert r.status_code == 200
    assert _deleted_event_ids(g) == ["evt-1"]
    assert _event_ids(client, sched["id"]) == {"Write": None}


@pytest.mark.parametrize("status", [404, 410])
def test_clear_all_treats_gone_event_as_deleted(client, db, status):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    sid = sched["id"]

    with _google() as g:
        _delete_fails(g, {"evt-1": status})
        r = client.delete(f"/api/schedules/{sid}", params={"delete_events": "true"})

    assert r.status_code == 200
    assert _deleted_event_ids(g) == ["evt-1"]
    assert db.query(Schedule).filter(Schedule.id == sid).count() == 0
    assert db.query(ScheduleItem).filter(ScheduleItem.schedule_id == sid).count() == 0


@pytest.mark.parametrize("status", [404, 410])
def test_remove_from_google_only_treats_gone_event_as_deleted(client, status):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    sid = sched["id"]

    with _google() as g:
        _delete_fails(g, {"evt-1": status})
        r = client.delete(f"/api/schedules/{sid}/calendar")

    assert r.status_code == 200
    assert _deleted_event_ids(g) == ["evt-1"]
    assert _event_ids(client, sid) == {"Write": None}


@pytest.mark.parametrize("status", [404, 410])
def test_clear_all_with_middle_event_gone_deletes_the_rest_and_schedule(client, db, status):
    sid = _three_exported(client)["id"]

    with _google() as g:
        _delete_fails(g, {"evt-2": status})
        r = client.delete(f"/api/schedules/{sid}", params={"delete_events": "true"})

    assert r.status_code == 200
    assert sorted(_deleted_event_ids(g)) == ["evt-1", "evt-2", "evt-3"]
    assert db.query(Schedule).filter(Schedule.id == sid).count() == 0
    assert db.query(ScheduleItem).filter(ScheduleItem.schedule_id == sid).count() == 0


@pytest.mark.parametrize("status", [404, 410])
def test_remove_from_google_only_with_middle_event_gone_clears_every_id(client, status):
    sid = _three_exported(client)["id"]

    with _google() as g:
        _delete_fails(g, {"evt-2": status})
        r = client.delete(f"/api/schedules/{sid}/calendar")

    assert r.status_code == 200
    assert sorted(_deleted_event_ids(g)) == ["evt-1", "evt-2", "evt-3"]
    assert _event_ids(client, sid) == {"Write": None, "Read": None, "Run": None}


def test_item_delete_google_500_fails_and_keeps_item(client):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    item = _item(sched, "Write")

    with _google() as g:
        _delete_fails(g, {"evt-1": 500})
        r = client.delete(f"/api/schedules/{sched['id']}/items/{item['id']}", params={"delete_event": "true"})

    assert r.status_code == 500
    assert _event_ids(client, sched["id"]) == {"Write": "evt-1"}


def test_item_calendar_removal_google_500_fails_and_keeps_id(client):
    sched = _exported_schedule(client, [
        {"custom_name": "Write", "estimated_duration": 600.0, "scheduled_time": T9},
    ], ["evt-1"])
    item = _item(sched, "Write")

    with _google() as g:
        _delete_fails(g, {"evt-1": 500})
        r = client.delete(f"/api/schedules/{sched['id']}/items/{item['id']}/calendar")

    assert r.status_code == 500
    assert _event_ids(client, sched["id"]) == {"Write": "evt-1"}


def test_clear_all_google_500_midway_fails_and_keeps_every_id(client, db):
    sid = _three_exported(client)["id"]

    with _google() as g:
        _delete_fails(g, {"evt-2": 500})
        r = client.delete(f"/api/schedules/{sid}", params={"delete_events": "true"})

    assert r.status_code == 500
    assert db.query(Schedule).filter(Schedule.id == sid).count() == 1
    assert _event_ids(client, sid) == {"Write": "evt-1", "Read": "evt-2", "Run": "evt-3"}


def test_remove_from_google_only_google_500_midway_fails_and_keeps_every_id(client):
    sid = _three_exported(client)["id"]

    with _google() as g:
        _delete_fails(g, {"evt-2": 500})
        r = client.delete(f"/api/schedules/{sid}/calendar")

    assert r.status_code == 500
    assert _event_ids(client, sid) == {"Write": "evt-1", "Read": "evt-2", "Run": "evt-3"}


def test_clear_all_retry_after_midway_failure_succeeds(client, db):
    """The first attempt deletes evt-1 on Google, then fails on evt-2, so nothing is committed
    and evt-1's id is still stored. The retry gets 404 for evt-1 and must carry on."""
    sid = _three_exported(client)["id"]
    statuses = {"evt-2": 500}

    with _google() as g:
        _delete_fails(g, statuses)
        first = client.delete(f"/api/schedules/{sid}", params={"delete_events": "true"})
        assert first.status_code == 500
        assert _event_ids(client, sid) == {"Write": "evt-1", "Read": "evt-2", "Run": "evt-3"}

        statuses.clear()
        statuses["evt-1"] = 404
        retry = client.delete(f"/api/schedules/{sid}", params={"delete_events": "true"})

    assert retry.status_code == 200
    assert db.query(Schedule).filter(Schedule.id == sid).count() == 0
    assert db.query(ScheduleItem).filter(ScheduleItem.schedule_id == sid).count() == 0


# --- Removing a stale Item's event clears the flag too (B16) ---

def _stale_exported(client, names, event_ids):
    """A pushed day whose Items were each resized afterwards, so every one is stale."""
    sched = _exported_schedule(client, [
        {"custom_name": n, "estimated_duration": 600.0, "scheduled_time": t}
        for n, t in zip(names, [T9, T10, T11])
    ], event_ids)
    for name in names:
        with _google(authenticated=False):
            r = client.put(f"/api/schedules/{sched['id']}/items/{_item(sched, name)['id']}",
                           json={"estimated_duration": 900.0})
        assert r.json()["calendar_stale"] is True
    return sched


def test_item_calendar_removal_on_stale_item_clears_id_and_flag(client):
    sched = _stale_exported(client, ["Write"], ["evt-1"])
    item = _item(sched, "Write")

    with _google() as g:
        r = client.delete(f"/api/schedules/{sched['id']}/items/{item['id']}/calendar")

    assert r.status_code == 200
    g["delete"].assert_called_once_with(calendarId="primary", eventId="evt-1")
    assert not g["update_event"].called
    assert r.json()["calendar_event_id"] is None
    assert r.json()["calendar_stale"] is False
    fetched = _item(client.get(f"/api/schedules/{sched['id']}").json(), "Write")
    assert fetched["calendar_event_id"] is None
    assert fetched["calendar_stale"] is False


def test_remove_from_google_only_on_stale_items_clears_every_id_and_flag(client):
    sched = _stale_exported(client, ["Write", "Read"], ["evt-1", "evt-2"])
    sid = sched["id"]

    with _google() as g:
        r = client.delete(f"/api/schedules/{sid}/calendar")

    assert r.status_code == 200
    assert sorted(_deleted_event_ids(g)) == ["evt-1", "evt-2"]
    assert not g["update_event"].called
    items = client.get(f"/api/schedules/{sid}").json()["items"]
    assert [(i["calendar_event_id"], i["calendar_stale"]) for i in items] == [(None, False), (None, False)]
