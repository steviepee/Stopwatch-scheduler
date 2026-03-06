def test_create_session(client):
    resp = client.post("/api/sessions/", json={"name": "Morning Run", "duration": 3600})
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Morning Run"
    assert data["duration"] == 3600
    assert data["is_on_calendar"] is False


def test_get_all_sessions(client):
    client.post("/api/sessions/", json={"name": "Session A", "duration": 600})
    client.post("/api/sessions/", json={"name": "Session B", "duration": 900})
    resp = client.get("/api/sessions/")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_get_session_by_id(client):
    created = client.post("/api/sessions/", json={"name": "My Session", "duration": 120}).json()
    resp = client.get(f"/api/sessions/{created['id']}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "My Session"


def test_update_session(client):
    created = client.post("/api/sessions/", json={"name": "Old", "duration": 60}).json()
    resp = client.put(f"/api/sessions/{created['id']}", json={"name": "Updated"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated"


def test_delete_session(client):
    created = client.post("/api/sessions/", json={"name": "Gone", "duration": 60}).json()
    resp = client.delete(f"/api/sessions/{created['id']}")
    assert resp.status_code == 200
    resp = client.get(f"/api/sessions/{created['id']}")
    assert resp.status_code == 404


def test_session_not_found(client):
    resp = client.get("/api/sessions/9999")
    assert resp.status_code == 404


def test_schedule_session(client):
    created = client.post("/api/sessions/", json={"name": "Scheduled", "duration": 1800}).json()
    resp = client.put(f"/api/sessions/{created['id']}/schedule", json={
        "scheduled_start": "2026-03-06T09:00:00",
        "scheduled_end": "2026-03-06T09:30:00",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["scheduled_start"] is not None


def test_unschedule_session(client):
    created = client.post("/api/sessions/", json={"name": "To Unschedule", "duration": 300}).json()
    client.put(f"/api/sessions/{created['id']}/schedule", json={
        "scheduled_start": "2026-03-06T10:00:00",
    })
    resp = client.put(f"/api/sessions/{created['id']}/unschedule")
    assert resp.status_code == 200
    assert resp.json()["scheduled_start"] is None
