"""All API datetimes: accepted in any offset, stored as UTC, returned with Z."""


def test_session_times_roundtrip_utc(client):
    resp = client.post("/api/sessions/", json={
        "name": "tz",
        "duration": 1800,
        "start_time": "2026-09-02T15:00:00Z",
        "end_time": "2026-09-02T15:30:00Z",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["start_time"] == "2026-09-02T15:00:00Z"
    assert data["end_time"] == "2026-09-02T15:30:00Z"


def test_session_time_offset_normalized_to_utc(client):
    # 10:00 CDT == 15:00 UTC — must come back as the same instant in Z form
    resp = client.post("/api/sessions/", json={
        "name": "tz2",
        "duration": 60,
        "start_time": "2026-09-02T10:00:00-05:00",
    })
    assert resp.status_code == 200
    assert resp.json()["start_time"] == "2026-09-02T15:00:00Z"


def test_created_at_serialized_with_z(client):
    resp = client.post("/api/tasks/", json={"name": "tz-task"})
    assert resp.json()["created_at"].endswith("Z")
