from logging.config import fileConfig
import os
import sys

from sqlalchemy import create_engine
from sqlalchemy import pool

from alembic import context

# Ensure the backend package is importable when alembic runs from backend/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))

from app.database import Base
import app.models.task  # noqa: F401 — registers ORM models with Base.metadata
import app.models.time_log  # noqa: F401
import app.models.stopwatch_session  # noqa: F401
import app.models.schedule  # noqa: F401
import app.models.google_credential  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _get_settings():
    x_args = context.get_x_argument(as_dictionary=True)
    if 'db_url' in x_args:
        return x_args['db_url'], {}
    import app.database
    return app.database.db_connection_settings()


def run_migrations_offline() -> None:
    url, _ = _get_settings()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url, connect_args = _get_settings()
    connectable = create_engine(url, connect_args=connect_args, poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
