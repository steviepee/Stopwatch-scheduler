# Standing Orders — Planning Handoff

Written 2026-09-03 for a fresh agent about to plan **Phase 4 and Phase 5** with the user in
plan mode. Read this, then the three files named below, then start grilling. Do not start by
re-deriving the state of the repo; it was verified the day this was written and the facts are
in section 2.

Your job in that session is to ask, not to build. The user wants to be grilled until the
decisions are actually made. The questions in section 5 are the ones that matter, roughly in
the order they should be settled, because several of them determine each other.

---

## 1. What to read first

| File | Why |
|---|---|
| [DIAGNOSTIC.md](DIAGNOSTIC.md) | The system as it should be. Capabilities, API surface, schema, and a verification checklist. |
| [GOTCHAS.md](GOTCHAS.md) | Four failure modes with symptoms. Read before debugging anything. |
| [future-work.md](future-work.md) | Deferred scope with the reasoning. Two entries, both relevant to Phase 5. |

`prd.md` holds only the **current** phase and is fully consumed. `progress.md` is the Ralph
loop's per-iteration log.

---

## 2. Verified state as of 2026-09-03

- Backend suite: 75 passing. Frontend suite: 16 passing.
- Both servers up; backend on port 8000, Vite on 3000 proxying `/api` to it.
- Google Calendar authenticated and refreshing correctly.
- Live MySQL schema matches the models. All five tables.
- `main` was in sync with origin. Check `git status` for anything left uncommitted, including
  this file.
- Phases 1, 2, and 3 are complete. `prd.md` has nine tasks done, zero pending.

**The leaked-credential incident is closed.** The old OAuth client was deleted and replaced,
which revoked its tokens. The blob still in public git history is dead. Do not raise it again
and do not propose a history rewrite.

---

## 3. The two steps being planned

**Phase 4 — auth + Alembic.** Smaller than the roadmap makes it look: peak-energy analytics
was listed here but already shipped as task 8 of Phase 3. What remains is user authentication
and database migrations.

**Phase 5 — frontend rewrite.** The current frontend is deleted, not extended. The stated
reasons are fatal timer drift, mouse-and-hover-only interaction, and no responsive design.
Target is phone use. Scope includes a quadrant picker, the daily frog pick, a Pomodoro timer
mode, and surfacing insights. It also absorbs the wiring described in future-work.md.

Neither phase has a written task list. That is the immediate output the planning session
should produce.

---

## 4. Decided already — do not reopen

These were settled on 2026-09-01 or during Phase 3. Relitigating them wastes the session.

- **The backend is the asset.** Kept and extended first, API frozen before the rewrite.
- **The frontend is rebuilt from scratch**, not refactored.
- **Rules-based scheduling now, AI later.** The strategy registry is deliberately shaped so an
  AI planner slots in as one more entry rather than a rewrite.
- **All four methodology concepts eventually**: Eisenhower, Eat the Frog, Timeboxing, Pomodoro.
- **UTC everywhere**, with an explicit `Z` suffix, enforced by `UTCDateTime`.
- **Phase 3's server-side engine stays unwired** until the rewrite. The browser-side ordering
  code is the parity reference its tests measure against, so it cannot be deleted first.

---

## 5. What to grill on

### The question that unlocks the others

**Where does this actually run?** Today the backend is on localhost and the app is a browser
tab on the same machine. A phone app cannot talk to localhost. So the moment Phase 5 targets a
phone, the backend has to be reachable from off-box, and the moment it is reachable, it needs
authentication. Phase 4 and Phase 5 are coupled through deployment, and the user may not have
noticed that yet. Settle this first; several answers below collapse out of it.

### Phase 4 — authentication

- What is auth actually for? The app is single-user by design and the roadmap says so. Is this
  protecting a deployed instance, or is it genuinely multi-user?
- If it is one person on their own server, is a single credential gate enough, or is real user
  management wanted? These have very different schema costs.
- Does it imply multi-tenancy? Every table would need an owner column, and every query a filter.
  That is a far larger change than "add auth" sounds.
- What happens to the Google token? There is currently one credential file on disk, global to
  the process. Per-user calendars would change that model.
- Does auth block the rewrite, or can they proceed in parallel?

### Phase 4 — Alembic

- The database already exists with real data. Stamp it at a baseline revision, or generate an
  initial migration representing current state?
- Do the tests keep building from models, or start running migrations? **If they keep using
  `create_all`, the drift problem Alembic is meant to solve stays invisible to the suite.**
  This is the question that decides whether Alembic actually earns its keep.
- Does the Ralph loop own migration generation? If so `PROMPT.md` needs updating, or the
  automation will keep adding columns that never reach the database.
- Is a check wanted that fails when models and migrations disagree?

### Phase 5 — the platform decision

Left open on 2026-09-01 and still open. It gates everything else in the phase.

- **React Native with Expo, or stay a progressive web app?**
- **Does the timer need to run while the app is backgrounded or the screen is off?** This is
  the single question that decides the platform. A web app cannot reliably time in the
  background on iOS. If the answer is yes, the choice is made for them.
- Timer drift is given as a reason for the rewrite. Drift comes from how the interval is
  implemented, not from the platform. Push on whether a rewrite is required to fix it, or
  whether it is being bundled in with the real reasons.
- Android only, or iOS as well? The roadmap says both. iOS materially changes the answer.
- Does offline still matter? The current app is an installable PWA with caching.
- What survives the rewrite? The types, the API client, and the calendar utilities are
  candidates. Or is it genuinely everything?
- What happens to the 16 existing frontend tests, and to the parity fixtures once the code they
  were captured from is deleted?

### Cross-cutting

- Existing recordings must survive whatever happens. There is real data from February.
- The Google redirect URI is registered per OAuth client and currently points at localhost.
  Deployment changes it.
- Is there an order preference between the two phases, or a reason to interleave?

---

## 6. Traps for a cold agent

- **Green tests do not prove the app works.** The suite builds a fresh SQLite database from the
  models each run and never touches MySQL, so it structurally cannot see schema drift. A passing
  suite alongside a 500 is the signature. See GOTCHAS.
- **The API-only surface is not a bug.** Three strategies, peak-hours, and the priority flags
  have no interface and no client write path. That is deliberate sequencing. Do not "fix" it.
- **`prd.md` is empty of pending work.** Running the Ralph loop now does nothing.
- **The roadmap is not in the repo.** It exists only in agent memory. Writing it into the
  project as a real file is a reasonable first act of the planning session.
- **Config changes need a backend restart.** Environment variables are read once at import.
- Collection endpoints need trailing slashes; FastAPI redirects without them.

---

## 7. How the user works

- Concise and direct. No preamble, no restating the question.
- Never commit or push unless explicitly asked. Stage files by name.
- `kill -15` before `kill -9` on their processes.
- Markdown links for file references, never backticks around paths.
- They will push back on reasoning they find thin, and they expect the pushback to be answered
  rather than absorbed.
