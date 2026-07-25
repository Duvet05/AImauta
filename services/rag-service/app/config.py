"""Fail-closed runtime settings for the internal RAG service."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    index_dir: Path
    max_index_bytes: int = 64 * 1024 * 1024
    max_response_text_chars: int = 1_200
    max_cache_entries: int = 32


def get_settings() -> Settings:
    raw_index_dir = os.getenv(
        "AIMAUTA_INDEX_DIR",
        "/srv/aimauta/indexes",
    ).strip()
    index_dir = Path(raw_index_dir)
    if not index_dir.is_absolute():
        raise RuntimeError("AIMAUTA_INDEX_DIR must be an absolute path")
    return Settings(index_dir=index_dir.resolve())
