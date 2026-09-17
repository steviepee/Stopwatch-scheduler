# Google Calendar Auth Refresh

When you see `invalid_grant: Bad Request` on backend startup, or the Calendar tab errors on
both clients at once, the OAuth token has died. Full diagnosis is in `GOTCHAS.md` (first entry).

## Steps

Start the backend from `backend/` — not the repo root, because `main.py` calls bare
`load_dotenv()` and resolves `.env` from the working directory:

```bash
cd /root/Stopwatch-scheduler/backend
./venv/bin/python -m uvicorn app.main:app --port 8000 --reload
```

Then, from a **laptop** browser (never the phone — roadmap D14):

1. Open `http://localhost:8000/api/auth/google/login`. Use `localhost`, not the LAN IP:
   `GOOGLE_REDIRECT_URI` is `http://localhost:8000/api/auth/callback` and a mismatch fails.
2. **This route returns JSON, it does not redirect you.** Copy the `auth_url` value out of the
   response and open it yourself.
3. At "Google hasn't verified this app", click **Advanced** → **Go to … (unsafe)**. Expected
   since the app is published unverified; not a failure.
4. Consent. The callback writes a fresh `token.pickle` automatically — no restart needed.

Don't edit backend files between steps 1 and 4: the OAuth `state` is held in memory on a
module-level singleton, so `--reload` restarting the process makes the callback fail with
"Invalid OAuth state".

Deleting `backend/token.pickle` first is optional — the flow passes `prompt='consent'`, so the
callback always issues a new refresh token and overwrites the file.

## Confirm

```bash
curl -H "Authorization: Bearer $(grep API_TOKEN backend/.env | cut -d= -f2)" \
  http://localhost:8000/api/auth/status
```

`{"authenticated": true}`.
