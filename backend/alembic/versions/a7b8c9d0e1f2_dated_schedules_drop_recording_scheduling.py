"""dated schedules; drop recording scheduling columns

Revision ID: a7b8c9d0e1f2
Revises: f1a2b3c4d5e6
Create Date: 2026-09-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('stopwatch_sessions', schema=None) as batch_op:
        batch_op.drop_column('calendar_event_id')
        batch_op.drop_column('is_on_calendar')
        batch_op.drop_column('scheduled_start')
        batch_op.drop_column('scheduled_end')

    with op.batch_alter_table('schedules', schema=None) as batch_op:
        batch_op.alter_column('target_date', existing_type=sa.DateTime(), type_=sa.Date(), existing_nullable=True)
        batch_op.alter_column('name', existing_type=sa.String(length=255), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table('schedules', schema=None) as batch_op:
        batch_op.alter_column('name', existing_type=sa.String(length=255), nullable=False)
        batch_op.alter_column('target_date', existing_type=sa.Date(), type_=sa.DateTime(), existing_nullable=True)

    with op.batch_alter_table('stopwatch_sessions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('scheduled_end', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('scheduled_start', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('is_on_calendar', sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column('calendar_event_id', sa.String(length=255), nullable=True))
