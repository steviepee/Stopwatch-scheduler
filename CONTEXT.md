# Stopwatch Scheduler

A single-user stopwatch that records how long activities actually take and builds day
schedules from that history. This file is the glossary. The code predates the current
vocabulary, so several terms below carry a code name that differs from the product name;
the product name wins in prose, UI, and new code.

## Language

### Time

**Activity**:
A named, repeatable thing you do, with a running average and median duration learned from its recordings.
_Avoid_: Task (the code name — `Task` model, `/api/tasks`), job, item

**Recording**:
One timed run of the stopwatch, saved with a name and a duration, optionally attached to an Activity.
_Avoid_: Session, stopwatch session (the code name — `StopwatchSession`, `/api/sessions`)

**Time Log**:
A single duration appended to an Activity's history. Created when a Recording is saved to an Activity.
_Avoid_: Entry, log line

**Monotonic reading**:
A clock value that only moves forward and is immune to the phone's clock being changed. Used to compute a Recording's duration.
_Avoid_: Uptime, tick count

**Wall-clock reading**:
The real-world UTC instant, used for a Recording's start and end timestamps. Never used to compute duration.
_Avoid_: System time, `Date.now()` as a duration source

**Clock jump**:
A Recording whose monotonic and wall-clock spans disagree by more than a small tolerance, meaning the phone's clock moved while it ran.

### Planning

**Schedule**:
An ordered set of Activities laid out against a specific date, each with an estimated duration seeded from its history.
_Avoid_: Plan, day plan, timeline (the code uses `timeline` for the rendered list inside a schedule)

**Schedule Item**:
One Activity's slot within a Schedule, with its estimated duration and position.

**Regimen**:
A Schedule saved without a date so it can be applied again to any future day.
_Avoid_: Template, routine

**Strategy**:
A deterministic rule for ordering the Activities in a Schedule. Named entries in the strategy registry; an AI planner would be one more entry.
_Avoid_: Algorithm, generator, mode

**Frog**:
The one Activity marked as the day's hardest, which the eat-the-frog Strategy places first.
_Avoid_: Priority task, top task

**Quadrant**:
An Activity's Eisenhower position derived from its urgent and important flags. Q1 both, Q2 important only, Q3 urgent only, Q4 neither.
_Avoid_: Priority level, tier

**Peak hours**:
The hours of the day in which recorded work has historically happened most, aggregated from Recordings and Time Logs.
_Avoid_: Peak energy (the lesson's term; the app measures when work happened, not energy)

### Calendar

**Scheduled**:
A Recording that has been given a start and end on the in-app calendar. Distinct from being on Google Calendar.

**Exported**:
A Recording or Schedule Item that has been pushed to Google Calendar as an event.
_Avoid_: Synced, published, "on calendar" (the code name — `is_on_calendar`)

**Existing event**:
A Google Calendar event imported for a date so a Strategy can schedule around it.
_Avoid_: Commitment, blocker

### Access

**Credential gate**:
The single static bearer token that protects every API route except health and the Google OAuth callback. There are no user accounts.
_Avoid_: Login, auth, user, account
