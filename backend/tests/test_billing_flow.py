import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.billing_core import build_invoice_payload, get_stars_plan_offer, sweep_subscriptions
from app.db.base import Base
from app.db.models import Plan, User, UserSubscription
from app.telegram import telegram_webhook


class BillingFlowTests(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
        Base.metadata.create_all(engine)
        self.db = Session()

        self.free = Plan(code="free", name="Free", quota_limit_bytes=314_572_800)
        self.plus = Plan(code="plus", name="Plus", quota_limit_bytes=2_147_483_648)
        self.pro = Plan(code="pro", name="Pro", quota_limit_bytes=5_368_709_120)
        self.db.add_all([self.free, self.plus, self.pro])
        self.db.commit()
        self.db.refresh(self.free)
        self.db.refresh(self.plus)
        self.db.refresh(self.pro)

    def tearDown(self) -> None:
        self.db.close()

    def _now(self) -> datetime:
        return datetime.now(UTC).replace(tzinfo=None)

    def test_pre_checkout_query_validates_payload(self) -> None:
        offer = get_stars_plan_offer("plus")
        assert offer is not None
        payload = build_invoice_payload(
            telegram_id=100001,
            plan_code="plus",
            stars_amount=offer.stars_amount,
            period_days=offer.period_days,
        )

        update = {
            "pre_checkout_query": {
                "id": "pcq-1",
                "from": {"id": 100001},
                "currency": "XTR",
                "total_amount": offer.stars_amount,
                "invoice_payload": payload,
            }
        }

        with patch("app.telegram.answer_pre_checkout_query") as mocked_answer:
            response = telegram_webhook(update, db=self.db, secret_token=None)

        self.assertEqual(response["status"], "pre_checkout_ok")
        self.assertTrue(mocked_answer.called)
        kwargs = mocked_answer.call_args.kwargs
        self.assertEqual(kwargs["pre_checkout_query_id"], "pcq-1")
        self.assertTrue(kwargs["ok"])

    def test_successful_payment_creates_subscription_and_switches_plan(self) -> None:
        offer = get_stars_plan_offer("plus")
        assert offer is not None
        payload = build_invoice_payload(
            telegram_id=100001,
            plan_code="plus",
            stars_amount=offer.stars_amount,
            period_days=offer.period_days,
        )

        update = {
            "message": {
                "message_id": 1,
                "chat": {"id": 100001},
                "from": {"id": 100001},
                "successful_payment": {
                    "currency": "XTR",
                    "total_amount": offer.stars_amount,
                    "invoice_payload": payload,
                    "telegram_payment_charge_id": "tg-charge-1",
                },
            }
        }

        with patch("app.telegram.send_message") as mocked_send:
            response = telegram_webhook(update, db=self.db, secret_token=None)

        self.assertEqual(response["status"], "payment_success")
        self.assertTrue(mocked_send.called)

        user = self.db.query(User).filter(User.telegram_id == 100001).first()
        self.assertIsNotNone(user)
        assert user is not None
        self.assertEqual(user.plan_id, self.plus.id)

        subscription = (
            self.db.query(UserSubscription)
            .filter(
                UserSubscription.user_id == user.id,
                UserSubscription.plan_code == "plus",
                UserSubscription.status == "active",
            )
            .first()
        )
        self.assertIsNotNone(subscription)

    def test_sweep_expires_and_notifies(self) -> None:
        user_expiring = User(telegram_id=200001, plan_id=self.free.id, quota_used_bytes=0)
        user_expired = User(telegram_id=200002, plan_id=self.pro.id, quota_used_bytes=0)
        self.db.add_all([user_expiring, user_expired])
        self.db.commit()
        self.db.refresh(user_expiring)
        self.db.refresh(user_expired)

        self.db.add_all(
            [
                UserSubscription(
                    user_id=user_expiring.id,
                    plan_code="plus",
                    status="active",
                    expires_at=self._now() + timedelta(days=2),
                    source="manual",
                ),
                UserSubscription(
                    user_id=user_expired.id,
                    plan_code="pro",
                    status="active",
                    expires_at=self._now() - timedelta(days=1),
                    source="manual",
                ),
            ]
        )
        self.db.commit()

        sent_messages: list[tuple[int, str]] = []

        def notifier(chat_id: int, text: str) -> bool:
            sent_messages.append((chat_id, text))
            return True

        result = sweep_subscriptions(self.db, notifier=notifier)

        self.assertEqual(result["expired_subscriptions"], 1)
        self.assertEqual(result["users_switched_to_free"], 1)
        self.assertEqual(result["users_switched_to_paid"], 1)
        self.assertEqual(result["reminders_sent_3d"], 1)
        self.assertEqual(result["reminders_sent_1d"], 0)
        self.assertEqual(result["expired_notices_sent"], 1)
        self.assertGreaterEqual(len(sent_messages), 2)

        user_expiring_after = self.db.query(User).filter(User.id == user_expiring.id).first()
        user_expired_after = self.db.query(User).filter(User.id == user_expired.id).first()
        assert user_expiring_after is not None
        assert user_expired_after is not None
        self.assertEqual(user_expiring_after.plan_id, self.plus.id)
        self.assertEqual(user_expired_after.plan_id, self.free.id)


if __name__ == "__main__":
    unittest.main()
