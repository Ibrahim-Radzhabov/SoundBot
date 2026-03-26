import json
import shutil
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .settings import settings


class TelegramApiError(RuntimeError):
    pass


def _require_bot_token() -> str:
    token = settings.telegram_bot_token.strip()
    if not token or token == "dev-bot-token":
        raise TelegramApiError("Telegram bot token is not configured")
    return token


def get_file_path(file_id: str) -> str:
    token = _require_bot_token()
    url = f"https://api.telegram.org/bot{token}/getFile?{urlencode({'file_id': file_id})}"
    try:
        with urlopen(url, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError) as exc:
        raise TelegramApiError("Failed to call Telegram getFile") from exc
    except json.JSONDecodeError as exc:
        raise TelegramApiError("Invalid JSON from Telegram getFile") from exc

    if not payload.get("ok"):
        raise TelegramApiError(payload.get("description") or "Telegram getFile failed")
    result = payload.get("result") or {}
    file_path = result.get("file_path")
    if not file_path:
        raise TelegramApiError("Telegram getFile response has no file_path")
    return str(file_path)


def download_file(file_id: str, destination: Path) -> None:
    token = _require_bot_token()
    file_path = get_file_path(file_id)
    download_url = f"https://api.telegram.org/file/bot{token}/{file_path}"

    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = destination.with_suffix(f"{destination.suffix}.part")
    try:
        with urlopen(download_url, timeout=120) as response, tmp_path.open("wb") as out:
            shutil.copyfileobj(response, out, length=1024 * 256)
    except (HTTPError, URLError, TimeoutError) as exc:
        if tmp_path.exists():
            tmp_path.unlink()
        raise TelegramApiError("Failed to download Telegram file") from exc

    tmp_path.replace(destination)


def create_invoice_link(
    *,
    title: str,
    description: str,
    payload: str,
    currency: str,
    amount: int,
    provider_token: str | None = None,
) -> str:
    token = _require_bot_token()
    url = f"https://api.telegram.org/bot{token}/createInvoiceLink"
    body = {
        "title": title,
        "description": description,
        "payload": payload,
        "currency": currency,
        "prices": json.dumps([{"label": title[:32] or "Subscription", "amount": int(amount)}]),
    }
    if provider_token:
        body["provider_token"] = provider_token

    req = Request(url, data=urlencode(body).encode("utf-8"), method="POST")
    try:
        with urlopen(req, timeout=20) as response:
            payload_json = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError) as exc:
        raise TelegramApiError("Failed to call Telegram createInvoiceLink") from exc
    except json.JSONDecodeError as exc:
        raise TelegramApiError("Invalid JSON from Telegram createInvoiceLink") from exc

    if not payload_json.get("ok"):
        raise TelegramApiError(payload_json.get("description") or "Telegram createInvoiceLink failed")

    invoice_link = payload_json.get("result")
    if not invoice_link:
        raise TelegramApiError("Telegram createInvoiceLink response has no result")
    return str(invoice_link)


def answer_pre_checkout_query(*, pre_checkout_query_id: str, ok: bool, error_message: str | None = None) -> None:
    token = _require_bot_token()
    url = f"https://api.telegram.org/bot{token}/answerPreCheckoutQuery"
    body = {
        "pre_checkout_query_id": pre_checkout_query_id,
        "ok": "true" if ok else "false",
    }
    if error_message:
        body["error_message"] = error_message

    req = Request(url, data=urlencode(body).encode("utf-8"), method="POST")
    try:
        with urlopen(req, timeout=20) as response:
            payload_json = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError) as exc:
        raise TelegramApiError("Failed to call Telegram answerPreCheckoutQuery") from exc
    except json.JSONDecodeError as exc:
        raise TelegramApiError("Invalid JSON from Telegram answerPreCheckoutQuery") from exc

    if not payload_json.get("ok"):
        raise TelegramApiError(payload_json.get("description") or "Telegram answerPreCheckoutQuery failed")


def send_message(*, chat_id: int, text: str) -> None:
    token = _require_bot_token()
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    body = {
        "chat_id": str(chat_id),
        "text": text[:4000],
    }

    req = Request(url, data=urlencode(body).encode("utf-8"), method="POST")
    try:
        with urlopen(req, timeout=20) as response:
            payload_json = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError) as exc:
        raise TelegramApiError("Failed to call Telegram sendMessage") from exc
    except json.JSONDecodeError as exc:
        raise TelegramApiError("Invalid JSON from Telegram sendMessage") from exc

    if not payload_json.get("ok"):
        raise TelegramApiError(payload_json.get("description") or "Telegram sendMessage failed")
