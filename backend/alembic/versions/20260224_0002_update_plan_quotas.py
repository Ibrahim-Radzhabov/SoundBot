"""update plan quotas to free 300MB plus 2GB pro 5GB

Revision ID: 20260224_0002
Revises: 20260216_0001
Create Date: 2026-02-24 22:56:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260224_0002"
down_revision: Union[str, None] = "20260216_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(sa.text("UPDATE plans SET quota_limit_bytes = :quota WHERE code = 'free'"), {"quota": 314_572_800})
    connection.execute(sa.text("UPDATE plans SET quota_limit_bytes = :quota WHERE code = 'plus'"), {"quota": 2_147_483_648})
    connection.execute(sa.text("UPDATE plans SET quota_limit_bytes = :quota WHERE code = 'pro'"), {"quota": 5_368_709_120})


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(sa.text("UPDATE plans SET quota_limit_bytes = :quota WHERE code = 'free'"), {"quota": 1_073_741_824})
    connection.execute(sa.text("UPDATE plans SET quota_limit_bytes = :quota WHERE code = 'plus'"), {"quota": 3_221_225_472})
    connection.execute(sa.text("UPDATE plans SET quota_limit_bytes = :quota WHERE code = 'pro'"), {"quota": 5_368_709_120})
