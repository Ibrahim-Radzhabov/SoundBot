import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from .billing import apply_successful_stars_payment, find_existing_payment
from .billing_core import get_stars_plan_offer, verify_invoice_payload
from .db.models import ImportEvent
from .db.session import get_db
from .schemas import TrackImportRequest
from .settings import settings
from .telegram_api import TelegramApiError, answer_pre_checkout_query, send_message
from .tracks import to_track_item, upsert_user_track
from .user_service import get_or_create_user

logger = logging.getLogger("telegram")
router = APIRouter(prefix="/telegram", tags=["telegram"])


def _to_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_message(update: dict[str, Any]) -> dict[str, Any] | None:
    for key in ("message", "edited_message", "channel_post", "edited_channel_post"):
        message = update.get(key)
        if isinstance(message, dict):
            return message
    return None


def _normalize_title(file_name: str | None, fallback: str = "Telegram Track") -> str:
    if not file_name:
        return fallback
    stem = Path(file_name).stem.strip()
    return stem or fallback


def _extract_import_payload(message: dict[str, Any]) -> TrackImportRequest | None:
    audio = message.get("audio") if isinstance(message.get("audio"), dict) else None
    document = message.get("document") if isinstance(message.get("document"), dict) else None

    media: dict[str, Any] | None = None
    if audio:
        media = audio
    elif document:
        mime = str(document.get("mime_type") or "")
        if mime.startswith("audio/"):
            media = document

    if not media:
        return None

    telegram_file_id = media.get("file_id")
    telegram_unique_id = media.get("file_unique_id")
    if not telegram_file_id or not telegram_unique_id:
        return None

    file_name = media.get("file_name")
    if not file_name:
        file_name = f"{telegram_unique_id}.bin"

    title = None
    artist = None
    if audio:
        title = (audio.get("title") or "").strip() or _normalize_title(file_name)
        artist = (audio.get("performer") or "").strip() or None
    else:
        title = _normalize_title(file_name)

    return TrackImportRequest(
        telegram_file_id=str(telegram_file_id),
        telegram_unique_id=str(telegram_unique_id),
        title=title,
        artist=artist,
        duration_sec=_to_int(media.get("duration")),
        size_bytes=_to_int(media.get("file_size")),
        mime=(media.get("mime_type") or None),
        file_name=str(file_name),
    )


def _extract_successful_payment(message: dict[str, Any]) -> dict[str, Any] | None:
    successful_payment = message.get("successful_payment")
    if isinstance(successful_payment, dict):
        return successful_payment
    return None


def _extract_pre_checkout_query(update: dict[str, Any]) -> dict[str, Any] | None:
    pre_checkout_query = update.get("pre_checkout_query")
    if isinstance(pre_checkout_query, dict):
        return pre_checkout_query
    return None


def _validate_stars_payload(
    *,
    telegram_id: int,
    invoice_payload: str,
    currency: str,
    total_amount: int,
) -> tuple[dict[str, int | str] | None, str | None]:
    try:
        payload = verify_invoice_payload(invoice_payload)
    except ValueError as exc:
        return None, str(exc)

    payload_telegram_id = _to_int(payload.get("telegram_id"))
    if payload_telegram_id != telegram_id:
        return None, "invoice payload user mismatch"

    plan_code = str(payload.get("plan_code"))
    offer = get_stars_plan_offer(plan_code)
    if not offer:
        return None, "invalid plan"

    if currency != settings.billing_stars_currency:
        return None, "currency mismatch"

    payload_amount = _to_int(payload.get("stars_amount")) or 0
    if total_amount != offer.stars_amount or total_amount != payload_amount:
        return None, "amount mismatch"

    return payload, None


def _record_import_event(
    db: Session,
    *,
    user_id: int,
    message: dict[str, Any],
    event_status: str,
    reason: str | None = None,
) -> None:
    event = ImportEvent(
        user_id=user_id,
        telegram_message_id=_to_int(message.get("message_id")),
        telegram_chat_id=_to_int((message.get("chat") or {}).get("id")),
        status=event_status,
        reason=reason,
    )
    db.add(event)
    db.commit()


@router.post("/webhook")
def telegram_webhook(
    update: dict[str, Any],
    db: Session = Depends(get_db),
    secret_token: str | None = Header(default=None, alias="X-Telegram-Bot-Api-Secret-Token"),
):
    configured_secret = settings.telegram_webhook_secret
    if configured_secret and secret_token != configured_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook secret")

    pre_checkout_query = _extract_pre_checkout_query(update)
    if pre_checkout_query:
        query_id = str(pre_checkout_query.get("id") or "")
        from_user = pre_checkout_query.get("from") or {}
        telegram_id = _to_int(from_user.get("id"))
        currency = str(pre_checkout_query.get("currency") or "")
        total_amount = _to_int(pre_checkout_query.get("total_amount")) or 0
        invoice_payload = str(pre_checkout_query.get("invoice_payload") or "")

        error_reason = None
        if not telegram_id:
            error_reason = "missing_sender"
        else:
            _, error_reason = _validate_stars_payload(
                telegram_id=telegram_id,
                invoice_payload=invoice_payload,
                currency=currency,
                total_amount=total_amount,
            )

        if not query_id:
            return {"ok": True, "status": "pre_checkout_error", "reason": "missing_query_id"}

        try:
            answer_pre_checkout_query(
                pre_checkout_query_id=query_id,
                ok=error_reason is None,
                error_message=error_reason if error_reason else None,
            )
        except TelegramApiError:
            logger.exception("failed to answer pre_checkout_query")
            return {"ok": True, "status": "pre_checkout_error"}

        return {
            "ok": True,
            "status": "pre_checkout_ok" if error_reason is None else "pre_checkout_rejected",
            "reason": error_reason,
        }

    message = _extract_message(update)
    if not message:
        return {"ok": True, "status": "ignored", "reason": "unsupported_update"}

    from_user = message.get("from") or {}
    telegram_id = _to_int(from_user.get("id"))
    if not telegram_id:
        return {"ok": True, "status": "ignored", "reason": "missing_sender"}

    user = get_or_create_user(db, telegram_id)
    successful_payment = _extract_successful_payment(message)
    if successful_payment:
        payload, payment_error = _validate_stars_payload(
            telegram_id=user.telegram_id,
            invoice_payload=str(successful_payment.get("invoice_payload") or ""),
            currency=str(successful_payment.get("currency") or ""),
            total_amount=_to_int(successful_payment.get("total_amount")) or 0,
        )
        if payment_error or not payload:
            reason = payment_error or "invalid payment payload"
            _record_import_event(db, user_id=user.id, message=message, event_status="payment_error", reason=reason)
            return {"ok": True, "status": "payment_error", "reason": reason}

        payment_charge_id = str(successful_payment.get("telegram_payment_charge_id") or "")
        existing_payment = find_existing_payment(db, user_id=user.id, payment_charge_id=payment_charge_id)
        if existing_payment:
            _record_import_event(db, user_id=user.id, message=message, event_status="payment_duplicate")
            return {"ok": True, "status": "payment_duplicate", "plan_code": existing_payment.plan_code}

        plan_code = str(payload.get("plan_code"))
        offer = get_stars_plan_offer(plan_code)
        if not offer:
            _record_import_event(db, user_id=user.id, message=message, event_status="payment_error", reason="invalid plan")
            return {"ok": True, "status": "payment_error", "reason": "invalid plan"}

        subscription = apply_successful_stars_payment(
            db,
            user=user,
            plan_code=plan_code,
            days=_to_int(payload.get("period_days")) or offer.period_days,
            payment_charge_id=payment_charge_id or None,
        )
        try:
            expiry_label = subscription.expires_at.strftime("%Y-%m-%d") if subscription.expires_at else "unknown date"
            send_message(
                chat_id=user.telegram_id,
                text=f"Payment received. {plan_code.upper()} plan is active until {expiry_label}.",
            )
        except TelegramApiError:
            logger.exception("failed to send payment success notification")
        _record_import_event(db, user_id=user.id, message=message, event_status="payment_success")
        return {
            "ok": True,
            "status": "payment_success",
            "plan_code": subscription.plan_code,
            "expires_at": subscription.expires_at,
        }

    payload = _extract_import_payload(message)
    if not payload:
        _record_import_event(db, user_id=user.id, message=message, event_status="ignored", reason="not_audio")
        return {"ok": True, "status": "ignored", "reason": "not_audio"}

    try:
        track = upsert_user_track(db, user, payload)
    except HTTPException as exc:
        event_status = "quota_exceeded" if exc.status_code == status.HTTP_413_REQUEST_ENTITY_TOO_LARGE else "error"
        _record_import_event(
            db,
            user_id=user.id,
            message=message,
            event_status=event_status,
            reason=str(exc.detail),
        )
        return {"ok": True, "status": event_status, "reason": str(exc.detail)}
    except Exception as exc:
        logger.exception("telegram import failed")
        db.rollback()
        _record_import_event(db, user_id=user.id, message=message, event_status="error", reason=str(exc))
        return {"ok": True, "status": "error"}

    _record_import_event(db, user_id=user.id, message=message, event_status="success")
    return {"ok": True, "status": "imported", "track": to_track_item(track).model_dump()}
