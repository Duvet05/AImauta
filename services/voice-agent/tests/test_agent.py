import asyncio
import json
import logging
from pathlib import Path
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
            "exercise_id": "ejercicio-fracciones",
            "exercise_revision": 2,
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
@pytest.mark.parametrize(
    ("error_type", "message"),
    [
        (asyncio.CancelledError, None),
        (
            RuntimeError,
            voice_agent._ROOM_DISCONNECTED_WHILE_WAITING,
        ),
    ],
)
async def test_entrypoint_treats_wait_shutdown_as_normal(
    monkeypatch,
    error_type,
    message,
) -> None:
    room = FakeRoom()

    class FakeContext:
        job = SimpleNamespace(metadata=dispatch_metadata())
        proc = SimpleNamespace(userdata={"vad": object()})

        def __init__(self) -> None:
            self.room = room

        async def connect(self) -> None:
            return None

        async def wait_for_participant(self, *, identity: str) -> object:
            assert identity == "student-session-12345678"
            if message is None:
                raise error_type()
            raise error_type(message)

        def add_shutdown_callback(self, _callback: Any) -> None:
            return None

    monkeypatch.setattr(
        voice_agent,
        "get_settings",
        lambda: SimpleNamespace(max_session_seconds=600),
    )
    monkeypatch.setattr(
        voice_agent,
        "install_session_deadline",
        lambda *_: None,
    )

    assert await voice_agent.entrypoint(FakeContext()) is None


@pytest.mark.asyncio
async def test_entrypoint_does_not_hide_unexpected_wait_failure(
    monkeypatch,
) -> None:
    room = FakeRoom()

    class FakeContext:
        job = SimpleNamespace(metadata=dispatch_metadata())
        proc = SimpleNamespace(userdata={"vad": object()})

        def __init__(self) -> None:
            self.room = room

        async def connect(self) -> None:
            return None

        async def wait_for_participant(self, *, identity: str) -> object:
            raise RuntimeError("unexpected wait failure")

        def add_shutdown_callback(self, _callback: Any) -> None:
            return None

    monkeypatch.setattr(
        voice_agent,
        "get_settings",
        lambda: SimpleNamespace(max_session_seconds=600),
    )
    monkeypatch.setattr(
        voice_agent,
        "install_session_deadline",
        lambda *_: None,
    )

    with pytest.raises(RuntimeError, match="unexpected wait failure"):
        await voice_agent.entrypoint(FakeContext())


@pytest.mark.asyncio
async def test_entrypoint_keeps_http_open_until_job_shutdown(monkeypatch) -> None:
    room = FakeRoom()
    callbacks = []
    start_kwargs: dict[str, Any] = {}
    stt_kwargs: dict[str, Any] = {}
    tts_kwargs: dict[str, Any] = {}
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
    monkeypatch.setattr(
        voice_agent.inference,
        "STT",
        lambda **kwargs: stt_kwargs.update(kwargs) or object(),
    )
    monkeypatch.setattr(
        voice_agent.inference,
        "TTS",
        lambda **kwargs: tts_kwargs.update(kwargs) or object(),
    )
    monkeypatch.setattr(
        voice_agent,
        "get_settings",
        lambda: SimpleNamespace(
            turn_endpoint="http://127.0.0.1:3309/api/internal/turn",
            aimauta_agent_secret="s" * 32,
            request_timeout_seconds=10,
            max_session_seconds=600,
            livekit_api_key="livekit-key",
            livekit_api_secret="livekit-secret",
            stt_model="deepgram/nova-3",
            stt_language="es-419",
            tts_model="inworld/inworld-tts-2",
            tts_voice="Diego",
            tts_language="es",
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
    assert stt_kwargs == {
        "model": "deepgram/nova-3",
        "language": "es-419",
        "api_key": "livekit-key",
        "api_secret": "livekit-secret",
        "extra_kwargs": {
            "interim_results": True,
            "smart_format": True,
            "punctuate": True,
            "profanity_filter": True,
            "endpointing": 350,
            "mip_opt_out": True,
        },
    }
    assert tts_kwargs == {
        "model": "inworld/inworld-tts-2",
        "voice": "Diego",
        "language": "es",
        "api_key": "livekit-key",
        "api_secret": "livekit-secret",
    }

    for callback in callbacks:
        await callback("test shutdown")
    assert http.closed is True
    assert shutdown_reasons == []


def test_start_speech_ignores_only_agent_session_closing() -> None:
    class ClosingSession:
        def say(self, *_: Any, **__: Any) -> None:
            raise RuntimeError(voice_agent._SESSION_CLOSING_WHILE_SAYING)

    class BrokenSession:
        def say(self, *_: Any, **__: Any) -> None:
            raise RuntimeError("tts scheduling failed")

    assert (
        voice_agent._start_speech_if_open(
            ClosingSession(),  # type: ignore[arg-type]
            "hola",
        )
        is None
    )
    with pytest.raises(RuntimeError, match="tts scheduling failed"):
        voice_agent._start_speech_if_open(
            BrokenSession(),  # type: ignore[arg-type]
            "hola",
        )


def test_voice_agent_image_checks_loopback_health_endpoint() -> None:
    dockerfile = Path(__file__).parents[1] / "Dockerfile"
    contents = dockerfile.read_text(encoding="utf-8")

    assert "HEALTHCHECK " in contents
    assert "http://127.0.0.1:8081/" in contents
    assert "http://0.0.0.0:8081/" not in contents


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
    monkeypatch.setattr(
        voice_agent,
        "get_settings",
        lambda: SimpleNamespace(
            livekit_url="wss://aimauta-test.livekit.cloud",
            livekit_api_key="livekit-key",
            livekit_api_secret="livekit-secret",
        ),
    )

    voice_agent.main()

    assert len(options) == 1
    assert options[0].host == "127.0.0.1"
    assert options[0].ws_url == "wss://aimauta-test.livekit.cloud"
    assert options[0].api_key == "livekit-key"
    assert options[0].api_secret == "livekit-secret"
    assert options[0].log_level == "WARN"
