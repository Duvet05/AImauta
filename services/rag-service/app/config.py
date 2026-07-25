"""Fail-closed runtime settings for the internal RAG service."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

SECRET = re.compile(r"^[A-Za-z0-9_-]{32,256}$")


@dataclass(frozen=True)
class Settings:
    index_dir: Path
    service_secret: str
    max_index_bytes: int = 8 * 1024 * 1024
    max_response_text_chars: int = 1_200
    max_cache_entries: int = 2


def get_settings() -> Settings:
    raw_index_dir = os.getenv(
        "AIMAUTA_INDEX_DIR",
        "/srv/aimauta/indexes",
    ).strip()
    index_dir = Path(raw_index_dir)
    if not index_dir.is_absolute():
        raise RuntimeError("AIMAUTA_INDEX_DIR must be an absolute path")
    service_secret = os.getenv("AIMAUTA_RAG_SERVICE_SECRET", "").strip()
    if not SECRET.fullmatch(service_secret):
        raise RuntimeError(
            "AIMAUTA_RAG_SERVICE_SECRET must be 32-256 URL-safe characters"
        )
    return Settings(
        index_dir=index_dir.resolve(),
        service_secret=service_secret,
    )
