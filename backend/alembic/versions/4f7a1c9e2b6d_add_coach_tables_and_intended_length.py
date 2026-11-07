"""add coach tables and intended length

Revision ID: 4f7a1c9e2b6d
Revises: 66350d60caf3
Create Date: 2026-11-06 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4f7a1c9e2b6d'
down_revision: Union[str, Sequence[str], None] = '66350d60caf3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('coach_conversations',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('target_date', sa.Date(), nullable=False),
    sa.Column('tz_offset', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('model', sa.String(length=100), nullable=False),
    sa.Column('effort', sa.String(length=20), nullable=False),
    sa.Column('user_turns', sa.Integer(), nullable=False),
    sa.Column('revision_turns', sa.Integer(), nullable=False),
    sa.Column('proposal', sa.Text(), nullable=True),
    sa.Column('proposed_count', sa.Integer(), nullable=True),
    sa.Column('accepted_count', sa.Integer(), nullable=True),
    sa.Column('accepted_items', sa.Text(), nullable=True),
    sa.Column('rating', sa.String(length=10), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.Column('closed_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_coach_conversations_id'), 'coach_conversations', ['id'], unique=False)
    op.create_index(op.f('ix_coach_conversations_target_date'), 'coach_conversations', ['target_date'], unique=False)
    op.create_table('coach_messages',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('conversation_id', sa.Integer(), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('visible_text', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['conversation_id'], ['coach_conversations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_coach_messages_conversation_id'), 'coach_messages', ['conversation_id'], unique=False)
    op.create_index(op.f('ix_coach_messages_id'), 'coach_messages', ['id'], unique=False)
    op.create_table('coach_calls',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('conversation_id', sa.Integer(), nullable=False),
    sa.Column('turn_index', sa.Integer(), nullable=False),
    sa.Column('model', sa.String(length=100), nullable=False),
    sa.Column('effort', sa.String(length=20), nullable=False),
    sa.Column('input_tokens', sa.Integer(), nullable=False),
    sa.Column('cache_creation_input_tokens', sa.Integer(), nullable=True),
    sa.Column('cache_read_input_tokens', sa.Integer(), nullable=True),
    sa.Column('output_tokens', sa.Integer(), nullable=False),
    sa.Column('stop_reason', sa.String(length=50), nullable=True),
    sa.Column('latency_ms', sa.Integer(), nullable=False),
    sa.Column('cost_usd', sa.Float(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['conversation_id'], ['coach_conversations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_coach_calls_conversation_id'), 'coach_calls', ['conversation_id'], unique=False)
    op.create_index(op.f('ix_coach_calls_id'), 'coach_calls', ['id'], unique=False)
    op.create_table('coach_notes',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('text', sa.String(length=300), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('confirmed_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_coach_notes_id'), 'coach_notes', ['id'], unique=False)
    op.create_table('coach_settings',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('notes_enabled', sa.Boolean(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_coach_settings_id'), 'coach_settings', ['id'], unique=False)
    op.create_table('reminder_settings',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.Column('minutes_before', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_reminder_settings_id'), 'reminder_settings', ['id'], unique=False)
    op.add_column('tasks', sa.Column('intended_length', sa.Float(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('tasks', 'intended_length')
    op.drop_index(op.f('ix_reminder_settings_id'), table_name='reminder_settings')
    op.drop_table('reminder_settings')
    op.drop_index(op.f('ix_coach_settings_id'), table_name='coach_settings')
    op.drop_table('coach_settings')
    op.drop_index(op.f('ix_coach_notes_id'), table_name='coach_notes')
    op.drop_table('coach_notes')
    op.drop_index(op.f('ix_coach_calls_id'), table_name='coach_calls')
    op.drop_index(op.f('ix_coach_calls_conversation_id'), table_name='coach_calls')
    op.drop_table('coach_calls')
    op.drop_index(op.f('ix_coach_messages_id'), table_name='coach_messages')
    op.drop_index(op.f('ix_coach_messages_conversation_id'), table_name='coach_messages')
    op.drop_table('coach_messages')
    op.drop_index(op.f('ix_coach_conversations_target_date'), table_name='coach_conversations')
    op.drop_index(op.f('ix_coach_conversations_id'), table_name='coach_conversations')
    op.drop_table('coach_conversations')
