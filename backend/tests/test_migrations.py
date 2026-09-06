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
