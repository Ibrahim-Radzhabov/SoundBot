import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Callable

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from .db.models import Plan, User, UserSubscription
from .settings import settings

ACTIVE_SUBSCRIPTION_STATUS = "active"
FREE_PLAN_CODE = "free"


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


@dataclass(frozen=True)
class StarsPlanOffer:
    plan_code: str
    stars_amount: int
    period_days: int


def get_stars_plan_offer(plan_code: str) -> StarsPlanOffer | None:
    offers: dict[str, StarsPlanOffer] = {
        "plus": StarsPlanOffer(
            plan_code="plus",
            stars_amount=max(settings.billing_stars_plus_amount, 1),
            period_days=max(settings.billing_stars_plus_days, 1),
        ),
        "pro": StarsPlanOffer(
            plan_code="pro",
            stars_amount=max(settings.billing_stars_pro_amount, 1),
            period_days=max(settings.billing_stars_pro_days, 1),
        ),
    }
    return offers.get(plan_code)


def active_subscriptions_map(db: Session, user_id: int) -> dict[str, UserSubscription]:
    now = _utcnow()
    rows = (
        db.query(UserSubscription)
        .filter(
            UserSubscription.user_id == user_id,
            UserSubscription.status == ACTIVE_SUBSCRIPTION_STATUS,
        )
        .order_by(UserSubscription.created_at.desc())
        .all()
    )

    result: dict[str, UserSubscription] = {}
    for row in rows:
        if row.expires_at and row.expires_at < now:
            continue
        current = result.get(row.plan_code)
        if not current:
            result[row.plan_code] = row
            continue
        current_expiry = current.expires_at or datetime.max
        next_expiry = row.expires_at or datetime.max
        if next_expiry > current_expiry:
            result[row.plan_code] = row
    return result


def is_plan_available(plan_code: str, current_plan_code: str, active_subscriptions: dict[str, UserSubscription]) -> bool:
    if plan_code == FREE_PLAN_CODE:
        return True
    if plan_code == current_plan_code:
        return True
    return plan_code in active_subscriptions


def _payload_secret() -> bytes:
    secret = settings.billing_payload_secret or settings.jwt_secret
    return secret.encode("utf-8")


def build_invoice_payload(*, telegram_id: int, plan_code: str, stars_amount: int, period_days: int) -> str:
    issued_at = int(time.time())
    nonce = secrets.token_hex(4)
    base = f"v1|{telegram_id}|{plan_code}|{stars_amount}|{period_days}|{issued_at}|{nonce}"
    signature = hmac.new(_payload_secret(), base.encode("utf-8"), hashlib.sha256).hexdigest()[:20]
    payload = f"{base}|{signature}"
    if len(payload) > 128:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Invoice payload too long")
    return payload


def verify_invoice_payload(payload: str) -> dict[str, int | str]:
    parts = payload.split("|")
    if len(parts) != 8:
        raise ValueError("Invalid payload format")

    version, telegram_id_raw, plan_code, amount_raw, days_raw, issued_at_raw, nonce, signature = parts
    if version != "v1":
        raise ValueError("Unsupported payload version")
    if not nonce:
        raise ValueError("Invalid payload nonce")

    base = "|".join(parts[:-1])
    expected = hmac.new(_payload_secret(), base.encode("utf-8"), hashlib.sha256).hexdigest()[:20]
    if not hmac.compare_digest(signature, expected):
        raise ValueError("Invalid payload signature")

    telegram_id = int(telegram_id_raw)
    stars_amount = int(amount_raw)
    period_days = int(days_raw)
    issued_at = int(issued_at_raw)
    now = int(time.time())

    if issued_at > now + 300:
        raise ValueError("Invoice payload from future")
    if now - issued_at > max(settings.billing_invoice_ttl_sec, 60):
        raise ValueError("Invoice payload expired")

    return {
        "telegram_id": telegram_id,
        "plan_code": plan_code,
        "stars_amount": stars_amount,
        "period_days": period_days,
    }


def grant_subscription(
    db: Session,
    *,
    user: User,
    plan_code: str,
    days: int,
    source: str,
    provider_payment_id: str | None = None,
) -> UserSubscription:
    target_plan = db.query(Plan).filter(Plan.code == plan_code).first()
    if not target_plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    if target_plan.code == FREE_PLAN_CODE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Subscription for free plan is not allowed")

    (
        db.query(UserSubscription)
        .filter(
            UserSubscription.user_id == user.id,
            UserSubscription.plan_code == plan_code,
            UserSubscription.status == ACTIVE_SUBSCRIPTION_STATUS,
        )
        .update({"status": "replaced"}, synchronize_session=False)
    )

    expires_at = _utcnow() + timedelta(days=max(days, 1))
    subscription = UserSubscription(
        user_id=user.id,
        plan_code=plan_code,
        status=ACTIVE_SUBSCRIPTION_STATUS,
        expires_at=expires_at,
        source=(source or "manual").strip() or "manual",
        provider_payment_id=provider_payment_id,
    )
    db.add(subscription)

    if user.plan_id != target_plan.id and user.quota_used_bytes <= target_plan.quota_limit_bytes:
        user.plan_id = target_plan.id

    db.commit()
    db.refresh(subscription)
    return subscription


def _notify(
    notifier: Callable[[int, str], bool] | None,
    telegram_id: int | None,
    text: str,
) -> bool:
    if not telegram_id:
        return False
    if notifier is None:
        return False
    return bool(notifier(telegram_id, text))


def sweep_subscriptions(
    db: Session,
    notifier: Callable[[int, str], bool] | None = None,
) -> dict[str, int]:
    now = _utcnow()
    active_rows = (
        db.query(UserSubscription)
        .filter(UserSubscription.status == ACTIVE_SUBSCRIPTION_STATUS)
        .order_by(UserSubscription.expires_at.asc(), UserSubscription.id.asc())
        .all()
    )

    user_ids = {row.user_id for row in active_rows}
    users = db.query(User).filter(User.id.in_(user_ids)).all() if user_ids else []
    users_by_id = {user.id: user for user in users}

    expired_subscriptions = 0
    reminders_sent_3d = 0
    reminders_sent_1d = 0
    expired_notices_sent = 0

    for row in active_rows:
        user = users_by_id.get(row.user_id)
        telegram_id = user.telegram_id if user else None

        if not row.expires_at:
            continue

        if row.expires_at < now:
            row.status = "expired"
            expired_subscriptions += 1
            if row.expired_notified_at is None:
                text = f"Your {row.plan_code.upper()} subscription expired. Plan switched to FREE."
                if _notify(notifier, telegram_id, text):
                    row.expired_notified_at = now
                    expired_notices_sent += 1
            continue

        seconds_left = int((row.expires_at - now).total_seconds())
        if seconds_left <= 24 * 60 * 60 and row.reminder_1d_sent_at is None:
            date_label = row.expires_at.strftime("%Y-%m-%d")
            text = f"Reminder: your {row.plan_code.upper()} subscription expires on {date_label}."
            if _notify(notifier, telegram_id, text):
                row.reminder_1d_sent_at = now
                reminders_sent_1d += 1
            continue

        if seconds_left <= 3 * 24 * 60 * 60 and row.reminder_3d_sent_at is None:
            date_label = row.expires_at.strftime("%Y-%m-%d")
            text = f"Reminder: your {row.plan_code.upper()} subscription expires on {date_label}."
            if _notify(notifier, telegram_id, text):
                row.reminder_3d_sent_at = now
                reminders_sent_3d += 1

    db.flush()

    plans = db.query(Plan).all()
    plans_by_code = {plan.code: plan for plan in plans}
    free_plan = plans_by_code.get(FREE_PLAN_CODE)
    if not free_plan:
        raise RuntimeError("free plan not found")

    active_rows = (
        db.query(UserSubscription)
        .filter(UserSubscription.status == ACTIVE_SUBSCRIPTION_STATUS)
        .all()
    )
    active_by_user: dict[int, list[UserSubscription]] = {}
    for row in active_rows:
        if row.expires_at and row.expires_at < now:
            continue
        active_by_user.setdefault(row.user_id, []).append(row)

    users = db.query(User).all()
    users_switched_to_free = 0
    users_switched_to_paid = 0
    for user in users:
        desired_plan = free_plan
        user_active = active_by_user.get(user.id, [])
        if user_active:
            best_paid_plan = None
            for subscription in user_active:
                candidate = plans_by_code.get(subscription.plan_code)
                if not candidate:
                    continue
                if not best_paid_plan or candidate.quota_limit_bytes > best_paid_plan.quota_limit_bytes:
                    best_paid_plan = candidate
            if best_paid_plan:
                desired_plan = best_paid_plan

        if user.plan_id == desired_plan.id:
            continue

        if desired_plan.code == FREE_PLAN_CODE:
            users_switched_to_free += 1
        else:
            users_switched_to_paid += 1
        user.plan_id = desired_plan.id

    db.commit()
    return {
        "expired_subscriptions": int(expired_subscriptions or 0),
        "users_switched_to_free": users_switched_to_free,
        "users_switched_to_paid": users_switched_to_paid,
        "reminders_sent_3d": reminders_sent_3d,
        "reminders_sent_1d": reminders_sent_1d,
        "expired_notices_sent": expired_notices_sent,
    }
