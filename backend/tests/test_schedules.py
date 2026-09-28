DAY = "2026-09-29"


def _day(**extra):
    return {"is_regimen": False, "target_date": DAY, **extra}


def test_schedule_item_is_frog_default(client):
    sched = client.post("/api/schedules/", json=_day(items=[{"estimated_duration": 300.0}])).json()
    item = sched["items"][0]
    assert item["is_frog"] is False


def test_schedule_item_is_frog_create(client):
    payload = _day(items=[{"estimated_duration": 600.0, "is_frog": True}])
    sched = client.post("/api/schedules/", json=payload).json()
    assert sched["items"][0]["is_frog"] is True


def test_schedule_item_is_frog_add_item(client):
    sched = client.post("/api/schedules/", json=_day()).json()
    sid = sched["id"]
    item = client.post(f"/api/schedules/{sid}/items", json={"estimated_duration": 300.0, "is_frog": True}).json()
    assert item["is_frog"] is True


def test_schedule_item_is_frog_update(client):
    sched = client.post("/api/schedules/", json=_day(items=[{"estimated_duration": 300.0}])).json()
    sid = sched["id"]
    iid = sched["items"][0]["id"]
    updated = client.put(f"/api/schedules/{sid}/items/{iid}", json={"is_frog": True}).json()
    assert updated["is_frog"] is True


def test_schedule_item_is_frog_roundtrip(client):
    sched = client.post("/api/schedules/", json=_day(items=[{"estimated_duration": 300.0, "is_frog": True}])).json()
    sid = sched["id"]
    fetched = client.get(f"/api/schedules/{sid}").json()
    assert fetched["items"][0]["is_frog"] is True


def test_day_schedule_target_date_roundtrip(client):
    resp = client.post("/api/schedules/", json=_day())
    assert resp.status_code == 200
    assert resp.json()["target_date"] == DAY

    fetched = client.get(f"/api/schedules/{resp.json()['id']}").json()
    assert fetched["target_date"] == DAY

    listed = client.get("/api/schedules/", params={"is_regimen": False}).json()
    assert [s["target_date"] for s in listed] == [DAY]


def test_day_schedule_ignores_name(client):
    resp = client.post("/api/schedules/", json=_day(name="Ignored"))
    assert resp.status_code == 200
    assert resp.json()["name"] is None


def test_day_schedule_without_date_422(client):
    resp = client.post("/api/schedules/", json={"is_regimen": False, "name": "No date"})
    assert resp.status_code == 422


def test_day_schedule_is_default_and_needs_date(client):
    resp = client.post("/api/schedules/", json={"name": "Implicit day"})
    assert resp.status_code == 422


def test_regimen_without_name_422(client):
    resp = client.post("/api/schedules/", json={"is_regimen": True})
    assert resp.status_code == 422


def test_regimen_with_date_422(client):
    resp = client.post("/api/schedules/", json={"is_regimen": True, "name": "Morning", "target_date": DAY})
    assert resp.status_code == 422


def test_regimen_keeps_name_and_has_no_date(client):
    resp = client.post("/api/schedules/", json={
        "is_regimen": True,
        "name": "Morning",
        "items": [{"estimated_duration": 300.0}],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Morning"
    assert data["target_date"] is None
