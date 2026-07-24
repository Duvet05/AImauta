import json
import logging
from types import SimpleNamespace
from typing import Any

import pytest

import aimauta_voice.agent as voice_agent


def room_metadata() -> str:
    return json.dumps(
        {
            "v": 1,
            "app": "aimauta",
            "session_id": "session-12345678",
            "book_id": "fichas-matematica-1-secundaria",
            "page": 13,
            "total_pages": 100,
            "subject": "Matemática",
            "grade": "1.er grado",
            "language": "es-PE",
            "stage": "learn",
            "mode": "socratic",
        }
    )


def dispatch_metadata() -> str:
    return json.dumps(
        {
            "v": 1,
            "app": "aimauta",
            "session_id": "session-12345678",
            "session_token": "x" * 40,
        }
    )


class FakeRoom:
    name = "aimauta-session-12345678"
    metadata = room_metadata()

    def __init__(self) -> None:
        self.listeners: dict[str, Any] = {}

    def on(self, event: str):
        def register(callback: Any) -> Any:
            self.listeners[event] = callback
            return callback

        return register


class FakeHttp:
    def __init__(self) -> None:
        self.closed = False

    async def close(self) -> None:
        self.closed = True


@pytest.mark.asyncio
async def test_entrypoint_keeps_http_open_until_job_shutdown(monkeypatch) -> None:
    room = FakeRoom()
    callbacks = []
    start_kwargs: dict[str, Any] = {}
    waited_for: list[str] = []
    shutdown_reasons: list[str] = []
    http = FakeHttp()

    class FakeContext:
        job = SimpleNamespace(metadata=dispatch_metadata())
        proc = SimpleNamespace(userdata={"vad": object()})

        def __init__(self) -> None:
            self.room = room

        async def connect(self) -> None:
            return None

        async def wait_for_participant(self, *, identity: str) -> object:
            waited_for.append(identity)
            return object()

        def add_shutdown_callback(self, callback: Any) -> None:
            callbacks.append(callback)

        def shutdown(self, reason: str) -> None:
            shutdown_reasons.append(reason)

    class FakeAgent:
        def __init__(self, **kwargs: Any) -> None:
            self.kwargs = kwargs

    class FakeSession:
        def __init__(self, **_: Any) -> None:
            pass

        async def start(self, **kwargs: Any) -> None:
            start_kwargs.update(kwargs)

        async def say(self, *_: Any, **__: Any) -> None:
            return None

    monkeypatch.setattr(voice_agent.aiohttp, "ClientSession", lambda: http)
    monkeypatch.setattr(voice_agent, "AImautaVoiceAgent", FakeAgent)
    monkeypatch.setattr(voice_agent, "AgentSession", FakeSession)
    monkeypatch.setattr(voice_agent, "install_context_listener", lambda *_, **__: None)
    monkeypatch.setattr(voice_agent.deepgram, "STT", lambda **_: object())
    monkeypatch.setattr(voice_agent.deepgram, "TTS", lambda **_: object())
    monkeypatch.setattr(
        voice_agent,
        "get_settings",
        lambda: SimpleNamespace(
            turn_endpoint="http://127.0.0.1:3000/api/internal/turn",
            aimauta_agent_secret="s" * 32,
            request_timeout_seconds=10,
            max_session_seconds=600,
            deepgram_api_key="deepgram",
            stt_model="nova-3",
            stt_language="es",
            tts_model="aura-2-selena-es",
        ),
    )

    await voice_agent.entrypoint(FakeContext())

    assert waited_for == ["student-session-12345678"]
    assert http.closed is False
    assert len(callbacks) == 2
    assert start_kwargs["record"] is False
    assert (
        start_kwargs["room_options"].participant_identity
        == "student-session-12345678"
    )
    assert start_kwargs["room_options"].delete_room_on_close is True

    for callback in callbacks:
        await callback("test shutdown")
    assert http.closed is True
    assert shutdown_reasons == []


@pytest.mark.asyncio
async def test_session_deadline_expires_and_is_cancelled_on_normal_shutdown() -> None:
    class FakeContext:
        def __init__(self) -> None:
            self.callbacks = []
            self.shutdown_reasons: list[str] = []

        def add_shutdown_callback(self, callback: Any) -> None:
            self.callbacks.append(callback)

        def shutdown(self, reason: str) -> None:
            self.shutdown_reasons.append(reason)

    cancelled_ctx = FakeContext()
    cancelled_task = voice_agent.install_session_deadline(
        cancelled_ctx,  # type: ignore[arg-type]
        60,
    )
    await cancelled_ctx.callbacks[0]("participant disconnected")
    assert cancelled_task.cancelled()
    assert cancelled_ctx.shutdown_reasons == []

    expired_ctx = FakeContext()
    expired_task = voice_agent.install_session_deadline(
        expired_ctx,  # type: ignore[arg-type]
        0,
    )
    await expired_task
    assert expired_ctx.shutdown_reasons == [
        "voice session duration limit reached"
    ]
    await expired_ctx.callbacks[0]("duration limit reached")


def test_context_listener_accepts_only_exact_student_identity() -> None:
    room = FakeRoom()

    class FakeAgent:
        def __init__(self) -> None:
            self.tokens: list[str] = []

        def replace_session_token(self, token: str) -> None:
            self.tokens.append(token)

    agent = FakeAgent()
    voice_agent.install_context_listener(
        room,
        agent,  # type: ignore[arg-type]
        student_identity="student-session-12345678",
    )
    listener = room.listeners["data_received"]
    packet = lambda identity: SimpleNamespace(  # noqa: E731
        topic=voice_agent.CONTEXT_TOPIC,
        data=json.dumps({"v": 1, "sessionToken": "n" * 40}).encode(),
        participant=SimpleNamespace(identity=identity) if identity else None,
    )

    listener(packet("student-another-session"))
    listener(packet(None))
    assert agent.tokens == []

    malformed_packet = packet("student-session-12345678")
    malformed_packet.data = b"[]"
    listener(malformed_packet)
    assert agent.tokens == []

    listener(packet("student-session-12345678"))
    assert agent.tokens == ["n" * 40]


def test_sensitive_log_filter_redacts_structured_transcript_fields() -> None:
    record = logging.LogRecord(
        name="livekit.agents",
        level=logging.WARNING,
        pathname=__file__,
        lineno=1,
        msg="event",
        args={"user_input": "respuesta privada", "status": "failed"},
        exc_info=None,
    )
    record.user_transcript = "respuesta privada"

    assert voice_agent.SensitiveLogFilter().filter(record) is True
    assert record.user_transcript == "[redacted]"
    assert record.args["user_input"] == "[redacted]"
    assert record.args["status"] == "failed"


def test_worker_health_server_is_loopback_only(monkeypatch) -> None:
    options = []
    monkeypatch.setattr(voice_agent.agents.cli, "run_app", options.append)

    voice_agent.main()

    assert len(options) == 1
    assert options[0].host == "127.0.0.1"
    assert options[0].log_level == "WARN"
