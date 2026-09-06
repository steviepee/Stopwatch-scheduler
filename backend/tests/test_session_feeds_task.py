"""
Tests for 8.tests: Attached Recordings feed the Activity.

Contract: POST /api/sessions/ with task_id creates a linked TimeLog with the same
duration, updates the task's average_duration / total_recordings exactly as
POST /api/time-logs/ does.  DELETE and PUT (retarget) keep the stats consistent.
GET /api/insights/peak-hours skips TimeLog rows that have a session_id so a
session-linked recording is counted only once.

These tests fail before 8.impl because:
  - no session_id column on time_logs  → session_id key missing / no log created
  - average_duration unchanged after POST /api/sessions/ with task_id
"""
import pytest


def _task(client, name="T"):
    r = client.post("/api/tasks/", json={"name": name})
    assert r.status_code == 200
    return r.json()


def test_create_with_task_updates_average_and_count(client):
    task = _task(client)
    r = client.post("/api/sessions/", json={"name": "Rec", "duration": 1800.0, "task_id": task["id"]})
    assert r.status_code == 200

    updated = client.get(f"/api/tasks/{task['id']}").json()
    assert updated["total_recordings"] == 1
    assert updated["average_duration"] == pytest.approx(1800.0)


def test_create_with_task_creates_linked_log(client):
    task = _task(client)
    session = client.post("/api/sessions/", json={"name": "Rec", "duration": 900.0, "task_id": task["id"]}).json()
    sid = session["id"]

    logs = client.get(f"/api/time-logs/?task_id={task['id']}").json()
    assert len(logs) == 1
    log = logs[0]
    assert log["duration"] == pytest.approx(900.0)
    assert log["session_id"] == sid


def test_create_without_task_creates_no_log(client):
    r = client.post("/api/sessions/", json={"name": "Standalone", "duration": 600.0})
    assert r.status_code == 200

    logs = client.get("/api/time-logs/").json()
    assert len(logs) == 0


def test_delete_recalculates(client):
    task = _task(client)
    client.post("/api/sessions/", json={"name": "R1", "duration": 600.0, "task_id": task["id"]})
    s2 = client.post("/api/sessions/", json={"name": "R2", "duration": 1200.0, "task_id": task["id"]}).json()

    data = client.get(f"/api/tasks/{task['id']}").json()
    assert data["total_recordings"] == 2
    assert data["average_duration"] == pytest.approx(900.0)

    client.delete(f"/api/sessions/{s2['id']}")

    data = client.get(f"/api/tasks/{task['id']}").json()
    assert data["total_recordings"] == 1
    assert data["average_duration"] == pytest.approx(600.0)

    logs = client.get(f"/api/time-logs/?task_id={task['id']}").json()
    assert len(logs) == 1


def test_retarget_moves_log(client):
    ta = _task(client, "Task A")
    tb = _task(client, "Task B")

    session = client.post("/api/sessions/", json={"name": "Rec", "duration": 1800.0, "task_id": ta["id"]}).json()
    sid = session["id"]

    assert len(client.get(f"/api/time-logs/?task_id={ta['id']}").json()) == 1

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


def test_peak_hours_no_double_count(client):
    """
    A TimeLog with a session_id must be skipped by peak-hours so the session
    duration is counted once (via the session row), not twice.
    """
    task = _task(client)
    client.post("/api/sessions/", json={
        "name": "Morning",
        "duration": 3600.0,
        "task_id": task["id"],
        "start_time": "2026-09-06T08:00:00",
    })

    ph = client.get("/api/insights/peak-hours").json()
    assert ph["total_seconds"] == pytest.approx(3600.0)


def test_standalone_time_log_unchanged(client):
    """Standalone POST /api/time-logs/ keeps working and still updates the task."""
    task = _task(client)
    r = client.post("/api/time-logs/", json={"task_id": task["id"], "duration": 500.0})
    assert r.status_code == 200

    data = client.get(f"/api/tasks/{task['id']}").json()
    assert data["total_recordings"] == 1
    assert data["average_duration"] == pytest.approx(500.0)
