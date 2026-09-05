import os
import subprocess
import sys

import pytest
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


def test_google_login_exempt(client):
    resp = client.get('/api/auth/google/login')
    assert resp.status_code != 401


def test_callback_exempt(client):
    resp = client.get('/api/auth/callback')
    assert resp.status_code != 401


def test_startup_fails_without_api_token():
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env = {k: v for k, v in os.environ.items() if k != 'API_TOKEN'}
    code = (
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
