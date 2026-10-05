# Stopwatch Scheduler — PRD: Phase 6, single-user deploy to Azure

## Overview
Discrete tasks for the Ralph loop. Run with `./ralph.sh`. One task per session, in order. Mark
tasks DONE when complete; add failure notes if a task fails. Build 2a is archived at
`docs/prd-build2a-completed.md` (D39–D50). Vocabulary is in `CONTEXT.md`.

**What Phase 6 is:** the backend, the web app and the database run on Azure at
`https://api.stopwatchscheduler.app`, and the phone runs a standalone build that talks to it from
anywhere — no Metro, no QR, no home network. Single-user (roadmap D51): one bearer token, one
Google account. Designed with the user on 2026-10-04.

**Order:** the loop tasks (C1–C7) change code only and never touch Azure or live MySQL. The USER
tasks (U1–U8) create the Azure resources, move the data, build the phone app and run the gate.
U1 (install Docker) must be done before C7; U2 (local `.env`) right after C2 lands. The rest come
after the loop finishes.

**Build 2b** (quadrant, Frog pick UI, Strategies, Pomodoro, notification Stop, Peak hours) is
still HOLD, carried at the end of this file.

**Statuses:** `PENDING` is the loop's. `USER` is the user's, by hand; the loop never picks it.
`HOLD` is not yet runnable.

## Decisions (2026-10-04)

| # | Decision | Answer |
|---|---|---|
| D52 | Backend host | **Azure Container Apps**, region **South Central US**, resource group `rg-stopwatch`. One replica always running (min 1, max 1), 0.25 vCPU / 0.5 GiB. No scale-to-zero cold starts |
| D53 | Public address | **`api.stopwatchscheduler.app`** (DNS at Namecheap: a CNAME plus an `asuid` TXT record), with an Azure-managed certificate. The apex stays on GitHub Pages (privacy policy). Phone builds and Google's redirect bake this name in, so it survives rebuilding the Azure app |
| D54 | Database | **Azure Database for MySQL Flexible Server**, Burstable **B1ms**, 20 GB, MySQL 8.0, 7-day automatic backups. Public endpoint with TLS required; firewall allows Azure services, plus the user's IP only during the data copy. No VNet |
| D55 | Image | One Dockerfile builds the web app and the backend into one image, pushed to **GitHub Container Registry** (`ghcr.io/steviepee/stopwatch-scheduler`, public). Built locally with **Docker Engine in WSL** (free; not Docker Desktop). No Azure Container Registry |
| D56 | Web app | Served by the backend at `/` from the same image, same origin as `/api`. No separate static host, no production CORS |
| D57 | Secrets | **Container Apps secrets**: `API_TOKEN` (a **new** random token, not the dev one), `DB_PASSWORD`, `GOOGLE_CLIENT_SECRET`, `CREDENTIAL_KEY`. Key Vault waits for multi-user |
| D58 | Google credentials | An **encrypted database row** (`google_credentials`, Fernet, key in `CREDENTIAL_KEY`) replaces `token.pickle`. Multi-user later adds an owner column. The user authorizes Google once against the deployed app from a laptop (D14 holds); the local dev backend is re-authorized once too |
| D59 | Google login route | **Gated.** `/api/auth/google/login` leaves the bearer gate's exempt list; on a public host anyone could otherwise sign their own Google account in over the user's. The callback stays exempt and only accepts the one-time `state` from an authenticated login |
| D60 | Web interim lock | A **sign-in page**: paste the API token once; `POST /api/auth/web-session` answers with a signed cookie (HttpOnly, Secure, SameSite=Strict, 30 days). The gate accepts the bearer header **or** that cookie. Multi-user replaces the paste page with Google Sign-In |
| D61 | Migrations | **On container start**: `alembic upgrade head`, then uvicorn. One replica, so no race. A failed migration means the new revision never listens and the previous one keeps serving |
| D62 | Data cutover | Azure becomes the **only real data**. One `mysqldump` from the PC, restored to Azure before the app is created. Local MySQL becomes a development sandbox |
| D63 | Deploys | **By hand**: copy-paste `az` commands for the first deploy, then `deploy.sh` (build → push → update). Deploying automatically from GitHub is future work |
| D64 | Phone builds | Dev builds become **`app.workflow.stopwatch.dev`, "Stopwatch Scheduler (Dev)"** via `app.config.js` and `APP_VARIANT`, so the standalone app installs beside them. The standalone app is an **EAS `preview` APK** with `EXPO_PUBLIC_API_URL=https://api.stopwatchscheduler.app/api` baked in. One dev-client rebuild |
| D65 | Not changed | Health check, logs and CORS: Container Apps' default TCP probe waits for uvicorn to listen, which only happens after migrations (D61); logs go to Log Analytics on its free allowance; `CORS_ORIGINS` stays for local dev only. Parked items (URL scheme `mobile`, "Offline" on a 401, dev gear nudge) stay parked |

## Rules for this PRD

- **The loop never touches Azure, GitHub's registry, DNS, EAS, or live MySQL.** Those are USER
  tasks. Loop tasks change code and config files only.
- **Tests first** (D20). Every code task is a `N.tests` / `N.impl` pair, under the same rules as
  Build 2a: the `.impl` session must not edit the `.tests` file except to add fixtures or mocks;
  if an assertion is wrong, mark BLOCKED and say why. C7 (Docker) is a single task: it is
  verified by building the image, not by unit tests.
- **Schema changes go through Alembic**; `backend/tests/test_migrations.py` must pass.
- **No dependency changes** except where a task names one. `cryptography` (Fernet) is already in
  `backend/requirements.txt`.
- **Forward-compat** (`PROMPT.md`): the credential row and the web session are single-user now
  and must not block an owner column later. No credentials written to files.
- **Secrets never land in the repo.** No real token, password or key in any committed file,
  test, or `progress.md`. Tests use obvious fakes.
- **Acceptance**
  - Backend: `cd backend && ./venv/bin/python -m pytest tests/`
  - Mobile, from `mobile/`: `npx jest --ci`, `npx tsc --noEmit`, `npx expo export --platform android`
  - Web, from `frontend/`: `npx vitest run`, `npx tsc --noEmit`, `npm run build`
  - Docker (C7 only): `docker build` from the repo root
  - Redirect test output to a file rather than piping it (GOTCHAS).

---

## Tasks

### U1. USER — Install Docker Engine in WSL
- **Status:** USER
- **Description:** Needed before C7 (the loop builds the image to check the Dockerfile) and for
  every deploy. Free; this is Docker Engine, not Docker Desktop. In an Ubuntu tab:
  ```bash
  sudo apt-get update && sudo apt-get install -y ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
  sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
  docker run --rm hello-world
  ```
  The last line prints "Hello from Docker!". Don't build images while a Ralph loop is running
  (memory). The loop's allow-list already permits `docker build`, `docker run` and `docker image`.
- **Acceptance Criteria:**
  - [ ] `docker run --rm hello-world` prints its greeting

### C1.tests — Gate the Google login route
- **Status:** DONE
- **Description:** D59. `/api/auth/google/login` is in `_EXEMPT_PATHS`
  ([main.py](backend/app/main.py)). Extend `backend/tests/test_auth_gate.py`.
- **Contract:** `GET /api/auth/google/login` requires the bearer token (401 without it, as any
  gated route). `/api/health` and `/api/auth/callback` stay exempt. A callback whose `state` was
  not issued by an authenticated login call is 400 and stores no credentials.
- **Acceptance Criteria:**
  - [x] Test: login without a token → 401; with it → 200 and an `auth_url` (Google flow mocked)
  - [x] Test: callback with an unknown `state` → 400; no credentials saved
  - [x] Test: `/api/health` and `/api/auth/callback` are still reachable without a token

### C1.impl — Gate the Google login route
- **Status:** DONE
- **Description:** Implement to the contract. Both clients already call login with the token (the
  web through the Vite proxy in dev), so no client change.
- **Acceptance Criteria:**
  - [x] All C1.tests pass; full suite passes

### C2.tests — Google credentials as an encrypted database row
- **Status:** DONE
- **Description:** D58. Today `GoogleCalendarService` pickles credentials to `token.pickle`
  ([google_calendar.py](backend/app/services/google_calendar.py)). Add
  `backend/tests/test_credential_store.py`; update any test that relies on the pickle file.
- **Contract:**
  - New table `google_credentials`: `id`, `data` (Text, the encrypted credential JSON),
    `updated_at`. One row in single-user use. Alembic revision.
  - Credentials are serialized with `Credentials.to_json()` and read back with
    `Credentials.from_authorized_user_info(...)`, encrypted with Fernet using the
    `CREDENTIAL_KEY` env var. No file is read or written; `token.pickle` is never touched.
  - `_save_credentials` writes (or replaces) the row; loading reads it. Refresh-on-use still saves
    the refreshed token.
  - If `CREDENTIAL_KEY` is unset, Google features report not authenticated
    (`/api/auth/status` → `authenticated: false`) and saving raises a clear error; the rest of the
    app works. If the stored row cannot be decrypted with the key, the same: not authenticated.
- **Acceptance Criteria:**
  - [x] Test: save then load round-trips a credential (fake values), and the stored `data` does not contain the refresh token in plain text
  - [x] Test: no file named `token.pickle` is created or read (patch `open`/check the working dir)
  - [x] Test: unset key → not authenticated, and other routes still work
  - [x] Test: a row encrypted with a different key → not authenticated, no crash
  - [x] Test: Alembic revision present; `test_migrations.py` passes

### C2.impl — Google credentials as an encrypted database row
- **Status:** DONE
- **Description:** Implement to the contract. Keep DB access in the `db.query(Model)` idiom
  (forward-compat). Remove the pickle code paths. Update `DIAGNOSTIC.md` and `GOTCHAS.md`
  entries that describe `token.pickle` as the credential store.
- **Acceptance Criteria:**
  - [x] All C2.tests pass; full suite passes; `alembic check` clean
  - [x] `git grep -n "pickle" backend/app` is empty

### U2. USER — Local `.env` after C2
- **Status:** USER
- **Description:** After C2 lands, the local backend needs an encryption key and one Google
  re-authorization, because credentials now live in the database instead of `token.pickle`.
  ```bash
  cd /root/Stopwatch-scheduler/backend
  echo "CREDENTIAL_KEY=$(./venv/bin/python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')" >> .env
  ./venv/bin/alembic upgrade head
  ```
  Restart uvicorn, then from the laptop browser use the web app's Connect Google button at
  `localhost:3000` once. `token.pickle` can then be deleted: `rm token.pickle`.
- **Acceptance Criteria:**
  - [ ] `curl -s -H "Authorization: Bearer $(grep ^API_TOKEN .env | cut -d= -f2-)" http://localhost:8000/api/auth/status` shows `"authenticated": true`

### C3.tests — Database connection from separate settings, with optional TLS
- **Status:** DONE
- **Description:** D54. `database.py` and `alembic/env.py` each build the URL with an f-string,
  which breaks on a password containing `@`, `/` or `:`, and neither can require TLS, which Azure
  MySQL enforces. Add `backend/tests/test_database_url.py`.
- **Contract:** One helper in `app/database.py` builds the SQLAlchemy URL with
  `sqlalchemy.engine.URL.create(...)` from `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`,
  `DB_NAME`, and the connect args: when `DB_SSL_CA` is set, `{"ssl": {"ca": DB_SSL_CA}}`;
  otherwise none. Both the app engine and `alembic/env.py` use it (env.py's `-x db_url=`
  override stays). Local behaviour without `DB_SSL_CA` is unchanged.
- **Acceptance Criteria:**
  - [x] Test: a password with `@:/` round-trips through the URL intact
  - [x] Test: `DB_SSL_CA` set → connect args carry the CA path; unset → no ssl args
  - [x] Test: `alembic/env.py`'s URL comes from the same helper (`db_url` override still wins)

### C3.impl — Database connection from separate settings, with optional TLS
- **Status:** DONE
- **Description:** Implement to the contract.
- **Acceptance Criteria:**
  - [x] All C3.tests pass; full suite passes

### C4.tests — Web session cookie
- **Status:** DONE
- **Description:** D60, backend half. Extend `backend/tests/test_auth_gate.py`.
- **Contract:**
  - `POST /api/auth/web-session` (exempt from the gate) with body `{"token": "..."}`: if it
    equals `API_TOKEN` (constant-time compare), responds 204 and sets cookie `sw_session`:
    `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`. The value is an expiry
    timestamp plus an HMAC-SHA256 of it keyed from `API_TOKEN`, so rotating the token signs
    every browser out. A wrong token → 401, no cookie.
  - `DELETE /api/auth/web-session` clears the cookie (gated like any route).
  - The gate accepts a valid, unexpired `sw_session` cookie as an alternative to the bearer
    header. Expired, tampered, or signed-with-another-token cookies → 401.
  - Nothing about the bearer header changes; the phone keeps using it.
- **Acceptance Criteria:**
  - [x] Test: correct token → 204 with the cookie and every attribute above; wrong token → 401, no cookie
  - [x] Test: a gated route succeeds with only the cookie
  - [x] Test: tampered, expired, and other-token cookies → 401
  - [x] Test: DELETE clears the cookie; the bearer header alone still works everywhere

### C4.impl — Web session cookie
- **Status:** DONE
- **Description:** Implement to the contract in `main.py` (gate) and `routers/calendar_auth.py`
  or a small new router. Standard library only (`hmac`, `hashlib`, `time`).
- **Acceptance Criteria:**
  - [x] All C4.tests pass; full suite passes

### C5.tests — Backend serves the built web app
- **Status:** PENDING
- **Description:** D56. Add `backend/tests/test_static_web.py` using a temporary directory with a
  fake `index.html` and an asset.
- **Contract:** If env `STATIC_DIR` points at an existing directory, the backend serves it at
  `/`: real files by path (`/assets/x.js`), and any other non-`/api` GET path falls back to
  `index.html` (client-side routes). Static paths are exempt from the bearer gate — the sign-in
  page must load before there is a cookie. `/api/*` is unchanged, and an unknown `/api/...` path
  is still a JSON 404, never `index.html`. If `STATIC_DIR` is unset or missing, nothing is
  mounted (local dev unchanged).
- **Acceptance Criteria:**
  - [ ] Test: `/` and `/some/client/route` return `index.html` without a token
  - [ ] Test: `/assets/app.js` returns the file
  - [ ] Test: `/api/tasks/` still needs the token; `/api/nope` is a JSON 404
  - [ ] Test: no `STATIC_DIR` → `/` is a 404 as today

### C5.impl — Backend serves the built web app
- **Status:** PENDING
- **Description:** Implement to the contract in `main.py`.
- **Acceptance Criteria:**
  - [ ] All C5.tests pass; full suite passes

### C6.tests — Web sign-in page
- **Status:** PENDING
- **Description:** D60, web half. Add `frontend/src/__tests__/SignIn.test.tsx`.
- **Contract:** Any API response of 401 (outside Google-specific calls, which keep their own
  "authorize from a laptop" handling) switches the app to a **sign-in screen**: one password
  field ("API token") and a Sign in button that POSTs `{token}` to `/api/auth/web-session`. On
  204 the app reloads its data and shows the normal screens; on 401 it shows "That token didn't
  work" and stays. Options gains **Sign out**, calling `DELETE /api/auth/web-session` and
  returning to the sign-in screen. The token is never written to `localStorage`,
  `sessionStorage` or a JS-readable cookie. In dev the Vite proxy still injects the header, so
  the screen never appears there.
- **Acceptance Criteria:**
  - [ ] Test: a 401 from a data call shows the sign-in screen
  - [ ] Test: Sign in POSTs the token, and on 204 the normal view returns
  - [ ] Test: a rejected token shows the error and stays
  - [ ] Test: Sign out calls DELETE and shows the sign-in screen
  - [ ] Test: nothing is written to `localStorage`/`sessionStorage`

### C6.impl — Web sign-in page
- **Status:** PENDING
- **Description:** Implement to the contract in `frontend/src/services/api.ts` (a 401 hook),
  `pages/HomePage.tsx` or `App`, and `components/OptionsPage.tsx`.
- **Acceptance Criteria:**
  - [ ] All C6.tests pass; web tsc clean; `npm run build` succeeds

### C7. Container image, entrypoint, and deploy script
- **Status:** PENDING
- **Description:** D55, D61, D63. Depends on U1: if `docker --version` fails, change nothing,
  mark BLOCKED ("U1 not done") and exit. Create at the repo root:
  - `Dockerfile`, multi-stage: stage 1 `node:22-slim` (matches local Node 22) runs `npm ci && npm run build` in
    `frontend/`; stage 2 `python:3.10-slim` (matches the backend venv, Python 3.10) installs `backend/requirements.txt`, copies
    `backend/app`, `backend/alembic`, `backend/alembic.ini`, and the web build to `/app/static`,
    sets `STATIC_DIR=/app/static` and `DB_SSL_CA=/etc/ssl/certs/ca-certificates.crt`, exposes
    8000, and runs `docker-entrypoint.sh`.
  - `docker-entrypoint.sh`: `alembic upgrade head`, then
    `exec uvicorn app.main:app --host 0.0.0.0 --port 8000` (fail fast: `set -e`).
  - `.dockerignore`: `node_modules`, `venv`, `.env`, `*.pickle`, `test.db`, `mobile/`, `.git`,
    build output, `__pycache__`.
  - `deploy.sh`: tags the image with the short git SHA, builds, pushes to
    `ghcr.io/steviepee/stopwatch-scheduler:<sha>`, and runs
    `az containerapp update -n stopwatch-api -g rg-stopwatch --image <that tag>`. Refuses to run
    with uncommitted changes. Prints the app's URL at the end.
  No `.tests` pair: verified by building.
- **Acceptance Criteria:**
  - [ ] `docker build -t stopwatch-scheduler:local .` succeeds from the repo root
  - [ ] `docker run --rm --entrypoint ls stopwatch-scheduler:local /app/static` lists `index.html`
  - [ ] `docker run --rm --entrypoint python -e API_TOKEN=x stopwatch-scheduler:local -c "import app.main"` exits 0
  - [ ] The image contains no `.env`, `token.pickle` or `venv` (`docker run --rm --entrypoint sh stopwatch-scheduler:local -c "find / -name .env -o -name token.pickle 2>/dev/null"` prints nothing)
  - [ ] `bash -n deploy.sh docker-entrypoint.sh` passes; both are executable

### C8.tests — Mobile app variants
- **Status:** PENDING
- **Description:** D64. Add `mobile/src/__tests__/appConfig.test.ts`.
- **Contract:** `mobile/app.config.js` takes the static `app.json` config and, when
  `APP_VARIANT=development`, sets `name` to "Stopwatch Scheduler (Dev)" and `android.package` to
  `app.workflow.stopwatch.dev`; otherwise it returns the config unchanged. `eas.json`:
  `development` gets `"env": {"APP_VARIANT": "development"}`; `preview` gets
  `"env": {"EXPO_PUBLIC_API_URL": "https://api.stopwatchscheduler.app/api"}` and
  `"android": {"buildType": "apk"}`.
- **Acceptance Criteria:**
  - [ ] Test: with `APP_VARIANT=development`, name and package are the dev ones
  - [ ] Test: without it, name and package equal `app.json`'s
  - [ ] Test: `eas.json` profiles carry the env and build type above

### C8.impl — Mobile app variants
- **Status:** PENDING
- **Description:** Implement to the contract. Keep `app.json` as the base config.
- **Acceptance Criteria:**
  - [ ] All C8.tests pass; tsc clean; export succeeds
  - [ ] `APP_VARIANT=development npx expo config --type public` shows the dev package; without it, the normal one

### U3. USER — Create the Azure database and copy the data
- **Status:** USER
- **Description:** After the loop finishes. Pick a database admin password made of letters and
  digits only, and keep it in a password manager. In an Ubuntu tab:
  ```bash
  az login --tenant 1678bfa2-dd98-416b-aa4c-ceb51469ee49
  az account set --subscription 98627fd3-6a53-420b-9f01-796fdbef2b60
  az provider register -n Microsoft.DBforMySQL --wait
  az provider register -n Microsoft.App --wait
  az provider register -n Microsoft.OperationalInsights --wait
  az group create -n rg-stopwatch -l southcentralus

  read -s -p "New DB admin password: " DB_PASSWORD; echo
  az mysql flexible-server create -g rg-stopwatch -n stopwatch-db-steviepee -l southcentralus \
    --tier Burstable --sku-name Standard_B1ms --storage-size 20 --version 8.0.21 \
    --admin-user swadmin --admin-password "$DB_PASSWORD" --public-access 0.0.0.0 \
    --backup-retention 7 --high-availability Disabled --yes
  az mysql flexible-server db create -g rg-stopwatch -s stopwatch-db-steviepee -d stopwatch_scheduler
  MYIP=$(curl -s https://api.ipify.org)
  az mysql flexible-server firewall-rule create -g rg-stopwatch -n stopwatch-db-steviepee \
    --rule-name cutover --start-ip-address $MYIP --end-ip-address $MYIP
  ```
  If the server name is taken, add a digit and use that name everywhere below. Then **stop
  recording on the phone**, bring the local schema to head, dump, and restore:
  ```bash
  cd /root/Stopwatch-scheduler/backend && ./venv/bin/alembic upgrade head
  mysqldump -u root -p --single-transaction --set-gtid-purged=OFF --no-tablespaces stopwatch_scheduler > ~/stopwatch-cutover.sql
  mysql -h stopwatch-db-steviepee.mysql.database.azure.com -u swadmin -p --ssl-mode=REQUIRED stopwatch_scheduler < ~/stopwatch-cutover.sql
  mysql -h stopwatch-db-steviepee.mysql.database.azure.com -u swadmin -p --ssl-mode=REQUIRED stopwatch_scheduler -e "SELECT version_num FROM alembic_version; SELECT COUNT(*) FROM stopwatch_sessions; SELECT COUNT(*) FROM tasks;"
  ```
  The counts match your local database. Keep `~/stopwatch-cutover.sql`. Then remove the
  firewall opening:
  `az mysql flexible-server firewall-rule delete -g rg-stopwatch -n stopwatch-db-steviepee --rule-name cutover --yes`
- **Acceptance Criteria:**
  - [ ] Azure `alembic_version` equals local head; row counts match
  - [ ] The `cutover` firewall rule is deleted
  - [ ] Cost Management → Free services checked for MySQL B1ms; noted here: ____

### U4. USER — Push the image and create the app
- **Status:** USER
- **Description:** Needs a GitHub personal access token (classic) with `write:packages`
  (github.com → Settings → Developer settings → Tokens). Generate the production secrets and keep
  all four in your password manager:
  ```bash
  cd /root/Stopwatch-scheduler
  echo "API token: $(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  echo "Credential key: $(backend/venv/bin/python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
  read -s -p "GitHub PAT: " GHPAT; echo
  echo "$GHPAT" | docker login ghcr.io -u steviepee --password-stdin
  TAG=$(git rev-parse --short HEAD)
  docker build -t ghcr.io/steviepee/stopwatch-scheduler:$TAG .
  docker push ghcr.io/steviepee/stopwatch-scheduler:$TAG
  ```
  On github.com → your profile → Packages → `stopwatch-scheduler` → Package settings → change
  visibility to **Public**. Then create the environment and the app (paste the values when asked;
  `GOOGLE_CLIENT_ID` and the client secret are the ones in `backend/.env`):
  ```bash
  az extension add --name containerapp --upgrade
  az containerapp env create -n stopwatch-env -g rg-stopwatch -l southcentralus
  read -s -p "Prod API token: " P_API; echo
  read -s -p "DB admin password: " P_DB; echo
  read -s -p "Google client secret: " P_GCS; echo
  read -s -p "Credential key: " P_KEY; echo
  read -p "Google client id: " P_GCI
  az containerapp create -n stopwatch-api -g rg-stopwatch --environment stopwatch-env \
    --image ghcr.io/steviepee/stopwatch-scheduler:$TAG --target-port 8000 --ingress external \
    --min-replicas 1 --max-replicas 1 --cpu 0.25 --memory 0.5Gi \
    --secrets api-token="$P_API" db-password="$P_DB" google-client-secret="$P_GCS" credential-key="$P_KEY" \
    --env-vars API_TOKEN=secretref:api-token DB_PASSWORD=secretref:db-password \
      GOOGLE_CLIENT_SECRET=secretref:google-client-secret CREDENTIAL_KEY=secretref:credential-key \
      DB_HOST=stopwatch-db-steviepee.mysql.database.azure.com DB_PORT=3306 DB_USER=swadmin \
      DB_NAME=stopwatch_scheduler GOOGLE_CLIENT_ID="$P_GCI" \
      GOOGLE_REDIRECT_URI=https://api.stopwatchscheduler.app/api/auth/callback
  FQDN=$(az containerapp show -n stopwatch-api -g rg-stopwatch --query properties.configuration.ingress.fqdn -o tsv)
  curl -s https://$FQDN/api/health
  ```
- **Acceptance Criteria:**
  - [ ] `curl https://$FQDN/api/health` → `{"status":"healthy"}`
  - [ ] `curl -s -o /dev/null -w "%{http_code}" https://$FQDN/api/tasks/` → 401
  - [ ] `curl -s -o /dev/null -w "%{http_code}" https://$FQDN/api/auth/google/login` → 401 (C1)

### U5. USER — Domain, certificate, and Google redirect
- **Status:** USER
- **Description:**
  ```bash
  FQDN=$(az containerapp show -n stopwatch-api -g rg-stopwatch --query properties.configuration.ingress.fqdn -o tsv)
  ASUID=$(az containerapp show -n stopwatch-api -g rg-stopwatch --query properties.customDomainVerificationId -o tsv)
  echo "CNAME  api        -> $FQDN"
  echo "TXT    asuid.api  -> $ASUID"
  ```
  In Namecheap → Domain List → stopwatchscheduler.app → Advanced DNS, add those two records
  (Host `api` and `asuid.api`). Leave the existing GitHub Pages records alone. When
  `dig +short api.stopwatchscheduler.app` returns the FQDN (minutes, sometimes longer):
  ```bash
  az containerapp hostname add -n stopwatch-api -g rg-stopwatch --hostname api.stopwatchscheduler.app
  az containerapp hostname bind -n stopwatch-api -g rg-stopwatch --hostname api.stopwatchscheduler.app \
    --environment stopwatch-env --validation-method CNAME
  ```
  The certificate takes a few minutes. Then in Google Cloud Console → APIs & Services →
  Credentials → the OAuth client → Authorized redirect URIs, **add**
  `https://api.stopwatchscheduler.app/api/auth/callback` (keep the localhost one) and Save.
- **Acceptance Criteria:**
  - [ ] `curl https://api.stopwatchscheduler.app/api/health` → healthy, with a valid certificate
  - [ ] `https://stopwatchscheduler.app` still shows the privacy policy
  - [ ] The production redirect URI is registered

### U6. USER — Sign in on the web and connect Google
- **Status:** USER
- **Description:** On the laptop, open `https://api.stopwatchscheduler.app`. The sign-in page
  appears; paste the **production** API token. Go to the Calendar tab's Connect Google button,
  authorize (the "Google hasn't verified this app" screen is expected: Advanced → Go to…), and
  return. The Calendar shows today's Google events.
- **Acceptance Criteria:**
  - [ ] Signed in; data matches the phone's before cutover
  - [ ] `/api/auth/status` (from the web app) is authenticated; Google events show

### U7. USER — Phone builds
- **Status:** USER
- **Description:** From `mobile/`:
  ```bash
  eas build --profile development --platform android   # once: the dev app becomes "(Dev)"
  eas build --profile preview --platform android       # the standalone app
  ```
  Install both from the links EAS prints (open on the phone). The old dev build
  (`app.workflow.stopwatch`) is replaced by the standalone app on install. Open
  **Stopwatch Scheduler** (not "(Dev)") → Settings: paste the **production** API token; the
  server URL already reads `https://api.stopwatchscheduler.app/api`.
- **Acceptance Criteria:**
  - [ ] Both apps installed side by side; the standalone app lists your Activities and Recordings

### U8. USER — Phase 6 gate
- **Status:** USER
- **Description:** On the phone with **Wi-Fi off** (mobile data only), in the standalone app:
  1. Record and stop a short Recording; it appears in the list.
  2. Place a Block on tomorrow and Push day; it appears in Google Calendar.
  3. Settings → Export → Recordings CSV opens readable.
  4. Lock the screen for a few minutes mid-recording, as P10 did; the notification stays and the
     time is right.
  From a network other than your home Wi-Fi (the phone's browser on mobile data counts), open
  `https://api.stopwatchscheduler.app`, sign in, and see the same data. Finally:
  `curl -s -o /dev/null -w "%{http_code}" https://api.stopwatchscheduler.app/api/auth/google/login` → 401.
  Record results in `progress.md`.
- **Acceptance Criteria:**
  - [ ] All checks pass; any failure recorded with the task it reopens
  - [ ] Cost Management shows no unexpected resources in `rg-stopwatch`

---

## Tasks — Build 2b (HOLD: each needs a design pass with the user before it is written)

Outline items carried from `AsIWasSaying.md` §5. The loop never picks `HOLD`. Each becomes a
`.tests`/`.impl` pair for both clients once designed.

### B20. Quadrant picker on the Activity screen
- **Status:** HOLD — needs design. `PUT /api/tasks/{id}` with `is_urgent` / `is_important`.

### B21. Daily Frog pick
- **Status:** HOLD — needs design. Server side is done in B2 (one per Schedule); this is the UI.

### B22. Selectable Strategies
- **Status:** HOLD — needs design. Expose `eat-the-frog`, `eisenhower`, `best-fit-slots`.

### B23. Pomodoro mode
- **Status:** HOLD — needs design. A mode of `timer/core.ts`: work/break intervals, a
  notification on each transition. Open: interval lengths, and whether a work interval becomes a
  Recording.

### B24. Stop button on the foreground notification
- **Status:** HOLD — needs design. Native change; needs an EAS rebuild.

### B25. Peak hours as the suggested start time
- **Status:** HOLD — needs design. `GET /api/insights/peak-hours` seeds the Schedule tab's start.
