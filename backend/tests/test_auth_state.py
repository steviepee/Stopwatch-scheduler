import pytest
from unittest.mock import patch, MagicMock

from app.services.google_calendar import GoogleCalendarService
from app.routers.calendar_auth import calendar_service


@pytest.fixture
def service():
    with patch.object(GoogleCalendarService, "_load_credentials", return_value=None):
        return GoogleCalendarService()


def test_mismatched_state_rejected(service):
    service._pending_state = "expected-state"
    with pytest.raises(ValueError):
        service.authenticate("auth-code", "attacker-state")


def test_missing_pending_state_rejected(service):
    service._pending_state = None
    with pytest.raises(ValueError):
        service.authenticate("auth-code", "anything")


def test_state_is_single_use(service):
    service._pending_state = "expected-state"
    with patch("app.services.google_calendar.Flow"), \
         patch("app.services.google_calendar.build"), \
         patch.object(GoogleCalendarService, "_save_credentials", return_value=None):
        service.authenticate("auth-code", "expected-state")
    assert service._pending_state is None
    with pytest.raises(ValueError):
        service.authenticate("auth-code", "expected-state")


def test_get_auth_url_stores_state(service):
    flow = MagicMock()
    flow.authorization_url.return_value = ("https://accounts.google.com/x", "generated-state")
    with patch("app.services.google_calendar.Flow") as F:
        F.from_client_config.return_value = flow
        service.get_auth_url()
    assert service._pending_state == "generated-state"


def test_callback_rejects_bad_state(client):
    calendar_service._pending_state = "expected-state"
    r = client.get("/api/auth/callback", params={"code": "c", "state": "wrong"})
    assert r.status_code == 400


def test_callback_requires_state(client):
    r = client.get("/api/auth/callback", params={"code": "c"})
    assert r.status_code == 422
