---
status: accepted; premise superseded 2026-09-17
date: 2026-09-05
---

> **2026-09-17:** the "single-user by design" premise no longer holds as an end state — the
> user intends per-account public use after the Phase 6 deploy. This decision still stands for
> the current build, and its cost analysis below is still the best one available. Plan against
> `docs/multi-user-transition.md`; supersede this ADR properly when the work is scheduled.

# One static bearer token, no user accounts, no tenancy

The backend is being exposed beyond localhost and eventually deployed publicly, so it needs
protection. We chose a single static bearer token checked in FastAPI middleware — no users
table, no owner columns, no per-request filtering — because the app is single-user by design
and every heavier option is user-management machinery serving a user count of one.

## Considered options

- **Static bearer token in middleware.** Chosen. Stored on the phone in `expo-secure-store`;
  exempts only `/api/health` and the Google OAuth login/callback routes.
- **Login endpoint issuing session JWTs.** Rejected: session state and expiry logic with no
  second user to justify it.
- **Full multi-tenancy.** Rejected: `owner_id` on all five tables, every query filtered, and
  per-user Google credentials replacing the one global `token.pickle`. Weeks of work that
  touches every router and test.

## Consequences

- **TLS is mandatory at deploy.** A bearer token over plain HTTP off the home network is a
  leaked credential.
- Adding a second user later is a schema change, not a config change: every table gains an
  owner, every query gains a filter, and the Google Calendar service stops being global. This
  was understood and accepted.
- The Google token stays a single global file. A phone never runs the OAuth flow.
