"""add calendar_event_id to schedule_items

Revision ID: f1a2b3c4d5e6
Revises: c3d4e5f6a7b8
Create Date: 2026-09-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('schedule_items', schema=None) as batch_op:
        batch_op.add_column(sa.Column('calendar_event_id', sa.String(length=255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('schedule_items', schema=None) as batch_op:
        batch_op.drop_column('calendar_event_id')
