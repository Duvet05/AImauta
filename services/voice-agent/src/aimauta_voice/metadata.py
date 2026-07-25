from pydantic import BaseModel, ConfigDict, Field, ValidationError


class RoomMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    v: int = Field(ge=1, le=1)
    app: str
    session_id: str = Field(min_length=8, max_length=80)
    book_id: str = Field(min_length=1, max_length=100)
    page: int = Field(ge=1)
    total_pages: int = Field(ge=1, le=2000)
    subject: str = Field(max_length=100)
    grade: str = Field(max_length=100)
    language: str = "es-PE"
    stage: str
    exercise_id: str | None = Field(default=None, min_length=1, max_length=160)
    exercise_revision: int | None = Field(default=None, ge=1)
    mode: str

    def model_post_init(self, __context: object) -> None:
        if self.app != "aimauta" or self.mode != "socratic":
            raise ValueError("La sala no pertenece al tutor socrático AImauta")
        if self.page > self.total_pages:
            raise ValueError("Página fuera del material")
        if (self.exercise_id is None) != (self.exercise_revision is None):
            raise ValueError("La selección del ejercicio está incompleta")


class DispatchMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    v: int = Field(ge=1, le=1)
    app: str
    session_id: str = Field(min_length=8, max_length=80)
    session_token: str = Field(min_length=20, max_length=4096)

    def model_post_init(self, __context: object) -> None:
        if self.app != "aimauta":
            raise ValueError("El despacho no pertenece a AImauta")


def parse_room_metadata(raw: str, room_name: str) -> RoomMetadata:
    if not room_name.startswith("aimauta-"):
        raise ValueError("Prefijo de sala no autorizado")
    try:
        metadata = RoomMetadata.model_validate_json(raw)
    except ValidationError:
        raise ValueError("Metadata de sala inválida") from None

    if room_name != f"aimauta-{metadata.session_id}":
        raise ValueError("La sala no corresponde a la sesión declarada")
    return metadata


def parse_dispatch_metadata(raw: str, session_id: str) -> DispatchMetadata:
    try:
        metadata = DispatchMetadata.model_validate_json(raw)
    except ValidationError:
        raise ValueError("Metadata privada de despacho inválida") from None

    if metadata.session_id != session_id:
        raise ValueError("El despacho no corresponde a la sesión de la sala")
    return metadata
