import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import get_current_user
from .db.models import Track, User
from .db.session import get_db
from .schemas import TrackDeleteResponse, TrackImportRequest, TrackItem, TrackList
from .settings import settings

router = APIRouter()
logger = logging.getLogger("tracks")

DEFAULT_COVERS = [
    "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=800&q=80",
]


def _cover_for(track_id: int) -> str:
    return DEFAULT_COVERS[track_id % len(DEFAULT_COVERS)]


def _cache_root() -> Path:
    root = Path(settings.media_cache_dir)
    if not root.is_absolute():
        root = Path(__file__).resolve().parent.parent / root
    return root


def _cache_file_path(track: Track) -> Path:
    suffix = Path(track.file_name or "").suffix
    if not suffix:
        suffix = ".mp3" if (track.mime or "").startswith("audio/") else ".bin"
    return _cache_root() / str(track.owner_user_id) / f"{track.id}{suffix}"


def to_track_item(track: Track) -> TrackItem:
    return TrackItem(
        id=str(track.id),
        title=track.title or "Unknown Track",
        artist=track.artist or "Unknown Artist",
        duration=track.duration_sec or 0,
        cover_url=_cover_for(track.id),
        stream_url=f"/stream/{track.id}",
    )


def upsert_user_track(db: Session, current_user: User, payload: TrackImportRequest) -> Track:
    existing = (
        db.query(Track)
        .filter(
            Track.owner_user_id == current_user.id,
            Track.telegram_unique_id == payload.telegram_unique_id,
        )
        .first()
    )
    if existing:
        return existing

    if not current_user.plan:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="User plan missing")

    size_bytes = max(payload.size_bytes or 0, 0)
    quota_limit = current_user.plan.quota_limit_bytes
    next_usage = current_user.quota_used_bytes + size_bytes
    if next_usage > quota_limit:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Quota exceeded for current plan",
        )

    track = Track(
        owner_user_id=current_user.id,
        telegram_file_id=payload.telegram_file_id,
        telegram_unique_id=payload.telegram_unique_id,
        title=payload.title,
        artist=payload.artist,
        duration_sec=payload.duration_sec,
        size_bytes=size_bytes if size_bytes > 0 else None,
        mime=payload.mime,
        file_name=payload.file_name,
    )

    db.add(track)
    if size_bytes > 0:
        current_user.quota_used_bytes = next_usage

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = (
            db.query(Track)
            .filter(
                Track.owner_user_id == current_user.id,
                Track.telegram_unique_id == payload.telegram_unique_id,
            )
            .first()
        )
        if existing:
            return existing
        raise

    db.refresh(track)
    return track


@router.get("/tracks", response_model=TrackList)
def list_tracks(
    since: Annotated[int | None, Query(ge=0)] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Track).filter(Track.owner_user_id == current_user.id)
    if since is not None:
        query = query.filter(Track.id > since)
        tracks = query.order_by(Track.id.asc()).limit(limit).all()
    else:
        tracks = query.order_by(Track.id.asc()).all()
    items = [to_track_item(track) for track in tracks]

    cursor = since or 0
    if tracks:
        cursor = tracks[-1].id

    return TrackList(items=items, cursor=cursor)


@router.post("/tracks/import", response_model=TrackItem)
def import_track(
    payload: TrackImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    track = upsert_user_track(db, current_user, payload)
    return to_track_item(track)


@router.delete("/tracks/{track_id}", response_model=TrackDeleteResponse)
def delete_track(
    track_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    track = db.query(Track).filter(Track.id == track_id, Track.owner_user_id == current_user.id).first()
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    cache_path = _cache_file_path(track)
    size_to_free = max(track.size_bytes or 0, 0)

    db.delete(track)
    if size_to_free > 0:
        current_user.quota_used_bytes = max(current_user.quota_used_bytes - size_to_free, 0)
    db.commit()
    db.refresh(current_user)

    try:
        cache_path.unlink(missing_ok=True)
        parent = cache_path.parent
        if parent.exists() and not any(parent.iterdir()):
            parent.rmdir()
    except OSError:
        logger.warning("failed to remove cached file for deleted track %s", track_id)

    return TrackDeleteResponse(
        deleted_id=str(track_id),
        quota_used_bytes=current_user.quota_used_bytes,
    )
