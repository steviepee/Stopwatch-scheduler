
### USER 2026-09-03T22:36:26
read Asiwassaying.md, then /plan implementation checklist on asiwassaying goals

### ASSISTANT 2026-09-03T22:36:28
I'll read the file first.

### ASSISTANT 2026-09-03T22:36:49
Docs read. Repo is clean, and I confirmed one thing worth saying up front: the timer drift is [useStopwatch.ts:11-13](frontend/src/hooks/useStopwatch.ts#L11) — it accumulates `+10` per tick on a 10ms interval instead of measuring `Date.now()` deltas. That's a five-line fix on any platform. It is not a reason to rewrite, and it shouldn't be counted as one.

Four decisions gate the whole checklist.

### ASSISTANT 2026-09-03T22:41:32
What would you like to clarify? Any of the four — or the framing itself, if I've set one up wrong.

### USER 2026-09-03T22:43:52
In the end, it would be a deployed instance. Those were the right questions, sorr

### ASSISTANT 2026-09-03T22:43:57
Good — that settles it: deployed means auth is real, not theoretical. The remaining question is *when* it lands, since "in the end" leaves room for building Phase 5 against a LAN backend and hardening later.

### ASSISTANT 2026-09-03T23:23:21
Two of those answers pull against each other, and it changes the order of work:

**React Native cannot talk to localhost.** Expo Go on a physical phone reaches the backend over the LAN, not the loopback. So "deploy last" holds for the *public* host, but binding the backend to `0.0.0.0` and re-registering the Google redirect URI has to happen at the *start* of Phase 5, not the end — otherwise the app can't make a single API call in dev. Auth then stops being theoretical on day one of the rewrite, not at the end.

Three things left before I can write the checklist.

### ASSISTANT 2026-09-03T23:24:06
What would you like to clarify?

### USER 2026-09-03T23:24:35
<command-message>grill-with-docs</command-message>
<command-name>/grill-with-docs</command-name>
<command-args>this plan</command-args>

### ASSISTANT 2026-09-03T23:24:45
Plan-mode note: I can't write `CONTEXT.md` or an ADR yet — only the plan file. I'll flag the ones worth creating and write them after approval.

Gathering facts before the round.

### ASSISTANT 2026-09-03T23:25:43
Facts first, three of which change the questions:

- [api.ts:4](frontend/src/services/api.ts#L4) sets `baseURL = '/api'` — a **relative** URL that works only because of the Vite dev proxy ([vite.config.ts:78](frontend/vite.config.ts#L78)). React Native has no proxy and no origin, so salvaging the client means replacing that with an absolute configurable host. That's the same knob deployment flips later.
- [fixtures-capture.test.ts](frontend/src/__tests__/fixtures-capture.test.ts) is not a test. It **overwrites** `generate_parity.json` on every frontend run. The backend's parity suite is currently measured against a file the frontend regenerates — the oracle moves. Deleting the frontend freezes it, which is the state you actually want.
- The "16 tests" are 3 RTL component files plus that generator. All three die with the DOM.

**Round 1**

❓ **Q1** — **Platform targets**: Android only, Android first with iOS reachable later, or both from the start? This gates the cost of everything native. Both-from-the-start adds an Apple developer account, a second distribution pipeline, and the hardest half of the background-timing work.

➡️ **Android first, iOS reachable later.** The existing PWA targeted Android, you're the only user, and Expo keeps iOS a build target rather than a rewrite. Pay the Apple cost when there's a second user or a real reason.

---

❓ **Q2** — **Android background depth**: Answerable regardless of Q1, since Android is in scope either way. Three levels: (a) persist the start timestamp and recompute elapsed on resume — correct totals, no live tick while away; (b) a real foreground service ticking with a live notification; (c) foreground service plus full lock-screen controls (stop/lap from the notification).

Worth being honest about what "screen off and still running" needs: a stopwatch only has to report a *correct total*. Option (a) always does, because elapsed is `now - start`. What (b) buys is **visibility** — seeing it run without opening the app — and protection from the OS killing the process. That's a real benefit, but it's a different benefit than correctness, and it's worth knowing which one you're paying for.

➡️ **(b), foreground service with a live notification.** It's the one that makes the app trustworthy for long recordings, and Expo's config-plugin route makes it tractable. Note this forces an **Expo dev build** — Expo Go cannot run it.

---

❓ **Q3** — **When the backend leaves localhost**: You said deploy last, and for the *public* host I agree. But an RN app on a physical phone can't reach `127.0.0.1` even in development, so the backend must bind `0.0.0.0` and get a LAN-registered Google redirect URI on roughly day one of Phase 5. Options: (a) LAN exposure at the start of Phase 5, public deploy after; (b) develop against the Android emulator's `10.0.2.2` loopback alias and delay LAN exposure until you test on a real handset; (c) deploy publicly earlier than planned and skip the LAN step entirely.

➡️ **(a).** Emulator-only development hides exactly the problems a phone-first rewrite exists to find — touch targets, real network latency, OAuth in a system browser. Expose on the LAN early, keep the public deploy last.

---

❓ **Q4** — **Salvage set**: Which of `types/index.ts` (164 lines, pure interfaces), `services/api.ts` (203 lines, axios, one line of DOM coupling), `utils/calendarUtils.ts` (176 lines, framework-agnostic date math) survive? Or genuinely nothing?

➡️ **All three.** None of them touch the DOM except that one `baseURL` line; axios runs unmodified in React Native; and rewriting the client from scratch reintroduces the trailing-slash 307 bug that's already documented as a gotcha. "Rebuilt from scratch" was a decision about the *UI*, and these three files are not UI.

---

❓ **Q5** — **Parity fixture**: Once `ScheduleTimeline.tsx` is deleted, the generator dies with it. Options: (a) commit the current fixture as frozen regression data and delete the generator — the backend's seven strategies then become the definition of correct; (b) port the generator to a standalone Node script so the oracle stays regenerable; (c) delete the fixture and rewrite the parity tests as ordinary assertions against the backend.

➡️ **(a), freeze it.** A regenerable oracle that lives in the code under test is not an oracle. Freezing it turns a circular check into a genuine regression guard, and it costs nothing.

---

❓ **Q6** — **Alembic baseline**: The MySQL database already exists with real February data. Options: (a) autogenerate an initial migration representing current state, then `alembic stamp` the live database at that revision so it isn't re-run; (b) hand-write the baseline migration; (c) drop and rebuild from migrations — data loss, listed only for completeness.

➡️ **(a).** Autogenerate against the live schema, eyeball the diff for the `TINYINT(1)` boolean handling that the gotchas entry calls out, then stamp. It gives you a migration that provably matches production because it was derived from it.

### USER 2026-09-03T23:37:08
where are we

### ASSISTANT 2026-09-03T23:37:19
**Settled (round 0):**

| Decision | Answer |
|---|---|
| End state | Publicly deployed instance |
| Deploy timing | Last, after Phase 5 — with the LAN caveat in Q3 |
| Auth scope | Single credential gate. No users table, no owner columns, no query filters |
| Alembic + tests | Keep `create_all` in the suite, add a separate model-vs-migration drift check |
| Platform | React Native + Expo — forced by wanting true background timing |

**Open — round 1, on the table now, unanswered:**

- **Q1** Platform targets → I recommend Android first
- **Q2** Android background depth → I recommend foreground service + live notification
- **Q3** When the backend leaves localhost → I recommend LAN at the start of Phase 5
- **Q4** Salvage set → I recommend keeping types, api client, calendar utils
- **Q5** Parity fixture → I recommend freezing it
- **Q6** Alembic baseline → I recommend autogenerate + stamp

**Waiting on those (round 2):** iOS background depth (needs Q1), what the credential gate actually is and where the token lives on the phone (needs Q3), whether the drift check runs in CI or pre-commit, and what Phase 5 does about offline now that the PWA's Workbox caching goes away.

**Findings so far that change the plan regardless of your answers:**
1. Timer drift is [useStopwatch.ts:11-13](frontend/src/hooks/useStopwatch.ts#L11) accumulating `+10` per tick instead of measuring `Date.now()` deltas — a five-line bug, not a platform limitation. It should be struck from the list of reasons for the rewrite.
2. [fixtures-capture.test.ts](frontend/src/__tests__/fixtures-capture.test.ts) regenerates the backend's parity oracle on every frontend test run.
3. [api.ts:4](frontend/src/services/api.ts#L4) depends on the Vite dev proxy, so the API host becomes configuration in Phase 5.

Nothing written yet — plan file is still empty, no code touched. Answer round 1 and I'll recompute the frontier.

### USER 2026-09-03T23:54:06
Q1: Android and IOS, but just Android right now. Q2: Whichever is the same way the stock Android stopwatch keeps time. Q3: a. Q4: proceed with recommended answer. Q5: a, but is there anything in the generator we may want to hold on to? Q6: a.

### ASSISTANT 2026-09-03T23:55:17
**Q5 sub-question, answered from the code:** the backend reads `input` from the fixture as its request payload and `strategies.*.timeline` as expected output ([test_generate.py:6](backend/tests/test_generate.py#L6), lines 73–223), so the JSON is fully self-contained. Freezing it loses nothing executable. What dies with the generator is *intent*: the 1800s tie between "Email sweep" and "Read chapter" is deliberate — it pins stable sort order — and the fixed UTC instants are a deliberate timezone-independence choice. Neither is visible in the JSON. Both are worth preserving as a provenance comment. The tie behaviour itself is already independently covered by `test_generate_shortest_first_stable_sort` and its longest-first twin, so nothing is left unguarded.

**Q2, answered:** the stock Android stopwatch does *both* things I split apart — it keeps a start timestamp and derives elapsed by subtraction (never accumulating ticks; the redraw loop is only for rendering), and it runs an ongoing notification so it survives backgrounding and stays visible. So your answer is my (b), and it subsumes (a). That raises one genuine sub-decision, Q7 below.

One check before the round.

### ASSISTANT 2026-09-03T23:55:42
**PROMPT.md:153 is the drift bug's source.** It tells the Ralph loop *"New tables are created automatically via `Base.metadata.create_all` on backend restart — no manual migrations needed."* That instruction is why Ralph keeps adding columns that never reach MySQL. Phase 4 has to rewrite that line or Alembic will be adopted and immediately routed around. Also: there is no CI, which constrains Q11.

**Round 2**

❓ **Q7** — **Which clock measures elapsed time**: You chose timestamp-subtraction. That leaves *which* timestamp. `Date.now()` is wall-clock — it jumps when NTP corrects the phone or you change the clock, and a jump mid-recording silently corrupts that duration. Android's `SystemClock.elapsedRealtime()` is monotonic and counts through deep sleep, immune to both. The API separately needs real wall-clock `start_time`/`end_time` to satisfy the UTC contract, so you need a wall-clock reading regardless.

➡️ **Record both at start and stop.** Monotonic for the duration, wall-clock for the timestamps the API already requires. They're both needed anyway, and when they disagree by more than a second or two you've detected a clock change instead of silently recording a wrong duration. The monotonic reading comes out of the same native module that's already being written for the foreground service, so the marginal cost is near zero.

---

❓ **Q8** — **When the current web frontend actually gets deleted**: The handoff says deleted, not extended — I'm not reopening that. What's open is *when*. It is currently your only way to reach February's recordings. Options: (a) delete at the start of Phase 5, rebuild blind; (b) freeze it — no new features, no fixes — and delete once the Android app can record and list; (c) keep it permanently as the desktop client alongside the phone app.

➡️ **(b), freeze then delete.** You lose UI access to your own data for the whole rewrite otherwise, and the app's entire premise is that the historical durations are the asset. (c) is tempting but doubles the surface you maintain forever, and the API freeze is what makes (b) safe — it's already decided.

---

❓ **Q9** — **What the credential gate actually is**: Single-user, no users table. Options: (a) a static bearer token in a header, checked by FastAPI middleware, stored on the phone in `expo-secure-store`; (b) HTTP Basic over TLS; (c) a login endpoint issuing a session JWT.

➡️ **(a).** No schema change, no session state, no expiry logic, ~30 lines of middleware. It's the honest implementation of "one credential gate" — (c) is user-management machinery wearing a single-user costume, and (b) puts the secret in every request URL-adjacent header with worse phone-side storage ergonomics.

---

❓ **Q10** — **How Google OAuth completes on a phone**: The callback lands on the *backend*, not the app. Options: (a) app opens the system browser, backend's callback page deep-links back via a custom scheme; (b) app opens the browser and then polls `/api/auth/status`; (c) Google authorization stays a desktop-only administrative action — you authorize once from a laptop and the phone never runs the flow.

➡️ **(c).** `token.pickle` is a single global file on disk by design — there is no per-user credential for the phone to obtain. Building a deep-link flow would produce exactly the same one global token, with a custom URL scheme and an Expo dev-build config to maintain. Authorize from a laptop; the phone just benefits.

---

❓ **Q11** — **Where the drift check runs**: There's no CI, so "add a check" needs a home. Options: (a) `alembic check` against a throwaway SQLite database inside the pytest suite — fails when a model changed without a matching revision, needs no MySQL, runs on every `pytest`; (b) a standalone script run manually before deploys; (c) a pytest test that connects to live MySQL, skipped when unavailable.

➡️ **(a).** It's the only option that makes the drift structurally visible to the suite while keeping the 75 existing tests on `create_all` — which is exactly the compromise you picked. (c) reproduces the current situation, where the check exists but never runs. Pair it with rewriting [PROMPT.md:153](PROMPT.md#L153), or Ralph will keep bypassing it.

### USER 2026-09-04T00:30:48
Q7: go with your perscription. Q8: b. Q9:a. Q10: c. Q11: a

### ASSISTANT 2026-09-04T00:31:44
3,225 lines of components; dnd-kit is confined to 4 calendar files (~650 lines) — the most mouse-bound code in the app and the hardest thing to port.

**Round 3**

❓ **Q12** — **Phase ordering**: The handoff asks whether 4 and 5 interleave. Your answers have mostly decided it: the bearer gate (Q9) is required the moment the backend binds `0.0.0.0` at the start of Phase 5 (Q3), but Alembic isn't required until you actually deploy — which is last (Q1 round 0). So Phase 4 splits. Options: (a) split it — gate before Phase 5 starts, Alembic lands any time before deploy; (b) complete all of Phase 4 first as written; (c) all of Phase 4 in parallel with Phase 5.

➡️ **(a), split it.** The gate is a hard prerequisite; Alembic is not. Doing Alembic first is a week of migration plumbing standing between you and the rewrite for no reason — but doing it *last* risks it being skipped, so bind it to the deploy step rather than leaving it floating.

---

❓ **Q13** — **The calendar on a phone**: This is the largest unaddressed piece. `@dnd-kit` is DOM-only and dies with the web app; a 7-column week grid with drag-to-move and drag-the-edge-to-resize is the single most mouse-and-hover feature in the codebase, and it's ~650 lines. Options: (a) day view only, with native gesture drag/resize inside one day column; week view demoted to a read-only agenda list; (b) port both week and day grids with `react-native-gesture-handler` + Reanimated; (c) drop direct manipulation entirely — schedule via the generator, adjust times in a form.

➡️ **(a).** Seven columns on a 390pt screen is unusable no matter how good the gestures are, so (b) spends the hardest work in the phase on a view that can't work. A single day column reduces dragging to one axis, which is tractable. (c) throws away the interaction that makes the calendar feel like a calendar.

---

❓ **Q14** — **Offline**: The PWA's Workbox `NetworkFirst` API caching goes away with the web app. Options: (a) offline *recording* only — the stopwatch always works and queues its save; everything else needs network; (b) full read cache of activities/recordings/schedules plus queued writes; (c) nothing — require network.

➡️ **(a).** The stopwatch is the one thing that must never fail: you start it and walk away, and a failed save is lost data that cannot be reconstructed. Browsing history offline is a convenience that costs a full cache-and-sync layer, and (c) makes the app's core function dependent on your home network being up.

---

❓ **Q15** — **What ships in the first Android build**: Q8 sets the bar — the web app dies once Android can "record and list." Options: (a) first build is stopwatch + activities + recordings + server-side schedule generation; quadrant picker, frog pick, Pomodoro, insights, and the calendar all follow in a second pass; (b) everything the handoff lists for Phase 5 in one release; (c) first build is stopwatch only, as a pure data-capture replacement.

➡️ **(a).** It's exactly the bar Q8 sets, it retires the web app as early as safely possible, and it's the release that finally makes `POST /api/schedules/generate` reachable — which is the whole point of the API-only surface in future-work.md. The Eisenhower and frog strategies stay unreachable in build 1, but they're unreachable today too, so nothing regresses.

---

❓ **Q16** — **Test stack for the rewrite**: The 3 RTL component tests die with the DOM. Options: (a) `jest-expo` + `@testing-library/react-native`, port equivalents of the three; (b) same stack, but only test pure logic and skip component tests; (c) no frontend tests initially.

➡️ **(a), with one addition that matters more than the component tests**: extract the timer into a pure module — start/stop/resume, monotonic and wall-clock readings, clock-jump detection from Q7 — and test it with no renderer at all. That module is where every recording's correctness lives, and it's the thing the current [useStopwatch.ts](frontend/src/hooks/useStopwatch.ts) got wrong precisely because it was never tested in isolation.