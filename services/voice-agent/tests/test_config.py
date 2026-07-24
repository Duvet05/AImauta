import pytest
from pydantic import ValidationError

from aimauta_voice.config import Settings


def settings(**overrides: str) -> Settings:
    values = {
        "livekit_url": "wss://aimauta-test.livekit.cloud",
        "livekit_api_key": "test-key",
        "livekit_api_secret": "test-secret",
        "deepgram_api_key": "test-deepgram",
        "aimauta_app_url": "http://127.0.0.1:3000",
        "aimauta_agent_secret": "s" * 32,
    }
    values.update(overrides)
    return Settings(**values)


def test_accepts_loopback_http_backend() -> None:
    configured = settings()
    assert configured.turn_endpoint == "http://127.0.0.1:3000/api/internal/turn"


def test_requires_https_for_remote_backend() -> None:
    with pytest.raises(ValidationError, match="HTTPS"):
        settings(aimauta_app_url="http://backend.example.test")

    configured = settings(aimauta_app_url="https://backend.example.test")
    assert configured.turn_endpoint.startswith("https://")


def test_voice_session_duration_has_safe_bounds() -> None:
    assert settings().max_session_seconds == 600
    assert settings(max_session_seconds="60").max_session_seconds == 60
    assert settings(max_session_seconds="900").max_session_seconds == 900

    with pytest.raises(ValidationError):
        settings(max_session_seconds="59")
    with pytest.raises(ValidationError):
        settings(max_session_seconds="901")
