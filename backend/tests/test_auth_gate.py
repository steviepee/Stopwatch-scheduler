import hashlib
import hmac
import os
import subprocess
import sys
import time
from http.cookies import SimpleCookie

import pytest
from unittest.mock import MagicMock, patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

TOKEN = 'test-gate-token'
_GATE_ENGINE = create_engine('sqlite:///./test.db', connect_args={'check_same_thread': False})
_GateSession = sessionmaker(autocommit=False, autoflush=False, bind=_GATE_ENGINE)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('API_TOKEN', TOKEN)
    from app.database import get_db
    from app.main import app
    from fastapi.testclient import TestClient

    def override_get_db():
        db = _GateSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    c = TestClient(app)
    yield c
    app.dependency_overrides.clear()


@pytest.fixture
def authed_client(client, monkeypatch):
    monkeypatch.setenv('API_TOKEN', TOKEN)

    class _Authed:
        def get(self, url, **kw):
            headers = dict(kw.pop('headers', {}))
            headers['Authorization'] = f'Bearer {TOKEN}'
            return client.get(url, headers=headers, **kw)

        def post(self, url, **kw):
            headers = dict(kw.pop('headers', {}))
            headers['Authorization'] = f'Bearer {TOKEN}'
            return client.post(url, headers=headers, **kw)

    return _Authed()


def test_no_token_is_401(client):
    resp = client.get('/api/tasks/')
    assert resp.status_code == 401
    assert resp.json() == {'detail': 'Not authenticated'}


def test_wrong_token_is_401(client):
    resp = client.get('/api/tasks/', headers={'Authorization': 'Bearer wrong-token'})
    assert resp.status_code == 401
    assert resp.json() == {'detail': 'Not authenticated'}


def test_correct_token_passes(authed_client):
    resp = authed_client.get('/api/tasks/')
    assert resp.status_code == 200


def test_health_exempt(client):
    resp = client.get('/api/health')
    assert resp.status_code != 401


def test_google_login_requires_token(client):
    resp = client.get('/api/auth/google/login')
    assert resp.status_code == 401
    assert resp.json() == {'detail': 'Not authenticated'}


def test_google_login_with_token_returns_auth_url(authed_client):
    flow = MagicMock()
    flow.authorization_url.return_value = ('https://accounts.google.com/x', 'issued-state')
    with patch('app.services.google_calendar.Flow') as F:
        F.from_client_config.return_value = flow
        resp = authed_client.get('/api/auth/google/login')
    assert resp.status_code == 200
    assert resp.json() == {'auth_url': 'https://accounts.google.com/x'}


def test_callback_exempt(client):
    resp = client.get('/api/auth/callback')
    assert resp.status_code != 401


def test_callback_unknown_state_is_400_and_saves_nothing(client):
    from app.routers.calendar_auth import calendar_service
    calendar_service._pending_state = None
    creds_before = calendar_service.creds
    with patch('app.services.google_calendar.Flow') as F:
        resp = client.get('/api/auth/callback', params={'code': 'c', 'state': 'never-issued'})
    assert resp.status_code == 400
    F.from_client_config.assert_not_called()
    assert calendar_service.creds is creds_before


def test_startup_fails_without_api_token():
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env = {k: v for k, v in os.environ.items() if k != 'API_TOKEN'}
    code = (
        'import dotenv\n'
        'dotenv.load_dotenv = lambda *a, **k: False\n'
        'from unittest.mock import patch\n'
        'with patch('
        "'app.services.google_calendar.GoogleCalendarService._load_credentials',"
        ' return_value=None):\n'
        '    import app.main\n'
    )
    result = subprocess.run(
        [sys.executable, '-c', code],
        env=env,
        capture_output=True,
        cwd=backend_dir,
    )
    assert result.returncode != 0


# C4 contract: web session cookie (D60).
# - POST /api/auth/web-session (exempt) with {"token": ...}: equal to API_TOKEN
#   (constant-time) -> 204 and Set-Cookie `sw_session`, HttpOnly, Secure,
#   SameSite=Strict, Path=/, Max-Age=2592000. Wrong token -> 401, no cookie.
# - Cookie value is "<expiry>.<sig>": expiry is integer Unix seconds, sig is
#   hmac.new(API_TOKEN.encode(), str(expiry).encode(), hashlib.sha256).hexdigest().
#   API_TOKEN is read at request time, so rotating it signs every browser out.
# - The gate accepts a valid, unexpired `sw_session` cookie instead of the
#   bearer header. Expired, tampered, or other-token cookies -> 401.
# - DELETE /api/auth/web-session is gated and clears the cookie (Max-Age=0).
# Cookies are sent as an explicit Cookie header: the jar would not send a
# Secure cookie to http://testserver.
COOKIE = 'sw_session'


def _sign(expiry, token=TOKEN):
    sig = hmac.new(token.encode(), str(expiry).encode(), hashlib.sha256).hexdigest()
    return f'{expiry}.{sig}'


def _set_cookie_headers(resp):
    return [h for h in resp.headers.get_list('set-cookie') if h.startswith(f'{COOKIE}=')]


def _attrs(header):
    return [part.strip().lower() for part in header.split(';')]


def _issued_value(resp):
    [header] = _set_cookie_headers(resp)
    jar = SimpleCookie()
    jar.load(header)
    return jar[COOKIE].value


def _with_cookie(value):
    return {'Cookie': f'{COOKIE}={value}'}


def _sign_in(client, token=TOKEN):
    resp = client.post('/api/auth/web-session', json={'token': token})
    client.cookies.clear()
    return resp


def test_web_session_correct_token_sets_cookie(client):
    resp = _sign_in(client)
    assert resp.status_code == 204
    [header] = _set_cookie_headers(resp)
    attrs = _attrs(header)
    assert 'httponly' in attrs
    assert 'secure' in attrs
    assert 'samesite=strict' in attrs
    assert 'path=/' in attrs
    assert 'max-age=2592000' in attrs


def test_web_session_cookie_value_is_signed_expiry(client):
    before = int(time.time())
    value = _issued_value(_sign_in(client))
    expiry = int(value.split('.', 1)[0])
    assert before + 2592000 - 5 <= expiry <= int(time.time()) + 2592000 + 5
    assert value == _sign(expiry)


def test_web_session_wrong_token_is_401_no_cookie(client):
    resp = _sign_in(client, token='not-the-token')
    assert resp.status_code == 401
    assert _set_cookie_headers(resp) == []


def test_web_session_missing_token_sets_no_cookie(client):
    resp = client.post('/api/auth/web-session', json={})
    assert resp.status_code in (401, 422)
    assert _set_cookie_headers(resp) == []


def test_gated_route_succeeds_with_only_cookie(client):
    value = _issued_value(_sign_in(client))
    resp = client.get('/api/tasks/', headers=_with_cookie(value))
    assert resp.status_code == 200


def test_crafted_valid_cookie_passes(client):
    resp = client.get('/api/tasks/', headers=_with_cookie(_sign(int(time.time()) + 3600)))
    assert resp.status_code == 200


def test_tampered_signature_cookie_is_401(client):
    value = _issued_value(_sign_in(client))
    expiry, sig = value.split('.', 1)
    flipped = '0' if sig[-1] != '0' else '1'
    resp = client.get('/api/tasks/', headers=_with_cookie(f'{expiry}.{sig[:-1]}{flipped}'))
    assert resp.status_code == 401
    assert resp.json() == {'detail': 'Not authenticated'}


def test_tampered_expiry_cookie_is_401(client):
    value = _issued_value(_sign_in(client))
    expiry, sig = value.split('.', 1)
    resp = client.get('/api/tasks/', headers=_with_cookie(f'{int(expiry) + 86400}.{sig}'))
    assert resp.status_code == 401


def test_malformed_cookie_is_401(client):
    for value in ('', 'garbage', 'abc.def', str(int(time.time()) + 3600)):
        resp = client.get('/api/tasks/', headers=_with_cookie(value))
        assert resp.status_code == 401, value


def test_expired_cookie_is_401(client):
    resp = client.get('/api/tasks/', headers=_with_cookie(_sign(int(time.time()) - 60)))
    assert resp.status_code == 401
    assert resp.json() == {'detail': 'Not authenticated'}


def test_other_token_cookie_is_401(client):
    value = _sign(int(time.time()) + 3600, token='another-token')
    resp = client.get('/api/tasks/', headers=_with_cookie(value))
    assert resp.status_code == 401


def test_rotating_token_signs_cookie_out(client, monkeypatch):
    value = _issued_value(_sign_in(client))
    monkeypatch.setenv('API_TOKEN', 'rotated-token')
    resp = client.get('/api/tasks/', headers=_with_cookie(value))
    assert resp.status_code == 401


def test_delete_web_session_requires_auth(client):
    resp = client.delete('/api/auth/web-session')
    assert resp.status_code == 401


def test_delete_web_session_clears_cookie(client):
    value = _issued_value(_sign_in(client))
    resp = client.delete('/api/auth/web-session', headers=_with_cookie(value))
    assert resp.status_code in (200, 204)
    [header] = _set_cookie_headers(resp)
    attrs = _attrs(header)
    assert 'max-age=0' in attrs
    assert 'path=/' in attrs
    jar = SimpleCookie()
    jar.load(header)
    assert jar[COOKIE].value in ('', '""')


def test_delete_web_session_with_bearer(client):
    resp = client.delete('/api/auth/web-session', headers={'Authorization': f'Bearer {TOKEN}'})
    assert resp.status_code in (200, 204)
    assert len(_set_cookie_headers(resp)) == 1


def test_bearer_alone_still_works_everywhere(client):
    _sign_in(client)
    headers = {'Authorization': f'Bearer {TOKEN}'}
    for path in ('/api/tasks/', '/api/sessions/', '/api/time-logs/', '/api/schedules/'):
        resp = client.get(path, headers=headers)
        assert resp.status_code == 200, path
    resp = client.post('/api/tasks/', json={'name': 'c4-bearer'}, headers=headers)
    assert resp.status_code in (200, 201)
