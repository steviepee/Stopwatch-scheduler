"""add session_id to time_logs

Revision ID: c3d4e5f6a7b8
Revises: e70f88cf3c24
Create Date: 2026-09-06 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'e70f88cf3c24'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('time_logs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('session_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            'fk_time_logs_session_id',
            'stopwatch_sessions',
            ['session_id'],
            ['id'],
            ondelete='CASCADE',
        )


def downgrade() -> None:
    with op.batch_alter_table('time_logs', schema=None) as batch_op:
        batch_op.drop_constraint('fk_time_logs_session_id', type_='foreignkey')
        batch_op.drop_column('session_id')
