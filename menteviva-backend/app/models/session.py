from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from app.models.message import Message


class ConversationSession(BaseModel):
    """Estado de una sesion de conversacion."""
    session_id: str
    avatar_id: str
    started_at: datetime
    messages: list[Message] = []
    is_active: bool = True

    def add_message(self, role: str, content: str) -> None:
        """Agrega un mensaje a la conversacion."""
        self.messages.append(
            Message(role=role, content=content, timestamp=datetime.now())
        )

    def get_history(self) -> list[dict]:
        """Retorna el historial en formato para el LLM."""
        return [
            {"role": msg.role, "content": msg.content}
            for msg in self.messages
        ]

    def get_metrics(self) -> dict:
        """Calcula metricas de la sesion."""
        user_messages = [m for m in self.messages if m.role == "user"]
        assistant_messages = [m for m in self.messages if m.role == "assistant"]

        return {
            "total_exchanges": len(user_messages),
            "user_messages": len(user_messages),
            "assistant_messages": len(assistant_messages),
            "conversation": self.get_history()
        }


class SessionMetrics(BaseModel):
    """Metricas de una sesion finalizada."""
    total_exchanges: int
    user_messages: int
    assistant_messages: int
    conversation: list[dict]
    duration_seconds: Optional[float] = None
