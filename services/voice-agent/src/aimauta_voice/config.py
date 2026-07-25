import re
from functools import lru_cache
from urllib.parse import urlsplit

from pydantic import (
    Field,
    HttpUrl,
    SecretStr,
    field_validator,
    model_validator,
)
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
    tavus_avatar_enabled: bool = False
    tavus_api_key: SecretStr = SecretStr("")
    tavus_replica_id: str = ""
    tavus_persona_id: str = ""

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

    @field_validator("tavus_avatar_enabled", mode="before")
    @classmethod
    def validate_tavus_switch(cls, value: object) -> bool:
        if isinstance(value, bool):
            return value
        if value == "true":
            return True
        if value == "false":
            return False
        raise ValueError(
            "TAVUS_AVATAR_ENABLED debe ser exactamente true o false"
        )

    @model_validator(mode="after")
    def validate_tavus_configuration(self) -> "Settings":
        if not self.tavus_avatar_enabled:
            return self
        if len(self.tavus_api_key.get_secret_value()) < 20:
            raise ValueError(
                "TAVUS_API_KEY es obligatoria cuando Tavus está habilitado"
            )
        if not re.fullmatch(r"r[a-zA-Z0-9]{6,63}", self.tavus_replica_id):
            raise ValueError(
                "TAVUS_REPLICA_ID no tiene un formato válido"
            )
        if not re.fullmatch(r"p[a-zA-Z0-9]{6,63}", self.tavus_persona_id):
            raise ValueError(
                "TAVUS_PERSONA_ID no tiene un formato válido"
            )
        return self

    @property
    def turn_endpoint(self) -> str:
        return f"{str(self.aimauta_app_url).rstrip('/')}/api/internal/turn"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
