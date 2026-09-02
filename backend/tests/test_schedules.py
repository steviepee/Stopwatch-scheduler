
def test_schedule_item_is_frog_default(client):
    sched = client.post("/api/schedules/", json={"name": "S1", "items": [{"estimated_duration": 300.0}]}).json()
    item = sched["items"][0]
    assert item["is_frog"] is False


def test_schedule_item_is_frog_create(client):
    payload = {"name": "S2", "items": [{"estimated_duration": 600.0, "is_frog": True}]}
    sched = client.post("/api/schedules/", json=payload).json()
    assert sched["items"][0]["is_frog"] is True


def test_schedule_item_is_frog_add_item(client):
    sched = client.post("/api/schedules/", json={"name": "S3"}).json()
    sid = sched["id"]
    item = client.post(f"/api/schedules/{sid}/items", json={"estimated_duration": 300.0, "is_frog": True}).json()
    assert item["is_frog"] is True


def test_schedule_item_is_frog_update(client):
    sched = client.post("/api/schedules/", json={"name": "S4", "items": [{"estimated_duration": 300.0}]}).json()
    sid = sched["id"]
    iid = sched["items"][0]["id"]
    updated = client.put(f"/api/schedules/{sid}/items/{iid}", json={"is_frog": True}).json()
    assert updated["is_frog"] is True


def test_schedule_item_is_frog_roundtrip(client):
    sched = client.post("/api/schedules/", json={"name": "S5", "items": [{"estimated_duration": 300.0, "is_frog": True}]}).json()
    sid = sched["id"]
    fetched = client.get(f"/api/schedules/{sid}").json()
    assert fetched["items"][0]["is_frog"] is True
