# Stopwatch Scheduler — PRD: Build 2c (Remake Phase 5, continued)

## Overview
Discrete tasks for the Ralph loop. Run with `./ralph.sh`. One task per session, in order. Mark
tasks DONE when complete; add failure notes if a task fails. Build 2b is archived at
`docs/prd-build2b-completed.md` (D66–D79); earlier builds and phases are in `docs/`.
Vocabulary is in `CONTEXT.md` (Pomodoro run, Work interval, Break added for this build).

**What Build 2c is:** a Pomodoro mode on both clients, and a timer notification on the phone
that can be acted on with the screen locked; plus the follow-ups found during Build 2b. A
Pomodoro run paces breaks, keeps the user on one Activity, and records the work pattern; it
saves as one Recording of the total work time with a summary of its intervals. Designed with
the user on 2026-10-25/29. Both clients. Single-user (D51). Replaces the B23/B24 HOLD stubs.

**Order (D91):** U11 (cold-run check) before the loop. B47 (follow-ups, app code only) ships
early by `deploy.sh`. B48 (server) before the clients. Phone: B49 core → B50 Settings → B51
screens → B52 native. Web: B53 → B54 → B55. Then U12 (one APK rebuild, both builds) and U13
(the gate).

**Statuses:** `PENDING` is the loop's. `USER` is the user's, by hand; the loop never picks it.

## Decisions (2026-10-29)

| # | Decision | Answer |
|---|---|---|
| D80 | Pomodoro's purpose | **Pacing, focus, and measurement.** It reminds you to break, keeps you on one Activity, and records the work pattern for later reference |
| D81 | What a run saves | **One Recording per Pomodoro run.** Duration = total work time, so it feeds the Activity's average like any Recording. It also carries a summary: work interval count, break count, total break seconds. The Recordings list shows "Pomodoro · N × avg Xm work · avg break Ym". Per-Activity rollups and a separate recording structure are future work |
| D82 | Activity | **Chosen before Start, required**: an existing Activity or "+ New Activity". The Recording's name defaults to the Activity's name |
| D83 | Interval lengths | **Defaults 25 / 5 / 15, long break after every 4 Work intervals; all four editable in Settings and stored on the server**, shared by both clients |
| D84 | Switching | **Every switch waits for the user's tap.** A length is a target, not a cutoff: the current interval keeps counting past it. When it is reached, **one reminder** (phone: sound and vibration; web: browser notification and a short sound), then the display shows **"+m:ss over"** |
| D85 | Pause, Finish, Reset | **Pause** freezes the current interval; paused time is neither work nor break. **Finish** ends the run from any interval: an open Work interval counts, an open Break is dropped; it opens the save sheet with the Activity filled in, and is disabled until some work is logged. **Reset** discards the run, confirming first if any work is logged |
| D86 | Entry | **A Stopwatch \| Pomodoro switch** on the phone's timer screen and the web stopwatch card, locked while anything is running. A run lives on one device |
| D87 | Surviving restarts | **A Pomodoro run survives an app restart (phone) and a reload (web).** The web stopwatch is brought up to the phone's level: it too survives a reload |
| D88 | Phone notification | **Pause/Resume on the notification** for any recording; a paused recording keeps its notification. During a run it also shows the interval, the time left or over, and **Start break / Start work**. Taps are recorded natively and applied by the app when it next runs |
| D89 | Follow-ups | Mobile Recording long-press **asks before deleting**. Activities shows **"Offline"** only when the device is offline; any other load failure shows **"Couldn't load"** and **Retry**. URL scheme **`stopwatchscheduler`**. The dev-only Settings-gear nudge goes; the Expo Tools button is switched back on |
| D90 | Cold-run check | **A USER setup step before the loop** (U11), not a loop task |
| D91 | Order | Follow-ups → server → phone (core, Settings, screens, native) → web → one rebuild → gate |

## Rules for this PRD

- **Tests first** (D20). Every code task is a `N.tests` / `N.impl` pair. The `.impl` session
  must not edit the `.tests` file except to add fixtures or mocks; if an assertion is wrong,
  mark BLOCKED and say why.
- **The loop never touches Azure, GitHub's registry, DNS, EAS, or live MySQL.** It never runs
  `deploy.sh`, `eas build` or `eas update`.
- **Schema changes go through Alembic**; `backend/tests/test_migrations.py` must pass. Build 2c
  has one migration (B48). `docker-entrypoint.sh` runs `alembic upgrade head` on deploy.
- **No dependency changes.** Kotlin may use what `timer-native`'s `build.gradle` already
  provides (AndroidX core/NotificationCompat).
- **Native code cannot be compiled here** (no Android SDK; `expo export` bundles JS only).
  Keep Kotlin changes small and mirror the existing service's idioms; B52 is verified on device
  in U12/U13. JS behaviour around it is tested through mocks of `modules/timer-native`.
- **The D13 parity fixture is frozen.** No Strategy changes.
- **Forward-compat** (`PROMPT.md`): keep DB access in the `db.query(Model)` idiom; nothing that
  blocks an owner column later (the settings row is one row now, one per owner later).
- **Product names** in UI and new code: Activity, Recording, Pomodoro run, Work interval,
  Break. Not "session" for a run.
- **Acceptance**
  - Backend: `cd backend && ./venv/bin/python -m pytest tests/`
  - Mobile, from `mobile/`: `npx jest --ci`, `npx tsc --noEmit`, `npx expo export --platform android`
  - Web, from `frontend/`: `npx vitest run`, `npx tsc --noEmit`, `npm run build`
  - Redirect test output to a file rather than piping it (GOTCHAS).

---

## Tasks

### U11. USER — Settle the mobile suite on a cold run
- **Status:** USER
- **Description:** Before the loop. Every Ralph iteration runs the mobile suite cold, and it once
  reported 9 failures cold that passed warm. In an Ubuntu tab, with Metro stopped:
  ```bash
  cd /root/Stopwatch-scheduler/mobile
  npx jest --ci --clearCache
  npx jest --ci > /tmp/jest-cold.txt 2>&1; echo "exit $?"; tail -5 /tmp/jest-cold.txt
  ```
  `exit 0` with every suite passed → done. Anything else: send the tail to Claude before
  starting the loop.
- **Acceptance Criteria:**
  - [ ] A cold run exits 0, or its failures are fixed or recorded before the loop starts

### B47.tests — Mobile: follow-ups (delete confirm, load errors, gear nudge)
- **Status:** PENDING
- **Description:** D89. Extend `RecordingsScreen.test.tsx` and `ActivitiesScreen.test.tsx`.
- **Contract:**
  - **Recording delete:** a long press on a Recording row calls `Alert.alert` with title
    `Delete Recording`, message `Delete "<name>"? This cannot be undone.` and buttons `Cancel`
    (style `cancel`) and `Delete` (style `destructive`). Only `Delete` calls
    `sessionAPI.delete`. Same pattern as `calendar.tsx`'s alerts.
  - **Activities load failure:** when the `['tasks']` query errors and
    `onlineManager.isOnline()` is false → `Offline — showing nothing` (unchanged text). When it
    errors and the device is online → `Couldn't load Activities` (testID `activities-error`)
    and a `Retry` button (testID `activities-retry`) that refetches. Other screens have no
    whole-screen load error; their mutation errors are unchanged.
  - **Gear nudge:** `(tabs)/_layout.tsx` uses `spacing.xs` for the header gear's right margin
    in all builds (no `__DEV__` branch).
- **Acceptance Criteria:**
  - [ ] Test: long press opens the alert; Cancel deletes nothing; Delete calls `sessionAPI.delete` with the id
  - [ ] Test: query error while offline → the Offline text; while online → `activities-error` and Retry refetches
  - [ ] Test: `_layout.tsx` contains no `__DEV__` (read the file as text)

### B47.impl — Mobile: follow-ups (delete confirm, load errors, gear nudge)
- **Status:** PENDING
- **Description:** Implement to the contract. App code only, so it reaches the phone through
  `deploy.sh` without a rebuild.
- **Acceptance Criteria:**
  - [ ] All B47.tests pass; mobile suite, tsc, and export pass

### B48.tests — Backend: Pomodoro settings and the Pomodoro summary on Recordings
- **Status:** PENDING
- **Description:** D81, D83. Add `backend/tests/test_pomodoro.py`.
- **Contract:**
  - **Settings:** new model `PomodoroSettings` (table `pomodoro_settings`, one row) with
    `work_minutes` (default 25), `break_minutes` (5), `long_break_minutes` (15),
    `long_break_every` (4). `GET /api/settings/pomodoro` returns the row, creating it with the
    defaults if absent. `PUT /api/settings/pomodoro` takes all four; each minutes value is an
    integer 1–180 and `long_break_every` 1–12, else 422. Behind the credential gate like every
    other route.
  - **Recording summary:** `stopwatch_sessions` gains nullable `pomodoro_work_intervals`,
    `pomodoro_breaks` (integers) and `pomodoro_break_seconds` (float). In
    `StopwatchSessionBase`, all three are optional and travel together: all null, or all set
    with `pomodoro_work_intervals >= 1`, `pomodoro_breaks >= 0`,
    `pomodoro_break_seconds >= 0`; otherwise 422. Create returns them; list and get include
    them. A Pomodoro Recording otherwise behaves exactly as any Recording (Time Log, average,
    `new_activity_name`).
  - **Migration:** one Alembic revision on top of `b8c9d0e1f2a3` adding the table and the three
    columns; downgrade drops them.
- **Acceptance Criteria:**
  - [ ] Test: GET on an empty table returns 25/5/15/4; PUT then GET returns the new values
  - [ ] Test: PUT with 0, 181, a missing field, or `long_break_every: 13` → 422
  - [ ] Test: create a Recording with all three summary fields and an Activity → returned as sent; the Activity's average includes the duration
  - [ ] Test: only some summary fields, or `pomodoro_work_intervals: 0` → 422
  - [ ] Test: a plain Recording returns the three fields as null
  - [ ] `test_migrations.py` passes with the new revision

### B48.impl — Backend: Pomodoro settings and the Pomodoro summary on Recordings
- **Status:** PENDING
- **Description:** Implement to the contract: model, schemas, a `routers/settings.py` mounted at
  `/api/settings`, and the migration.
- **Acceptance Criteria:**
  - [ ] All B48.tests pass; full suite passes

### B49.tests — Mobile: Pomodoro run core
- **Status:** PENDING
- **Description:** D84, D85, D87. Add `mobile/src/__tests__/pomodoroCore.test.ts` for a new pure
  module `mobile/src/timer/pomodoro.ts`, in the style of `core.ts` (no React, no I/O; every
  function takes `Clocks` or an explicit monotonic `at`).
- **Contract:**
  - `PomodoroConfig = { workMinutes, breakMinutes, longBreakMinutes, longBreakEvery }`.
  - `PomodoroState`: `status` (`running` | `paused`), `phase` (`work` | `break` | `longBreak`),
    the current phase's monotonic start and accumulated ms (as `core.ts` does), `workMs`
    (closed Work intervals), `breakMs` (closed Breaks), `workIntervals`, `breaks`, the run's
    `wallStart`, `taskId` or `newActivityName`, and `config`.
  - `startRun(config, activity, clocks)` → running, phase `work`.
  - `switchPhase(state, at)`: from work → closes the Work interval (adds its ms, `workIntervals
    + 1`) and enters `longBreak` when `workIntervals % longBreakEvery === 0`, else `break`; from
    a break → closes it (adds its ms, `breaks + 1`) and enters `work`. Allowed while paused
    (the paused interval closes at its accumulated time).
  - `pauseRun(state, at)` / `resumeRun(state, at)`: as `core.ts`'s pause and resume, on the
    current phase.
  - `phaseView(state, clocks)` → `{ phase, elapsedMs, targetMs, remainingMs, overMs }`: target
    from `config` for the phase; `remainingMs = max(0, target - elapsed)`; `overMs = max(0,
    elapsed - target)`.
  - `reminderDue(state, clocks)`: true once the current phase's elapsed reaches its target;
    `markReminded(state)` records it so it is due once per phase.
  - `finishRun(state, clocks)` → `FinishedRecording` fields plus `pomodoroWorkIntervals`,
    `pomodoroBreaks`, `pomodoroBreakSeconds`. An open Work interval counts (and increments
    `workIntervals`); an open Break is dropped. `durationSeconds` = total work. `canFinish`
    is true only when total work > 0.
  - `applyActions(state, actions)`: applies native notification actions (`pause` | `resume` |
    `switch`, each with `atElapsedMs`) in order, using each action's own monotonic time.
  - Restore after a reboot (monotonic clock went backwards) follows `core.restore`: the
    current phase's elapsed comes from the wall clock and the Recording is flagged as a clock
    jump.
- **Acceptance Criteria:**
  - [ ] Test: work 27 min then switch → `workIntervals` 1, phase `break`; the 4th switch from work enters `longBreak` with `longBreakEvery: 4`
  - [ ] Test: paused time counts toward neither work nor break
  - [ ] Test: `phaseView` at 30 min of a 25-min Work interval → remaining 0, over 5 min; `reminderDue` true once, false after `markReminded` until the next phase
  - [ ] Test: finish during work counts the open interval; finish during a Break drops it; `canFinish` false with no work
  - [ ] Test: `applyActions` with pause/resume/switch at given times matches calling the functions directly
  - [ ] Test: restore after a reboot keeps closed totals and flags a clock jump

### B49.impl — Mobile: Pomodoro run core
- **Status:** PENDING
- **Description:** Implement `mobile/src/timer/pomodoro.ts` to the contract. Add
  `pomodoro_work_intervals`, `pomodoro_breaks`, `pomodoro_break_seconds` (optional) to
  `StopwatchSession` and `StopwatchSessionCreate` in `mobile/src/types`, and a
  `settingsAPI.getPomodoro` / `updatePomodoro` pair in `services/api.ts`.
- **Acceptance Criteria:**
  - [ ] All B49.tests pass; mobile suite, tsc, and export pass

### B50.tests — Mobile: Pomodoro lengths in Settings
- **Status:** PENDING
- **Description:** D83. Extend `SettingsScreen.test.tsx`.
- **Contract:** A **Pomodoro** section in `app/settings.tsx` with four number fields (testIDs
  `pomodoro-work`, `pomodoro-break`, `pomodoro-long-break`, `pomodoro-long-every`) loaded from
  `settingsAPI.getPomodoro` and a **Save** button (`pomodoro-save`) that sends all four. Values
  outside 1–180 (1–12 for the count) disable Save and show the range under the field. A failed
  load shows the defaults greyed with "Couldn't load", and Save stays disabled.
- **Acceptance Criteria:**
  - [ ] Test: fields show the server's values; Save sends the edited four
  - [ ] Test: 0 or 181 disables Save and shows the range
  - [ ] Test: load failure → defaults, "Couldn't load", Save disabled

### B50.impl — Mobile: Pomodoro lengths in Settings
- **Status:** PENDING
- **Description:** Implement to the contract with a react-query query on `['settings',
  'pomodoro']`.
- **Acceptance Criteria:**
  - [ ] All B50.tests pass; mobile suite, tsc, and export pass

### B51.tests — Mobile: Pomodoro on the timer screen
- **Status:** PENDING
- **Description:** D81, D82, D84–D87. Extend `StopwatchScreen.test.tsx`, `timerStore.test.tsx`
  and `RecordingsScreen.test.tsx`.
- **Contract:**
  - A `Stopwatch | Pomodoro` switch (testIDs `mode-stopwatch`, `mode-pomodoro`) above the
    timer, disabled while the stopwatch or a run is not idle.
  - **Start in Pomodoro mode** opens an Activity picker (existing Activities and "+ New
    Activity" with a name field; no "None"). Start is disabled until one is chosen. The run
    starts with the server's Pomodoro settings (defaults if they cannot be loaded).
  - **While running:** the phase label (`Work` / `Break` / `Long break`), the current
    interval's time left or `+m:ss over` (testID `pomodoro-phase-time`), the run's total work,
    and buttons `Pause`/`Resume`, `Start break`/`Start work` (testID `pomodoro-switch`),
    `Finish` (disabled with no work), `Reset`.
  - **Reminder:** when `reminderDue`, the store calls a native `notifyPhaseDue(phase)` once
    (see B52) and marks it reminded. Mocked here.
  - **Finish** opens the existing save sheet with the Activity preselected and the name
    defaulting to it; saving sends duration = total work and the three `pomodoro_*` fields,
    through `useCreateSession` (so an offline save queues it).
  - **Reset** with work logged asks `Discard this Pomodoro run?` (Cancel / Discard).
  - **Persistence:** the run is stored under its own AsyncStorage key and restored on mount,
    as the stopwatch is; on restore and whenever the app becomes active, the store drains
    native actions (B52's `drainActions`, mocked) and applies them with `applyActions`.
  - **Recordings list:** a Recording with `pomodoro_work_intervals` shows
    `Pomodoro · N × avg Xm work · avg break Ym` under its name (avg break omitted when
    `pomodoro_breaks` is 0).
- **Acceptance Criteria:**
  - [ ] Test: the mode switch is disabled while the stopwatch runs
  - [ ] Test: Start is disabled until an Activity is chosen; "None" is not offered
  - [ ] Test: Start break / Start work move through the phases; the 4th break is a Long break
  - [ ] Test: past the target, `pomodoro-phase-time` shows `+m:ss over` and `notifyPhaseDue` is called once
  - [ ] Test: Finish sends total work and the three fields with the chosen Activity
  - [ ] Test: Reset with work asks; Cancel keeps the run
  - [ ] Test: a stored run restores on mount and queued native actions are applied
  - [ ] Test: the Recordings row shows the Pomodoro summary line

### B51.impl — Mobile: Pomodoro on the timer screen
- **Status:** PENDING
- **Description:** Implement to the contract in `(tabs)/index.tsx` and a `usePomodoro` hook
  beside `useTimer` in `timer/store.ts`. Add the JS side of B52's API to
  `TimerNative.types.ts` and `timer/native.ts` as optional calls (no-ops when the native module
  is absent or older), so this task does not depend on the rebuild.
- **Acceptance Criteria:**
  - [ ] All B51.tests pass; mobile suite, tsc, and export pass

### B52.tests — Mobile: notification actions and the Pomodoro notification
- **Status:** PENDING
- **Description:** D84, D88, D89 (scheme). Extend `native.test.ts`, `timerStore.test.tsx` and
  `appConfig.test.ts`. The Kotlin itself is checked on device (U12, U13).
- **Contract (the native API, in `TimerNative.types.ts`):**
  - `startForegroundService(startedAtElapsedMs, options?)` where `options` is
    `{ paused?: boolean, pomodoro?: { phase, phaseStartedAtElapsedMs, phaseAccumulatedMs,
    targetMs } }`. Called again whenever the timer's state changes (start, pause, resume,
    phase switch); it updates the one notification.
  - `stopForegroundService()` only on Reset and Finish/Save. **Pause no longer stops the
    service**: a paused recording keeps its notification, reading `Paused · m:ss` with a
    `Resume` button.
  - `drainActions(): { action: 'pause' | 'resume' | 'switch', atElapsedMs: number }[]` returns
    and clears the actions tapped on the notification, in order.
  - `notifyPhaseDue(phase)` posts the one-time reminder.
  - An `onTimerAction` event fires when the app is running; the store drains on it.
- **Contract (Kotlin, implement in B52.impl):** the service keeps the timer's anchors in its
  intent extras and updates its own notification every second as now. Actions are
  `NotificationCompat` buttons with `PendingIntent.getService` (immutable): the service applies
  pause/resume/switch to its own display at once, appends `{action, elapsedRealtime}` to a
  `SharedPreferences` list, and emits `onTimerAction` if the module is loaded. During a run the
  text is `Work · 12:34 left` or `Work · +3:10 over`; on reaching the target the service posts
  the reminder itself on a second channel (`pomodoro-reminder`, default importance, sound and
  vibration) once per phase, so it fires with the screen locked. `notifyPhaseDue` posts the
  same reminder when the app is in front.
  - `app.json` `scheme` becomes `stopwatchscheduler`.
- **Acceptance Criteria:**
  - [ ] Test: pause calls `startForegroundService` with `paused: true` and does not stop the service; reset and finish stop it
  - [ ] Test: during a run, each phase switch re-calls `startForegroundService` with the new `pomodoro` options
  - [ ] Test: an `onTimerAction` event drains and applies the actions; the displayed state matches
  - [ ] Test: with the native module absent, every call is a no-op and the timer still works
  - [ ] Test: `app.json` scheme is `stopwatchscheduler` for both variants

### B52.impl — Mobile: notification actions and the Pomodoro notification
- **Status:** PENDING
- **Description:** Implement the JS to the contract and the Kotlin in
  `modules/timer-native/android/` (`TimerNativeModule.kt`, `TimerForegroundService.kt`;
  `ios/` untouched beyond stubs that keep it compiling). Change the scheme. This changes the
  native fingerprint: nothing after it reaches the phone until U12.
- **Acceptance Criteria:**
  - [ ] All B52.tests pass; mobile suite, tsc, and export pass
  - [ ] Kotlin reviewed against the existing service: same imports style, immutable PendingIntents, no new dependencies

### B53.tests — Web: the stopwatch survives a reload
- **Status:** PENDING
- **Description:** D87. Extend `Stopwatch.test.tsx`.
- **Contract:** `useStopwatch` keeps time from timestamps, not by counting 10 ms ticks: running
  state is `{ startedAt, accumulatedMs }` and elapsed is `accumulatedMs + (Date.now() -
  startedAt)`, so a throttled background tab stays accurate. The state is saved to
  `localStorage` (`stopwatch.state`) on start, pause and reset, and restored on mount, running
  or paused. The save modal's `start_time` survives too.
- **Acceptance Criteria:**
  - [ ] Test: with fake timers and a mocked `Date.now`, elapsed follows the clock, not the tick count
  - [ ] Test: unmount while running and remount → still running with the elapsed time intact
  - [ ] Test: reset clears the stored state

### B53.impl — Web: the stopwatch survives a reload
- **Status:** PENDING
- **Description:** Implement to the contract in `hooks/useStopwatch.ts` and `Stopwatch.tsx`.
- **Acceptance Criteria:**
  - [ ] All B53.tests pass; web tsc clean; `npm run build` succeeds

### B54.tests — Web: Pomodoro lengths in Options
- **Status:** PENDING
- **Description:** D83. Extend or add `OptionsPage` tests.
- **Contract:** As B50, in `OptionsPage.tsx`: a Pomodoro section with the four fields
  (`data-testid` as B50's testIDs), Save sending all four via `settingsAPI.updatePomodoro`, the
  same ranges and load-failure behaviour. Add `settingsAPI` and the `pomodoro_*` fields to
  `frontend/src/services/api.ts` and `frontend/src/types`.
- **Acceptance Criteria:**
  - [ ] Test: fields show the server's values; Save sends the edited four
  - [ ] Test: out-of-range disables Save; load failure → defaults, Save disabled

### B54.impl — Web: Pomodoro lengths in Options
- **Status:** PENDING
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All B54.tests pass; web tsc clean; `npm run build` succeeds

### B55.tests — Web: Pomodoro on the stopwatch card
- **Status:** PENDING
- **Description:** D81, D82, D84–D87. Extend `Stopwatch.test.tsx` and `SessionList.test.tsx`.
- **Contract:** A pure `frontend/src/utils/pomodoro.ts` with B49's functions and rules (copy and
  adapt; there is no shared package; `Date.now()` is the clock). On the stopwatch card, B51's
  behaviour: the mode switch, the required Activity before Start, the phase display, Start
  break / Start work, Pause/Resume, Finish into the existing save modal with the Activity
  preselected and the three fields sent, Reset with confirmation, and the summary line in the
  Recordings list. **Reminder:** once per phase, a browser `Notification` (permission requested
  on the first run's Start; skipped silently if denied) and a short tone through `AudioContext`.
  **Persistence:** the run is saved to `localStorage` (`pomodoro.state`) and restored on mount.
- **Acceptance Criteria:**
  - [ ] Test: `utils/pomodoro.ts` passes the same cases as B49 (phases, long break, pause, finish rules)
  - [ ] Test: Start is disabled until an Activity is chosen; the mode switch is locked while running
  - [ ] Test: past the target, `+m:ss over` shows and `Notification` is constructed once
  - [ ] Test: Finish sends total work and the three fields
  - [ ] Test: a stored run restores on remount
  - [ ] Test: `SessionList` shows the Pomodoro summary line

### B55.impl — Web: Pomodoro on the stopwatch card
- **Status:** PENDING
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All B55.tests pass; web tsc clean; `npm run build` succeeds

### U12. USER — Ship, and rebuild the phone app for the new native code
- **Status:** USER
- **Description:** After the loop finishes. B52 changed native code, so the phone needs new
  APKs; phone updates only reach builds with the same native fingerprint. In an Ubuntu tab:
  ```bash
  cd /root/Stopwatch-scheduler
  git status --short            # must be empty; commit first
  ./deploy.sh                   # backend (runs the B48 migration) + web + phone update
  cd mobile
  eas build --profile preview --platform android
  eas build --profile development --platform android
  ```
  Install both from the links EAS prints (open each on the phone, tap Install/Update). Then in
  the "(Dev)" app's dev menu, switch the **Tools button** back on (D89).
- **Acceptance Criteria:**
  - [ ] `curl -s -o /dev/null -w "%{http_code}\n" https://api.stopwatchscheduler.app/api/settings/pomodoro` prints `401` (route exists, gate on)
  - [ ] Both apps installed; the standalone app lists Activities and Recordings
  - [ ] The standalone app shows the Stopwatch | Pomodoro switch

### U13. USER — Build 2c gate
- **Status:** USER
- **Description:** On the phone (standalone app) and on the web app:
  1. Settings/Options: change the lengths to 1 / 1 / 2, long break every 2; the other client
     shows the same values.
  2. Start a Pomodoro run on a chosen Activity. Let the first Work interval pass its minute:
     one reminder, then `+m:ss over`. On the phone, do this **with the screen locked**.
  3. From the phone's **notification**: Pause, Resume, Start break, Start work. Open the app;
     it matches. The second break is a Long break.
  4. Finish during a Break; save. The Recording's duration is the work only, the summary line
     is right, and the Activity's average moved.
  5. Reload the web page mid-run (and force-close the phone app mid-run): the run continues.
     Same for the plain web stopwatch.
  6. Long-press a Recording on the phone: it asks first. Turn Wi-Fi and data off and open
     Activities with a cold cache: "Offline"; back online with a bad token in Settings:
     "Couldn't load" and Retry. Restore the token.
  Set the lengths back to 25 / 5 / 15 / 4. Record results in `progress.md`.
- **Acceptance Criteria:**
  - [ ] All six pass on both clients where they apply; any failure recorded with the task it reopens
