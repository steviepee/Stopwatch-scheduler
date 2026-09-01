"""All API datetimes: accepted in any offset, stored as UTC, returned with Z."""


def test_session_schedule_roundtrip_utc(client):
    resp = client.post("/api/sessions/", json={"name": "tz", "duration": 60})
    sid = resp.json()["id"]

    resp = client.put(f"/api/sessions/{sid}/schedule", json={
        "scheduled_start": "2026-09-02T15:00:00Z",
        "scheduled_end": "2026-09-02T15:30:00Z",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["scheduled_start"] == "2026-09-02T15:00:00Z"
    assert data["scheduled_end"] == "2026-09-02T15:30:00Z"


def test_session_schedule_offset_normalized_to_utc(client):
    resp = client.post("/api/sessions/", json={"name": "tz2", "duration": 60})
    sid = resp.json()["id"]

    # 10:00 CDT == 15:00 UTC — must come back as the same instant in Z form
    resp = client.put(f"/api/sessions/{sid}/schedule", json={
        "scheduled_start": "2026-09-02T10:00:00-05:00",
    })
    assert resp.status_code == 200
    assert resp.json()["scheduled_start"] == "2026-09-02T15:00:00Z"


def test_created_at_serialized_with_z(client):
    resp = client.post("/api/tasks/", json={"name": "tz-task"})
    assert resp.json()["created_at"].endswith("Z")
