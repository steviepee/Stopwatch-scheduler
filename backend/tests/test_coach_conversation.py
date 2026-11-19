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
