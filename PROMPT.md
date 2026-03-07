# Ralph Loop — Autonomous Iteration Prompt

You are running as an autonomous coding agent inside a Ralph loop. This is a fresh session with no memory of previous iterations. You will complete **exactly one task** from `prd.md`, then exit.

Do not ask questions. Do not wait for input. Execute the procedure below in full.

---

## Procedure

Follow every step in order. Do not skip steps.

### Step 1 — Pick your task

Read `prd.md`. Find the **first task** whose status is `PENDING`. That is your task for this session. Work on nothing else.

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

**Project-specific patterns to follow:**
- Design system: glassmorphic. Use existing `glass-*` CSS classes from `frontend/src/index.css`. Do not invent new visual patterns.
- Card hover effect: `hover:scale-105 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] hover:bg-white/5 hover:backdrop-blur-sm transition-all duration-300 ease-out`
- New TypeScript interfaces go in `frontend/src/types/index.ts`.
- New API methods go in `frontend/src/services/api.ts`, following the existing `taskAPI` / `sessionAPI` pattern.
- New components go in `frontend/src/components/`.
- Backend routes go in `backend/app/routers/`, registered in `backend/app/main.py`.

### Step 5 — Verify

Do not skip verification. Do not mark a task DONE if verification fails.

**For any frontend changes:**
```
cd frontend && npx tsc --noEmit
```
All TypeScript errors must be resolved. Fix errors and re-run until it passes cleanly.

**For any backend changes (if a test suite exists):**
```
cd backend && source venv/bin/activate && pytest
```

**For task 5 (backend tests) and task 6 (frontend tests):**
All written tests must pass. The test suite passing IS the acceptance criteria. Run tests after writing them and fix failures before proceeding.

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
| Frontend entry | `frontend/src/main.tsx` | |
| Frontend pages | `frontend/src/pages/HomePage.tsx` | Tab layout lives here |
| Frontend components | `frontend/src/components/` | |
| Frontend types | `frontend/src/types/index.ts` | All TS interfaces |
| Frontend API client | `frontend/src/services/api.ts` | Axios, follows taskAPI/sessionAPI pattern |
| CSS design system | `frontend/src/index.css` | All `glass-*` classes defined here |

**Database:** MySQL, `stopwatch_scheduler`. New tables are created automatically via `Base.metadata.create_all` on backend restart — no manual migrations needed.

**Backend venv:** Always activate before running Python: `source backend/venv/bin/activate`

**UI tab labels (display only, not DB values):** Calendar / Schedule / Recordings / Activities / Options
