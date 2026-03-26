from datetime import datetime
from pydantic import BaseModel, Field
from typing import List


class AuthRequest(BaseModel):
    init_data: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    plan_code: str
    quota_limit_bytes: int
    quota_used_bytes: int


class TrackItem(BaseModel):
    id: str
    title: str
    artist: str
    duration: int
    cover_url: str
    stream_url: str


class TrackList(BaseModel):
    items: List[TrackItem]
    cursor: int = 0


class TrackImportRequest(BaseModel):
    telegram_file_id: str
    telegram_unique_id: str
    title: str | None = None
    artist: str | None = None
    duration_sec: int | None = None
    size_bytes: int | None = None
    mime: str | None = None
    file_name: str | None = None


class TrackDeleteResponse(BaseModel):
    deleted_id: str
    quota_used_bytes: int


class BillingPlanItem(BaseModel):
    code: str
    name: str
    quota_limit_bytes: int
    is_current: bool = False
    is_available: bool = False
    subscription_expires_at: datetime | None = None
    stars_price: int | None = None


class BillingPlansResponse(BaseModel):
    items: List[BillingPlanItem]
    current_plan_code: str
    quota_limit_bytes: int
    quota_used_bytes: int


class BillingPlanChangeRequest(BaseModel):
    plan_code: str


class BillingPlanChangeResponse(BaseModel):
    plan_code: str
    quota_limit_bytes: int
    quota_used_bytes: int


class BillingStarsInvoiceRequest(BaseModel):
    plan_code: str


class BillingStarsInvoiceResponse(BaseModel):
    plan_code: str
    invoice_link: str
    stars_amount: int
    period_days: int


class BillingAdminGrantRequest(BaseModel):
    telegram_id: int
    plan_code: str
    days: int = Field(default=30, ge=1, le=3650)
    source: str = "manual"
    provider_payment_id: str | None = None


class BillingAdminGrantResponse(BaseModel):
    subscription_id: int
    telegram_id: int
    plan_code: str
    status: str
    expires_at: datetime | None = None
    user_plan_code: str


class BillingSubscriptionSweepResponse(BaseModel):
    expired_subscriptions: int
    users_switched_to_free: int
    users_switched_to_paid: int
    reminders_sent_3d: int
    reminders_sent_1d: int
    expired_notices_sent: int
