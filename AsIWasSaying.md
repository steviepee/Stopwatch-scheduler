# Standing Orders — Phase 4 → 5

Current as of 2026-09-05. Read this, then `prd.md`, then start on the first PENDING task.

---

## 1. What to read

| File | Why |
|---|---|
| [roadmap.md](roadmap.md) | Phases 1–6 and decisions D1–D20. Settled; work within them. |
| [prd.md](prd.md) | The phase in flight. Tasks marked USER are for the user, not the loop. |
| [CONTEXT.md](CONTEXT.md) | Glossary. Product names differ from code names; use the product names in prose and new code. |
| [GOTCHAS.md](GOTCHAS.md) | Failure modes with symptoms. Read before debugging a 500, an auth error, or green tests beside a broken app. |
| [docs/adr/](docs/adr/) | Why React Native, and why one bearer token with no tenancy. |
| [DIAGNOSTIC.md](DIAGNOSTIC.md) | API surface, schema, runtime expectations, verification checklist. |
| [future-work.md](future-work.md) | Deferred scope. Not scheduled. |

## 2. State of the repo

- Backend suite 82 passing; frontend 16. Backend on 8000, Vite on 3000 proxying `/api`.
- Google Calendar authenticated; credentials refresh on use.
- Live MySQL schema matches the models, five tables, real recordings since February.
- Phases 1–3 complete. Phase 4 tasks 1.tests and 1.impl done: the bearer gate is in `main.py` and the suite sends the header by default. Task 2 is next; task 3 is the user's.

## 3. Decisions that shape day-to-day work

Full table in `roadmap.md`. The ones that matter most while executing:

- **D6/D7** The new frontend is React Native + Expo **dev build** (not Expo Go), Android first, iOS kept buildable via stubs.
- **D3** Auth is one static bearer token checked in middleware. No users table, no owner columns.
- **D4** The test suite keeps `create_all` in `conftest.py`. Schema drift is caught by `test_migrations.py` running `alembic check` against throwaway SQLite.
- **D10/D15** The gate lands before the backend is bound to `0.0.0.0`. Alembic lands any time before deploy.
- **D11** `frontend/` is **frozen**: no features, no fixes. It is deleted once the Android app can record and list. Only `vite.config.ts` and its env files may change, and only for the gate.
- **D13** `backend/tests/fixtures/generate_parity.json` is frozen regression data. If a strategy change breaks parity, the strategy is wrong.
- **D14** Google OAuth never runs on the phone. The user authorizes once from a laptop; `token.pickle` is global.
- **D20** Tests are written by a separate loop iteration from the task's acceptance criteria, before the implementation iteration. PRD tasks are paired `N.tests` / `N.impl`. Keep that pairing in every PRD you write.

## 4. Phase 4 — in flight

`./ralph.sh --max N` runs `prd.md`. Skip USER tasks and tell the user what they need to do:

- **Task 3:** set `API_TOKEN` in `backend/.env` and `frontend/.env`, restart uvicorn with `--host 0.0.0.0`, verify from the phone's browser that `/api/health` is 200 and `/api/tasks/` is 401.
- **Task 6:** `alembic revision --autogenerate -m baseline` against live MySQL, review booleans as `TINYINT(1) NOT NULL DEFAULT 0`, then `alembic stamp head`. Never `upgrade` — the tables exist.

Phase 5 may begin once task 3 is verified. Tasks 4–7 can land in parallel with it.

## 5. Phase 5 — write this into `prd.md` when Phase 4a is done

Archive the Phase 4 PRD to `docs/prd-phase4-completed.md` once 4b is also done. Every
implementation task gets a paired `.tests` task carrying its acceptance criteria.

### Prep

- **5.2** Scaffold `mobile/` with Expo (TypeScript, latest SDK) as a dev build from the start. Add `jest-expo` and `@testing-library/react-native`.
- **5.3** Copy `frontend/src/types/index.ts`, `services/api.ts`, `utils/calendarUtils.ts` into `mobile/src/`. In `api.ts`: `baseURL` from `EXPO_PUBLIC_API_URL`; an axios request interceptor reads the bearer from `expo-secure-store`. Add `scheduleAPI.generate()` — it does not exist.

### Build 1 — Android, record and list. Retires the web app.

5.4 is the riskiest task in the phase (see GOTCHAS). Spike it before any screen.

- **5.4** Native module via the Expo Modules API in `mobile/modules/timer-native/`: (a) `elapsedRealtime()`; (b) start/stop a foreground service with an ongoing notification showing elapsed time. iOS stub for both so the iOS build compiles. Document the dev-build command in `mobile/README.md`.
  Fallback if it cannot be built: timestamp-only mode — `Date.now()` at start and stop, duration by subtraction, no notification. Keep the clock-jump check from 5.5.
- **5.5 / 5.6** `mobile/src/timer/core.ts`, a pure state machine, tests first: `idle → running → paused`; start captures `{wallStart, monoStart}`; stop yields `{durationMs, startUtc, endUtc, clockJumpDetected}`. Duration from monotonic only. Wall timestamps ISO with `Z`. `|wallΔ − monoΔ| > 2000ms` sets the flag. Resume after process death reconstructs from persisted `{wallStart, monoStart}`. Persist to `AsyncStorage` on every transition.
- **5.7** Offline save queue, tests first: failed `POST /api/sessions/` or `/api/time-logs/` writes go to a persisted queue; flush on app foreground and on connectivity change (`@react-native-community/netinfo`). Nothing else works offline.
- **5.8** Screens, each with its `.tests` task first:
  - **Stopwatch** — start/stop/reset; save as Recording or to an Activity; uses 5.4 for the notification, 5.6 for time.
  - **Activities** — list with avg/median/prev from `GET /api/tasks/{id}/stats`; create.
  - **Recordings** — list, name search, date filter.
  - **Schedule** — pick activities, `POST /api/schedules/generate`, compare options, save one. Regimens: list and apply.
  - **Settings** — API URL and bearer token, written to `expo-secure-store`.
- **5.9** Phone-first: 44pt minimum targets, no hover states, portrait, safe-area aware. Glassmorphic palette as a token file.
- **5.10** Port `frontend/public/icon.svg` and `scripts/generate-icons.js` to Expo `app.json` icon config before deleting `frontend/`.
- **5.11** Once 5.8 records and lists on a physical phone against the LAN backend: delete `frontend/`. Remove `CORS_ORIGINS` (native sends no `Origin`). Update `CLAUDE.md`, `DIAGNOSTIC.md` §2–4 and §8, and this file.

### Build 2 — the API-only surface and the calendar

- **5.12** Quadrant picker on the Activity screen → `PUT /api/tasks/{id}` with `is_urgent` / `is_important`.
- **5.13** Daily frog pick in the Schedule screen → `is_frog` on the schedule item.
- **5.14** Expose `eat-the-frog`, `eisenhower`, `best-fit-slots` as selectable strategies. Needs 5.12 and 5.13.
- **5.15** Pomodoro as a mode of `core.ts` (work/break intervals, notification on transition). Tests first.
- **5.16** Peak-hours (`GET /api/insights/peak-hours`) as the suggested `start_time` default in the Schedule screen. Not a chart.
- **5.17** Day-view calendar: `react-native-gesture-handler` + Reanimated for move and edge-resize within one day column; agenda list for the week. Port `calendarUtils` positioning. Google Calendar import for the day; export/remove per block.

## 6. Phase 6 — deploy

Host is open; decide when reached. Not open: TLS is mandatory; `alembic upgrade head` is a
deploy step; `mysqldump` the data → restore → `alembic stamp head`; `GOOGLE_REDIRECT_URI` →
`https://<host>/api/auth/callback`, registered verbatim, backend restarted; the user
authorizes Google once from a laptop; `EXPO_PUBLIC_API_URL` → public host, rebuild. Verify from
cellular with Wi-Fi off.

## 7. Verification gates

1. **Phase 4a:** `curl http://<lan-ip>:8000/api/tasks/` → 401; with `-H "Authorization: Bearer $API_TOKEN"` → 200. Web app at `localhost:3000` still lists recordings.
2. **Phase 4b:** pytest green; add a throwaway column to a model with no revision → `test_migrations.py` fails; remove it → green. `alembic current` on MySQL shows head.
3. **Build 1, the gate to delete the web app:** on a physical Android phone against the LAN backend — start recording, lock the screen 10+ minutes, unlock, stop; duration matches wall time within 1s; notification was visible while locked; save lands in MySQL. Airplane mode: record and save → queued; airplane off → appears in `GET /api/sessions/`.
4. **Phase 6:** gate 3 from cellular with Wi-Fi off.

## 8. Traps

- **Green tests do not prove the app works.** Until 4b lands, the suite builds SQLite from the models and cannot see MySQL drift. Green suite plus a 500 is the signature; see GOTCHAS.
- **The API-only surface is deliberate** until build 2. Three strategies, peak-hours, and the priority flags have no UI. Do not wire them early.
- **Timer drift in the old `useStopwatch.ts` is a bug** (`+10` per tick instead of timestamp subtraction), not a platform limit. Do not fix it — the file is frozen — and do not cite it as a reason for native.
- Config changes need a backend restart; env is read once at import.
- Collection endpoints need trailing slashes; FastAPI 307s without them.
- `token.pickle` is a credential. It is gitignored; keep it that way.

## 9. How the user works

- Concise and direct. No preamble, no restating the question.
- Never commit or push unless explicitly asked. Stage files by name.
- `kill -15` before `kill -9`.
- Markdown links for file references, never backticks around paths.
- They push back on thin reasoning and expect the pushback answered, not absorbed.
