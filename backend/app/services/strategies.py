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


STRATEGY_REGISTRY = {
    "your-order": _your_order,
}
