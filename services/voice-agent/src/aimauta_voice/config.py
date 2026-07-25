from functools import lru_cache
from urllib.parse import urlsplit

from pydantic import Field, HttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    livekit_url: str
    livekit_api_key: str = Field(min_length=1)
    livekit_api_secret: str = Field(min_length=1)
    aimauta_app_url: HttpUrl = HttpUrl("http://127.0.0.1:3309")
    aimauta_agent_secret: str = Field(min_length=32)
    request_timeout_seconds: float = Field(default=50.0, ge=2.0, le=120.0)
    max_session_seconds: int = Field(default=600, ge=60, le=900)
    stt_model: str = "deepgram/nova-3"
    stt_language: str = "es-419"
    tts_model: str = "inworld/inworld-tts-2"
    tts_voice: str = "Diego"
    tts_language: str = "es"

    @field_validator("livekit_url")
    @classmethod
    def validate_livekit_url(cls, value: str) -> str:
        parsed = urlsplit(value)
        if (
            parsed.scheme not in {"ws", "wss"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
        ):
            raise ValueError("LIVEKIT_URL debe usar ws:// o wss://")
        if parsed.scheme == "ws" and parsed.hostname not in {
            "127.0.0.1",
            "localhost",
            "::1",
        }:
            raise ValueError(
                "LIVEKIT_URL debe usar wss:// fuera de loopback"
            )
        return value.rstrip("/")

    @field_validator("aimauta_app_url")
    @classmethod
    def validate_app_url(cls, value: HttpUrl) -> HttpUrl:
        if value.scheme == "http" and value.host not in {"127.0.0.1", "localhost"}:
            raise ValueError(
                "AIMAUTA_APP_URL solo puede usar HTTP sobre loopback; "
                "para otro host debe usar HTTPS"
            )
        return value

    @property
    def turn_endpoint(self) -> str:
        return f"{str(self.aimauta_app_url).rstrip('/')}/api/internal/turn"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
