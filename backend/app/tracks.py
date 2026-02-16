from fastapi import APIRouter
from .database import TRACKS
from .schemas import TrackList, TrackItem

router = APIRouter()


@router.get("/tracks", response_model=TrackList)
async def list_tracks():
    items = [
        TrackItem(
            id=t.id,
            title=t.title,
            artist=t.artist,
            duration=t.duration,
            cover_url=t.cover_url,
            stream_url=t.stream_url,
        )
        for t in TRACKS
    ]
    return TrackList(items=items)
