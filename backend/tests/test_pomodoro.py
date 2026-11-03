"""
Tests for B48.tests: Pomodoro settings and the Pomodoro summary on Recordings (D81, D83).

Contract:
  - Settings: one-row table `pomodoro_settings` (model PomodoroSettings) with work_minutes 25,
    break_minutes 5, long_break_minutes 15, long_break_every 4 by default.
    GET /api/settings/pomodoro returns the row, creating it with the defaults if absent.
    PUT /api/settings/pomodoro takes all four; minutes 1-180, long_break_every 1-12, else 422.
    Behind the credential gate.
  - Recording summary: stopwatch_sessions gains nullable pomodoro_work_intervals,
    pomodoro_breaks (int) and pomodoro_break_seconds (float). All null, or all set with
    work_intervals >= 1, breaks >= 0, break_seconds >= 0; otherwise 422. Create returns them;
    list and get include them. Otherwise a Pomodoro Recording behaves as any Recording.
  - Migration: one Alembic revision adding the table and the three columns; downgrade drops them.

These fail before B48.impl: no /api/settings router, no pomodoro_* fields, no revision.
"""
import argparse
import os

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from app.main import app

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "/api/settings/pomodoro"
DEFAULTS = {"work_minutes": 25, "break_minutes": 5, "long_break_minutes": 15, "long_break_every": 4}
SUMMARY = {"pomodoro_work_intervals": 4, "pomodoro_breaks": 3, "pomodoro_break_seconds": 1200.0}
SUMMARY_KEYS = list(SUMMARY)


def _pick(body, keys):
    return {k: body[k] for k in keys}


# --- Settings -------------------------------------------------------------------------------

def test_get_on_empty_table_returns_defaults(client):
    r = client.get(URL)
    assert r.status_code == 200
    assert _pick(r.json(), DEFAULTS) == DEFAULTS


def test_get_twice_keeps_one_row(client, db):
    client.get(URL)
    client.get(URL)
    count = db.execute(sa.text("SELECT COUNT(*) FROM pomodoro_settings")).scalar_one()
    assert count == 1


def test_put_then_get_returns_new_values(client):
    new = {"work_minutes": 50, "break_minutes": 10, "long_break_minutes": 30, "long_break_every": 2}
    r = client.put(URL, json=new)
    assert r.status_code == 200
    assert _pick(r.json(), new) == new

    r = client.get(URL)
    assert r.status_code == 200
    assert _pick(r.json(), new) == new


def test_put_accepts_bounds(client):
    low = {"work_minutes": 1, "break_minutes": 1, "long_break_minutes": 1, "long_break_every": 1}
    high = {"work_minutes": 180, "break_minutes": 180, "long_break_minutes": 180, "long_break_every": 12}
    assert client.put(URL, json=low).status_code == 200
    assert client.put(URL, json=high).status_code == 200


@pytest.mark.parametrize("field", ["work_minutes", "break_minutes", "long_break_minutes"])
@pytest.mark.parametrize("value", [0, 181])
def test_put_minutes_out_of_range_is_422(client, field, value):
    r = client.put(URL, json={**DEFAULTS, field: value})
    assert r.status_code == 422


@pytest.mark.parametrize("value", [0, 13])
def test_put_long_break_every_out_of_range_is_422(client, value):
    r = client.put(URL, json={**DEFAULTS, "long_break_every": value})
    assert r.status_code == 422


@pytest.mark.parametrize("field", list(DEFAULTS))
def test_put_missing_field_is_422(client, field):
    body = {k: v for k, v in DEFAULTS.items() if k != field}
    r = client.put(URL, json=body)
    assert r.status_code == 422


def test_rejected_put_leaves_values_unchanged(client):
    client.put(URL, json={**DEFAULTS, "work_minutes": 181})
    assert _pick(client.get(URL).json(), DEFAULTS) == DEFAULTS


def test_settings_behind_gate(client):
    unauthed = TestClient(app)
    assert unauthed.get(URL).status_code == 401
    assert unauthed.put(URL, json=DEFAULTS).status_code == 401


# --- Recording summary ----------------------------------------------------------------------

def _task(client, name="Reading"):
    r = client.post("/api/tasks/", json={"name": name})
    assert r.status_code == 200
    return r.json()


def test_create_pomodoro_recording_returns_summary_and_feeds_activity(client):
    task = _task(client)
    r = client.post("/api/sessions/", json={
        "name": "Reading", "duration": 6000.0, "task_id": task["id"], **SUMMARY,
    })
    assert r.status_code == 200
    body = r.json()
    assert _pick(body, SUMMARY_KEYS) == SUMMARY
    assert body["duration"] == pytest.approx(6000.0)

    updated = client.get(f"/api/tasks/{task['id']}").json()
    assert updated["total_recordings"] == 1
    assert updated["average_duration"] == pytest.approx(6000.0)

    logs = client.get(f"/api/time-logs/?task_id={task['id']}").json()
    assert len(logs) == 1
    assert logs[0]["session_id"] == body["id"]


def test_list_and_get_include_summary(client):
    task = _task(client)
    sid = client.post("/api/sessions/", json={
        "name": "Reading", "duration": 3000.0, "task_id": task["id"], **SUMMARY,
    }).json()["id"]

    got = client.get(f"/api/sessions/{sid}").json()
    assert _pick(got, SUMMARY_KEYS) == SUMMARY

    listed = [s for s in client.get("/api/sessions/").json() if s["id"] == sid]
    assert len(listed) == 1
    assert _pick(listed[0], SUMMARY_KEYS) == SUMMARY


def test_pomodoro_recording_with_new_activity_name(client):
    r = client.post("/api/sessions/", json={
        "name": "Writing", "duration": 1500.0, "new_activity_name": "Writing",
        "pomodoro_work_intervals": 1, "pomodoro_breaks": 0, "pomodoro_break_seconds": 0.0,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["task_id"] is not None
    assert body["pomodoro_work_intervals"] == 1
    assert body["pomodoro_breaks"] == 0
    assert body["pomodoro_break_seconds"] == pytest.approx(0.0)

    task = client.get(f"/api/tasks/{body['task_id']}").json()
    assert task["name"] == "Writing"
    assert task["average_duration"] == pytest.approx(1500.0)


@pytest.mark.parametrize("omit", [
    ["pomodoro_work_intervals"],
    ["pomodoro_breaks"],
    ["pomodoro_break_seconds"],
    ["pomodoro_breaks", "pomodoro_break_seconds"],
    ["pomodoro_work_intervals", "pomodoro_break_seconds"],
])
def test_partial_summary_is_422(client, omit):
    body = {"name": "Rec", "duration": 600.0, **{k: v for k, v in SUMMARY.items() if k not in omit}}
    r = client.post("/api/sessions/", json=body)
    assert r.status_code == 422


def test_partial_summary_with_explicit_null_is_422(client):
    r = client.post("/api/sessions/", json={
        "name": "Rec", "duration": 600.0, **SUMMARY, "pomodoro_breaks": None,
    })
    assert r.status_code == 422


@pytest.mark.parametrize("override", [
    {"pomodoro_work_intervals": 0},
    {"pomodoro_breaks": -1},
    {"pomodoro_break_seconds": -1.0},
])
def test_summary_out_of_range_is_422(client, override):
    r = client.post("/api/sessions/", json={"name": "Rec", "duration": 600.0, **SUMMARY, **override})
    assert r.status_code == 422


def test_rejected_summary_creates_nothing(client):
    client.post("/api/sessions/", json={"name": "Rec", "duration": 600.0, "pomodoro_work_intervals": 0,
                                        "pomodoro_breaks": 0, "pomodoro_break_seconds": 0.0})
    assert client.get("/api/sessions/").json() == []


def test_plain_recording_returns_null_summary(client):
    r = client.post("/api/sessions/", json={"name": "Plain", "duration": 600.0})
    assert r.status_code == 200
    body = r.json()
    for key in SUMMARY_KEYS:
        assert key in body
        assert body[key] is None

    got = client.get(f"/api/sessions/{body['id']}").json()
    for key in SUMMARY_KEYS:
        assert got[key] is None


def test_explicit_all_null_summary_is_plain(client):
    r = client.post("/api/sessions/", json={
        "name": "Plain", "duration": 600.0,
        "pomodoro_work_intervals": None, "pomodoro_breaks": None, "pomodoro_break_seconds": None,
    })
    assert r.status_code == 200
    for key in SUMMARY_KEYS:
        assert r.json()[key] is None


# --- Migration ------------------------------------------------------------------------------

def _alembic_cfg(db_url):
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.cmd_opts = argparse.Namespace(x=[f"db_url={db_url}"])
    return cfg


def test_migration_adds_and_drops_table_and_columns(tmp_path):
    db_url = f"sqlite:///{tmp_path}/pomodoro_migration.db"
    cfg = _alembic_cfg(db_url)
    command.upgrade(cfg, "head")
    engine = sa.create_engine(db_url)

    insp = sa.inspect(engine)
    assert "pomodoro_settings" in insp.get_table_names()
    settings_cols = {c["name"] for c in insp.get_columns("pomodoro_settings")}
    assert set(DEFAULTS) <= settings_cols
    session_cols = {c["name"]: c for c in insp.get_columns("stopwatch_sessions")}
    for key in SUMMARY_KEYS:
        assert key in session_cols
        assert session_cols[key]["nullable"] is True

    command.downgrade(cfg, "-1")
    engine.dispose()
    insp = sa.inspect(sa.create_engine(db_url))
    assert "pomodoro_settings" not in insp.get_table_names()
    session_cols = {c["name"] for c in insp.get_columns("stopwatch_sessions")}
    for key in SUMMARY_KEYS:
        assert key not in session_cols
