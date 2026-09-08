# Stopwatch Scheduler — PRD: Mobile App, Build 1 (Remake Phase 5)

## Overview
Discrete tasks for the Ralph loop. Run with `./ralph.sh`. One task per
session, in order. Mark tasks DONE when complete; add failure notes if a task fails. Decisions
behind every task are in `roadmap.md` (D6–D33) and ADR 0001; vocabulary is in `CONTEXT.md`.

**What build 1 is:** an Android app that records, lists, and generates schedules against the
existing backend. Everything else — quadrant picker, frog, Pomodoro, insights — is build 2, a
later PRD.

**Build 1b (added 2026-09-08):** the calendar was pulled forward out of build 2. The web app is
not deleted until the phone has a calendar, Google pull/push, and export. P11 therefore stays
HOLD until P21 passes, not P10. Tasks P12–P21 and their amended rules are in the Build 1b
section below.

**Model:** run `./ralph.sh --model claude-opus-5` until P7.impl is DONE
(native module, timer core, offline queue). Sonnet (the default) for P8 onward.

**Statuses:** `PENDING` is the loop's. `USER` is the user's, by hand; the loop never picks it.
`HOLD` is not yet runnable; the user changes it when its prerequisite is met.

## Rules for this PRD

- **Only `mobile/` changes.** `frontend/` is frozen (roadmap D11) and `backend/` is done for now
  (Phase 4 is archived at `docs/prd-phase4-completed.md`). Two exceptions: P11, which deletes
  `frontend/`, and P12–P14, which add backend routes under the Build 1b rules below.
- **No dependency changes.** `npm install`, `npx expo install`, and `npx create-*` are not
  available to the loop. Every dependency build 1 needs is installed in P1 by the user. If a
  task genuinely needs a package that is missing, mark it BLOCKED naming the package; do not
  work around it.
- **Tests first.** Implementation tasks are paired `N.tests` / `N.impl`. The `.tests` session
  writes tests from the acceptance criteria and never implements. The `.impl` session makes
  them pass and **must not edit the `.tests` file** except to add fixtures or mocks it needs —
  no reformatting, no quote-style changes, no assertion edits. If an assertion is wrong, mark
  BLOCKED and say why.
- **Acceptance for every `.impl`:** its paired tests pass, `npx tsc --noEmit` is clean, and
  `npx expo export --platform android` bundles without error. All three, run from `mobile/`.
  The loop cannot run an emulator or a phone; that is what the USER tasks are for.
- **Verification commands** (from `mobile/`): `npx jest --ci`, `npx tsc --noEmit`,
  `npx expo export --platform android`. `npx expo prebuild` is not available; config-plugin
  correctness is verified by the user's EAS build in P5.
- **Stack is pinned** (D24): Expo Router for navigation, `StyleSheet` with a token file for
  styling, TanStack Query for server state and the offline mutation queue, axios for HTTP.
  Do not introduce NativeWind, React Navigation directly, Redux, or a second HTTP client.
- **API is frozen for P1–P11.** Everything those tasks need exists; see DIAGNOSTIC.md §5. Do not
  add routes. P12–P14 add the routes listed in their own tasks and nothing else.
  Collection endpoints need the trailing slash. All datetimes are UTC with a `Z` suffix.
- **Phone-first**: 44pt minimum touch targets, no hover states, portrait, safe-area
  aware. No centiseconds anywhere.

---

## Tasks

### P1. USER — Expo account, scaffold, dependencies
- **Status:** USER — DONE 2026-09-06. Note: the SDK 57 template puts routes under `src/app/`, not `app/`; every route path in this PRD is written that way. It also ships `AGENTS.md` (read the v57 docs) and a `.claude/settings.json` enabling the Expo plugin; both are committed and apply to loop sessions.
- **Description:** Everything that needs an account or a package install, done once so the loop never has to. From the repo root:
  ```bash
  npm install -g eas-cli
  npx create-expo-app@latest mobile            # default template: TypeScript + Expo Router
  cd mobile
  npx expo install expo-dev-client expo-secure-store @react-native-async-storage/async-storage @react-native-community/netinfo @react-native-community/datetimepicker
  npm install @tanstack/react-query @tanstack/react-query-persist-client @tanstack/query-async-storage-persister axios
  npm install --save-dev jest jest-expo @testing-library/react-native @types/jest
  npx create-expo-module@latest --local timer-native   # scaffolds mobile/modules/timer-native
  eas login                                     # create the account at expo.dev first
  eas init                                      # writes the projectId into app.json
  eas build:configure                           # writes eas.json with a development profile
  ```
  Then in `mobile/app.json`: `"name": "Stopwatch Scheduler"`, `"slug": "stopwatchscheduler"` (no dash, user preference), `android.package` = `app.workflow.stopwatch`, and add `"expo-dev-client"` to plugins if `eas build:configure` did not. Create `mobile/.env` with `EXPO_PUBLIC_API_URL=http://192.168.0.5:8000/api` and commit `mobile/.env.example` with the same key and no value.
- **Acceptance Criteria:**
  - [x] `mobile/package.json` lists every package above
  - [x] `mobile/modules/timer-native/` exists with `expo-module.config.json`, `android/`, `ios/`, `src/`
  - [x] `mobile/app.json` has the projectId, name, slug, and `app.workflow.stopwatch`
  - [x] `mobile/eas.json` has a `development` profile with `developmentClient: true`
  - [x] `mobile/.env` exists and is gitignored; `mobile/.env.example` is committed
  - [x] Committed: everything under `mobile/` except `node_modules`, `.env`, and `.expo`

### P2. Project baseline
- **Status:** DONE
- **Description:** Depends on P1 (USER). If `mobile/package.json` does not exist, P1 has not been done: change nothing, do not mark anything, output `RALPH_BLOCKED: P1 not done` and exit. Otherwise: turn the template into the project skeleton. No product behaviour yet, so this task has no `.tests` pair. Configure Jest (`"jest": { "preset": "jest-expo" }` and a `"test": "jest"` script in `package.json`; a `jest.setup.ts` if needed for async-storage's jest mock). Delete the template's example screens and components. Create `mobile/src/theme/tokens.ts` — colours, spacing, radii, type scale — lifted from the glassmorphic palette in `frontend/src/index.css` (read it; do not import it). Create the Router layout: `src/app/_layout.tsx` wraps everything in a QueryClientProvider (client created in P7; for now a plain `new QueryClient()`), `src/app/(tabs)/_layout.tsx` with four tabs — Stopwatch, Activities, Recordings, Schedule — each a placeholder screen, and `src/app/settings.tsx` reached from a gear icon in the header, not a tab. Add `dist/` to `mobile/.gitignore`.
- **Acceptance Criteria:**
  - [x] `npx jest --ci` runs one smoke test (`src/__tests__/smoke.test.tsx` renders the tabs layout) and passes
  - [x] `npx tsc --noEmit` clean; `npx expo export --platform android` succeeds
  - [x] Four tabs and a settings route exist; every screen is a stub with the tab's name
  - [x] No template example code remains

### P3.tests — Salvaged API client
- **Status:** DONE
- **Description:** Write `mobile/src/__tests__/api.test.ts` against the contract below. The client does not exist yet in `mobile/`; tests import from `../services/api` and `../services/auth` and will fail to resolve until P3.impl — that is the correct failure.
- **Contract:** `services/auth.ts` exports `getToken(): Promise<string | null>`, `setToken(t)`, `getApiUrl(): Promise<string>` (secure-store override, else `process.env.EXPO_PUBLIC_API_URL`), `setApiUrl(u)`. `services/api.ts` is the web client (`frontend/src/services/api.ts`) ported: same `taskAPI`, `timeLogAPI`, `sessionAPI`, `scheduleAPI`, `calendarImportAPI` surface, `baseURL` resolved from `getApiUrl()`, and an axios request interceptor that adds `Authorization: Bearer <token>` when a token is stored. New: `scheduleAPI.generate(req: GenerateRequest): Promise<GenerateResponse>` posting to `/schedules/generate` (no trailing slash — it is not a collection). Request/response shapes are in `docs/prd-phase3-completed.md`, task 3.
- **Acceptance Criteria:**
  - [x] Test: with a stored token, a `taskAPI.getAll()` request carries the bearer header (mock axios or use an adapter)
  - [x] Test: with no token, no `Authorization` header is sent
  - [x] Test: `scheduleAPI.generate` POSTs to `/schedules/generate` with the request body unchanged and returns the parsed body
  - [x] Test: collection calls keep their trailing slashes (`/tasks/`, `/sessions/`, `/schedules/`)
  - [x] Test: `getApiUrl()` returns the env default when nothing is stored, the stored value when set
  - [x] `expo-secure-store` is mocked in the tests; nothing touches real storage

### P3.impl — Salvaged API client
- **Status:** DONE
- **Description:** Copy `frontend/src/types/index.ts` → `mobile/src/types/index.ts`, `frontend/src/utils/calendarUtils.ts` → `mobile/src/utils/calendarUtils.ts`, `frontend/src/services/api.ts` → `mobile/src/services/api.ts`; then make the P3.tests contract pass. Add `GenerateRequest` / `GenerateResponse` types to `types/index.ts`. The token and URL live in `expo-secure-store` via `services/auth.ts`. Nothing in these three files may reference the DOM, `window`, or `localStorage`.
- **Acceptance Criteria:**
  - [x] All P3.tests pass; tsc clean; export succeeds
  - [x] `grep -rn "window\.\|document\.\|localStorage" mobile/src/services mobile/src/types mobile/src/utils` is empty
  - [x] `calendarUtils.ts` is byte-identical to the web copy apart from the import path, if any

### P4. Native timer module (the spike)
- **Status:** DONE
- **Model:** Opus
- **Description:** The riskiest task in the phase — see GOTCHAS ("RISK: the Android foreground-service module"). Implement the local Expo module scaffolded in P1 at `mobile/modules/timer-native/`. Android (Kotlin): `elapsedRealtime(): Double` returning `SystemClock.elapsedRealtime()`; `startForegroundService(startedAtElapsedMs: Double)` starting a foreground service that posts an **ongoing** notification whose text is the elapsed time, refreshed every second, tapping it opens the app; `stopForegroundService()`. Declare what the manifest needs through the module's config plugin or `app.json` android permissions: `FOREGROUND_SERVICE`, the Android 14+ foreground-service type and its permission, `POST_NOTIFICATIONS` (requested at runtime on Android 13+). No Stop button on the notification in build 1 (D28). iOS (Swift): stubs — `elapsedRealtime()` returns `Date().timeIntervalSince1970 * 1000`; the service functions are no-ops — so the iOS build compiles. TypeScript: `mobile/src/timer/native.ts` wraps the module and **falls back** to `Date.now()` and no-op service calls when the native module is unavailable (Jest, Expo Go), exposing `isNativeAvailable()` so the app can tell.
  The loop cannot build this. Acceptance is what it can check; the build is P5. If P5 fails, this task is reopened. If you cannot make it compile in your own judgement, mark BLOCKED with the exact obstacle — **do not** implement the fallback as the primary path (D25).
- **Acceptance Criteria:**
  - [x] Kotlin and Swift sources exist with the four functions; module registered in `expo-module.config.json`
  - [x] `mobile/src/timer/native.ts` exports `elapsedRealtime`, `startForegroundService`, `stopForegroundService`, `isNativeAvailable`
  - [x] `mobile/src/__tests__/native.test.ts` (write it in this task — a wrapper has no product behaviour to spec ahead) covers the fallback path: without the module, `elapsedRealtime()` returns a number close to `Date.now()` and service calls resolve without throwing
  - [x] tsc clean; export succeeds
  - [x] `mobile/README.md` documents: `eas build --profile development --platform android`, installing the APK from the EAS link, `npx expo start --dev-client`, and that Expo Go cannot run this app

### P5. USER — First dev build and notification check
- **Status:** USER — DONE 2026-09-06. EAS build `a5b68cfe` (first build ~35 min). Installed from the link; dev client connected to Metro on `192.168.0.5:8081`; `isNativeAvailable()` true; ongoing notification ticked, survived a two-minute screen lock, and cleared on stop. Checked with a throwaway probe on the Stopwatch tab, reverted afterwards. For later rebuilds prefer `eas build:dev`, which skips the build when the native fingerprint is unchanged.
- **Description:** `cd mobile && eas build --profile development --platform android`. Install the APK from the link on the phone. Run `npx expo start --dev-client` on this machine; open the app on the phone (same Wi-Fi; mirrored networking makes `192.168.0.5` reachable). From a throwaway button or the dev menu, call `startForegroundService(elapsedRealtime())`; confirm an ongoing notification appears with a ticking elapsed time and survives locking the screen for two minutes. Confirm `isNativeAvailable()` is true.
  If the build fails or the notification never appears: set P4 back to PENDING with a failure note in `progress.md` describing exactly what failed. If it fails a second time, decide between fixing the native build and accepting the timestamp-only fallback (roadmap D8, GOTCHAS) — that decision is yours, not the loop's.
- **Acceptance Criteria:**
  - [x] Dev build installed on a physical Android phone
  - [x] Ongoing notification shows elapsed time and survives screen lock
  - [x] `isNativeAvailable()` true in the dev build

### P6.tests — Timer core
- **Status:** DONE
- **Model:** Opus
- **Description:** Write `mobile/src/__tests__/timerCore.test.ts` against the contract. Pure logic, no renderer, no native module: the core takes its clocks as parameters so the tests inject fake ones.
- **Contract:** `mobile/src/timer/core.ts` exports a pure state machine. State is `{ status: 'idle' | 'running' | 'paused', wallStart: number | null, monoStart: number | null, accumulatedMs: number }` (all ms; `wall` is epoch ms, `mono` is monotonic ms). Functions take `(state, clocks)` where `clocks = { wall(): number, mono(): number }` and return a new state, never mutate: `start`, `pause`, `resume`, `reset`. `elapsedMs(state, clocks)` — from monotonic only. `finish(state, clocks)` returns `{ durationSeconds: number, startUtc: string, endUtc: string, clockJumpDetected: boolean }`: duration from monotonic, `startUtc`/`endUtc` ISO strings with a `Z` suffix from wall-clock, and `clockJumpDetected` true when `|wallΔ − monoΔ| > 2000` for the whole recording. `restore(persisted, clocks)` reconstructs a running state from `{ wallStart, monoStart, accumulatedMs, status }` after process death: if the monotonic clock has gone *backwards* since `monoStart` (the device rebooted), fall back to wall-clock for the interval since the reboot and set the jump flag.
- **Acceptance Criteria:**
  - [x] Tests: start→elapsed grows with mono, not wall; pause freezes; resume continues; reset returns to idle
  - [x] Test: wall clock jumping forward 1h mid-recording does not change `durationSeconds`; jump flag set
  - [x] Test: wall clock jumping back does not produce a negative or shortened duration; flag set
  - [x] Test: `startUtc`/`endUtc` end in `Z` and differ by wall elapsed, not mono elapsed
  - [x] Test: `restore` after simulated reboot (mono reset to a small number) yields a sane duration and the flag
  - [x] Test: durations are seconds as a float (the API's unit), not ms
  - [x] No imports from `react`, `react-native`, or the native module

### P6.impl — Timer core and persistence
- **Status:** DONE
- **Model:** Opus
- **Description:** Implement `core.ts` to the contract. Then `mobile/src/timer/store.ts`: a hook `useTimer()` that owns the state, uses `clocks = { wall: Date.now, mono: native.elapsedRealtime }`, persists `{ status, wallStart, monoStart, accumulatedMs }` to AsyncStorage on every transition and restores on mount, calls `startForegroundService` on start/resume and `stopForegroundService` on pause/reset/finish, and re-renders once per second while running (D27 — seconds, not centiseconds). Add `src/timer/format.ts`: `formatElapsed(ms) → "H:MM:SS"` (hours omitted under one hour).
- **Acceptance Criteria:**
  - [x] All P6.tests pass; tsc clean; export succeeds
  - [x] `useTimer` restores a running timer after the hook remounts (test with a mocked AsyncStorage)
  - [x] The render interval is 1000ms, and is cleared on unmount and on pause

### P7.tests — Offline save queue
- **Status:** DONE
- **Model:** Opus
- **Description:** Write `mobile/src/__tests__/offlineQueue.test.tsx`. The queue is TanStack Query's persisted mutations, not custom code; the tests exercise the configured client.
- **Contract:** `mobile/src/services/queryClient.ts` exports `queryClient` with mutations on the default `networkMode: 'online'` (so an offline mutation pauses without firing — `offlineFirst` would hit the API once before pausing and again on flush), `retry` bounded, and an AsyncStorage persister via `@tanstack/query-async-storage-persister` + `PersistQueryClientProvider`; `mutationCache` has defaults registered for the `createSession` mutation key so paused mutations can resume after restart (`queryClient.setMutationDefaults`). `onlineManager` is driven by `@react-native-community/netinfo`. `mobile/src/services/mutations.ts` exports `useCreateSession()` wrapping `sessionAPI.create` with an optimistic insert into the `['sessions']` list. On app start, `resumePausedMutations()` is called after hydration.
- **Acceptance Criteria:**
  - [x] Test: with `onlineManager.setOnline(false)`, `useCreateSession().mutate(...)` does not call the API and the mutation is paused
  - [x] Test: `onlineManager.setOnline(true)` flushes it; the API is called once with the original body
  - [x] Test: a paused mutation survives creating a fresh QueryClient from the same persisted storage and `resumePausedMutations()` sends it
  - [x] Test: while paused, the optimistic recording is visible in the `['sessions']` cache
  - [x] netinfo and AsyncStorage are mocked; axios is mocked at the adapter

### P7.impl — Offline save queue
- **Status:** DONE
- **Model:** Opus
- **Description:** Implement `queryClient.ts` and `mutations.ts` to the contract; replace the placeholder client from P2 in `src/app/_layout.tsx` with `PersistQueryClientProvider` and call `resumePausedMutations()` on hydrate. Only recording saves are offline-capable (roadmap D17); reads keep the default network mode and show a plain "offline" state.
- **Acceptance Criteria:**
  - [x] All P7.tests pass; tsc clean; export succeeds
  - [x] `src/app/_layout.tsx` uses `PersistQueryClientProvider`
  - [x] Queries for tasks/sessions/schedules are `networkMode: 'online'` (the default), not offline-first

### P6b.tests — Restored running timer re-arms the notification
- **Status:** DONE
- **Description:** Add to `mobile/src/__tests__/timerStore.test.tsx` (or a new `timerRestore.test.tsx` if that file does not exist) against this contract. Found by the P6.impl notes: `useTimer` restores a running timer after process death but never restarts the foreground service, so the notification is gone until the user presses Start again.
- **Contract:** when `useTimer` hydrates a persisted state whose `status` is `'running'`, it calls `startForegroundService(anchor)` once with the same anchor `resume` would use, so the notification reappears without user action. Hydrating an `'idle'` or `'paused'` state calls nothing. Hydrating `'running'` does **not** call `stopForegroundService`.
- **Acceptance Criteria:**
  - [x] Test: persisted running state → `startForegroundService` called exactly once after hydration
  - [x] Test: persisted paused state → no service call
  - [x] Test: persisted idle state (or nothing persisted) → no service call
  - [x] Native module mocked as in the existing timer store tests; no changes to `timerCore.test.ts`

### P6b.impl — Restored running timer re-arms the notification
- **Status:** DONE
- **Description:** Make the P6b.tests contract pass in `mobile/src/timer/store.ts`. Do not change `core.ts`.
- **Acceptance Criteria:**
  - [x] All P6b.tests pass; the existing 56 tests still pass; tsc clean; export succeeds

### P8a.tests — Stopwatch screen
- **Status:** DONE
- **Description:** Write `mobile/src/__tests__/StopwatchScreen.test.tsx` with `@testing-library/react-native`, mocking `useTimer`, `useCreateSession`, and `taskAPI.getAll`.
- **Contract:** `src/app/(tabs)/index.tsx`. Shows elapsed as `H:MM:SS`. Buttons: Start / Pause / Resume / Reset, each ≥44pt. When paused with elapsed > 0, a **Save** button opens a sheet with: an optional name field, an Activity picker (list from `taskAPI.getAll`, searchable, "none" allowed), and Save/Cancel. One save (D26): calls `useCreateSession().mutate` with `{ name, duration, task_id?, start_time, end_time }` from `finish()`; if the name is blank and an Activity is chosen, the name is the Activity's name; if blank with no Activity, the name is the date and time. After save: reset, sheet closes, a brief "Saved" confirmation; if `clockJumpDetected`, the confirmation says the clock moved during the recording. No second "save to activity" path exists.
- **Acceptance Criteria:**
  - [x] Tests: Start/Pause/Resume/Reset call the hook; Save appears only when paused with elapsed > 0
  - [x] Test: blank name + Activity "Gym" saves with `name: "Gym"` and `task_id`
  - [x] Test: blank name, no Activity saves with a date-time name and no `task_id`
  - [x] Test: `start_time`/`end_time` from `finish()` are passed through unchanged
  - [x] Test: clock-jump flag changes the confirmation text
  - [x] Test: every pressable has `accessibilityRole="button"` and a hit area ≥44

### P8a.impl — Stopwatch screen
- **Status:** DONE
- **Description:** Implement to the contract with `StyleSheet` and the P2 tokens. Big elapsed readout, large buttons, save sheet as a modal.
- **Acceptance Criteria:**
  - [x] All P8a.tests pass; tsc clean; export succeeds
  - [x] No hover styles; no centiseconds

### P8b.tests — Activities screen
- **Status:** DONE
- **Description:** `mobile/src/__tests__/ActivitiesScreen.test.tsx`, mocking `taskAPI`.
- **Contract:** `src/app/(tabs)/activities.tsx`. List from `useQuery(['tasks'], taskAPI.getAll)`: name, average, and recording count per row; tap a row → `src/app/activity/[id].tsx` showing `taskAPI.getStats(id)` (average, median, previous) and the last ten time logs. A "+" button opens a create sheet with a name field → `taskAPI.create`, invalidating `['tasks']`. Offline: a plain "Offline — showing nothing" state, not a crash. Durations formatted with `format.ts`.
- **Acceptance Criteria:**
  - [x] Test: rows render name, formatted average, count
  - [x] Test: create posts the name and refetches
  - [x] Test: detail screen shows the three stats and time logs
  - [x] Test: query error state renders the offline message

### P8b.impl — Activities screen
- **Status:** DONE
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [x] All P8b.tests pass; tsc clean; export succeeds

### P8c.tests — Recordings screen
- **Status:** DONE
- **Description:** `mobile/src/__tests__/RecordingsScreen.test.tsx`, mocking `sessionAPI`.
- **Contract:** `src/app/(tabs)/recordings.tsx`. List from `useQuery(['sessions'], sessionAPI.getAll)` newest first: name, duration, date, Activity name if attached. A search field filters by name client-side. A date-range control (two `datetimepicker`s) filters client-side. Entries queued offline appear with a "pending" marker. Source of truth for pending is the mutation cache — paused `createSession` mutations from `queryClient.getMutationCache()` — not only optimistic rows in the `['sessions']` cache, because a mutation restored after process death carries no optimistic row (P7.impl notes). Swipe or long-press → delete via `sessionAPI.delete`, invalidating `['sessions']`.
- **Acceptance Criteria:**
  - [x] Test: list order, fields, and Activity name
  - [x] Test: search narrows the list; clearing restores it
  - [x] Test: date range excludes out-of-range items
  - [x] Test: delete calls the API and the row disappears
  - [x] Test: a paused `createSession` mutation in the mutation cache renders as a pending row even when no optimistic row exists in `['sessions']`

### P8c.impl — Recordings screen
- **Status:** DONE
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [x] All P8c.tests pass; tsc clean; export succeeds

### P8d.tests — Schedule screen
- **Status:** DONE
- **Description:** `mobile/src/__tests__/ScheduleScreen.test.tsx`, mocking `taskAPI`, `scheduleAPI`.
- **Contract:** `src/app/(tabs)/schedule.tsx`, a three-step flow on one screen. **Step 1**: pick Activities from `['tasks']` (multi-select, search), each with an editable estimated duration defaulting to its average; set a start time (default: now rounded up to the next 15 minutes) and day end (default 23:00 local, sent as UTC). **Step 2**: call `scheduleAPI.generate` with `strategies: ['your-order', 'shortest-first', 'longest-first', 'best-fit']` (the four the user knows; the other three are build 2) and show the options as a vertical list of cards, each expandable to its timeline; select one. **Step 3**: name it (default: the date), optional "save as regimen", → `scheduleAPI.create` then `addItem` per timeline entry with `position` and `scheduled_time`. A **Regimens** section below lists `is_regimen` schedules with an "apply to date" action → `scheduleAPI.applyRegimen`. Existing Google Calendar events are **not** imported in build 1.
- **Acceptance Criteria:**
  - [x] Test: selecting Activities pre-fills durations from averages; edits are respected in the request
  - [x] Test: generate is called with the four strategies and UTC `Z` datetimes
  - [x] Test: options render one card per returned option; selecting one enables Save
  - [x] Test: save creates the schedule and one item per timeline entry, in order
  - [x] Test: regimen apply calls `applyRegimen` with the chosen date
  - [x] Test: generate error renders a retry, not a crash

### P8d.impl — Schedule screen
- **Status:** DONE
- **Description:** Implement to the contract. Reuse `calendarUtils` for rounding and formatting.
- **Acceptance Criteria:**
  - [x] All P8d.tests pass; tsc clean; export succeeds

### P8e.tests — Settings screen
- **Status:** DONE
- **Description:** `mobile/src/__tests__/SettingsScreen.test.tsx`, mocking `services/auth` and `axios`.
- **Contract:** `src/app/settings.tsx`, reached from a gear icon in the tab header. Fields: API URL (prefilled from `getApiUrl()`), bearer token (secure text entry, paste-friendly, D31), a **Test connection** button that GETs `/health` then `/tasks/` with the entered values and reports: unreachable / reachable but token rejected / OK. Save writes both via `setApiUrl` / `setToken` and invalidates all queries. Also shows: app version, whether the native timer module is available (`isNativeAvailable()`), and the number of pending offline saves.
- **Acceptance Criteria:**
  - [x] Test: fields prefill from stored values
  - [x] Test: Test connection distinguishes the three outcomes
  - [x] Test: Save persists both values and invalidates queries
  - [x] Test: pending-save count reflects paused mutations

### P8e.impl — Settings screen
- **Status:** DONE
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [x] All P8e.tests pass; tsc clean; export succeeds

### P9. App icon and identity
- **Status:** DONE
- **Description:** Port the icon before the web app is deleted. Expo wants a 1024×1024 PNG icon, an adaptive-icon foreground, and a splash image. Generate them from `frontend/public/icon.svg` with `sharp` (already in `frontend/node_modules`; run the script with `node` from `frontend/`) into `mobile/assets/`, and point `app.json` `icon`, `android.adaptiveIcon`, and `splash` at them. Keep `frontend/scripts/generate-icons.js` as the reference; add `mobile/scripts/generate-icons.js` that does the same for the mobile sizes.
- **Acceptance Criteria:**
  - [x] `mobile/assets/icon.png` (1024²), `adaptive-icon.png`, `splash.png` exist and are referenced in `app.json`
  - [x] `npx expo export --platform android` succeeds
  - [x] Script committed under `mobile/scripts/`

### P10. USER — Build 1 phone check (the gate to delete the web app)
- **Status:** USER
- **Description:** Phase 4 task 8 is done and migrated, so the Activities screen's averages update from recordings. Rebuild only if native code changed since P5; otherwise `npx expo start --dev-client` is enough. On the phone, against the LAN backend:
  1. Settings: paste the token, Test connection → OK.
  2. Start a recording, lock the screen for 10+ minutes, unlock, pause, save to an Activity. Duration matches wall time within 1s; the notification was visible while locked; the recording appears in Recordings and in MySQL; the Activity's average and count changed.
  3. Airplane mode on: record and save → pending marker in Recordings, count in Settings. Airplane mode off → it syncs; `GET /api/sessions/` shows it.
  4. Build a schedule from three Activities, pick an option, save it; it appears in `GET /api/schedules/`.
  When all four pass, record it in `progress.md`. P11 is **not** unblocked by this task — the
  calendar, Google sync, and export (P12–P20) ship first and are checked in P21.
- **Acceptance Criteria:**
  - [ ] All four checks pass on a physical phone
  - [ ] Any failure recorded in `progress.md` with the task it reopens

---

## Build 1b — Calendar, Google sync, export, finish

Added 2026-09-08. The calendar was pulled forward out of build 2 because the web app cannot be
retired without it (roadmap D11 assumed the calendar was not load-bearing; it is). Decisions
taken with the user on 2026-09-08:

| # | Decision | Answer |
|---|---|---|
| D34 | Google events in the app | **Read-only overlay.** Fetched per visible day, rendered as non-draggable blocks, never stored locally. No dedupe rules, no two-way sync |
| D35 | Pushing to Google | **Explicit only.** A recording or a whole schedule is pushed when the user taps push. Nothing is mirrored as a side effect of dragging |
| D36 | Calendar layout | **Day view with gesture drag/resize; week is a read-only agenda** (confirms D16). No 7-column droppable grid on a phone |
| D37 | Export transport | **One-time signed link.** `expo-web-browser` cannot attach the bearer token, and putting the token in a query string leaks it into logs and history. The app POSTs to get a short-lived token, then opens the GET |
| D38 | Export file handling | Backend streams the file. `expo-file-system` / `expo-sharing` are **not** installed and would force an EAS rebuild — do not add them |

### Rules for Build 1b (amend the rules above)

- **Backend is open for P12–P14 only**, and only for the routes each task names. P15 onward are
  `mobile/` only.
- **Schema changes go through Alembic.** `create_all` is out of startup (Phase 4b) and MySQL will
  not pick up a new column on its own — see GOTCHAS and the `schema-drift-mysql` note. Any model
  field needs a revision in `backend/alembic/versions/`, and `backend/tests/test_migrations.py`
  must still pass.
- **No dependency changes, still.** Everything Build 1b needs is already in `mobile/package.json`:
  `react-native-gesture-handler` (2.32), `react-native-reanimated` (4.5.1), `expo-image`,
  `expo-glass-effect`, `expo-web-browser`. If a task appears to need anything else, mark it
  BLOCKED rather than installing.
- **Backend acceptance:** `cd backend && source venv/bin/activate && python -m pytest tests/`.
- **Mobile acceptance is unchanged:** paired tests pass, `npx tsc --noEmit` clean,
  `npx expo export --platform android` bundles.

---

### P12. Backend — Google Calendar range fetch
- **Status:** DONE
- **Description:** `GET /api/auth/calendar/events` currently takes a single `date` and returns
  `{summary, start, end}` ([calendar_auth.py](backend/app/routers/calendar_auth.py)). A week
  agenda would need seven round trips. Add an optional `end_date` so one call covers a range,
  keeping the single-date form working unchanged. Add the Google event `id` to each returned
  event — the overlay needs a stable React key and P13 needs it to avoid duplicate pushes.
  Extend `GoogleCalendarService.get_events_for_date` or add `get_events_for_range` beside it.
- **Acceptance Criteria:**
  - [x] `?date=` alone behaves exactly as before, plus an `id` on each event
  - [x] `?date=&end_date=` returns every event in the inclusive range, each tagged with its day
  - [x] `tz_offset` is honoured for both forms
  - [x] 401 when Google is not authorized; 400 when `end_date` precedes `date`
  - [x] pytest covers all of the above with the calendar service mocked

### P13. Backend — push a schedule to Google Calendar
- **Status:** DONE
- **Description:** Recordings can already be pushed (`POST /api/sessions/{id}/calendar`), but
  regimens and plans cannot — they are Schedules with ScheduleItems, which have no calendar
  route. Add an Alembic revision adding `calendar_event_id VARCHAR(255) NULL` to
  `schedule_items`, then `POST /api/schedules/{id}/calendar` creating one Google event per item
  that has a `scheduled_time`, titled from `custom_name` or the Task's name and lasting
  `estimated_duration`, storing each event id on its item. Skip items that already carry an id
  so a second push does not duplicate. `DELETE /api/schedules/{id}/calendar` removes those
  events and clears the ids.
- **Acceptance Criteria:**
  - [x] Alembic revision present; `alembic check` clean; `test_migrations.py` passes
  - [x] POST creates one event per scheduled item and persists each `calendar_event_id`
  - [x] Items with no `scheduled_time` are skipped, not errored
  - [x] A second POST creates nothing new (idempotent)
  - [x] DELETE removes the events and nulls the ids
  - [x] 401 when Google is not authorized; 404 for an unknown schedule

### P14. Backend — export recordings and activities
- **Status:** DONE
- **Description:** CSV/JSON export exists only in the web app and is lost with it. The phone
  cannot open an authorized URL in a browser (D37), so: `POST /api/exports` (bearer-gated) takes
  `{resource: "sessions"|"tasks", format: "csv"|"json"}` and returns `{url, expires_at}` carrying
  an opaque single-use token valid 60 seconds; `GET /api/exports/{token}` streams the file with
  `Content-Disposition: attachment` and invalidates the token. Hold tokens in memory — this is a
  single-process single-user app and a restart losing them is fine. Do **not** accept the bearer
  token in a query string.
- **Acceptance Criteria:**
  - [x] POST requires the bearer token; GET with a valid token does not
  - [x] CSV has a header row; JSON is a list of objects; both cover every row of the resource
  - [x] A token works once; the second GET is 404
  - [x] An expired token is 404
  - [x] An unknown or malformed token is 404, never a stack trace
  - [x] pytest covers all of the above

### P15.tests — Calendar day view
- **Status:** PENDING
- **Description:** `mobile/src/__tests__/CalendarDayScreen.test.tsx`, mocking `sessionAPI` and
  `calendarImportAPI`.
- **Contract:** New tab `src/app/(tabs)/calendar.tsx`, added to the tab bar after Schedule. A day
  time grid built with the already-salvaged
  [calendarUtils.ts](mobile/src/utils/calendarUtils.ts) — `getTimeSlots`, `positionFromTime`,
  `timeFromPosition`, `snapToSlot`, `heightFromDuration`. Scheduled recordings
  (`sessionAPI.getScheduled`) render as blocks positioned by `scheduled_start`. Drag a block with
  `react-native-gesture-handler` + `react-native-reanimated` to move it, snapping to 15 minutes;
  drag its bottom edge to resize. Both commit via `sessionAPI.schedule`. A red current-time line
  when the day is today. Google events from P12 render as read-only blocks, visually distinct,
  never draggable (D34). Day nav via `previousDay`/`nextDay`. Blocks are 44pt minimum.
- **Acceptance Criteria:**
  - [ ] Test: scheduled recordings render at the right offset and height for their times
  - [ ] Test: dragging a block calls `sessionAPI.schedule` with 15-minute-snapped UTC `Z` times
  - [ ] Test: resizing changes `scheduled_end` only
  - [ ] Test: Google events render, and a drag gesture on one calls no API
  - [ ] Test: day nav refetches for the new date
  - [ ] Test: a Google fetch failure leaves the recordings visible, with a retry

### P15.impl — Calendar day view
- **Status:** PENDING
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All P15.tests pass; tsc clean; export succeeds

### P16.tests — Session bank and week agenda
- **Status:** PENDING
- **Description:** `mobile/src/__tests__/CalendarBankScreen.test.tsx`.
- **Contract:** On the Calendar tab, a collapsible bank of unscheduled recordings
  (`sessionAPI.getUnscheduled`) with a search field. Dragging one onto the grid schedules it at
  the drop time; a block dragged onto the bank calls `sessionAPI.unschedule`. A Day/Week toggle
  switches to a **read-only** agenda (D36): each day of the week as a section, its scheduled
  recordings and Google events listed in time order, tapping a day opening that day's view. No
  drag targets in week mode.
- **Acceptance Criteria:**
  - [ ] Test: the bank lists only unscheduled recordings; search narrows it
  - [ ] Test: dropping a bank item on the grid calls `schedule` with the drop time
  - [ ] Test: dropping a block on the bank calls `unschedule`
  - [ ] Test: week mode lists seven days in order with both sources merged
  - [ ] Test: week mode renders no drag handles; tapping a day switches to it

### P16.impl — Session bank and week agenda
- **Status:** PENDING
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All P16.tests pass; tsc clean; export succeeds

### P17.tests — Google push actions
- **Status:** PENDING
- **Description:** `mobile/src/__tests__/GooglePush.test.tsx`.
- **Contract:** Add `scheduleAPI.pushToCalendar(id)` / `removeFromCalendar(id)` (P13) and
  `calendarImportAPI.getEventsInRange` (P12) to `services/api.ts`. A block on the day view gets a
  push action calling `sessionAPI.addToCalendar`, and shows a marker when `is_on_calendar`. The
  Schedule tab gains a push action on a saved schedule and on a regimen, calling the P13 route,
  reporting how many events were created. Pushes are explicit only (D35) — nothing pushes on
  drag, drop, resize, or save.
- **Acceptance Criteria:**
  - [ ] Test: pushing a recording calls the sessions calendar route and shows the marker
  - [ ] Test: pushing a schedule calls the schedules calendar route once
  - [ ] Test: a second push is offered as remove, not another create
  - [ ] Test: a 401 from Google renders "authorize from a laptop" (D14), not a crash
  - [ ] Test: dragging, resizing, and saving a schedule call no calendar route

### P17.impl — Google push actions
- **Status:** PENDING
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All P17.tests pass; tsc clean; export succeeds

### P18.tests — Export from Settings
- **Status:** PENDING
- **Description:** `mobile/src/__tests__/ExportSettings.test.tsx`, mocking `axios` and
  `expo-web-browser`.
- **Contract:** Settings gains an Export section: Recordings and Activities, each CSV or JSON.
  Each button POSTs to `/api/exports` and opens the returned `url` with
  `WebBrowser.openBrowserAsync`. No file is written by the app (D38).
- **Acceptance Criteria:**
  - [ ] Test: each of the four buttons POSTs the right resource and format
  - [ ] Test: the returned url is what gets opened
  - [ ] Test: a failed POST shows an error and opens nothing
  - [ ] Test: offline shows "needs a connection" rather than a paused mutation

### P18.impl — Export from Settings
- **Status:** PENDING
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All P18.tests pass; tsc clean; export succeeds

### P19. Visual pass — background and glass
- **Status:** PENDING
- **Description:** The token file lifted the web palette but none of its effects, so every screen
  is flat `#1a1a2e`. **Copy `frontend/public/cloth_mural.jpg` to `mobile/assets/` as the first
  step of this task** — P11 deletes `frontend/` and the asset goes with it. Render it as a fixed
  background behind the tab screens with `expo-image`, under a `colors.scrim` overlay, and give
  cards the existing `glass` / `glassBorder` treatment. `expo-glass-effect` is already installed:
  spike it for real blur, and if it no-ops on Android fall back to the flat translucent fill
  rather than adding `expo-blur` (which is a native module and would force a rebuild). No test
  pair — this is presentation; acceptance is the build plus the P21 phone check.
- **Acceptance Criteria:**
  - [ ] `mobile/assets/cloth_mural.jpg` committed
  - [ ] Background renders behind all five tabs and Settings, text contrast preserved
  - [ ] Blur either works or degrades to the flat fill; no new dependency
  - [ ] tsc clean; `npx expo export --platform android` succeeds

### P20.tests — Display options
- **Status:** PENDING
- **Description:** `mobile/src/__tests__/DisplayOptions.test.tsx`.
- **Contract:** The web Options page let the user choose which duration hints to show. Add to
  Settings three toggles — average, median, previous — persisted in AsyncStorage under
  `userOptions`, defaulting to average on and the other two off. They control what
  `activities.tsx`, `activity/[id].tsx`, and the Schedule tab's duration hints display. Nothing
  server-side.
- **Acceptance Criteria:**
  - [ ] Test: defaults are average on, median and previous off
  - [ ] Test: toggling persists and survives a remount
  - [ ] Test: the Activities list and Activity detail show only enabled metrics
  - [ ] Test: the Schedule tab's hints follow the same setting

### P20.impl — Display options
- **Status:** PENDING
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All P20.tests pass; tsc clean; export succeeds

### P21. USER — Build 1b phone check (the real gate to delete the web app)
- **Status:** USER
- **Description:** No native module was added, so `npx expo start --dev-client` should be enough;
  rebuild only if the P19 spike forced a native change. On the phone, against the LAN backend:
  1. Calendar tab: drag a recording from the bank onto the grid, move it, resize it. Reopen the
     app — it is where you left it, and `GET /api/sessions/?scheduled=true` agrees.
  2. Today's Google events appear on the day view and cannot be dragged.
  3. Push a recording to Google, then a whole regimen. Both appear in Google Calendar, with the
     regimen's items at their scheduled times. Push the regimen again — no duplicates.
  4. Export recordings as CSV from Settings; the file opens and has every row.
  5. The background renders and text stays readable on every tab.
  When all five pass, flip P11 to PENDING and let the loop retire the web app.
- **Acceptance Criteria:**
  - [ ] All five checks pass on a physical phone
  - [ ] Any failure recorded in `progress.md` with the task it reopens

---

### P11. Retire the web app
- **Status:** HOLD (see P21) — runs last, after every Build 1b task
- **Description:** The only task allowed outside `mobile/`. Delete `frontend/` entirely (`git rm -r frontend`). Remove `CORS_ORIGINS` handling from `backend/app/main.py` and `.env.example` — a native app sends no `Origin`. Update `CLAUDE.md` (Quick Start, Tech Stack, Project Structure), `DIAGNOSTIC.md` §2–4 and §8 (frontend rows and the 16-test suite are gone; mobile replaces them), and `AsIWasSaying.md` §2. `GOOGLE_REDIRECT_URI` and the Google flow stay: the user authorizes from a laptop (roadmap D14).
- **Acceptance Criteria:**
  - [ ] `frontend/` gone; `git grep -n "frontend/"` returns only historical docs (`docs/`, `progress.md`, `roadmap.md`, ADRs, GOTCHAS)
  - [ ] Backend pytest passes; `CORS_ORIGINS` absent from `main.py`
  - [ ] Docs updated as listed
