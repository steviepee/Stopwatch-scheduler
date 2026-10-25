# Stopwatch Scheduler — PRD: Build 2b (Remake Phase 5, continued)

## Overview
Discrete tasks for the Ralph loop. Run with `./ralph.sh`. One task per session, in order. Mark
tasks DONE when complete; add failure notes if a task fails. Phase 6 is archived at
`docs/prd-phase6-completed.md` (D52–D65); Build 2a at `docs/prd-build2a-completed.md`
(D39–D50). Vocabulary is in `CONTEXT.md`.

**What Build 2b is:** the server's planning features reach both clients, and Recordings become
Activities in one step. The quadrant picker, the day's Frog, all seven Strategies behind one
dropdown, and a peak-hours hint; a Recording can create or join an Activity when saved or
afterwards; and the phone takes over-the-air updates so app-code changes stop needing a new
APK. Designed with the user on 2026-10-15. Both clients. Single-user (D51).

**Order:** B34 (over-the-air updates) is first so U9 — the one APK rebuild — can happen as
soon as it lands; everything after it reaches the phone by `deploy.sh`. B35 (server) comes
before the client tasks that use it. U10 is the gate.

**Build 2c** (Pomodoro, the Stop button on the notification) is HOLD at the end: native code,
designed in its own session after Build 2b ships (D79).

**Statuses:** `PENDING` is the loop's. `USER` is the user's, by hand; the loop never picks it.
`HOLD` is not yet runnable.

## Decisions (2026-10-15)

| # | Decision | Answer |
|---|---|---|
| D66 | Split | **Build 2b** is app code on server features that already exist (quadrant, Frog, Strategies, peak hours) plus Recordings-to-Activities. **Build 2c** is the native pair (Pomodoro, notification Stop) and one rebuild |
| D67 | Phone updates | **EAS Update** (`expo-updates`). One native rebuild (U9); after that, app-code changes reach the phone when the app is reopened. Native changes still need an EAS build |
| D68 | Update targeting | **`runtimeVersion` policy `fingerprint`**: an update only reaches APKs whose native code matches, computed automatically. Build 2c's updates wait for its APK |
| D69 | Shipping | **`deploy.sh` ships the phone update after the backend is live** (`eas update --channel preview`), one command in that order, so the phone never runs ahead of its server |
| D70 | Quadrant picker | **A 2×2 grid on the Activity's detail screen**, both clients: Urgent and Important / Important / Urgent / Neither; one tap sets both flags. A quadrant badge in the Activities list. New Activities are Q4 |
| D71 | Generator | Generate still computes **all 7 Strategies** in one call. **One dropdown** replaces the per-Strategy cards and **always starts on Your Order**; under it, only the selected plan's description, notes, and timeline. Switching is instant, with no new request |
| D72 | Eisenhower empty | When Eisenhower drops every selected Activity because none has a quadrant, show **"None of these Activities have a quadrant yet. Set them on the Activities tab."** in place of the timeline. "Consider delegating" keeps its wording |
| D73 | Frog pick | **A frog toggle on each selected Activity when generating**, at most one on. Sent to Generate and saved onto that day's Item **whichever Strategy is saved**; the Block shows a frog marker. No Frog toggle on placed Blocks |
| D74 | Second Frog on a day | **The new one replaces the old**, and the save confirmation says so: "Frog is now Taxes (was Laundry)." |
| D75 | Peak hours | **A tappable hint under Start time**: "Your peak hour: 9 AM. Use it." Tapping sets the start time; never applied on its own; hidden with no history |
| D76 | Recording → Activity at save | When the Recording's name matches no Activity, the picker shows **"+ New Activity: '<name>'"**. **"None" stays the default.** When it matches one, the row is **"Attach to <name>"**. Activity and Recording are created in **one request**, so the phone's offline queue replays a single call |
| D77 | Name match | **Case-insensitive, trimmed.** Matches MySQL's collation on the unique `tasks.name` |
| D78 | Saved Recordings | **An action list on every Recording**, both clients: *Attach to Activity* and *Make it an Activity* when it has none; *Change Activity* and *Detach* when it has one. Averages follow every move. A new Activity's average starts from that one Recording and it starts in Q4 |
| D79 | Build 2c timing | **Its own design session after Build 2b ships** |

## Rules for this PRD

- **Tests first** (D20). Every code task is a `N.tests` / `N.impl` pair. The `.impl` session
  must not edit the `.tests` file except to add fixtures or mocks; if an assertion is wrong,
  mark BLOCKED and say why.
- **The loop never touches Azure, GitHub's registry, DNS, EAS, or live MySQL.** It never runs
  `deploy.sh`, `eas build` or `eas update`.
- **Schema changes go through Alembic**; `backend/tests/test_migrations.py` must pass. Build 2b
  needs none: every column exists.
- **No dependency changes** except `expo-updates` in B34.
- **The D13 parity fixture is frozen.** No Strategy changes in this build.
- **Forward-compat** (`PROMPT.md`): keep DB access in the `db.query(Model)` idiom; nothing that
  blocks an owner column later.
- **Product names** in UI and new code: Activity, Recording, Schedule, Schedule Item, Block,
  Frog, Quadrant, Strategy.
- **Acceptance**
  - Backend: `cd backend && ./venv/bin/python -m pytest tests/`
  - Mobile, from `mobile/`: `npx jest --ci`, `npx tsc --noEmit`, `npx expo export --platform android`
  - Web, from `frontend/`: `npx vitest run`, `npx tsc --noEmit`, `npm run build`
  - Redirect test output to a file rather than piping it (GOTCHAS).

---

## Tasks

### B34.tests — Mobile: over-the-air updates configured
- **Status:** DONE
- **Description:** D67, D68, D69. Extend `mobile/src/__tests__/appConfig.test.ts`.
- **Contract:**
  - `app.json` gains `"runtimeVersion": {"policy": "fingerprint"}` and
    `"updates": {"url": "https://u.expo.dev/d31ca765-c177-496f-a42e-a0578d2fc5d4"}` (the
    existing `extra.eas.projectId`). `app.config.js` passes both through unchanged for both
    variants.
  - `eas.json`: `preview` gets `"channel": "preview"`; `development` gets
    `"channel": "development"`. Other `preview` fields unchanged.
  - `deploy.sh`, after the `az containerapp update` line, runs from `mobile/`:
    `eas update --channel preview --message "<short sha>: <commit subject>" --non-interactive`
    with `EXPO_PUBLIC_API_URL=https://api.stopwatchscheduler.app/api` set, so the update bakes
    the same URL the preview APK does. A failed backend update stops the script before it.
- **Acceptance Criteria:**
  - [x] Test: config has the fingerprint policy and the updates URL, with and without `APP_VARIANT=development`
  - [x] Test: `eas.json` channels are as above and `preview` keeps its env and APK build type
  - [x] Test: `deploy.sh` contains the `eas update --channel preview` line after `az containerapp update` (read the file as text)

### B34.impl — Mobile: over-the-air updates configured
- **Status:** DONE
- **Description:** `npx expo install expo-updates` from `mobile/` (the one dependency change),
  then implement to the contract. Do not run `eas update:configure` or anything that logs in to
  EAS. Add a GOTCHAS entry: a phone update only reaches APKs with the same native fingerprint,
  so a native change (Build 2c) needs U9's rebuild again; check with
  `npx expo-updates fingerprint:generate` if unsure.
- **Acceptance Criteria:**
  - [x] All B34.tests pass; mobile suite, tsc, and export pass
  - [x] `bash -n deploy.sh` passes

### U9. USER — Rebuild the phone app once for updates
- **Status:** USER
- **Description:** After B34 lands and is committed. From `mobile/`, in an Ubuntu tab:
  ```bash
  npm install -g eas-cli          # 23.2 → 24.x, also an open follow-up
  eas build --profile preview --platform android
  eas build --profile development --platform android
  ```
  Install both from the links EAS prints (open on the phone). Then prove an update arrives
  without an APK: from the repo root run `./deploy.sh` (it now ships the backend, then the
  phone update), force-close the standalone app, open it, close it, and open it again — the
  update downloads on the first open and applies on the second.
- **Acceptance Criteria:**
  - [ ] Both apps installed; the standalone app still lists Activities and Recordings
  - [ ] `eas update:list --branch preview` shows the update `deploy.sh` published
  - [ ] The phone runs it (any B35+ change that has landed is visible, or `eas update:list` shows it downloaded under the build's runtime version)

### B35.tests — Backend: Recordings create, join, and leave Activities
- **Status:** DONE
- **Description:** D76, D77, D78. Add `backend/tests/test_session_activity.py`. Two existing
  bugs this fixes, both in `routers/sessions.py` `update_session`: detaching sets the Time
  Log's `task_id` to `None`, which `time_logs.task_id` (NOT NULL) rejects with a 500; and
  attaching a Recording saved with no Activity does nothing, because it has no Time Log to move.
- **Contract:**
  - `StopwatchSessionCreate` and `StopwatchSessionUpdate` gain optional `new_activity_name`.
    Sending it with a non-null `task_id` → 422. Blank after trimming → 422.
  - **Resolving a name:** trim it; find an Activity whose name equals it ignoring case
    (`func.lower(Task.name) == name.lower()`). Found → use it. Not found → create the Activity
    with the trimmed name (Q4). This makes an offline save that replays after the same name
    was created elsewhere attach rather than fail.
  - **Create** with `new_activity_name`: the Activity, the Recording (with that `task_id`), and
    its Time Log are created in one transaction; the Activity's average and count include it.
  - **Update** to an Activity (`task_id` or `new_activity_name`) on a Recording that has none:
    creates the Time Log (`session_id` set, the Recording's duration) and adds the duration to
    the Activity's average and count.
  - **Update** from one Activity to another: as today, the Time Log moves and both averages
    follow.
  - **Update** with `task_id: null` on an attached Recording: deletes its Time Log and removes
    the duration from the old Activity's average and count. No 500.
  - Responses are the Recording as today, with the resolved `task_id`.
- **Acceptance Criteria:**
  - [x] Test: create with `new_activity_name: " Run "` and no Activity → Activity "Run" exists with count 1 and average equal to the duration; the Recording's `task_id` is its id
  - [x] Test: create with `new_activity_name: "run"` when "Run" exists → attaches to "Run"; no second Activity
  - [x] Test: both `task_id` and `new_activity_name` → 422; blank name → 422
  - [x] Test: attach a no-Activity Recording via `task_id` → a Time Log appears and the average includes it
  - [x] Test: attach via `new_activity_name` → new Activity created with that Recording
  - [x] Test: detach → 200, Time Log gone, old Activity's count and average no longer include it
  - [x] Test: move between Activities still updates both (existing behaviour, kept)

### B35.impl — Backend: Recordings create, join, and leave Activities
- **Status:** DONE
- **Description:** Implement to the contract in `routers/sessions.py` and `models/schemas.py`.
  One helper resolves a name to an Activity for both routes.
- **Acceptance Criteria:**
  - [x] All B35.tests pass; full suite passes

### B36.tests — Mobile: a Recording makes or joins an Activity when saved
- **Status:** DONE
- **Description:** D76, D77. Extend `StopwatchScreen.test.tsx` (the stop-and-save picker in
  `(tabs)/index.tsx`) and `RecordingsScreen.test.tsx` (the hand-entry `ManualForm`).
- **Contract:** In both pickers, below "None" and the matching Activities:
  - When the typed Recording name (trimmed) equals no Activity's name ignoring case, a row
    `+ New Activity: '<name>'` (testID `activity-new`, `manual-activity-new`). Selecting it
    sends `new_activity_name` and no `task_id`.
  - When it equals one, no new row; that Activity's row reads `Attach to <name>` and selecting
    it sends its `task_id` as today.
  - No row with an empty name. "None" stays selected by default.
  - The save goes through the same `useCreateSession` mutation, so an offline save queues the
    one payload with `new_activity_name` and replays it unchanged. On success, `['tasks']` is
    invalidated (already the case).
- **Acceptance Criteria:**
  - [x] Test: name "Laundry", no such Activity → the new row shows; saving sends `new_activity_name: "Laundry"` and no `task_id`
  - [x] Test: name "laundry " with Activity "Laundry" → no new row; "Attach to Laundry" is offered
  - [x] Test: default selection is None; saving without touching the picker sends neither field
  - [x] Test: the hand-entry form behaves the same
  - [x] Test: an offline save persists a payload carrying `new_activity_name` (extend `offlineQueue.test.tsx` if that is where the queue is exercised)

### B36.impl — Mobile: a Recording makes or joins an Activity when saved
- **Status:** DONE
- **Description:** Implement to the contract. Add `new_activity_name` to
  `StopwatchSessionCreate` in `mobile/src/types`.
- **Acceptance Criteria:**
  - [x] All B36.tests pass; mobile suite, tsc, and export pass

### B37.tests — Mobile: actions on a saved Recording
- **Status:** DONE
- **Description:** D78. Extend `RecordingsScreen.test.tsx`.
- **Contract:** Tapping a Recording row opens its actions. With no Activity: **Attach to
  Activity** (opens an Activity picker with search; choosing sends `PUT` with `task_id`) and
  **Make it an Activity** (sends `PUT` with `new_activity_name` = the Recording's name; when
  that name already matches an Activity ignoring case, the action reads **Attach to <name>**
  and sends that `task_id` instead). With an Activity: **Change Activity** (same picker, current
  one marked) and **Detach** (sends `task_id: null`). Existing delete stays. After any change
  the list shows the new Activity, and `['sessions']` and `['tasks']` are invalidated.
- **Acceptance Criteria:**
  - [x] Test: a no-Activity Recording offers Attach and Make it an Activity; an attached one offers Change and Detach
  - [x] Test: each action sends the body above
  - [x] Test: Make it an Activity becomes "Attach to <name>" when the name matches
  - [x] Test: after success the row's Activity label updates

### B37.impl — Mobile: actions on a saved Recording
- **Status:** DONE
- **Description:** Implement to the contract in `(tabs)/recordings.tsx`; add `update` to
  `sessionAPI` in `services/api.ts` if absent. Online only: show an error on failure, no queue.
- **Acceptance Criteria:**
  - [x] All B37.tests pass; mobile suite, tsc, and export pass

### B38.tests — Web: Recordings make, join, and leave Activities
- **Status:** DONE
- **Description:** D76, D77, D78, web. Extend `Stopwatch.test.tsx`, `ManualRecording.test.tsx`
  and `SessionList.test.tsx`.
- **Contract:** The Stopwatch save modal and hand entry get B36's rows and payloads (the web
  has no offline queue). Each Recording in `SessionList` gets B37's actions and bodies.
- **Acceptance Criteria:**
  - [x] Test: new-Activity row and "Attach to <name>" behave as in B36, in the save modal and hand entry
  - [x] Test: each Recording action sends B37's body and the list updates

### B38.impl — Web: Recordings make, join, and leave Activities
- **Status:** DONE
- **Description:** Implement to the contract in `Stopwatch.tsx`, the hand-entry form,
  `SessionList.tsx`, and `services/api.ts`; add `new_activity_name` to the web types.
- **Acceptance Criteria:**
  - [x] All B38.tests pass; web tsc clean; `npm run build` succeeds

### B39.tests — Mobile: quadrant picker and badge
- **Status:** DONE
- **Description:** D70. Extend `ActivitiesScreen.test.tsx`; add an activity-detail test if none
  covers `activity/[id].tsx`.
- **Contract:** The Activity detail screen shows a 2×2 grid: top row **Urgent & Important**
  (Q1), **Important** (Q2); bottom row **Urgent** (Q3), **Neither** (Q4). The current quadrant
  is highlighted. Tapping a cell sends `PUT /api/tasks/{id}` with both `is_urgent` and
  `is_important` and highlights it on success. The Activities list shows a small badge (Q1–Q4)
  on each row; Q4 shows no badge, so an unset list stays quiet.
- **Acceptance Criteria:**
  - [x] Test: each cell sends the right pair of flags
  - [x] Test: the current quadrant is highlighted from the Activity's flags
  - [x] Test: list badges show Q1–Q3 and nothing for Q4

### B39.impl — Mobile: quadrant picker and badge
- **Status:** DONE
- **Description:** Implement to the contract; `update` in `taskAPI` if absent.
- **Acceptance Criteria:**
  - [x] All B39.tests pass; mobile suite, tsc, and export pass

### B40.tests — Web: quadrant picker and badge
- **Status:** DONE
- **Description:** D70, web. Add `frontend/src/__tests__/TaskDetailModal.test.tsx`; badges in
  `TaskList.tsx`.
- **Contract:** As B39, in `TaskDetailModal.tsx` and the Activities list.
- **Acceptance Criteria:**
  - [x] Test: each cell sends the right pair of flags; current quadrant highlighted
  - [x] Test: list badges show Q1–Q3 and nothing for Q4

### B40.impl — Web: quadrant picker and badge
- **Status:** DONE
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [x] All B40.tests pass; web tsc clean; `npm run build` succeeds

### B41.tests — Mobile: one Strategy dropdown over all seven plans
- **Status:** DONE
- **Description:** D71, D72. Extend `ScheduleScreen.test.tsx`. Today `(tabs)/schedule.tsx`
  sends four Strategies and renders a card per plan.
- **Contract:**
  - Generate sends no `strategies` field (the server then computes all seven:
    your-order, shortest-first, longest-first, best-fit, best-fit-slots, eat-the-frog,
    eisenhower), keeping `avoid_existing: true`.
  - The per-plan cards are replaced by **one dropdown** (testID `strategy-picker`) listing each
    plan's `label`, selected on **Your Order** after every Generate. Under it, the selected
    plan's `description`, its `excluded` notes ("didn't fit"), its `flagged` notes ("consider
    delegating"), and its timeline. Changing the dropdown swaps these with no new request.
    Save saves the selected plan, as today.
  - **Eisenhower empty:** when the selected plan is Eisenhower, its timeline is empty, and every
    excluded reason is `not-urgent-not-important`, show
    "None of these Activities have a quadrant yet. Set them on the Activities tab." in place of
    the timeline and notes.
- **Acceptance Criteria:**
  - [x] Test: the Generate request has no `strategies` field
  - [x] Test: after Generate the dropdown shows "Your Order" and only that plan's timeline is rendered
  - [x] Test: choosing another Strategy shows its description and timeline without a second Generate call
  - [x] Test: Eisenhower with all-Q4 Activities shows the quadrant message
  - [x] Test: Save sends the selected plan's timeline

### B41.impl — Mobile: one Strategy dropdown over all seven plans
- **Status:** DONE
- **Description:** Implement to the contract. Reuse `PickerField` if it fits.
- **Acceptance Criteria:**
  - [x] All B41.tests pass; mobile suite, tsc, and export pass

### B42.tests — Web: one Strategy dropdown over all seven plans
- **Status:** DONE
- **Description:** D71, D72, web. Extend `ScheduleBuilder.test.tsx`; today
  `ScheduleBuilder.tsx` sends four Strategies.
- **Contract:** As B41, with a `<select>`.
- **Acceptance Criteria:**
  - [x] Test: as B41's five, in the web builder

### B42.impl — Web: one Strategy dropdown over all seven plans
- **Status:** PENDING
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All B42.tests pass; web tsc clean; `npm run build` succeeds

### B43.tests — Mobile: the day's Frog
- **Status:** PENDING
- **Description:** D73, D74. Extend `ScheduleScreen.test.tsx` and `CalendarDayScreen.test.tsx`.
  The server already stores `is_frog` on Schedule Items and keeps one per Schedule.
- **Contract:**
  - Each selected Activity on the Schedule tab has a frog toggle (testID
    `frog-toggle-<task_id>`); turning one on turns any other off. Generate sends `is_frog: true`
    on that Activity only.
  - Save sends `is_frog: true` on the Frog's Item whichever Strategy is selected.
  - **Replace message:** before saving to a date, the tab reads that date's Schedule
    (`GET /api/schedules/?start_date=D&end_date=D`). If it has a Frog Item and the save carries
    a different Frog, the save confirmation reads "Frog is now <new> (was <old>)."
  - Calendar Blocks whose Item has `is_frog` show a frog marker (testID `frog-marker-<item id>`).
- **Acceptance Criteria:**
  - [ ] Test: only one toggle can be on; Generate sends `is_frog` on that Activity only
  - [ ] Test: saving the Shortest First plan still sends `is_frog` on the Frog's Item
  - [ ] Test: with an existing Frog on the date, the confirmation names new and old
  - [ ] Test: a frog Item's Block shows the marker; others do not

### B43.impl — Mobile: the day's Frog
- **Status:** PENDING
- **Description:** Implement to the contract in `(tabs)/schedule.tsx` and the calendar Block.
- **Acceptance Criteria:**
  - [ ] All B43.tests pass; mobile suite, tsc, and export pass

### B44.tests — Web: the day's Frog
- **Status:** PENDING
- **Description:** D73, D74, web. Extend `ScheduleBuilder.test.tsx` and `CalendarView.test.tsx`.
- **Contract:** As B43, in `ScheduleBuilder.tsx` and `calendar/ItemBlock.tsx`.
- **Acceptance Criteria:**
  - [ ] Test: as B43's four, in the web builder and calendar

### B44.impl — Web: the day's Frog
- **Status:** PENDING
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All B44.tests pass; web tsc clean; `npm run build` succeeds

### B45.tests — Mobile: peak-hours hint
- **Status:** PENDING
- **Description:** D75. Extend `ScheduleScreen.test.tsx`.
- **Contract:** The Schedule tab calls
  `GET /api/insights/peak-hours?tz_offset=<new Date().getTimezoneOffset()>`. When `peak_hour`
  is not null, a hint under Start time reads "Your peak hour: 9 AM. Use it." (12-hour clock).
  Tapping it sets Start time to that hour on the selected date (minutes zero). The start time is
  never changed without the tap. `peak_hour: null` or a failed call → no hint, nothing else
  affected.
- **Acceptance Criteria:**
  - [ ] Test: `peak_hour: 9` shows "Your peak hour: 9 AM. Use it."; `peak_hour: 14` shows "2 PM"
  - [ ] Test: tapping sets the start time to that hour on the selected date
  - [ ] Test: null or an error → no hint; Start time unchanged on load

### B45.impl — Mobile: peak-hours hint
- **Status:** PENDING
- **Description:** Implement to the contract; add the call to `services/api.ts`.
- **Acceptance Criteria:**
  - [ ] All B45.tests pass; mobile suite, tsc, and export pass

### B46.tests — Web: peak-hours hint
- **Status:** PENDING
- **Description:** D75, web. Extend `ScheduleBuilder.test.tsx`.
- **Contract:** As B45, under the builder's start time.
- **Acceptance Criteria:**
  - [ ] Test: as B45's three, in the web builder

### B46.impl — Web: peak-hours hint
- **Status:** PENDING
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All B46.tests pass; web tsc clean; `npm run build` succeeds

### U10. USER — Build 2b gate
- **Status:** USER
- **Description:** After the loop finishes: commit, then `./deploy.sh` from the repo root. On
  the phone, reopen the standalone app twice so the update applies (no APK). Then, on the phone
  and on the web app:
  1. Set quadrants on three Activities; the list shows their badges.
  2. Generate with those three: the dropdown starts on Your Order; switch through all seven.
     Eisenhower orders by quadrant. With only Q4 Activities selected, it shows the quadrant
     message.
  3. Mark one as the Frog and save Shortest First; its Block shows the frog. Save another plan
     to the same day with a different Frog; the confirmation names both.
  4. The peak-hour hint appears; tapping it sets the start time.
  5. Record something with a new name, pick "+ New Activity" and save; it appears in Activities
     with one recording. Repeat with Wi-Fi and mobile data off; it saves when back online.
  6. On a Recording saved with "None": Make it an Activity, then Change Activity, then Detach;
     the averages follow each step.
  Record results in `progress.md`.
- **Acceptance Criteria:**
  - [ ] All six pass on both clients; any failure recorded with the task it reopens

---

## Tasks — Build 2c (HOLD: designed in its own session after Build 2b ships, D79)

Native code; needs an EAS build, and a new fingerprint means U9's rebuild again.

### B23. Pomodoro mode
- **Status:** HOLD — needs design. A mode of `timer/core.ts`: work/break intervals, a
  notification on each transition. Open: interval lengths, and whether a work interval becomes a
  Recording.

### B24. Stop button on the foreground notification
- **Status:** HOLD — needs design. The timer's Kotlin module can only start and stop its
  notification; app code does not run while the phone is locked.
