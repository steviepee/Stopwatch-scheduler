# Stopwatch Scheduler — PRD: Mobile App, Build 1 (Remake Phase 5)

## Overview
Discrete tasks for the Ralph loop. Run with `./ralph.sh --prd prd-phase5.md`. One task per
session, in order. Mark tasks DONE when complete; add failure notes if a task fails. Decisions
behind every task are in `roadmap.md` (D6–D33) and ADR 0001; vocabulary is in `CONTEXT.md`.

**What build 1 is:** an Android app that records, lists, and generates schedules against the
existing backend. When it passes the phone check (task P10) the web app is deleted. Everything
else — quadrant picker, frog, Pomodoro, insights, calendar — is build 2, a later PRD.

**Model:** run `./ralph.sh --prd prd-phase5.md --model claude-opus-5` until P7.impl is DONE
(native module, timer core, offline queue). Sonnet (the default) for P8 onward.

**Statuses:** `PENDING` is the loop's. `USER` is the user's, by hand; the loop never picks it.
`HOLD` is not yet runnable; the user changes it when its prerequisite is met.

## Rules for this PRD

- **Only `mobile/` changes.** `frontend/` is frozen (roadmap D11) and `backend/` belongs to
  `prd.md`. The one exception is P11, which deletes `frontend/`.
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
- **API is frozen.** Everything the app needs exists; see DIAGNOSTIC.md §5. Do not add routes.
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
- **Status:** PENDING
- **Description:** Depends on P1 (USER). If `mobile/package.json` does not exist, P1 has not been done: change nothing, do not mark anything, output `RALPH_BLOCKED: P1 not done` and exit. Otherwise: turn the template into the project skeleton. No product behaviour yet, so this task has no `.tests` pair. Configure Jest (`"jest": { "preset": "jest-expo" }` and a `"test": "jest"` script in `package.json`; a `jest.setup.ts` if needed for async-storage's jest mock). Delete the template's example screens and components. Create `mobile/src/theme/tokens.ts` — colours, spacing, radii, type scale — lifted from the glassmorphic palette in `frontend/src/index.css` (read it; do not import it). Create the Router layout: `src/app/_layout.tsx` wraps everything in a QueryClientProvider (client created in P7; for now a plain `new QueryClient()`), `src/app/(tabs)/_layout.tsx` with four tabs — Stopwatch, Activities, Recordings, Schedule — each a placeholder screen, and `src/app/settings.tsx` reached from a gear icon in the header, not a tab. Add `dist/` to `mobile/.gitignore`.
- **Acceptance Criteria:**
  - [ ] `npx jest --ci` runs one smoke test (`src/__tests__/smoke.test.tsx` renders the tabs layout) and passes
  - [ ] `npx tsc --noEmit` clean; `npx expo export --platform android` succeeds
  - [ ] Four tabs and a settings route exist; every screen is a stub with the tab's name
  - [ ] No template example code remains

### P3.tests — Salvaged API client
- **Status:** PENDING
- **Description:** Write `mobile/src/__tests__/api.test.ts` against the contract below. The client does not exist yet in `mobile/`; tests import from `../services/api` and `../services/auth` and will fail to resolve until P3.impl — that is the correct failure.
- **Contract:** `services/auth.ts` exports `getToken(): Promise<string | null>`, `setToken(t)`, `getApiUrl(): Promise<string>` (secure-store override, else `process.env.EXPO_PUBLIC_API_URL`), `setApiUrl(u)`. `services/api.ts` is the web client (`frontend/src/services/api.ts`) ported: same `taskAPI`, `timeLogAPI`, `sessionAPI`, `scheduleAPI`, `calendarImportAPI` surface, `baseURL` resolved from `getApiUrl()`, and an axios request interceptor that adds `Authorization: Bearer <token>` when a token is stored. New: `scheduleAPI.generate(req: GenerateRequest): Promise<GenerateResponse>` posting to `/schedules/generate` (no trailing slash — it is not a collection). Request/response shapes are in `docs/prd-phase3-completed.md`, task 3.
- **Acceptance Criteria:**
  - [ ] Test: with a stored token, a `taskAPI.getAll()` request carries the bearer header (mock axios or use an adapter)
  - [ ] Test: with no token, no `Authorization` header is sent
  - [ ] Test: `scheduleAPI.generate` POSTs to `/schedules/generate` with the request body unchanged and returns the parsed body
  - [ ] Test: collection calls keep their trailing slashes (`/tasks/`, `/sessions/`, `/schedules/`)
  - [ ] Test: `getApiUrl()` returns the env default when nothing is stored, the stored value when set
  - [ ] `expo-secure-store` is mocked in the tests; nothing touches real storage

### P3.impl — Salvaged API client
- **Status:** PENDING
- **Description:** Copy `frontend/src/types/index.ts` → `mobile/src/types/index.ts`, `frontend/src/utils/calendarUtils.ts` → `mobile/src/utils/calendarUtils.ts`, `frontend/src/services/api.ts` → `mobile/src/services/api.ts`; then make the P3.tests contract pass. Add `GenerateRequest` / `GenerateResponse` types to `types/index.ts`. The token and URL live in `expo-secure-store` via `services/auth.ts`. Nothing in these three files may reference the DOM, `window`, or `localStorage`.
- **Acceptance Criteria:**
  - [ ] All P3.tests pass; tsc clean; export succeeds
  - [ ] `grep -rn "window\.\|document\.\|localStorage" mobile/src/services mobile/src/types mobile/src/utils` is empty
  - [ ] `calendarUtils.ts` is byte-identical to the web copy apart from the import path, if any

### P4. Native timer module (the spike)
- **Status:** PENDING
- **Model:** Opus
- **Description:** The riskiest task in the phase — see GOTCHAS ("RISK: the Android foreground-service module"). Implement the local Expo module scaffolded in P1 at `mobile/modules/timer-native/`. Android (Kotlin): `elapsedRealtime(): Double` returning `SystemClock.elapsedRealtime()`; `startForegroundService(startedAtElapsedMs: Double)` starting a foreground service that posts an **ongoing** notification whose text is the elapsed time, refreshed every second, tapping it opens the app; `stopForegroundService()`. Declare what the manifest needs through the module's config plugin or `app.json` android permissions: `FOREGROUND_SERVICE`, the Android 14+ foreground-service type and its permission, `POST_NOTIFICATIONS` (requested at runtime on Android 13+). No Stop button on the notification in build 1 (D28). iOS (Swift): stubs — `elapsedRealtime()` returns `Date().timeIntervalSince1970 * 1000`; the service functions are no-ops — so the iOS build compiles. TypeScript: `mobile/src/timer/native.ts` wraps the module and **falls back** to `Date.now()` and no-op service calls when the native module is unavailable (Jest, Expo Go), exposing `isNativeAvailable()` so the app can tell.
  The loop cannot build this. Acceptance is what it can check; the build is P5. If P5 fails, this task is reopened. If you cannot make it compile in your own judgement, mark BLOCKED with the exact obstacle — **do not** implement the fallback as the primary path (D25).
- **Acceptance Criteria:**
  - [ ] Kotlin and Swift sources exist with the four functions; module registered in `expo-module.config.json`
  - [ ] `mobile/src/timer/native.ts` exports `elapsedRealtime`, `startForegroundService`, `stopForegroundService`, `isNativeAvailable`
  - [ ] `mobile/src/__tests__/native.test.ts` (write it in this task — a wrapper has no product behaviour to spec ahead) covers the fallback path: without the module, `elapsedRealtime()` returns a number close to `Date.now()` and service calls resolve without throwing
  - [ ] tsc clean; export succeeds
  - [ ] `mobile/README.md` documents: `eas build --profile development --platform android`, installing the APK from the EAS link, `npx expo start --dev-client`, and that Expo Go cannot run this app

### P5. USER — First dev build and notification check
- **Status:** USER
- **Description:** `cd mobile && eas build --profile development --platform android`. Install the APK from the link on the phone. Run `npx expo start --dev-client` on this machine; open the app on the phone (same Wi-Fi; mirrored networking makes `192.168.0.5` reachable). From a throwaway button or the dev menu, call `startForegroundService(elapsedRealtime())`; confirm an ongoing notification appears with a ticking elapsed time and survives locking the screen for two minutes. Confirm `isNativeAvailable()` is true.
  If the build fails or the notification never appears: set P4 back to PENDING with a failure note in `progress.md` describing exactly what failed. If it fails a second time, decide between fixing the native build and accepting the timestamp-only fallback (roadmap D8, GOTCHAS) — that decision is yours, not the loop's.
- **Acceptance Criteria:**
  - [ ] Dev build installed on a physical Android phone
  - [ ] Ongoing notification shows elapsed time and survives screen lock
  - [ ] `isNativeAvailable()` true in the dev build

### P6.tests — Timer core
- **Status:** PENDING
- **Model:** Opus
- **Description:** Write `mobile/src/__tests__/timerCore.test.ts` against the contract. Pure logic, no renderer, no native module: the core takes its clocks as parameters so the tests inject fake ones.
- **Contract:** `mobile/src/timer/core.ts` exports a pure state machine. State is `{ status: 'idle' | 'running' | 'paused', wallStart: number | null, monoStart: number | null, accumulatedMs: number }` (all ms; `wall` is epoch ms, `mono` is monotonic ms). Functions take `(state, clocks)` where `clocks = { wall(): number, mono(): number }` and return a new state, never mutate: `start`, `pause`, `resume`, `reset`. `elapsedMs(state, clocks)` — from monotonic only. `finish(state, clocks)` returns `{ durationSeconds: number, startUtc: string, endUtc: string, clockJumpDetected: boolean }`: duration from monotonic, `startUtc`/`endUtc` ISO strings with a `Z` suffix from wall-clock, and `clockJumpDetected` true when `|wallΔ − monoΔ| > 2000` for the whole recording. `restore(persisted, clocks)` reconstructs a running state from `{ wallStart, monoStart, accumulatedMs, status }` after process death: if the monotonic clock has gone *backwards* since `monoStart` (the device rebooted), fall back to wall-clock for the interval since the reboot and set the jump flag.
- **Acceptance Criteria:**
  - [ ] Tests: start→elapsed grows with mono, not wall; pause freezes; resume continues; reset returns to idle
  - [ ] Test: wall clock jumping forward 1h mid-recording does not change `durationSeconds`; jump flag set
  - [ ] Test: wall clock jumping back does not produce a negative or shortened duration; flag set
  - [ ] Test: `startUtc`/`endUtc` end in `Z` and differ by wall elapsed, not mono elapsed
  - [ ] Test: `restore` after simulated reboot (mono reset to a small number) yields a sane duration and the flag
  - [ ] Test: durations are seconds as a float (the API's unit), not ms
  - [ ] No imports from `react`, `react-native`, or the native module

### P6.impl — Timer core and persistence
- **Status:** PENDING
- **Model:** Opus
- **Description:** Implement `core.ts` to the contract. Then `mobile/src/timer/store.ts`: a hook `useTimer()` that owns the state, uses `clocks = { wall: Date.now, mono: native.elapsedRealtime }`, persists `{ status, wallStart, monoStart, accumulatedMs }` to AsyncStorage on every transition and restores on mount, calls `startForegroundService` on start/resume and `stopForegroundService` on pause/reset/finish, and re-renders once per second while running (D27 — seconds, not centiseconds). Add `src/timer/format.ts`: `formatElapsed(ms) → "H:MM:SS"` (hours omitted under one hour).
- **Acceptance Criteria:**
  - [ ] All P6.tests pass; tsc clean; export succeeds
  - [ ] `useTimer` restores a running timer after the hook remounts (test with a mocked AsyncStorage)
  - [ ] The render interval is 1000ms, and is cleared on unmount and on pause

### P7.tests — Offline save queue
- **Status:** PENDING
- **Model:** Opus
- **Description:** Write `mobile/src/__tests__/offlineQueue.test.tsx`. The queue is TanStack Query's persisted mutations, not custom code; the tests exercise the configured client.
- **Contract:** `mobile/src/services/queryClient.ts` exports `queryClient` with `networkMode: 'offlineFirst'` on mutations, `retry` bounded, and an AsyncStorage persister via `@tanstack/query-async-storage-persister` + `PersistQueryClientProvider`; `mutationCache` has defaults registered for the `createSession` mutation key so paused mutations can resume after restart (`queryClient.setMutationDefaults`). `onlineManager` is driven by `@react-native-community/netinfo`. `mobile/src/services/mutations.ts` exports `useCreateSession()` wrapping `sessionAPI.create` with an optimistic insert into the `['sessions']` list. On app start, `resumePausedMutations()` is called after hydration.
- **Acceptance Criteria:**
  - [ ] Test: with `onlineManager.setOnline(false)`, `useCreateSession().mutate(...)` does not call the API and the mutation is paused
  - [ ] Test: `onlineManager.setOnline(true)` flushes it; the API is called once with the original body
  - [ ] Test: a paused mutation survives creating a fresh QueryClient from the same persisted storage and `resumePausedMutations()` sends it
  - [ ] Test: while paused, the optimistic recording is visible in the `['sessions']` cache
  - [ ] netinfo and AsyncStorage are mocked; axios is mocked at the adapter

### P7.impl — Offline save queue
- **Status:** PENDING
- **Model:** Opus
- **Description:** Implement `queryClient.ts` and `mutations.ts` to the contract; replace the placeholder client from P2 in `src/app/_layout.tsx` with `PersistQueryClientProvider` and call `resumePausedMutations()` on hydrate. Only recording saves are offline-capable (roadmap D17); reads keep the default network mode and show a plain "offline" state.
- **Acceptance Criteria:**
  - [ ] All P7.tests pass; tsc clean; export succeeds
  - [ ] `src/app/_layout.tsx` uses `PersistQueryClientProvider`
  - [ ] Queries for tasks/sessions/schedules are `networkMode: 'online'` (the default), not offline-first

### P8a.tests — Stopwatch screen
- **Status:** PENDING
- **Description:** Write `mobile/src/__tests__/StopwatchScreen.test.tsx` with `@testing-library/react-native`, mocking `useTimer`, `useCreateSession`, and `taskAPI.getAll`.
- **Contract:** `src/app/(tabs)/index.tsx`. Shows elapsed as `H:MM:SS`. Buttons: Start / Pause / Resume / Reset, each ≥44pt. When paused with elapsed > 0, a **Save** button opens a sheet with: an optional name field, an Activity picker (list from `taskAPI.getAll`, searchable, "none" allowed), and Save/Cancel. One save (D26): calls `useCreateSession().mutate` with `{ name, duration, task_id?, start_time, end_time }` from `finish()`; if the name is blank and an Activity is chosen, the name is the Activity's name; if blank with no Activity, the name is the date and time. After save: reset, sheet closes, a brief "Saved" confirmation; if `clockJumpDetected`, the confirmation says the clock moved during the recording. No second "save to activity" path exists.
- **Acceptance Criteria:**
  - [ ] Tests: Start/Pause/Resume/Reset call the hook; Save appears only when paused with elapsed > 0
  - [ ] Test: blank name + Activity "Gym" saves with `name: "Gym"` and `task_id`
  - [ ] Test: blank name, no Activity saves with a date-time name and no `task_id`
  - [ ] Test: `start_time`/`end_time` from `finish()` are passed through unchanged
  - [ ] Test: clock-jump flag changes the confirmation text
  - [ ] Test: every pressable has `accessibilityRole="button"` and a hit area ≥44

### P8a.impl — Stopwatch screen
- **Status:** PENDING
- **Description:** Implement to the contract with `StyleSheet` and the P2 tokens. Big elapsed readout, large buttons, save sheet as a modal.
- **Acceptance Criteria:**
  - [ ] All P8a.tests pass; tsc clean; export succeeds
  - [ ] No hover styles; no centiseconds

### P8b.tests — Activities screen
- **Status:** PENDING
- **Description:** `mobile/src/__tests__/ActivitiesScreen.test.tsx`, mocking `taskAPI`.
- **Contract:** `src/app/(tabs)/activities.tsx`. List from `useQuery(['tasks'], taskAPI.getAll)`: name, average, and recording count per row; tap a row → `src/app/activity/[id].tsx` showing `taskAPI.getStats(id)` (average, median, previous) and the last ten time logs. A "+" button opens a create sheet with a name field → `taskAPI.create`, invalidating `['tasks']`. Offline: a plain "Offline — showing nothing" state, not a crash. Durations formatted with `format.ts`.
- **Acceptance Criteria:**
  - [ ] Test: rows render name, formatted average, count
  - [ ] Test: create posts the name and refetches
  - [ ] Test: detail screen shows the three stats and time logs
  - [ ] Test: query error state renders the offline message

### P8b.impl — Activities screen
- **Status:** PENDING
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All P8b.tests pass; tsc clean; export succeeds

### P8c.tests — Recordings screen
- **Status:** PENDING
- **Description:** `mobile/src/__tests__/RecordingsScreen.test.tsx`, mocking `sessionAPI`.
- **Contract:** `src/app/(tabs)/recordings.tsx`. List from `useQuery(['sessions'], sessionAPI.getAll)` newest first: name, duration, date, Activity name if attached. A search field filters by name client-side. A date-range control (two `datetimepicker`s) filters client-side. Optimistic entries from the offline queue appear with a "pending" marker. Swipe or long-press → delete via `sessionAPI.delete`, invalidating `['sessions']`.
- **Acceptance Criteria:**
  - [ ] Test: list order, fields, and Activity name
  - [ ] Test: search narrows the list; clearing restores it
  - [ ] Test: date range excludes out-of-range items
  - [ ] Test: delete calls the API and the row disappears
  - [ ] Test: a session with no `id` (optimistic) renders the pending marker

### P8c.impl — Recordings screen
- **Status:** PENDING
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All P8c.tests pass; tsc clean; export succeeds

### P8d.tests — Schedule screen
- **Status:** PENDING
- **Description:** `mobile/src/__tests__/ScheduleScreen.test.tsx`, mocking `taskAPI`, `scheduleAPI`.
- **Contract:** `src/app/(tabs)/schedule.tsx`, a three-step flow on one screen. **Step 1**: pick Activities from `['tasks']` (multi-select, search), each with an editable estimated duration defaulting to its average; set a start time (default: now rounded up to the next 15 minutes) and day end (default 23:00 local, sent as UTC). **Step 2**: call `scheduleAPI.generate` with `strategies: ['your-order', 'shortest-first', 'longest-first', 'best-fit']` (the four the user knows; the other three are build 2) and show the options as a vertical list of cards, each expandable to its timeline; select one. **Step 3**: name it (default: the date), optional "save as regimen", → `scheduleAPI.create` then `addItem` per timeline entry with `position` and `scheduled_time`. A **Regimens** section below lists `is_regimen` schedules with an "apply to date" action → `scheduleAPI.applyRegimen`. Existing Google Calendar events are **not** imported in build 1.
- **Acceptance Criteria:**
  - [ ] Test: selecting Activities pre-fills durations from averages; edits are respected in the request
  - [ ] Test: generate is called with the four strategies and UTC `Z` datetimes
  - [ ] Test: options render one card per returned option; selecting one enables Save
  - [ ] Test: save creates the schedule and one item per timeline entry, in order
  - [ ] Test: regimen apply calls `applyRegimen` with the chosen date
  - [ ] Test: generate error renders a retry, not a crash

### P8d.impl — Schedule screen
- **Status:** PENDING
- **Description:** Implement to the contract. Reuse `calendarUtils` for rounding and formatting.
- **Acceptance Criteria:**
  - [ ] All P8d.tests pass; tsc clean; export succeeds

### P8e.tests — Settings screen
- **Status:** PENDING
- **Description:** `mobile/src/__tests__/SettingsScreen.test.tsx`, mocking `services/auth` and `axios`.
- **Contract:** `src/app/settings.tsx`, reached from a gear icon in the tab header. Fields: API URL (prefilled from `getApiUrl()`), bearer token (secure text entry, paste-friendly, D31), a **Test connection** button that GETs `/health` then `/tasks/` with the entered values and reports: unreachable / reachable but token rejected / OK. Save writes both via `setApiUrl` / `setToken` and invalidates all queries. Also shows: app version, whether the native timer module is available (`isNativeAvailable()`), and the number of pending offline saves.
- **Acceptance Criteria:**
  - [ ] Test: fields prefill from stored values
  - [ ] Test: Test connection distinguishes the three outcomes
  - [ ] Test: Save persists both values and invalidates queries
  - [ ] Test: pending-save count reflects paused mutations

### P8e.impl — Settings screen
- **Status:** PENDING
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All P8e.tests pass; tsc clean; export succeeds

### P9. App icon and identity
- **Status:** PENDING
- **Description:** Port the icon before the web app is deleted. Expo wants a 1024×1024 PNG icon, an adaptive-icon foreground, and a splash image. Generate them from `frontend/public/icon.svg` with `sharp` (already in `frontend/node_modules`; run the script with `node` from `frontend/`) into `mobile/assets/`, and point `app.json` `icon`, `android.adaptiveIcon`, and `splash` at them. Keep `frontend/scripts/generate-icons.js` as the reference; add `mobile/scripts/generate-icons.js` that does the same for the mobile sizes.
- **Acceptance Criteria:**
  - [ ] `mobile/assets/icon.png` (1024²), `adaptive-icon.png`, `splash.png` exist and are referenced in `app.json`
  - [ ] `npx expo export --platform android` succeeds
  - [ ] Script committed under `mobile/scripts/`

### P10. USER — Build 1 phone check (the gate to delete the web app)
- **Status:** USER
- **Description:** **Wait for Phase 4 task 8 to be DONE first** — the Activities screen's averages only update from recordings once that lands. Rebuild only if native code changed since P5; otherwise `npx expo start --dev-client` is enough. On the phone, against the LAN backend:
  1. Settings: paste the token, Test connection → OK.
  2. Start a recording, lock the screen for 10+ minutes, unlock, pause, save to an Activity. Duration matches wall time within 1s; the notification was visible while locked; the recording appears in Recordings and in MySQL; the Activity's average and count changed.
  3. Airplane mode on: record and save → pending marker in Recordings, count in Settings. Airplane mode off → it syncs; `GET /api/sessions/` shows it.
  4. Build a schedule from three Activities, pick an option, save it; it appears in `GET /api/schedules/`.
  When all four pass, flip P11 to PENDING.
- **Acceptance Criteria:**
  - [ ] All four checks pass on a physical phone
  - [ ] Any failure recorded in `progress.md` with the task it reopens

### P11. Retire the web app
- **Status:** HOLD (see P10)
- **Description:** The only task allowed outside `mobile/`. Delete `frontend/` entirely (`git rm -r frontend`). Remove `CORS_ORIGINS` handling from `backend/app/main.py` and `.env.example` — a native app sends no `Origin`. Update `CLAUDE.md` (Quick Start, Tech Stack, Project Structure), `DIAGNOSTIC.md` §2–4 and §8 (frontend rows and the 16-test suite are gone; mobile replaces them), and `AsIWasSaying.md` §2. `GOOGLE_REDIRECT_URI` and the Google flow stay: the user authorizes from a laptop (roadmap D14).
- **Acceptance Criteria:**
  - [ ] `frontend/` gone; `git grep -n "frontend/"` returns only historical docs (`docs/`, `progress.md`, `roadmap.md`, ADRs, GOTCHAS)
  - [ ] Backend pytest passes; `CORS_ORIGINS` absent from `main.py`
  - [ ] Docs updated as listed
