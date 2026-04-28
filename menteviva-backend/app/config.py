from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Groq - Múltiples API keys para rotación (soporta hasta 4 keys)
    groq_api_key: str = ""
    groq_api_key_2: str = ""
    groq_api_key_3: str = ""
    groq_api_key_4: str = ""
    # GPT-OSS 20B (Groq, preview): mismo throughput que llama-3.1-8b-instant
    # (~0.66s/turno) pero con reasoning -> cumple reglas estrictas del prompt
    # de roleplay (max 3 oraciones 95% de las veces, max 1 pregunta 100%, banco
    # de objeciones en orden). Reemplaza llama-3.1-8b-instant tras test largo
    # comparativo (scripts/test_roberto_long_session.py 2026-04-27).
    groq_model_llm: str = "openai/gpt-oss-20b"
    # Llama 3.3 70b: soporta JSON mode estrictamente sin tokens de razonamiento
    # que rompan la validacion (gpt-oss-120b fallaba con json_object por razonar
    # antes de emitir el JSON y agotar el budget de tokens).
    groq_model_analysis: str = "llama-3.3-70b-versatile"
    groq_model_whisper: str = "whisper-large-v3-turbo"

    @property
    def groq_api_keys(self) -> list[str]:
        """Retorna lista de API keys válidas para rotación."""
        keys = [self.groq_api_key, self.groq_api_key_2, self.groq_api_key_3, self.groq_api_key_4]
        return [k for k in keys if k]  # Solo keys no vacías

    # ElevenLabs TTS
    elevenlabs_api_key: str = ""
    elevenlabs_model: str = "eleven_multilingual_v2"

    # App
    app_name: str = "Mente Viva API"
    debug: bool = False
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "https://kbm5qpth-5174.use2.devtunnels.ms",
    ]

    class Config:
        env_file = ".env"


settings = Settings()
