def test_create_session(client):
    resp = client.post("/api/sessions/", json={"name": "Morning Run", "duration": 3600})
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Morning Run"
    assert data["duration"] == 3600


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


REMOVED_FIELDS = ("scheduled_start", "scheduled_end", "calendar_event_id", "is_on_calendar")


def test_session_response_has_no_scheduling_fields(client):
    created = client.post("/api/sessions/", json={"name": "History", "duration": 60}).json()
    fetched = client.get(f"/api/sessions/{created['id']}").json()
    listed = client.get("/api/sessions/").json()[0]
    updated = client.put(f"/api/sessions/{created['id']}", json={"name": "Renamed"}).json()
    for data in (created, fetched, listed, updated):
        for field in REMOVED_FIELDS:
            assert field not in data


def test_session_create_ignores_scheduling_fields(client):
    resp = client.post("/api/sessions/", json={
        "name": "Sneaky",
        "duration": 60,
        "scheduled_start": "2026-09-29T09:00:00Z",
        "scheduled_end": "2026-09-29T09:01:00Z",
    })
    assert resp.status_code == 200
    for field in REMOVED_FIELDS:
        assert field not in resp.json()


def test_removed_recording_routes_gone(client):
    sid = client.post("/api/sessions/", json={"name": "Gone routes", "duration": 60}).json()["id"]
    responses = [
        client.put(f"/api/sessions/{sid}/schedule", json={"scheduled_start": "2026-09-29T09:00:00Z"}),
        client.put(f"/api/sessions/{sid}/unschedule"),
        client.post(f"/api/sessions/{sid}/calendar"),
        client.delete(f"/api/sessions/{sid}/calendar"),
    ]
    for resp in responses:
        assert resp.status_code in (404, 405)


def test_scheduled_filter_ignored(client):
    client.post("/api/sessions/", json={"name": "A", "duration": 60})
    client.post("/api/sessions/", json={"name": "B", "duration": 60})
    for value in ("true", "false"):
        resp = client.get("/api/sessions/", params={"scheduled": value})
        assert resp.status_code == 200
        assert len(resp.json()) == 2
