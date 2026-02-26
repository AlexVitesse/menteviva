from pydantic import BaseModel
from typing import Optional


class Avatar(BaseModel):
    """Modelo de Avatar para entrenamiento."""
    id: str
    name: str
    role: str
    company: str
    personality: str
    voice: str
    lottie_url: str


class AvatarResponse(BaseModel):
    """Respuesta de avatar sin system_prompt."""
    id: str
    name: str
    role: str
    company: str
    personality: str
    voice: str
    lottie_url: str


class AvatarListResponse(BaseModel):
    """Lista de avatares."""
    avatars: list[AvatarResponse]
