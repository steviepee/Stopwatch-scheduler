# Stopwatch Scheduler — PRD: Credential Gate + Alembic (Remake Phase 4)

## Overview
Discrete tasks for the Ralph loop. One task per session, in order. Mark tasks DONE when
complete. Add failure notes if a task fails. Decisions behind these tasks are in `roadmap.md`
(D3, D4, D5, D10, D13) and ADR 0002.

**Context:** The backend is about to be reached from a phone on the LAN, so it needs a gate
first. Alembic can land any time before deploy. Tasks marked **USER** touch the live MySQL
database or the running process and are not for the loop — skip them and move on.

**Rules for this PRD:**
- The suite keeps `create_all` in `conftest.py`. Do not replace it with migrations.
- Tests for a task are written **before** its implementation, in a separate session, from the
  acceptance criteria only. Tasks are paired `N.tests` / `N.impl` for that reason.
- Any model change now needs an Alembic revision once task 5 exists.

---

## Tasks

### 1.tests — Gate middleware tests
- **Status:** PENDING
- **Description:** Write `backend/tests/test_auth_gate.py` against the contract below. Do not implement the middleware. The tests will fail until task 1.impl; that is expected — mark this task DONE when the tests exist, import cleanly, and fail for the right reason (401 not returned).
- **Contract:** Every `/api/*` route returns 401 `{"detail": "Not authenticated"}` unless the request carries `Authorization: Bearer <API_TOKEN>` where `API_TOKEN` is read from the environment. Exempt: `GET /api/health`, `GET /api/auth/google/login`, `GET /api/auth/callback`. A wrong token is 401, not 403. A missing `API_TOKEN` env var at startup is a hard error, not an open gate.
- **Acceptance Criteria:**
  - [ ] Test: `GET /api/tasks/` with no header → 401
  - [ ] Test: `GET /api/tasks/` with wrong token → 401
  - [ ] Test: `GET /api/tasks/` with correct token → 200
  - [ ] Test: each of the three exempt routes → not 401 with no header (login/callback may return other codes; assert only that the gate did not fire)
  - [ ] Test: app import with `API_TOKEN` unset raises at startup
  - [ ] Tests use a fixture-provided `API_TOKEN`; no real token in the repo

### 1.impl — Gate middleware
- **Status:** PENDING
- **Description:** Implement the contract from task 1.tests as middleware in `backend/app/main.py` (or `backend/app/middleware.py` registered there). Add `API_TOKEN` to `backend/.env.example`. Update `backend/tests/conftest.py` so the shared `client` fixture sends the correct bearer header by default — the existing 75 tests must stay green without edits.
- **Acceptance Criteria:**
  - [ ] All tests from 1.tests pass
  - [ ] Full pytest passes (75 + new)
  - [ ] `API_TOKEN` documented in `.env.example` and in the Environment Variables section of `CLAUDE.md`
  - [ ] No route other than the three exempt ones is reachable without the header

### 2. Frozen web app keeps working through the gate
- **Status:** PENDING
- **Description:** The current web frontend is frozen (roadmap D11) and must not be edited except for this. Inject the bearer header in the Vite dev proxy so the browser never sees the token: in `frontend/vite.config.ts`, `server.proxy['/api'].headers = { Authorization: 'Bearer ' + process.env.API_TOKEN }`, reading from `frontend/.env` (`API_TOKEN=`, gitignored). Do not touch `frontend/src/`.
- **Acceptance Criteria:**
  - [ ] `frontend/.env.example` gains `API_TOKEN=`
  - [ ] `frontend/.gitignore` covers `.env`
  - [ ] Only `vite.config.ts` and the two env files change under `frontend/`
  - [ ] Frontend vitest suite still passes (16)

### 3. USER — Expose the backend on the LAN
- **Status:** PENDING (user step, not for the loop)
- **Description:** Only after tasks 1 and 2: set `API_TOKEN` in `backend/.env` and `frontend/.env`, restart uvicorn with `--host 0.0.0.0`, update the Quick Start in `CLAUDE.md`. `GOOGLE_REDIRECT_URI` stays `localhost:8000` (roadmap D14).
- **Acceptance Criteria:**
  - [ ] From the phone's browser: `http://<lan-ip>:8000/api/health` → 200, `/api/tasks/` → 401
  - [ ] Web app at `localhost:3000` still lists recordings

### 4. Freeze the parity fixture
- **Status:** PENDING
- **Description:** `frontend/src/__tests__/fixtures-capture.test.ts` overwrites `backend/tests/fixtures/generate_parity.json` on every frontend test run, so the oracle the backend is measured against moves (roadmap D13). Delete the generator. Add a module docstring to `backend/tests/test_generate.py` recording provenance: captured 2026-09-03 from the browser implementation of `buildTimeline`/`bestFitOrder` that has since been deleted; the 1800s tie between "Email sweep" and "Read chapter" is deliberate and pins stable sort order; all instants are fixed UTC so the fixture is timezone-independent; nothing regenerates it.
- **Acceptance Criteria:**
  - [ ] Generator file deleted; `generate_parity.json` byte-identical before and after
  - [ ] Docstring present in `test_generate.py`
  - [ ] Frontend vitest passes (15); backend pytest passes

### 5. Alembic scaffold
- **Status:** PENDING
- **Description:** Add `alembic` to `backend/requirements.txt` (pinned). `alembic init backend/alembic`. In `env.py`: import `Base` from `app.database` and all four model modules so autogenerate sees every table; build the URL from the same `DB_*` env vars `database.py` uses; allow override via `alembic -x db_url=sqlite:///...` for tests. Do **not** generate a revision in this task.
- **Acceptance Criteria:**
  - [ ] `cd backend && venv/bin/alembic current` runs without error (no revisions yet)
  - [ ] `env.py` honours `-x db_url=`
  - [ ] Full pytest passes unchanged

### 6. USER — Baseline revision from live MySQL
- **Status:** PENDING (user step, not for the loop)
- **Description:** `alembic revision --autogenerate -m "baseline"` against the live database. Review by hand: booleans must map to `TINYINT(1) NOT NULL DEFAULT 0` (see GOTCHAS). Then `alembic stamp head`. **Do not `upgrade`** — the tables exist and hold February data.
- **Acceptance Criteria:**
  - [ ] One revision file committed under `backend/alembic/versions/`
  - [ ] `alembic current` on MySQL reports that revision as head
  - [ ] DIAGNOSTIC.md §5 schema check still prints OK for every table

### 7.tests — Migration drift test
- **Status:** PENDING
- **Description:** Write `backend/tests/test_migrations.py` against this contract: create a throwaway SQLite file, run `alembic upgrade head` against it via `-x db_url=`, then compare `Base.metadata` to the migrated database with `alembic.autogenerate.compare_metadata` and assert the diff is empty. Start with `compare_type=False`; SQLite/MySQL type mismatches are expected noise. Also assert the reverse: temporarily adding a column to a model inside the test (monkeypatch) makes the diff non-empty.
- **Acceptance Criteria:**
  - [ ] Test file exists and imports cleanly
  - [ ] It fails until task 6's revision exists (no head to upgrade to) — that is the correct failure
  - [ ] Throwaway database is created under `tmp_path`, never in the repo

### 7.impl — Make the drift test pass and hand off schema ownership
- **Status:** PENDING
- **Description:** With task 6's baseline in place, make `test_migrations.py` green. Then remove `Base.metadata.create_all` from `backend/app/main.py` startup — migrations own the production schema now (roadmap D4). `conftest.py` keeps `create_all`. Update DIAGNOSTIC.md §8 and §10 ("There is no migration tool" is no longer true) and the fix line of the GOTCHAS schema-drift entry to say `alembic revision --autogenerate`.
- **Acceptance Criteria:**
  - [ ] Full pytest passes including `test_migrations.py`
  - [ ] `create_all` absent from `main.py`
  - [ ] DIAGNOSTIC.md and GOTCHAS.md updated
  - [ ] `PROMPT.md` Database paragraph already describes the Alembic rule (done 2026-09-05); confirm it is accurate and leave it
