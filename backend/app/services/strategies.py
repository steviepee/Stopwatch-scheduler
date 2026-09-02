from datetime import datetime, timedelta
from typing import List, Optional, Dict, Callable


def _build_timeline(ordered, start_time):
    timeline = []
    cursor = start_time
    for act in ordered:
        duration = act["estimated_duration"]
        end = cursor + timedelta(seconds=duration)
        timeline.append({
            "task_id": act.get("task_id"),
            "name": act["name"],
            "start": cursor,
            "end": end,
        })
        cursor = end
    return timeline


def _your_order(activities, **kwargs):
    ordered = list(activities)
    return {
        "label": "Your Order",
        "description": "Activities in the order you entered them.",
        "ordered": ordered,
        "flagged": [],
        "excluded": [],
    }


def _shortest_first(activities, **kwargs):
    ordered = sorted(activities, key=lambda a: a["estimated_duration"])
    return {
        "label": "Shortest First",
        "description": "Shortest activities first to build momentum.",
        "ordered": ordered,
        "flagged": [],
        "excluded": [],
    }


def _longest_first(activities, **kwargs):
    ordered = sorted(activities, key=lambda a: a["estimated_duration"], reverse=True)
    return {
        "label": "Longest First",
        "description": "Longest activities first while energy is highest.",
        "ordered": ordered,
        "flagged": [],
        "excluded": [],
    }


def _best_fit(activities, day_start, day_end, existing_events, **kwargs):
    events = sorted(
        [e for e in existing_events if e["start"] >= day_start and e["start"] < day_end],
        key=lambda e: e["start"],
    )

    gaps = []
    cursor = day_start
    for ev in events:
        if ev["start"] > cursor:
            duration = (ev["start"] - cursor).total_seconds()
            gaps.append({"duration": duration})
        if ev["end"] > cursor:
            cursor = ev["end"]
    if cursor < day_end:
        gaps.append({"duration": (day_end - cursor).total_seconds()})

    if not gaps:
        ordered = sorted(activities, key=lambda a: a["estimated_duration"], reverse=True)
        return {
            "label": "Best Fit",
            "description": "Longest activities first while energy is highest.",
            "ordered": ordered,
            "flagged": [],
            "excluded": [],
        }

    remaining = sorted(activities, key=lambda a: a["estimated_duration"], reverse=True)
    sorted_gaps = sorted(gaps, key=lambda g: g["duration"], reverse=True)
    placed = []
    unplaced = []

    for activity in remaining:
        gap = next((g for g in sorted_gaps if g["duration"] >= activity["estimated_duration"]), None)
        if gap:
            placed.append(activity)
            gap["duration"] -= activity["estimated_duration"]
        else:
            unplaced.append(activity)

    has_events = len(existing_events) > 0
    description = (
        "Slots activities around your existing events."
        if has_events
        else "No existing events — falls back to longest first."
    )
    return {
        "label": "Best Fit",
        "description": description,
        "ordered": placed + unplaced,
        "flagged": [],
        "excluded": [],
    }




def _eat_the_frog(activities, **kwargs):
    frog = next((a for a in activities if a.get("is_frog")), None)
    if frog is None:
        ordered = list(activities)
        description = "No frog flagged — keeping your order."
    else:
        ordered = [frog] + [a for a in activities if a is not frog]
        description = f"Starting with your frog: {frog['name']}."
    return {
        "label": "Eat the Frog",
        "description": description,
        "ordered": ordered,
        "flagged": [],
        "excluded": [],
    }



def _eisenhower(activities, **kwargs):
    q1 = [a for a in activities if a.get("is_urgent") and a.get("is_important")]
    q2 = [a for a in activities if not a.get("is_urgent") and a.get("is_important")]
    q3 = [a for a in activities if a.get("is_urgent") and not a.get("is_important")]
    q4 = [a for a in activities if not a.get("is_urgent") and not a.get("is_important")]
    ordered = q1 + q2 + q3
    flagged = [{"name": a["name"], "reason": "consider-delegating"} for a in q3]
    excluded = [{"name": a["name"], "reason": "not-urgent-not-important"} for a in q4]
    return {
        "label": "Eisenhower",
        "description": "Q1 (urgent+important) first, Q2 (important) next, Q3 (urgent) last; Q4 dropped.",
        "ordered": ordered,
        "flagged": flagged,
        "excluded": excluded,
    }



def _best_fit_slots(activities, start_time, day_start, day_end, existing_events, **kwargs):
    events = sorted(
        [e for e in existing_events if e["start"] >= day_start and e["start"] < day_end],
        key=lambda e: e["start"],
    )

    gaps = []
    cursor = day_start
    for ev in events:
        if ev["start"] > cursor:
            gaps.append({"start": cursor, "end": ev["start"]})
        if ev["end"] > cursor:
            cursor = ev["end"]
    if cursor < day_end:
        gaps.append({"start": cursor, "end": day_end})

    for g in gaps:
        g["cursor"] = max(g["start"], start_time)
        g["remaining"] = max(0.0, (g["end"] - g["cursor"]).total_seconds())

    ordered = sorted(activities, key=lambda a: a["estimated_duration"], reverse=True)
    timeline = []
    excluded = []

    for activity in ordered:
        dur = activity["estimated_duration"]
        placed = False
        for gap in gaps:
            if gap["remaining"] >= dur:
                entry_start = gap["cursor"]
                entry_end = entry_start + timedelta(seconds=dur)
                timeline.append({
                    "task_id": activity.get("task_id"),
                    "name": activity["name"],
                    "start": entry_start,
                    "end": entry_end,
                })
                gap["cursor"] = entry_end
                gap["remaining"] -= dur
                placed = True
                break
        if not placed:
            excluded.append({"name": activity["name"], "reason": "no-free-slot"})

    return {
        "label": "Best Fit Slots",
        "description": "Activities placed into free gaps around your existing events.",
        "timeline": timeline,
        "flagged": [],
        "excluded": excluded,
    }

STRATEGY_REGISTRY = {
    "your-order": _your_order,
    "shortest-first": _shortest_first,
    "longest-first": _longest_first,
    "best-fit": _best_fit,
    "best-fit-slots": _best_fit_slots,
    "eat-the-frog": _eat_the_frog,
    "eisenhower": _eisenhower,
}
