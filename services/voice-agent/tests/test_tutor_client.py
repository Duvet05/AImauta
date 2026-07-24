from json import JSONDecodeError
from typing import Any
from unittest.mock import Mock

import pytest

from aimauta_voice.tutor_client import TutorClient, TutorServiceError


class Response:
    def __init__(self, status: int, payload: Any):
        self.status = status
        self._payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def json(self):
        return self._payload


class InvalidJsonResponse(Response):
    async def json(self):
        raise JSONDecodeError("invalid", "not-json", 0)


@pytest.mark.asyncio
async def test_turn_uses_internal_contract() -> None:
    http = Mock()
    http.post.return_value = Response(
        200,
        {
            "message": "¿Qué dato observarías primero?",
            "sessionToken": "next-token",
            "session": {"hintLevel": 1},
            "activity": {"stage": "practice"},
        },
    )
    client = TutorClient(http, "http://app/api/internal/turn", "s" * 32, 10)
    result = await client.turn(session_token="old-token", message="Mi intento")

    assert result.message.endswith("?")
    assert result.session_token == "next-token"
    request = http.post.call_args
    assert request.kwargs["headers"]["Authorization"] == f"Bearer {'s' * 32}"
    assert request.kwargs["json"]["message"] == "Mi intento"
    assert request.kwargs["json"]["attempt"] == ""


@pytest.mark.asyncio
async def test_turn_rejects_backend_error() -> None:
    http = Mock()
    http.post.return_value = Response(503, {})
    client = TutorClient(http, "http://app/api/internal/turn", "s" * 32, 10)

    with pytest.raises(TutorServiceError, match="503"):
        await client.turn(session_token="old-token", message="Mi intento")


@pytest.mark.asyncio
async def test_turn_maps_closed_http_session_to_service_error() -> None:
    http = Mock()
    http.post.side_effect = RuntimeError("Session is closed")
    client = TutorClient(http, "http://app/api/internal/turn", "s" * 32, 10)

    with pytest.raises(TutorServiceError, match="no está disponible"):
        await client.turn(session_token="old-token", message="Mi intento")


@pytest.mark.asyncio
async def test_turn_rejects_invalid_json() -> None:
    http = Mock()
    http.post.return_value = InvalidJsonResponse(200, None)
    client = TutorClient(http, "http://app/api/internal/turn", "s" * 32, 10)

    with pytest.raises(TutorServiceError, match="no está disponible"):
        await client.turn(session_token="old-token", message="Mi intento")


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [None, [], "not-an-object"])
async def test_turn_rejects_non_object_json(payload: Any) -> None:
    http = Mock()
    http.post.return_value = Response(200, payload)
    client = TutorClient(http, "http://app/api/internal/turn", "s" * 32, 10)

    with pytest.raises(TutorServiceError, match="Respuesta inválida"):
        await client.turn(session_token="old-token", message="Mi intento")
