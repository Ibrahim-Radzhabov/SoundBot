from sqlalchemy.orm import Session, joinedload

from .db.models import Plan, User

FREE_PLAN_CODE = "free"
FREE_PLAN_NAME = "Free"
FREE_PLAN_QUOTA_BYTES = 314_572_800


def get_or_create_free_plan(db: Session) -> Plan:
    plan = db.query(Plan).filter(Plan.code == FREE_PLAN_CODE).first()
    if plan:
        return plan

    plan = Plan(code=FREE_PLAN_CODE, name=FREE_PLAN_NAME, quota_limit_bytes=FREE_PLAN_QUOTA_BYTES)
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


def get_or_create_user(db: Session, telegram_id: int) -> User:
    user = (
        db.query(User)
        .options(joinedload(User.plan))
        .filter(User.telegram_id == telegram_id)
        .first()
    )
    if user:
        return user

    free_plan = get_or_create_free_plan(db)
    created = User(telegram_id=telegram_id, plan_id=free_plan.id)
    db.add(created)
    db.commit()

    user = (
        db.query(User)
        .options(joinedload(User.plan))
        .filter(User.id == created.id)
        .first()
    )
    if not user:
        raise RuntimeError("Failed to load user after creation")
    return user
