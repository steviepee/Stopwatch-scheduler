import argparse
import csv
import json
import os
import sys
from datetime import date, datetime, time, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import database
from app.models.coach import CoachCall, CoachConversation
from app.models.schedule import ScheduleItem
from app.models.stopwatch_session import StopwatchSession

STATUSES = ["open", "accepted", "rejected", "abandoned"]
DERIVED = ["kept", "edited", "deleted", "recorded"]


def _row(obj):
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


def _derived(db, conv):
    if not conv.accepted_items:
        return dict.fromkeys(DERIVED)
    out = dict.fromkeys(DERIVED, 0)
    for snap in json.loads(conv.accepted_items):
        item = db.query(ScheduleItem).filter(ScheduleItem.id == snap["id"]).first()
        if item is None:
            out["deleted"] += 1
        elif (item.scheduled_time.isoformat() + "Z" == snap["scheduled_time"]
              and float(item.estimated_duration) == float(snap["estimated_duration"])):
            out["kept"] += 1
        else:
            out["edited"] += 1
        sessions = db.query(StopwatchSession).filter(StopwatchSession.task_id == snap["task_id"]).all()
        if any(((s.start_time or s.created_at) - timedelta(minutes=conv.tz_offset)).date() == conv.target_date
               for s in sessions):
            out["recorded"] += 1
    return out


def _mean(values):
    return sum(values) / len(values) if values else None


def build_report(db, since):
    query = db.query(CoachConversation)
    if since:
        query = query.filter(CoachConversation.created_at >= datetime.combine(since, time.min))
    convs = query.order_by(CoachConversation.created_at).all()
    ids = [c.id for c in convs]
    calls = db.query(CoachCall).filter(CoachCall.conversation_id.in_(ids)).order_by(CoachCall.id).all() if ids else []

    cost = sum(c.cost_usd for c in calls)
    accepted = sum(c.status == "accepted" for c in convs)
    totals = {
        "conversations": len(convs),
        "by_status": {s: sum(c.status == s for c in convs) for s in STATUSES},
        "calls": len(calls),
        "input_tokens": sum(c.input_tokens for c in calls),
        "cache_creation_input_tokens": sum(c.cache_creation_input_tokens or 0 for c in calls),
        "cache_read_input_tokens": sum(c.cache_read_input_tokens or 0 for c in calls),
        "output_tokens": sum(c.output_tokens for c in calls),
        "cost_usd": cost,
        "avg_cost_per_conversation": cost / len(convs) if convs else None,
        "avg_cost_per_accepted": cost / accepted if accepted else None,
        "avg_turns_to_first_proposal": _mean([c.user_turns for c in convs if c.proposal]),
        "avg_latency_ms": _mean([c.latency_ms for c in calls]),
    }
    conv_cost = {}
    for c in calls:
        conv_cost[c.conversation_id] = conv_cost.get(c.conversation_id, 0) + c.cost_usd
    rows = [{**_row(c), **_derived(db, c), "cost_usd": conv_cost.get(c.id, 0)} for c in convs]
    return {"totals": totals, "conversations": rows, "calls": [_row(c) for c in calls]}


def _write_csv(path, rows, columns):
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _print(report):
    for key, value in report["totals"].items():
        print(f"{key}: {value}")
    print()
    print("id\tdate\tstatus\tturns\tcost_usd\tkept\tedited\tdeleted\trecorded")
    for r in report["conversations"]:
        print("\t".join(str(v) for v in (
            r["id"], r["target_date"], r["status"], r["user_turns"], f"{r['cost_usd']:.4f}",
            *(r[name] for name in DERIVED),
        )))


def main(argv=None):
    parser = argparse.ArgumentParser(description="Coach usage metrics (D106).")
    parser.add_argument("--since", type=date.fromisoformat, help="only conversations created on or after this UTC date (YYYY-MM-DD)")
    parser.add_argument("--csv", metavar="PATH", help="also write PATH-conversations.csv and PATH-calls.csv")
    args = parser.parse_args(argv)

    db = database.SessionLocal()
    try:
        report = build_report(db, args.since)
    finally:
        db.close()

    _print(report)
    if args.csv:
        _write_csv(f"{args.csv}-conversations.csv", report["conversations"],
                   [c.name for c in CoachConversation.__table__.columns] + DERIVED)
        _write_csv(f"{args.csv}-calls.csv", report["calls"], [c.name for c in CoachCall.__table__.columns])


if __name__ == "__main__":
    main()
