"""
Servicios de Mente Viva.

- groq_whisper: Speech-to-Text con Groq Whisper
- groq_llm: Chat con Llama 3.1 8B
- edge_tts: Text-to-Speech con Microsoft Edge TTS
"""

from app.services import groq_whisper, groq_llm, edge_tts

__all__ = ["groq_whisper", "groq_llm", "edge_tts"]
