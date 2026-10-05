# C5 contract (D56): if STATIC_DIR points at an existing directory, the backend serves it at `/`.
# Real files are served by path; any other non-/api GET path falls back to index.html. Static
# paths are exempt from the bearer gate. /api/* is unchanged, and an unknown /api/... path is a
# JSON 404, never index.html. STATIC_DIR unset or missing -> nothing mounted.
#
# The mount happens when app.main is imported, so each test reloads it with the env it needs and
# the fixture reloads it again (STATIC_DIR unset) on the way out.
import importlib
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

TOKEN = os.environ['API_TOKEN']
INDEX_HTML = '<!doctype html><html><body><div id="root">fake web app</div></body></html>'
APP_JS = 'console.log("fake asset");'

_engine = create_engine('sqlite:///./test.db', connect_args={'check_same_thread': False})
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)


@pytest.fixture
def static_dir(tmp_path):
    (tmp_path / 'index.html').write_text(INDEX_HTML)
    (tmp_path / 'assets').mkdir()
    (tmp_path / 'assets' / 'app.js').write_text(APP_JS)
    return tmp_path


@pytest.fixture
def make_client(monkeypatch):
    import app.main
    from app.database import get_db

    def override_get_db():
        db = _Session()
        try:
            yield db
        finally:
            db.close()

    built = []

    def _make(static):
        if static is None:
            monkeypatch.delenv('STATIC_DIR', raising=False)
        else:
            monkeypatch.setenv('STATIC_DIR', str(static))
        module = importlib.reload(app.main)
        module.app.dependency_overrides[get_db] = override_get_db
        built.append(module.app)
        return TestClient(module.app)

    yield _make

    for a in built:
        a.dependency_overrides.clear()
    monkeypatch.delenv('STATIC_DIR', raising=False)
    importlib.reload(app.main)


def _auth():
    return {'Authorization': f'Bearer {TOKEN}'}


def test_root_serves_index_without_token(make_client, static_dir):
    client = make_client(static_dir)
    resp = client.get('/')
    assert resp.status_code == 200
    assert resp.text == INDEX_HTML
    assert resp.headers['content-type'].startswith('text/html')


def test_client_route_falls_back_to_index_without_token(make_client, static_dir):
    client = make_client(static_dir)
    for path in ('/some/client/route', '/calendar', '/options/settings'):
        resp = client.get(path)
        assert resp.status_code == 200, path
        assert resp.text == INDEX_HTML, path


def test_asset_is_served_by_path(make_client, static_dir):
    client = make_client(static_dir)
    resp = client.get('/assets/app.js')
    assert resp.status_code == 200
    assert resp.text == APP_JS
    assert 'javascript' in resp.headers['content-type']


def test_api_route_still_needs_token(make_client, static_dir):
    client = make_client(static_dir)
    resp = client.get('/api/tasks/')
    assert resp.status_code == 401
    assert resp.json() == {'detail': 'Not authenticated'}

    resp = client.get('/api/tasks/', headers=_auth())
    assert resp.status_code == 200
    assert resp.json() == []


def test_unknown_api_path_is_json_404(make_client, static_dir):
    client = make_client(static_dir)
    resp = client.get('/api/nope', headers=_auth())
    assert resp.status_code == 404
    assert resp.headers['content-type'].startswith('application/json')
    assert resp.json() == {'detail': 'Not Found'}
    assert INDEX_HTML not in resp.text


def test_unknown_api_path_without_token_is_not_index(make_client, static_dir):
    client = make_client(static_dir)
    resp = client.get('/api/nope')
    assert resp.status_code == 401
    assert INDEX_HTML not in resp.text


def test_health_unchanged_with_static(make_client, static_dir):
    client = make_client(static_dir)
    resp = client.get('/api/health')
    assert resp.status_code == 200
    assert resp.json() == {'status': 'healthy'}


def _assert_root_not_served(client):
    resp = client.get('/', headers=_auth())
    assert resp.status_code in (200, 404)
    assert resp.headers['content-type'].startswith('application/json')
    assert INDEX_HTML not in resp.text
    resp = client.get('/some/client/route', headers=_auth())
    assert resp.status_code == 404
    assert INDEX_HTML not in resp.text
    resp = client.get('/some/client/route')
    assert resp.status_code == 401


def test_no_static_dir_mounts_nothing(make_client):
    _assert_root_not_served(make_client(None))


def test_missing_static_dir_mounts_nothing(make_client, tmp_path):
    _assert_root_not_served(make_client(tmp_path / 'does-not-exist'))
