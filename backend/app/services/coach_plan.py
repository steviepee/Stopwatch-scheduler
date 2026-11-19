from datetime import date, datetime, timedelta

SOURCES = ("you_said", "history", "guess")

PROPOSE_PLAN_TOOL = {
    "name": "propose_plan",
    "description": (
        "Make a Proposal: the whole plan of new Blocks for the planned date. Replaces any earlier Proposal. "
        "This is the only way to put a plan in the app."
    ),
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "task_id": {"anyOf": [{"type": "integer"}, {"type": "null"}],
                                    "description": "id of an existing Activity, or null for a new one"},
                        "new_activity_name": {"anyOf": [{"type": "string"}, {"type": "null"}],
                                              "description": "name of a new Activity, or null for an existing one"},
                        "start": {"type": "string", "description": "local start time, 24-hour HH:MM"},
                        "duration_minutes": {"type": "integer", "description": "length in minutes"},
                        "is_frog": {"type": "boolean"},
                        "source": {"type": "string", "enum": list(SOURCES)},
                        "reason": {"type": "string", "description": "one plain sentence, at most 200 characters"},
                    },
                    "required": ["task_id", "new_activity_name", "start", "duration_minutes", "is_frog", "source", "reason"],
                    "additionalProperties": False,
                },
            },
            "summary": {"type": "string", "description": "one or two sentences on the shape of the plan"},
        },
        "required": ["items", "summary"],
        "additionalProperties": False,
    },
}

SUGGEST_NOTE_TOOL = {
    "name": "suggest_note",
    "description": "Suggest a Coach note: one short sentence about the user that will still be true next week. "
                   "Saved only if the user approves it in the app.",
    "strict": True,
    "input_schema": {
        "type": "object",
        "properties": {"text": {"type": "string", "description": "the note, at most 300 characters"}},
        "required": ["text"],
        "additionalProperties": False,
    },
}


def _parse_start(target_date: date, value):
    try:
        t = datetime.strptime(value, "%H:%M").time()
    except (TypeError, ValueError):
        return None
    return datetime.combine(target_date, t)


def _span(start: datetime, end: datetime) -> str:
    return f"{start:%H:%M}-{end:%H:%M}"


def validate(items, target_date: date, not_before, busy, day_has_frog: bool, task_names: dict) -> list:
    """Problems with a Proposal's items, as plain sentences; empty when it fits.

    not_before is the local time no item may start before (today only), or None.
    busy is a list of (name, local start, local end) for existing Blocks and timed events.
    """
    problems = []
    placed = []
    day_end = datetime.combine(target_date, datetime.min.time()) + timedelta(days=1)

    if not items:
        problems.append("The Proposal has no items.")

    for n, item in enumerate(items, start=1):
        task_id = item.get("task_id")
        new_name = item.get("new_activity_name")
        if (task_id is None) == (new_name is None or not new_name.strip()):
            problems.append(f"Item {n}: give exactly one of task_id or new_activity_name.")
            label = new_name or f"item {n}"
        elif task_id is not None and task_id not in task_names:
            problems.append(f"Item {n}: there is no Activity with task_id {task_id}.")
            label = f"item {n}"
        else:
            label = task_names[task_id] if task_id is not None else new_name

        if item.get("source") not in SOURCES:
            problems.append(f"{label}: source must be one of {', '.join(SOURCES)}.")
        reason = item.get("reason") or ""
        if not 1 <= len(reason.strip()) <= 200:
            problems.append(f"{label}: reason must be one sentence of 1 to 200 characters.")

        start = _parse_start(target_date, item.get("start"))
        minutes = item.get("duration_minutes")
        if start is None:
            problems.append(f"{label}: start must be a 24-hour local time as HH:MM.")
            continue
        if not isinstance(minutes, int) or minutes <= 0:
            problems.append(f"{label}: duration_minutes must be a whole number above 0.")
            continue
        end = start + timedelta(minutes=minutes)
        if end > day_end:
            problems.append(f"{label} {_span(start, end)} runs past the end of {target_date.isoformat()}.")
        if not_before is not None and start < not_before:
            problems.append(f"{label} starts at {start:%H:%M}, before the current time {not_before:%H:%M}.")
        for other_name, other_start, other_end in placed:
            if start < other_end and other_start < end:
                problems.append(f"{label} {_span(start, end)} overlaps {other_name} {_span(other_start, other_end)} in this Proposal.")
        for other_name, other_start, other_end in busy:
            if start < other_end and other_start < end:
                problems.append(f"{label} {_span(start, end)} clashes with {other_name} {_span(other_start, other_end)}, already on the date.")
        placed.append((label, start, end))

    frogs = sum(1 for item in items if item.get("is_frog"))
    if day_has_frog and frogs:
        problems.append("This date already has a Frog, so no item may be the Frog.")
    elif frogs > 1:
        problems.append("Only one item may be the Frog.")

    return problems
