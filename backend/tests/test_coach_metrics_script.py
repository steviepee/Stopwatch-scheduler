"""
Tests for B63.tests: the metrics script, `backend/scripts/coach_metrics.py` (D106).

Contract: prd.md, B63.tests. Choices this file pins that the PRD leaves open:
  - The script is loaded from its file path (it is not in a package). It must be importable
    without side effects: argument parsing and DB access happen only in `main(argv)`, which runs
    under `if __name__ == "__main__"`. Run as `./venv/bin/python scripts/coach_metrics.py` from
    `backend/`, it puts `backend/` on `sys.path` itself so `app` imports.
  - `main(argv)` opens its session with `app.database.SessionLocal()`. The tests replace
    `SessionLocal` on `app.database` and, if the script holds its own reference, on the script
    module too.
  - `build_report(db, since)` takes a `date` or None and returns
    `{"totals": {...}, "conversations": [...], "calls": [...]}`:
      - `totals`: `conversations`, `by_status` (each of open/accepted/rejected/abandoned, 0 when
        none), `calls`, `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`,
        `output_tokens` (a null cache count counts as 0), `cost_usd`,
        `avg_cost_per_conversation` (total cost / conversations), `avg_cost_per_accepted`
        (total cost / accepted conversations: what one accepted plan costs, all spend included),
        `avg_turns_to_first_proposal` (mean `user_turns` over conversations with a stored
        Proposal), `avg_latency_ms` (mean over calls).
      - `conversations`: one dict per conversation with every `coach_conversations` column plus
        `kept`, `edited`, `deleted`, `recorded`. For a conversation with no `accepted_items` the
        four counts are 0 or None.
      - `calls`: one dict per `coach_calls` row in scope, every column.
  - `since` keeps conversations whose `created_at` falls on or after that UTC date, and only
    their calls.
  - `recorded` counts accepted items whose Activity has a Recording (`stopwatch_sessions`,
    `start_time`, else `created_at`) on the target date in the conversation's local time
    (`tz_offset`, JS convention: local = UTC - offset minutes). It is independent of
    kept/edited/deleted.
"""

import csv
import importlib.util
import json
import os
import subprocess
import sys
from datetime import date, datetime

import pytest

import app.database
from app.models.coach import CoachCall, CoachConversation
from app.models.schedule import Schedule, ScheduleItem
from app.models.stopwatch_session import StopwatchSession
from app.models.task import Task
from tests.conftest import TestingSessionLocal

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(BACKEND, "scripts", "coach_metrics.py")

TARGET = date(2026, 11, 20)
TZ = 300  # UTC-5

CONVERSATION_COLUMNS = [c.name for c in CoachConversation.__table__.columns]
CALL_COLUMNS = [c.name for c in CoachCall.__table__.columns]
DERIVED = ["kept", "edited", "deleted", "recorded"]


def _load_script():
    spec = importlib.util.spec_from_file_location("coach_metrics", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def metrics():
    return _load_script()


def _iso(dt):
    return dt.isoformat() + "Z"


def _call(conv, cost, latency, input_tokens, cache_creation, cache_read, output, stop_reason="end_turn"):
    return CoachCall(
        conversation=conv, turn_index=0, model="claude-sonnet-5-5", effort="medium",
        input_tokens=input_tokens, cache_creation_input_tokens=cache_creation,
        cache_read_input_tokens=cache_read, output_tokens=output, stop_reason=stop_reason,
        latency_ms=latency, cost_usd=cost, created_at=conv.created_at,
    )


def _conversation(status, user_turns, created_at, proposal=None, **fields):
    return CoachConversation(
        target_date=TARGET, tz_offset=TZ, status=status, model="claude-sonnet-5-5", effort="medium",
        user_turns=user_turns, revision_turns=0,
        proposal=json.dumps(proposal) if proposal is not None else None,
        created_at=created_at, updated_at=created_at, **fields,
    )


@pytest.fixture
def seeded(db):
    """An accepted, a rejected and an abandoned conversation for TARGET, with calls and Recordings."""
    tasks = {n: Task(name=n) for n in ("Kept", "Moved", "Resized", "Gone")}
    db.add_all(tasks.values())
    schedule = Schedule(schedule_type="day", target_date=TARGET)
    db.add(schedule)
    db.flush()

    # Times in UTC; TARGET local 09:00 is 14:00 UTC.
    kept = ScheduleItem(schedule=schedule, task_id=tasks["Kept"].id, estimated_duration=1800,
                        scheduled_time=datetime(2026, 11, 20, 14, 0), position=0)
    moved = ScheduleItem(schedule=schedule, task_id=tasks["Moved"].id, estimated_duration=1800,
                         scheduled_time=datetime(2026, 11, 20, 16, 0), position=1)
    resized = ScheduleItem(schedule=schedule, task_id=tasks["Resized"].id, estimated_duration=2700,
                           scheduled_time=datetime(2026, 11, 20, 17, 0), position=2)
    db.add_all([kept, moved, resized])
    db.flush()

    snapshot = [
        {"id": kept.id, "task_id": tasks["Kept"].id,
         "scheduled_time": _iso(datetime(2026, 11, 20, 14, 0)), "estimated_duration": 1800.0},
        {"id": moved.id, "task_id": tasks["Moved"].id,
         "scheduled_time": _iso(datetime(2026, 11, 20, 15, 0)), "estimated_duration": 1800.0},
        {"id": resized.id, "task_id": tasks["Resized"].id,
         "scheduled_time": _iso(datetime(2026, 11, 20, 17, 0)), "estimated_duration": 1800.0},
        {"id": resized.id + 1000, "task_id": tasks["Gone"].id,
         "scheduled_time": _iso(datetime(2026, 11, 20, 19, 0)), "estimated_duration": 1800.0},
    ]
    proposal = {"items": [], "summary": "The plan."}

    accepted = _conversation("accepted", 2, datetime(2026, 11, 19, 12, 0), proposal=proposal,
                             proposed_count=4, accepted_count=4, accepted_items=json.dumps(snapshot),
                             closed_at=datetime(2026, 11, 19, 12, 10), rating="up")
    rejected = _conversation("rejected", 4, datetime(2026, 11, 19, 13, 0), proposal=proposal,
                             proposed_count=3, closed_at=datetime(2026, 11, 19, 13, 10))
    abandoned = _conversation("abandoned", 1, datetime(2026, 11, 20, 1, 0))
    db.add_all([accepted, rejected, abandoned])
    db.flush()

    db.add_all([
        _call(accepted, 0.010, 1000, 1000, 500, 0, 100),
        _call(accepted, 0.020, 2000, 1200, None, 400, 150),
        _call(rejected, 0.030, 3000, 900, 0, 300, 80),
        _call(abandoned, 0.004, 600, 0, None, None, 0, stop_reason="error"),
    ])

    def recording(task, start_utc):
        db.add(StopwatchSession(name="Rec", duration=1800, task_id=task.id, notes="private",
                                start_time=start_utc, end_time=start_utc, created_at=start_utc))

    # 21:00 local on TARGET (02:00 UTC next day): counts.
    recording(tasks["Kept"], datetime(2026, 11, 21, 2, 0))
    # 22:00 local the day before TARGET (03:00 UTC on TARGET): does not count.
    recording(tasks["Moved"], datetime(2026, 11, 20, 3, 0))
    # 10:00 local on TARGET: counts.
    recording(tasks["Resized"], datetime(2026, 11, 20, 15, 0))
    db.commit()
    return {"accepted": accepted.id, "rejected": rejected.id, "abandoned": abandoned.id}


def _by_id(report, conv_id):
    rows = [r for r in report["conversations"] if r["id"] == conv_id]
    assert len(rows) == 1, f"conversation {conv_id} not in report exactly once"
    return rows[0]


def test_totals(db, seeded, metrics):
    totals = metrics.build_report(db, None)["totals"]
    assert totals["conversations"] == 3
    assert totals["by_status"]["accepted"] == 1
    assert totals["by_status"]["rejected"] == 1
    assert totals["by_status"]["abandoned"] == 1
    assert totals["by_status"]["open"] == 0
    assert totals["calls"] == 4
    assert totals["input_tokens"] == 3100
    assert totals["cache_creation_input_tokens"] == 500
    assert totals["cache_read_input_tokens"] == 700
    assert totals["output_tokens"] == 330
    assert totals["cost_usd"] == pytest.approx(0.064)
    assert totals["avg_cost_per_conversation"] == pytest.approx(0.064 / 3)
    assert totals["avg_cost_per_accepted"] == pytest.approx(0.064)
    assert totals["avg_turns_to_first_proposal"] == pytest.approx(3.0)
    assert totals["avg_latency_ms"] == pytest.approx(1650.0)


def test_accepted_conversation_derived_counts(db, seeded, metrics):
    row = _by_id(metrics.build_report(db, None), seeded["accepted"])
    assert row["kept"] == 1
    assert row["edited"] == 2
    assert row["deleted"] == 1
    assert row["recorded"] == 2


def test_conversations_without_accepted_items_have_no_derived_counts(db, seeded, metrics):
    report = metrics.build_report(db, None)
    for key in ("rejected", "abandoned"):
        row = _by_id(report, seeded[key])
        for name in DERIVED:
            assert row[name] in (0, None), f"{key} {name} = {row[name]!r}"


def test_conversation_rows_carry_every_column(db, seeded, metrics):
    report = metrics.build_report(db, None)
    assert len(report["conversations"]) == 3
    for row in report["conversations"]:
        for name in CONVERSATION_COLUMNS + DERIVED:
            assert name in row, f"conversation row missing {name}"
    assert {r["status"] for r in report["conversations"]} == {"accepted", "rejected", "abandoned"}
    assert len(report["calls"]) == 4
    for row in report["calls"]:
        for name in CALL_COLUMNS:
            assert name in row, f"call row missing {name}"


def test_derived_counts_follow_live_changes(db, seeded, metrics):
    item = db.query(ScheduleItem).filter(ScheduleItem.estimated_duration == 2700).one()
    item.estimated_duration = 1800
    db.commit()
    row = _by_id(metrics.build_report(db, None), seeded["accepted"])
    assert (row["kept"], row["edited"], row["deleted"]) == (2, 1, 1)

    db.delete(db.query(ScheduleItem).filter(ScheduleItem.id == item.id).one())
    db.commit()
    row = _by_id(metrics.build_report(db, None), seeded["accepted"])
    assert (row["kept"], row["edited"], row["deleted"]) == (1, 1, 2)
    assert row["recorded"] == 2


def test_since_limits_conversations_and_their_calls(db, seeded, metrics):
    old = _conversation("rejected", 3, datetime(2026, 10, 1, 9, 0), proposal={"items": [], "summary": ""})
    db.add(old)
    db.flush()
    db.add(_call(old, 1.0, 9000, 5000, 0, 0, 500))
    db.commit()

    everything = metrics.build_report(db, None)
    assert everything["totals"]["conversations"] == 4
    assert everything["totals"]["calls"] == 5

    recent = metrics.build_report(db, date(2026, 11, 1))
    totals = recent["totals"]
    assert totals["conversations"] == 3
    assert totals["by_status"]["rejected"] == 1
    assert totals["calls"] == 4
    assert totals["cost_usd"] == pytest.approx(0.064)
    assert old.id not in {r["id"] for r in recent["conversations"]}
    assert all(r["conversation_id"] != old.id for r in recent["calls"])

    on_the_day = metrics.build_report(db, date(2026, 11, 20))
    assert [r["id"] for r in on_the_day["conversations"]] == [seeded["abandoned"]]


def test_empty_database(db, metrics):
    report = metrics.build_report(db, None)
    assert report["totals"]["conversations"] == 0
    assert report["totals"]["calls"] == 0
    assert report["conversations"] == []
    assert report["calls"] == []


def _use_test_db(monkeypatch, metrics):
    monkeypatch.setattr(app.database, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr(metrics, "SessionLocal", TestingSessionLocal, raising=False)


def _read_csv(path):
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        return reader.fieldnames, list(reader)


def test_csv_writes_both_files(seeded, metrics, monkeypatch, tmp_path, capsys):
    _use_test_db(monkeypatch, metrics)
    base = tmp_path / "out"
    metrics.main(["--csv", str(base)])
    assert capsys.readouterr().out.strip()

    header, rows = _read_csv(f"{base}-conversations.csv")
    for name in CONVERSATION_COLUMNS + DERIVED:
        assert name in header, f"conversations CSV missing {name}"
    assert len(rows) == 3
    accepted = [r for r in rows if r["id"] == str(seeded["accepted"])]
    assert len(accepted) == 1
    assert (accepted[0]["kept"], accepted[0]["edited"], accepted[0]["deleted"], accepted[0]["recorded"]) == ("1", "2", "1", "2")

    header, rows = _read_csv(f"{base}-calls.csv")
    for name in CALL_COLUMNS:
        assert name in header, f"calls CSV missing {name}"
    assert len(rows) == 4


def test_csv_respects_since(seeded, metrics, monkeypatch, tmp_path, capsys):
    _use_test_db(monkeypatch, metrics)
    base = tmp_path / "recent"
    metrics.main(["--since", "2026-11-20", "--csv", str(base)])
    _, conversations = _read_csv(f"{base}-conversations.csv")
    _, calls = _read_csv(f"{base}-calls.csv")
    assert [r["id"] for r in conversations] == [str(seeded["abandoned"])]
    assert [r["conversation_id"] for r in calls] == [str(seeded["abandoned"])]


def test_without_csv_prints_and_writes_nothing(seeded, metrics, monkeypatch, tmp_path, capsys):
    _use_test_db(monkeypatch, metrics)
    monkeypatch.chdir(tmp_path)
    metrics.main([])
    out = capsys.readouterr().out
    assert "accepted" in out
    assert str(seeded["accepted"]) in out
    assert list(tmp_path.iterdir()) == []


def test_runs_as_a_script_from_backend():
    result = subprocess.run([sys.executable, SCRIPT, "--help"], cwd=BACKEND,
                            capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    assert "--since" in result.stdout
    assert "--csv" in result.stdout
