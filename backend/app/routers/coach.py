import json
import time
from collections import defaultdict
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db, utcnow
from app.models import schemas
from app.models.coach import CoachCall, CoachConversation, CoachMessage, CoachNote
from app.models.task import Task
from app.models.time_log import TimeLog
from app.services import coach_context, coach_model, coach_plan
from app.services.coach_cost import cost_usd
from app.services.task_stats import median

router = APIRouter()

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "coach_system.md"
OPENING = "[App: The user has opened this Coaching conversation.]"
MUST_PROPOSE = "[App: This is the user's 6th message. You must call propose_plan now.]"
PROPOSE_BY = 6
CHANGE_LIMIT = 3
MESSAGE_LIMIT = 6
MAX_CALLS = 4
MAX_RETRIES = 2


def _get_note(db: Session, note_id: int) -> CoachNote:
    note = db.query(CoachNote).filter(CoachNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Coach note not found")
    return note


@router.get("/notes", response_model=List[schemas.CoachNote])
def get_notes(db: Session = Depends(get_db)):
    return db.query(CoachNote).order_by(CoachNote.created_at, CoachNote.id).all()


@router.post("/notes", response_model=schemas.CoachNote)
def create_note(note: schemas.CoachNoteBase, db: Session = Depends(get_db)):
    db_note = CoachNote(text=note.text)
    db.add(db_note)
    db.commit()
    db.refresh(db_note)
    return db_note


@router.put("/notes/{note_id}", response_model=schemas.CoachNote)
def update_note(note_id: int, note: schemas.CoachNoteBase, db: Session = Depends(get_db)):
    db_note = _get_note(db, note_id)
    db_note.text = note.text
    db_note.confirmed_at = utcnow()
    db.commit()
    db.refresh(db_note)
    return db_note


@router.delete("/notes/{note_id}")
def delete_note(note_id: int, db: Session = Depends(get_db)):
    db.delete(_get_note(db, note_id))
    db.commit()
    return {"message": "Coach note deleted successfully"}


class _ModelFailed(Exception):
    pass


class _Turn:
    """What one request knows about the date, read once per request."""

    def __init__(self, db: Session, conv: CoachConversation):
        self.conv = conv
        self.events = coach_context.existing_events(conv.target_date, conv.tz_offset)
        self.blocks = coach_context.day_blocks(db, conv.target_date, conv.tz_offset)
        self.notes_enabled = coach_context.notes_enabled(db)
        self.records = []
        self.failures = 0
        self.note_suggestion = None

    def busy(self):
        spans = [(b["name"], b["start"], b["end"]) for b in self.blocks if b["start"] is not None]
        spans += [(e["name"], e["start"], e["end"]) for e in self.events or [] if not e["all_day"]]
        return spans


def _system(conv: CoachConversation) -> str:
    return PROMPT_PATH.read_text(encoding="utf-8") + "\n\n" + conv.context


def _tools(turn: _Turn) -> list:
    return [coach_plan.PROPOSE_PLAN_TOOL] + ([coach_plan.SUGGEST_NOTE_TOOL] if turn.notes_enabled else [])


def _rows(db: Session, conv: CoachConversation) -> list:
    return db.query(CoachMessage).filter(CoachMessage.conversation_id == conv.id).order_by(CoachMessage.id).all()


def _add_message(db: Session, conv: CoachConversation, role: str, content: list, visible_text):
    db.add(CoachMessage(conversation_id=conv.id, role=role, content=json.dumps(content), visible_text=visible_text))
    db.flush()


def _visible_user_count(db: Session, conv: CoachConversation) -> int:
    return sum(1 for r in _rows(db, conv) if r.role == "user" and r.visible_text is not None)


def _messages_after_proposal(db: Session, conv: CoachConversation) -> int:
    return _visible_user_count(db, conv) - conv.user_turns


def _call(db: Session, turn: _Turn, turn_index: int):
    conv = turn.conv
    messages = [{"role": r.role, "content": json.loads(r.content)} for r in _rows(db, conv)]
    record = {"conversation_id": conv.id, "turn_index": turn_index, "model": conv.model, "effort": conv.effort}
    started = time.monotonic()
    try:
        response = coach_model.call_model(_system(conv), messages, _tools(turn))
    except coach_model.ModelError:
        turn.records.append(dict(
            record, input_tokens=0, output_tokens=0, cache_read_input_tokens=0, cache_creation_input_tokens=0,
            stop_reason="error", latency_ms=int((time.monotonic() - started) * 1000), cost_usd=0.0,
        ))
        raise _ModelFailed()
    usage = response.usage
    turn.records.append(dict(
        record,
        input_tokens=usage.input_tokens or 0,
        output_tokens=usage.output_tokens or 0,
        cache_read_input_tokens=usage.cache_read_input_tokens,
        cache_creation_input_tokens=usage.cache_creation_input_tokens,
        stop_reason=response.stop_reason,
        latency_ms=int((time.monotonic() - started) * 1000),
        cost_usd=cost_usd(conv.model, usage),
    ))
    return response


def _activity_history(db: Session) -> dict:
    durations = defaultdict(list)
    for log in db.query(TimeLog).all():
        durations[log.task_id].append(log.duration)
    return {
        t.id: (t.name, t.total_recordings, median(durations[t.id]) if t.total_recordings else None)
        for t in db.query(Task).all()
    }


def _propose(db: Session, turn: _Turn, tool_input: dict):
    """The tool result text for one propose_plan call, and whether it is an error."""
    conv = turn.conv
    if conv.proposal is not None and conv.revision_turns >= CHANGE_LIMIT:
        return (f"The change limit is reached: all {CHANGE_LIMIT} changes are used, so the Proposal stays as it was. "
                "Tell the user they can accept, reject, or start over."), True
    if turn.failures > MAX_RETRIES:
        return "No more attempts for this message. Tell the user what could not be fitted.", True

    items = tool_input.get("items") or []
    history = _activity_history(db)
    now = coach_context.local_now(conv.tz_offset)
    problems = coach_plan.validate(
        items, conv.target_date,
        not_before=now if conv.target_date == now.date() else None,
        busy=turn.busy(),
        day_has_frog=any(b["is_frog"] for b in turn.blocks),
        task_names={task_id: h[0] for task_id, h in history.items()},
    )
    if problems:
        turn.failures += 1
        text = ("The Proposal was not stored. Fix every problem and call propose_plan again with the whole plan:\n- "
                + "\n- ".join(problems))
        if turn.failures > MAX_RETRIES:
            text += ("\nThat was the last attempt for this message. Do not call propose_plan again; "
                     "tell the user what could not be fitted.")
        return text, True

    stored = []
    for item in items:
        item = dict(item)
        if item.get("task_id") is not None:
            _, count, typical = history[item["task_id"]]
            item["recording_count"] = count
            item["typical_seconds"] = typical
        stored.append(item)
    if conv.proposal is not None:
        conv.revision_turns += 1
    conv.proposal = json.dumps({"items": stored, "summary": tool_input.get("summary", "")})
    conv.proposed_count = len(stored)
    return "The Proposal is stored and shown to the user.", False


def _run(db: Session, turn: _Turn, turn_index: int):
    for _ in range(MAX_CALLS):
        response = _call(db, turn, turn_index)
        texts = [b.text for b in response.content if b.type == "text" and b.text]
        _add_message(db, turn.conv, "assistant", [b.model_dump(exclude_none=True) for b in response.content],
                     "\n\n".join(texts) or None)
        tool_uses = [b for b in response.content if b.type == "tool_use"]
        if not tool_uses:
            return
        results = []
        for tool_use in tool_uses:
            if tool_use.name == "propose_plan":
                text, is_error = _propose(db, turn, tool_use.input)
            elif tool_use.name == "suggest_note" and turn.notes_enabled:
                turn.note_suggestion = tool_use.input.get("text")
                text, is_error = "The suggestion is shown to the user, who decides whether to save it.", False
            else:
                text, is_error = f"There is no tool named {tool_use.name}.", True
            result = {"type": "tool_result", "tool_use_id": tool_use.id, "content": text}
            if is_error:
                result["is_error"] = True
            results.append(result)
        _add_message(db, turn.conv, "user", results, None)
        if response.stop_reason != "tool_use":
            return


def _run_or_502(db: Session, turn: _Turn, turn_index: int, abandon_on_error: bool = False):
    conv_id = turn.conv.id
    try:
        _run(db, turn, turn_index)
    except _ModelFailed:
        db.rollback()
        if abandon_on_error:
            conv = db.query(CoachConversation).filter(CoachConversation.id == conv_id).first()
            conv.status = "abandoned"
            conv.closed_at = utcnow()
        for record in turn.records:
            db.add(CoachCall(**record))
        db.commit()
        raise HTTPException(status_code=502, detail="The Coach could not be reached. Try again.")
    for record in turn.records:
        db.add(CoachCall(**record))
    db.commit()


def _response(db: Session, turn: _Turn) -> schemas.CoachConversation:
    conv = turn.conv
    db.refresh(conv)
    changes_left = messages_left = None
    if conv.proposal is not None:
        changes_left = CHANGE_LIMIT - conv.revision_turns
        messages_left = MESSAGE_LIMIT - _messages_after_proposal(db, conv)
    return schemas.CoachConversation(
        id=conv.id,
        target_date=conv.target_date,
        status=conv.status,
        messages=[
            schemas.CoachVisibleMessage(role=r.role, visible_text=r.visible_text, created_at=r.created_at)
            for r in _rows(db, conv) if r.visible_text is not None
        ],
        proposal=json.loads(conv.proposal) if conv.proposal else None,
        changes_left=changes_left,
        messages_left=messages_left,
        day_items=coach_context.day_items(turn.events, turn.blocks),
        note_suggestion=turn.note_suggestion,
    )


@router.post("/conversations", response_model=schemas.CoachConversation)
def open_conversation(body: schemas.CoachConversationOpen, db: Session = Depends(get_db)):
    if body.target_date < coach_context.local_now(body.tz_offset).date():
        raise HTTPException(status_code=422, detail="The Coach plans today or a future date only")

    conv = db.query(CoachConversation).filter(
        CoachConversation.target_date == body.target_date,
        CoachConversation.status == "open",
    ).order_by(CoachConversation.id.desc()).first()
    if conv:
        return _response(db, _Turn(db, conv))

    conv = CoachConversation(
        target_date=body.target_date,
        tz_offset=body.tz_offset,
        status="open",
        model=coach_model.model_name(),
        effort=coach_model.effort(),
        user_turns=0,
        revision_turns=0,
    )
    db.add(conv)
    db.flush()
    turn = _Turn(db, conv)
    conv.context = coach_context.build_context(db, conv.target_date, conv.tz_offset, turn.events, turn.blocks)
    opening = coach_context.time_line(conv.tz_offset) + "\n" + OPENING
    _add_message(db, conv, "user", [{"type": "text", "text": opening}], None)
    db.commit()
    _run_or_502(db, turn, 0, abandon_on_error=True)
    return _response(db, turn)


@router.post("/conversations/{conversation_id}/messages", response_model=schemas.CoachConversation)
def send_message(conversation_id: int, body: schemas.CoachMessageCreate, db: Session = Depends(get_db)):
    conv = db.query(CoachConversation).filter(CoachConversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Coaching conversation not found")
    if conv.status != "open":
        raise HTTPException(status_code=409, detail="conversation is not open")
    if conv.proposal is not None and _messages_after_proposal(db, conv) >= MESSAGE_LIMIT:
        raise HTTPException(status_code=409, detail="message limit reached")

    turn = _Turn(db, conv)
    if conv.context is None:
        conv.context = coach_context.build_context(db, conv.target_date, conv.tz_offset, turn.events, turn.blocks)
    text = coach_context.time_line(conv.tz_offset) + "\n" + body.text
    if conv.proposal is None:
        conv.user_turns += 1
        if conv.user_turns >= PROPOSE_BY:
            text += "\n" + MUST_PROPOSE
    _add_message(db, conv, "user", [{"type": "text", "text": text}], body.text)
    _run_or_502(db, turn, _visible_user_count(db, conv))
    return _response(db, turn)
