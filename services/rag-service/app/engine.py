"""Validated lexical retrieval over AImauta's versioned book indexes.

Marcelo's prototype established the separate FastAPI service boundary. The
production service deliberately consumes AImauta's already classified index
files instead of arbitrary PDFs: that preserves checksum/curriculum lineage and
lets the online path exclude teacher-only and assessment content.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.config import Settings

BOOK_INDEX_VERSION = 2
INDEX_EXTRACTOR_VERSION = "aimauta-pdf-parse-2.4.5-chunker-2"
MAX_CHUNKS_PER_PAGE = 50
MAX_CHUNK_TEXT_LENGTH = 50_000
MAX_CHUNK_ID_LENGTH = 240
SAFE_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
ALLOWED_KINDS = frozenset({"content", "exercise", "instruction"})
ALLOWED_STAGES = frozenset({"orientation", "learn", "practice", "assessment"})
TUTOR_STAGES = frozenset({"learn", "practice"})


class IndexUnavailableError(RuntimeError):
    """Raised when an index is absent or fails structural validation."""


class LineageMismatchError(RuntimeError):
    """Raised when the caller and persisted index describe different content."""


@dataclass(frozen=True)
class Chunk:
    identifier: str
    page: int
    text: str
    kind: str
    teacher_only: bool
    stage: str
    unit_id: str | None


@dataclass(frozen=True)
class BookIndex:
    book_id: str
    source_sha256: str
    curriculum_version: str
    page_count: int
    chunks: tuple[Chunk, ...]


@dataclass(frozen=True)
class RetrievedSource:
    identifier: str
    page: int
    text: str
    kind: str
    stage: str
    unit_id: str
    score: float


@dataclass(frozen=True)
class RetrievalResult:
    book_id: str
    source_sha256: str
    curriculum_version: str
    sources: tuple[RetrievedSource, ...]


@dataclass(frozen=True)
class CacheEntry:
    mtime_ns: int
    ctime_ns: int
    inode: int
    size: int
    index: BookIndex


def _is_positive_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _record(value: object) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    return "".join(
        character
        for character in decomposed
        if unicodedata.category(character) != "Mn"
    ).lower()


def _tokens(value: str) -> set[str]:
    return {
        token
        for token in re.split(r"[^\w]+", _normalize(value), flags=re.UNICODE)
        if len(token) >= 3
    }


class IndexRepository:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._cache: dict[str, CacheEntry] = {}

    def _path(self, book_id: str) -> Path:
        if not SAFE_ID.fullmatch(book_id):
            raise IndexUnavailableError("invalid book id")
        candidate = (self.settings.index_dir / f"{book_id}.json").resolve()
        if candidate.parent != self.settings.index_dir:
            raise IndexUnavailableError("invalid index path")
        return candidate

    def _parse_chunk(
        self,
        raw: object,
        *,
        page_count: int,
        identifiers: set[str],
        chunks_per_page: dict[int, int],
    ) -> Chunk:
        item = _record(raw)
        if item is None:
            raise IndexUnavailableError("invalid chunk")

        identifier = item.get("id")
        page = item.get("page")
        text = item.get("text")
        kind = item.get("kind")
        teacher_only = item.get("teacherOnly")
        stage = item.get("stage")
        unit_id = item.get("unitId")

        if (
            not isinstance(identifier, str)
            or not identifier
            or len(identifier) > MAX_CHUNK_ID_LENGTH
            or identifier in identifiers
        ):
            raise IndexUnavailableError("invalid chunk id")
        if not _is_positive_integer(page) or page > page_count:
            raise IndexUnavailableError("invalid chunk page")
        if (
            not isinstance(text, str)
            or not text
            or len(text) > MAX_CHUNK_TEXT_LENGTH
            or text != text.strip()
        ):
            raise IndexUnavailableError("invalid chunk text")
        if kind not in ALLOWED_KINDS:
            raise IndexUnavailableError("invalid chunk kind")
        if not isinstance(teacher_only, bool):
            raise IndexUnavailableError("invalid teacher-only marker")
        if stage not in ALLOWED_STAGES:
            raise IndexUnavailableError("invalid chunk stage")
        if unit_id is not None and (
            not isinstance(unit_id, str) or not SAFE_ID.fullmatch(unit_id)
        ):
            raise IndexUnavailableError("invalid chunk unit")

        count = chunks_per_page.get(page, 0) + 1
        if count > MAX_CHUNKS_PER_PAGE:
            raise IndexUnavailableError("too many chunks on one page")
        chunks_per_page[page] = count
        identifiers.add(identifier)
        return Chunk(
            identifier=identifier,
            page=page,
            text=text,
            kind=kind,
            teacher_only=teacher_only,
            stage=stage,
            unit_id=unit_id,
        )

    def _parse_index(self, raw: object, expected_book_id: str) -> BookIndex:
        document = _record(raw)
        if (
            document is None
            or document.get("version") != BOOK_INDEX_VERSION
            or document.get("extractorVersion") != INDEX_EXTRACTOR_VERSION
        ):
            raise IndexUnavailableError("unsupported index")

        book_id = document.get("bookId")
        source_sha256 = document.get("sourceSha256")
        page_count = document.get("pageCount")
        curriculum = _record(document.get("curriculum"))
        raw_chunks = document.get("chunks")
        if book_id != expected_book_id:
            raise IndexUnavailableError("book mismatch")
        if not isinstance(source_sha256, str) or not SHA256.fullmatch(source_sha256):
            raise IndexUnavailableError("invalid source checksum")
        if not _is_positive_integer(page_count):
            raise IndexUnavailableError("invalid page count")
        if (
            curriculum is None
            or not isinstance(curriculum.get("version"), str)
            or not curriculum["version"].strip()
            or len(curriculum["version"]) > 80
        ):
            raise IndexUnavailableError("invalid curriculum lineage")
        if (
            not isinstance(raw_chunks, list)
            or len(raw_chunks) > page_count * MAX_CHUNKS_PER_PAGE
        ):
            raise IndexUnavailableError("invalid chunk collection")

        identifiers: set[str] = set()
        chunks_per_page: dict[int, int] = {}
        chunks = tuple(
            self._parse_chunk(
                item,
                page_count=page_count,
                identifiers=identifiers,
                chunks_per_page=chunks_per_page,
            )
            for item in raw_chunks
        )
        return BookIndex(
            book_id=book_id,
            source_sha256=source_sha256,
            curriculum_version=curriculum["version"],
            page_count=page_count,
            chunks=chunks,
        )

    def load(self, book_id: str) -> BookIndex:
        path = self._path(book_id)
        try:
            before = path.stat()
        except OSError as error:
            raise IndexUnavailableError("index not found") from error
        if (
            not path.is_file()
            or before.st_size <= 0
            or before.st_size > self.settings.max_index_bytes
        ):
            raise IndexUnavailableError("invalid index file")

        cached = self._cache.get(book_id)
        if (
            cached is not None
            and cached.mtime_ns == before.st_mtime_ns
            and cached.ctime_ns == before.st_ctime_ns
            and cached.inode == before.st_ino
            and cached.size == before.st_size
        ):
            self._cache.pop(book_id)
            self._cache[book_id] = cached
            return cached.index

        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            after = path.stat()
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise IndexUnavailableError("index cannot be read") from error
        if (
            before.st_mtime_ns != after.st_mtime_ns
            or before.st_size != after.st_size
            or not path.is_file()
        ):
            raise IndexUnavailableError("index changed while reading")

        index = self._parse_index(raw, book_id)
        if (
            len(self._cache) >= self.settings.max_cache_entries
            and book_id not in self._cache
        ):
            oldest = next(iter(self._cache))
            self._cache.pop(oldest)
        self._cache.pop(book_id, None)
        self._cache[book_id] = CacheEntry(
            mtime_ns=after.st_mtime_ns,
            ctime_ns=after.st_ctime_ns,
            inode=after.st_ino,
            size=after.st_size,
            index=index,
        )
        return index

    def list_books(self) -> tuple[BookIndex, ...]:
        try:
            candidates = sorted(self.settings.index_dir.glob("*.json"))
        except OSError as error:
            raise IndexUnavailableError("index directory unavailable") from error
        books: list[BookIndex] = []
        for candidate in candidates:
            if SAFE_ID.fullmatch(candidate.stem):
                books.append(self.load(candidate.stem))
        return tuple(books)

    def retrieve(
        self,
        *,
        book_id: str,
        source_sha256: str,
        curriculum_version: str,
        page: int,
        allowed_pages: tuple[int, ...],
        unit_id: str,
        stage: str,
        query: str,
        top_k: int,
    ) -> RetrievalResult:
        index = self.load(book_id)
        if (
            index.source_sha256 != source_sha256
            or index.curriculum_version != curriculum_version
        ):
            raise LineageMismatchError("index lineage mismatch")
        if (
            page > index.page_count
            or stage not in TUTOR_STAGES
            or not SAFE_ID.fullmatch(unit_id)
        ):
            raise IndexUnavailableError("invalid curricular scope")

        allowed = set(allowed_pages)
        if (
            not allowed
            or page not in allowed
            or any(
                not _is_positive_integer(candidate)
                or candidate > index.page_count
                for candidate in allowed
            )
        ):
            raise IndexUnavailableError("invalid page scope")

        query_tokens = _tokens(query)
        scored: list[tuple[float, Chunk]] = []
        for chunk in index.chunks:
            if (
                chunk.teacher_only
                or chunk.stage != stage
                or chunk.unit_id != unit_id
                or chunk.page not in allowed
            ):
                continue
            chunk_tokens = _tokens(chunk.text)
            lexical_matches = len(query_tokens.intersection(chunk_tokens))
            distance = abs(chunk.page - page)
            page_score = 5.0 if distance == 0 else 2.5 if distance == 1 else 1.0
            lexical_score = (
                0.0
                if not query_tokens
                else (lexical_matches / len(query_tokens)) * 8.0
            )
            kind_boost = 0.5 if chunk.kind == "exercise" else 0.0
            score = page_score + lexical_score + kind_boost
            if score > 0:
                scored.append((score, chunk))

        scored.sort(key=lambda item: (-item[0], abs(item[1].page - page), item[1].identifier))
        sources = tuple(
            RetrievedSource(
                identifier=chunk.identifier,
                page=chunk.page,
                text=chunk.text[: self.settings.max_response_text_chars],
                kind=chunk.kind,
                stage=chunk.stage,
                unit_id=unit_id,
                score=round(score, 6),
            )
            for score, chunk in scored[:top_k]
        )
        return RetrievalResult(
            book_id=index.book_id,
            source_sha256=index.source_sha256,
            curriculum_version=index.curriculum_version,
            sources=sources,
        )
