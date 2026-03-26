from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from .auth import get_current_user
from .billing_core import (
    FREE_PLAN_CODE,
    active_subscriptions_map,
    build_invoice_payload,
    get_stars_plan_offer,
    grant_subscription,
    is_plan_available,
    sweep_subscriptions,
)
from .db.models import Plan, User, UserSubscription
from .db.session import get_db
from .schemas import (
    BillingAdminGrantRequest,
    BillingAdminGrantResponse,
    BillingPlanChangeRequest,
    BillingPlanChangeResponse,
    BillingPlanItem,
    BillingPlansResponse,
    BillingSubscriptionSweepResponse,
    BillingStarsInvoiceRequest,
    BillingStarsInvoiceResponse,
)
from .settings import settings
from .telegram_api import TelegramApiError, create_invoice_link, send_message
from .user_service import get_or_create_user

router = APIRouter(tags=["billing"])


def _load_user_with_plan(db: Session, user_id: int) -> User:
    user = (
        db.query(User)
        .options(joinedload(User.plan))
        .filter(User.id == user_id)
        .first()
    )
    if not user or not user.plan:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load user plan")
    return user


@router.get("/billing/plans", response_model=BillingPlansResponse)
def list_billing_plans(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    plans = db.query(Plan).order_by(Plan.quota_limit_bytes.asc(), Plan.code.asc()).all()
    if not current_user.plan:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="User plan missing")
    active_subscriptions = active_subscriptions_map(db, current_user.id)

    items: list[BillingPlanItem] = []
    for plan in plans:
        offer = get_stars_plan_offer(plan.code)
        items.append(
            BillingPlanItem(
                code=plan.code,
                name=plan.name,
                quota_limit_bytes=plan.quota_limit_bytes,
                is_current=(plan.code == current_user.plan.code),
                is_available=is_plan_available(plan.code, current_user.plan.code, active_subscriptions),
                subscription_expires_at=active_subscriptions.get(plan.code).expires_at
                if active_subscriptions.get(plan.code)
                else None,
                stars_price=offer.stars_amount if offer else None,
            )
        )

    return BillingPlansResponse(
        items=items,
        current_plan_code=current_user.plan.code,
        quota_limit_bytes=current_user.plan.quota_limit_bytes,
        quota_used_bytes=current_user.quota_used_bytes,
    )


@router.post("/billing/plan", response_model=BillingPlanChangeResponse)
def change_billing_plan(
    payload: BillingPlanChangeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_plan = db.query(Plan).filter(Plan.code == payload.plan_code).first()
    if not target_plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    if not current_user.plan:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="User plan missing")

    active_subscriptions = active_subscriptions_map(db, current_user.id)
    if not is_plan_available(target_plan.code, current_user.plan.code, active_subscriptions):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Active subscription required for selected plan",
        )

    if current_user.quota_used_bytes > target_plan.quota_limit_bytes:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Current usage exceeds selected plan limit",
        )

    if current_user.plan_id != target_plan.id:
        current_user.plan_id = target_plan.id
        db.commit()

    user = _load_user_with_plan(db, current_user.id)
    return BillingPlanChangeResponse(
        plan_code=user.plan.code,
        quota_limit_bytes=user.plan.quota_limit_bytes,
        quota_used_bytes=user.quota_used_bytes,
    )


@router.post("/billing/stars/invoice", response_model=BillingStarsInvoiceResponse)
def create_stars_invoice(
    payload: BillingStarsInvoiceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    offer = get_stars_plan_offer(payload.plan_code)
    if not offer:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Plan does not support stars upgrade")

    target_plan = db.query(Plan).filter(Plan.code == payload.plan_code).first()
    if not target_plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")

    if current_user.quota_used_bytes > target_plan.quota_limit_bytes:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Current usage exceeds selected plan limit",
        )

    invoice_payload = build_invoice_payload(
        telegram_id=current_user.telegram_id,
        plan_code=offer.plan_code,
        stars_amount=offer.stars_amount,
        period_days=offer.period_days,
    )
    title = f"{target_plan.name} plan"
    description = f"{offer.period_days} days subscription for {target_plan.name} quota"

    try:
        invoice_link = create_invoice_link(
            title=title,
            description=description,
            payload=invoice_payload,
            currency=settings.billing_stars_currency,
            amount=offer.stars_amount,
        )
    except TelegramApiError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return BillingStarsInvoiceResponse(
        plan_code=offer.plan_code,
        invoice_link=invoice_link,
        stars_amount=offer.stars_amount,
        period_days=offer.period_days,
    )


@router.post("/billing/admin/subscriptions/grant", response_model=BillingAdminGrantResponse)
def admin_grant_subscription(
    payload: BillingAdminGrantRequest,
    admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    db: Session = Depends(get_db),
):
    if not admin_token or admin_token != settings.billing_admin_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid admin token")

    target_plan = db.query(Plan).filter(Plan.code == payload.plan_code).first()
    if not target_plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    if target_plan.code == FREE_PLAN_CODE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Grant free plan is not supported")

    user = get_or_create_user(db, payload.telegram_id)
    subscription = grant_subscription(
        db,
        user=user,
        plan_code=payload.plan_code,
        days=payload.days,
        source=payload.source,
        provider_payment_id=payload.provider_payment_id,
    )
    user = _load_user_with_plan(db, user.id)

    return BillingAdminGrantResponse(
        subscription_id=subscription.id,
        telegram_id=user.telegram_id,
        plan_code=subscription.plan_code,
        status=subscription.status,
        expires_at=subscription.expires_at,
        user_plan_code=user.plan.code,
    )


@router.post("/billing/admin/subscriptions/sweep", response_model=BillingSubscriptionSweepResponse)
def admin_sweep_subscriptions(
    admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    db: Session = Depends(get_db),
):
    if not admin_token or admin_token != settings.billing_admin_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid admin token")

    def notify(telegram_id: int, text: str) -> bool:
        try:
            send_message(chat_id=telegram_id, text=text)
            return True
        except TelegramApiError:
            return False

    result = sweep_subscriptions(db, notifier=notify)
    return BillingSubscriptionSweepResponse(
        expired_subscriptions=result["expired_subscriptions"],
        users_switched_to_free=result["users_switched_to_free"],
        users_switched_to_paid=result["users_switched_to_paid"],
        reminders_sent_3d=result["reminders_sent_3d"],
        reminders_sent_1d=result["reminders_sent_1d"],
        expired_notices_sent=result["expired_notices_sent"],
    )


def apply_successful_stars_payment(
    db: Session,
    *,
    user: User,
    plan_code: str,
    days: int,
    payment_charge_id: str | None,
) -> UserSubscription:
    return grant_subscription(
        db,
        user=user,
        plan_code=plan_code,
        days=days,
        source="telegram_stars",
        provider_payment_id=payment_charge_id,
    )


def find_existing_payment(
    db: Session,
    *,
    user_id: int,
    payment_charge_id: str | None,
) -> UserSubscription | None:
    if not payment_charge_id:
        return None
    return (
        db.query(UserSubscription)
        .filter(
            UserSubscription.user_id == user_id,
            UserSubscription.provider_payment_id == payment_charge_id,
        )
        .first()
    )
