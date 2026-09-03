# Diagnostic Reference

The repo as it *should* be. Use this to tell the difference between "not built yet" and
"built but broken." Symptoms of known breakage live in [GOTCHAS.md](GOTCHAS.md); deferred
scope lives in [future-work.md](future-work.md).

Last verified against a running system: 2026-09-03.

---

## 1. What this is meant to do

A stopwatch that learns how long your activities *actually* take, and then uses that history
to build day schedules you can believe.

The premise is that plans fail because the durations in them are guesses. So the app records
real elapsed time per activity, keeps a running average and median, and feeds those numbers
back in when you lay out a day. A schedule built from your own history should be achievable
rather than aspirational.

Three things follow from that premise:

- **Recording is the foundation.** Every other feature is downstream of having honest duration
  data, so timing has to be frictionless.
- **Scheduling is rules-based, not predictive.** Ordering strategies are deterministic and
  testable. AI comes later, if at all.
- **The calendar is the output surface.** A schedule that cannot reach Google Calendar is
  an unfinished thought.

Single user. No authentication or multi-tenancy anywhere by design.

---

## 2. Main capabilities

**Recording**
- Start/stop/reset stopwatch, saved either as a named Recording or appended to an Activity.
- Saving to an Activity updates its rolling average and recording count automatically.
- Per-activity statistics: average, median, and most recent duration.

**Scheduling**
- Build a day from Activities, each with an estimated duration seeded from its history.
- Generate orderings, compare them, then save one. The UI offers four strategies and computes
  them in the browser; the server's seven are **API only** until the new frontend lands.
- Save a schedule as a *regimen* and re-apply it to any future date.
- Rate a completed schedule, so the ordering that worked is recoverable later.

**Calendar**
- Drag Recordings from a side bank onto a week or day grid; drag to move, drag the edge to resize.
- Click an empty slot to create an event directly.
- Import existing Google Calendar events for a date so scheduling works around real commitments.
- Export any block to Google Calendar and remove it again.

**Insight** — none of this is reachable from the UI yet.
- Peak-hours reporting of when recorded work actually happens. **API only.**
- Eisenhower urgency/importance flags and an eat-the-frog flag as scheduling inputs.
  **API only, and there is no write path from the app at all** — the one route that sets them,
  `PUT /api/tasks/{id}`, is never called by the client, and no component references the fields.

**Platform**
- Installable PWA with offline caching.
- Glassmorphic UI with user-selectable background and metric display preferences.

---

## 3. Expected runtime state

Two processes plus a database. Nothing else.

| Component | Expectation |
|---|---|
| Backend | uvicorn on `127.0.0.1:8000` |
| Frontend | Vite dev server on `127.0.0.1:3000` |
| Database | MySQL, schema `stopwatch_scheduler` |
| Node | v22.x |
| Python | 3.10 in `backend/venv` |

The frontend proxies `/api` to port 8000, per `frontend/vite.config.ts`. It resolves per
request, so restarting the backend never requires restarting the frontend.

Healthy responses:

```bash
curl -s localhost:8000/api/health          # {"status":"healthy"}
curl -s localhost:3000/api/auth/status     # {"authenticated":true}
                                           # false now means genuinely revoked or never
                                           # authorized; staleness refreshes automatically
curl -s localhost:3000/api/tasks/          # 200 with a JSON array
```

Google credentials are read once at import. **A change to `backend/.env` requires a backend
restart**, never just a save.

---

## 4. Components

### Backend (`backend/app/`)

| File | Responsibility |
|---|---|
| `main.py` | App entry, CORS, router registration, `create_all` on startup |
| `database.py` | Engine and session factory, reads `DB_*` from env |
| `models/task.py` | Activity: name, average, recording count, urgency/importance |
| `models/time_log.py` | One recorded duration against an Activity |
| `models/stopwatch_session.py` | A named Recording, plus calendar and scheduling times |
| `models/schedule.py` | Schedule and ScheduleItem, including the frog flag |
| `models/schemas.py` | All Pydantic schemas; `UTCDateTime` enforces the UTC contract |
| `routers/tasks.py` | Activity CRUD and `/stats` |
| `routers/time_logs.py` | Time log CRUD, updates the parent average on write |
| `routers/sessions.py` | Recording CRUD, calendar add/remove, schedule/unschedule |
| `routers/schedules.py` | Schedule CRUD, items, rating, regimen apply, generation |
| `routers/insights.py` | Peak-hours aggregation |
| `routers/calendar_auth.py` | Google OAuth login, callback with state validation, status |
| `services/google_calendar.py` | Google Calendar API wrapper and credential cache |
| `services/strategies.py` | Strategy registry and the shared timeline builder |

### Frontend (`frontend/src/`)

| Area | Files |
|---|---|
| Entry | `main.tsx`, `App.tsx`, `pages/HomePage.tsx` (five tabs) |
| Timing | `components/Stopwatch.tsx`, `hooks/useStopwatch.ts` |
| Activities | `TaskList.tsx`, `TaskForm.tsx`, `TaskDetailModal.tsx`, `ActivityInput.tsx` |
| Recordings | `SessionList.tsx` (search, filter, CSV/JSON export) |
| Scheduling | `ScheduleBuilder.tsx`, `ScheduleTimeline.tsx`, `ScheduleList.tsx` |
| Calendar | `calendar/CalendarView.tsx`, `CalendarGrid.tsx`, `SessionBlock.tsx`, `SessionBank.tsx`, `DraggableSession.tsx`, `CreateEventModal.tsx` |
| Settings | `components/OptionsPage.tsx` |
| Shared | `services/api.ts`, `types/index.ts`, `utils/calendarUtils.ts` |

---

## 5. API surface

All routes are mounted under `/api`. Collection endpoints require the trailing slash;
FastAPI issues a 307 redirect without it.

```
GET    /api/health

GET    /api/tasks/                          POST   /api/tasks/
GET    /api/tasks/{id}                      PUT    /api/tasks/{id}
DELETE /api/tasks/{id}                      GET    /api/tasks/{id}/stats

GET    /api/time-logs/                      POST   /api/time-logs/
DELETE /api/time-logs/{id}

GET    /api/sessions/                       POST   /api/sessions/
GET    /api/sessions/{id}                   PUT    /api/sessions/{id}
DELETE /api/sessions/{id}
POST   /api/sessions/{id}/calendar          DELETE /api/sessions/{id}/calendar
PUT    /api/sessions/{id}/schedule          PUT    /api/sessions/{id}/unschedule

GET    /api/schedules/                      POST   /api/schedules/
GET    /api/schedules/{id}                  PUT    /api/schedules/{id}
DELETE /api/schedules/{id}                  PATCH  /api/schedules/{id}/rate
POST   /api/schedules/{id}/items            PUT    /api/schedules/{id}/items/{item_id}
DELETE /api/schedules/{id}/items/{item_id}  POST   /api/schedules/{id}/apply
POST   /api/schedules/generate

GET    /api/insights/peak-hours

GET    /api/auth/google/login               GET    /api/auth/callback
GET    /api/auth/status                     GET    /api/auth/calendar/events
POST   /api/auth/calendar/event
```

**UTC contract:** every datetime crossing the API is UTC with an explicit `Z` suffix, enforced
by `UTCDateTime` in `models/schemas.py`. Local times are never stored or emitted.

---

## 6. Scheduling strategies

Registered in `STRATEGY_REGISTRY` in `services/strategies.py`. All are pure ordering functions
except the last, and all must reproduce `backend/tests/fixtures/generate_parity.json` exactly,
including tie order.

The UI does **not** call this endpoint. It has its own copy of the first four, computed in the
browser, which is the parity reference these are tested against. The last three exist only here.

| Strategy | Behavior | In UI |
|---|---|---|
| `your-order` | Keeps the given order | yes |
| `shortest-first` | Stable ascending sort by duration | yes |
| `longest-first` | Stable descending sort by duration | yes |
| `best-fit` | Greedily packs longest activities into largest gaps between existing events; **orders only** | yes |
| `best-fit-slots` | Gap-aware, places items into actual free time rather than stacking sequentially | **API only** |
| `eat-the-frog` | The flagged activity goes first, rest keep their order | **API only** |
| `eisenhower` | Orders by urgency and importance quadrant | **API only** |

Ties must be stable. Python's `sorted` already guarantees this, so no secondary sort key.

---

## 7. Configuration

`backend/.env`, **not** a root `.env`. Read once at import by `load_dotenv()` in `main.py`.

| Key | Used |
|---|---|
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | yes |
| `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `GOOGLE_REDIRECT_URI` | yes |
| `CORS_ORIGINS` | yes |
| `API_PORT` | **no** — present in `.env.example`, read by nothing. Port comes from the uvicorn flag. |

`GOOGLE_REDIRECT_URI` must be `http://localhost:8000/api/auth/callback` and must be registered
verbatim under **Authorized redirect URIs** on the OAuth client.

Never committed: `backend/.env`, `token.pickle`, `*.db`, `credentials.json`,
`client_secret*.json`. Covered by gitignores at both root and `backend/`.

---

## 8. Tests

| Suite | Count | Command |
|---|---|---|
| Backend | 69 | `cd backend && venv/bin/python -m pytest tests/ -q` |
| Frontend | 16 | `cd frontend && npx vitest run` |

Backend tests build a fresh SQLite database from the models on every run and never touch
MySQL. **They therefore cannot detect schema drift in the real database.** See GOTCHAS.

Pinned for compatibility: `httpx<0.28`, since starlette 0.35.1 breaks on 0.28+.
`GoogleCalendarService._load_credentials` must be mocked before importing the app in tests.

---

## 9. Verification checklist

Run these when something feels wrong, in order. The first failure is the fault.

```bash
# 1. Processes alive and listening
ss -ltn | grep -E ':(3000|8000)'

# 2. Backend healthy
curl -s localhost:8000/api/health

# 3. Frontend proxy reaching the backend
curl -s localhost:3000/api/health

# 4. Google still authenticated
curl -s localhost:8000/api/auth/status

# 5. Live schema matches the models  (catches the drift tests cannot)
cd backend && venv/bin/python -c "
from dotenv import load_dotenv; load_dotenv()
from unittest.mock import patch
with patch('app.services.google_calendar.GoogleCalendarService._load_credentials', return_value=None):
    from app.database import Base, engine
    import app.models.task, app.models.time_log, app.models.stopwatch_session, app.models.schedule
from sqlalchemy import inspect
insp = inspect(engine)
for n, t in Base.metadata.tables.items():
    missing = {c.name for c in t.columns} - {c['name'] for c in insp.get_columns(n)}
    print(n, sorted(missing) or 'OK')"

# 6. Suite green
cd backend && venv/bin/python -m pytest tests/ -q
```

Green on all six means the system is sound. Anything else, start at GOTCHAS.

---

## 10. Data model

Live MySQL schema, in `stopwatch_scheduler`.

```
tasks               id, name, average_duration, total_recordings,
                    is_urgent, is_important, created_at, updated_at

time_logs           id, task_id -> tasks, duration, notes, created_at

stopwatch_sessions  id, name, duration, task_id -> tasks, notes,
                    calendar_event_id, is_on_calendar,
                    start_time, end_time, scheduled_start, scheduled_end,
                    created_at, updated_at

schedules           id, name, schedule_type, target_date, rating, notes,
                    is_regimen, created_at, updated_at

schedule_items      id, schedule_id -> schedules, task_id -> tasks, custom_name,
                    estimated_duration, position, scheduled_time, is_frog, created_at
```

Booleans are `TINYINT(1) NOT NULL DEFAULT 0`. There is **no migration tool**; columns added
to a model must be applied to MySQL by hand.

`ScheduleItem.position` is an ordinal, not a time. Items are assumed non-overlapping, which is
the constraint the parallel-activities work in future-work.md would have to break.
