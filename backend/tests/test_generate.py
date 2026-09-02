import json
import os
from datetime import datetime, timezone


FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "fixtures", "generate_parity.json")

PARITY_INPUT = {
    "start_time": "2026-09-02T08:00:00Z",
    "day_start": "2026-09-02T06:00:00Z",
    "day_end": "2026-09-02T23:00:00Z",
    "activities": [
        {"task_id": 1, "name": "Write report", "estimated_duration": 5400},
        {"name": "Email sweep", "estimated_duration": 1800},
        {"task_id": 2, "name": "Gym", "estimated_duration": 3600},
        {"name": "Read chapter", "estimated_duration": 1800},
        {"name": "Plan tomorrow", "estimated_duration": 900},
    ],
    "existing_events": [
        {"name": "Standup", "start": "2026-09-02T09:00:00Z", "end": "2026-09-02T09:30:00Z"},
        {"name": "Lunch", "start": "2026-09-02T12:00:00Z", "end": "2026-09-02T13:00:00Z"},
    ],
}


def _parse_dt(s):
    """Parse a UTC datetime string (with or without millis/Z) to naive UTC datetime."""
    s = s.rstrip("Z")
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise ValueError(f"Cannot parse: {s}")


def test_generate_response_shape(client):
    resp = client.post("/api/schedules/generate", json=PARITY_INPUT)
    assert resp.status_code == 200
    data = resp.json()
    assert "options" in data
    assert isinstance(data["options"], list)
    opt = data["options"][0]
    assert "strategy" in opt
    assert "label" in opt
    assert "description" in opt
    assert "timeline" in opt
    assert "flagged" in opt
    assert "excluded" in opt


def test_generate_unknown_strategy_422(client):
    payload = dict(PARITY_INPUT)
    payload["strategies"] = ["does-not-exist"]
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 422


def test_generate_empty_activities(client):
    payload = {
        "start_time": "2026-09-02T08:00:00Z",
        "day_start": "2026-09-02T06:00:00Z",
        "day_end": "2026-09-02T23:00:00Z",
        "activities": [],
        "strategies": ["your-order"],
    }
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["options"][0]["timeline"] == []


def test_generate_your_order_parity(client):
    payload = dict(PARITY_INPUT)
    payload["strategies"] = ["your-order"]
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    opt = resp.json()["options"][0]
    assert opt["strategy"] == "your-order"

    with open(FIXTURE_PATH) as f:
        fixture = json.load(f)
    expected = fixture["strategies"]["your-order"]["timeline"]

    assert len(opt["timeline"]) == len(expected)
    for actual_entry, expected_entry in zip(opt["timeline"], expected):
        assert actual_entry["name"] == expected_entry["name"]
        assert _parse_dt(actual_entry["start"]) == _parse_dt(expected_entry["start"])
        assert _parse_dt(actual_entry["end"]) == _parse_dt(expected_entry["end"])


def test_generate_null_strategies_runs_all(client):
    payload = dict(PARITY_INPUT)
    payload["strategies"] = None
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    strategies_returned = {o["strategy"] for o in resp.json()["options"]}
    assert "your-order" in strategies_returned


def test_generate_shortest_first_parity(client):
    payload = dict(PARITY_INPUT)
    payload["strategies"] = ["shortest-first"]
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    opt = resp.json()["options"][0]
    assert opt["strategy"] == "shortest-first"

    with open(FIXTURE_PATH) as f:
        fixture = json.load(f)
    expected = fixture["strategies"]["shortest-first"]["timeline"]

    assert len(opt["timeline"]) == len(expected)
    for actual_entry, expected_entry in zip(opt["timeline"], expected):
        assert actual_entry["name"] == expected_entry["name"]
        assert _parse_dt(actual_entry["start"]) == _parse_dt(expected_entry["start"])
        assert _parse_dt(actual_entry["end"]) == _parse_dt(expected_entry["end"])


def test_generate_longest_first_parity(client):
    payload = dict(PARITY_INPUT)
    payload["strategies"] = ["longest-first"]
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    opt = resp.json()["options"][0]
    assert opt["strategy"] == "longest-first"

    with open(FIXTURE_PATH) as f:
        fixture = json.load(f)
    expected = fixture["strategies"]["longest-first"]["timeline"]

    assert len(opt["timeline"]) == len(expected)
    for actual_entry, expected_entry in zip(opt["timeline"], expected):
        assert actual_entry["name"] == expected_entry["name"]
        assert _parse_dt(actual_entry["start"]) == _parse_dt(expected_entry["start"])
        assert _parse_dt(actual_entry["end"]) == _parse_dt(expected_entry["end"])


def test_generate_shortest_first_stable_sort(client):
    payload = {
        "start_time": "2026-09-02T08:00:00Z",
        "day_start": "2026-09-02T06:00:00Z",
        "day_end": "2026-09-02T23:00:00Z",
        "activities": [
            {"name": "A", "estimated_duration": 1800},
            {"name": "B", "estimated_duration": 900},
            {"name": "C", "estimated_duration": 1800},
        ],
        "strategies": ["shortest-first"],
    }
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    names = [e["name"] for e in resp.json()["options"][0]["timeline"]]
    assert names == ["B", "A", "C"]


def test_generate_longest_first_stable_sort(client):
    payload = {
        "start_time": "2026-09-02T08:00:00Z",
        "day_start": "2026-09-02T06:00:00Z",
        "day_end": "2026-09-02T23:00:00Z",
        "activities": [
            {"name": "A", "estimated_duration": 1800},
            {"name": "B", "estimated_duration": 3600},
            {"name": "C", "estimated_duration": 1800},
        ],
        "strategies": ["longest-first"],
    }
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    names = [e["name"] for e in resp.json()["options"][0]["timeline"]]
    assert names == ["B", "A", "C"]


def test_generate_best_fit_parity(client):
    payload = dict(PARITY_INPUT)
    payload["strategies"] = ["best-fit"]
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    opt = resp.json()["options"][0]
    assert opt["strategy"] == "best-fit"

    with open(FIXTURE_PATH) as f:
        fixture = json.load(f)
    expected = fixture["strategies"]["best-fit"]["timeline"]

    assert len(opt["timeline"]) == len(expected)
    for actual_entry, expected_entry in zip(opt["timeline"], expected):
        assert actual_entry["name"] == expected_entry["name"]
        assert _parse_dt(actual_entry["start"]) == _parse_dt(expected_entry["start"])
        assert _parse_dt(actual_entry["end"]) == _parse_dt(expected_entry["end"])


def test_generate_best_fit_no_events_parity(client):
    payload = {
        "start_time": "2026-09-02T08:00:00Z",
        "day_start": "2026-09-02T06:00:00Z",
        "day_end": "2026-09-02T23:00:00Z",
        "activities": [
            {"task_id": 1, "name": "Write report", "estimated_duration": 5400},
            {"name": "Email sweep", "estimated_duration": 1800},
            {"task_id": 2, "name": "Gym", "estimated_duration": 3600},
            {"name": "Read chapter", "estimated_duration": 1800},
            {"name": "Plan tomorrow", "estimated_duration": 900},
        ],
        "existing_events": [],
        "strategies": ["best-fit"],
    }
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    opt = resp.json()["options"][0]

    with open(FIXTURE_PATH) as f:
        fixture = json.load(f)
    expected = fixture["strategies"]["best-fit-no-events"]["timeline"]

    assert len(opt["timeline"]) == len(expected)
    for actual_entry, expected_entry in zip(opt["timeline"], expected):
        assert actual_entry["name"] == expected_entry["name"]
        assert _parse_dt(actual_entry["start"]) == _parse_dt(expected_entry["start"])
        assert _parse_dt(actual_entry["end"]) == _parse_dt(expected_entry["end"])


def test_generate_best_fit_event_before_day_start_ignored(client):
    payload = {
        "start_time": "2026-09-02T08:00:00Z",
        "day_start": "2026-09-02T06:00:00Z",
        "day_end": "2026-09-02T23:00:00Z",
        "activities": [
            {"name": "A", "estimated_duration": 3600},
            {"name": "B", "estimated_duration": 1800},
        ],
        "existing_events": [
            {"name": "Before day", "start": "2026-09-02T04:00:00Z", "end": "2026-09-02T05:00:00Z"},
        ],
        "strategies": ["best-fit"],
    }
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    names = [e["name"] for e in resp.json()["options"][0]["timeline"]]
    assert names == ["A", "B"]


def test_generate_best_fit_overlapping_events(client):
    payload = {
        "start_time": "2026-09-02T08:00:00Z",
        "day_start": "2026-09-02T06:00:00Z",
        "day_end": "2026-09-02T23:00:00Z",
        "activities": [
            {"name": "A", "estimated_duration": 3600},
        ],
        "existing_events": [
            {"name": "Meeting 1", "start": "2026-09-02T09:00:00Z", "end": "2026-09-02T11:00:00Z"},
            {"name": "Meeting 2", "start": "2026-09-02T10:00:00Z", "end": "2026-09-02T12:00:00Z"},
        ],
        "strategies": ["best-fit"],
    }
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    names = [e["name"] for e in resp.json()["options"][0]["timeline"]]
    assert names == ["A"]


def test_generate_best_fit_event_past_day_end_ignored(client):
    payload = {
        "start_time": "2026-09-02T08:00:00Z",
        "day_start": "2026-09-02T06:00:00Z",
        "day_end": "2026-09-02T23:00:00Z",
        "activities": [
            {"name": "A", "estimated_duration": 3600},
            {"name": "B", "estimated_duration": 1800},
        ],
        "existing_events": [
            {"name": "Late event", "start": "2026-09-02T23:00:00Z", "end": "2026-09-03T00:00:00Z"},
        ],
        "strategies": ["best-fit"],
    }
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    names = [e["name"] for e in resp.json()["options"][0]["timeline"]]
    assert names == ["A", "B"]


def test_eat_the_frog_moves_frog_to_front(client):
    payload = {
        "start_time": "2026-09-02T08:00:00Z",
        "day_start": "2026-09-02T06:00:00Z",
        "day_end": "2026-09-02T23:00:00Z",
        "activities": [
            {"name": "A", "estimated_duration": 1800},
            {"name": "B", "estimated_duration": 900, "is_frog": True},
            {"name": "C", "estimated_duration": 3600},
        ],
        "strategies": ["eat-the-frog"],
    }
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    opt = resp.json()["options"][0]
    names = [e["name"] for e in opt["timeline"]]
    assert names == ["B", "A", "C"]
    assert "B" in opt["description"]


def test_eat_the_frog_no_frog_fallback(client):
    payload = {
        "start_time": "2026-09-02T08:00:00Z",
        "day_start": "2026-09-02T06:00:00Z",
        "day_end": "2026-09-02T23:00:00Z",
        "activities": [
            {"name": "A", "estimated_duration": 1800},
            {"name": "B", "estimated_duration": 900},
            {"name": "C", "estimated_duration": 3600},
        ],
        "strategies": ["eat-the-frog"],
    }
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    opt = resp.json()["options"][0]
    names = [e["name"] for e in opt["timeline"]]
    assert names == ["A", "B", "C"]


def test_eat_the_frog_multiple_frogs_first_wins(client):
    payload = {
        "start_time": "2026-09-02T08:00:00Z",
        "day_start": "2026-09-02T06:00:00Z",
        "day_end": "2026-09-02T23:00:00Z",
        "activities": [
            {"name": "A", "estimated_duration": 1800},
            {"name": "B", "estimated_duration": 900, "is_frog": True},
            {"name": "C", "estimated_duration": 3600},
            {"name": "D", "estimated_duration": 1200, "is_frog": True},
            {"name": "E", "estimated_duration": 600},
        ],
        "strategies": ["eat-the-frog"],
    }
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    names = [e["name"] for e in resp.json()["options"][0]["timeline"]]
    assert names == ["B", "A", "C", "D", "E"]


def test_eisenhower_all_quadrants(client):
    payload = {
        "start_time": "2026-09-02T08:00:00Z",
        "day_start": "2026-09-02T06:00:00Z",
        "day_end": "2026-09-02T23:00:00Z",
        "activities": [
            {"name": "Q1a", "estimated_duration": 3600, "is_urgent": True, "is_important": True},
            {"name": "Q2a", "estimated_duration": 1800, "is_urgent": False, "is_important": True},
            {"name": "Q3a", "estimated_duration": 900, "is_urgent": True, "is_important": False},
            {"name": "Q4a", "estimated_duration": 600, "is_urgent": False, "is_important": False},
            {"name": "Q1b", "estimated_duration": 1200, "is_urgent": True, "is_important": True},
        ],
        "strategies": ["eisenhower"],
    }
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    opt = resp.json()["options"][0]
    names = [e["name"] for e in opt["timeline"]]
    assert names == ["Q1a", "Q1b", "Q2a", "Q3a"]
    flagged_names = [f["name"] for f in opt["flagged"]]
    assert flagged_names == ["Q3a"]
    assert opt["flagged"][0]["reason"] == "consider-delegating"
    excluded_names = [e["name"] for e in opt["excluded"]]
    assert excluded_names == ["Q4a"]
    assert opt["excluded"][0]["reason"] == "not-urgent-not-important"


def test_eisenhower_stable_within_quadrant(client):
    payload = {
        "start_time": "2026-09-02T08:00:00Z",
        "day_start": "2026-09-02T06:00:00Z",
        "day_end": "2026-09-02T23:00:00Z",
        "activities": [
            {"name": "B", "estimated_duration": 1800, "is_urgent": True, "is_important": True},
            {"name": "A", "estimated_duration": 3600, "is_urgent": True, "is_important": True},
            {"name": "C", "estimated_duration": 900, "is_urgent": True, "is_important": True},
        ],
        "strategies": ["eisenhower"],
    }
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    names = [e["name"] for e in resp.json()["options"][0]["timeline"]]
    assert names == ["B", "A", "C"]


def test_eisenhower_only_q4_empty_timeline(client):
    payload = {
        "start_time": "2026-09-02T08:00:00Z",
        "day_start": "2026-09-02T06:00:00Z",
        "day_end": "2026-09-02T23:00:00Z",
        "activities": [
            {"name": "X", "estimated_duration": 1800},
            {"name": "Y", "estimated_duration": 900},
        ],
        "strategies": ["eisenhower"],
    }
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    opt = resp.json()["options"][0]
    assert opt["timeline"] == []
    excluded_names = [e["name"] for e in opt["excluded"]]
    assert "X" in excluded_names and "Y" in excluded_names


def test_eisenhower_task_id_defaults_flags(client):
    task_resp = client.post("/api/tasks/", json={"name": "Urgent Important Task", "is_urgent": True, "is_important": True})
    assert task_resp.status_code == 200
    task_id = task_resp.json()["id"]

    payload = {
        "start_time": "2026-09-02T08:00:00Z",
        "day_start": "2026-09-02T06:00:00Z",
        "day_end": "2026-09-02T23:00:00Z",
        "activities": [
            {"task_id": task_id, "name": "Urgent Important Task", "estimated_duration": 3600},
            {"name": "Other", "estimated_duration": 1800},
        ],
        "strategies": ["eisenhower"],
    }
    resp = client.post("/api/schedules/generate", json=payload)
    assert resp.status_code == 200
    opt = resp.json()["options"][0]
    names = [e["name"] for e in opt["timeline"]]
    assert names[0] == "Urgent Important Task"
    excluded_names = [e["name"] for e in opt["excluded"]]
    assert "Other" in excluded_names
