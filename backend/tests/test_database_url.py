"""C3 contract: database connection from separate settings, with optional TLS.

- `app.database.db_connection_settings()` reads DB_USER, DB_PASSWORD, DB_HOST,
  DB_PORT, DB_NAME and DB_SSL_CA from the environment at call time and returns
  `(url, connect_args)`. `url` is built with `sqlalchemy.engine.URL.create(...)`
  (driver `mysql+pymysql`), so a password containing `@`, `/` or `:` survives.
- `connect_args` is `{"ssl": {"ca": DB_SSL_CA}}` when DB_SSL_CA is set, else `{}`.
- Defaults without env vars are unchanged: root, empty password, localhost,
  3306, stopwatch_scheduler.
- The app engine and `alembic/env.py` both use the helper; env.py's
  `-x db_url=` override still wins over it.
"""
import argparse
import os

import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from sqlalchemy.engine import URL, make_url

import app.database as database

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_DB_VARS = ("DB_USER", "DB_PASSWORD", "DB_HOST", "DB_PORT", "DB_NAME", "DB_SSL_CA")


def _clear_db_env(monkeypatch):
    for var in _DB_VARS:
        monkeypatch.delenv(var, raising=False)


def _set_db_env(monkeypatch, password="fake-pass"):
    _clear_db_env(monkeypatch)
    monkeypatch.setenv("DB_USER", "fake_user")
    monkeypatch.setenv("DB_PASSWORD", password)
    monkeypatch.setenv("DB_HOST", "fake-host.example.com")
    monkeypatch.setenv("DB_PORT", "3307")
    monkeypatch.setenv("DB_NAME", "fake_db")


def test_password_with_special_characters_round_trips(monkeypatch):
    password = "p@ss:w/rd@:/"
    _set_db_env(monkeypatch, password=password)

    url, _ = database.db_connection_settings()

    assert isinstance(url, URL)
    assert url.drivername == "mysql+pymysql"
    assert url.password == password
    assert url.username == "fake_user"
    assert url.host == "fake-host.example.com"
    assert url.port == 3307
    assert url.database == "fake_db"

    reparsed = make_url(url.render_as_string(hide_password=False))
    assert reparsed.password == password
    assert reparsed.host == "fake-host.example.com"
    assert reparsed.database == "fake_db"


def test_defaults_unchanged_without_env(monkeypatch):
    _clear_db_env(monkeypatch)

    url, connect_args = database.db_connection_settings()

    assert url.drivername == "mysql+pymysql"
    assert url.username == "root"
    assert not url.password
    assert url.host == "localhost"
    assert url.port == 3306
    assert url.database == "stopwatch_scheduler"
    assert connect_args == {}


def test_ssl_ca_set_puts_ca_in_connect_args(monkeypatch):
    _set_db_env(monkeypatch)
    monkeypatch.setenv("DB_SSL_CA", "/fake/path/ca.pem")

    _, connect_args = database.db_connection_settings()

    assert connect_args == {"ssl": {"ca": "/fake/path/ca.pem"}}


def test_ssl_ca_unset_has_no_ssl_args(monkeypatch):
    _set_db_env(monkeypatch)

    _, connect_args = database.db_connection_settings()

    assert "ssl" not in connect_args


def test_app_engine_uses_helper_url():
    url, _ = database.db_connection_settings()
    assert database.engine.url.render_as_string(hide_password=False) == url.render_as_string(
        hide_password=False
    )


def _alembic_cfg(db_url=None) -> Config:
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.cmd_opts = argparse.Namespace(x=[f"db_url={db_url}"] if db_url else [])
    return cfg


def _tables(path):
    engine = sa.create_engine(f"sqlite:///{path}")
    try:
        return set(sa.inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_alembic_env_uses_helper(tmp_path, monkeypatch):
    helper_db = tmp_path / "from_helper.db"
    calls = []

    def fake_settings():
        calls.append(1)
        return URL.create("sqlite", database=str(helper_db)), {}

    monkeypatch.setattr(database, "db_connection_settings", fake_settings)

    command.upgrade(_alembic_cfg(), "head")

    assert calls, "alembic/env.py must build its URL with app.database.db_connection_settings"
    assert "tasks" in _tables(helper_db)


def test_alembic_db_url_override_wins(tmp_path, monkeypatch):
    helper_db = tmp_path / "from_helper.db"
    override_db = tmp_path / "override.db"

    monkeypatch.setattr(
        database,
        "db_connection_settings",
        lambda: (URL.create("sqlite", database=str(helper_db)), {}),
    )

    command.upgrade(_alembic_cfg(f"sqlite:///{override_db}"), "head")

    assert "tasks" in _tables(override_db)
    assert not helper_db.exists()
