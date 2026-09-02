def test_create_task(client):
    resp = client.post("/api/tasks/", json={"name": "Test Task"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Test Task"
    assert data["average_duration"] == 0
    assert "id" in data


def test_get_all_tasks(client):
    client.post("/api/tasks/", json={"name": "Task A"})
    client.post("/api/tasks/", json={"name": "Task B"})
    resp = client.get("/api/tasks/")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_get_task_by_id(client):
    created = client.post("/api/tasks/", json={"name": "My Task"}).json()
    resp = client.get(f"/api/tasks/{created['id']}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "My Task"
    assert "time_logs" in data


def test_update_task(client):
    created = client.post("/api/tasks/", json={"name": "Old Name"}).json()
    resp = client.put(f"/api/tasks/{created['id']}", json={"name": "New Name"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"


def test_delete_task(client):
    created = client.post("/api/tasks/", json={"name": "To Delete"}).json()
    resp = client.delete(f"/api/tasks/{created['id']}")
    assert resp.status_code == 200
    resp = client.get(f"/api/tasks/{created['id']}")
    assert resp.status_code == 404


def test_task_not_found(client):
    resp = client.get("/api/tasks/9999")
    assert resp.status_code == 404


def test_duplicate_task_name(client):
    client.post("/api/tasks/", json={"name": "Unique"})
    resp = client.post("/api/tasks/", json={"name": "Unique"})
    assert resp.status_code == 400


def test_create_task_with_flags(client):
    resp = client.post("/api/tasks/", json={"name": "Urgent Task", "is_urgent": True, "is_important": True})
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_urgent"] is True
    assert data["is_important"] is True


def test_create_task_default_flags(client):
    resp = client.post("/api/tasks/", json={"name": "Plain Task"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_urgent"] is False
    assert data["is_important"] is False


def test_update_task_flags(client):
    created = client.post("/api/tasks/", json={"name": "Flag Task"}).json()
    resp = client.put(f"/api/tasks/{created['id']}", json={"is_urgent": True, "is_important": False})
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_urgent"] is True
    assert data["is_important"] is False
