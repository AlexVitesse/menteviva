/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  // "groq" (default, push-to-talk + ElevenLabs) | "gemini" (audio nativo continuo).
  readonly VITE_REALTIME_PROVIDER?: string;
  // "1" = avatar fotorrealista Simli (video WebRTC) en modo Gemini.
  // Override por URL: ?simli=1 / ?simli=0 (ver utils/simliFlag.ts).
  readonly VITE_SIMLI_AVATAR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
