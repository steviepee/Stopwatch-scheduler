"""
Tests for B60.tests: the Coaching conversation engine (D93, D95, D99, D100, D102, D105, D115,
D116, D118, D119, D121, D123-D131).

Contract: prd.md, B60.tests. Choices this file pins that the PRD leaves open:
  - The model is reached only through `app.services.coach_model.call_model(system, messages,
    tools)`, looked up on the module at call time (`coach_model.call_model(...)`, not a
    `from ... import call_model`), so monkeypatching the module attribute replaces it. `system`
    is a str; `messages` is a list of `{"role", "content"}` dicts; `tools` is a list of dicts with
    `name` and `strict`.
  - The current time is read through `app.services.coach_context.now_utc()`, a naive UTC datetime
    like `app.database.utcnow()`, also looked up on the module at call time. The past-date check,
    the time line on each message, and the before-now check all use it.
  - The fake responses are shaped like the SDK's `Message`: `.content` (blocks with `.type`,
    `.text` / `.id`, `.name`, `.input`, and `model_dump()`), `.stop_reason`, `.usage`. The engine
    runs the usual tool loop: every `tool_use` gets its `tool_result` (a `role: user` message, its
    own `coach_messages` row with null `visible_text`) in the next call within the same user
    message, and the loop ends on a response whose `stop_reason` is `end_turn`, or at 4 calls.
  - The opening call sends a `role: user` message holding the time line, stored with null
    `visible_text`, so it is not a visible user message and does not count toward any limit.
  - Conversation response: `id`, `status`, `messages` (visible ones only, each with `role` and
    `visible_text`), `proposal` (null or `{items, summary}`, each item keeping the tool's fields,
    `start` as local `HH:MM`), `changes_left`, `messages_left`, `day_items`, `note_suggestion`.
  - Existing events come from `GoogleCalendarService.get_events_for_date` (or `_for_range`),
    patched on the class, so a per-request instance and a shared one both see the fake.
  - An SDK exception is a real `anthropic.APIConnectionError` raised by the fake. This file
    imports `anthropic` for that exception class only; it makes no model access.
  - `typical_seconds` is tested on an Activity whose average and median are equal, so either
    choice passes.

Service imports are inside fixtures and tests so each test fails on its own before B60.impl.
"""
import argparse
import copy
import itertools
import json
import os
import re
from datetime import datetime

import anthropic
import httpx
import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient

from app.main import app
from app.services.google_calendar import GoogleCalendarService

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMPT_PATH = os.path.join(BACKEND_DIR, "app", "prompts", "coach_system.md")
CONV_URL = "/api/coach/conversations"
DISPLAY_URL = "/api/settings/display"
B59_REVISION = "4f7a1c9e2b6d"

TZ = 360  # UTC-6, JS getTimezoneOffset convention
NOW = datetime(2026, 11, 20, 15, 0)  # 09:00 local on 2026-11-20
TODAY = "2026-11-20"
FUTURE = "2026-11-21"
OTHER_FUTURE = "2026-11-22"
PAST = "2026-11-19"
MUST_PROPOSE = "[App: This is the user's 6th message. You must call propose_plan now.]"


# --- Fake model -----------------------------------------------------------------------------

class Block:
    def __init__(self, **fields):
        self._fields = fields
        for key, value in fields.items():
            setattr(self, key, value)

    def model_dump(self, **kwargs):
        return copy.deepcopy(self._fields)


class Usage:
    def __init__(self, input_tokens=1000, output_tokens=100, cache_read_input_tokens=500,
                 cache_creation_input_tokens=200):
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.cache_read_input_tokens = cache_read_input_tokens
        self.cache_creation_input_tokens = cache_creation_input_tokens

    def model_dump(self, **kwargs):
        return dict(vars(self))


class Message:
    def __init__(self, content, stop_reason):
        self.id = "msg_fake"
        self.type = "message"
        self.role = "assistant"
        self.model = "claude-sonnet-5-5"
        self.content = content
        self.stop_reason = stop_reason
        self.usage = Usage()

    def model_dump(self, **kwargs):
        return {
            "id": self.id, "type": self.type, "role": self.role, "model": self.model,
            "content": [b.model_dump() for b in self.content],
            "stop_reason": self.stop_reason, "usage": self.usage.model_dump(),
        }


_tool_ids = itertools.count(1)


def reply(text):
    return Message([Block(type="text", text=text)], "end_turn")


def _tool(name, tool_input, text=None):
    content = [Block(type="text", text=text)] if text else []
    content.append(Block(type="tool_use", id=f"toolu_{next(_tool_ids)}", name=name, input=tool_input))
    return Message(content, "tool_use")


def propose(items, summary="The plan.", text=None):
    return _tool("propose_plan", {"items": items, "summary": summary}, text)


def suggest(note_text):
    return _tool("suggest_note", {"text": note_text})


def item(task_id=None, start="09:00", minutes=30, is_frog=False, new=None, source="history",
         reason="It follows your Recordings."):
    return {
        "task_id": task_id, "new_activity_name": new, "start": start,
        "duration_minutes": minutes, "is_frog": is_frog, "source": source, "reason": reason,
    }


class FakeModel:
    def __init__(self):
        self.script = []
        self.calls = []

    def queue(self, *responses):
        self.script.extend(responses)

    def __call__(self, system, messages, tools, **kwargs):
        self.calls.append({
            "system": copy.deepcopy(system),
            "messages": copy.deepcopy(messages),
            "tools": copy.deepcopy(tools),
        })
        response = self.script.pop(0) if self.script else reply("OK.")
        if isinstance(response, Exception):
            raise response
        return response


@pytest.fixture(autouse=True)
def no_google(monkeypatch):
    monkeypatch.setattr(GoogleCalendarService, "_load_credentials", lambda self: None)
    monkeypatch.setattr(GoogleCalendarService, "is_authenticated", lambda self: False)


@pytest.fixture
def fake(monkeypatch):
    model = FakeModel()
    monkeypatch.setattr("app.services.coach_model.call_model", model)
    monkeypatch.setattr("app.services.coach_context.now_utc", lambda: NOW)
    return model


@pytest.fixture
def google(monkeypatch):
    def set_events(events):
        monkeypatch.setattr(GoogleCalendarService, "is_authenticated", lambda self: True)
        monkeypatch.setattr(
            GoogleCalendarService, "get_events_for_date",
            lambda self, date_str, tz_offset=0: copy.deepcopy(events),
        )
        monkeypatch.setattr(
            GoogleCalendarService, "get_events_for_range",
            lambda self, start, end, tz_offset=0: [dict(e, day=start) for e in copy.deepcopy(events)],
        )
    return set_events


DENTIST = {"id": "evt-1", "summary": "Dentist", "start": "2026-11-21T10:00:00-06:00", "end": "2026-11-21T11:00:00-06:00"}
BIRTHDAY = {"id": "evt-2", "summary": "Mom's birthday", "start": "2026-11-21", "end": "2026-11-22"}


# --- Helpers --------------------------------------------------------------------------------

def _task(client, name, **body):
    r = client.post("/api/tasks/", json={"name": name, **body})
    assert r.status_code == 200
    return r.json()


def _record(client, db, task_id, seconds, start_utc, name="Rec", notes=None):
    r = client.post("/api/sessions/", json={
        "name": name, "duration": seconds, "task_id": task_id, "notes": notes,
        "start_time": start_utc.isoformat() + "Z",
    })
    assert r.status_code == 200
    stamp = start_utc.isoformat(sep=" ")
    db.execute(sa.text("UPDATE stopwatch_sessions SET created_at = :t WHERE id = :id"), {"t": stamp, "id": r.json()["id"]})
    db.execute(sa.text("UPDATE time_logs SET created_at = :t WHERE session_id = :id"), {"t": stamp, "id": r.json()["id"]})
    db.commit()
    return r.json()


def _place(client, task_id, day, utc_time, seconds=1800, is_frog=False):
    r = client.post(f"/api/schedules/days/{day}/items", json={
        "task_id": task_id, "scheduled_time": utc_time, "estimated_duration": seconds, "is_frog": is_frog,
    })
    assert r.status_code == 200
    return r.json()


def _open(client, day=FUTURE, tz_offset=TZ):
    r = client.post(CONV_URL, json={"target_date": day, "tz_offset": tz_offset})
    assert r.status_code == 200, r.text
    return r.json()


def _say(client, conv_id, text, expect=200):
    r = client.post(f"{CONV_URL}/{conv_id}/messages", json={"text": text})
    assert r.status_code == expect, r.text
    return r.json()


def _text(content):
    if isinstance(content, str):
        return content
    return "\n".join(b["text"] for b in content if b.get("type") == "text")


def _visible(message):
    return message.get("visible_text", message.get("text"))


def _last_assistant(conv):
    return _visible([m for m in conv["messages"] if m["role"] == "assistant"][-1])


def _sent_user_message(call, typed):
    users = [m for m in call["messages"] if m["role"] == "user" and typed in _text(m["content"])]
    assert users, f"no user message containing {typed!r} was sent"
    return _text(users[-1]["content"])


def _tool_results(call):
    last = call["messages"][-1]
    assert last["role"] == "user"
    assert isinstance(last["content"], list)
    return [b for b in last["content"] if b.get("type") == "tool_result"]


def _result_text(block):
    content = block.get("content")
    return content if isinstance(content, str) else json.dumps(content)


def _context(db, conv_id):
    return db.execute(sa.text("SELECT context FROM coach_conversations WHERE id = :id"), {"id": conv_id}).scalar_one()


def _rows(db, conv_id):
    return db.execute(
        sa.text("SELECT role, content, visible_text FROM coach_messages WHERE conversation_id = :id ORDER BY id"),
        {"id": conv_id},
    ).all()


def _set_status(db, conv_id, status):
    db.execute(sa.text("UPDATE coach_conversations SET status = :s WHERE id = :id"), {"s": status, "id": conv_id})
    db.commit()


def _prompt():
    with open(PROMPT_PATH, encoding="utf-8") as f:
        return f.read()


# --- Open or resume -------------------------------------------------------------------------

def test_open_creates_and_makes_one_call(client, fake):
    fake.queue(reply("What do you need to get done?"))
    conv = _open(client)
    assert len(fake.calls) == 1
    assert conv["status"] == "open"
    assert conv["proposal"] is None
    assert [(m["role"], _visible(m)) for m in conv["messages"]] == [("assistant", "What do you need to get done?")]


def test_reopening_the_same_date_returns_it_with_no_call(client, fake):
    first = _open(client)
    again = _open(client)
    assert again["id"] == first["id"]
    assert again["messages"] == first["messages"]
    assert len(fake.calls) == 1


def test_another_date_gets_its_own_conversation(client, fake):
    first = _open(client, FUTURE)
    other = _open(client, OTHER_FUTURE)
    assert other["id"] != first["id"]
    assert len(fake.calls) == 2


def test_closed_conversation_is_not_resumed(client, fake, db):
    first = _open(client)
    _set_status(db, first["id"], "abandoned")
    assert _open(client)["id"] != first["id"]


def test_past_date_is_422_with_no_call(client, fake):
    r = client.post(CONV_URL, json={"target_date": PAST, "tz_offset": TZ})
    assert r.status_code == 422
    assert fake.calls == []


def test_today_is_judged_in_the_callers_offset(client, fake, monkeypatch):
    monkeypatch.setattr("app.services.coach_context.now_utc", lambda: datetime(2026, 11, 21, 3, 0))
    # 21:00 on 2026-11-20 local: the 20th is still today, the 19th is past
    assert client.post(CONV_URL, json={"target_date": TODAY, "tz_offset": TZ}).status_code == 200
    assert client.post(CONV_URL, json={"target_date": PAST, "tz_offset": TZ}).status_code == 422


# --- Context and system prompt --------------------------------------------------------------

@pytest.fixture
def rich_day(client, db, google):
    guitar = _task(client, "Guitar", is_urgent=True, is_important=True)
    for seconds, day in [(600, 16), (1200, 17), (3600, 18)]:
        _record(client, db, guitar["id"], seconds, datetime(2026, 11, day, 16, 0),
                name="SECRET-REC-NAME", notes="SECRET-REC-NOTE")
    tango = _task(client, "Tango", intended_length=2700)
    piano = _task(client, "Piano")
    _record(client, db, piano["id"], 900, datetime(2026, 10, 1, 16, 0))
    r = client.post("/api/time-logs/", json={"task_id": guitar["id"], "duration": 600, "notes": "SECRET-LOG-NOTE"})
    assert r.status_code == 200
    laundry = _task(client, "Laundry")
    _place(client, laundry["id"], FUTURE, "2026-11-21T14:00:00Z", is_frog=True)
    r = client.post("/api/coach/notes", json={"text": "Mornings are for hard work"})
    assert r.status_code == 200
    google([DENTIST])
    return {"guitar": guitar, "tango": tango, "piano": piano, "laundry": laundry}


def test_context_holds_each_piece(client, fake, db, rich_day):
    conv = _open(client)
    ctx = _context(db, conv["id"])
    lines = ctx.split("\n")
    assert lines[0] == f"Planned dates: {FUTURE}"
    assert lines[1] == "Clock: 12-hour"
    for name in ["Guitar", "Tango", "Piano", "Laundry"]:
        assert name in ctx
    assert "Dentist" in ctx
    assert "Mornings are for hard work" in ctx
    assert "frog" in ctx.lower()
    assert "peak" in ctx.lower()
    assert "2026-11-18" in ctx  # a Recording's local date
    assert "2026-10-01" not in ctx  # older than 14 days


def test_system_is_the_prompt_file_then_the_context(client, fake, db, rich_day):
    conv = _open(client)
    system = fake.calls[0]["system"]
    ctx = _context(db, conv["id"])
    prompt = _prompt()
    assert system.startswith(prompt)
    assert system.endswith(ctx)
    assert system[len(prompt):len(system) - len(ctx)].strip() == ""


def test_no_recording_names_or_notes_reach_the_model(client, fake, db, rich_day):
    conv = _open(client)
    fake.queue(reply("Fine."))
    _say(client, conv["id"], "Plan my day")
    sent = json.dumps(fake.calls)
    for secret in ["SECRET-REC-NAME", "SECRET-REC-NOTE", "SECRET-LOG-NOTE"]:
        assert secret not in sent


def test_context_says_google_is_not_authorized(client, fake, db):
    conv = _open(client)
    ctx = _context(db, conv["id"])
    assert any(re.search(r"google", line, re.I) and re.search(r"\bnot\b", line, re.I) for line in ctx.split("\n"))


def test_tools_are_propose_plan_and_suggest_note_strict(client, fake):
    _open(client)
    tools = fake.calls[0]["tools"]
    assert sorted(t["name"] for t in tools) == ["propose_plan", "suggest_note"]
    assert all(t.get("strict") is True for t in tools)


def test_notes_off_drops_notes_and_suggest_note(client, fake, db):
    client.post("/api/coach/notes", json={"text": "Mornings are for hard work"})
    assert client.put("/api/settings/coach", json={"notes_enabled": False}).status_code == 200
    conv = _open(client)
    assert "Mornings are for hard work" not in _context(db, conv["id"])
    assert "Mornings are for hard work" not in fake.calls[0]["system"]
    assert [t["name"] for t in fake.calls[0]["tools"]] == ["propose_plan"]


def test_context_is_fixed_at_open(client, fake, db):
    laundry = _task(client, "Laundry")
    conv = _open(client)
    stored = _context(db, conv["id"])
    _place(client, laundry["id"], FUTURE, "2026-11-21T14:00:00Z")
    _say(client, conv["id"], "Anything new?")
    assert fake.calls[1]["system"] == fake.calls[0]["system"]
    assert _context(db, conv["id"]) == stored


def test_clock_24h_names_the_24_hour_clock(client, fake, db):
    assert client.put(DISPLAY_URL, json={"clock_24h": True}).status_code == 200
    conv = _open(client)
    assert _context(db, conv["id"]).split("\n")[1] == "Clock: 24-hour"


def test_earlier_conversations_never_reach_the_model(client, fake, db):
    fake.queue(reply("ALPHA-COACH-REPLY"))
    alpha = _open(client, FUTURE)
    _say(client, alpha["id"], "ALPHA-USER-WORDS")
    _set_status(db, alpha["id"], "abandoned")
    fake.queue(reply("BETA-COACH-REPLY"))
    beta = _open(client, OTHER_FUTURE)
    _say(client, beta["id"], "BETA-USER-WORDS")

    start = len(fake.calls)
    gamma = _open(client, FUTURE)
    assert gamma["id"] != alpha["id"]
    _say(client, gamma["id"], "Plan it")
    sent = json.dumps(fake.calls[start:])
    for secret in ["ALPHA-COACH-REPLY", "ALPHA-USER-WORDS", "BETA-COACH-REPLY", "BETA-USER-WORDS"]:
        assert secret not in sent
    assert sorted(t["name"] for t in fake.calls[-1]["tools"]) == ["propose_plan", "suggest_note"]


# --- Current time on each message -----------------------------------------------------------

def test_each_message_starts_with_the_local_date_and_time(client, fake):
    conv = _open(client)
    opening = _text(fake.calls[0]["messages"][0]["content"]).split("\n")[0]
    assert TODAY in opening and re.search(r"\b0?9:00\b", opening)

    after = _say(client, conv["id"], "Plan my day")
    first_line = _sent_user_message(fake.calls[1], "Plan my day").split("\n")[0]
    assert TODAY in first_line and re.search(r"\b0?9:00\b", first_line)
    users = [m for m in after["messages"] if m["role"] == "user"]
    assert [_visible(m) for m in users] == ["Plan my day"]


def test_item_before_now_is_refused_today(client, fake):
    walk = _task(client, "Walk")
    conv = _open(client, TODAY)
    fake.queue(
        propose([item(walk["id"], start="08:00")]),
        propose([item(walk["id"], start="10:00")]),
        reply("Here it is."),
    )
    n = len(fake.calls)
    after = _say(client, conv["id"], "Plan today")
    errors = _tool_results(fake.calls[n + 1])
    assert len(errors) == 1 and errors[0].get("is_error") is True
    assert [i["start"] for i in after["proposal"]["items"]] == ["10:00"]


def test_the_same_early_item_on_a_future_date_is_stored(client, fake):
    walk = _task(client, "Walk")
    conv = _open(client, FUTURE)
    fake.queue(propose([item(walk["id"], start="08:00")]), reply("Here it is."))
    n = len(fake.calls)
    after = _say(client, conv["id"], "Plan tomorrow")
    assert all(b.get("is_error") is not True for b in _tool_results(fake.calls[n + 1]))
    assert [i["start"] for i in after["proposal"]["items"]] == ["08:00"]


# --- Proposal validation --------------------------------------------------------------------

def test_overlap_gets_an_error_naming_it_and_the_fix_is_stored(client, fake):
    read = _task(client, "Reading")
    run = _task(client, "Running")
    conv = _open(client)
    first = propose([item(read["id"], "09:00", 60), item(run["id"], "09:30", 30)])
    fake.queue(first, propose([item(read["id"], "09:00", 60), item(run["id"], "10:00", 30)]), reply("Done."))
    n = len(fake.calls)
    after = _say(client, conv["id"], "Reading and a run")

    errors = _tool_results(fake.calls[n + 1])
    assert len(errors) == 1
    assert errors[0]["tool_use_id"] == first.content[-1].id
    assert errors[0].get("is_error") is True
    text = _result_text(errors[0])
    assert re.search(r"overlap|clash|conflict", text, re.I)
    assert "Reading" in text or "Running" in text
    assert [i["start"] for i in after["proposal"]["items"]] == ["09:00", "10:00"]
    assert after["changes_left"] == 3


def test_three_bad_proposals_store_nothing(client, fake):
    read = _task(client, "Reading")
    conv = _open(client)
    bad = [item(read["id"], "09:00", 60), item(read["id"], "09:30", 60)]
    fake.queue(propose(bad), propose(bad), propose(bad), reply("I could not fit the plan."))
    n = len(fake.calls)
    after = _say(client, conv["id"], "Two hours of reading")
    assert len(fake.calls) - n <= 4
    assert after["proposal"] is None
    assert "fit" in _last_assistant(after).lower()
    assert after["changes_left"] is None


def test_clash_with_an_existing_block_is_refused(client, fake):
    laundry = _task(client, "Laundry")
    read = _task(client, "Reading")
    _place(client, laundry["id"], FUTURE, "2026-11-21T14:00:00Z", seconds=1800)  # 08:00-08:30 local
    conv = _open(client)
    fake.queue(propose([item(read["id"], "08:15", 30)]), propose([item(read["id"], "08:30", 30)]), reply("Ok."))
    n = len(fake.calls)
    after = _say(client, conv["id"], "Reading")
    assert _tool_results(fake.calls[n + 1])[0].get("is_error") is True
    assert [i["start"] for i in after["proposal"]["items"]] == ["08:30"]


def test_clash_with_a_timed_event_is_refused(client, fake, google):
    google([DENTIST])
    read = _task(client, "Reading")
    conv = _open(client)
    fake.queue(propose([item(read["id"], "10:30", 30)]), propose([item(read["id"], "11:00", 30)]), reply("Ok."))
    n = len(fake.calls)
    after = _say(client, conv["id"], "Reading")
    assert _tool_results(fake.calls[n + 1])[0].get("is_error") is True
    assert [i["start"] for i in after["proposal"]["items"]] == ["11:00"]


def test_all_day_event_never_clashes(client, fake, google):
    google([BIRTHDAY])
    read = _task(client, "Reading")
    conv = _open(client)
    fake.queue(propose([item(read["id"], "09:00", 30)]), reply("Ok."))
    n = len(fake.calls)
    after = _say(client, conv["id"], "Reading")
    assert all(b.get("is_error") is not True for b in _tool_results(fake.calls[n + 1]))
    assert [i["start"] for i in after["proposal"]["items"]] == ["09:00"]


def test_item_past_the_end_of_the_day_is_refused(client, fake):
    read = _task(client, "Reading")
    conv = _open(client)
    fake.queue(propose([item(read["id"], "23:30", 60)]), propose([item(read["id"], "22:30", 60)]), reply("Ok."))
    n = len(fake.calls)
    after = _say(client, conv["id"], "Late reading")
    assert _tool_results(fake.calls[n + 1])[0].get("is_error") is True
    assert [i["start"] for i in after["proposal"]["items"]] == ["22:30"]


def test_unknown_task_id_is_refused(client, fake):
    read = _task(client, "Reading")
    conv = _open(client)
    fake.queue(propose([item(9999, "09:00", 30)]), propose([item(read["id"], "09:00", 30)]), reply("Ok."))
    n = len(fake.calls)
    after = _say(client, conv["id"], "Reading")
    assert _tool_results(fake.calls[n + 1])[0].get("is_error") is True
    assert [i["task_id"] for i in after["proposal"]["items"]] == [read["id"]]


def test_frog_refused_on_a_day_that_has_one(client, fake):
    laundry = _task(client, "Laundry")
    read = _task(client, "Reading")
    _place(client, laundry["id"], FUTURE, "2026-11-21T14:00:00Z", seconds=600, is_frog=True)
    conv = _open(client)
    fake.queue(
        propose([item(read["id"], "10:00", 30, is_frog=True)]),
        propose([item(read["id"], "10:00", 30)]),
        reply("Ok."),
    )
    n = len(fake.calls)
    after = _say(client, conv["id"], "Reading as my frog")
    error = _tool_results(fake.calls[n + 1])[0]
    assert error.get("is_error") is True
    assert "frog" in _result_text(error).lower()
    assert [i["is_frog"] for i in after["proposal"]["items"]] == [False]


def test_two_frogs_refused(client, fake):
    read = _task(client, "Reading")
    run = _task(client, "Running")
    conv = _open(client)
    fake.queue(
        propose([item(read["id"], "09:00", 30, is_frog=True), item(run["id"], "10:00", 30, is_frog=True)]),
        propose([item(read["id"], "09:00", 30, is_frog=True), item(run["id"], "10:00", 30)]),
        reply("Ok."),
    )
    n = len(fake.calls)
    after = _say(client, conv["id"], "Both are frogs")
    error = _tool_results(fake.calls[n + 1])[0]
    assert error.get("is_error") is True
    assert "frog" in _result_text(error).lower()
    assert [i["is_frog"] for i in after["proposal"]["items"]] == [True, False]


def test_stored_items_keep_source_and_reason_and_gain_history(client, fake, db):
    guitar = _task(client, "Guitar")
    for seconds, day in [(600, 16), (1200, 17), (1800, 18)]:
        _record(client, db, guitar["id"], seconds, datetime(2026, 11, day, 16, 0))
    conv = _open(client)
    fake.queue(propose([
        item(guitar["id"], "09:00", 20, source="history", reason="Your Guitar sittings run about 20 minutes."),
        item(None, "10:00", 30, new="Tango", source="you_said", reason="You asked for 30 minutes of tango."),
    ]), reply("Ok."))
    after = _say(client, conv["id"], "Guitar and tango")
    existing, new = after["proposal"]["items"]
    assert existing["source"] == "history"
    assert existing["reason"] == "Your Guitar sittings run about 20 minutes."
    assert existing["recording_count"] == 3
    assert existing["typical_seconds"] == pytest.approx(1200)
    assert new["new_activity_name"] == "Tango"
    assert new["source"] == "you_said"
    assert new["reason"] == "You asked for 30 minutes of tango."
    assert new.get("recording_count") is None


def test_suggest_note_comes_back_pending_and_is_not_saved(client, fake):
    conv = _open(client)
    fake.queue(suggest("I can't focus after a long bike ride."), reply("Want me to remember that?"))
    after = _say(client, conv["id"], "I biked 50 miles, can't focus after that")
    ns = after["note_suggestion"]
    assert (ns.get("text") if isinstance(ns, dict) else ns) == "I can't focus after a long bike ride."
    assert client.get("/api/coach/notes").json() == []


# --- Whole day ------------------------------------------------------------------------------

def test_day_items_list_events_and_blocks_in_time_order(client, fake, db, google):
    google([DENTIST, BIRTHDAY])
    laundry = _task(client, "Laundry")
    guitar = _task(client, "Guitar")
    _place(client, laundry["id"], FUTURE, "2026-11-21T14:00:00Z", seconds=1800)  # 08:00 local
    pushed = _place(client, guitar["id"], FUTURE, "2026-11-21T18:00:00Z", seconds=1800)  # 12:00 local
    db.execute(sa.text("UPDATE schedule_items SET calendar_event_id = 'evt-9' WHERE id = :id"), {"id": pushed["id"]})
    db.commit()

    day = _open(client)["day_items"]
    timed = [(d["kind"], d["name"], d["on_google"]) for d in day if not d["all_day"]]
    assert timed == [("block", "Laundry", False), ("event", "Dentist", True), ("block", "Guitar", True)]
    all_day = [(d["kind"], d["name"], d["on_google"]) for d in day if d["all_day"]]
    assert all_day == [("event", "Mom's birthday", True)]
    assert all({"start", "end"} <= set(d) for d in day)


# --- Turn rules -----------------------------------------------------------------------------

def test_sixth_message_must_propose_and_counters_start_after_the_proposal(client, fake):
    read = _task(client, "Reading")
    conv = _open(client)
    for i in range(1, 6):
        after = _say(client, conv["id"], f"message {i}")
        assert MUST_PROPOSE not in _sent_user_message(fake.calls[-1], f"message {i}")
        assert after["changes_left"] is None and after["messages_left"] is None

    fake.queue(propose([item(read["id"], "09:00", 30)]), reply("Here is a plan."))
    n = len(fake.calls)
    after = _say(client, conv["id"], "message 6")
    sent = _sent_user_message(fake.calls[n], "message 6")
    assert sent.split("\n")[-1] == MUST_PROPOSE
    assert _visible([m for m in after["messages"] if m["role"] == "user"][-1]) == "message 6"
    assert after["changes_left"] == 3
    assert after["messages_left"] == 6

    after = _say(client, conv["id"], "Why 9?")
    assert after["changes_left"] == 3
    assert after["messages_left"] == 5


def test_changes_and_messages_after_a_proposal(client, fake, db):
    read = _task(client, "Reading")
    conv = _open(client)

    def change(label, start):
        fake.queue(propose([item(read["id"], start, 30)], summary=label), reply(f"{label} ready."))

    change("P0", "09:00")
    after = _say(client, conv["id"], "Plan reading")
    assert (after["changes_left"], after["messages_left"]) == (3, 6)

    after = _say(client, conv["id"], "Is that enough?")
    assert (after["changes_left"], after["messages_left"]) == (3, 5)

    for label, start, left in [("P1", "10:00", 2), ("P2", "11:00", 1), ("P3", "12:00", 0)]:
        change(label, start)
        after = _say(client, conv["id"], f"Move it, {label}")
        assert after["proposal"]["summary"] == label
        assert after["changes_left"] == left
    assert after["messages_left"] == 2

    change("P4", "13:00")
    n = len(fake.calls)
    after = _say(client, conv["id"], "Move it again")
    error = _tool_results(fake.calls[n + 1])[0]
    assert error.get("is_error") is True
    assert "limit" in _result_text(error).lower()
    assert after["proposal"]["summary"] == "P3"
    assert (after["changes_left"], after["messages_left"]) == (0, 1)

    after = _say(client, conv["id"], "Ok, last question")
    assert after["messages_left"] == 0

    n = len(fake.calls)
    r = client.post(f"{CONV_URL}/{conv['id']}/messages", json={"text": "One more?"})
    assert r.status_code == 409
    assert r.json()["detail"] == "message limit reached"
    assert len(fake.calls) == n


def test_failed_revision_does_not_use_a_change(client, fake):
    read = _task(client, "Reading")
    conv = _open(client)
    fake.queue(propose([item(read["id"], "09:00", 30)]), reply("Ok."))
    _say(client, conv["id"], "Plan reading")
    fake.queue(
        propose([item(read["id"], "10:00", 60), item(read["id"], "10:30", 30)]),
        propose([item(read["id"], "10:00", 30)]),
        reply("Moved."),
    )
    after = _say(client, conv["id"], "Move it to 10")
    assert after["changes_left"] == 2


def test_message_to_a_closed_conversation_is_409(client, fake, db):
    conv = _open(client)
    _set_status(db, conv["id"], "abandoned")
    n = len(fake.calls)
    r = client.post(f"{CONV_URL}/{conv['id']}/messages", json={"text": "Hello"})
    assert r.status_code == 409
    assert len(fake.calls) == n


@pytest.mark.parametrize("text", ["", "x" * 2001], ids=["empty", "2001-chars"])
def test_message_text_length_is_checked(client, fake, text):
    conv = _open(client)
    assert client.post(f"{CONV_URL}/{conv['id']}/messages", json={"text": text}).status_code == 422


# --- Metrics --------------------------------------------------------------------------------

def test_each_call_writes_one_row_with_tokens_and_cost(client, fake, db):
    from app.services.coach_cost import cost_usd

    read = _task(client, "Reading")
    conv = _open(client)
    fake.queue(propose([item(read["id"], "09:00", 30)]), reply("Ok."))
    _say(client, conv["id"], "Plan reading")
    rows = db.execute(sa.text(
        "SELECT model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, "
        "stop_reason, latency_ms, cost_usd FROM coach_calls WHERE conversation_id = :id ORDER BY id"
    ), {"id": conv["id"]}).all()
    assert len(rows) == len(fake.calls) == 3
    assert [r.stop_reason for r in rows] == ["end_turn", "tool_use", "end_turn"]
    for r in rows:
        assert (r.input_tokens, r.output_tokens, r.cache_read_input_tokens, r.cache_creation_input_tokens) == (1000, 100, 500, 200)
        assert r.latency_ms >= 0
        assert r.cost_usd == pytest.approx(cost_usd(r.model, Usage()))


def test_sdk_exception_is_502_with_an_error_row(client, fake, db):
    conv = _open(client)
    fake.queue(anthropic.APIConnectionError(request=httpx.Request("POST", "https://api.anthropic.com/v1/messages")))
    r = client.post(f"{CONV_URL}/{conv['id']}/messages", json={"text": "Plan my day"})
    assert r.status_code == 502
    assert r.json()["detail"]
    stops = db.execute(sa.text(
        "SELECT stop_reason FROM coach_calls WHERE conversation_id = :id ORDER BY id"
    ), {"id": conv["id"]}).scalars().all()
    assert stops == ["end_turn", "error"]
    assistant = [row for row in _rows(db, conv["id"]) if row.role == "assistant"]
    assert len(assistant) == 1


# --- Append-only replay ---------------------------------------------------------------------

def test_stored_content_replays_unchanged(client, fake, db):
    read = _task(client, "Reading")
    conv = _open(client)
    fake.queue(reply("What matters today?"))
    _say(client, conv["id"], "Reading")
    proposal = propose([item(read["id"], "09:00", 30)], text="Here goes.")
    fake.queue(proposal, reply("Ok."))
    _say(client, conv["id"], "Just reading")

    rows = _rows(db, conv["id"])
    last = fake.calls[-1]["messages"]
    assert [(m["role"], m["content"]) for m in last] == [(r.role, json.loads(r.content)) for r in rows[:-1]]
    for earlier, later in zip(fake.calls, fake.calls[1:]):
        assert later["messages"][:len(earlier["messages"])] == earlier["messages"]

    tool_message = next(r for r in rows if r.role == "assistant" and "tool_use" in r.content)
    assert json.loads(tool_message.content) == [b.model_dump() for b in proposal.content]
    assert tool_message.visible_text == "Here goes."


# --- Display setting ------------------------------------------------------------------------

def test_display_setting_defaults_and_round_trips(client):
    r = client.get(DISPLAY_URL)
    assert r.status_code == 200
    assert r.json() == {"clock_24h": False}
    assert client.put(DISPLAY_URL, json={"clock_24h": True}).json()["clock_24h"] is True
    assert client.get(DISPLAY_URL).json()["clock_24h"] is True


def test_display_put_missing_field_is_422(client):
    assert client.put(DISPLAY_URL, json={}).status_code == 422


@pytest.mark.parametrize("method,url", [
    ("get", DISPLAY_URL),
    ("put", DISPLAY_URL),
    ("post", CONV_URL),
    ("post", f"{CONV_URL}/1/messages"),
])
def test_routes_behind_gate(method, url):
    assert getattr(TestClient(app), method)(url).status_code == 401


# --- Migration ------------------------------------------------------------------------------

def _alembic_cfg(db_url):
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.cmd_opts = argparse.Namespace(x=[f"db_url={db_url}"])
    return cfg


def test_one_revision_on_top_of_the_coach_tables():
    script = ScriptDirectory.from_config(_alembic_cfg("sqlite://"))
    assert len(script.get_heads()) == 1
    assert len(script.get_revision(B59_REVISION).nextrev) == 1


def test_migration_adds_context_and_app_settings(tmp_path):
    db_url = f"sqlite:///{tmp_path}/coach_b60.db"
    command.upgrade(_alembic_cfg(db_url), "head")
    insp = sa.inspect(sa.create_engine(db_url))

    context = {c["name"]: c for c in insp.get_columns("coach_conversations")}["context"]
    assert context["nullable"] is True
    assert isinstance(context["type"], sa.Text)

    clock = {c["name"]: c for c in insp.get_columns("app_settings")}["clock_24h"]
    assert clock["nullable"] is False
    assert clock["default"] is not None


def test_migration_downgrade_drops_context_and_app_settings(tmp_path):
    db_url = f"sqlite:///{tmp_path}/coach_b60_down.db"
    cfg = _alembic_cfg(db_url)
    command.upgrade(cfg, "head")
    command.downgrade(cfg, B59_REVISION)
    insp = sa.inspect(sa.create_engine(db_url))
    assert "app_settings" not in insp.get_table_names()
    assert "context" not in {c["name"] for c in insp.get_columns("coach_conversations")}


# === B61: accept, reject, start over, rating, history ========================================
#
# Contract: prd.md, B61.tests. Choices this section pins that the PRD leaves open:
#   - Accept returns the date's Schedule in the `schemas.Schedule` shape (`target_date`, `items`
#     with `task_id`, `scheduled_time` as UTC with `Z`, `estimated_duration` in seconds, `is_frog`,
#     `calendar_event_id`). A Proposal item's local `start` becomes UTC through the conversation's
#     `tz_offset`; its length is `duration_minutes * 60`.
#   - `accepted_items` is a JSON list of `{id, task_id, scheduled_time, estimated_duration}`, one per
#     placed item, `scheduled_time` as an ISO UTC string.
#   - Every 409 has a `detail` string. A clash on accept names the Activity it clashes with, and
#     nothing is written: no new Activity, no item, the conversation stays `open`.
#   - Reject and rating return 200. Rating an `open` conversation → 409; a value other than
#     up, down, or null → 422.
#   - Start over returns the new conversation in the same shape as open (B60).
#   - List and detail rows: `id`, `target_date`, `status`, `user_turns`, `revision_turns`,
#     `call_count`, `input_tokens`, `output_tokens`, `cache_read_input_tokens`,
#     `cache_creation_input_tokens`, `cost_usd`, `proposed_count`, `accepted_count`, `rating`.
#     Token totals and cost are 0 for a conversation with no calls. Detail adds `messages`
#     (visible, as in B60), `proposal`, and `calls` (every `coach_calls` row, oldest first, with
#     `turn_index`, `model`, `stop_reason`, `latency_ms`, the four token counts, `cost_usd`).
#   - Usage: `{conversations, accepted, cost_usd}`. A conversation belongs to the month of its
#     `created_at` (UTC); the cost is the sum of its calls. The default month is read through
#     `coach_context.now_utc()`. A malformed `month` → 422.

def _proposed(client, fake, items, day=FUTURE):
    conv = _open(client, day)
    fake.queue(propose(items), reply("Here is the plan."))
    after = _say(client, conv["id"], "Plan it")
    assert after["proposal"] is not None
    return after


def _accept(client, conv_id):
    r = client.post(f"{CONV_URL}/{conv_id}/accept")
    assert r.status_code == 200, r.text
    return r.json()


def _tasks_by_name(client):
    return {t["name"]: t for t in client.get("/api/tasks/").json()}


def _day_task_ids(client, day=FUTURE):
    schedules = client.get(f"/api/schedules/?start_date={day}&end_date={day}").json()
    return [i["task_id"] for s in schedules for i in s["items"]]


def _conv_row(db, conv_id):
    db.expire_all()
    return db.execute(sa.text(
        "SELECT status, proposed_count, accepted_count, accepted_items, closed_at, rating "
        "FROM coach_conversations WHERE id = :id"
    ), {"id": conv_id}).one()


@pytest.fixture
def no_push(monkeypatch):
    pushed = []

    def record(kind):
        def fake_call(self, *args, **kwargs):
            pushed.append(kind)
            return {"id": "evt-x"}
        return fake_call

    monkeypatch.setattr(GoogleCalendarService, "create_event", record("create"))
    monkeypatch.setattr(GoogleCalendarService, "update_event", record("update"))
    return pushed


# --- Accept ---------------------------------------------------------------------------------

@pytest.mark.parametrize("source,expected", [("you_said", 1800), ("guess", None), ("history", None)])
def test_new_activity_intended_length_only_when_the_user_said_it(client, fake, source, expected):
    conv = _proposed(client, fake, [item(None, "09:00", 30, new="Tango", source=source, reason="Tango sitting.")])
    _accept(client, conv["id"])
    tango = _tasks_by_name(client)["Tango"]
    assert tango["intended_length"] == expected
    assert tango["total_recordings"] == 0


def test_accept_places_timed_items_and_stores_the_snapshot(client, fake, db, google, no_push):
    google([])
    read = _task(client, "Reading")
    laundry = _task(client, "Laundry")
    _place(client, laundry["id"], FUTURE, "2026-11-21T14:00:00Z", seconds=1800, is_frog=True)  # 08:00 local
    conv = _proposed(client, fake, [
        item(read["id"], "09:00", 45),
        item(None, "10:00", 30, new="Tango", source="you_said", reason="You asked for 30 minutes."),
    ])

    schedule = _accept(client, conv["id"])
    assert schedule["target_date"] == FUTURE
    tango = _tasks_by_name(client)["Tango"]
    by_task = {i["task_id"]: i for i in schedule["items"]}
    assert set(by_task) == {laundry["id"], read["id"], tango["id"]}

    assert by_task[read["id"]]["scheduled_time"].startswith("2026-11-21T15:00:00")
    assert by_task[read["id"]]["scheduled_time"].endswith("Z")
    assert by_task[read["id"]]["estimated_duration"] == 2700
    assert by_task[tango["id"]]["scheduled_time"].startswith("2026-11-21T16:00:00")
    assert by_task[tango["id"]]["estimated_duration"] == 1800

    assert by_task[laundry["id"]]["is_frog"] is True
    assert by_task[read["id"]]["is_frog"] is False and by_task[tango["id"]]["is_frog"] is False

    assert no_push == []
    assert all(i["calendar_event_id"] is None for i in schedule["items"])

    row = _conv_row(db, conv["id"])
    assert row.status == "accepted"
    assert row.closed_at is not None
    assert row.proposed_count == 2
    assert row.accepted_count == 2
    snapshot = json.loads(row.accepted_items)
    placed = [by_task[read["id"]], by_task[tango["id"]]]
    assert sorted((s["id"], s["task_id"], s["estimated_duration"]) for s in snapshot) == \
        sorted((p["id"], p["task_id"], p["estimated_duration"]) for p in placed)
    times = {s["task_id"]: s["scheduled_time"] for s in snapshot}
    assert times[read["id"]].startswith("2026-11-21T15:00:00")
    assert times[tango["id"]].startswith("2026-11-21T16:00:00")


def test_accept_sets_the_proposed_frog_on_a_day_without_one(client, fake):
    read = _task(client, "Reading")
    run = _task(client, "Running")
    conv = _proposed(client, fake, [item(read["id"], "09:00", 30, is_frog=True), item(run["id"], "10:00", 30)])
    schedule = _accept(client, conv["id"])
    frogs = {i["task_id"]: i["is_frog"] for i in schedule["items"]}
    assert frogs == {read["id"]: True, run["id"]: False}


def test_accept_schedule_matches_the_schedule_route(client, fake):
    read = _task(client, "Reading")
    conv = _proposed(client, fake, [item(read["id"], "09:00", 30)])
    schedule = _accept(client, conv["id"])
    listed = client.get(f"/api/schedules/?start_date={FUTURE}&end_date={FUTURE}").json()
    assert len(listed) == 1
    assert listed[0]["id"] == schedule["id"]
    assert [i["id"] for i in listed[0]["items"]] == [i["id"] for i in schedule["items"]]


def test_new_activity_with_an_existing_name_uses_the_existing_one(client, fake):
    tango = _task(client, "Tango")
    conv = _proposed(client, fake, [item(None, "09:00", 30, new="tango", source="you_said", reason="Tango.")])
    schedule = _accept(client, conv["id"])
    names = [t["name"].lower() for t in client.get("/api/tasks/").json()]
    assert names.count("tango") == 1
    assert [i["task_id"] for i in schedule["items"]] == [tango["id"]]


def test_accept_rechecks_the_day_and_places_nothing_on_a_clash(client, fake, db):
    read = _task(client, "Reading")
    laundry = _task(client, "Laundry")
    conv = _proposed(client, fake, [
        item(read["id"], "09:00", 30),
        item(None, "11:00", 30, new="Tango", source="you_said", reason="Tango."),
    ])
    _place(client, laundry["id"], FUTURE, "2026-11-21T15:15:00Z", seconds=1800)  # 09:15 local, after the Proposal

    r = client.post(f"{CONV_URL}/{conv['id']}/accept")
    assert r.status_code == 409
    assert "Laundry" in r.json()["detail"]

    assert "Tango" not in _tasks_by_name(client)
    assert _day_task_ids(client) == [laundry["id"]]
    row = _conv_row(db, conv["id"])
    assert row.status == "open"
    assert row.accepted_items is None


def test_accept_without_a_proposal_is_409(client, fake):
    conv = _open(client)
    r = client.post(f"{CONV_URL}/{conv['id']}/accept")
    assert r.status_code == 409
    assert r.json()["detail"]


def test_accept_twice_is_409(client, fake):
    read = _task(client, "Reading")
    conv = _proposed(client, fake, [item(read["id"], "09:00", 30)])
    _accept(client, conv["id"])
    r = client.post(f"{CONV_URL}/{conv['id']}/accept")
    assert r.status_code == 409
    assert r.json()["detail"]
    assert _day_task_ids(client) == [read["id"]]


def test_accept_unknown_conversation_is_404(client, fake):
    assert client.post(f"{CONV_URL}/9999/accept").status_code == 404


# --- Reject and start over ------------------------------------------------------------------

def test_reject_then_message_is_409(client, fake, db):
    read = _task(client, "Reading")
    conv = _proposed(client, fake, [item(read["id"], "09:00", 30)])
    assert client.post(f"{CONV_URL}/{conv['id']}/reject").status_code == 200
    row = _conv_row(db, conv["id"])
    assert row.status == "rejected"
    assert row.closed_at is not None
    assert _day_task_ids(client) == []

    n = len(fake.calls)
    r = client.post(f"{CONV_URL}/{conv['id']}/messages", json={"text": "Wait"})
    assert r.status_code == 409
    assert len(fake.calls) == n


def test_reject_twice_and_accept_after_reject_are_409(client, fake):
    read = _task(client, "Reading")
    conv = _proposed(client, fake, [item(read["id"], "09:00", 30)])
    assert client.post(f"{CONV_URL}/{conv['id']}/reject").status_code == 200
    assert client.post(f"{CONV_URL}/{conv['id']}/reject").status_code == 409
    assert client.post(f"{CONV_URL}/{conv['id']}/accept").status_code == 409
    assert _day_task_ids(client) == []


def test_start_over_abandons_and_opens_a_new_one(client, fake, db):
    first = _open(client)
    _say(client, first["id"], "Plan my day")
    fake.queue(reply("Fresh start. What matters?"))
    n = len(fake.calls)

    r = client.post(f"{CONV_URL}/{first['id']}/start-over")
    assert r.status_code == 200, r.text
    fresh = r.json()
    assert len(fake.calls) == n + 1
    assert fresh["id"] != first["id"]
    assert fresh["status"] == "open"
    assert fresh["target_date"] == FUTURE
    assert [(m["role"], _visible(m)) for m in fresh["messages"]] == [("assistant", "Fresh start. What matters?")]
    assert "Plan my day" not in json.dumps(fake.calls[-1])

    row = _conv_row(db, first["id"])
    assert row.status == "abandoned"
    assert row.closed_at is not None
    assert _open(client)["id"] == fresh["id"]


def test_start_over_on_a_closed_conversation_is_409(client, fake):
    read = _task(client, "Reading")
    conv = _proposed(client, fake, [item(read["id"], "09:00", 30)])
    _accept(client, conv["id"])
    n = len(fake.calls)
    assert client.post(f"{CONV_URL}/{conv['id']}/start-over").status_code == 409
    assert len(fake.calls) == n


# --- Rating ---------------------------------------------------------------------------------

def test_rating_on_an_accepted_conversation(client, fake, db):
    read = _task(client, "Reading")
    conv = _proposed(client, fake, [item(read["id"], "09:00", 30)])
    _accept(client, conv["id"])
    url = f"{CONV_URL}/{conv['id']}/rating"
    assert client.put(url, json={"rating": "up"}).status_code == 200
    assert _conv_row(db, conv["id"]).rating == "up"
    assert client.put(url, json={"rating": "down"}).status_code == 200
    assert _conv_row(db, conv["id"]).rating == "down"
    assert client.put(url, json={"rating": None}).status_code == 200
    assert _conv_row(db, conv["id"]).rating is None


def test_rating_on_rejected_and_abandoned(client, fake, db):
    rejected = _open(client, FUTURE)
    client.post(f"{CONV_URL}/{rejected['id']}/reject")
    assert client.put(f"{CONV_URL}/{rejected['id']}/rating", json={"rating": "down"}).status_code == 200
    assert _conv_row(db, rejected["id"]).rating == "down"
    abandoned = _open(client, OTHER_FUTURE)
    client.post(f"{CONV_URL}/{abandoned['id']}/start-over")
    assert client.put(f"{CONV_URL}/{abandoned['id']}/rating", json={"rating": "up"}).status_code == 200
    assert _conv_row(db, abandoned["id"]).rating == "up"


def test_rating_an_open_conversation_is_409(client, fake, db):
    conv = _open(client)
    assert client.put(f"{CONV_URL}/{conv['id']}/rating", json={"rating": "up"}).status_code == 409
    assert _conv_row(db, conv["id"]).rating is None


def test_rating_value_is_checked(client, fake):
    conv = _open(client)
    client.post(f"{CONV_URL}/{conv['id']}/reject")
    assert client.put(f"{CONV_URL}/{conv['id']}/rating", json={"rating": "meh"}).status_code == 422


# --- History and usage ----------------------------------------------------------------------

def _with_usage(response, input_tokens, output_tokens, cache_read, cache_write):
    response.usage = Usage(input_tokens, output_tokens, cache_read, cache_write)
    return response


def _call_sums(db, conv_id):
    return db.execute(sa.text(
        "SELECT COUNT(*) AS n, COALESCE(SUM(input_tokens), 0) AS i, COALESCE(SUM(output_tokens), 0) AS o, "
        "COALESCE(SUM(cache_read_input_tokens), 0) AS cr, COALESCE(SUM(cache_creation_input_tokens), 0) AS cw, "
        "COALESCE(SUM(cost_usd), 0) AS c FROM coach_calls WHERE conversation_id = :id"
    ), {"id": conv_id}).one()


def _set_created(db, conv_id, stamp):
    db.execute(sa.text("UPDATE coach_conversations SET created_at = :t WHERE id = :id"), {"t": stamp, "id": conv_id})
    db.execute(sa.text("UPDATE coach_calls SET created_at = :t WHERE conversation_id = :id"), {"t": stamp, "id": conv_id})
    db.commit()


@pytest.fixture
def history(client, fake, db):
    read = _task(client, "Reading")
    fake.queue(_with_usage(reply("What matters?"), 1200, 80, 0, 3000))
    accepted = _open(client, FUTURE)
    fake.queue(
        _with_usage(propose([item(read["id"], "09:00", 30)]), 1500, 300, 3000, 0),
        _with_usage(reply("Here it is."), 1800, 60, 3000, 100),
    )
    _say(client, accepted["id"], "Reading")
    _accept(client, accepted["id"])
    client.put(f"{CONV_URL}/{accepted['id']}/rating", json={"rating": "up"})

    fake.queue(_with_usage(reply("Hello."), 900, 40, 0, 2500))
    rejected = _open(client, OTHER_FUTURE)
    client.post(f"{CONV_URL}/{rejected['id']}/reject")

    fake.queue(_with_usage(reply("Hi again."), 950, 45, 2500, 0))
    still_open = _open(client, OTHER_FUTURE)

    _set_created(db, accepted["id"], "2026-11-03 10:00:00")
    _set_created(db, rejected["id"], "2026-11-04 10:00:00")
    _set_created(db, still_open["id"], "2026-11-05 10:00:00")
    return {"accepted": accepted["id"], "rejected": rejected["id"], "open": still_open["id"], "read": read}


def test_list_is_newest_first_with_totals_from_the_call_rows(client, fake, db, history):
    r = client.get(CONV_URL)
    assert r.status_code == 200
    rows = r.json()
    assert [row["id"] for row in rows] == [history["open"], history["rejected"], history["accepted"]]

    by_id = {row["id"]: row for row in rows}
    for conv_id in [history["accepted"], history["rejected"], history["open"]]:
        sums = _call_sums(db, conv_id)
        row = by_id[conv_id]
        assert row["call_count"] == sums.n
        assert row["input_tokens"] == sums.i
        assert row["output_tokens"] == sums.o
        assert row["cache_read_input_tokens"] == sums.cr
        assert row["cache_creation_input_tokens"] == sums.cw
        assert row["cost_usd"] == pytest.approx(sums.c)

    acc = by_id[history["accepted"]]
    assert acc["call_count"] == 3
    assert acc["input_tokens"] == 1200 + 1500 + 1800
    assert acc["status"] == "accepted"
    assert acc["target_date"] == FUTURE
    assert (acc["proposed_count"], acc["accepted_count"]) == (1, 1)
    assert acc["rating"] == "up"
    assert (acc["user_turns"], acc["revision_turns"]) == (1, 0)
    assert by_id[history["rejected"]]["status"] == "rejected"
    assert by_id[history["rejected"]]["accepted_count"] is None
    assert by_id[history["open"]]["status"] == "open"


def test_list_counts_a_conversation_with_no_calls_as_zero(client, fake, db):
    conv = _open(client)
    db.execute(sa.text("DELETE FROM coach_calls WHERE conversation_id = :id"), {"id": conv["id"]})
    db.commit()
    row = client.get(CONV_URL).json()[0]
    assert row["call_count"] == 0
    assert row["input_tokens"] == 0
    assert row["cost_usd"] == pytest.approx(0)


def test_detail_has_messages_proposal_and_every_call(client, fake, db, history):
    r = client.get(f"{CONV_URL}/{history['accepted']}")
    assert r.status_code == 200
    detail = r.json()
    sums = _call_sums(db, history["accepted"])
    assert detail["call_count"] == sums.n
    assert detail["input_tokens"] == sums.i
    assert detail["cost_usd"] == pytest.approx(sums.c)
    assert detail["status"] == "accepted"

    assert [(m["role"], _visible(m)) for m in detail["messages"]] == [
        ("assistant", "What matters?"), ("user", "Reading"), ("assistant", "Here it is."),
    ]
    assert [i["task_id"] for i in detail["proposal"]["items"]] == [history["read"]["id"]]

    calls = detail["calls"]
    assert [c["input_tokens"] for c in calls] == [1200, 1500, 1800]
    assert [c["stop_reason"] for c in calls] == ["end_turn", "tool_use", "end_turn"]
    assert sum(c["cost_usd"] for c in calls) == pytest.approx(detail["cost_usd"])
    for c in calls:
        assert {"turn_index", "model", "latency_ms", "output_tokens", "cache_read_input_tokens",
                "cache_creation_input_tokens"} <= set(c)


def test_detail_unknown_id_is_404(client, fake):
    assert client.get(f"{CONV_URL}/9999").status_code == 404


def test_usage_counts_only_that_month(client, fake, db, history):
    _set_created(db, history["rejected"], "2026-10-31 23:30:00")

    r = client.get("/api/coach/usage?month=2026-11")
    assert r.status_code == 200
    nov = r.json()
    assert nov["conversations"] == 2
    assert nov["accepted"] == 1
    assert nov["cost_usd"] == pytest.approx(_call_sums(db, history["accepted"]).c + _call_sums(db, history["open"]).c)

    oct_ = client.get("/api/coach/usage?month=2026-10").json()
    assert (oct_["conversations"], oct_["accepted"]) == (1, 0)
    assert oct_["cost_usd"] == pytest.approx(_call_sums(db, history["rejected"]).c)

    dec = client.get("/api/coach/usage?month=2026-12").json()
    assert (dec["conversations"], dec["accepted"]) == (0, 0)
    assert dec["cost_usd"] == pytest.approx(0)


def test_usage_defaults_to_the_current_utc_month(client, fake, db, history, monkeypatch):
    assert client.get("/api/coach/usage").json()["conversations"] == 3
    monkeypatch.setattr("app.services.coach_context.now_utc", lambda: datetime(2026, 12, 2, 12, 0))
    assert client.get("/api/coach/usage").json()["conversations"] == 0


@pytest.mark.parametrize("month", ["2026-13", "Nov", "2026-11-01"])
def test_usage_month_is_checked(client, month):
    assert client.get(f"/api/coach/usage?month={month}").status_code == 422


@pytest.mark.parametrize("method,url", [
    ("get", CONV_URL),
    ("get", f"{CONV_URL}/1"),
    ("post", f"{CONV_URL}/1/accept"),
    ("post", f"{CONV_URL}/1/reject"),
    ("post", f"{CONV_URL}/1/start-over"),
    ("put", f"{CONV_URL}/1/rating"),
    ("get", "/api/coach/usage"),
])
def test_b61_routes_behind_gate(method, url):
    assert getattr(TestClient(app), method)(url).status_code == 401
