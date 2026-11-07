"""
Tests for B59.tests: Coach tables, settings, Coach notes, Intended length (D101, D104, D106-D109,
D112, D121).

Contract: prd.md, B59.tests. Choices this file pins that the PRD leaves open:
  - Models live in `app/models/coach.py`: CoachConversation, CoachMessage, CoachCall, CoachNote,
    CoachSettings. CoachConversation deletes its messages and calls through the ORM
    (relationship cascade) as well as `ondelete="CASCADE"` on the foreign keys, because SQLite
    does not enforce foreign keys in the test database and MySQL does live.
  - PUT settings takes every field (missing field 422), as /api/settings/pomodoro does.
  - Coach note POST returns 200, DELETE returns 200, as /api/tasks does.
  - PUT /api/tasks/{id} with an explicit `intended_length: null` clears it; leaving the key out
    keeps it. The router must check `model_fields_set`, not `is not None`.
  - `cost_usd(model, usage)` reads attributes off an SDK-shaped usage object. The SDK's two cache
    counts can be None, which counts as 0.

Model and service imports are inside the tests so that each test fails on its own before
B59.impl rather than the whole file failing at collection.
"""
import argparse
import logging
import os
from datetime import date
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient

from app.main import app

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COACH_URL = "/api/settings/coach"
REMINDERS_URL = "/api/settings/reminders"
NOTES_URL = "/api/coach/notes"
TWELVE_HOURS = 43200
DAY = "2026-11-20"
T9 = "2026-11-20T15:00:00Z"


def _task(client, name="Tango", **body):
    r = client.post("/api/tasks/", json={"name": name, **body})
    assert r.status_code == 200
    return r.json()


def _note(client, text="Mornings are for hard work"):
    r = client.post(NOTES_URL, json={"text": text})
    assert r.status_code == 200
    return r.json()


def _place(client, task_id):
    r = client.post(f"/api/schedules/days/{DAY}/items", json={"task_id": task_id, "scheduled_time": T9})
    assert r.status_code == 200
    return r.json()


# --- Coach settings -------------------------------------------------------------------------

def test_coach_settings_default_notes_on(client):
    r = client.get(COACH_URL)
    assert r.status_code == 200
    assert r.json()["notes_enabled"] is True


def test_coach_settings_get_twice_keeps_one_row(client, db):
    client.get(COACH_URL)
    client.get(COACH_URL)
    assert db.execute(sa.text("SELECT COUNT(*) FROM coach_settings")).scalar_one() == 1


def test_coach_settings_put_persists(client):
    r = client.put(COACH_URL, json={"notes_enabled": False})
    assert r.status_code == 200
    assert r.json()["notes_enabled"] is False
    assert client.get(COACH_URL).json()["notes_enabled"] is False


def test_coach_settings_put_missing_field_is_422(client):
    assert client.put(COACH_URL, json={}).status_code == 422


# --- Reminder settings ----------------------------------------------------------------------

def test_reminder_settings_defaults(client):
    r = client.get(REMINDERS_URL)
    assert r.status_code == 200
    assert r.json()["enabled"] is True
    assert r.json()["minutes_before"] == 5


def test_reminder_settings_get_twice_keeps_one_row(client, db):
    client.get(REMINDERS_URL)
    client.get(REMINDERS_URL)
    assert db.execute(sa.text("SELECT COUNT(*) FROM reminder_settings")).scalar_one() == 1


def test_reminder_settings_put_persists(client):
    r = client.put(REMINDERS_URL, json={"enabled": False, "minutes_before": 30})
    assert r.status_code == 200
    got = client.get(REMINDERS_URL).json()
    assert got["enabled"] is False
    assert got["minutes_before"] == 30


@pytest.mark.parametrize("minutes", [1, 120])
def test_reminder_minutes_bounds_accepted(client, minutes):
    r = client.put(REMINDERS_URL, json={"enabled": True, "minutes_before": minutes})
    assert r.status_code == 200
    assert r.json()["minutes_before"] == minutes


@pytest.mark.parametrize("minutes", [0, 121, 5.5])
def test_reminder_minutes_out_of_range_is_422(client, minutes):
    r = client.put(REMINDERS_URL, json={"enabled": True, "minutes_before": minutes})
    assert r.status_code == 422


@pytest.mark.parametrize("body", [{"enabled": True}, {"minutes_before": 5}])
def test_reminder_put_missing_field_is_422(client, body):
    assert client.put(REMINDERS_URL, json=body).status_code == 422


def test_rejected_reminder_put_leaves_values_unchanged(client):
    client.put(REMINDERS_URL, json={"enabled": False, "minutes_before": 121})
    got = client.get(REMINDERS_URL).json()
    assert got["enabled"] is True
    assert got["minutes_before"] == 5


# --- Coach notes ----------------------------------------------------------------------------

def test_note_create_returns_it_with_timestamps(client):
    note = _note(client, "No deep work after 3pm")
    assert note["text"] == "No deep work after 3pm"
    assert note["created_at"] is not None
    assert note["confirmed_at"] is not None


def test_notes_list_oldest_first(client):
    ids = [_note(client, text)["id"] for text in ["first", "second", "third"]]
    r = client.get(NOTES_URL)
    assert r.status_code == 200
    assert [n["id"] for n in r.json()] == ids


def test_notes_list_orders_by_created_at(client, db):
    first = _note(client, "first")
    second = _note(client, "second")
    db.execute(
        sa.text("UPDATE coach_notes SET created_at = '2020-01-01 00:00:00.000000' WHERE id = :id"),
        {"id": second["id"]},
    )
    db.commit()
    assert [n["id"] for n in client.get(NOTES_URL).json()] == [second["id"], first["id"]]


def test_note_edit_changes_text_and_moves_confirmed_at_only(client, db):
    note = _note(client)
    db.execute(
        sa.text(
            "UPDATE coach_notes SET created_at = '2020-01-01 00:00:00.000000', "
            "confirmed_at = '2020-01-01 00:00:00.000000' WHERE id = :id"
        ),
        {"id": note["id"]},
    )
    db.commit()
    before = client.get(NOTES_URL).json()[0]

    r = client.put(f"{NOTES_URL}/{note['id']}", json={"text": "Edited"})
    assert r.status_code == 200
    body = r.json()
    assert body["text"] == "Edited"
    assert body["confirmed_at"] > before["confirmed_at"]
    assert body["created_at"] == before["created_at"]
    assert client.get(NOTES_URL).json()[0]["text"] == "Edited"


def test_note_delete(client):
    note = _note(client)
    keep = _note(client, "keep")
    assert client.delete(f"{NOTES_URL}/{note['id']}").status_code == 200
    assert [n["id"] for n in client.get(NOTES_URL).json()] == [keep["id"]]


def test_note_text_of_300_chars_is_accepted(client):
    assert client.post(NOTES_URL, json={"text": "x" * 300}).status_code == 200


@pytest.mark.parametrize("text", ["", "x" * 301], ids=["empty", "301-chars"])
def test_note_create_bad_text_is_422(client, text):
    assert client.post(NOTES_URL, json={"text": text}).status_code == 422
    assert client.get(NOTES_URL).json() == []


@pytest.mark.parametrize("text", ["", "x" * 301], ids=["empty", "301-chars"])
def test_note_edit_bad_text_is_422_and_keeps_text(client, text):
    note = _note(client, "original")
    assert client.put(f"{NOTES_URL}/{note['id']}", json={"text": text}).status_code == 422
    assert client.get(NOTES_URL).json()[0]["text"] == "original"


def test_note_unknown_id_is_404(client):
    assert client.put(f"{NOTES_URL}/999", json={"text": "x"}).status_code == 404
    assert client.delete(f"{NOTES_URL}/999").status_code == 404


# --- Credential gate ------------------------------------------------------------------------

@pytest.mark.parametrize("method,url", [
    ("get", COACH_URL),
    ("put", COACH_URL),
    ("get", REMINDERS_URL),
    ("put", REMINDERS_URL),
    ("get", NOTES_URL),
    ("post", NOTES_URL),
    ("put", f"{NOTES_URL}/1"),
    ("delete", f"{NOTES_URL}/1"),
])
def test_routes_behind_gate(method, url):
    assert getattr(TestClient(app), method)(url).status_code == 401


# --- Intended length ------------------------------------------------------------------------

def test_task_defaults_to_no_intended_length(client):
    assert _task(client)["intended_length"] is None


def test_task_create_and_get_carry_intended_length(client):
    task = _task(client, intended_length=1800.0)
    assert task["intended_length"] == 1800.0
    assert client.get(f"/api/tasks/{task['id']}").json()["intended_length"] == 1800.0


def test_task_update_sets_intended_length(client):
    task = _task(client)
    r = client.put(f"/api/tasks/{task['id']}", json={"intended_length": 900.0})
    assert r.status_code == 200
    assert r.json()["intended_length"] == 900.0


def test_task_update_null_clears_intended_length(client):
    task = _task(client, intended_length=1800.0)
    r = client.put(f"/api/tasks/{task['id']}", json={"intended_length": None})
    assert r.status_code == 200
    assert r.json()["intended_length"] is None


def test_task_update_without_the_key_keeps_intended_length(client):
    task = _task(client, intended_length=1800.0)
    r = client.put(f"/api/tasks/{task['id']}", json={"name": "Tango II"})
    assert r.status_code == 200
    assert r.json()["intended_length"] == 1800.0


def test_intended_length_upper_bound_accepted(client):
    task = _task(client, intended_length=TWELVE_HOURS)
    assert task["intended_length"] == TWELVE_HOURS


@pytest.mark.parametrize("value", [0, -60, TWELVE_HOURS + 1])
def test_intended_length_out_of_range_on_create_is_422(client, value):
    r = client.post("/api/tasks/", json={"name": "Bad", "intended_length": value})
    assert r.status_code == 422


@pytest.mark.parametrize("value", [0, -60, TWELVE_HOURS + 1])
def test_intended_length_out_of_range_on_update_is_422(client, value):
    task = _task(client, intended_length=1800.0)
    assert client.put(f"/api/tasks/{task['id']}", json={"intended_length": value}).status_code == 422
    assert client.get(f"/api/tasks/{task['id']}").json()["intended_length"] == 1800.0


def test_place_seeds_intended_length_when_no_recordings(client):
    task = _task(client, intended_length=1800.0)
    assert _place(client, task["id"])["estimated_duration"] == 1800.0


def test_place_seeds_average_over_intended_length_when_recordings_exist(client):
    task = _task(client, intended_length=1800.0)
    r = client.post("/api/sessions/", json={"name": "Rec", "duration": 1200.0, "task_id": task["id"]})
    assert r.status_code == 200
    assert _place(client, task["id"])["estimated_duration"] == 1200.0


def test_place_seeds_600_with_neither(client):
    task = _task(client)
    assert _place(client, task["id"])["estimated_duration"] == 600.0


def test_place_explicit_duration_beats_intended_length(client):
    task = _task(client, intended_length=1800.0)
    r = client.post(
        f"/api/schedules/days/{DAY}/items",
        json={"task_id": task["id"], "scheduled_time": T9, "estimated_duration": 300.0},
    )
    assert r.status_code == 200
    assert r.json()["estimated_duration"] == 300.0


# --- Cost -----------------------------------------------------------------------------------

USAGE = SimpleNamespace(
    input_tokens=1000,
    output_tokens=500,
    cache_read_input_tokens=10000,
    cache_creation_input_tokens=2000,
)


@pytest.mark.parametrize("model,expected", [
    # 1000 * 2.00 + 500 * 10.00 + 10000 * 0.20 + 2000 * 2.50 = 14000 per million
    ("claude-sonnet-5-5", 0.014),
    # 1000 * 4.00 + 500 * 20.00 + 10000 * 0.20 + 2000 * 5.00 = 26000 per million
    ("claude-opus-5-5", 0.026),
])
def test_cost_for_known_models(model, expected):
    from app.services.coach_cost import cost_usd
    assert cost_usd(model, USAGE) == pytest.approx(expected)


def test_cost_treats_none_cache_counts_as_zero():
    from app.services.coach_cost import cost_usd
    usage = SimpleNamespace(
        input_tokens=1000,
        output_tokens=500,
        cache_read_input_tokens=None,
        cache_creation_input_tokens=None,
    )
    # 1000 * 2.00 + 500 * 10.00 = 7000 per million
    assert cost_usd("claude-sonnet-5-5", usage) == pytest.approx(0.007)


def test_cost_unknown_model_is_zero_with_a_warning(caplog):
    from app.services.coach_cost import cost_usd
    with caplog.at_level(logging.WARNING):
        assert cost_usd("claude-unknown-1", USAGE) == 0.0
    assert any(
        rec.levelno == logging.WARNING and "claude-unknown-1" in rec.getMessage()
        for rec in caplog.records
    )


# --- Conversation rows ----------------------------------------------------------------------

def _conversation_with_children(db):
    from app.models.coach import CoachCall, CoachConversation, CoachMessage

    conversation = CoachConversation(
        target_date=date(2026, 11, 20),
        tz_offset=360,
        status="open",
        model="claude-sonnet-5-5",
        effort="medium",
    )
    db.add(conversation)
    db.flush()
    db.add(CoachMessage(
        conversation_id=conversation.id,
        role="user",
        content='[{"type": "text", "text": "Plan my day"}]',
        visible_text="Plan my day",
    ))
    db.add(CoachCall(
        conversation_id=conversation.id,
        turn_index=0,
        model="claude-sonnet-5-5",
        effort="medium",
        input_tokens=1000,
        cache_creation_input_tokens=0,
        cache_read_input_tokens=0,
        output_tokens=100,
        stop_reason="end_turn",
        latency_ms=1500,
        cost_usd=0.003,
    ))
    db.commit()
    return conversation


def test_conversation_counters_start_at_zero_with_nothing_closed(db):
    conversation = _conversation_with_children(db)
    db.refresh(conversation)
    assert conversation.user_turns == 0
    assert conversation.revision_turns == 0
    assert conversation.proposal is None
    assert conversation.closed_at is None
    assert conversation.created_at is not None


def test_deleting_a_conversation_cascades_messages_and_calls(db):
    from app.models.coach import CoachCall, CoachMessage

    conversation = _conversation_with_children(db)
    other = _conversation_with_children(db)
    assert db.query(CoachMessage).count() == 2
    assert db.query(CoachCall).count() == 2

    db.delete(conversation)
    db.commit()

    assert [m.conversation_id for m in db.query(CoachMessage).all()] == [other.id]
    assert [c.conversation_id for c in db.query(CoachCall).all()] == [other.id]


# --- Migration ------------------------------------------------------------------------------

NEW_TABLES = {
    "coach_conversations": {
        "id", "target_date", "tz_offset", "status", "model", "effort", "user_turns",
        "revision_turns", "proposal", "proposed_count", "accepted_count", "accepted_items",
        "rating", "created_at", "updated_at", "closed_at",
    },
    "coach_messages": {"id", "conversation_id", "role", "content", "visible_text", "created_at"},
    "coach_calls": {
        "id", "conversation_id", "turn_index", "model", "effort", "input_tokens",
        "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens", "stop_reason",
        "latency_ms", "cost_usd", "created_at",
    },
    "coach_notes": {"id", "text", "created_at", "confirmed_at"},
    "coach_settings": {"id", "notes_enabled"},
    "reminder_settings": {"id", "enabled", "minutes_before"},
}


def _alembic_cfg(db_url):
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.cmd_opts = argparse.Namespace(x=[f"db_url={db_url}"])
    return cfg


def test_one_revision_on_top_of_the_pomodoro_revision():
    script = ScriptDirectory.from_config(_alembic_cfg("sqlite://"))
    assert len(script.get_heads()) == 1
    assert len(script.get_revision("66350d60caf3").nextrev) == 1


def test_migration_adds_tables_and_intended_length(tmp_path):
    db_url = f"sqlite:///{tmp_path}/coach_up.db"
    command.upgrade(_alembic_cfg(db_url), "head")
    insp = sa.inspect(sa.create_engine(db_url))

    for table, columns in NEW_TABLES.items():
        assert columns <= {c["name"] for c in insp.get_columns(table)}, table

    intended = {c["name"]: c for c in insp.get_columns("tasks")}["intended_length"]
    assert intended["nullable"] is True
    assert isinstance(intended["type"], sa.Float)


@pytest.mark.parametrize("table", ["coach_messages", "coach_calls"])
def test_migration_foreign_keys_cascade(tmp_path, table):
    db_url = f"sqlite:///{tmp_path}/coach_fk.db"
    command.upgrade(_alembic_cfg(db_url), "head")
    fks = sa.inspect(sa.create_engine(db_url)).get_foreign_keys(table)
    assert len(fks) == 1
    assert fks[0]["referred_table"] == "coach_conversations"
    assert fks[0]["options"].get("ondelete") == "CASCADE"


def test_migration_downgrade_drops_tables_and_intended_length(tmp_path):
    db_url = f"sqlite:///{tmp_path}/coach_down.db"
    cfg = _alembic_cfg(db_url)
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "66350d60caf3")
    insp = sa.inspect(sa.create_engine(db_url))

    assert not set(NEW_TABLES) & set(insp.get_table_names())
    assert "intended_length" not in {c["name"] for c in insp.get_columns("tasks")}
