# Stopwatch Scheduler — PRD: Build 2 (Remake Phase 5, continued)

## Overview
Discrete tasks for the Ralph loop. Run with `./ralph.sh`. One task per session, in order. Mark
tasks DONE when complete; add failure notes if a task fails. Build 1 and 1b are archived at
`docs/prd-phase5-completed.md` (D22–D38). Vocabulary is in `CONTEXT.md` — use the product names
(Activity, Recording, Schedule, Schedule Item, Regimen, Bank, Block) in prose and new code.

**What Build 2a is:** the calendar plans Activities, not Recordings. The Bank lists Activities;
placing one creates a Schedule Item on that date's one Schedule (ADR 0003). Around that:
per-placement block length, Push day / Remove day, the Regimen Apply fix, feedback on Save and
Push, and hand-entered Recordings. Designed with the user on 2026-09-27. Both clients.

**Build 2b** (the rest of the Build 2 outline) is stubbed at the end, `HOLD` until designed.

**Statuses:** `PENDING` is the loop's. `USER` is the user's, by hand; the loop never picks it.
`HOLD` is not yet runnable; the user changes it when its prerequisite is met.

## Decisions (2026-09-27)

| # | Decision | Answer |
|---|---|---|
| D39 | Schedules per date | **One.** A Schedule's date is a local calendar date (`DATE`), required on every non-Regimen Schedule, absent on Regimens. Enforced by server-side find-or-create, **not** a unique index (forward-compat rule in `PROMPT.md`). Day Schedules have no name; Regimens keep theirs. ADR 0003 |
| D40 | Bank | **All Activities**, with search. Placing never removes one; the same Activity may be placed any number of times, overlaps allowed. An Activity with no history is marked "no history" and places at **10 minutes** |
| D41 | Block length | **Snapshot** of the Activity's average at placement, stored on the Schedule Item. Changeable for that one placement only; never feeds back into the Activity |
| D42 | Resizing | **Edit mode per Block.** Tap a Block → "Edit block" toggles edit mode: bottom-edge resize only, 5-minute snap, no move. Toggle off → move only, 15-minute snap. Replaces the old always-on grip that stole holds |
| D43 | Exported Blocks | Moving or resizing an Exported Block **updates its Google event** (amends D35: an already-pushed item mirrors edits; nothing is pushed for the first time as a side effect). The app only ever changes or deletes Google events whose id it stored on a Schedule Item |
| D44 | Save and Apply on an occupied date | **Append** to the day's Schedule. Generation receives the day's existing Items as `existing_events`, so it plans around them |
| D45 | Removing | Drag to Bank deletes that Item; if Exported, first ask whether to delete its Google event. **Remove day** opens one up-front dialog: **Clear all** (delete the day's Google events, then its Items) / **Remove from Google only** (delete the events, keep the Items) / **Cancel** |
| D46 | Recordings | **History only.** Recording scheduling and Recording push are removed — columns, routes, client code, both clients. The one Recording event still on Google is left for the user to delete by hand |
| D47 | Hand entry | A Recording entered by hand: name, Activity (optional), duration, and a **required** start prefilled to now minus the duration. Same create route as a stopwatch save |
| D48 | Frog | At most one per Schedule, enforced by the server: marking an Item clears the others |
| D49 | Day boundaries | A Block belongs to the date its start falls on, locally. No dragging a Block to another day — the web week grid constrains a move to the Block's own day column |
| D50 | Web slot click | Clicking an empty slot on the web calendar opens an **Activity picker** and places the chosen Activity there — the click equivalent of a Bank drop. It no longer creates a Recording |

## Rules for this PRD

- **Both clients and the backend are open**, each only for what its task names. `frontend/` is
  not frozen for this PRD — this overrides `PROMPT.md`'s note that it is.
- **Tests first** (D20). Every task is paired `N.tests` / `N.impl`. The `.tests` session writes
  tests from the contract and acceptance criteria and never implements. The `.impl` session
  makes them pass and **must not edit the `.tests` file** except to add fixtures or mocks it
  needs. If an assertion is wrong, mark BLOCKED and say why. A `.tests` task may delete or
  rewrite tests that assert behaviour this PRD removes; it says which in `progress.md`.
- **Schema changes go through Alembic.** Any model change needs a revision in
  `backend/alembic/versions/`; `backend/tests/test_migrations.py` must pass. The loop never
  touches live MySQL — B5 is the user's.
- **No dependency changes.** No `npm install`, `npx expo install`, or `pip install`. If a task
  genuinely needs a package, mark it BLOCKED naming it.
- **Times:** item times are UTC with a `Z` suffix. A Schedule's date is a plain `YYYY-MM-DD`.
  Where the server needs the user's day, the client sends `tz_offset` =
  `new Date().getTimezoneOffset()`, the same convention as `GET /api/auth/calendar/events`.
- **Google is always mocked in tests.** Every Google-touching route: 401 when not authorized,
  and never an event id the app did not store.
- **Acceptance**
  - Backend: `cd backend && source venv/bin/activate && python -m pytest tests/`
  - Mobile, from `mobile/`: `npx jest --ci`, `npx tsc --noEmit`, `npx expo export --platform android`
  - Web, from `frontend/`: `npx vitest run`, `npx tsc --noEmit`, `npm run build`
  - Redirect test output to a file rather than piping it (GOTCHAS).
- Mobile stack is pinned (D24). Phone-first: 44pt touch targets, no hover states.

---

## Tasks — Build 2a

### B1.tests — Schema: dated Schedules, Recordings lose scheduling
- **Status:** DONE
- **Description:** Backend tests for the model change. Update `test_sessions.py` and
  `test_timezones.py`: delete the tests for `PUT /sessions/{id}/schedule`, `/unschedule`,
  `POST|DELETE /sessions/{id}/calendar`, and the `scheduled` query param. Add tests in
  `test_schedules.py` for the new Schedule shape.
- **Contract:**
  - `StopwatchSession` loses `scheduled_start`, `scheduled_end`, `calendar_event_id`,
    `is_on_calendar`. Those four routes and the `scheduled` filter on `GET /api/sessions/` are gone
    (404/405 or ignored param, whichever FastAPI gives).
  - `Schedule.target_date` is a `DATE`; the schema field is `datetime.date` and serializes as
    `YYYY-MM-DD`. `Schedule.name` is nullable.
  - `POST /api/schedules/` with `is_regimen: false` requires `target_date` (422 without) and
    ignores `name`; with `is_regimen: true` requires `name` and rejects a `target_date` (422).
- **Acceptance Criteria:**
  - [x] Test: the removed Recording routes no longer exist, and a Recording response has none of the four fields
  - [x] Test: a day Schedule round-trips `target_date` as `"2026-09-29"`
  - [x] Test: day Schedule without a date → 422; Regimen without a name → 422; Regimen with a date → 422
  - [x] Test: `test_migrations.py` still exercises `alembic check` (unchanged)

### B1.impl — Schema: dated Schedules, Recordings lose scheduling
- **Status:** DONE
- **Description:** Model, schema, router and one Alembic revision: drop the four
  `stopwatch_sessions` columns; `schedules.target_date` DATETIME → DATE; `schedules.name`
  nullable. Remove the four Recording routes and the `scheduled` filter. Do not backfill data —
  B5 does that by hand. Update DIAGNOSTIC.md §5 for the removed routes.
- **Acceptance Criteria:**
  - [x] All B1.tests pass; the full pytest suite passes; `alembic check` clean

### B2.tests — Day Schedules: find-or-create, placement, frog
- **Status:** DONE
- **Description:** `backend/tests/test_day_schedules.py`.
- **Contract:**
  - `GET /api/schedules/?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` returns the non-Regimen
    Schedules in the inclusive range, with items, ordered by date. The existing `is_regimen` filter
    keeps working.
  - `POST /api/schedules/days/{date}/items` body `{task_id, scheduled_time, estimated_duration?}`
    places an Activity: finds the Schedule for `{date}` or creates it, then adds the Item. With no
    `estimated_duration`, the server seeds it from the Activity's `average_duration`, or **600**
    seconds if the Activity has none (0 or null). Returns the Item with its `schedule_id`.
  - `POST /api/schedules/` for a day Schedule whose date already has one **appends** its items to
    that Schedule and returns it. No second Schedule for a date is ever created by any route.
  - Setting `is_frog: true` on an Item (create, place, or `PUT .../items/{item_id}`) clears
    `is_frog` on every other Item in the same Schedule.
- **Acceptance Criteria:**
  - [x] Test: the range filter returns only day Schedules in range, in date order
  - [x] Test: placing on an empty date creates exactly one Schedule; placing again reuses it
  - [x] Test: seeding — average used when present; 600 when the Activity has no history; explicit value wins
  - [x] Test: the same Activity placed twice on one date yields two Items
  - [x] Test: `POST /api/schedules/` on an occupied date appends; the Schedule count for that date stays 1
  - [x] Test: a second frog clears the first, via each of the three routes

### B2.impl — Day Schedules: find-or-create, placement, frog
- **Status:** DONE
- **Description:** Implement to the contract in `routers/schedules.py`. One helper does
  find-or-create by date; every path that creates a day Schedule goes through it.
- **Acceptance Criteria:**
  - [x] All B2.tests pass; full suite passes

### B3.tests — Editing and removing Items with Google kept in step
- **Status:** DONE
- **Description:** `backend/tests/test_item_google_sync.py`, Google service mocked as in
  `test_schedule_calendar.py`.
- **Contract:**
  - `GoogleCalendarService.update_event(event_id, start_time, duration_seconds)` patches an
    event's start and end.
  - `PUT /api/schedules/{id}/items/{item_id}` that changes `scheduled_time` or
    `estimated_duration` on an Item with a `calendar_event_id` calls `update_event` with the new
    values. On an Item without one, it calls no Google method. 401 if the Item is Exported and
    Google is not authorized, with nothing saved.
  - `DELETE /api/schedules/{id}/items/{item_id}?delete_event=true|false` (default false). With
    `true` and an Exported Item, deletes the Google event first. With `false`, the event is left.
  - `DELETE /api/schedules/{id}/items/{item_id}/calendar` removes one Item's Google event and
    nulls its id; the Item stays.
  - `DELETE /api/schedules/{id}?delete_events=true|false` (Clear all, default false). With
    `true`, deletes every Exported Item's event, then the Schedule. 401 with nothing deleted if any
    Item is Exported and Google is not authorized.
  - The existing `DELETE /api/schedules/{id}/calendar` (Remove from Google only) is unchanged.
- **Acceptance Criteria:**
  - [x] Test: moving and resizing an Exported Item each call `update_event` once with the new start/duration
  - [x] Test: editing a non-Exported Item calls no Google method
  - [x] Test: item delete with and without `delete_event`; per-item calendar removal keeps the Item
  - [x] Test: Clear all deletes exactly the stored event ids, then the Schedule and its Items
  - [x] Test: every Google-touching route above is 401 unauthenticated and changes nothing
  - [x] Test: no route calls Google's delete or update with an id not stored on an Item

### B3.impl — Editing and removing Items with Google kept in step
- **Status:** DONE
- **Description:** Implement to the contract. `update_event` goes beside `create_event` in
  `services/google_calendar.py`.
- **Acceptance Criteria:**
  - [x] All B3.tests pass; full suite passes

### B4.tests — Regimen Apply shifts times onto the day
- **Status:** DONE
- **Description:** Extend `backend/tests/test_schedules.py`. Today `apply_regimen` drops
  `scheduled_time`, so an applied Schedule has no times and appears nowhere.
- **Contract:** `POST /api/schedules/{id}/apply` body `{target_date: "YYYY-MM-DD", tz_offset}`.
  Each Regimen Item with a `scheduled_time` is copied with its **local time of day** (computed with
  `tz_offset`) placed on `target_date`, converted back to UTC. Items without a time are skipped.
  The copies append into the day's Schedule (find-or-create, B2). Frog marks copy, subject to D48.
  Returns the day's Schedule.
- **Acceptance Criteria:**
  - [x] Test: a Regimen item at 07:30 local on 2026-09-28 applied to 2026-10-02 lands at 07:30 local on 2026-10-02, for a nonzero `tz_offset`
  - [x] Test: a local time whose UTC instant falls on the next UTC day still lands on the target local date
  - [x] Test: applying onto a date with a Schedule appends; applying twice gives two copies of each Item
  - [x] Test: time-less Regimen Items are skipped; the Regimen itself is unchanged

### B4.impl — Regimen Apply shifts times onto the day
- **Status:** DONE
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [x] All B4.tests pass; full suite passes

### B5. USER — Migrate the live database
- **Status:** USER
- **Description:** B1–B4 changed the schema; live MySQL does not know yet. The backend will 500
  on schedules and sessions until this is done. From the repo root:
  ```bash
  cd backend && source venv/bin/activate
  mysqldump -u root -p stopwatch_scheduler > ~/stopwatch-before-build2.sql   # backup
  alembic upgrade head
  mysql -u root -p stopwatch_scheduler -e "SELECT id, name, target_date FROM schedules WHERE is_regimen = 0;"
  ```
  Every day Schedule needs a date. Schedule #9 ("2026-09-26") had none; set it, and do the same for
  any other row the SELECT shows with a NULL date (its date is in its name or its items' times):
  ```bash
  mysql -u root -p stopwatch_scheduler -e "UPDATE schedules SET target_date = '2026-09-26' WHERE id = 9;"
  mysql -u root -p stopwatch_scheduler -e "SELECT target_date, COUNT(*) FROM schedules WHERE is_regimen = 0 GROUP BY target_date HAVING COUNT(*) > 1;"
  ```
  The last query must return nothing; if it shows a date, delete the extra Schedule for it. Then
  restart uvicorn (env and models load once).
- **Acceptance Criteria:**
  - [ ] `alembic current` shows head
  - [ ] No day Schedule has a NULL date; no date has two
  - [ ] `curl -H "Authorization: Bearer $API_TOKEN" "http://localhost:8000/api/schedules/?start_date=2026-09-20&end_date=2026-10-10"` returns 200

### B6.tests — Mobile: Activity Bank and day view on Schedule Items
- **Status:** DONE
- **Description:** Rewrite `mobile/src/__tests__/CalendarDayScreen.test.tsx` and
  `CalendarBankScreen.test.tsx` for the new model, keeping their gesture-registry mock. Remove
  tests of recording scheduling.
- **Contract:**
  - `services/api.ts`: remove `sessionAPI.schedule`, `unschedule`, `getScheduled`,
    `getUnscheduled`, `addToCalendar`, `removeFromCalendar`. Add `scheduleAPI.getRange(start, end)`,
    `placeActivity(date, body)`, `updateItem`, `deleteItem(scheduleId, itemId, deleteEvent)`,
    `removeItemFromCalendar`, `clearDay(id, deleteEvents)`. Types follow the B1–B3 shapes.
  - The day view's Blocks are the day's Schedule Items (`getRange(day, day)`), positioned by
    `scheduled_time`, height from `estimated_duration`, labelled with the Activity name.
  - The Bank lists **every** Activity (`taskAPI.getAll`) with a search field; Activities with no
    history show a "no history" marker. Dropping one on the grid calls `placeActivity` with the
    local date, the 15-minute-snapped drop time, and **no** `estimated_duration` (the server
    seeds it). The Activity stays in the Bank.
  - Dragging a Block moves it within the day (15-minute snap) via `updateItem`.
  - Dropping a Block on the Bank: not Exported → `deleteItem(…, false)`. Exported → a confirm
    with "Also delete from Google" / "Keep on Google" / "Cancel", mapping to `true` / `false` / no
    call.
  - The week agenda lists each day's Items from one `getRange` call plus Google events, read-only.
- **Acceptance Criteria:**
  - [x] Test: Blocks render from Schedule Items at the right offset and height
  - [x] Test: the Bank lists all Activities, search narrows it, the no-history marker shows, and a drop leaves the Activity listed
  - [x] Test: a drop calls `placeActivity` with the local date and a snapped UTC `Z` time, no duration
  - [x] Test: moving a Block calls `updateItem` with the snapped time only
  - [x] Test: drop-to-Bank for plain and Exported Blocks, each confirm choice
  - [x] Test: week agenda merges Items and Google events per day, no drag targets
  - [x] Test: Google events still render read-only and a drag on one calls no API

### B6.impl — Mobile: Activity Bank and day view on Schedule Items
- **Status:** DONE
- **Description:** Implement to the contract in `src/app/(tabs)/calendar.tsx`, `services/api.ts`,
  `types/index.ts`. Keep the P16-reopened drag mechanics (300 ms hold, ghost, `measureInWindow`
  conversion) — they work on the phone.
- **Acceptance Criteria:**
  - [x] All B6.tests pass; tsc clean; export succeeds
  - [x] `grep -rn "scheduled_start\|getUnscheduled\|addToCalendar" mobile/src` is empty

### B7.tests — Mobile: Block actions, edit mode, Push/Remove day, feedback
- **Status:** DONE
- **Description:** Rewrite `mobile/src/__tests__/GooglePush.test.tsx` for the calendar and add
  edit-mode tests.
- **Contract:**
  - Tapping a Block selects it and shows its actions: **Edit block**, **Remove from Google**
    (only when Exported; confirm first; calls `removeItemFromCalendar`).
  - **Edit block** toggles edit mode on that Block: a bottom-edge handle appears, dragging it
    calls `updateItem` with a new `estimated_duration` snapped to 5 minutes (minimum 5), and the
    Block cannot be moved. Pressing it again ends edit mode; the Block moves again and has no
    handle.
  - The day header gets **Push day** (`pushToCalendar` on the day's Schedule; hidden when every
    Item is Exported) and **Remove day** (only when the day has Items). Remove day opens one dialog
    — **Clear all** → `clearDay(id, true)`, **Remove from Google only** → `removeFromCalendar(id)`,
    **Cancel** → nothing.
  - Feedback: every push, remove and clear shows a working state, then success (with the event
    count for a push) or an error message. A 401 shows "authorize from a laptop" (D14). No
    failure is silent.
- **Acceptance Criteria:**
  - [x] Test: edit mode on → handle present, move gesture ignored, resize calls `updateItem` with a 5-minute-snapped duration
  - [x] Test: edit mode off → no handle, move works
  - [x] Test: Remove from Google confirms first and is absent on non-Exported Blocks
  - [x] Test: each Remove day choice makes exactly its call
  - [x] Test: Push day success shows the count; a 500 shows an error; a 401 shows the laptop message
  - [x] Test: no gesture ever pushes an Item that was not already Exported

### B7.impl — Mobile: Block actions, edit mode, Push/Remove day, feedback
- **Status:** DONE
- **Description:** Implement to the contract. The edit handle only exists in edit mode, which
  is what stops it stealing the move-hold (the reason resize was removed in P16-reopened).
- **Acceptance Criteria:**
  - [x] All B7.tests pass; tsc clean; export succeeds

### B8.tests — Mobile: Schedule tab saves into the day, Apply fixed, feedback
- **Status:** DONE
- **Description:** Update `mobile/src/__tests__/ScheduleScreen.test.tsx`.
- **Contract:**
  - Generating for a date fetches that day's Items (`getRange`) and passes them as
    `existing_events` alongside the Google events.
  - Save of a day plan sends `target_date` (local `YYYY-MM-DD`) and the items in one
    `scheduleAPI.create` call, with no name field shown. The name field shows only when saving as a
    Regimen, and is required then.
  - Save shows saving → saved, or an error that leaves Save enabled to retry. The P8d-reopened
    guard against duplicate taps stays.
  - Apply sends `{target_date, tz_offset}` and reports success with the date, or an error.
  - Schedule-tab push/remove report success and failure the same way as B7.
- **Acceptance Criteria:**
  - [x] Test: existing Items reach `generate` as `existing_events`
  - [x] Test: day Save sends `target_date` and no name; Regimen Save requires a name
  - [x] Test: Save success, failure, and retry states
  - [x] Test: Apply sends a local date and `tz_offset`, and shows its outcome
  - [x] Test: a push failure is shown, not silent

### B8.impl — Mobile: Schedule tab saves into the day, Apply fixed, feedback
- **Status:** PENDING
- **Description:** Implement to the contract in `src/app/(tabs)/schedule.tsx`.
- **Acceptance Criteria:**
  - [ ] All B8.tests pass; tsc clean; export succeeds

### B9.tests — Mobile: hand-entered Recording
- **Status:** PENDING
- **Description:** Extend `mobile/src/__tests__/RecordingsScreen.test.tsx`.
- **Contract:** An **Add manually** button on the Recordings screen opens a form: name, Activity
  (optional, same picker as the stopwatch save), duration (hours and minutes), and start date
  and time, prefilled to now minus the duration and following it until the user edits the start.
  Save calls `sessionAPI.create` with `duration`, `start_time`, `end_time` = start + duration, and
  `task_id` if chosen. A zero duration cannot be saved.
- **Acceptance Criteria:**
  - [ ] Test: the start prefills to now minus the duration and tracks duration changes until edited
  - [ ] Test: Save sends the right body, with and without an Activity
  - [ ] Test: zero duration disables Save; a failed save shows an error and keeps the form

### B9.impl — Mobile: hand-entered Recording
- **Status:** PENDING
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All B9.tests pass; tsc clean; export succeeds

### B10.tests — Web: calendar on Schedule Items
- **Status:** PENDING
- **Description:** Rewrite `frontend/src/__tests__/CalendarView.test.tsx`.
- **Contract:** The B6 and B7 behaviour on the web week grid, with these differences:
  - `frontend/src/services/api.ts` and `types/index.ts` get the same API changes as B6.
  - `SessionBank` becomes an Activity Bank. `@dnd-kit` drops place an Activity; a Block moves
    only within its own day column (D49) — a drop in another column snaps back with no API call.
  - Clicking an empty slot opens an Activity picker (reuse `CreateEventModal`'s search, not its
    Recording creation) that calls `placeActivity` at that slot (D50).
  - Clicking a Block shows its actions (Edit block, Remove from Google); edit mode shows the
    resize handle, 5-minute snap, no move — the handle does not exist outside edit mode.
  - Each day column header gets Push day and Remove day with the D45 dialog; feedback as B7.
  - Recording push/remove buttons are removed from the Recordings list (`SessionList`,
    `HomePage`).
- **Acceptance Criteria:**
  - [ ] Test: Blocks render from Schedule Items; the Bank lists all Activities
  - [ ] Test: bank drop and slot click both call `placeActivity` with the slot's local date and time
  - [ ] Test: a cross-column drop makes no call
  - [ ] Test: edit mode toggling and a 5-minute resize
  - [ ] Test: drop-to-Bank confirm for an Exported Block; each Remove day choice
  - [ ] Test: a push failure is shown

### B10.impl — Web: calendar on Schedule Items
- **Status:** PENDING
- **Description:** Implement to the contract in `frontend/src/components/calendar/`,
  `pages/HomePage.tsx`, `components/SessionList.tsx`, `services/api.ts`, `types/index.ts`.
- **Acceptance Criteria:**
  - [ ] All B10.tests pass; web tsc clean; `npm run build` succeeds
  - [ ] `grep -rn "scheduled_start\|unschedule\|addToCalendar" frontend/src` is empty

### B11.tests — Web: Schedule builder, Apply, hand entry
- **Status:** PENDING
- **Description:** `frontend/src/__tests__/ScheduleBuilder.test.tsx` and
  `frontend/src/__tests__/ManualRecording.test.tsx`.
- **Contract:** B8 for `ScheduleBuilder` / `ScheduleList` / `HomePage`'s apply (local
  `target_date`, `tz_offset`, existing Items as `existing_events`, name only for Regimens,
  visible success and failure). B9 for the web Recordings list: an **Add manually** form with the
  same fields, prefill and body.
- **Acceptance Criteria:**
  - [ ] Test: day Save sends `target_date` and no name; Apply sends a local date and `tz_offset`
  - [ ] Test: Save and Apply show success and failure
  - [ ] Test: hand entry prefill and body, as B9

### B11.impl — Web: Schedule builder, Apply, hand entry
- **Status:** PENDING
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All B11.tests pass; web tsc clean; `npm run build` succeeds

### B12. USER — Build 2a check, phone and browser
- **Status:** USER
- **Description:** B5 done and uvicorn restarted. Phone: `cd mobile && npx expo start --dev-client`
  (no native change in Build 2a, so no rebuild). Browser: `cd frontend && npm run dev`, open
  `http://localhost:3000`. On the phone unless marked:
  1. Drop the same Activity on tomorrow twice and on the day after once. It stays in the Bank. An
     Activity with no history places at 10 minutes.
  2. Move a Block. Edit block → stretch it by 10 minutes → Edit block again → move it. Reopen the
     app; everything is where you left it. The Activity's average is unchanged.
  3. Push day. The events appear in Google Calendar. Move and stretch a pushed Block; the Google
     event follows. Your own Google events are shown but cannot be dragged or changed.
  4. Drag a pushed Block to the Bank and choose "Also delete from Google". Remove day → Remove
     from Google only: the Blocks stay, the events go. Push again, then Remove day → Clear all.
  5. Schedule tab: generate for a day that already has Blocks — the plan avoids them. Save; it
     appears on the calendar beside them, with visible "saved" feedback.
  6. Apply a Regimen to a day; its items land at the Regimen's times on that day.
  7. Add a Recording by hand for a run earlier today; it appears in Recordings and the CSV
     export, and its Activity's average moves.
  8. **Browser:** click an empty slot, pick an Activity; it appears on the phone after a refresh.
     Edit mode and Remove day work the same.
- **Acceptance Criteria:**
  - [ ] All eight checks pass
  - [ ] Any failure recorded in `progress.md` with the task it reopens

---

## Tasks — Build 2b (HOLD: each needs a design pass with the user before it is written)

Outline items carried from `AsIWasSaying.md` §5. The loop never picks `HOLD`. Each becomes a
`.tests`/`.impl` pair for both clients once designed.

### B20. Quadrant picker on the Activity screen
- **Status:** HOLD — needs design. `PUT /api/tasks/{id}` with `is_urgent` / `is_important`.

### B21. Daily Frog pick
- **Status:** HOLD — needs design. Server side is done in B2 (one per Schedule); this is the UI.

### B22. Selectable Strategies
- **Status:** HOLD — needs design. Expose `eat-the-frog`, `eisenhower`, `best-fit-slots`.

### B23. Pomodoro mode
- **Status:** HOLD — needs design. A mode of `timer/core.ts`: work/break intervals, a
  notification on each transition. Open: interval lengths, and whether a work interval becomes a
  Recording.

### B24. Stop button on the foreground notification
- **Status:** HOLD — needs design. Native change; needs an EAS rebuild.

### B25. Peak hours as the suggested start time
- **Status:** HOLD — needs design. `GET /api/insights/peak-hours` seeds the Schedule tab's start.
