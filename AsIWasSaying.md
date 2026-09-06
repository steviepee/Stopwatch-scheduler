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

- Backend suite 91 passing; frontend 15; mobile 19. Backend on 8000, Vite on 3000 proxying `/api`.
- Google Calendar authenticated; credentials refresh on use.
- Live MySQL schema matches the models, five tables, real recordings since February.
- Phases 1–4 complete. Phase 5 build 1 in flight — task status lives in `prd.md`, per-task notes in `progress.md`. This file does not track it.

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

## 4. Phase 4 — done

Archived at `docs/prd-phase4-completed.md`. Alembic owns the live schema: `alembic current` is at head, `alembic check` is clean, and `tests/test_migrations.py` fails on any model change without a revision. Task 8 landed: a Recording with a `task_id` creates the Activity's Time Log and updates its average.

How USER tasks worked, for the next PRD that has them:

- **Task 3:** set `API_TOKEN` in `backend/.env` and `frontend/.env`, restart uvicorn with `--host 0.0.0.0`, verify from the phone's browser that `/api/health` is 200 and `/api/tasks/` is 401.
- **Task 6:** `alembic revision --autogenerate -m baseline` against live MySQL, review booleans as `TINYINT(1) NOT NULL DEFAULT 0`, then `alembic stamp head`. Never `upgrade` — the tables exist.

The loop never picks a `USER` status; it picks the first `PENDING`.

## 5. Phase 5 — build 1 is `prd.md`

Run it with `./ralph.sh --model claude-opus-5` through P7.impl, then without `--model`. P1, P5, and P10 are USER tasks; P11 is HOLD until the user passes P10.
Decisions D22–D33 in `roadmap.md` are the ones that shaped it.

Build 2 gets its own PRD after P10 passes. Its outline, so it is not lost:

- Quadrant picker on the Activity screen → `PUT /api/tasks/{id}` with `is_urgent` / `is_important`.
- Daily frog pick in the Schedule screen → `is_frog` on the schedule item.
- Expose `eat-the-frog`, `eisenhower`, `best-fit-slots` as selectable strategies.
- Pomodoro as a mode of `timer/core.ts` (work/break intervals, notification on transition).
- Stop button on the foreground notification.
- Peak-hours (`GET /api/insights/peak-hours`) as the suggested start time in the Schedule screen.
- Day-view calendar: `react-native-gesture-handler` + Reanimated for move and edge-resize in one
  day column; agenda list for the week; Google Calendar import for the day, export/remove per block.

## 6. Phase 6 — deploy

Host is **Azure** (D21) — chosen for practice, not cost. Expect a managed MySQL, the backend in a
container, and platform-issued TLS. Not open: TLS is mandatory; `alembic upgrade head` is a
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
