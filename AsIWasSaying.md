# Standing Orders — Phase 4 → 5

Current as of 2026-09-08. Read this, then `prd.md`, then start on the first PENDING task.

## 0. Pick up here

**Next action: run the loop from a Windows Terminal tab, not a VS Code terminal.**

```
./ralph.sh --max 9
```

9 PENDING tasks remain, all Build 1b, starting at **P16.tests** (session bank + week agenda).
Everything through P15.impl is committed and green.

This must run outside VS Code. A Claude session started in a VS Code terminal is a **child of
`vscode-server`**, so it cannot free that memory by killing it — it would kill itself and the
loop with it. On 2026-09-08 two runs were OOM-killed from inside VS Code, each losing an
iteration; the tree was confirmed with `pstree -sp $$`. Close VS Code entirely (the window alone
is not enough — check `pgrep -cf vscode-server`), and stop Metro if it is up:
`kill -15 $(pgrep -f "expo start")`. The loop never needs Metro.

**If an iteration is OOM-killed, the recovery drill is:**

1. `git status --short` — the killed iteration's work is uncommitted; committed work is safe.
2. Delete the orphaned `.tests` file it left untracked (GOTCHAS entry 2).
3. `git checkout` any modified implementation file, and `git checkout prd.md` if the task was
   marked DONE without a commit.
4. Confirm clean: from `mobile/`, `npx jest` and `npx tsc --noEmit`.
5. Re-run `./ralph.sh` with the number of tasks still PENDING. `prd.md` is the source of truth.

**Before starting a long loop run, read the three loop entries at the top of `GOTCHAS.md`** —
usage limits silently burn iterations, killed iterations leave orphaned test files, and
`vscode-server` plus Metro will OOM-kill the loop on this 7.6 GB box.

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

- Backend suite **114** passing; frontend 15; mobile **117** across 12 suites. Backend on 8000, Vite on 3000 proxying `/api`. The mobile suite runs from `mobile/`: `npx jest --ci`, `npx tsc --noEmit`, `npx expo export --platform android`.
- Google Calendar authenticated; credentials refresh on use.
- Live MySQL schema matches the models; `schedule_items.calendar_event_id` was added by P13's Alembic revision.
- Phases 1–4 complete. Phase 5 build 1 is **done through P9** — all five screens, the icon, the offline queue. Build 1b (P12–P21) is in flight: P12–P15 committed, P16 onward PENDING. Task status lives in `prd.md`, per-task notes in `progress.md`. This file does not track it.
- **Known unfixed bug:** `useCreateSession` invalidates `['sessions']` but not `['tasks']`, so an Activity's average is stale on screen after a Recording syncs. One line in [mutations.ts](mobile/src/services/mutations.ts); it will make the P10 average check look broken when it is not.

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

Run it with `./ralph.sh --model claude-opus-5` through P7.impl, then without `--model` (P7 is
long done, so Sonnet is right for everything remaining). P1, P5, P10, and **P21** are USER tasks.
Decisions D22–D33 in `roadmap.md` shaped build 1; **D34–D38 in `prd.md` shaped build 1b**.

**P11 (delete `frontend/`) is HOLD behind P21, not P10.** The calendar was pulled forward out of
build 2 on 2026-09-08 because the web app cannot be retired without it — the user needs a
drag/resize calendar on the phone, Google events pulled in as a read-only overlay, and regimens
pushed out to Google. Build 1b also keeps CSV/JSON export (via one-time signed links, since
`expo-web-browser` cannot carry the bearer token) and the display-metric options.

Two ordering traps in build 1b: **P19 copies `cloth_mural.jpg` out of `frontend/public/` before
P11 deletes it**, and P13's column needs an Alembic revision because `create_all` is out of
startup and MySQL will not add it on its own.

Build 2 gets its own PRD after P21 passes. Its outline, minus the calendar, so it is not lost:

- Quadrant picker on the Activity screen → `PUT /api/tasks/{id}` with `is_urgent` / `is_important`.
- Daily frog pick in the Schedule screen → `is_frog` on the schedule item.
- Expose `eat-the-frog`, `eisenhower`, `best-fit-slots` as selectable strategies.
- Pomodoro as a mode of `timer/core.ts` (work/break intervals, notification on transition).
- Stop button on the foreground notification.
- Peak-hours (`GET /api/insights/peak-hours`) as the suggested start time in the Schedule screen.

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
3. **Build 1 (P10), no longer the gate on its own:** on a physical Android phone against the LAN backend — start recording, lock the screen 10+ minutes, unlock, stop; duration matches wall time within 1s; notification was visible while locked; save lands in MySQL. Airplane mode: record and save → queued; airplane off → appears in `GET /api/sessions/`.
4. **Build 1b (P21), the real gate to delete the web app:** drag a recording onto the calendar, move and resize it, reopen the app and confirm it stuck; today's Google events show and cannot be dragged; push a recording and a whole regimen to Google, push the regimen twice and get no duplicates; export recordings as CSV from Settings; the background renders with text still readable.
5. **Phase 6:** gate 3 from cellular with Wi-Fi off.

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
