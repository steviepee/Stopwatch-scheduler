# Multi-user transition notes

**Status:** planning only. Nothing here is scheduled or committed to.
**Opened:** 2026-09-17, after the user confirmed that public, per-account use is the intended
end state — which reverses the premise of `docs/adr/0002-single-bearer-gate-no-tenancy.md`.

The plan is to finish the build single-user, work the kinks out, deploy (Phase 6), and only
then open it up. That ordering is deliberate and correct: debugging the product and the tenancy
model at the same time is how both go wrong. This file exists so the transition is a known
quantity when it arrives, and so day-to-day decisions before then can avoid making it worse.

---

## Current state — what "single-user" actually means here

| Piece | Today |
|---|---|
| Auth | One static bearer token, compared in middleware ([main.py:32-40](../backend/app/main.py#L32-L40)). No identity, no sessions, no users table |
| Google credentials | One global `token.pickle` file, loaded into three module-level `GoogleCalendarService()` singletons ([calendar_auth.py:7](../backend/app/routers/calendar_auth.py#L7), [sessions.py:14](../backend/app/routers/sessions.py#L14), [schedules.py:14](../backend/app/routers/schedules.py#L14)) |
| OAuth handshake state | `_pending_state` on the singleton — process memory |
| Ownership | None. No owner column on any of the five tables |
| Web client auth | The browser never holds a token; the **Vite dev proxy** injects it ([vite.config.ts:87](../frontend/vite.config.ts#L87)). This works in dev only — the web app has no production auth path at all today |
| Mobile client auth | Token in `expo-secure-store`, read through `getToken()` in [auth.ts](../mobile/src/services/auth.ts) and attached by one axios interceptor |
| Exempt routes | `/api/health`, `/api/auth/google/login`, `/api/auth/callback` bypass the gate ([main.py:19](../backend/app/main.py#L19)) |

## What has to change, and what it actually costs

| Area | Cost | Notes |
|---|---|---|
| Owner columns + query filtering | **Moderate, mechanical** | 40 `db.query()` call sites across 896 lines of routers. Ownership only needs to land on three roots — `Task`, `Schedule`, `StopwatchSession` — because `time_logs` and `schedule_items` reach an owner through their parent FK. ADR 0002's "all five tables" overstates it |
| Google credentials per user | **The real work** | Credentials move from a pickle file to encrypted rows; the three singletons become request-scoped; OAuth state moves out of process memory. 15 call sites, but the lifetime model changes, not just the plumbing |
| Identity | **Moderate** | Google Sign-In is the cheap path — the same consent that grants Calendar access already identifies the person, so it replaces the static token and answers "what is an owner_id" in one move |
| `Task.name` uniqueness | **Small but sharp** | `unique=True` is global ([task.py:9](../backend/app/models/task.py#L9)). Two users cannot both have "Laundry". Becomes a composite unique on `(owner_id, name)` — easy to write, unpleasant to alter against live data |
| Both clients | **Moderate x2** | Web and mobile are both permanent (roadmap D11). Each needs a real login flow; the web one needs a production auth story it has never had |
| Backfilling existing rows | **Trivial** | One owner id across every row — *provided* it happens before a second person has data |
| Google verification | **Process, not code** | Days-to-weeks review, plus a privacy policy that no longer says "one user — its developer" |

Overall: the same order of magnitude as one of the existing phases. Not a rewrite. The ~114
backend tests are what make a 40-site refactor tedious rather than risky, and Alembic is already
enforced by `tests/test_migrations.py`, so schema changes have a disciplined path.

## Build-time rules — cheap now, expensive later

Standing preference set 2026-09-17: while building the remaining single-user work, lean toward
choices that keep this transition cheap — but only where they do not change the build's
components or procedures. Do not restructure anything for a hypothetical. These qualify:

1. **No new module-level service singletons that hold per-user state.** The three
   `GoogleCalendarService()` instances are already the most expensive thing to unwind. New
   services get constructed per request, or injected.
2. **No new globally-unique constraints on user-owned data.** `Task.name` is already a debt;
   do not add a second one.
3. **Credentials and tokens are stored values, not files on disk.** `token.pickle` will not
   survive a containerised Azure deploy even single-user — an ephemeral container loses it on
   restart. Design that as a stored credential at Phase 6 and the multi-user version becomes
   "add an owner column" instead of "rewrite the credential layer."
4. **No new routes exempt from the bearer gate.** The two OAuth exemptions are unavoidable and
   already need hardening before the backend is public.
5. **New tables get the ownership question asked at design time** — it is one column at
   creation and a migration against live data later.
6. **Keep DB access in the `db.query(Model)` idiom.** Hand-rolled SQL is a call site that a
   mechanical owner-filter pass will miss.
7. **Keep client credential access funnelled through one accessor.** Mobile already does this
   (`getToken()`); swapping it for a session token should stay a one-file change.

## Migration sketch, when the time comes

1. Identity first — pick the provider, add the users table, log in as the one existing user.
2. Add nullable owner columns to the three roots via Alembic; backfill to that user; make them
   non-null in a second revision.
3. Swap the composite unique on `Task`.
4. Filter the 40 query sites; the test suite is the net.
5. Move Google credentials per-user and retire the global pickle.
6. Replace the static bearer gate with real sessions in both clients.
7. Google verification review, and a rewritten privacy policy at stopwatchscheduler.app.

Steps 1-4 are safely doable before there is a second user. Steps 5-7 are the gate.

## Open questions

- **Identity provider:** Google Sign-In only, or email/password too? Google-only is far less
  work and fits an app whose core feature is Calendar — but it hard-couples every account to a
  Google account.
- **Does the existing dataset stay?** Roughly a year of the user's own recordings become "user
  1's" data in a public system. Fine, but worth an explicit decision.
- **Deletion and export obligations.** The export endpoints already exist; account deletion and
  credential revocation do not.
- **Hosting cost per user** on Azure, once it is not one person on a home LAN.
- **Does "public" mean open sign-up, or invite?** Invite-only keeps the Google 100-user
  unverified cap irrelevant for a long time and defers the verification review.

## Related

- `docs/adr/0002-single-bearer-gate-no-tenancy.md` — the decision this supersedes in premise
- `roadmap.md` Phase 6 and D21 — the deploy this lands after
- `GOTCHAS.md` — the Google publishing-status entry, and why the app is published unverified
- `future-work.md` — the short-form entry pointing here
