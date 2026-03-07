# Google Calendar Auth Refresh

When you see `invalid_grant: Bad Request` on backend startup, the OAuth token has expired.

## Steps

From the project root:

```bash
rm backend/token.pickle
```

Then start the backend if it's not running:

```bash
cd backend && source venv/bin/activate && uvicorn app.main:app --port 8000 --reload
```

Then open this URL in your browser and complete the Google login flow:

```
http://localhost:8000/api/auth/google/login
```

A fresh `token.pickle` will be written automatically. Calendar integration works again immediately — no restart needed.
