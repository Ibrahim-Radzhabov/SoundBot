"""add subscription notification timestamps

Revision ID: 20260225_0004
Revises: 20260225_0003
Create Date: 2026-02-25 03:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260225_0004"
down_revision: Union[str, None] = "20260225_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("user_subscriptions", sa.Column("reminder_3d_sent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("user_subscriptions", sa.Column("reminder_1d_sent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("user_subscriptions", sa.Column("expired_notified_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("user_subscriptions", "expired_notified_at")
    op.drop_column("user_subscriptions", "reminder_1d_sent_at")
    op.drop_column("user_subscriptions", "reminder_3d_sent_at")
