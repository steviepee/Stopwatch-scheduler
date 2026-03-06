def test_create_time_log(client):
    task = client.post("/api/tasks/", json={"name": "Work"}).json()
    resp = client.post("/api/time-logs/", json={"task_id": task["id"], "duration": 1800, "notes": "Focus session"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["duration"] == 1800
    assert data["notes"] == "Focus session"
    assert data["task_id"] == task["id"]


def test_create_time_log_updates_task_average(client):
    task = client.post("/api/tasks/", json={"name": "Exercise"}).json()
    client.post("/api/time-logs/", json={"task_id": task["id"], "duration": 600})
    client.post("/api/time-logs/", json={"task_id": task["id"], "duration": 1200})
    updated_task = client.get(f"/api/tasks/{task['id']}").json()
    assert updated_task["average_duration"] == 900
    assert updated_task["total_recordings"] == 2


def test_get_all_time_logs(client):
    task = client.post("/api/tasks/", json={"name": "Read"}).json()
    client.post("/api/time-logs/", json={"task_id": task["id"], "duration": 300})
    client.post("/api/time-logs/", json={"task_id": task["id"], "duration": 600})
    resp = client.get("/api/time-logs/")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_get_time_logs_by_task(client):
    task1 = client.post("/api/tasks/", json={"name": "Task1"}).json()
    task2 = client.post("/api/tasks/", json={"name": "Task2"}).json()
    client.post("/api/time-logs/", json={"task_id": task1["id"], "duration": 100})
    client.post("/api/time-logs/", json={"task_id": task2["id"], "duration": 200})
    resp = client.get(f"/api/time-logs/?task_id={task1['id']}")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["task_id"] == task1["id"]


def test_delete_time_log(client):
    task = client.post("/api/tasks/", json={"name": "Delete Test"}).json()
    log = client.post("/api/time-logs/", json={"task_id": task["id"], "duration": 500}).json()
    resp = client.delete(f"/api/time-logs/{log['id']}")
    assert resp.status_code == 200
    resp = client.get("/api/time-logs/")
    assert all(l["id"] != log["id"] for l in resp.json())


def test_delete_task_cascades_time_logs(client):
    task = client.post("/api/tasks/", json={"name": "Cascade"}).json()
    client.post("/api/time-logs/", json={"task_id": task["id"], "duration": 300})
    client.delete(f"/api/tasks/{task['id']}")
    resp = client.get("/api/time-logs/")
    assert len(resp.json()) == 0
