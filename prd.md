# Stopwatch Scheduler — Product Requirements Document

## Overview
This PRD defines discrete tasks for the Ralph loop to iterate through.
Each task should be completable within a single Claude Code session.
Mark tasks DONE when complete. Add failure notes if a task fails.

---

## Tasks

### 1. Add session search and filtering
- **Status:** DONE
- **Description:** Add search bar and filter controls to the Sessions tab. Users should be able to filter sessions by name (text search), date range, and whether they're on the calendar.
- **Acceptance Criteria:**
  - [x] Search input filters sessions by name (case-insensitive)
  - [x] Date range picker filters by created_at
  - [x] Toggle filter for calendar status (all / on calendar / not on calendar)
  - [x] Filters combine (AND logic)
  - [x] No full page reload on filter change

### 2. Add data export feature
- **Status:** DONE
- **Description:** Allow users to export their sessions and tasks as CSV or JSON files.
- **Acceptance Criteria:**
  - [x] Export button in Sessions tab exports all sessions as CSV
  - [x] Export button in Tasks tab exports all tasks with averages as CSV
  - [x] JSON export option available for both
  - [x] File downloads with descriptive filename (e.g., `sessions_2026-02-08.csv`)

### 3. Add time log history/detail view
- **Status:** DONE
- **Description:** Create a detail view for individual tasks showing all time log entries with timestamps, durations, and notes.
- **Acceptance Criteria:**
  - [x] Clicking a task opens a detail/history view
  - [x] Shows all time logs in chronological order
  - [x] Each entry shows duration, notes, and created_at
  - [x] Can delete individual time logs from this view
  - [x] Shows task average and total at the top

### 4. Generate PNG icons from SVG
- **Status:** DONE
- **Description:** Use the existing `frontend/scripts/generate-icons.js` script to generate proper PNG icons for PWA manifest.
- **Acceptance Criteria:**
  - [x] 192x192 PNG icon generated
  - [x] 512x512 PNG icon generated
  - [x] manifest.json references the PNG icons
  - [x] Icons display correctly in PWA install prompt

### 5. Add unit tests for backend API
- **Status:** DONE
- **Description:** Add pytest tests covering the core CRUD endpoints for tasks, sessions, and time logs.
- **Acceptance Criteria:**
  - [x] Test file(s) in `backend/tests/`
  - [x] Tests for task CRUD (create, read, update, delete)
  - [x] Tests for session CRUD
  - [x] Tests for time log CRUD
  - [x] Tests for session scheduling endpoints
  - [x] All tests pass

### 6. Add frontend component tests
- **Status:** PENDING
- **Description:** Add Vitest + React Testing Library tests for key frontend components.
- **Acceptance Criteria:**
  - [ ] Testing dependencies installed (vitest, @testing-library/react)
  - [ ] Tests for Stopwatch component (start, stop, reset, save)
  - [ ] Tests for SessionList component (render, edit, delete)
  - [ ] Tests for CalendarView component (render, navigation)
  - [ ] All tests pass

---

## Notes
- Tasks are ordered by priority / dependency
- Each task should be attempted in a fresh Claude Code session
- Update progress.md after each attempt with results and learnings
- Commit working changes to git before the session ends
