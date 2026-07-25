"""Loopback-only HTTP contract for AImauta retrieval."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.config import get_settings
from app.engine import (
    IndexRepository,
    IndexUnavailableError,
    LineageMismatchError,
)

CONTRACT_VERSION = "1"
repository: IndexRepository | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global repository
    repository = IndexRepository(get_settings())
    yield
    repository = None


app = FastAPI(
    title="AImauta internal RAG",
    version=CONTRACT_VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


@app.middleware("http")
async def response_contract(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Aimauta-Rag-Contract"] = CONTRACT_VERSION
    return response


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RetrieveRequest(StrictModel):
    book_id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=160)
    source_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    curriculum_version: str = Field(min_length=1, max_length=80)
    page: int = Field(ge=1, le=10_000)
    allowed_pages: list[int] = Field(min_length=1, max_length=32)
    unit_id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=160)
    stage: Literal["learn", "practice"]
    query: str = Field(max_length=3_500)
    top_k: int = Field(default=3, ge=1, le=5)

    @field_validator("query")
    @classmethod
    def clean_query(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_page_scope(self):
        if self.allowed_pages != sorted(set(self.allowed_pages)):
            raise ValueError("allowed_pages must be sorted and unique")
        if self.page not in self.allowed_pages:
            raise ValueError("page must be inside allowed_pages")
        return self


class SourceResponse(StrictModel):
    id: str
    page: int
    text: str
    kind: Literal["content", "exercise", "instruction"]
    stage: Literal["learn", "practice"]
    unit_id: str
    score: float


class RetrieveResponse(StrictModel):
    schema_version: Literal[1] = 1
    book_id: str
    source_sha256: str
    curriculum_version: str
    sources: list[SourceResponse]


class BookResponse(StrictModel):
    book_id: str
    source_sha256: str
    curriculum_version: str
    page_count: int


def active_repository() -> IndexRepository:
    if repository is None:
        raise HTTPException(status_code=503, detail="RAG service is not ready")
    return repository


@app.get("/health")
def health() -> dict[str, object]:
    try:
        books = active_repository().list_books()
    except IndexUnavailableError as error:
        raise HTTPException(status_code=503, detail="RAG indexes unavailable") from error
    if not books:
        raise HTTPException(status_code=503, detail="No RAG indexes available")
    return {"status": "ok", "schema_version": 1, "books": len(books)}


@app.get("/api/v1/books", response_model=list[BookResponse])
def list_books() -> list[BookResponse]:
    try:
        books = active_repository().list_books()
    except IndexUnavailableError as error:
        raise HTTPException(status_code=503, detail="RAG indexes unavailable") from error
    return [
        BookResponse(
            book_id=book.book_id,
            source_sha256=book.source_sha256,
            curriculum_version=book.curriculum_version,
            page_count=book.page_count,
        )
        for book in books
    ]


@app.post("/api/v1/retrieve", response_model=RetrieveResponse)
def retrieve(payload: RetrieveRequest) -> RetrieveResponse:
    try:
        result = active_repository().retrieve(
            book_id=payload.book_id,
            source_sha256=payload.source_sha256,
            curriculum_version=payload.curriculum_version,
            page=payload.page,
            allowed_pages=tuple(payload.allowed_pages),
            unit_id=payload.unit_id,
            stage=payload.stage,
            query=payload.query,
            top_k=payload.top_k,
        )
    except LineageMismatchError as error:
        raise HTTPException(status_code=409, detail="RAG index lineage mismatch") from error
    except IndexUnavailableError as error:
        raise HTTPException(status_code=404, detail="RAG scope unavailable") from error

    return RetrieveResponse(
        book_id=result.book_id,
        source_sha256=result.source_sha256,
        curriculum_version=result.curriculum_version,
        sources=[
            SourceResponse(
                id=source.identifier,
                page=source.page,
                text=source.text,
                kind=source.kind,
                stage=source.stage,
                unit_id=source.unit_id,
                score=source.score,
            )
            for source in result.sources
        ],
    )
