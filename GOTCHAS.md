# Gotchas

Things that have actually broken this project, with the symptom that identifies them.
Append new entries as they come up. Newest first.

---

## `export $(grep ... .env | xargs)` corrupts the database password

**Symptom:** a `mysql` command that worked in one tab fails in another with
`ERROR 1045 (28000): Access denied for user 'root'@'localhost' (using password: YES)` — a
password *was* sent, and it was wrong. `.env` is correct.

**Cause:** `xargs` strips quotes and backslashes while splitting its input. The password in
`backend/.env` contains characters it eats, so the exported `DB_PASSWORD` is not the one in the
file. Anything that reads `.env` properly (`load_dotenv`, `alembic/env.py`) still works, which
makes it look like a per-tab mystery.

**Fix:** load the file as shell variables instead: `set -a; source .env; set +a`. `prd.md`
task 6 now says this.

**Occurred:** 2026-09-06, during the Alembic baseline.

---

## `test_startup_fails_without_api_token` fails once API_TOKEN is in backend/.env

**Symptom:** the test asserts the app refuses to boot with no token, but the subprocess exits
0 on a machine where `backend/.env` contains `API_TOKEN`. Passes on a clean checkout.

**Cause:** the test strips `API_TOKEN` from the subprocess environment, but `main.py` calls
`load_dotenv()` at import and reads it straight back from the file.

**FIXED 2026-09-05.** The subprocess replaces `dotenv.load_dotenv` with a no-op before
importing `app.main`. Same family as the `token.pickle` entry below: a test that lets real
machine state — a credential file, an env file — reach the code under test will pass on the
machine that lacks it and fail on the one that has it. Isolate the source, not the symptom.

**Occurred:** 2026-09-05, surfaced after task 3 put the token in `.env`.

---

## Ralph loop session reports "write permission was denied" and exits RALPH_BLOCKED

**Symptom:** an iteration finishes in about a minute with no commit and no file changes. The
session output says it cannot modify files and asks for write permission, then prints
`RALPH_BLOCKED`. Earlier iterations that edited files worked fine.

**Cause:** the project's permission allow list contains Bash commands only; there is no `Edit`
or `Write` rule. A `claude --print` session cannot prompt, so a direct file edit is denied.
The iterations that succeeded did so because the agent happened to fall back to
`python3 -c "open(...).write(...)"`, which is allowed via `Bash(python3:*)`. Whether an
iteration succeeded depended on which tool the agent reached for first.

**Fix:** `ralph.sh` now passes `--permission-mode acceptEdits`, which auto-approves file edits
inside the project for the spawned session while Bash stays on the allow list. If the symptom
returns, check the flag is still on the `claude` line.

**Occurred:** 2026-09-05, Phase 4 task 2. One iteration lost.

---

## Ralph loop exits in two seconds with "Credit balance is too low"

**Symptom:** every iteration finishes instantly, `[WARN] Claude session exited with non-zero
status`, nothing changes in the repo. The log shows `Credit balance is too low` a few lines
above the warning.

**Cause:** `ANTHROPIC_API_KEY` is exported from `~/.bashrc`. When it is set, `claude` bills the
API account instead of the claude.ai login, and the API account has no credits. The interactive
session works because it was started under the claude.ai plan; the spawned `claude --print`
sessions inherit the shell env and are not.

**Fix:** `ralph.sh` now runs `env -u ANTHROPIC_API_KEY claude ...` so the loop uses the same
login as the interactive session. If the symptom returns, check the script still does that,
then check `claude` is logged in.

**Occurred:** 2026-09-05, first run of the Phase 4 PRD. Both iterations were lost.

---

## `test_startup_survives_dead_refresh_token` fails only when a real token.pickle exists

**Symptom:** `tests/test_credential_refresh.py::test_startup_survives_dead_refresh_token`
fails with `assert True is False` on a machine that has authorized Google Calendar. It passes
on a clean checkout, so it looks like a regression from whatever changed last. It is not.

**Cause:** the test mocks `open` and `pickle.load` inside a `with` block, then calls
`svc.is_authenticated()` **after** the block exits. `_refresh_if_needed` reloads credentials
from disk when the instance has none, so it reads the real, valid `backend/token.pickle` and
reports authenticated.

**Confirm:** `mv token.pickle token.pickle.aside`, run the test, move it back. It passes.

**FIXED 2026-09-05.** The assertion now sits inside the `with` block so the mocks are still
active. Kept here because the shape — assert after the mocks exit, on a method that reloads from
disk — is easy to reintroduce.

**Occurred:** 2026-09-05, noticed after the Phase 4 loop reported it as pre-existing.

---

## RISK (not yet occurred): the Android foreground-service module may not be buildable

**What it is:** Phase 5 task 5.4 — a native Expo module exposing `SystemClock.elapsedRealtime()`
and a foreground service with an ongoing notification. It is the single task most likely to
sink the rewrite: it needs an Expo **dev build** (Expo Go cannot load it), a config plugin, and
a working Android toolchain, none of which exist in this repo yet.

**Symptom if it fails:** the app runs in Expo Go but the notification never appears, or the dev
build fails at the Gradle step, or `elapsedRealtime()` is undefined at runtime because the
module was not linked into the build that is running.

**Why it is sequenced first:** every timer screen depends on it. Spike it before writing any
screen so the failure is cheap.

**Fallback:** D8's timestamp-only mode. Duration is still `monotonicStop - monotonicStart`
computed on resume, so recordings stay correct; what is lost is visibility while the screen is
locked and protection from the OS killing the process. If the fallback is taken, drop
`elapsedRealtime()` to `Date.now()` with the clock-jump check from D9 kept as the safety net.

**Logged:** 2026-09-05, during Phase 4/5 planning. Move this above the line and rewrite it as a
real entry the day it actually breaks.

---

## Google auth silently drops after about an hour of uptime

**Symptom:** `/api/auth/status` returns `false` on a backend that has been running a while,
even though `backend/token.pickle` is present and the refresh token is good. Restarting the
server fixes it. It comes back.

**Cause:** `GoogleCalendarService` refreshes credentials only in `__init__`, via
`_load_credentials`. Google access tokens last about an hour. Nothing re-refreshes them while
the process runs, so the in-memory object goes stale and `is_authenticated()` reports false.
The stored refresh token is fine the whole time.

**Confirm it is this** and not lost credentials:

```bash
cd backend && venv/bin/python -c "
import pickle; c = pickle.load(open('token.pickle','rb'))
print('refresh_token:', bool(c.refresh_token), '| expired:', c.expired, '| valid:', c.valid)"
```

`refresh_token: True` with `valid: False` is this bug. A fresh `GoogleCalendarService()`
returns authenticated immediately, which proves the credentials are sound.

**FIXED 2026-09-03.** `_refresh_if_needed` now runs before every use via `is_authenticated`,
rather than only at construction. It also reloads credentials from disk when the instance has
none, which matters because `sessions.py` and `calendar_auth.py` each hold their own service
instance. A refresh failure now degrades to unauthenticated instead of raising, so a dead
refresh token no longer stops the backend booting.

The check above is still the right way to tell a genuinely revoked token from a stale one.

**Occurred:** 2026-09-03, on a server up since morning.

---

## Schema drift: new ORM columns never reach MySQL

**Symptom:** an endpoint returns 500 while the full pytest suite passes. The backend log
shows `(1054, "Unknown column 'tasks.is_urgent' in 'field list'")`.

**Cause:** `Base.metadata.create_all` only creates *missing tables*. It never alters an
existing one. Any column added to a model after its table already exists is absent from the
live database, so every query that selects it fails.

Tests do not catch this. `backend/tests/conftest.py` builds a fresh SQLite database from the
models on every run, so the column is always present there. **Green tests plus a 500 on a
live endpoint is the signature of this bug.**

This will recur every time the Ralph loop adds a column to an existing table.

**Check for it** after any Ralph run that touches a model:

```python
from sqlalchemy import inspect
insp = inspect(engine)
for name, table in Base.metadata.tables.items():
    live = {c["name"] for c in insp.get_columns(name)}
    missing = {c.name for c in table.columns} - live
    print(name, sorted(missing) or "OK")
```

**Fix:** run `alembic revision --autogenerate -m 'description'`, review the generated file,
then `alembic upgrade head` against the live database. If for some reason Alembic is
unavailable, add the column by hand:

```sql
ALTER TABLE tasks ADD COLUMN is_urgent TINYINT(1) NOT NULL DEFAULT 0;
```

**Occurred:** 2026-09-02. `tasks.is_urgent`, `tasks.is_important`, `schedule_items.is_frog`
were missing after the Ralph run that completed PRD tasks 1 and 2. Fixed by hand.

---

## Config changes need a backend restart, not just a file save

**Symptom:** you edit `backend/.env` and the running server keeps using the old value. With
Google credentials this shows up as `deleted_client` or `redirect_uri_mismatch` at login,
even though the file on disk is correct.

**Cause:** `load_dotenv()` runs once at import. Environment variables are read into memory at
startup and never re-read. The server is also normally launched without `--reload`, so
nothing restarts it on a file change.

**Fix:** restart uvicorn. `kill -15` the process first and let it exit before escalating.
Confirm the new value is actually live rather than assuming:

```bash
curl -s localhost:8000/api/auth/google/login | grep -oE 'client_id=[^&]+'
```

**Occurred:** 2026-09-02. A server started that morning served a deleted OAuth client for
nine hours after the credentials were rotated.

---

## token.pickle is a credential, not a cache

**Symptom:** it looks like a disposable binary artifact, so it gets committed.

**Cause:** it is a pickled `Credentials` object holding the client ID, the **client secret**,
and a long-lived refresh token. Being binary, it shows up in a diff as unreadable bytes
rather than anything resembling a password.

It is written to the *current working directory* of the server process, so it lands in
`backend/` or the repo root depending on where uvicorn was launched from. Both locations are
now gitignored.

**Occurred:** it was committed to the public repo and stayed in history. Resolved 2026-09-02
by deleting the leaked OAuth client outright, which revokes every token it issued.
