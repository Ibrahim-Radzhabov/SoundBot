import hashlib
import hmac
import json
import logging
import time
from typing import Any
from urllib.parse import parse_qsl

import jwt
from fastapi import Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from .db.models import User
from .db.session import get_db
from .settings import settings

logger = logging.getLogger("auth")


def _parse_init_data(init_data: str) -> dict[str, str]:
    return dict(parse_qsl(init_data, keep_blank_values=True))


def _calc_hash(data_check_string: str) -> str:
    secret = hmac.new(b"WebAppData", settings.telegram_bot_token.encode(), hashlib.sha256).digest()
    h = hmac.new(secret, msg=data_check_string.encode(), digestmod=hashlib.sha256)
    return h.hexdigest()


def verify_init_data(init_data: str) -> dict[str, str]:
    data = _parse_init_data(init_data)
    if "hash" not in data:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing hash")

    received_hash = data.pop("hash")
    pairs = [f"{k}={data[k]}" for k in sorted(data.keys())]
    data_check_string = "\n".join(pairs)
    calculated_hash = _calc_hash(data_check_string)

    if not hmac.compare_digest(calculated_hash, received_hash):
        logger.warning("initData hash mismatch")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid initData")

    if "auth_date" in data:
        try:
            auth_date = int(data["auth_date"])
            if time.time() - auth_date > 60 * 60 * 24:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="initData expired")
        except ValueError:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid auth_date")

    return data


def create_jwt(telegram_id: int) -> str:
    token_payload = {
        "sub": str(telegram_id),
        "exp": int(time.time()) + settings.jwt_exp_minutes * 60,
    }
    return jwt.encode(token_payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_jwt(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc


def decode_user(init_data: dict[str, str]) -> dict[str, Any]:
    user_str = init_data.get("user")
    if not user_str:
        return {}
    try:
        return json.loads(user_str)
    except json.JSONDecodeError:
        return {}


def extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token


def get_current_user(
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None, alias="Authorization"),
    token: str | None = Query(default=None),
) -> User:
    jwt_token = token or extract_bearer_token(authorization)
    if not jwt_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")

    payload = decode_jwt(jwt_token)
    sub = payload.get("sub")
    if sub is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    try:
        telegram_id = int(sub)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject") from exc

    user = (
        db.query(User)
        .options(joinedload(User.plan))
        .filter(User.telegram_id == telegram_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user
