import logging
import asyncio
from pathlib import Path
from typing import Iterator

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session, joinedload

from .auth import create_jwt, decode_user, get_current_user, verify_init_data
from .billing import router as billing_router
from .billing_core import sweep_subscriptions
from .db.models import Track, User
from .db.session import SessionLocal, get_db
from .schemas import AuthRequest, AuthResponse
from .settings import settings
from .telegram import router as telegram_router
from .telegram_api import TelegramApiError, download_file, send_message
from .tracks import router as tracks_router
from .user_service import get_or_create_user

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

app = FastAPI(title="Telegram Music Mini App")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(",") if settings.cors_origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tracks_router)
app.include_router(telegram_router)
app.include_router(billing_router)

STREAM_CHUNK_SIZE = 1024 * 512

DEMO_TRACKS = [
    {
        "title": "Neon Drift",
        "artist": "Synth Avenue",
        "duration_sec": 214,
        "telegram_file_id": "demo-file-1",
        "telegram_unique_id": "demo-unique-1",
        "file_name": "1.mp3",
    },
    {
        "title": "Pulse Runner",
        "artist": "Violet Echo",
        "duration_sec": 198,
        "telegram_file_id": "demo-file-2",
        "telegram_unique_id": "demo-unique-2",
        "file_name": "2.mp3",
    },
    {
        "title": "Midnight Bloom",
        "artist": "Aurora Lake",
        "duration_sec": 236,
        "telegram_file_id": "demo-file-3",
        "telegram_unique_id": "demo-unique-3",
        "file_name": "3.mp3",
    },
]


def _run_billing_sweep_once() -> None:
    def notify(telegram_id: int, text: str) -> bool:
        try:
            send_message(chat_id=telegram_id, text=text)
            return True
        except TelegramApiError:
            logger.exception("billing notification failed for user %s", telegram_id)
            return False

    db = SessionLocal()
    try:
        result = sweep_subscriptions(db, notifier=notify)
        if any(value > 0 for value in result.values()):
            logger.info(
                "billing sweep: expired=%s switched_free=%s switched_paid=%s remind3d=%s remind1d=%s expired_notice=%s",
                result["expired_subscriptions"],
                result["users_switched_to_free"],
                result["users_switched_to_paid"],
                result["reminders_sent_3d"],
                result["reminders_sent_1d"],
                result["expired_notices_sent"],
            )
    except Exception:
        logger.exception("billing sweep failed")
    finally:
        db.close()


async def _billing_sweep_loop() -> None:
    interval = max(settings.billing_sweep_interval_sec, 60)
    while True:
        _run_billing_sweep_once()
        await asyncio.sleep(interval)


@app.on_event("startup")
async def on_startup() -> None:
    if not settings.billing_sweep_enabled:
        return
    app.state.billing_sweep_task = asyncio.create_task(_billing_sweep_loop())


@app.on_event("shutdown")
async def on_shutdown() -> None:
    task = getattr(app.state, "billing_sweep_task", None)
    if not task:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


def _parse_byte_range(range_header: str, file_size: int) -> tuple[int, int]:
    if not range_header.startswith("bytes="):
        raise ValueError("Invalid range unit")

    start_raw, sep, end_raw = range_header[6:].partition("-")
    if sep != "-":
        raise ValueError("Invalid range format")

    if not start_raw and not end_raw:
        raise ValueError("Empty range")

    if start_raw:
        start = int(start_raw)
        end = int(end_raw) if end_raw else file_size - 1
    else:
        suffix_len = int(end_raw)
        if suffix_len <= 0:
            raise ValueError("Invalid suffix range")
        start = max(file_size - suffix_len, 0)
        end = file_size - 1

    if start < 0 or start >= file_size:
        raise ValueError("Range start out of bounds")
    if end < start:
        raise ValueError("Range end before start")

    end = min(end, file_size - 1)
    return start, end


def _iter_file_range(file_path: Path, start: int, end: int) -> Iterator[bytes]:
    with file_path.open("rb") as file:
        file.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = file.read(min(STREAM_CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def _media_root() -> Path:
    return Path(__file__).resolve().parent.parent / "media"


def _cache_root() -> Path:
    root = Path(settings.media_cache_dir)
    if not root.is_absolute():
        root = Path(__file__).resolve().parent.parent / root
    root.mkdir(parents=True, exist_ok=True)
    return root


def _resolve_demo_file(track: Track) -> Path | None:
    if not track.telegram_file_id.startswith("demo-file-"):
        return None
    file_name = track.file_name or f"{track.id}.mp3"
    candidate = _media_root() / file_name
    if candidate.exists():
        return candidate
    return None


def _cache_file_path(track: Track) -> Path:
    suffix = Path(track.file_name or "").suffix
    if not suffix:
        suffix = ".mp3" if (track.mime or "").startswith("audio/") else ".bin"
    return _cache_root() / str(track.owner_user_id) / f"{track.id}{suffix}"


def _resolve_track_file(track: Track) -> Path:
    demo_file = _resolve_demo_file(track)
    if demo_file:
        return demo_file

    local_path = _cache_file_path(track)
    if local_path.exists():
        return local_path

    try:
        download_file(track.telegram_file_id, local_path)
    except TelegramApiError as exc:
        logger.exception("failed to fetch track %s from telegram", track.id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to fetch media from Telegram",
        ) from exc

    if not local_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media missing")
    return local_path


def _seed_demo_tracks_if_needed(db: Session, user: User) -> None:
    if db.query(Track.id).filter(Track.owner_user_id == user.id).first():
        return

    if not user.plan:
        return

    plan_limit = user.plan.quota_limit_bytes
    next_usage = user.quota_used_bytes
    tracks_to_add: list[Track] = []
    for item in DEMO_TRACKS:
        file_path = _media_root() / item["file_name"]
        if not file_path.exists():
            continue
        size_bytes = file_path.stat().st_size
        if next_usage + size_bytes > plan_limit:
            break
        next_usage += size_bytes
        tracks_to_add.append(
            Track(
                owner_user_id=user.id,
                telegram_file_id=item["telegram_file_id"],
                telegram_unique_id=item["telegram_unique_id"],
                title=item["title"],
                artist=item["artist"],
                duration_sec=item["duration_sec"],
                size_bytes=size_bytes,
                mime="audio/mpeg",
                file_name=item["file_name"],
            )
        )

    if not tracks_to_add:
        return

    db.add_all(tracks_to_add)
    user.quota_used_bytes = next_usage
    db.commit()


@app.post("/auth", response_model=AuthResponse)
def auth(payload: AuthRequest, db: Session = Depends(get_db)):
    init_data = payload.init_data.strip()
    if init_data:
        data = verify_init_data(init_data)
        user_payload = decode_user(data)
        telegram_id = user_payload.get("id")
        if telegram_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing user id in initData")
    else:
        if not settings.dev_auth_enabled:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="initData required")
        telegram_id = settings.dev_telegram_id

    try:
        telegram_id_int = int(telegram_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user id in initData") from exc

    user = get_or_create_user(db, telegram_id_int)
    _seed_demo_tracks_if_needed(db, user)
    user = db.query(User).options(joinedload(User.plan)).filter(User.id == user.id).first()
    if not user or not user.plan:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="User load failed")

    token = create_jwt(user.telegram_id)
    return AuthResponse(
        access_token=token,
        plan_code=user.plan.code,
        quota_limit_bytes=user.plan.quota_limit_bytes,
        quota_used_bytes=user.quota_used_bytes,
    )


@app.get("/stream/{track_id}")
def stream(
    track_id: int,
    range_header: str | None = Header(default=None, alias="Range"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    track = db.query(Track).filter(Track.id == track_id, Track.owner_user_id == current_user.id).first()
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    file_path = _resolve_track_file(track)
    file_size = file_path.stat().st_size

    base_headers = {"Accept-Ranges": "bytes"}
    if not range_header:
        headers = {**base_headers, "Content-Length": str(file_size)}
        return StreamingResponse(
            _iter_file_range(file_path, 0, file_size - 1),
            media_type="audio/mpeg",
            headers=headers,
        )

    try:
        start, end = _parse_byte_range(range_header, file_size)
    except ValueError:
        return Response(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            headers={**base_headers, "Content-Range": f"bytes */{file_size}"},
        )

    headers = {
        **base_headers,
        "Content-Length": str(end - start + 1),
        "Content-Range": f"bytes {start}-{end}/{file_size}",
    }
    return StreamingResponse(
        _iter_file_range(file_path, start, end),
        status_code=status.HTTP_206_PARTIAL_CONTENT,
        media_type="audio/mpeg",
        headers=headers,
    )
