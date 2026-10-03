"""Migration drift test.

Creates a throwaway SQLite database, runs `alembic upgrade head` against it,
then asserts that Base.metadata matches the migrated schema exactly. Also
verifies the negative: monkeypatching a new column onto a model produces a
non-empty diff.
"""
import argparse
import os

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext

from app.database import Base
import app.models.task  # noqa: F401
import app.models.time_log  # noqa: F401
import app.models.stopwatch_session  # noqa: F401
import app.models.schedule  # noqa: F401

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _alembic_cfg(db_url: str) -> Config:
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.cmd_opts = argparse.Namespace(x=[f"db_url={db_url}"])
    return cfg


def _diff_against(db_url: str, metadata: sa.MetaData):
    engine = sa.create_engine(db_url)
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={"compare_type": False})
        return compare_metadata(ctx, metadata)


def test_upgrade_produces_no_diff(tmp_path):
    db_url = f"sqlite:///{tmp_path}/migration_test.db"
    command.upgrade(_alembic_cfg(db_url), "head")
    diffs = _diff_against(db_url, Base.metadata)
    assert diffs == [], f"Unexpected schema drift after upgrade head: {diffs}"


def test_calendar_stale_column_is_not_null_and_backfills_false(tmp_path):
    db_url = f"sqlite:///{tmp_path}/stale_test.db"
    command.upgrade(_alembic_cfg(db_url), "head")
    engine = sa.create_engine(db_url)

    columns = {c["name"]: c for c in sa.inspect(engine).get_columns("schedule_items")}
    assert "calendar_stale" in columns
    assert columns["calendar_stale"]["nullable"] is False
    assert columns["calendar_stale"]["default"] is not None

    with engine.begin() as conn:
        conn.execute(sa.text("INSERT INTO schedules (id, target_date) VALUES (1, '2026-09-08')"))
        conn.execute(sa.text(
            "INSERT INTO schedule_items (schedule_id, estimated_duration, is_frog) VALUES (1, 600, 0)"
        ))
        stale = conn.execute(sa.text("SELECT calendar_stale FROM schedule_items")).scalar_one()
    assert stale in (0, False)


def test_monkeypatch_column_produces_diff(tmp_path):
    db_url = f"sqlite:///{tmp_path}/drift_test.db"
    command.upgrade(_alembic_cfg(db_url), "head")

    # Copy metadata into a new MetaData so Base.metadata is not mutated
    modified = sa.MetaData()
    for table in Base.metadata.sorted_tables:
        table.to_metadata(modified)
    modified.tables["tasks"].append_column(
        sa.Column("__sentinel__", sa.String(10))
    )

    diffs = _diff_against(db_url, modified)
    assert diffs != [], "Adding a column to the model must produce a non-empty diff"
