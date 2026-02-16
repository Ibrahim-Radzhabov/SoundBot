import hashlib
import hmac
import json
import logging
import time
from typing import Dict

import jwt
from fastapi import HTTPException, status

from .settings import settings

logger = logging.getLogger("auth")


def _parse_init_data(init_data: str) -> Dict[str, str]:
    data = {}
    for pair in init_data.split("&"):
        if not pair:
            continue
        k, _, v = pair.partition("=")
        data[k] = v
    return data


def _calc_hash(data_check_string: str) -> str:
    secret = hashlib.sha256(settings.telegram_bot_token.encode()).digest()
    h = hmac.new(secret, msg=data_check_string.encode(), digestmod=hashlib.sha256)
    return h.hexdigest()


def verify_init_data(init_data: str) -> Dict[str, str]:
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


def create_jwt(payload: Dict[str, str]) -> str:
    token_payload = {
        "sub": payload.get("user", ""),
        "auth_date": payload.get("auth_date"),
        "exp": int(time.time()) + settings.jwt_exp_minutes * 60,
    }
    return jwt.encode(token_payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_user(init_data: Dict[str, str]) -> Dict[str, str]:
    user_str = init_data.get("user")
    if not user_str:
        return {}
    try:
        return json.loads(user_str)
    except json.JSONDecodeError:
        return {}
