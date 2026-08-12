"""Contrato discriminado de mensajes entrantes del protocolo WebSocket."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError


class _StrictMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InitMessage(_StrictMessage):
    type: Literal["init"]
    session_vars: dict | None = None
    level: Literal["principiante", "intermedio", "avanzado"] | None = None


class AudioMessage(_StrictMessage):
    type: Literal["audio"]
    audio: str = Field(min_length=1)
    format: str = Field("audio.webm", max_length=100)


class AudioChunkMessage(_StrictMessage):
    type: Literal["audio_chunk"]
    pcm: str = Field(min_length=1)


class TextMessage(_StrictMessage):
    type: Literal["text"]
    text: str = Field(min_length=1, max_length=8000)


class EndSessionMessage(_StrictMessage):
    type: Literal["end_session"]


ClassicClientMessage = Annotated[
    InitMessage | AudioMessage | TextMessage | EndSessionMessage,
    Field(discriminator="type"),
]
LiveClientMessage = Annotated[
    InitMessage | AudioChunkMessage | TextMessage | EndSessionMessage,
    Field(discriminator="type"),
]

_classic_adapter = TypeAdapter(ClassicClientMessage)
_live_adapter = TypeAdapter(LiveClientMessage)


def parse_client_message(data: object, *, live: bool = False) -> dict:
    """Valida y normaliza un mensaje o levanta ValueError sin filtrar internals."""
    try:
        parsed = (_live_adapter if live else _classic_adapter).validate_python(data)
    except ValidationError as exc:
        raise ValueError("Mensaje WebSocket invalido o tipo desconocido") from exc
    return parsed.model_dump(exclude_none=True)
