"""add user subscriptions for paid plans

Revision ID: 20260225_0003
Revises: 20260224_0002
Create Date: 2026-02-25 02:20:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260225_0003"
down_revision: Union[str, None] = "20260224_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("plan_code", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column("provider_payment_id", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_subscriptions_id"), "user_subscriptions", ["id"], unique=False)
    op.create_index(op.f("ix_user_subscriptions_user_id"), "user_subscriptions", ["user_id"], unique=False)
    op.create_index(op.f("ix_user_subscriptions_plan_code"), "user_subscriptions", ["plan_code"], unique=False)
    op.create_index(op.f("ix_user_subscriptions_status"), "user_subscriptions", ["status"], unique=False)
    op.create_index(op.f("ix_user_subscriptions_expires_at"), "user_subscriptions", ["expires_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_user_subscriptions_expires_at"), table_name="user_subscriptions")
    op.drop_index(op.f("ix_user_subscriptions_status"), table_name="user_subscriptions")
    op.drop_index(op.f("ix_user_subscriptions_plan_code"), table_name="user_subscriptions")
    op.drop_index(op.f("ix_user_subscriptions_user_id"), table_name="user_subscriptions")
    op.drop_index(op.f("ix_user_subscriptions_id"), table_name="user_subscriptions")
    op.drop_table("user_subscriptions")
