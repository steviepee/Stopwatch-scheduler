---
status: accepted
date: 2026-09-27
---

# One Schedule per date; the Bank holds Activities; Recordings are never Scheduled

Build 1b let the calendar schedule Recordings: a Recording left the bank once placed, so a
repeatable thing could be planned once and never again, and a date's plan was scattered across
Recording rows and any number of Schedules with no date. We decided that a date has at most one
Schedule, that the calendar's Bank lists Activities, and that placing one creates a Schedule
Item on that date's Schedule. Every way of planning a day — dropping from the Bank, Schedule-tab
Save, Regimen Apply — adds to that one Schedule, so "push the day to Google" is one Schedule's
push and duplicate day plans cannot exist.

## Considered options

- **Many Schedules per date**, with the calendar showing their union. Rejected: Push day would
  have to fan out across Schedules, and the P21 duplicate-save bug would stay possible in the
  model rather than impossible.
- **Keep Recording scheduling beside Activity scheduling.** Rejected: two parallel planning
  systems. The Recording scheduling fields and routes are removed; the three rows that used them
  were not migrated.

## Consequences

- A Schedule's date is a local calendar date, not a UTC instant, and is unique among
  non-Regimen Schedules. The server enforces that by find-or-create, not a unique index: a
  global unique constraint would have to be rebuilt per owner for multi-user
  (`docs/multi-user-transition.md`). Day Schedules have no user-given name; Regimens keep theirs.
- A Schedule Item's length is its own: seeded from the Activity's average (10 minutes with no
  history), editable per placement, and never fed back into the Activity. Only Recordings teach.
- Recordings are history only. Showing them on the calendar as plan-vs-actual is future work.
