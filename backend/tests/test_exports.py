import csv
import io
import json

from fastapi.testclient import TestClient

from app.main import app
from app.routers.exports import _tokens


def _unauthed(client):
    """A client that reuses the db override installed by the `client` fixture but sends no Authorization header."""
    return TestClient(app)


def test_post_requires_bearer_token(client):
    unauthed = _unauthed(client)
    r = unauthed.post("/api/exports", json={"resource": "tasks", "format": "json"})
    assert r.status_code == 401


def test_get_with_valid_token_does_not_require_bearer(client):
    r = client.post("/api/exports", json={"resource": "tasks", "format": "json"})
    assert r.status_code == 200
    url = r.json()["url"]

    unauthed = _unauthed(client)
    dl = unauthed.get(url)
    assert dl.status_code == 200


def test_export_covers_every_row_and_formats(client):
    client.post("/api/tasks/", json={"name": "Gym"})
    client.post("/api/tasks/", json={"name": "Reading"})

    r = client.post("/api/exports", json={"resource": "tasks", "format": "json"})
    url = r.json()["url"]
    dl = client.get(url)
    assert dl.status_code == 200
    body = json.loads(dl.content)
    assert len(body) == 2
    assert {row["name"] for row in body} == {"Gym", "Reading"}

    r2 = client.post("/api/exports", json={"resource": "tasks", "format": "csv"})
    url2 = r2.json()["url"]
    dl2 = client.get(url2)
    assert dl2.status_code == 200
    assert dl2.headers["content-type"].startswith("text/csv")
    reader = csv.DictReader(io.StringIO(dl2.text))
    rows = list(reader)
    assert reader.fieldnames is not None
    assert len(rows) == 2
    assert {row["name"] for row in rows} == {"Gym", "Reading"}


def test_csv_has_header_row_even_with_no_data(client):
    r = client.post("/api/exports", json={"resource": "sessions", "format": "csv"})
    url = r.json()["url"]
    dl = client.get(url)
    assert dl.status_code == 200
    lines = dl.text.strip("\r\n").split("\n")
    assert len(lines) == 1
    assert "name" in lines[0]


def test_token_works_once(client):
    r = client.post("/api/exports", json={"resource": "tasks", "format": "json"})
    url = r.json()["url"]
    first = client.get(url)
    second = client.get(url)
    assert first.status_code == 200
    assert second.status_code == 404


def test_expired_token_is_404(client):
    r = client.post("/api/exports", json={"resource": "tasks", "format": "json"})
    token = r.json()["url"].rsplit("/", 1)[-1]
    _tokens[token]["expires_at"] = 0

    dl = client.get(f"/api/exports/{token}")
    assert dl.status_code == 404


def test_unknown_token_is_404(client):
    dl = client.get("/api/exports/not-a-real-token")
    assert dl.status_code == 404


def test_malformed_token_is_404_not_a_stack_trace(client):
    dl = client.get("/api/exports/%20%20%20")
    assert dl.status_code == 404
