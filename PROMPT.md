# Ralph Loop — Autonomous Iteration Prompt

You are running as an autonomous coding agent inside a Ralph loop. This is a fresh session with no memory of previous iterations. You will complete **exactly one task** from `prd.md`, then exit.

Do not ask questions. Do not wait for input. Execute the procedure below in full.

---

## Procedure

Follow every step in order. Do not skip steps.

### Step 1 — Pick your task

Read `prd.md`. Find the **first task** whose status is `PENDING`. That is your task for this session. Work on nothing else. Tasks whose status is `USER` are the user's to do by hand; they are not PENDING, never pick them, and do not wait on them unless your task's description says it depends on one.

If there are no PENDING tasks, output `RALPH_DONE: all tasks complete` and exit immediately.

### Step 2 — Read previous learnings

Read `progress.md`. Note any gotchas, failed approaches, or environment issues logged by previous iterations that are relevant to your task. Take them seriously — previous sessions already discovered these the hard way.

### Step 3 — Read before writing

Read every file relevant to your task before modifying anything. Do not change code you have not read. Understand existing patterns before adding new ones.

### Step 4 — Implement

Implement the task. Every acceptance criterion listed under your task in `prd.md` must be satisfied.

**Hard constraints:**
- One task only. No scope creep. No unrequested refactors or "improvements."
- Prefer editing existing files over creating new ones.
- Do not add comments, docstrings, or type annotations to code you did not change.
- No error handling for impossible scenarios — validate only at system boundaries.
- Follow existing code patterns. This is not a greenfield project.

**Forward-compatibility (per-account multi-user is the end state — see `docs/multi-user-transition.md`):**
Apply these only where they cost nothing. Never restructure existing code or change a task's
approach for them; if a rule conflicts with your task's acceptance criteria, the criteria win.
- No new module-level service singletons holding per-user state. Construct per request instead.
- No new globally-unique constraints on user-owned data (`Task.name` is already one; do not add another).
- No new credentials or tokens written to files on disk. Stored values only.
- No new routes added to the bearer gate's exempt list in `backend/app/main.py`.
- New tables get an ownership question asked at design time, and DB access stays in the
  `db.query(Model)` idiom so a later owner-filter pass can find every call site.

**Project-specific patterns to follow:**

The active client is `mobile/` (React Native + Expo Router). `frontend/` is the **frozen** web
app — kept permanently as a second client (roadmap D11), but no features and no fixes unless a
task says so explicitly. Read the PRD's own rules section; it is authoritative over this list.

- Stack is pinned: Expo Router, `StyleSheet` + `src/theme/tokens.ts`, TanStack Query for server
  state and the offline queue, axios for HTTP. Do not introduce NativeWind, React Navigation
  directly, Redux, or a second HTTP client.
- New TypeScript interfaces go in `mobile/src/types/index.ts`.
- New API methods go in `mobile/src/services/api.ts`, following the existing `taskAPI` /
  `sessionAPI` pattern. Collection endpoints keep their trailing slash; all datetimes are UTC
  with a `Z` suffix.
- Routes are files under `mobile/src/app/` (note: `src/app/`, not `app/`).
- Phone-first: 44pt minimum touch targets, no hover states, portrait, safe-area aware.
- Backend routes go in `backend/app/routers/`, registered in `backend/app/main.py`.
- **No dependency changes.** `npm install`, `npx expo install`, and `npx create-*` are not
  available to the loop. If a task genuinely needs a missing package, mark it BLOCKED naming the
  package rather than working around it.

### Step 5 — Verify

Do not skip verification. Do not mark a task DONE if verification fails.

**For any `mobile/` changes — all three must pass:**
```
cd mobile && npx jest --ci
cd mobile && npx tsc --noEmit
cd mobile && npx expo export --platform android
```
`npx expo prebuild` is not available, and the loop cannot run an emulator or a phone — native
and on-device correctness is verified by the PRD's USER tasks, not here.

**For any `backend/` changes:**
```
cd backend && ./venv/bin/python -m pytest tests/
```
Call the venv's Python by path. **Do not use `source venv/bin/activate`** — `source` is blocked
in this sandbox. Same for any other venv tool: `./venv/bin/alembic`, `./venv/bin/python -m uvicorn`.

**For a `.tests` task:** the tests you write must fail against the un-implemented feature — that
is the correct result, not a failure to fix. For an `.impl` task: its paired tests must pass, and
you must not edit the `.tests` file except to add fixtures or mocks. If an assertion is wrong,
mark BLOCKED and say why.

If verification fails and you cannot resolve it within reasonable effort, follow the BLOCKED procedure below instead of marking the task DONE.

### Step 6 — Update prd.md

In `prd.md`, find your completed task and make these exact changes:

- Change `**Status:** PENDING` → `**Status:** DONE`
- Change every `- [ ]` under Acceptance Criteria → `- [x]`

If blocked instead:
- Change `**Status:** PENDING` → `**Status:** BLOCKED`
- Add a new line directly below Status: `**Failure Notes:** [what failed and why]`

### Step 7 — Append to progress.md

Append a new entry to the bottom of `progress.md`. Do not edit existing entries. Use this format:

```
## [Task Number]. [Task Name]
- **Date:** YYYY-MM-DD
- **Status:** DONE | BLOCKED
- **Summary:** [1–3 sentences describing what was implemented or what failed]
- **Files changed:** [comma-separated list of relative paths]
- **Verification:** [command that ran and whether it passed or failed]
- **Gotchas:** [anything a future session must know, or "None"]
```

Be specific in Gotchas. If you hit an environment issue, an unexpected API shape, a TypeScript edge case, or a pattern that did not work — write it down. The next session reads this before starting.

### Step 8 — Commit

Stage only the files you changed by name. Do not use `git add -A` or `git add .`

```
git add [specific file paths]
git commit -m "ADD: [task name]"
```

If blocked, commit only the updated tracking files:
```
git add prd.md progress.md
git commit -m "BLOCKED: [task name] — see progress.md"
```

### Step 9 — Exit

Output this exact line and stop:

```
RALPH_DONE: [task name]
```

Or if blocked:

```
RALPH_BLOCKED: [task name]
```

---

## Blocked Procedure

If you cannot complete the task — environment issue, missing dependency, intractable bug — do the following:

1. **Revert** any partial implementation. Do not leave the codebase in a broken or half-implemented state.
2. Mark the task **BLOCKED** in `prd.md` with a clear failure note.
3. Append a **BLOCKED** entry to `progress.md` with enough detail that the next session can either fix the blocker or try a different approach.
4. Commit only `prd.md` and `progress.md`.
5. Output `RALPH_BLOCKED: [task name]` and exit.

Do **not** attempt the next PENDING task. One task per session. Exit and let the loop decide what comes next.

---

## Project Reference

| Layer | Location | Notes |
|---|---|---|
| Backend entry | `backend/app/main.py` | Register new routers here |
| Backend models | `backend/app/models/` | SQLAlchemy ORM + Pydantic schemas in `schemas.py` |
| Backend routers | `backend/app/routers/` | One file per resource |
| Backend env | `backend/.env` | DB credentials + Google OAuth |
| Backend migrations | `backend/alembic/versions/` | Every model change needs a revision |
| Mobile routes | `mobile/src/app/` | Expo Router; tabs under `(tabs)/`, settings at `settings.tsx` |
| Mobile types | `mobile/src/types/index.ts` | All TS interfaces |
| Mobile API client | `mobile/src/services/api.ts` | Axios, follows taskAPI/sessionAPI pattern |
| Mobile tests | `mobile/src/__tests__/` | jest-expo + @testing-library/react-native |
| Mobile theme | `mobile/src/theme/tokens.ts` | Colours, spacing, radii, type scale |
| Native timer module | `mobile/modules/timer-native/` | Kotlin foreground service; iOS stubs |
| Web app (frozen) | `frontend/` | Second client, kept permanently (D11). Do not modify unless the task says to |

**Database:** MySQL, `stopwatch_scheduler`. **Alembic owns the schema** — `create_all` is out of
startup, and MySQL will not pick up a new column on its own (see GOTCHAS.md, "Schema drift"). Any
model field needs a revision in `backend/alembic/versions/`, generated with
`./venv/bin/alembic revision --autogenerate`, and `backend/tests/test_migrations.py` fails on any
model change without one. The test suite still uses `create_all` in `conftest.py` (roadmap D4).

**Backend venv:** call binaries by path — `./venv/bin/python`, `./venv/bin/pytest`,
`./venv/bin/alembic`. `source` is blocked in this sandbox. Run from `backend/`: `main.py` calls
bare `load_dotenv()`, which resolves `.env` from the working directory.

**UI tab labels (display only, not DB values):** Calendar / Schedule / Recordings / Activities / Options
