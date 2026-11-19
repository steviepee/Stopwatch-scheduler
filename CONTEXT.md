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

**Intended length**:
How long the user means one sitting of an Activity to last, set by the user. It seeds new placements only until the Activity has Recordings, then the average takes over. It never feeds the average.
_Avoid_: Default duration, target length

**Recording**:
One run of an Activity, saved with a name and a duration: timed by the stopwatch, or entered by hand when the duration is already known. The unit of truth: attaching a Recording to an Activity is what teaches the Activity how long it takes.
_Avoid_: Session, stopwatch session (the code name — `StopwatchSession`, `/api/sessions`)

**Time Log**:
An Activity's history entry — one duration that contributes to its average. Created automatically when a Recording is attached to an Activity; older ones were entered directly and have no Recording behind them.
_Avoid_: Entry, log line, "saving to a task" as something distinct from recording

**Monotonic reading**:
A clock value that only moves forward and is immune to the phone's clock being changed. Used to compute a Recording's duration.
_Avoid_: Uptime, tick count

**Wall-clock reading**:
The real-world UTC instant, used for a Recording's start and end timestamps. Never used to compute duration.
_Avoid_: System time, `Date.now()` as a duration source

**Clock jump**:
A Recording whose monotonic and wall-clock spans disagree by more than a small tolerance, meaning the phone's clock moved while it ran.

**Pomodoro run**:
One sitting of paced, single-Activity work, from Start to Finish, alternating Work intervals and Breaks. The Activity is chosen before it starts. It produces one Recording whose duration is the total work time, carrying a summary of its intervals and breaks. A run lives on one device.
_Avoid_: Pomodoro session (Session is the code name for a Recording), cycle

**Work interval**:
A stretch of work within a Pomodoro run. Its configured length is a target, not a cutoff: work continues to count until the user switches to a Break.

**Break**:
A rest between Work intervals within a Pomodoro run. A **Long break** replaces every Nth Break. Paused time counts as neither work nor break, and a Break still open when the run finishes is dropped.

### Planning

**Schedule**:
The plan for one calendar date: the Activities laid out on that day, each with an estimated duration seeded from its history. A date has at most one Schedule, and every way of planning that day adds to it.
_Avoid_: Plan, day plan, timeline (the code uses `timeline` for the rendered list inside a schedule)

**Schedule Item**:
One placement of an Activity within a Schedule, with its own estimated duration and position. Its duration is seeded from the Activity's average, or its Intended length if it has no history, or 10 minutes if it has neither, can be changed for that placement alone, and never feeds back into the Activity.

**Regimen**:
A Schedule saved without a date so it can be applied again to any future day.
_Avoid_: Template, routine

**Strategy**:
A deterministic rule for ordering the Activities in a Schedule. Named entries in the strategy registry. The Coach is not a Strategy, though it may use them.
_Avoid_: Algorithm, generator, mode

**Frog**:
The one Schedule Item marked as its day's hardest, which the eat-the-frog Strategy places first. The same Activity can be the Frog one day and not the next.
_Avoid_: Priority task, top task

**Quadrant**:
An Activity's Eisenhower position derived from its urgent and important flags. Q1 both, Q2 important only, Q3 urgent only, Q4 neither.
_Avoid_: Priority level, tier

**Peak hours**:
The hours of the day in which recorded work has historically happened most, aggregated from Recordings and Time Logs.
_Avoid_: Peak energy (the lesson's term; the app measures when work happened, not energy)

### Coaching

**Coach**:
The conversational planner that asks what a day needs, what energy and commitments look like, and what is realistic given how long things actually take, then answers with a Proposal. It converses and judges rather than applying a fixed rule.
_Avoid_: AI Strategy, AI planner, assistant, chatbot

**Coaching conversation**:
One bounded exchange with the Coach about one date, ending in a Proposal or abandoned.
_Avoid_: Chat, session (Session is the code name for a Recording)

**Proposal**:
The Coach's suggested Schedule Items for a date, each with a start time that fits around the day's Existing events and Blocks. The user accepts or rejects it whole; accepting adds its items to that date's Schedule, after which they are ordinary Schedule Items with no tie to the Coach. Nothing in a Proposal is Exported until the user pushes the day.
_Avoid_: Draft, plan, suggestion

**Coach note**:
A short fact about the user, either suggested by the Coach and approved by the user or added by the user directly, carried into every later Coaching conversation. Visible, editable, and deletable by the user; a Coach suggestion is never saved without approval.
_Avoid_: Memory, profile, preference

**Goal**:
Something the user wants to be able to do by a deadline, such as learning to tango before a wedding in six weeks, which the Coach turns into practice spread across the days before it. Not yet built.
_Avoid_: Target, objective, project

### Calendar

**Scheduled**:
A Schedule Item that has a start time on the in-app calendar. Distinct from being on Google Calendar. Recordings are never Scheduled; they are history, not plans.

**Exported**:
A Schedule Item that has been pushed to Google Calendar as an event.
_Avoid_: Synced, published, "on calendar" (the code name — `is_on_calendar`)

**Bank**:
The list of Activities beside the calendar, from which any Activity can be placed on any day any number of times.
_Avoid_: Tray, palette, unscheduled list

**Block**:
A Scheduled Schedule Item as drawn on the calendar.
_Avoid_: Event (reserved for Google Calendar), slot

**Start reminder**:
A notification shortly before a Block begins, reminding the user to start the stopwatch on its Activity so the time is recorded. Delivered by Google Calendar, so only Exported Blocks have one.
_Avoid_: Alert, nudge, Pomodoro reminder (that is the interval-end chime)

**Existing event**:
A Google Calendar event imported for a date so a Strategy can schedule around it.
_Avoid_: Commitment, blocker

### Access

**Credential gate**:
The single static bearer token that protects every API route except health and the Google OAuth callback. There are no user accounts.
_Avoid_: Login, auth, user, account
