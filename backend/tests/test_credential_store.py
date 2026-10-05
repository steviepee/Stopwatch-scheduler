"""C2 contract: Google credentials as an encrypted database row (D58).

- Table `google_credentials` (`id`, `data` Text, `updated_at`), one row in single-user use,
  created by an Alembic revision.
- `_save_credentials` writes (or replaces) the row with `Credentials.to_json()` encrypted by
  Fernet under `CREDENTIAL_KEY`; loading decrypts it and calls
  `Credentials.from_authorized_user_info(...)`. No file is read or written.
- The service opens its own session from `SessionLocal`, imported into
  `app.services.google_calendar`; tests point that name at the SQLite test database.
- Unset `CREDENTIAL_KEY`, or a row that does not decrypt with it: not authenticated, no crash.
  Saving without a key raises a RuntimeError naming `CREDENTIAL_KEY`.
"""
import builtins
import json
from datetime import datetime, timedelta

import pytest
import sqlalchemy as sa
from cryptography.fernet import Fernet
from google.oauth2.credentials import Credentials
from sqlalchemy.orm import sessionmaker
from unittest.mock import patch

from app.services.google_calendar import GoogleCalendarService

_ENGINE = sa.create_engine('sqlite:///./test.db', connect_args={'check_same_thread': False})
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_ENGINE)

FAKE_REFRESH = 'fake-refresh-token-c2'
FAKE_ACCESS = 'fake-access-token-c2'


def _fake_creds(expiry_delta=timedelta(hours=1)):
    return Credentials(
        token=FAKE_ACCESS,
        refresh_token=FAKE_REFRESH,
        token_uri='https://oauth2.googleapis.com/token',
        client_id='fake-client-id',
        client_secret='fake-client-secret',
        scopes=GoogleCalendarService.SCOPES,
        expiry=datetime.utcnow() + expiry_delta,
    )


def _rows():
    with _ENGINE.connect() as conn:
        return conn.execute(sa.text('SELECT data FROM google_credentials')).scalars().all()


@pytest.fixture
def key(monkeypatch):
    k = Fernet.generate_key().decode()
    monkeypatch.setenv('CREDENTIAL_KEY', k)
    monkeypatch.setattr('app.services.google_calendar.SessionLocal', _Session)
    return k


def _new_service():
    with patch('app.services.google_calendar.build'):
        return GoogleCalendarService()


def _save(creds):
    svc = _new_service()
    svc.creds = creds
    svc._save_credentials()
    return svc


def test_save_then_load_round_trips(key):
    _save(_fake_creds())

    svc = _new_service()
    assert svc.creds is not None
    assert svc.creds.refresh_token == FAKE_REFRESH
    assert svc.creds.token == FAKE_ACCESS
    with patch('app.services.google_calendar.build'):
        assert svc.is_authenticated() is True


def test_stored_data_is_encrypted(key):
    _save(_fake_creds())

    rows = _rows()
    assert len(rows) == 1
    assert FAKE_REFRESH not in rows[0]
    assert FAKE_ACCESS not in rows[0]
    decrypted = json.loads(Fernet(key.encode()).decrypt(rows[0].encode()))
    assert decrypted['refresh_token'] == FAKE_REFRESH


def test_save_replaces_the_row(key):
    _save(_fake_creds())
    _save(_fake_creds())
    assert len(_rows()) == 1


def test_refresh_on_use_saves_refreshed_token(key):
    _save(_fake_creds(expiry_delta=timedelta(hours=-1)))

    def do_refresh(self, _request):
        self.token = 'fake-refreshed-access'
        self.expiry = datetime.utcnow() + timedelta(hours=1)

    with patch.object(Credentials, 'refresh', do_refresh):
        svc = _new_service()
        with patch('app.services.google_calendar.build'):
            assert svc.is_authenticated() is True

    data = json.loads(Fernet(key.encode()).decrypt(_rows()[0].encode()))
    assert data['token'] == 'fake-refreshed-access'


def test_no_token_pickle_created_or_read(key, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / 'token.pickle').write_bytes(b'not a real pickle')
    opened = []
    real_open = builtins.open

    def spy_open(file, *args, **kwargs):
        opened.append(str(file))
        return real_open(file, *args, **kwargs)

    with patch('builtins.open', spy_open):
        empty = _new_service()
        assert empty.is_authenticated() is False
        _save(_fake_creds())
        loaded = _new_service()
        with patch('app.services.google_calendar.build'):
            assert loaded.is_authenticated() is True

    assert not any('pickle' in f for f in opened)
    assert (tmp_path / 'token.pickle').read_bytes() == b'not a real pickle'
    assert sorted(p.name for p in tmp_path.iterdir()) == ['token.pickle']


def test_unset_key_is_not_authenticated(key, monkeypatch):
    _save(_fake_creds())
    monkeypatch.delenv('CREDENTIAL_KEY')

    svc = _new_service()
    assert svc.is_authenticated() is False


def test_unset_key_save_raises_clear_error(key, monkeypatch):
    monkeypatch.delenv('CREDENTIAL_KEY')
    svc = _new_service()
    svc.creds = _fake_creds()
    with pytest.raises(RuntimeError, match='CREDENTIAL_KEY'):
        svc._save_credentials()
    assert _rows() == []


def test_unset_key_status_false_and_other_routes_work(key, monkeypatch, client):
    from app.routers.calendar_auth import calendar_service
    _save(_fake_creds())
    monkeypatch.delenv('CREDENTIAL_KEY')
    monkeypatch.setattr(calendar_service, 'creds', None)
    monkeypatch.setattr(calendar_service, 'service', None)

    resp = client.get('/api/auth/status')
    assert resp.status_code == 200
    assert resp.json() == {'authenticated': False}
    assert client.get('/api/tasks/').status_code == 200
    assert client.get('/api/sessions/').status_code == 200


def test_row_from_another_key_is_not_authenticated(key, monkeypatch):
    _save(_fake_creds())
    monkeypatch.setenv('CREDENTIAL_KEY', Fernet.generate_key().decode())

    svc = _new_service()
    assert svc.creds is None
    assert svc.is_authenticated() is False


def test_row_from_another_key_status_false(key, monkeypatch, client):
    from app.routers.calendar_auth import calendar_service
    _save(_fake_creds())
    monkeypatch.setenv('CREDENTIAL_KEY', Fernet.generate_key().decode())
    monkeypatch.setattr(calendar_service, 'creds', None)
    monkeypatch.setattr(calendar_service, 'service', None)

    resp = client.get('/api/auth/status')
    assert resp.status_code == 200
    assert resp.json() == {'authenticated': False}


def test_migration_creates_google_credentials(tmp_path):
    import argparse
    import os
    from alembic import command
    from alembic.config import Config

    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    db_url = f'sqlite:///{tmp_path}/c2_migration.db'
    cfg = Config(os.path.join(backend_dir, 'alembic.ini'))
    cfg.cmd_opts = argparse.Namespace(x=[f'db_url={db_url}'])
    command.upgrade(cfg, 'head')

    columns = {c['name'] for c in sa.inspect(sa.create_engine(db_url)).get_columns('google_credentials')}
    assert {'id', 'data', 'updated_at'} <= columns
