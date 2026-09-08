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
        self._refresh_if_needed()

    def _refresh_if_needed(self):
        """Load credentials from disk if absent and refresh an expired access token.

        Access tokens last about an hour, so this runs before every use rather
        than only at construction. A refresh failure degrades to unauthenticated
        instead of raising, so a dead refresh token cannot stop the app booting.
        """
        if self.creds is None and os.path.exists(self.TOKEN_FILE):
            with open(self.TOKEN_FILE, 'rb') as token:
                self.creds = pickle.load(token)
            self.service = None

        if self.creds and self.creds.expired and self.creds.refresh_token:
            try:
                self.creds.refresh(Request())
                self._save_credentials()
            except Exception:
                self.creds = None
                self.service = None
                return

        if self.creds and self.creds.valid and self.service is None:
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
        self._refresh_if_needed()
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
        return self._list_events(start_utc, end_utc)

    def get_events_for_range(self, start_date_str: str, end_date_str: str, tz_offset: int = 0) -> list:
        """Fetch all events from the primary calendar over an inclusive date range.

        Same tz_offset convention as get_events_for_date. Each returned event is
        tagged with the caller-local day (YYYY-MM-DD) it starts on.
        """
        if not self.is_authenticated():
            raise Exception("Not authenticated with Google Calendar")

        start_day = datetime.strptime(start_date_str, "%Y-%m-%d")
        end_day = datetime.strptime(end_date_str, "%Y-%m-%d")
        start_utc = start_day + timedelta(minutes=tz_offset)
        end_utc = end_day + timedelta(minutes=tz_offset) + timedelta(days=1)
        events = self._list_events(start_utc, end_utc)
        for event in events:
            event["day"] = self._local_day(event["start"], tz_offset)
        return events

    def _list_events(self, start_utc: datetime, end_utc: datetime) -> list:
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
                "id": item.get("id"),
                "summary": item.get("summary", ""),
                "start": start.get("dateTime") or start.get("date"),
                "end": end.get("dateTime") or end.get("date"),
            })
        return events

    @staticmethod
    def _local_day(start_value: str, tz_offset: int) -> str:
        """The caller-local day (YYYY-MM-DD) a start value falls on.

        All-day events carry a bare date with no time to convert. Timed events
        carry their own offset from Google; convert to UTC then apply tz_offset
        the same way get_events_for_date does (UTC = local + tz_offset).
        """
        if start_value is None or "T" not in start_value:
            return start_value

        dt = datetime.fromisoformat(start_value.replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        local = dt - timedelta(minutes=tz_offset)
        return local.strftime("%Y-%m-%d")

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
