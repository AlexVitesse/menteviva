from pydantic import AliasChoices, Field
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
        """Retorna lista de API keys válidas para rotación.

        Filtra vacías Y los placeholders del .env.example (`gsk_xxxxx...`):
        si alguien copia .env.example sin reemplazar GROQ_API_KEY_2/3/4, esas
        keys-basura entran al round-robin y 3 de cada 4 requests dan 401. Una
        key real de Groq es `gsk_` + 52 chars; los placeholders tienen 'xxxx'.
        """
        keys = [self.groq_api_key, self.groq_api_key_2, self.groq_api_key_3, self.groq_api_key_4]
        return [
            k for k in keys
            if k and k.startswith("gsk_") and len(k) >= 50 and "xxxx" not in k
        ]

    # ChatGPT / OpenAI API Key
    chatgpt_api_key: str = ""

    # ElevenLabs TTS
    elevenlabs_api_key: str = ""
    elevenlabs_model: str = "eleven_multilingual_v2"

    # ============ Gemini Live API (audio nativo en tiempo real) ============
    # PoC (Fase 1) para reemplazar el pipeline Whisper+gpt-oss+ElevenLabs por
    # una sola sesion bidireccional. Ver docs/plans/05_gemini_live_voice.md.
    gemini_api_key: str = ""
    # Keys extra para ROTACION round-robin (igual que Groq): reparte las llamadas
    # y estira el free tier (20 req/dia POR KEY POR MODELO). Aceptamos las dos
    # convenciones de nombre por si ya la pusiste sin guion: GEMINI_API_KEY2 y
    # GEMINI_API_KEY_2 apuntan al mismo campo.
    gemini_api_key_2: str = Field(
        "", validation_alias=AliasChoices("GEMINI_API_KEY_2", "GEMINI_API_KEY2")
    )
    gemini_api_key_3: str = Field(
        "", validation_alias=AliasChoices("GEMINI_API_KEY_3", "GEMINI_API_KEY3")
    )
    gemini_api_key_4: str = Field(
        "", validation_alias=AliasChoices("GEMINI_API_KEY_4", "GEMINI_API_KEY4")
    )
    # Audio nativo (decision de producto). Modelos Live disponibles en la cuenta
    # (client.models.list filtrando bidiGenerateContent):
    #   - gemini-2.5-flash-native-audio-latest   <- default (auto-sigue el mas nuevo)
    #   - gemini-2.5-flash-native-audio-preview-09-2025 / -12-2025
    #   - gemini-3.1-flash-live-preview           <- el marcado "free" en pricing
    # OJO: gemini-2.0-flash-live-001 NO existe en v1beta para esta cuenta.
    gemini_model_live: str = "gemini-2.5-flash-native-audio-latest"
    # Modelo Gemini de TEXTO (no audio) para el banco de pruebas de prompts
    # (chat_text.py, provider="gemini"). Es el hermano de texto del native-audio:
    # mismo prompt conciso + addendum que en voz, pero via generate_content, para
    # evaluar el prompt "como si fuera Gemini" sin abrir sesion Live ni TTS.
    gemini_model_text: str = "gemini-2.5-flash"
    # Flag para volver al pipeline Groq+ElevenLabs sin borrar codigo (rollback
    # barato durante el piloto). Lo consume el router cuando exista la rama WS.
    realtime_provider: str = "groq"  # "groq" | "gemini"
    # Sensibilidad del VAD de Gemini (tunable por .env sin redeploy). Tradeoff:
    #   start HIGH = capta bien tu voz pero el eco la puede cortar (usa audifonos);
    #   start LOW  = resiste el eco pero a veces no registra que hablaste.
    #   end HIGH + silence bajo = responde rapido; end LOW + silence alto = paciente.
    # Defaults responsivos (HIGH/HIGH/500) para que no "se quede callada esperando".
    gemini_vad_start_sensitivity: str = "HIGH"  # HIGH | LOW
    gemini_vad_end_sensitivity: str = "HIGH"    # HIGH | LOW
    gemini_vad_silence_ms: int = 500

    @property
    def gemini_api_keys(self) -> list[str]:
        """API keys de Gemini validas para rotacion round-robin.

        Filtra vacias y placeholders. Las keys de Google empiezan con 'AIza';
        no exigimos el prefijo por si cambian el formato, solo descartamos
        vacias y el placeholder tipico ('xxxx' / 'your').
        """
        keys = [
            self.gemini_api_key,
            self.gemini_api_key_2,
            self.gemini_api_key_3,
            self.gemini_api_key_4,
        ]
        return [
            k for k in keys
            if k and "xxxx" not in k.lower() and not k.lower().startswith("your")
        ]

    # ============ Simli (avatar fotorrealista en video) ============
    # API key de https://app.simli.com. La usa el backend para emitir session
    # tokens efimeros (routers/simli.py); la key NUNCA viaja al navegador.
    simli_api_key: str = ""
    # Limite duro de cada sesion WebRTC de Simli (factura por minuto de
    # streaming). 1800s = 30 min: cubre el diagnostico de ~25 min con colchon.
    simli_max_session_seconds: int = 1800

    # ============ Avatar OSS self-hosted (reemplazo de Simli) ============
    # Selector del proveedor de avatar de video que responde /api/avatar/session
    # (routers/avatar.py). Ver docs/plans/16_avatar_oss_integracion.md.
    #   "simli" -> mint de token efimero contra api.simli.ai (comportamiento actual).
    #   "oss"   -> sesion WebRTC contra el avatar-service self-hosted (MuseTalk).
    #   "none"  -> sin video; el frontend cae al avatar 2D.
    # Default "simli" para REGRESION CERO: sin este var en el .env todo sigue igual.
    avatar_provider: str = "simli"  # "simli" | "oss" | "none"
    # Base URL del avatar-service OSS (p.ej. http://127.0.0.1:8300 o el tunnel del
    # VPS). Vive SOLO en el backend — el navegador nunca la ve; el backend hace
    # POST {avatar_service_url}/session y devuelve la signaling_url ya resuelta.
    avatar_service_url: str = ""
    # Espejo de simli_max_session_seconds para el camino OSS (limite duro de sesion).
    avatar_max_session_seconds: int = 1800

    # Firebase Admin SDK. Dos formas de configurar — usa una:
    #  (1) FIREBASE_SERVICE_ACCOUNT_PATH: ruta absoluta o relativa a un JSON
    #      descargado de Firebase Console > Project Settings > Service Accounts.
    #      Recomendado en local (no comitear el JSON; ponerlo en .gitignore).
    #  (2) FIREBASE_SERVICE_ACCOUNT_JSON: el contenido completo del JSON como
    #      string. Usar en hosts (Render) que no permiten subir archivos.
    # Si AMBAS estan vacias, el modulo firebase_auth no se inicializa y los
    # endpoints de auth devuelven 503 — util para correr el resto del backend
    # sin Firebase configurado todavia.
    firebase_service_account_path: str = ""
    firebase_service_account_json: str = ""

    # Database — Postgres connection string.
    # Dev local Docker:  postgresql://menteviva:dev@127.0.0.1:5433/menteviva
    # Prod Neon:         postgresql://<user>:<pwd>@<host>.neon.tech/menteviva?sslmode=require
    # El driver es psycopg async (psycopg 3.x); no incluir "+psycopg" en la URL,
    # psycopg.AsyncConnection acepta una connection string libpq estandar.
    database_url: str = "postgresql://menteviva:dev@127.0.0.1:5433/menteviva"
    db_pool_min_size: int = 2
    db_pool_max_size: int = 10

    # App
    chatlab_token: str = ""
    app_name: str = "Mente Viva API"
    debug: bool = False
    port: int = 8000
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "https://kbm5qpth-5174.use2.devtunnels.ms",
    ]

    class Config:
        env_file = ".env"


settings = Settings()
