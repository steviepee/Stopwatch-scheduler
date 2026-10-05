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
