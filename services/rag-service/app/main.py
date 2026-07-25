"""Authenticated loopback contract for optional exercise retrieval."""

from __future__ import annotations

import hmac
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.config import Settings, get_settings
from app.engine import (
    IndexRepository,
    IndexUnavailableError,
    LineageMismatchError,
)

CONTRACT_VERSION = "2"
repository: IndexRepository | None = None
settings: Settings | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global repository, settings
    settings = get_settings()
    repository = IndexRepository(settings)
    yield
    repository = None
    settings = None


app = FastAPI(
    title="AImauta internal exercise RAG",
    version=CONTRACT_VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


@app.middleware("http")
async def response_contract(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        configured = settings.service_secret if settings is not None else ""
        provided = request.headers.get("authorization", "")
        expected = f"Bearer {configured}"
        if not configured or not hmac.compare_digest(provided, expected):
            response: Response = JSONResponse(
                status_code=401,
                content={"detail": "Unauthorized"},
            )
        else:
            response = await call_next(request)
    else:
        response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Aimauta-Rag-Contract"] = CONTRACT_VERSION
    return response


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RetrieveRequest(StrictModel):
    book_id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=160)
    source_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    curriculum_version: str = Field(min_length=1, max_length=80)
    exercise_id: str = Field(
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
        max_length=160,
    )
    exercise_revision: int = Field(ge=1, le=2_147_483_647)
    required_anchor: str = Field(min_length=3, max_length=2_000)
    required_anchor_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    region_ids: list[str] = Field(min_length=1, max_length=64)
    page: int = Field(ge=1, le=10_000)
    allowed_pages: list[int] = Field(min_length=1, max_length=32)
    unit_id: str = Field(
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
        max_length=160,
    )
    stage: Literal["learn", "practice"]
    query: str = Field(max_length=3_500)
    top_k: int = Field(default=3, ge=1, le=3)

    @field_validator("required_anchor")
    @classmethod
    def clean_anchor(cls, value: str) -> str:
        if value != value.strip():
            raise ValueError("required_anchor must be canonical")
        return value

    @field_validator("query")
    @classmethod
    def clean_query(cls, value: str) -> str:
        return value.strip()

    @field_validator("region_ids")
    @classmethod
    def validate_regions(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("region_ids must be unique")
        return value

    @model_validator(mode="after")
    def validate_page_scope(self):
        if self.allowed_pages != sorted(set(self.allowed_pages)):
            raise ValueError("allowed_pages must be sorted and unique")
        if self.page not in self.allowed_pages:
            raise ValueError("page must be inside allowed_pages")
        return self


class SourceResponse(StrictModel):
    id: str
    exercise_id: str
    exercise_revision: int
    required_anchor_digest: str
    page: int
    text: str
    kind: Literal["content", "exercise", "instruction"]
    stage: Literal["learn", "practice"]
    unit_id: str
    score: float


class RetrieveResponse(StrictModel):
    schema_version: Literal[2] = 2
    book_id: str
    source_sha256: str
    curriculum_version: str
    exercise_id: str
    exercise_revision: int
    required_anchor_digest: str
    region_ids: list[str]
    sources: list[SourceResponse]


def active_repository() -> IndexRepository:
    if repository is None:
        raise HTTPException(status_code=503, detail="RAG service is not ready")
    return repository


@app.get("/health")
def health() -> dict[str, object]:
    # Liveness is independent from optional index availability. Missing or
    # malformed indexes fail each retrieval closed without restarting the web.
    return {"status": "ok", "schema_version": 2}


@app.post("/api/v2/retrieve", response_model=RetrieveResponse)
def retrieve(payload: RetrieveRequest) -> RetrieveResponse:
    try:
        result = active_repository().retrieve(
            book_id=payload.book_id,
            source_sha256=payload.source_sha256,
            curriculum_version=payload.curriculum_version,
            exercise_id=payload.exercise_id,
            exercise_revision=payload.exercise_revision,
            required_anchor=payload.required_anchor,
            required_anchor_digest=payload.required_anchor_digest,
            region_ids=tuple(payload.region_ids),
            page=payload.page,
            allowed_pages=tuple(payload.allowed_pages),
            unit_id=payload.unit_id,
            stage=payload.stage,
            query=payload.query,
            top_k=payload.top_k,
        )
    except LineageMismatchError as error:
        raise HTTPException(status_code=409, detail="RAG lineage mismatch") from error
    except IndexUnavailableError as error:
        raise HTTPException(status_code=404, detail="RAG scope unavailable") from error

    return RetrieveResponse(
        book_id=result.book_id,
        source_sha256=result.source_sha256,
        curriculum_version=result.curriculum_version,
        exercise_id=result.exercise_id,
        exercise_revision=result.exercise_revision,
        required_anchor_digest=result.required_anchor_digest,
        region_ids=list(result.region_ids),
        sources=[
            SourceResponse(
                id=source.identifier,
                exercise_id=result.exercise_id,
                exercise_revision=result.exercise_revision,
                required_anchor_digest=result.required_anchor_digest,
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
