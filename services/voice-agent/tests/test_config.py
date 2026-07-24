import pytest
from livekit.agents import inference
from pydantic import ValidationError

from aimauta_voice.config import Settings


def settings(**overrides: str) -> Settings:
    values = {
        "livekit_url": "wss://aimauta-test.livekit.cloud",
        "livekit_api_key": "test-key",
        "livekit_api_secret": "test-secret",
        "aimauta_app_url": "http://127.0.0.1:3309",
        "aimauta_agent_secret": "s" * 32,
    }
    values.update(overrides)
    return Settings(**values)


def test_accepts_loopback_http_backend() -> None:
    configured = settings()
    assert configured.turn_endpoint == "http://127.0.0.1:3309/api/internal/turn"


def test_uses_livekit_inference_defaults_without_deepgram_key() -> None:
    configured = settings()

    assert configured.stt_model == "deepgram/nova-3"
    assert configured.stt_language == "es-419"
    assert configured.tts_model == "deepgram/aura-2"
    assert configured.tts_voice == "selena"
    assert configured.tts_language == "es-419"


def test_pinned_sdk_accepts_livekit_inference_contract() -> None:
    configured = settings()

    stt = inference.STT(
        model=configured.stt_model,
        language=configured.stt_language,
        api_key=configured.livekit_api_key,
        api_secret=configured.livekit_api_secret,
        extra_kwargs={
            "interim_results": True,
            "smart_format": True,
            "punctuate": True,
            "profanity_filter": True,
            "endpointing": 350,
            "mip_opt_out": True,
        },
    )
    tts = inference.TTS(
        model=configured.tts_model,
        voice=configured.tts_voice,
        language=configured.tts_language,
        api_key=configured.livekit_api_key,
        api_secret=configured.livekit_api_secret,
    )

    assert isinstance(stt, inference.STT)
    assert isinstance(tts, inference.TTS)


def test_requires_tls_for_remote_livekit() -> None:
    with pytest.raises(ValidationError, match="wss"):
        settings(livekit_url="ws://livekit.example.test")

    assert settings(livekit_url="ws://127.0.0.1:7880").livekit_url.startswith(
        "ws://"
    )


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
