# Gotchas

Things that have actually broken this project, with the symptom that identifies them.
Append new entries as they come up. Newest first.

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

**Fix:** add the column by hand, matching the model definition. There is no Alembic here.
`Column(Boolean, nullable=False, default=False)` becomes:

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
