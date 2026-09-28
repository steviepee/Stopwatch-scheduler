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


CDT = 300  # tz_offset for UTC-5: UTC = local + tz_offset minutes
JST = -540  # UTC+9


def _regimen(client, items):
    resp = client.post("/api/schedules/", json={"is_regimen": True, "name": "Morning", "items": items})
    assert resp.status_code == 200
    return resp.json()


def _apply(client, regimen_id, target_date, tz_offset):
    return client.post(
        f"/api/schedules/{regimen_id}/apply",
        json={"target_date": target_date, "tz_offset": tz_offset},
    )


def test_apply_keeps_local_time_of_day(client):
    # 07:30 CDT on 2026-09-28 is 12:30Z
    regimen = _regimen(client, [{"estimated_duration": 600.0, "scheduled_time": "2026-09-28T12:30:00Z"}])

    resp = _apply(client, regimen["id"], "2026-10-02", CDT)
    assert resp.status_code == 200
    day = resp.json()
    assert day["is_regimen"] is False
    assert day["target_date"] == "2026-10-02"
    assert [i["scheduled_time"] for i in day["items"]] == ["2026-10-02T12:30:00Z"]
    assert day["items"][0]["estimated_duration"] == 600.0


def test_apply_local_time_on_next_utc_day(client):
    # 20:00 CDT on 2026-09-27 is 01:00Z on 2026-09-28
    regimen = _regimen(client, [{"estimated_duration": 300.0, "scheduled_time": "2026-09-28T01:00:00Z"}])

    day = _apply(client, regimen["id"], "2026-10-02", CDT).json()
    assert day["target_date"] == "2026-10-02"
    assert [i["scheduled_time"] for i in day["items"]] == ["2026-10-03T01:00:00Z"]


def test_apply_local_time_on_previous_utc_day(client):
    # 07:30 JST on 2026-09-28 is 22:30Z on 2026-09-27
    regimen = _regimen(client, [{"estimated_duration": 300.0, "scheduled_time": "2026-09-27T22:30:00Z"}])

    day = _apply(client, regimen["id"], "2026-10-02", JST).json()
    assert day["target_date"] == "2026-10-02"
    assert [i["scheduled_time"] for i in day["items"]] == ["2026-10-01T22:30:00Z"]


def test_apply_appends_to_existing_day_schedule(client):
    existing = client.post("/api/schedules/", json={
        "is_regimen": False,
        "target_date": "2026-10-02",
        "items": [{"estimated_duration": 900.0, "scheduled_time": "2026-10-02T20:00:00Z"}],
    }).json()
    regimen = _regimen(client, [{"estimated_duration": 600.0, "scheduled_time": "2026-09-28T12:30:00Z"}])

    day = _apply(client, regimen["id"], "2026-10-02", CDT).json()
    assert day["id"] == existing["id"]
    assert sorted(i["scheduled_time"] for i in day["items"]) == [
        "2026-10-02T12:30:00Z",
        "2026-10-02T20:00:00Z",
    ]

    days = client.get("/api/schedules/", params={"start_date": "2026-10-02", "end_date": "2026-10-02"}).json()
    assert len(days) == 1


def test_apply_twice_gives_two_copies(client):
    regimen = _regimen(client, [
        {"estimated_duration": 600.0, "scheduled_time": "2026-09-28T12:30:00Z"},
        {"estimated_duration": 300.0, "scheduled_time": "2026-09-28T13:00:00Z"},
    ])

    first = _apply(client, regimen["id"], "2026-10-02", CDT).json()
    second = _apply(client, regimen["id"], "2026-10-02", CDT).json()
    assert second["id"] == first["id"]
    assert sorted(i["scheduled_time"] for i in second["items"]) == [
        "2026-10-02T12:30:00Z",
        "2026-10-02T12:30:00Z",
        "2026-10-02T13:00:00Z",
        "2026-10-02T13:00:00Z",
    ]


def test_apply_skips_timeless_items_and_leaves_regimen_unchanged(client):
    regimen = _regimen(client, [
        {"custom_name": "Timed", "estimated_duration": 600.0, "scheduled_time": "2026-09-28T12:30:00Z"},
        {"custom_name": "Untimed", "estimated_duration": 300.0},
    ])

    day = _apply(client, regimen["id"], "2026-10-02", CDT).json()
    assert [i["custom_name"] for i in day["items"]] == ["Timed"]

    after = client.get(f"/api/schedules/{regimen['id']}").json()
    assert after["is_regimen"] is True
    assert after["name"] == "Morning"
    assert after["target_date"] is None
    assert [(i["id"], i["custom_name"], i["scheduled_time"]) for i in after["items"]] == [
        (i["id"], i["custom_name"], i["scheduled_time"]) for i in regimen["items"]
    ]


def test_apply_copies_frog(client):
    regimen = _regimen(client, [
        {"estimated_duration": 600.0, "scheduled_time": "2026-09-28T12:30:00Z", "is_frog": True},
    ])

    day = _apply(client, regimen["id"], "2026-10-02", CDT).json()
    assert [i["is_frog"] for i in day["items"]] == [True]


def test_apply_frog_onto_day_with_frog_keeps_one(client):
    client.post("/api/schedules/", json={
        "is_regimen": False,
        "target_date": "2026-10-02",
        "items": [{"estimated_duration": 900.0, "scheduled_time": "2026-10-02T20:00:00Z", "is_frog": True}],
    })
    regimen = _regimen(client, [
        {"estimated_duration": 600.0, "scheduled_time": "2026-09-28T12:30:00Z", "is_frog": True},
    ])

    day = _apply(client, regimen["id"], "2026-10-02", CDT).json()
    assert sum(i["is_frog"] for i in day["items"]) == 1


def test_apply_unknown_regimen_404(client):
    assert _apply(client, 999, "2026-10-02", CDT).status_code == 404
