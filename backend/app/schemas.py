from pydantic import BaseModel
from typing import List


class AuthRequest(BaseModel):
    init_data: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TrackItem(BaseModel):
    id: str
    title: str
    artist: str
    duration: int
    cover_url: str
    stream_url: str


class TrackList(BaseModel):
    items: List[TrackItem]
