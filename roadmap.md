# Roadmap

The product remake, phase by phase. Phases 1–3 are done; 4–6 were planned on 2026-09-05 and
every decision in the table was put to the user and settled. Do not reopen them without a
reason that did not exist on that date. Task-level detail for the phase in flight lives in
`prd.md`; completed phases are archived under `docs/`.

## Premise

A stopwatch that learns how long activities actually take, and builds day schedules from that
history. Recording is the foundation, scheduling is rules-based (AI later), Google Calendar is
the output surface. Single user by design.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Leaked Google credential revoked and client rotated | Done 2026-09-02 |
| 2 | UTC everywhere, `UTCDateTime` enforced, legacy rows converted | Done 2026-09-01 |
| 3 | Priority flags, server-side strategy engine (7 strategies), peak-hours insights | Done 2026-09-03 — see `docs/prd-phase3-completed.md` |
| 4a | Single bearer credential gate; backend bound to the LAN | **Next** — `prd.md` |
| 4b | Alembic: baseline from live MySQL, drift test, `create_all` out of startup | Any time before deploy; bound to the deploy step |
| 5 | Frontend rewrite as React Native + Expo. Build 1: record and list. Build 2: quadrant, frog, Pomodoro, insights, day calendar | After 4a |
| 6 | Public deploy with TLS, data migration, Google redirect re-registered | Last |

## Decisions (2026-09-05)

| # | Decision | Answer |
|---|---|---|
| D1 | End state | Publicly deployed, TLS, works off the home network |
| D2 | Public deploy timing | Last, after Phase 5 build 1 |
| D3 | Auth | Single static bearer token in FastAPI middleware; on the phone in `expo-secure-store`. No users table, no owner columns — see ADR 0002 |
| D4 | Alembic + suite | Suite keeps `create_all`; a pytest test runs `alembic check` against throwaway SQLite |
| D5 | Alembic baseline | Autogenerate from live MySQL, review, `alembic stamp head` |
| D6 | Platform | React Native + Expo dev build — see ADR 0001 |
| D7 | Targets | Android now; iOS later, kept buildable (native modules carry iOS stubs) |
| D8 | Background timing | As stock Android: timestamp subtraction for truth, foreground service + ongoing notification for visibility |
| D9 | Clock source | Monotonic and wall-clock both captured at start and stop. Monotonic → duration; wall → API timestamps; disagreement > ~2s flags a clock jump |
| D10 | LAN exposure | Bind `0.0.0.0` at the start of Phase 5, only after the gate is on |
| D11 | Existing web frontend | Frozen now; deleted once Android build 1 can record and list |
| D12 | Salvage | `types/index.ts`, `services/api.ts`, `utils/calendarUtils.ts` move to `mobile/`. Nothing else |
| D13 | Parity fixture | `generate_parity.json` frozen; generator deleted; intent kept as a comment in `test_generate.py` |
| D14 | Google OAuth on phone | Never. Authorize once from a laptop; `token.pickle` is global by design |
| D15 | Phase ordering | Gate → Phase 5 → Alembic any time before deploy |
| D16 | Calendar on phone | Day view with native gesture drag/resize; week is a read-only agenda |
| D17 | Offline | Recording only; save is queued and flushed on connectivity |
| D18 | Build 1 scope | Stopwatch, Activities, Recordings, server-side schedule generation |
| D19 | Test stack | `jest-expo` + `@testing-library/react-native`; timer core is a pure module tested without a renderer |
| D20 | Test authorship | A fresh-context Ralph iteration writes each task's tests from its spec before the implementation iteration runs |

## Findings that shaped the plan

- Timer drift was `useStopwatch.ts` accumulating `+10` per tick — a bug, not a platform limit. It is not a reason for the rewrite.
- `fixtures-capture.test.ts` regenerated the backend's parity oracle on every frontend run. Frozen under D13.
- `api.ts` used a relative `baseURL` that only worked through the Vite proxy. The mobile client takes an absolute host from `EXPO_PUBLIC_API_URL`.
- `PROMPT.md` told the Ralph loop no migrations were needed; that was the root cause of schema drift. Rewritten 2026-09-05.
- There is no CI. Any check that is not a pytest test never runs.

## Phase 5 task outline

Full checklist with acceptance gates is in the planning record for 2026-09-05; the PRD for
Phase 5 will be written from it once 4a is done.

**Prep:** freeze the parity fixture · scaffold `mobile/` as an Expo dev build · salvage the three files · add `scheduleAPI.generate()`.

**Build 1, in order:** 5.4 native module spike (foreground service + `elapsedRealtime`, iOS stubs) → 5.5/5.6 timer core, tests first → 5.7 offline save queue → 5.8 screens (Stopwatch, Activities, Recordings, Schedule, Settings) → 5.10 icon port → 5.11 delete `frontend/`.

**Build 2:** quadrant picker → daily frog pick → expose the three API-only strategies → Pomodoro mode in the timer core → peak-hours as the suggested start time → day-view calendar with Google Calendar import/export.

## Phase 6 requirements

TLS mandatory · `alembic upgrade head` as a deploy step · `mysqldump` the February data, restore, `alembic stamp head` · `GOOGLE_REDIRECT_URI` to the public host and registered verbatim · authorize Google once from a laptop · `EXPO_PUBLIC_API_URL` to the public host · verify from cellular with Wi-Fi off.

## Deferred, not scheduled

See `future-work.md`: parallel/stacked activities. The whole engine assumes a sequential day.
