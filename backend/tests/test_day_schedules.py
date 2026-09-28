DAY = "2026-09-29"
T9 = "2026-09-29T14:00:00Z"
T10 = "2026-09-29T15:00:00Z"


def _task(client, name, duration=None):
    task = client.post("/api/tasks/", json={"name": name}).json()
    if duration is not None:
        client.post("/api/time-logs/", json={"task_id": task["id"], "duration": duration})
    return task


def _place(client, date, **body):
    return client.post(f"/api/schedules/days/{date}/items", json=body)


def _day_schedules(client, date):
    return client.get("/api/schedules/", params={"start_date": date, "end_date": date}).json()


def test_range_filter_returns_day_schedules_in_range_in_date_order(client):
    for d in ["2026-10-02", "2026-09-30", "2026-09-28", "2026-10-01"]:
        assert client.post("/api/schedules/", json={"is_regimen": False, "target_date": d}).status_code == 200
    client.post("/api/schedules/", json={"is_regimen": True, "name": "Morning"})

    resp = client.get("/api/schedules/", params={"start_date": "2026-09-29", "end_date": "2026-10-01"})
    assert resp.status_code == 200
    body = resp.json()
    assert [s["target_date"] for s in body] == ["2026-09-30", "2026-10-01"]
    assert all(s["is_regimen"] is False for s in body)
    assert all("items" in s for s in body)


def test_range_filter_is_inclusive(client):
    for d in ["2026-09-28", "2026-09-29", "2026-09-30"]:
        client.post("/api/schedules/", json={"is_regimen": False, "target_date": d})
    body = client.get("/api/schedules/", params={"start_date": "2026-09-28", "end_date": "2026-09-30"}).json()
    assert [s["target_date"] for s in body] == ["2026-09-28", "2026-09-29", "2026-09-30"]


def test_is_regimen_filter_still_works(client):
    client.post("/api/schedules/", json={"is_regimen": False, "target_date": DAY})
    client.post("/api/schedules/", json={"is_regimen": True, "name": "Morning"})
    regimens = client.get("/api/schedules/", params={"is_regimen": True}).json()
    assert [s["name"] for s in regimens] == ["Morning"]
    days = client.get("/api/schedules/", params={"is_regimen": False}).json()
    assert [s["target_date"] for s in days] == [DAY]


def test_place_on_empty_date_creates_one_schedule_and_reuses_it(client):
    task = _task(client, "Read", 1200.0)
    assert _day_schedules(client, DAY) == []

    first = _place(client, DAY, task_id=task["id"], scheduled_time=T9)
    assert first.status_code == 200
    item = first.json()
    assert item["task_id"] == task["id"]
    assert item["scheduled_time"] == T9

    schedules = _day_schedules(client, DAY)
    assert len(schedules) == 1
    assert item["schedule_id"] == schedules[0]["id"]
    assert schedules[0]["target_date"] == DAY
    assert schedules[0]["is_regimen"] is False
    assert schedules[0]["name"] is None

    second = _place(client, DAY, task_id=task["id"], scheduled_time=T10).json()
    assert second["schedule_id"] == item["schedule_id"]
    assert len(_day_schedules(client, DAY)) == 1


def test_place_reuses_schedule_created_by_post(client):
    existing = client.post("/api/schedules/", json={"is_regimen": False, "target_date": DAY}).json()
    task = _task(client, "Read", 1200.0)
    item = _place(client, DAY, task_id=task["id"], scheduled_time=T9).json()
    assert item["schedule_id"] == existing["id"]
    assert len(_day_schedules(client, DAY)) == 1


def test_place_on_different_dates_uses_different_schedules(client):
    task = _task(client, "Read", 1200.0)
    a = _place(client, "2026-09-29", task_id=task["id"], scheduled_time=T9).json()
    b = _place(client, "2026-09-30", task_id=task["id"], scheduled_time="2026-09-30T14:00:00Z").json()
    assert a["schedule_id"] != b["schedule_id"]


def test_seed_uses_activity_average(client):
    task = _task(client, "Read", 1200.0)
    item = _place(client, DAY, task_id=task["id"], scheduled_time=T9).json()
    assert item["estimated_duration"] == 1200.0


def test_seed_600_when_activity_has_no_history(client):
    task = _task(client, "Fresh")
    assert task["average_duration"] == 0
    item = _place(client, DAY, task_id=task["id"], scheduled_time=T9).json()
    assert item["estimated_duration"] == 600.0


def test_explicit_duration_wins_over_seed(client):
    task = _task(client, "Read", 1200.0)
    item = _place(client, DAY, task_id=task["id"], scheduled_time=T9, estimated_duration=450.0).json()
    assert item["estimated_duration"] == 450.0

    fresh = _task(client, "Fresh")
    item = _place(client, DAY, task_id=fresh["id"], scheduled_time=T10, estimated_duration=900.0).json()
    assert item["estimated_duration"] == 900.0


def test_seed_is_a_snapshot(client):
    task = _task(client, "Read", 1200.0)
    item = _place(client, DAY, task_id=task["id"], scheduled_time=T9).json()
    client.post("/api/time-logs/", json={"task_id": task["id"], "duration": 2400.0})
    fetched = client.get(f"/api/schedules/{item['schedule_id']}").json()
    assert fetched["items"][0]["estimated_duration"] == 1200.0


def test_same_activity_placed_twice_yields_two_items(client):
    task = _task(client, "Read", 1200.0)
    a = _place(client, DAY, task_id=task["id"], scheduled_time=T9).json()
    b = _place(client, DAY, task_id=task["id"], scheduled_time=T9).json()
    assert a["id"] != b["id"]

    schedules = _day_schedules(client, DAY)
    assert len(schedules) == 1
    assert [i["task_id"] for i in schedules[0]["items"]] == [task["id"], task["id"]]


def test_post_on_occupied_date_appends(client):
    task = _task(client, "Read", 1200.0)
    placed = _place(client, DAY, task_id=task["id"], scheduled_time=T9).json()

    resp = client.post("/api/schedules/", json={
        "is_regimen": False,
        "target_date": DAY,
        "items": [
            {"custom_name": "Walk", "estimated_duration": 900.0, "scheduled_time": T10},
            {"custom_name": "Stretch", "estimated_duration": 300.0},
        ],
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == placed["schedule_id"]

    schedules = _day_schedules(client, DAY)
    assert len(schedules) == 1
    items = schedules[0]["items"]
    assert len(items) == 3
    assert {i["id"] for i in items} >= {placed["id"]}
    assert {i["custom_name"] for i in items} >= {"Walk", "Stretch"}


def test_post_twice_for_same_date_keeps_one_schedule(client):
    a = client.post("/api/schedules/", json={
        "is_regimen": False, "target_date": DAY,
        "items": [{"custom_name": "A", "estimated_duration": 300.0}],
    }).json()
    b = client.post("/api/schedules/", json={
        "is_regimen": False, "target_date": DAY,
        "items": [{"custom_name": "B", "estimated_duration": 300.0}],
    }).json()
    assert a["id"] == b["id"]
    assert sorted(i["custom_name"] for i in b["items"]) == ["A", "B"]
    assert len(_day_schedules(client, DAY)) == 1
    assert len(client.get("/api/schedules/", params={"is_regimen": False}).json()) == 1


def test_regimens_are_not_merged(client):
    a = client.post("/api/schedules/", json={"is_regimen": True, "name": "Morning"}).json()
    b = client.post("/api/schedules/", json={"is_regimen": True, "name": "Morning"}).json()
    assert a["id"] != b["id"]


def _frogs(client, schedule_id):
    items = client.get(f"/api/schedules/{schedule_id}").json()["items"]
    return [i["id"] for i in items if i["is_frog"]]


def test_second_frog_via_create_clears_first(client):
    first = client.post("/api/schedules/", json={
        "is_regimen": False, "target_date": DAY,
        "items": [{"custom_name": "A", "estimated_duration": 300.0, "is_frog": True}],
    }).json()
    sid = first["id"]
    a_id = first["items"][0]["id"]

    second = client.post("/api/schedules/", json={
        "is_regimen": False, "target_date": DAY,
        "items": [{"custom_name": "B", "estimated_duration": 300.0, "is_frog": True}],
    }).json()
    assert second["id"] == sid
    b_id = next(i["id"] for i in second["items"] if i["custom_name"] == "B")
    assert _frogs(client, sid) == [b_id]
    assert a_id not in _frogs(client, sid)


def test_create_with_two_frogs_keeps_one(client):
    body = client.post("/api/schedules/", json={
        "is_regimen": False, "target_date": DAY,
        "items": [
            {"custom_name": "A", "estimated_duration": 300.0, "is_frog": True},
            {"custom_name": "B", "estimated_duration": 300.0, "is_frog": True},
        ],
    }).json()
    assert len(_frogs(client, body["id"])) == 1


def test_second_frog_via_place_clears_first(client):
    task = _task(client, "Read", 1200.0)
    a = _place(client, DAY, task_id=task["id"], scheduled_time=T9, is_frog=True).json()
    assert a["is_frog"] is True
    b = _place(client, DAY, task_id=task["id"], scheduled_time=T10, is_frog=True).json()
    assert b["is_frog"] is True
    assert _frogs(client, a["schedule_id"]) == [b["id"]]


def test_second_frog_via_update_clears_first(client):
    sched = client.post("/api/schedules/", json={
        "is_regimen": False, "target_date": DAY,
        "items": [
            {"custom_name": "A", "estimated_duration": 300.0, "is_frog": True},
            {"custom_name": "B", "estimated_duration": 300.0},
        ],
    }).json()
    sid = sched["id"]
    b_id = next(i["id"] for i in sched["items"] if i["custom_name"] == "B")

    resp = client.put(f"/api/schedules/{sid}/items/{b_id}", json={"is_frog": True})
    assert resp.status_code == 200
    assert resp.json()["is_frog"] is True
    assert _frogs(client, sid) == [b_id]


def test_second_frog_via_add_item_clears_first(client):
    sched = client.post("/api/schedules/", json={
        "is_regimen": False, "target_date": DAY,
        "items": [{"custom_name": "A", "estimated_duration": 300.0, "is_frog": True}],
    }).json()
    sid = sched["id"]
    b = client.post(f"/api/schedules/{sid}/items", json={"custom_name": "B", "estimated_duration": 300.0, "is_frog": True}).json()
    assert _frogs(client, sid) == [b["id"]]


def test_frog_does_not_leak_across_schedules(client):
    task = _task(client, "Read", 1200.0)
    a = _place(client, "2026-09-29", task_id=task["id"], scheduled_time=T9, is_frog=True).json()
    b = _place(client, "2026-09-30", task_id=task["id"], scheduled_time="2026-09-30T14:00:00Z", is_frog=True).json()
    assert _frogs(client, a["schedule_id"]) == [a["id"]]
    assert _frogs(client, b["schedule_id"]) == [b["id"]]


def test_unsetting_frog_leaves_others_alone(client):
    sched = client.post("/api/schedules/", json={
        "is_regimen": False, "target_date": DAY,
        "items": [
            {"custom_name": "A", "estimated_duration": 300.0, "is_frog": True},
            {"custom_name": "B", "estimated_duration": 300.0},
        ],
    }).json()
    sid = sched["id"]
    a_id = next(i["id"] for i in sched["items"] if i["custom_name"] == "A")
    b_id = next(i["id"] for i in sched["items"] if i["custom_name"] == "B")
    client.put(f"/api/schedules/{sid}/items/{b_id}", json={"is_frog": False})
    assert _frogs(client, sid) == [a_id]
