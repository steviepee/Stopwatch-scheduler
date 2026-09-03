# Stopwatch Scheduler - Project Context

> Known failure modes and how to recognize them: [GOTCHAS.md](GOTCHAS.md).
> Check it before debugging a 500, an auth error, or tests that pass while the app is broken.

## Quick Start

```bash
# Terminal 1 - Backend (requires MySQL)
cd backend && source venv/bin/activate && uvicorn app.main:app --port 8000 --reload

# Terminal 2 - Frontend
cd frontend && npm run dev

# Open http://localhost:3000
```

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **Backend**: FastAPI + SQLAlchemy + MySQL
- **Auth**: Google OAuth 2.0 for Calendar integration
- **Mobile**: PWA with vite-plugin-pwa

## Project Structure

```
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app entry, CORS, routers
│   │   ├── database.py          # SQLAlchemy engine, session
│   │   ├── models/
│   │   │   ├── task.py          # Task model (name, average_duration)
│   │   │   ├── time_log.py      # TimeLog model (task_id, duration)
│   │   │   ├── stopwatch_session.py  # Session model (name, duration, calendar)
│   │   │   └── schemas.py       # Pydantic schemas for all models
│   │   ├── routers/
│   │   │   ├── tasks.py         # CRUD /api/tasks
│   │   │   ├── time_logs.py     # CRUD /api/time-logs
│   │   │   ├── sessions.py      # CRUD /api/sessions + calendar endpoints
│   │   │   └── calendar_auth.py # Google OAuth /api/auth
│   │   └── services/
│   │       └── google_calendar.py  # Google Calendar API service
│   ├── .env                     # DB credentials, Google OAuth keys
│   ├── requirements.txt
│   └── venv/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Stopwatch.tsx    # Main timer with save modal (session/task)
│   │   │   ├── SessionList.tsx  # Sessions with calendar integration
│   │   │   ├── TaskList.tsx     # Task list with averages
│   │   │   ├── TaskForm.tsx     # Create new task form
│   │   │   └── GoogleCalendarButton.tsx
│   │   ├── pages/
│   │   │   └── HomePage.tsx     # Main page with tabs (Sessions/Tasks)
│   │   ├── hooks/
│   │   │   └── useStopwatch.ts  # Timer logic hook
│   │   ├── services/
│   │   │   └── api.ts           # Axios API client (taskAPI, sessionAPI, etc.)
│   │   ├── types/
│   │   │   └── index.ts         # TypeScript interfaces
│   │   ├── index.css            # Glassmorphic CSS design system
│   │   └── main.tsx
│   ├── public/
│   │   ├── icon.svg             # App icon
│   │   └── manifest.json        # PWA manifest
│   ├── vite.config.ts           # Vite + PWA config
│   └── package.json
```

## API Endpoints

### Tasks `/api/tasks`
- `GET /` - List all tasks
- `GET /{id}` - Get task with time logs
- `POST /` - Create task
- `PUT /{id}` - Update task
- `DELETE /{id}` - Delete task (cascades time logs)

### Time Logs `/api/time-logs`
- `GET /` - List logs (optional `?task_id=`)
- `POST /` - Create log (auto-updates task average)
- `DELETE /{id}` - Delete log

### Sessions `/api/sessions`
- `GET /` - List sessions (optional `?task_id=`, `?on_calendar=`)
- `GET /{id}` - Get session with task
- `POST /` - Create session
- `PUT /{id}` - Update session
- `DELETE /{id}` - Delete session
- `POST /{id}/calendar` - Add to Google Calendar
- `DELETE /{id}/calendar` - Remove from calendar

### Auth `/api/auth`
- `GET /google/login` - Get OAuth URL
- `GET /callback` - OAuth callback
- `GET /status` - Check auth status
- `POST /calendar/event` - Create calendar event

## Database Models

### Task
- `id`, `name` (unique), `average_duration`, `total_recordings`, `created_at`, `updated_at`

### TimeLog
- `id`, `task_id` (FK), `duration`, `notes`, `created_at`

### StopwatchSession
- `id`, `name`, `duration`, `task_id` (FK, optional), `notes`
- `calendar_event_id`, `is_on_calendar`
- `start_time`, `end_time`, `created_at`, `updated_at`

## UI Features

- **Glassmorphic Design**: Animated gradient background, glass cards with backdrop blur
- **Stopwatch**: Start/Stop/Reset, saves as named Session or adds to Task
- **Sessions Tab**: List with inline name editing, calendar add/remove buttons
- **Tasks Tab**: Shows average duration and recording count
- **PWA**: Installable on Android, offline caching with Workbox

## Environment Variables (backend/.env)

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=stopwatch_scheduler

GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/callback

CORS_ORIGINS=http://localhost:3000
```

## Current State (Feb 2026)

All core features implemented:
- Full CRUD for tasks, time logs, sessions
- Named stopwatch sessions (user can name each recording)
- Google Calendar integration (add/remove sessions)
- Responsive glassmorphic UI
- PWA configured for Android

## Potential Next Steps

- Generate PNG icons from SVG (see `frontend/scripts/generate-icons.js`)
- Add user authentication (currently single-user)
- Time log history/detail view
- Session filtering/search
- Export data feature
- Unit tests
