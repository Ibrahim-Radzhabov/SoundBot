from typing import List
from .models import Track


TRACKS: List[Track] = [
    Track(
        id="1",
        title="Neon Drift",
        artist="Synth Avenue",
        duration=214,
        cover_url="https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=800&q=80",
        stream_url="/stream/1",
    ),
    Track(
        id="2",
        title="Pulse Runner",
        artist="Violet Echo",
        duration=198,
        cover_url="https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=800&q=80",
        stream_url="/stream/2",
    ),
    Track(
        id="3",
        title="Midnight Bloom",
        artist="Aurora Lake",
        duration=236,
        cover_url="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=800&q=80",
        stream_url="/stream/3",
    ),
]
