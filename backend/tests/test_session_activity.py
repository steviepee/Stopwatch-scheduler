"""
Tests for B35.tests: Recordings create, join, and leave Activities.

Contract (D76, D77, D78): StopwatchSessionCreate/Update gain optional
new_activity_name. Resolving a name trims it and matches an existing Activity
case-insensitively; if none matches, a new Activity (Q4) is created. Create
and update both keep the Activity's average_duration / total_recordings in
sync with the Recording's Time Log, including detaching (task_id: null),
which must not 500.

These fail before B35.impl because:
  - new_activity_name is not a field on either schema → 422 "extra forbidden"
    or the field is silently ignored rather than creating/matching an Activity
  - a no-Activity Recording attached via PUT task_id gets no Time Log
  - PUT task_id: null on an attached Recording 500s (NOT NULL violation)
"""
import pytest


def _task(client, name="T"):
    r = client.post("/api/tasks/", json={"name": name})
    assert r.status_code == 200
    return r.json()


def test_create_with_new_activity_name_creates_activity(client):
    r = client.post("/api/sessions/", json={
        "name": "Run log",
        "duration": 1800.0,
        "new_activity_name": " Run ",
    })
    assert r.status_code == 200
    session = r.json()

    tasks = client.get("/api/tasks/").json()
    assert len(tasks) == 1
    activity = tasks[0]
    assert activity["name"] == "Run"
    assert activity["total_recordings"] == 1
    assert activity["average_duration"] == pytest.approx(1800.0)
    assert session["task_id"] == activity["id"]


def test_create_with_new_activity_name_matches_existing_case_insensitive(client):
    task = _task(client, "Run")
    r = client.post("/api/sessions/", json={
        "name": "Rec",
        "duration": 600.0,
        "new_activity_name": "run",
    })
    assert r.status_code == 200
    session = r.json()
    assert session["task_id"] == task["id"]

    tasks = client.get("/api/tasks/").json()
    assert len(tasks) == 1
    assert tasks[0]["total_recordings"] == 1
    assert tasks[0]["average_duration"] == pytest.approx(600.0)


def test_create_with_both_task_id_and_new_activity_name_422(client):
    task = _task(client)
    r = client.post("/api/sessions/", json={
        "name": "Rec",
        "duration": 600.0,
        "task_id": task["id"],
        "new_activity_name": "Other",
    })
    assert r.status_code == 422


def test_create_with_blank_new_activity_name_422(client):
    r = client.post("/api/sessions/", json={
        "name": "Rec",
        "duration": 600.0,
        "new_activity_name": "   ",
    })
    assert r.status_code == 422


def test_update_with_both_task_id_and_new_activity_name_422(client):
    task = _task(client)
    session = client.post("/api/sessions/", json={"name": "Rec", "duration": 60.0}).json()
    r = client.put(f"/api/sessions/{session['id']}", json={
        "task_id": task["id"],
        "new_activity_name": "Other",
    })
    assert r.status_code == 422


def test_update_with_blank_new_activity_name_422(client):
    session = client.post("/api/sessions/", json={"name": "Rec", "duration": 60.0}).json()
    r = client.put(f"/api/sessions/{session['id']}", json={"new_activity_name": "  "})
    assert r.status_code == 422


def test_attach_no_activity_recording_via_task_id_creates_log(client):
    task = _task(client)
    session = client.post("/api/sessions/", json={"name": "Rec", "duration": 900.0}).json()
    sid = session["id"]

    r = client.put(f"/api/sessions/{sid}", json={"task_id": task["id"]})
    assert r.status_code == 200
    assert r.json()["task_id"] == task["id"]

    logs = client.get(f"/api/time-logs/?task_id={task['id']}").json()
    assert len(logs) == 1
    assert logs[0]["duration"] == pytest.approx(900.0)
    assert logs[0]["session_id"] == sid

    updated_task = client.get(f"/api/tasks/{task['id']}").json()
    assert updated_task["total_recordings"] == 1
    assert updated_task["average_duration"] == pytest.approx(900.0)


def test_attach_no_activity_recording_via_new_activity_name(client):
    session = client.post("/api/sessions/", json={"name": "Rec", "duration": 450.0}).json()
    sid = session["id"]

    r = client.put(f"/api/sessions/{sid}", json={"new_activity_name": "Laundry"})
    assert r.status_code == 200
    data = r.json()
    assert data["task_id"] is not None

    activity = client.get(f"/api/tasks/{data['task_id']}").json()
    assert activity["name"] == "Laundry"
    assert activity["total_recordings"] == 1
    assert activity["average_duration"] == pytest.approx(450.0)

    logs = client.get(f"/api/time-logs/?task_id={activity['id']}").json()
    assert len(logs) == 1
    assert logs[0]["session_id"] == sid


def test_detach_removes_log_and_updates_average_no_500(client):
    task = _task(client)
    session = client.post("/api/sessions/", json={
        "name": "Rec", "duration": 300.0, "task_id": task["id"],
    }).json()
    sid = session["id"]

    r = client.put(f"/api/sessions/{sid}", json={"task_id": None})
    assert r.status_code == 200
    assert r.json()["task_id"] is None

    logs = client.get(f"/api/time-logs/?task_id={task['id']}").json()
    assert len(logs) == 0

    updated_task = client.get(f"/api/tasks/{task['id']}").json()
    assert updated_task["total_recordings"] == 0
    assert updated_task["average_duration"] == pytest.approx(0.0)


def test_move_between_activities_still_updates_both(client):
    ta = _task(client, "Task A")
    tb = _task(client, "Task B")

    session = client.post("/api/sessions/", json={
        "name": "Rec", "duration": 1800.0, "task_id": ta["id"],
    }).json()
    sid = session["id"]

    client.put(f"/api/sessions/{sid}", json={"task_id": tb["id"]})

    a = client.get(f"/api/tasks/{ta['id']}").json()
    b = client.get(f"/api/tasks/{tb['id']}").json()
    assert a["total_recordings"] == 0
    assert a["average_duration"] == pytest.approx(0.0)
    assert b["total_recordings"] == 1
    assert b["average_duration"] == pytest.approx(1800.0)

    logs_b = client.get(f"/api/time-logs/?task_id={tb['id']}").json()
    assert len(logs_b) == 1
    assert logs_b[0]["session_id"] == sid
