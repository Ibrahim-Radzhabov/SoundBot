"""initial schema for media library mvp

Revision ID: 20260216_0001
Revises:
Create Date: 2026-02-16 00:01:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260216_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "plans",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("quota_limit_bytes", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index(op.f("ix_plans_id"), "plans", ["id"], unique=False)

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("telegram_id", sa.BigInteger(), nullable=False),
        sa.Column("plan_id", sa.Integer(), nullable=False),
        sa.Column("quota_used_bytes", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("telegram_id"),
    )
    op.create_index(op.f("ix_users_id"), "users", ["id"], unique=False)
    op.create_index(op.f("ix_users_plan_id"), "users", ["plan_id"], unique=False)
    op.create_index(op.f("ix_users_telegram_id"), "users", ["telegram_id"], unique=False)

    op.create_table(
        "tracks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), nullable=False),
        sa.Column("telegram_file_id", sa.String(length=255), nullable=False),
        sa.Column("telegram_unique_id", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("artist", sa.String(length=255), nullable=True),
        sa.Column("duration_sec", sa.Integer(), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("mime", sa.String(length=100), nullable=True),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("owner_user_id", "telegram_unique_id", name="uq_tracks_owner_unique"),
    )
    op.create_index(op.f("ix_tracks_id"), "tracks", ["id"], unique=False)
    op.create_index(op.f("ix_tracks_owner_user_id"), "tracks", ["owner_user_id"], unique=False)

    op.create_table(
        "playlists",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_playlists_id"), "playlists", ["id"], unique=False)
    op.create_index(op.f("ix_playlists_owner_user_id"), "playlists", ["owner_user_id"], unique=False)

    op.create_table(
        "import_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("telegram_message_id", sa.BigInteger(), nullable=True),
        sa.Column("telegram_chat_id", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_import_events_id"), "import_events", ["id"], unique=False)
    op.create_index(op.f("ix_import_events_status"), "import_events", ["status"], unique=False)
    op.create_index(op.f("ix_import_events_user_id"), "import_events", ["user_id"], unique=False)

    op.create_table(
        "playlist_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("playlist_id", sa.Integer(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["playlist_id"], ["playlists.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("playlist_id", "position", name="uq_playlist_position"),
        sa.UniqueConstraint("playlist_id", "track_id", name="uq_playlist_track"),
    )
    op.create_index(op.f("ix_playlist_items_id"), "playlist_items", ["id"], unique=False)
    op.create_index(op.f("ix_playlist_items_playlist_id"), "playlist_items", ["playlist_id"], unique=False)
    op.create_index(op.f("ix_playlist_items_track_id"), "playlist_items", ["track_id"], unique=False)

    plans = sa.table(
        "plans",
        sa.column("code", sa.String(length=20)),
        sa.column("name", sa.String(length=50)),
        sa.column("quota_limit_bytes", sa.BigInteger()),
    )
    op.bulk_insert(
        plans,
        [
            {"code": "free", "name": "Free", "quota_limit_bytes": 1_073_741_824},
            {"code": "plus", "name": "Plus", "quota_limit_bytes": 3_221_225_472},
            {"code": "pro", "name": "Pro", "quota_limit_bytes": 5_368_709_120},
        ],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_playlist_items_track_id"), table_name="playlist_items")
    op.drop_index(op.f("ix_playlist_items_playlist_id"), table_name="playlist_items")
    op.drop_index(op.f("ix_playlist_items_id"), table_name="playlist_items")
    op.drop_table("playlist_items")

    op.drop_index(op.f("ix_import_events_user_id"), table_name="import_events")
    op.drop_index(op.f("ix_import_events_status"), table_name="import_events")
    op.drop_index(op.f("ix_import_events_id"), table_name="import_events")
    op.drop_table("import_events")

    op.drop_index(op.f("ix_playlists_owner_user_id"), table_name="playlists")
    op.drop_index(op.f("ix_playlists_id"), table_name="playlists")
    op.drop_table("playlists")

    op.drop_index(op.f("ix_tracks_owner_user_id"), table_name="tracks")
    op.drop_index(op.f("ix_tracks_id"), table_name="tracks")
    op.drop_table("tracks")

    op.drop_index(op.f("ix_users_telegram_id"), table_name="users")
    op.drop_index(op.f("ix_users_plan_id"), table_name="users")
    op.drop_index(op.f("ix_users_id"), table_name="users")
    op.drop_table("users")

    op.drop_index(op.f("ix_plans_id"), table_name="plans")
    op.drop_table("plans")
