from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Groq - Múltiples API keys para rotación (soporta hasta 4 keys)
    groq_api_key: str = ""
    groq_api_key_2: str = ""
    groq_api_key_3: str = ""
    groq_api_key_4: str = ""
    groq_model_llm: str = "llama-3.1-8b-instant"
    groq_model_analysis: str = "openai/gpt-oss-120b"  # Modelo de razonamiento para analisis
    groq_model_whisper: str = "whisper-large-v3-turbo"

    @property
    def groq_api_keys(self) -> list[str]:
        """Retorna lista de API keys válidas para rotación."""
        keys = [self.groq_api_key, self.groq_api_key_2, self.groq_api_key_3, self.groq_api_key_4]
        return [k for k in keys if k]  # Solo keys no vacías

    # Edge TTS
    tts_voice: str = "es-MX-JorgeNeural"  # Voz mexicana masculina

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
