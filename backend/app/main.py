import logging
from pathlib import Path
from typing import Iterator

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .auth import verify_init_data, create_jwt
from .schemas import AuthRequest, AuthResponse
from .tracks import router as tracks_router
from .database import TRACKS
from .settings import settings

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


@app.post("/auth", response_model=AuthResponse)
async def auth(payload: AuthRequest):
    data = verify_init_data(payload.init_data)
    token = create_jwt(data)
    return AuthResponse(access_token=token)


@app.get("/stream/{track_id}")
async def stream(track_id: str):
    track = next((t for t in TRACKS if t.id == track_id), None)
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    file_path = Path(__file__).resolve().parent.parent / "media" / f"{track_id}.mp3"
    if not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media missing")

    def iterfile() -> Iterator[bytes]:
        with open(file_path, "rb") as f:
            while True:
                chunk = f.read(1024 * 512)
                if not chunk:
                    break
                yield chunk

    return StreamingResponse(iterfile(), media_type="audio/mpeg")
