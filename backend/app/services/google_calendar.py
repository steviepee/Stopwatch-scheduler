import os
from datetime import datetime, timedelta, timezone
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from google.auth.transport.requests import Request
import pickle
import secrets

class GoogleCalendarService:
    SCOPES = ['https://www.googleapis.com/auth/calendar']
    TOKEN_FILE = 'token.pickle'

    def __init__(self):
        self.creds = None
        self.service = None
        self._pending_state = None
        self._load_credentials()

    def _load_credentials(self):
        """Load saved credentials if they exist"""
        if os.path.exists(self.TOKEN_FILE):
            with open(self.TOKEN_FILE, 'rb') as token:
                self.creds = pickle.load(token)

        # Refresh expired credentials
        if self.creds and self.creds.expired and self.creds.refresh_token:
            self.creds.refresh(Request())
            self._save_credentials()

        if self.creds and self.creds.valid:
            self.service = build('calendar', 'v3', credentials=self.creds)

    def _save_credentials(self):
        """Save credentials to file"""
        with open(self.TOKEN_FILE, 'wb') as token:
            pickle.dump(self.creds, token)

    def get_auth_url(self):
        """Get Google OAuth authorization URL"""
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": os.getenv("GOOGLE_CLIENT_ID"),
                    "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [os.getenv("GOOGLE_REDIRECT_URI")]
                }
            },
            scopes=self.SCOPES
        )
        flow.redirect_uri = os.getenv("GOOGLE_REDIRECT_URI")

        auth_url, state = flow.authorization_url(prompt='consent')
        self._pending_state = state
        return auth_url

    def authenticate(self, code: str, state: str):
        """Complete OAuth flow with authorization code"""
        expected_state = self._pending_state
        self._pending_state = None
        if not expected_state or not secrets.compare_digest(state, expected_state):
            raise ValueError("Invalid OAuth state")

        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": os.getenv("GOOGLE_CLIENT_ID"),
                    "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [os.getenv("GOOGLE_REDIRECT_URI")]
                }
            },
            scopes=self.SCOPES
        )
        flow.redirect_uri = os.getenv("GOOGLE_REDIRECT_URI")

        flow.fetch_token(code=code)
        self.creds = flow.credentials
        self._save_credentials()
        self.service = build('calendar', 'v3', credentials=self.creds)

    def is_authenticated(self):
        """Check if user is authenticated"""
        return self.creds is not None and self.creds.valid

    def get_events_for_date(self, date_str: str, tz_offset: int = 0) -> list:
        """Fetch all events from the primary calendar for a given date (YYYY-MM-DD).

        tz_offset is the caller's UTC offset in minutes as returned by JS
        getTimezoneOffset() (UTC - local), so the date is interpreted as the
        caller's local day.
        """
        if not self.is_authenticated():
            raise Exception("Not authenticated with Google Calendar")

        day = datetime.strptime(date_str, "%Y-%m-%d")
        start_utc = day + timedelta(minutes=tz_offset)
        end_utc = start_utc + timedelta(days=1)
        time_min = start_utc.isoformat() + "Z"
        time_max = end_utc.isoformat() + "Z"

        result = self.service.events().list(
            calendarId="primary",
            timeMin=time_min,
            timeMax=time_max,
            singleEvents=True,
            orderBy="startTime",
        ).execute()

        events = []
        for item in result.get("items", []):
            start = item.get("start", {})
            end = item.get("end", {})
            events.append({
                "summary": item.get("summary", ""),
                "start": start.get("dateTime") or start.get("date"),
                "end": end.get("dateTime") or end.get("date"),
            })
        return events

    def create_event(self, task_name: str, duration_seconds: float, start_time: str = None):
        """Create a calendar event"""
        if not self.is_authenticated():
            raise Exception("Not authenticated with Google Calendar")

        # Parse start time (naive UTC isoformat) or use current UTC time
        if start_time:
            start = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
            if start.tzinfo is not None:
                start = start.astimezone(timezone.utc).replace(tzinfo=None)
        else:
            start = datetime.now(timezone.utc).replace(tzinfo=None)

        # Calculate end time based on duration
        end = start + timedelta(seconds=duration_seconds)

        event = {
            'summary': task_name,
            'start': {
                'dateTime': start.isoformat(),
                'timeZone': 'UTC',
            },
            'end': {
                'dateTime': end.isoformat(),
                'timeZone': 'UTC',
            },
        }

        created_event = self.service.events().insert(calendarId='primary', body=event).execute()
        return created_event
