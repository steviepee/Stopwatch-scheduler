# Stopwatch Scheduler — PRD: Backend Scheduling Engine (Remake Phase 3)

## Overview
Discrete tasks for the Ralph loop. One task per session, in order — tasks 3–7 build on each other.
Mark tasks DONE when complete. Add failure notes if a task fails.

**Context:** All API datetimes are UTC with explicit `Z` suffix (see `UTCDateTime` in
`backend/app/models/schemas.py`). Never emit or store local times. Parity fixtures captured
from the current frontend live at `backend/tests/fixtures/generate_parity.json` — ported
strategies MUST reproduce them exactly, including order of equal-duration ties (stable sort).

---

## Tasks

### 1. Add Eisenhower priority fields to tasks
- **Status:** DONE
- **Description:** Add `is_urgent` and `is_important` Boolean columns (default False) to the `tasks` table and expose them through the API.
- **Acceptance Criteria:**
  - [x] `Task` ORM model has `is_urgent` and `is_important` (Boolean, nullable=False, default False)
  - [x] `TaskCreate` accepts both optionally (default False); `TaskUpdate` accepts both optionally; `Task` response schema returns both
  - [x] `PUT /api/tasks/{id}` updates them
  - [x] Existing tests still pass; new tests cover create-with-flags, update-flags, and defaults
  - [x] `cd backend && source venv/bin/activate && python -m pytest tests/` passes

### 2. Add frog flag to schedule items
- **Status:** DONE
- **Description:** Add `is_frog` Boolean column (default False) to `schedule_items` and expose it through the API. The frog is the user's hardest task of the day.
- **Acceptance Criteria:**
  - [x] `ScheduleItem` ORM model has `is_frog` (Boolean, nullable=False, default False)
  - [x] `ScheduleItemBase` / `ScheduleItemUpdate` schemas carry it; responses return it
  - [x] Item create/update endpoints under `/api/schedules/{id}/items` round-trip it
  - [x] New tests cover round-trip and default; full pytest passes

### 3. Strategy engine scaffold + POST /api/schedules/generate
- **Status:** DONE
- **Description:** Create `backend/app/services/strategies.py` with a strategy registry (dict of name → function) and a new `POST /api/schedules/generate` endpoint in the schedules router. Implement only the `your-order` strategy in this task.
- **Contract:**
  - Request: `{ "start_time": UTCDateTime, "day_start": UTCDateTime, "day_end": UTCDateTime, "activities": [{ "task_id": int|null, "name": str, "estimated_duration": float, "is_urgent": bool=false, "is_important": bool=false, "is_frog": bool=false }], "existing_events": [{ "name": str, "start": UTCDateTime, "end": UTCDateTime }] = [], "strategies": [str]|null }`
  - Response: `{ "options": [{ "strategy": str, "label": str, "description": str, "timeline": [{ "task_id": int|null, "name": str, "start": UTCDateTime, "end": UTCDateTime }], "flagged": [{ "name": str, "reason": str }], "excluded": [{ "name": str, "reason": str }] }] }`
  - `strategies: null` runs every registered strategy; unknown strategy name → 422.
  - Timeline construction: activities laid sequentially from `start_time`, each `end = start + estimated_duration` (mirrors `buildTimeline` in `frontend/src/components/ScheduleTimeline.tsx`).
- **Acceptance Criteria:**
  - [x] Registry pattern: adding a future strategy requires only a new entry in `strategies.py`, no router changes
  - [x] `your-order` reproduces the `your-order` entry of `generate_parity.json` when fed the fixture input
  - [x] Contract tests: response shape, unknown strategy 422, empty activities → empty timelines
  - [x] Full pytest passes

### 4. Port shortest-first and longest-first strategies
- **Status:** DONE
- **Description:** Add `shortest-first` and `longest-first` to the registry (sort by `estimated_duration` ascending / descending, stable).
- **Acceptance Criteria:**
  - [x] Both strategies reproduce their `generate_parity.json` entries exactly, including tie order (Python `sorted` is stable — do not add secondary sort keys)
  - [x] Full pytest passes

### 5. Port best-fit strategy (ordering parity)
- **Status:** DONE
- **Description:** Port `bestFitOrder` from `frontend/src/components/ScheduleTimeline.tsx` to the registry as `best-fit`: build free gaps between `existing_events` within `[day_start, day_end]`, greedily place longest activities into largest remaining gaps, unplaced activities appended last. With no events (one whole-day gap or none), output equals longest-first. NOTE: like the frontend, this task only *orders* — the timeline still stacks sequentially from `start_time`. Do not "fix" that here (see task 9).
- **Acceptance Criteria:**
  - [x] Reproduces `best-fit` AND `best-fit-no-events` entries of `generate_parity.json` exactly
  - [x] Gap-building edge cases tested: event before day_start, overlapping events, event past day_end
  - [x] Full pytest passes

### 6. Eat-the-frog strategy
- **Status:** DONE
- **Description:** Add `eat-the-frog`: the activity with `is_frog=true` goes first; remaining activities keep their given order. If no activity is flagged, fall back to the given order unchanged (identical to your-order). If multiple are flagged, the first flagged one wins; others keep their relative positions.
- **Acceptance Criteria:**
  - [x] Unit tests: frog moved to front; no-frog fallback; multiple-frog behavior
  - [x] `description` in the response mentions the frog by name when one exists
  - [x] Full pytest passes

### 7. Eisenhower strategy
- **Status:** DONE
- **Description:** Add `eisenhower`, ordering by quadrant: Q1 (urgent+important) first, then Q2 (important only), then Q3 (urgent only). Within a quadrant, keep given order. Q3 activities are also listed in `flagged` with reason `consider-delegating`. Q4 (neither) are left out of the timeline and listed in `excluded` with reason `not-urgent-not-important`.
- **Acceptance Criteria:**
  - [x] Unit tests cover all four quadrants, flagged/excluded population, and stable order within quadrants
  - [x] Activities with a `task_id` default their flags from the task's `is_urgent`/`is_important` when the request leaves them false
  - [x] Full pytest passes

### 8. Peak-hours insights endpoint
- **Status:** DONE
- **Description:** New router `backend/app/routers/insights.py` with `GET /api/insights/peak-hours?tz_offset=0` (tz_offset in minutes, JS `getTimezoneOffset` convention). For every stopwatch session and time log, distribute its duration across the local hours it spans: interval is `[start_time, start_time + duration]` when `start_time` exists, else `[created_at - duration, created_at]`. Convert to local via `local = utc - tz_offset minutes`.
- **Acceptance Criteria:**
  - [x] Response: `{ "hours": [{ "hour": 0-23, "seconds": float, "count": int }] * 24, "peak_hour": int|null, "total_seconds": float }` (`peak_hour` null when no data)
  - [x] Router registered in `main.py` under `/api/insights`
  - [x] Tests seed sessions spanning hour boundaries and assert the split, tz_offset shifting, and the empty-DB case
  - [x] Full pytest passes

### 9. Best-fit-slots strategy (gap-aware timeline)
- **Status:** PENDING
- **Description:** Add `best-fit-slots`, a NEW strategy (do not change `best-fit`): actually place activities into the free gaps computed in task 5 — each timeline entry's `start`/`end` sits inside a gap, never overlapping `existing_events`. Placement order: longest activity into the earliest gap that fits it, starting no earlier than `start_time`. Activities that fit nowhere go to `excluded` with reason `no-free-slot`.
- **Acceptance Criteria:**
  - [ ] No timeline entry overlaps any existing event; entries within a gap are contiguous
  - [ ] Unit tests: activity too big for any gap → excluded; empty events → equals longest-first laid from start_time
  - [ ] `best-fit` parity tests from task 5 still pass unchanged
  - [ ] Full pytest passes
