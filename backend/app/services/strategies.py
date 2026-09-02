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


STRATEGY_REGISTRY = {
    "your-order": _your_order,
    "shortest-first": _shortest_first,
    "longest-first": _longest_first,
    "best-fit": _best_fit,
}
