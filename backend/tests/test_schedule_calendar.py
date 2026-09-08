from unittest.mock import patch, MagicMock

from app.routers.schedules import calendar_service


def _make_schedule(client, items):
    payload = {"name": "Push me", "items": items}
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
