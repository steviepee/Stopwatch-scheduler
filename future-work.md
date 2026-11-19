# Future Work

Things deliberately out of scope for baseline. Each entry states the idea, why it is not a
small change against the current model, and the questions to settle before building it.
Not a task list. Nothing here is committed to.

---

## Wire the Phase 3 backend surface into the frontend

**Raised:** 2026-09-03. Deferred deliberately, to be scoped as its own PRD.

Phase 3 built a server-side scheduling engine that nothing consumes. Three capabilities are
finished, tested, and unreachable by a user:

| Capability | Route | Gap |
|---|---|---|
| Seven ordering strategies | `POST /api/schedules/generate` | UI has its own four, computed in the browser |
| Peak-hours analytics | `GET /api/insights/peak-hours` | Nothing displays it |
| Urgency / importance / frog flags | `PUT /api/tasks/{id}` | Never called; no component references the fields |

**Why it was left this way.** The current frontend is slated for replacement, not extension, so
wiring it now is work that gets thrown away. The browser-side ordering code is also the parity
reference the server strategies are tested against, and deleting it before the rewrite would
remove what the fixtures measure.

**What the eventual PRD has to cover**

- Add a `generate` method to the API client; it does not exist today.
- Replace the client-side timeline builder and best-fit implementation with calls to the endpoint,
  then delete `buildTimeline` and `bestFitOrder` from `ScheduleTimeline.tsx`.
- Decide what happens to `backend/tests/fixtures/generate_parity.json` once the code it was
  captured from is gone. The fixtures stay valid as regression data, but nothing regenerates them.
- Build a quadrant picker and a daily frog pick, which is the only way the Eisenhower and
  eat-the-frog strategies become usable.
- Surface peak-hours somewhere it changes a decision, not as a chart for its own sake.

**Ordering note.** This depends on the frontend rewrite, which is Phase 5 in the roadmap. It is
not a standalone piece of work.

---

## Parallel activities and stacked schedule items

**Raised:** 2026-09-02

Some activities can run at the same time. Laundry runs while you write. Something bakes while
you clean. The scheduler should eventually place those concurrently instead of spending the
day's budget on them serially, which means schedule items need the ability to stack onto each
other rather than sitting end to end.

**Where this came from**

Noticed live on 2026-09-02: a workflow was running in another repo, timed in this app, while
the user was doing unrelated work in a third place. The stopwatch recorded one activity, but
attention was split across several the whole time. Preparing anything tends to look like this
rather than like one thing at a time.

A consequence worth checking before trusting the numbers: existing recordings already contain
divided-attention sessions and are not labeled as such, so historical `average_duration`
values may not mean what a scheduler assumes they mean.

**Why this is not a small change**

The whole engine currently assumes a strictly sequential day. Every strategy in
`backend/app/services/strategies.py` orders activities and then lays them nose to tail from
`start_time` via `_build_timeline`. `ScheduleItem.position` is an ordinal, not a time, so two
items cannot express "these overlap". The calendar grid also assumes blocks never collide.
Allowing overlap changes the data model, the timeline builder, every strategy's notion of a
day being "full", and the rendering, not just one function.

**Questions to settle first**

*What makes two things stackable?*
- Probably not a property of the pair but of each activity: does it demand attention while it
  runs, or does it mostly run itself once started?
- Passive activities can absorb an active one on top. Two active ones cannot stack.
- Attention may be a spectrum rather than a flag, in which case stacking needs a budget rule
  rather than a boolean check.

*What blocks a stack even when attention allows it?*
- Shared physical resources. Two things needing the oven do not overlap however passive both are.
- Location. Stacking only works if both can happen where you are.
- Whether the passive one needs periodic check-ins, which fragments the active one.

*What does duration even mean here?*
- A passive activity has a wall-clock span and a much smaller engaged time. `average_duration`
  currently conflates the two, and recordings measure elapsed time, not attention.
- Deciding this early matters. It affects what the stopwatch is actually recording.

*What breaks downstream?*
- Total scheduled time stops being a sum, so any "does this fit in the day" check needs rewriting.
- Gap-aware placement changes meaning entirely when items may overlap.
- Priority ordering gets ambiguous. If a frog and a passive task share a slot, which one owns it?
- Passive activities often need to start early to finish in time, which can directly contradict
  "hardest thing first". Start-time constraints may matter more than priority for these.
- Peak-hours insights will double-count overlapping time unless the aggregation is changed.

*What has to exist in the schema?*
- Explicit start and end per item rather than an ordinal position.
- Probably a lane or track concept so the calendar can render overlaps without hiding one.

**Touch points when this gets built**

- `backend/app/services/strategies.py` — `_build_timeline` and every registered strategy
- `backend/app/models/schedule.py` — `ScheduleItem.position`
- `backend/app/models/task.py` — wherever an attention or passivity attribute would live
- `frontend/src/components/ScheduleTimeline.tsx`
- `frontend/src/components/calendar/CalendarGrid.tsx` and `SessionBlock.tsx`


---

## Multi-user: per-account users after the public deploy

**Raised:** 2026-09-17. Detailed notes live in `docs/multi-user-transition.md`; this entry is
the index card.

The end state is other people using the app under their own accounts, with their own Google
Calendars, after the Phase 6 deploy. That reverses the premise of
`docs/adr/0002-single-bearer-gate-no-tenancy.md`, which rejected tenancy on the grounds that
the app is single-user by design. The ADR is still right about today and still right about the
cost; it is no longer right about the destination.

**Why this is not a small change**

There is no identity anywhere in the system. One static bearer token is compared in middleware,
no table has an owner column, and the Google credential is a single `token.pickle` file held by
three module-level service singletons. "Another user" currently means "the same dataset and the
same Google account, accessed by someone else."

It is also not as large as the ADR implies. Ownership only has to land on three roots — `Task`,
`Schedule`, `StopwatchSession` — since `time_logs` and `schedule_items` reach an owner through
their parent FK. The query-filtering pass is 40 `db.query()` call sites across 896 lines of
routers, with ~114 backend tests as the net and Alembic already enforced by
`tests/test_migrations.py`. Order of magnitude: one of the existing phases, not a rewrite.

The expensive half is Google credentials — per-user encrypted storage, request-scoped services,
OAuth state out of process memory — plus login flows in both clients, since the web app has
never had a production auth path (its token is injected by the Vite dev proxy).

**Questions to settle first**

- Google Sign-In only, or email/password as well? Google-only is much less work and fits the
  product, but couples every account to a Google account.
- Open sign-up or invite-only? Invite-only keeps the unverified 100-user cap irrelevant and
  defers Google's verification review indefinitely.
- What happens to the existing year of recordings when they become "user 1's" rows?
- Account deletion and credential revocation, neither of which exists.
- Per-user hosting cost on Azure.

**Sequencing**

Finish single-user, deploy, then transition — deliberately. Steps 1-4 of the migration sketch
(identity, owner columns, the `Task.name` composite unique, query filtering) are safe to do
before a second user exists. The credential rework and verification review are the actual gate,
and the transition must land before the second person does: with no tenancy, sharing the bearer
token is not a limited preview, it is shared access to one dataset and one Google account.

**Touch points**

- `backend/app/main.py` — the bearer gate and the exempt-path list
- `backend/app/models/task.py` — the global `unique=True` on `name`
- `backend/app/models/` — owner columns on `Task`, `Schedule`, `StopwatchSession`
- `backend/app/routers/` — 40 `db.query()` call sites
- `backend/app/services/google_calendar.py` — `TOKEN_FILE`, `_pending_state`, `_save_credentials`
- `backend/app/routers/{calendar_auth,sessions,schedules}.py` — the three service singletons
- `frontend/vite.config.ts` and `mobile/src/services/auth.ts` — both clients' credential paths

---

## A per-week list of needed Activities

**Raised:** 2026-09-27, during the P21 phone check. Deferred by the user; not the default mode.

By default the calendar bank holds repeatable Activities that can be placed on any number of
days. The idea here is an opt-in list of the Activities a *specific* week needs — "this week I
must fit in three runs and one dentist trip" — that shrinks as they are placed, so an empty list
means the week is covered.

**Why it is not small.** Nothing in the model scopes an Activity to a week. It needs either a
week entity (a dated container of required Activities with counts) or a filter over Schedule
Items by ISO week, plus a way to show "placed 2 of 3".

**Questions to settle**

- Count per Activity ("run ×3"), or a plain checklist?
- Does placing an item on the calendar tick it off, or does recording it?
- Does an unfinished week roll over, or reset?
- Is this what a Regimen should grow into, or a separate thing beside it?

## Save a calendar day as a Regimen

**Raised:** 2026-09-27, in the Build 2 Activities-bank design. Wanted; deferred to keep Build 2 tight.

Days are now built on the calendar, but Regimens can still only come from the Schedule-tab
generator. A "Save as Regimen" action on the day view would copy the day's Schedule Items —
times and per-placement lengths included — into a new named Regimen, making "a Tuesday like
this one" repeatable.

**Why it is not in Build 2.** Small on its own (copy Items into a new Regimen), but Build 2
already reshapes the calendar, Apply, and the bank; this waits until those settle.

**Questions to settle**

- Does it copy Frog marks and Exported state (surely not the Google event ids)?
- Web and mobile both, or mobile first?

## Plan vs actual on the calendar

**Raised:** 2026-09-27, in the Build 2 Activities-bank design (ADR 0003).

Once the bank holds Activities, Recordings no longer appear on the calendar. The idea is to
show past Recordings as read-only blocks beside the day's plan, so a day can be compared with
what actually happened.

**Why it is not small.** It adds a second, non-draggable block type to a drag layer that was
just rebuilt for the phone, and Recordings without a start time have nowhere to go.

**Questions to settle**

- Side by side, overlaid, or a toggle?
- Is a Recording matched to the Schedule Item it fulfilled, or only shown by time?

## Deploy automatically from GitHub

**Raised:** 2026-10-04, in the Phase 6 design (D63). Deferred: deploys are by hand with `deploy.sh`.

A GitHub Actions workflow that builds the image on push to `main`, pushes it to GitHub's
registry, and updates the Azure Container App.

**Why it is not in Phase 6.** It puts Azure credentials in GitHub and adds a pipeline to debug
before anything has ever been deployed by hand once.

**Questions to settle**

- Every push to `main`, or only tagged releases?
- Azure login from Actions via OpenID Connect (no stored secret), or a service principal secret?
- Run the test suites in the workflow before building?

## Azure Key Vault for secrets

**Raised:** 2026-10-04, in the Phase 6 design (D57). Deferred to the multi-user phase.

Phase 6 keeps its four secrets in Container Apps secrets. Key Vault adds auditing and rotation,
and needs a managed identity for the app.

**Why it is not in Phase 6.** One user, four secrets; the setup outweighs the benefit until
per-user credentials and their encryption keys exist.

## AI planning coach

**Status (2026-11-05):** designed as Build 3a (`prd.md`, D92–D121): day planning only.
The entries below hold what was deferred from it.

**Raised:** 2026-10-12, at the start of the Build 2b design. Wanted after Build 2b's features
land, and before multi-user so the user is its only user while it is tuned.

A conversation that helps plan a day or week: it asks what needs doing, what energy and
commitments look like, and what is realistic given how long things actually take, then
proposes a plan the user adjusts and accepts. Modeled on the coaching session in the
`1111philo/ai-leaders` course (lesson 0.4), which ends by setting up the schedule itself.

**Why it is not small.** The roadmap's "AI later" premise imagined an AI planner as one more
Strategy, but a Strategy takes a list and returns an order. A coach is a conversation: a chat
screen in both clients, a server route that calls a model (key as a Container Apps secret like
the others), and a path from its answer to real Schedule Items for a date through the same save
path Generate uses. Build 2b's pieces are its inputs: Activities with real average durations,
quadrants, the Frog, peak hours, existing Blocks and Google events.

**Questions to settle**

- Day planning, week planning, or both?
- Cost per conversation: small but metered, and it matters more once multi-user exists.
- Privacy: calendar and Activity data go to the model provider.
- Does it learn over time ("you planned 6 hours of focus and did 3")? That leans on plan vs
  actual, above.
- Does its output land as a draft the user edits, or straight onto the calendar?

---

## Pomodoro as its own mode

**Raised:** 2026-10-29, Build 2c design (D80, D81).

Build 2c saves a Pomodoro run as one ordinary Recording (total work time) with a three-field
summary (work intervals, breaks, break seconds). That keeps Activity averages honest, but it
flattens the run: individual interval lengths, when each break happened, and how the pattern
changes over a day are lost.

**What the user wants from it:** to know their actual Pomodoro workflow for future reference:
typical work interval and typical break, per run and per Activity across runs.

**Questions to settle**

- Does a run get its own record (with its intervals as children), with the Recording derived
  from it, or does the Recording stay the unit and the run hang off it?
- Per-Activity rollups: average work interval and average break across runs, and where they
  show (the Activity detail screen is the obvious place).
- Should Pomodoro history inform Strategies or the planning coach (for example, splitting a
  long Activity into intervals on the Schedule)?
- Migrating Build 2c's summary fields into whatever replaces them.

## Reminder options per user

**Raised:** 2026-11-04, Build 2c gate (U13).

Build 2c's reminder is fixed. The phone posts one ordinary notification on the "Pomodoro
reminders" channel, with the phone's default sound and vibration and normal priority, so no
pop-up. The web shows a browser notification (when permission is granted) and plays a 0.3 s
880 Hz beep at low volume. The user found the web chime short and would like a longer one. Other
users may prefer it short, or want their own tone, so it should be a setting, not a new default.

**Questions to settle**

- Which options: chime length or tone, a custom sound, vibration on or off, a pop-up notification
  (higher channel importance) on the phone, an in-app banner or flashing display when an
  interval ends?
- Per user or per device? A setting on the server fits the multi-user work above (one set per account).
  Phone sound and vibration are partly owned by Android's channel settings, which the app can
  only set once per channel.
- Phone tone changes are native (a channel's sound is fixed when it is created), so they need
  an APK build and probably a new channel id.
- Should the "Recording" notification's countdown text round up like the in-app display (B58)?
  That is also native, so it fits the same build.

---

## Coach: week planning (Build 3b)

**Raised:** 2026-11-05, Build 3a design (D92, D98). Next after 3a, before multi-user.

The Coach plans a whole week in one Coaching conversation: one Proposal spread across up to
seven Schedules. Mostly a change of horizon once the day works: context for seven dates, a
Proposal whose items carry a date, validation per date, accept writing to several Schedules.

**Questions to settle**

- One Proposal for the week, accepted whole, or a day at a time?
- Does it overlap with the per-week list of needed Activities above, or replace it?
- Streaming replies (D118 deferred it), if 3a's latency feels slow.

When this is built: `coach_system.md` was written range-neutral in U17 (2026-11-18). It talks
about "the planned dates" from the context's `Planned dates:` line, never "one date", so a week
needs that line to list the range, not a prompt rewrite. Check the Opening (asks what has to
happen across the planned dates) and the Frog rule (one per date) still read right.

## Coach: Goals and user-set horizons

**Raised:** 2026-11-05, Build 3a design (D92, D99). After week planning.

A Goal is something to be able to do by a deadline: tango before a sister's wedding in six
weeks, Salesforce before an interview in three. The Coach turns it into practice sittings
spread across the days before the deadline, around a busy or chaotic schedule. This is the
long-term point of the Coach. In 3a a Goal can only be mentioned in conversation; nothing is
stored.

**Questions to settle**

- What a Goal stores: name, deadline, total practice wanted, sitting length, linked Activities?
- How progress is measured: Recordings of the linked Activities, or self-report?
- What happens when the plan falls behind: the Coach re-spreads, or asks?
- Horizon set by the user (a month, "until the 20th") versus derived from the deadline.

## Coach: a Coach tab

**Raised:** 2026-11-05, Build 3a design (D103). The user wants both entry points eventually;
3a has only "Plan with Coach" on the day view. A tab fits week and Goal planning, which are
not tied to one date. Changes D29's four tabs.

## Coach: the one-question rule

`coach_system.md` says "Ask one question at a time", but in the U17 rehearsal the Coach often
asked two in one message, and the user liked how those turns moved toward a Proposal within
the message limit. Left as written on purpose (2026-11-17): changing the line changes the
Coach's behaviour, so it waits until the user can recheck the Coach after each change.

## Coach notes: "is this still accurate?"

**Raised:** 2026-11-05, Build 3a design (D107). Notes already store `created_at` and
`confirmed_at` for this.

After some time a note may be stale ("Tuesdays are chaos" after a job change), and a stale
note quietly makes plans worse. The Coach would ask whether old notes still hold.

**Questions to settle**

- How old before asking: a fixed age, or a user setting?
- Asked inside a Coaching conversation, or as a review list in Settings?
- One question per note, or all stale notes at once?

## Coach: cost per user

**Raised:** 2026-11-05, Build 3a design (D97). 3a relies on the Anthropic console's $10/month
workspace limit. With other users: a per-user monthly cap enforced by the server, what the
owner is willing to spend on showing the app, and whether users pay. 3a's metrics
(`coach_calls`, `scripts/coach_metrics.py`) are the evidence: cost per accepted plan, turns to
a Proposal, and whether Sonnet is enough.

## Start reminders: native notifications

**Raised:** 2026-11-05, Build 3a design (D110, D114). Only if Google Calendar's reminder links
fail on the phone (B68 is the first fallback). Native scheduled notifications would also
cover Blocks that are never pushed to Google, at the cost of Kotlin work and an APK build per
change. Web reminders would only work while the tab is open.
