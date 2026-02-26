from pydantic import BaseModel
from typing import Literal, Optional
from datetime import datetime


class Message(BaseModel):
    """Modelo de mensaje en la conversacion."""
    role: Literal["user", "assistant", "system"]
    content: str
    timestamp: Optional[datetime] = None


class WebSocketMessage(BaseModel):
    """Mensaje entrante por WebSocket."""
    type: Literal["audio", "text", "end_session"]
    audio: Optional[str] = None  # Base64 encoded audio
    text: Optional[str] = None


class StatusMessage(BaseModel):
    """Mensaje de estado del servidor."""
    type: Literal["status"] = "status"
    status: Literal["transcribing", "thinking", "generating_audio", "ready"]


class UserMessageResponse(BaseModel):
    """Respuesta con texto del usuario transcrito."""
    type: Literal["user_message"] = "user_message"
    content: str


class AssistantTokenResponse(BaseModel):
    """Token individual de respuesta del asistente (streaming)."""
    type: Literal["assistant_token"] = "assistant_token"
    content: str


class AssistantAudioResponse(BaseModel):
    """Respuesta completa con audio del asistente."""
    type: Literal["assistant_audio"] = "assistant_audio"
    audio: str  # Base64 encoded MP3
    content: str


class SessionEndResponse(BaseModel):
    """Respuesta de fin de sesion con metricas."""
    type: Literal["session_end"] = "session_end"
    metrics: dict


class ErrorResponse(BaseModel):
    """Respuesta de error."""
    type: Literal["error"] = "error"
    error: str
