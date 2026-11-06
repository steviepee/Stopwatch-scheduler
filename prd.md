# Stopwatch Scheduler — PRD: Build 3a, the AI planning coach (day)

## Overview
Discrete tasks for the Ralph loop. Run with `./ralph.sh`. One task per session, in order. Mark
tasks DONE when complete; add failure notes if a task fails. Build 2c is archived at
`docs/prd-build2c-completed.md` (D80–D91); earlier builds and phases are in `docs/`.
Vocabulary is in `CONTEXT.md` (Coach, Coaching conversation, Proposal, Coach note, Goal,
Intended length, Start reminder added for this build).

**What Build 3a is:** a Coach that plans one day in a short conversation and answers with a
Proposal of timed Blocks the user accepts or rejects whole; Coach notes the user approves;
an Intended length for Activities with no history; Start reminders delivered by Google
Calendar; and full usage metrics captured for every Coaching conversation while the user
tests it. Designed with the user on 2026-11-05. Both clients. Single-user (D51). Week planning
is Build 3b; Goals come after (D98).

**Order:** U14 (key, spend limit, SDK install) before the loop. B59, then U17 (Coach rehearsal,
D122) before B60; B60–B67 stay HOLD until U17 is done, then go PENDING. Backend B60 → B63, then U15
(deploy, first real conversation, link check). Phone B64 → B65, web B66 → B67. Then U16 (ship
and gate). B68 is HOLD and only becomes PENDING if U15's link check fails.

**Statuses:** `PENDING` is the loop's. `USER` is the user's, by hand; the loop never picks it.
`HOLD` is not picked either.

## Decisions (2026-11-05)

| # | Decision | Answer |
|---|---|---|
| D92 | Planning horizon | One day per Coaching conversation in this build. Week planning follows; then user-set horizons toward a dated aim (learn tango in six weeks, Salesforce before an interview in three). The long-term point is fitting new-skill learning into a busy or chaotic schedule |
| D93 | Conversation shape | Chat with a hard turn cap; the Coach must propose by the cap |
| D94 | Where a Proposal lands | Accept or reject whole. Accept appends its Schedule Items to the date's Schedule through the existing append path; further edits happen on the calendar. No automatic push to Google |
| D95 | Model | Claude Sonnet 5.5 through the Anthropic API; model id in an env var; key as a Container Apps secret. User accepts that Activity and day data go to Anthropic. Recording notes are never sent |
| D96 | Coach vs Strategy | The Coach is not a Strategy. It may call Strategies |
| D97 | Cost guard | Anthropic console workspace spend limit, $10/month. No in-app cap until multi-user |
| D98 | Build sequence | Build 3a plans a day; Build 3b plans a week; both before multi-user (D51). Goals come after |
| D99 | Goal | Term defined now, nothing stored in 3a. A Goal mentioned in conversation only shapes that day's Proposal |
| D100 | New Activities in a Proposal | Allowed, marked new, created on accept with no history. The user chooses how long one sitting is meant to be (see open items) |
| D101 | Coach notes | Suggested by the Coach, saved only on the user's approval, listed in Settings for edit and delete, sent with every conversation |
| D102 | Turn rules | Up to 6 user messages before the Coach must propose; then up to 3 revision messages, each replacing the Proposal; then accept, reject, or start over |
| D103 | Entry point | "Plan with Coach" on the calendar day view, both clients, opening a full-screen conversation for that date. A Coach tab comes later (future-work) |
| D104 | Conversation storage | Every Coaching conversation is stored with its messages, per-call usage, cost, and outcome, kept indefinitely while single-user. Per-conversation metrics are viewable by the user |
| D105 | Coach context | All Activities (average, median, Quadrant, recording count); the date's Schedule Items and Existing events; Peak hours; approved Coach notes; last 14 days of Recordings as Activity, duration, date only |
| D106 | Metrics capture | Automatic: the backend writes a usage row per model call and an outcome row per Coaching conversation. Read through `backend/scripts/coach_metrics.py` (totals, per-conversation table, `--csv`) and Settings > Coach usage (per-conversation detail) |
| D107 | Coach notes, scope | Built in 3a with an on/off setting from the start (off: no suggestions, none sent). Each note stores when it was saved and last confirmed, for a later "still accurate?" check (future-work) |
| D108 | Intended length | New Activity field set by the user; the Coach asks for it for any new Activity in a Proposal, and it is editable on the Activity. Seeds placements until Recordings exist |
| D109 | Start reminders | Every Scheduled Block gets a reminder N minutes before it starts (default 5), with an on/off setting. Tapping through opens the Stopwatch with that Activity selected, not started. User will judge notification load in practice |
| D110 | Reminder delivery | Through Google Calendar, not native code: each Exported Block's event gets a popup reminder override at N minutes and a description with two links, web app and phone app, each opening the Stopwatch with the Activity selected. No device detection. Expected to ship over the air with no APK rebuild |
| D111 | Accept then push | The Proposal's accept confirmation offers a "Push day" button. Pushing stays the user's choice |
| D112 | Reminders off | Pushed events fall back to the user's Google default reminders (today's behaviour), not silence |
| D113 | Setting changes | Apply to Blocks pushed or changed afterwards; no bulk re-update. Settings says so |
| D114 | Link fallback | An early USER phone check taps both links from a real Google notification. If the app link is not tappable, it is replaced by an `https://` page on the server with one "Open in app" button. If that also fails, start reminders move to native notifications (the original plan, needs an APK build). All Exported Blocks get reminders and links, whatever placed them |
| D115 | Proposal times | Proposal items carry start times and land as Blocks. The server validates fit against the day, Existing events, and existing Blocks with the deterministic slot code, and returns clashes to the Coach to fix before the user sees the Proposal |
| D116 | Frog | The Coach may mark a Frog only on a day without one; an existing Frog is kept |
| D117 | Unfinished conversations | "Plan with Coach" on a date resumes its open conversation; "Start over" marks it abandoned |
| D118 | Replies | No streaming in 3a; a "Coach is thinking…" state, then the full reply. Streaming reconsidered in 3b if latency feels bad |
| D119 | Pushback | When a request exceeds what history supports, the Coach says so once with the numbers, then plans what the user chooses |
| D120 | Testing | The model client is faked in every loop test; no suite calls Anthropic. Real conversations only in USER steps: one early check after the first route works, and the final gate |
| D121 | Defaults (confirmed at the end of the design) | The Coach plans today or a future date only. Coach notes are on by default. Without Google authorization the Coach plans with no Existing events and says so in its first reply. Offline, "Plan with Coach" is disabled with a message; nothing is queued. One effort level for the whole conversation (`COACH_EFFORT`, default `medium`), since changing effort mid-conversation throws away the prompt cache. No ADR |
| D122 | Coach rehearsal | Before B60, the Coach's behaviour is worked out in Claude Code on the user's subscription (U17): a draft system prompt played against a snapshot of real data, revised until the user is satisfied. The result is `backend/app/prompts/coach_system.md`, which B60 uses as the system prompt word for word. No API spend until U15 |

## Rules for this PRD

- **Tests first** (D20). Every code task is a `N.tests` / `N.impl` pair. The `.impl` session
  must not edit the `.tests` file except to add fixtures or mocks; if an assertion is wrong,
  mark BLOCKED and say why.
- **No real model calls in any test** (D120). All model access goes through one function,
  `app/services/coach_model.py: call_model(system, messages, tools) -> response`, and tests
  monkeypatch it with canned responses shaped like the Anthropic SDK's `Message` (content
  blocks, `stop_reason`, `usage`). Nothing else imports `anthropic`.
- **Calling Claude:** the `.impl` session for B60 loads the `claude-api` skill before writing
  `coach_model.py` and follows it. Model id from `COACH_MODEL` (default `claude-sonnet-5-5`),
  effort from `COACH_EFFORT` (default `medium`), key from `ANTHROPIC_API_KEY`. Forced
  `tool_choice` returns a 400 on Sonnet 5.5: use `auto` with `strict: true` tools and say in the
  system prompt when a tool must be used. Keep the conversation append-only (never edit earlier
  messages) and cache the stable prefix (system prompt, tools).
- **The loop never touches Azure, GitHub's registry, DNS, EAS, live MySQL, or the Anthropic
  console.** It never runs `deploy.sh`, `eas build` or `eas update`.
- **No dependency changes** beyond `anthropic`, which U14 installs. No native code in this build.
- **Schema changes go through Alembic** on top of `66350d60caf3`; `test_migrations.py` must pass.
  Build 3a has one migration (B59).
- **The D13 parity fixture is frozen.** No Strategy changes.
- **Forward-compat** (`PROMPT.md`): `db.query(Model)` idiom; the settings rows are one row now,
  one per owner later; Coach tables hang off conversations so one owner column covers them.
- **Product names** in UI and new code: Coach, Coaching conversation, Proposal, Coach note,
  Intended length, Start reminder. Never "session" for a Coaching conversation.
- **Acceptance**
  - Backend: `cd backend && ./venv/bin/python -m pytest tests/`
  - Mobile, from `mobile/`: `npx jest --ci`, `npx tsc --noEmit`, `npx expo export --platform android`
  - Web, from `frontend/`: `npx vitest run`, `npx tsc --noEmit`, `npm run build`
  - Redirect test output to a file rather than piping it (GOTCHAS).

---

## Tasks

### U14. USER — Anthropic key, spend limit, and the SDK
- **Status:** USER
- **Description:** Before the loop. The loop cannot install dependencies (D30) or touch the
  console.
  1. Sign in at https://platform.claude.com, create a workspace named `stopwatch-coach`, and
     set its **spend limit to $10/month** (D97). Create an API key in that workspace.
  2. Install the SDK and pin it. In an Ubuntu tab:
     ```bash
     cd /root/Stopwatch-scheduler/backend
     ./venv/bin/pip install anthropic
     ./venv/bin/pip show anthropic | grep Version      # note the version
     echo "anthropic==<that version>" >> requirements.txt
     ./venv/bin/python -c "import anthropic; print('ok')"
     ```
  3. Local key, for U15's first real conversation (`backend/.env` is gitignored):
     ```bash
     echo "ANTHROPIC_API_KEY=<the key>" >> /root/Stopwatch-scheduler/backend/.env
     ```
  4. Azure secret, so the deployed backend has it (memory: azure-account; names as in Phase 6):
     ```bash
     az containerapp secret set -g rg-stopwatch -n <app name> --secrets anthropic-api-key=<the key>
     az containerapp update -g rg-stopwatch -n <app name> --set-env-vars ANTHROPIC_API_KEY=secretref:anthropic-api-key
     ```
     `az containerapp list -g rg-stopwatch --query "[].name" -o tsv` prints the app name.
  5. Commit `requirements.txt`.
- **Acceptance Criteria:**
  - [x] The workspace shows a $10 monthly limit
  - [x] `import anthropic` works in `backend/venv`; `requirements.txt` pins it (`anthropic==2.6.0`)
  - [ ] `az containerapp show -g rg-stopwatch -n <app name> --query "properties.template.containers[0].env[?name=='ANTHROPIC_API_KEY']"` lists the secretref

### B59.tests — Backend: Coach tables, settings, Coach notes, Intended length
- **Status:** PENDING
- **Description:** D101, D104, D106–D109, D112, D121. Add `backend/tests/test_coach_data.py`.
- **Contract:**
  - **Migration:** one Alembic revision on `66350d60caf3` adding the tables below and
    `tasks.intended_length` (nullable float, seconds). Downgrade drops them.
  - **`coach_conversations`:** `id`, `target_date` (date), `tz_offset` (int minutes, JS
    `getTimezoneOffset` convention), `status` (`open` | `accepted` | `rejected` | `abandoned`),
    `model`, `effort`, `user_turns` (int, 0), `revision_turns` (int, 0), `proposal` (JSON text,
    nullable: the current Proposal), `proposed_count` (int, nullable), `accepted_count` (int,
    nullable), `accepted_items` (JSON text, nullable: a snapshot of each accepted Schedule Item's
    `id`, `task_id`, `scheduled_time`, `estimated_duration`), `rating` (`up` | `down`, nullable),
    `created_at`, `updated_at`, `closed_at` (nullable).
  - **`coach_messages`:** `id`, `conversation_id` (FK, cascade), `role` (`user` | `assistant`),
    `content` (JSON text: the exact content blocks sent or received, so the history replays
    unchanged), `visible_text` (text shown in the chat, nullable for pure tool turns),
    `created_at`.
  - **`coach_calls`** (one row per model call, D106): `id`, `conversation_id` (FK, cascade),
    `turn_index`, `model`, `effort`, `input_tokens`, `cache_creation_input_tokens`,
    `cache_read_input_tokens`, `output_tokens`, `stop_reason`, `latency_ms`, `cost_usd` (float),
    `created_at`.
  - **`coach_notes`:** `id`, `text` (1–300 chars), `created_at`, `confirmed_at` (set on create and
    on every edit).
  - **`coach_settings`** (one row): `notes_enabled` (default true). **`reminder_settings`** (one
    row): `enabled` (default true), `minutes_before` (default 5, integer 1–120).
  - **Routes** (all behind the credential gate):
    - `GET`/`PUT /api/settings/coach` and `GET`/`PUT /api/settings/reminders`, same pattern as
      `/api/settings/pomodoro` (row created with defaults on first GET; out-of-range → 422).
    - `GET /api/coach/notes` (oldest first), `POST /api/coach/notes {text}`,
      `PUT /api/coach/notes/{id} {text}` (updates `confirmed_at`), `DELETE /api/coach/notes/{id}`.
      Empty or over-300 text → 422; unknown id → 404.
  - **Intended length:** `TaskCreate`/`TaskUpdate`/`Task` gain optional `intended_length`
    (seconds, > 0 and ≤ 12 h, or null). `POST /api/schedules/days/{date}/items` with no
    `estimated_duration` seeds from `average_duration` if the Activity has Recordings, else
    `intended_length`, else 600.
  - **Cost:** `app/services/coach_cost.py: cost_usd(model, usage) -> float` from a price table in
    that file (per million tokens: `claude-sonnet-5-5` input 2.00, output 10.00, cache read 0.20,
    cache write 2.50; `claude-opus-5-5` input 4.00, output 20.00, cache read 0.20, cache write
    5.00). Unknown model → 0.0 and a logged warning, never an error.
- **Acceptance Criteria:**
  - [ ] Test: settings GETs return the defaults; PUTs persist; `minutes_before` 0 or 121 → 422
  - [ ] Test: note create, list order, edit moves `confirmed_at`, delete; 301-char text → 422
  - [ ] Test: placing an Activity with no Recordings and `intended_length` 1800 seeds 1800; with Recordings seeds the average; with neither seeds 600
  - [ ] Test: `cost_usd` for a known usage on each model matches a hand-computed value; unknown model → 0.0
  - [ ] Test: deleting a conversation row cascades its messages and calls
  - [ ] `test_migrations.py` passes with the new revision

### B59.impl — Backend: Coach tables, settings, Coach notes, Intended length
- **Status:** PENDING
- **Description:** Implement to the contract: models, schemas, the migration, routes in
  `routers/settings.py` and a new `routers/coach.py` mounted at `/api/coach`.
- **Acceptance Criteria:**
  - [ ] All B59.tests pass; full suite passes

### U17. USER — Coach rehearsal (before B60)
- **Status:** USER
- **Description:** D122. In a Claude Code session in this repo, on the subscription; no API key
  used. Claude:
  1. Pulls a snapshot of real data from the live API with the bearer token in `backend/.env`:
     Activities with averages, medians, Quadrants and Intended lengths; tomorrow's Schedule;
     Peak hours; the last 14 days of Recordings as Activity, duration, date only. Into the
     scratchpad, not the repo.
  2. Drafts `backend/app/prompts/coach_system.md`: what the Coach asks first, how it reads a
     chaotic day, its tone, when it pushes back (D119), when it suggests a Coach note, how it
     fits a new skill's sittings (D99, D100), the turn rules (D102), and when to call
     `propose_plan` and `suggest_note`.
  3. Plays the Coach from that file against the snapshot while the user plans real days.
     Cases to cover: an ordinary day; a packed day with Existing events; tango at 30 minutes a
     sitting (a new Activity); a request far over recorded history; a day where a note is worth
     saving; reaching the 6-message cap.
  4. Revises the file after each round until the user is satisfied, and records the rough
     size of system prompt plus context in `progress.md`.
  Then set B60–B67 from `HOLD (until U17)` to `PENDING`, commit, and run the loop.
- **Acceptance Criteria:**
  - [ ] `backend/app/prompts/coach_system.md` exists and the user has signed it off
  - [ ] All six cases rehearsed; prompt size recorded
  - [ ] B60–B67 set to PENDING

### B60.tests — Backend: the Coaching conversation engine
- **Status:** HOLD (until U17)
- **Description:** D93, D95, D99, D100, D102, D105, D115, D116, D118, D119, D121. Add
  `backend/tests/test_coach_conversation.py`; `call_model` is monkeypatched throughout.
- **Contract:**
  - **Open or resume:** `POST /api/coach/conversations {target_date, tz_offset}`. A date before
    today in that offset → 422. If an `open` conversation exists for the date, return it
    unchanged (no model call). Otherwise create one and make the first model call, whose reply
    is the Coach's opening question. Response: the conversation with its visible messages,
    current Proposal, and status.
  - **Context** (D105), built server-side into the system prompt or the first user content,
    never from the client: every Activity (id, name, average, median, Quadrant, recording count,
    Intended length); the date's Schedule Items (name, start, duration, Frog); Existing events
    for the date if Google is authorized (else a line saying it is not, which the Coach mentions
    in its opening); Peak hours; Coach notes if `notes_enabled`; and the last 14 days of
    Recordings as `(Activity name, duration, local date)` only, never Recording names or notes.
    A test captures the `call_model` arguments and asserts these are present and that a
    Recording's `notes` and `name` strings are absent.
  - **Tools** offered to the model (`strict: true`):
    - `propose_plan {items: [{task_id | null, new_activity_name | null, start (local HH:MM),
      duration_minutes, is_frog}], summary}`. Exactly one of `task_id` / `new_activity_name`.
    - `suggest_note {text}`, offered only when `notes_enabled`.
  - **Proposal validation** (D115, D116), deterministic, in `app/services/coach_plan.py`: every
    item lies inside the target date in local time; no two items overlap; none overlaps an
    existing Scheduled Item or Existing event; `task_id` exists; a new Activity has an
    `intended_length` given by the user (the Coach asks; the tool carries it as
    `duration_minutes`); at most one `is_frog`, and none if the day already has a Frog. Clashes
    go back as an `is_error` tool result listing each problem, and the model tries again, up to
    2 retries; after that the reply says it could not fit the plan and no Proposal is stored.
  - **Messages:** `POST /api/coach/conversations/{id}/messages {text}` (1–2000 chars). Runs the
    model loop (at most 4 calls per user message) and returns the updated conversation. A valid
    `propose_plan` replaces the stored Proposal. A `suggest_note` comes back as a pending
    suggestion on the response (`note_suggestion`), not saved (the client posts it to
    `/api/coach/notes` if the user approves).
  - **Turn rules** (D102): `user_turns` counts user messages before the first Proposal; at 6 the
    call includes an instruction that it must propose now. After a Proposal, each message counts
    as a `revision_turn`; a 4th revision → 409 `revision limit reached`. A message to a
    conversation that is not `open` → 409.
  - **System prompt** (D122): read from `backend/app/prompts/coach_system.md` (written in U17),
    unchanged; the context follows it. Pushback (D119) and the Goal behaviour (D99) live in that
    file; a test asserts the system sent equals the file's text followed by the context.
  - **Metrics:** every model call writes a `coach_calls` row with the response's usage fields,
    `stop_reason`, measured `latency_ms`, and `cost_usd`. A model error (SDK exception) → 502 with
    a short message, a `coach_calls` row with `stop_reason = "error"`, and no stored assistant
    message.
- **Acceptance Criteria:**
  - [ ] Test: open creates and calls once; reopening the same date returns the same id with no call; a past date → 422
  - [ ] Test: the context contains each listed piece and no Recording notes or names; notes absent when `notes_enabled` is false, and so is `suggest_note`
  - [ ] Test: an overlapping Proposal gets an `is_error` tool result naming the clash, and the corrected one is stored
  - [ ] Test: three bad Proposals in a row → no Proposal stored, reply says it could not fit
  - [ ] Test: Frog refused on a day that has one; two Frogs refused
  - [ ] Test: the 6th user message carries the must-propose instruction; a 4th revision → 409
  - [ ] Test: each call writes one `coach_calls` row with tokens and cost; an SDK exception → 502 and an error row
  - [ ] Test: stored `content` replays byte-for-byte as the next call's earlier messages (append-only)

### B60.impl — Backend: the Coaching conversation engine
- **Status:** HOLD (until U17)
- **Description:** Implement to the contract: `services/coach_model.py` (the only `anthropic`
  import; load the `claude-api` skill first), `services/coach_context.py`,
  `services/coach_plan.py`, and the routes in `routers/coach.py`. Reuse the peak-hours
  computation from `routers/insights.py` and the median from the existing Activity stats rather
  than re-deriving them; move a helper into a service if needed.
- **Acceptance Criteria:**
  - [ ] All B60.tests pass; full suite passes

### B61.tests — Backend: accept, reject, start over, rating, history
- **Status:** HOLD (until U17)
- **Description:** D94, D100, D104, D106, D108, D117. Extend `test_coach_conversation.py`.
- **Contract:**
  - `POST /api/coach/conversations/{id}/accept`: requires `open` and a Proposal (else 409).
    In one transaction: create each new Activity with its `intended_length`; place every item on
    the date's Schedule through the same code as `POST /api/schedules/days/{date}/items` with its
    start time, duration and Frog, after re-running the B60 validation against the day as it
    is now (a clash → 409 naming it, nothing placed); set `status = accepted`, `accepted_count`, `accepted_items`
    snapshot, `closed_at`. Nothing is pushed to Google. Returns the date's Schedule. A new
    Activity whose name already exists (case-insensitive) uses the existing one.
  - `POST /{id}/reject` → `rejected`; `POST /{id}/start-over` → marks it `abandoned` and returns a
    fresh conversation for the same date (one model call). Both 409 unless `open`.
  - `PUT /{id}/rating {rating: "up" | "down" | null}` on any closed conversation.
  - `GET /api/coach/conversations` → newest first, each with date, status, turns, call count,
    total tokens (each kind), total cost, accepted/proposed counts, rating. `GET /{id}` → the
    same plus visible messages, Proposal, and every `coach_calls` row.
  - `GET /api/coach/usage?month=YYYY-MM` → conversations, accepted, total cost for that month
    (default current UTC month).
- **Acceptance Criteria:**
  - [ ] Test: accept places timed items, creates the new Activity with its Intended length, keeps an existing Frog, pushes nothing, and stores the snapshot
  - [ ] Test: accept twice → 409; reject then message → 409
  - [ ] Test: start over leaves the old one `abandoned` and opens a new one for the date
  - [ ] Test: list and detail totals equal the sum of the call rows; usage counts only that month

### B61.impl — Backend: accept, reject, start over, rating, history
- **Status:** HOLD (until U17)
- **Description:** Implement to the contract. Factor the placement code in `routers/schedules.py`
  into a function both routes call, without changing its behaviour.
- **Acceptance Criteria:**
  - [ ] All B61.tests pass; full suite passes

### B62.tests — Backend: Start reminders on pushed events
- **Status:** HOLD (until U17)
- **Description:** D109, D110, D112, D113, D114. Extend the Google push tests with the calendar
  service faked as they already are.
- **Contract:**
  - `create_event` and `update_event` take the reminder settings and an Activity id. With
    reminders **on**, the event body carries `reminders: {useDefault: false, overrides:
    [{method: "popup", minutes: <minutes_before>}]}`; **off** → `reminders: {useDefault: true}`.
  - The description carries both links and one line of text:
    `Start the stopwatch when you begin.\nWeb: <PUBLIC_WEB_URL>/?start=<task_id>\nPhone: stopwatchscheduler://?start=<task_id>`.
    `PUBLIC_WEB_URL` env, default `https://api.stopwatchscheduler.app`. An item with no Activity
    gets the text and the web root only.
  - Applies to every create and every stale update in Push day (D113): an update patches
    reminders and description as well as times. Nothing re-updates events when the setting
    changes.
- **Acceptance Criteria:**
  - [ ] Test: push with reminders on → override at the stored minutes; off → `useDefault: true`
  - [ ] Test: description contains both links with the item's `task_id`; no-Activity item has no `?start=`
  - [ ] Test: a stale item's patch body includes reminders and description; changing the setting alone makes no Google call

### B62.impl — Backend: Start reminders on pushed events
- **Status:** HOLD (until U17)
- **Description:** Implement to the contract in `services/google_calendar.py` and the push route.
- **Acceptance Criteria:**
  - [ ] All B62.tests pass; full suite passes

### B63.tests — Backend: the metrics script
- **Status:** HOLD (until U17)
- **Description:** D106. Add `backend/tests/test_coach_metrics_script.py` for
  `backend/scripts/coach_metrics.py`, a script run as
  `./venv/bin/python scripts/coach_metrics.py [--since YYYY-MM-DD] [--csv PATH]`. It reads the
  database through `app.database` like the app does.
- **Contract:**
  - Prints totals (conversations by status, calls, tokens of each kind, cost, average cost per
    conversation and per **accepted** conversation, average turns to first Proposal, average
    latency) then one row per conversation.
  - Per conversation, derived at run time from `accepted_items`: **kept** (item still exists
    with the same start and duration), **edited** (exists, start or duration changed),
    **deleted** (gone), and **recorded** (a Recording of that Activity on that local date).
  - `--csv PATH` writes two files, `PATH-conversations.csv` and `PATH-calls.csv`, every column
    of both tables plus the derived counts.
  - The core is a function `build_report(db, since) -> dict` the test calls directly.
- **Acceptance Criteria:**
  - [ ] Test: fixtures with an accepted, a rejected, and an abandoned conversation give the right totals and per-conversation derived counts
  - [ ] Test: `--csv` writes both files with a header and one row per record

### B63.impl — Backend: the metrics script
- **Status:** HOLD (until U17)
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All B63.tests pass; full suite passes

### U15. USER — Deploy the backend, first real conversation, link check
- **Status:** USER
- **Description:** D114, D120. After B63.
  1. Commit, then `./deploy.sh` (runs the B59 migration).
  2. First real conversation, against production:
     ```bash
     cd /root/Stopwatch-scheduler/backend && set -a && . ./.env && set +a
     H="Authorization: Bearer $API_TOKEN"; U=https://api.stopwatchscheduler.app/api/coach
     D=$(date -d tomorrow +%F)
     curl -s -X POST -H "$H" -H 'Content-Type: application/json' -d "{\"target_date\":\"$D\",\"tz_offset\":360}" $U/conversations/ | python3 -m json.tool
     # note the id, then answer its question:
     curl -s -X POST -H "$H" -H 'Content-Type: application/json' -d '{"text":"Two hours of focus work, a run, and I want to start learning tango, 30 minutes a sitting."}' $U/conversations/<id>/messages | python3 -m json.tool
     ```
     (`tz_offset` 360 is US Central standard time.) Keep answering until a Proposal appears.
     Then `curl -s -H "$H" $U/usage` and compare its cost with the Anthropic console's usage
     page; they should agree within a cent or two.
  3. Reject it (`curl -X POST -H "$H" $U/conversations/<id>/reject`).
  4. **Link check:** on the phone's calendar for tomorrow, place any Activity at a time 10+
     minutes ahead, Push day. When Google's notification fires 5 minutes before, open the event
     and tap **Phone:**, then **Web:**. Write down whether each link was tappable (opening the
     right screen is checked in U16).
- **Acceptance Criteria:**
  - [ ] A real conversation reaches a Proposal; `GET /api/coach/conversations/<id>` lists its calls with tokens and cost
  - [ ] Link check recorded in `progress.md`. If **Phone:** was not tappable, B68 goes from HOLD to PENDING before the client tasks run

### B64.tests — Mobile: Start links, Intended length, Coach settings and usage
- **Status:** HOLD (until U17)
- **Description:** D101, D104, D106–D110, D113, D121.
- **Contract:**
  - **Start link:** opening the app with `?start=<task_id>` (Expo Router search param on the
    Stopwatch tab, `(tabs)/index.tsx`) selects that Activity for the next recording, does not
    start the timer, and clears the param. Unknown id or a running timer → ignored.
  - **Intended length:** `activity/[id].tsx` gains an "Intended length" minutes field (empty =
    none), saved with `intended_length` in seconds. Any client-side seeding of a placement
    duration follows average → Intended length → 10 min.
  - **Settings** gains three sections:
    - **Coach notes:** a switch bound to `notes_enabled`, then the note list with edit and
      delete (delete asks first, like Recording delete).
    - **Start reminders:** a switch bound to `enabled` and a minutes field (1–120), with the
      text `Applies to Blocks pushed or changed from now on.`
    - **Coach usage:** this month's conversations and cost from `/api/coach/usage`, and a list
      of conversations (date, status, cost) opening a read-only detail: messages, Proposal,
      and a table of calls (tokens of each kind, latency, cost).
- **Acceptance Criteria:**
  - [ ] Test: the `start` param selects the Activity without starting; ignored while running or for an unknown id
  - [ ] Test: Intended length saves in seconds and clears to null
  - [ ] Test: each setting round-trips through its API mock; note delete confirms first
  - [ ] Test: usage shows the month's totals; detail renders the call rows

### B64.impl — Mobile: Start links, Intended length, Coach settings and usage
- **Status:** HOLD (until U17)
- **Description:** Implement to the contract; add the API methods to `src/services/api.ts`.
- **Acceptance Criteria:**
  - [ ] All B64.tests pass; mobile suite, tsc, and export pass

### B65.tests — Mobile: the Coach screen
- **Status:** HOLD (until U17)
- **Description:** D94, D100, D101, D103, D111, D117, D118, D121.
- **Contract:**
  - The calendar day view (`(tabs)/calendar.tsx`) shows **Plan with Coach** for today and future
    dates only; offline it is disabled with `You're offline — the Coach needs a connection.`
  - It opens a full-screen Coach screen for that date, which calls open-or-resume and shows the
    messages. While a reply is pending: `Coach is thinking…` and the input disabled.
  - A Proposal shows as a list of items (time, name, length, Frog, a **New** tag on new
    Activities) with **Accept** and **Reject**. A note suggestion shows `Save this note?` with
    the text and Yes / No; Yes posts it.
  - **Accept** → the date's Blocks refresh, and a confirmation offers **Push day** (the existing
    push) and thumbs up / down (rating). **Start over** in the header asks first, then calls
    start-over. A 409 revision-limit response shows its message and leaves Accept / Reject /
    Start over usable.
- **Acceptance Criteria:**
  - [ ] Test: button hidden for past dates; disabled offline with the message
  - [ ] Test: open-or-resume on mount; thinking state disables input
  - [ ] Test: Proposal renders with the New tag; Accept refreshes the day and shows Push day and rating
  - [ ] Test: note suggestion Yes posts it, No posts nothing; Start over confirms first
  - [ ] Test: a 409 shows its message

### B65.impl — Mobile: the Coach screen
- **Status:** HOLD (until U17)
- **Description:** Implement to the contract as a new route (`src/app/coach/[date].tsx`).
- **Acceptance Criteria:**
  - [ ] All B65.tests pass; mobile suite, tsc, and export pass

### B66.tests — Web: Start links, Intended length, Coach settings and usage
- **Status:** HOLD (until U17)
- **Description:** B64's contract on the web: `?start=<task_id>` on page load selects the
  Activity in `Stopwatch.tsx` without starting it and removes the param from the URL; Intended
  length on the Activity edit form (`TaskDetailModal.tsx`); the three Settings sections in
  `OptionsPage.tsx`.
- **Acceptance Criteria:**
  - [ ] Tests mirroring B64's four
  - [ ] Web suite, tsc, and build pass

### B66.impl — Web: Start links, Intended length, Coach settings and usage
- **Status:** HOLD (until U17)
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All B66.tests pass; web suite, tsc, and build pass

### B67.tests — Web: the Coach screen
- **Status:** HOLD (until U17)
- **Description:** B65's contract on the web: **Plan with Coach** in `CalendarView.tsx`'s day
  view opens a full-screen Coach panel for that date, with the same states and actions.
- **Acceptance Criteria:**
  - [ ] Tests mirroring B65's five
  - [ ] Web suite, tsc, and build pass

### B67.impl — Web: the Coach screen
- **Status:** HOLD (until U17)
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [ ] All B67.tests pass; web suite, tsc, and build pass

### B68 — Backend: "Open in app" page (only if U15's link check fails)
- **Status:** HOLD
- **Description:** D114 fallback. `GET /open?start=<task_id>` (exempt from the credential gate,
  no data in the page) serves a tiny HTML page with one **Open in app** button linking to
  `stopwatchscheduler://?start=<task_id>` and a smaller **Use the web app** link. B62's
  **Phone:** line points to `<PUBLIC_WEB_URL>/open?start=<task_id>` instead. `task_id` must be
  an integer (else 422), and is the only thing written into the page. If this page's button is
  also not tappable on the phone, Start reminders move to native notifications (an APK build),
  which needs its own design pass.
- **Acceptance Criteria:**
  - [ ] Test: integer id → 200 HTML with both links; non-integer → 422; reachable without the token
  - [ ] B62 tests updated for the new Phone line; full suite passes

### U16. USER — Ship and Build 3a gate
- **Status:** USER
- **Description:** Commit, then `./deploy.sh` (backend, web, and the phone's over-the-air
  update; no APK build). On the phone (standalone app) and the web app:
  1. Settings: Coach notes on, Start reminders on at 5, Coach usage shows U15's conversation.
  2. On tomorrow's day view, **Plan with Coach**. Include a new Activity (the Coach asks its
     sitting length) and ask for more focus time than you've ever recorded: the Coach says so
     once, with numbers, then plans what you choose. Approve one suggested note.
  3. Close the app mid-conversation, reopen Plan with Coach: it resumes. Try one revision.
  4. Accept: timed Blocks appear around existing ones and Google events, the new Activity is in
     the Bank with its Intended length, an existing Frog is untouched. Push day from the
     confirmation; rate it.
  5. When the Start reminder fires, tap each link: the Stopwatch opens with that Activity
     selected and not started, on each client.
  6. Start over on another date; the old conversation shows `abandoned` in Coach usage.
  7. Coach usage in the app agrees with the Anthropic console's usage page within a few
     cents. Run `scripts/coach_metrics.py --csv` once against local MySQL to see the report
     shape (the real data is on Azure; pointing `DB_*` there needs your IP on the server's
     firewall).
  Record results in `progress.md`.
- **Acceptance Criteria:**
  - [ ] All seven pass on both clients where they apply; any failure recorded with the task it reopens
