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


def test_credentials_loaded_lazily_from_disk(service):
    creds = _creds(expired=False, valid=True)
    service.creds = None
    with patch("app.services.google_calendar.os.path.exists", return_value=True), \
         patch("builtins.open", MagicMock()), \
         patch("app.services.google_calendar.pickle.load", return_value=creds), \
         patch("app.services.google_calendar.build") as build:
        assert service.is_authenticated() is True
    build.assert_called_once()


def test_service_rebuilt_after_lazy_load(service):
    creds = _creds(expired=False, valid=True)
    service.creds = None
    service.service = None
    with patch("app.services.google_calendar.os.path.exists", return_value=True), \
         patch("builtins.open", MagicMock()), \
         patch("app.services.google_calendar.pickle.load", return_value=creds), \
         patch("app.services.google_calendar.build", return_value="built"):
        service.is_authenticated()
    assert service.service == "built"


def test_startup_survives_dead_refresh_token():
    creds = _creds(expired=True, valid=False)
    creds.refresh.side_effect = Exception("invalid_grant: Bad Request")
    with patch("app.services.google_calendar.os.path.exists", return_value=True), \
         patch("builtins.open", MagicMock()), \
         patch("app.services.google_calendar.pickle.load", return_value=creds):
        svc = GoogleCalendarService()
    assert svc.is_authenticated() is False
