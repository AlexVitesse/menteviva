from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Groq
    groq_api_key: str = ""
    groq_model_llm: str = "llama-3.1-8b-instant"
    groq_model_analysis: str = "openai/gpt-oss-120b"  # Modelo de razonamiento para analisis
    groq_model_whisper: str = "whisper-large-v3-turbo"

    # Edge TTS
    tts_voice: str = "es-MX-JorgeNeural"  # Voz mexicana masculina

    # App
    app_name: str = "Mente Viva API"
    debug: bool = False
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    class Config:
        env_file = ".env"


settings = Settings()
