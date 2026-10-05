import pytest
from unittest.mock import patch, MagicMock

from app.services.google_calendar import GoogleCalendarService


@pytest.fixture
def service():
    with patch.object(GoogleCalendarService, "_load_credentials", return_value=None):
        return GoogleCalendarService()


def _creds(expired, valid, refresh_token="rt"):
    c = MagicMock()
    c.expired = expired
    c.valid = valid
    c.refresh_token = refresh_token
    return c


def test_expired_token_is_refreshed_on_use(service):
    creds = _creds(expired=True, valid=False)

    def do_refresh(_request):
        creds.expired = False
        creds.valid = True

    creds.refresh.side_effect = do_refresh
    service.creds = creds
    with patch("app.services.google_calendar.build"), \
         patch.object(GoogleCalendarService, "_save_credentials") as save:
        assert service.is_authenticated() is True
    creds.refresh.assert_called_once()
    save.assert_called_once()


def test_valid_token_is_not_refreshed(service):
    creds = _creds(expired=False, valid=True)
    service.creds = creds
    service.service = object()
    assert service.is_authenticated() is True
    creds.refresh.assert_not_called()


def test_failed_refresh_reports_unauthenticated(service):
    creds = _creds(expired=True, valid=False)
    creds.refresh.side_effect = Exception("invalid_grant")
    service.creds = creds
    assert service.is_authenticated() is False
    assert service.service is None


def _store_fake_creds(monkeypatch, expiry_delta):
    from datetime import datetime
    from google.oauth2.credentials import Credentials
    from cryptography.fernet import Fernet
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine("sqlite:///./test.db", connect_args={"check_same_thread": False})
    monkeypatch.setenv("CREDENTIAL_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr("app.services.google_calendar.SessionLocal", sessionmaker(bind=engine))
    with patch.object(GoogleCalendarService, "_load_credentials", return_value=None):
        svc = GoogleCalendarService()
    svc.creds = Credentials(
        token="fake-access",
        refresh_token="fake-refresh",
        token_uri="https://oauth2.googleapis.com/token",
        client_id="fake-client-id",
        client_secret="fake-client-secret",
        expiry=datetime.utcnow() + expiry_delta,
    )
    svc._save_credentials()


def test_credentials_loaded_lazily_from_db(service, monkeypatch):
    from datetime import timedelta
    _store_fake_creds(monkeypatch, timedelta(hours=1))
    service.creds = None
    with patch("app.services.google_calendar.build") as build:
        assert service.is_authenticated() is True
    assert service.creds.refresh_token == "fake-refresh"
    build.assert_called_once()


def test_service_rebuilt_after_lazy_load(service, monkeypatch):
    from datetime import timedelta
    _store_fake_creds(monkeypatch, timedelta(hours=1))
    service.creds = None
    service.service = None
    with patch("app.services.google_calendar.build", return_value="built"):
        service.is_authenticated()
    assert service.service == "built"


def test_startup_survives_dead_refresh_token(monkeypatch):
    from datetime import timedelta
    from google.oauth2.credentials import Credentials
    _store_fake_creds(monkeypatch, timedelta(hours=-1))
    with patch.object(Credentials, "refresh", side_effect=Exception("invalid_grant: Bad Request")):
        svc = GoogleCalendarService()
        assert svc.is_authenticated() is False
