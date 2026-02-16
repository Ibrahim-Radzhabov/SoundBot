from typing import Optional
from pydantic import BaseModel


class User(BaseModel):
    id: int
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None


class Track(BaseModel):
    id: str
    title: str
    artist: str
    duration: int
    cover_url: str
    stream_url: str
