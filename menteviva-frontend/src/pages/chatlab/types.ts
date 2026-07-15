/**
 * Tipos y constantes compartidos entre el ChatLab (texto) y el VoiceLab (voz).
 *
 * Extraidos de ChatLab.tsx sin cambios de logica para que ambas paginas
 * compartan el mismo modelo de sesion, telemetria y persistencia. Ver
 * docs/plans/14_voicelab_division_tareas.md.
 */

export interface AvatarInfo {
  id: string;
  name: string;
  role?: string;
  kind?: string; // "diagnostico" (Sofia) | "practica"
  supports_levels?: boolean;
}

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  latencyMs?: number; // solo en mensajes del avatar (ruta texto)
  feedback?: "like" | "dislike" | null; // valoracion manual de la respuesta del avatar
  // Comentario del usuario al dar 👎: el "por qué no me gustó". Alimenta la
  // evaluacion de prompts. Vive junto al mensaje y se persiste en BD.
  feedbackComment?: string;
  // Tokens y costo estimado del turno (solo ruta texto; puede faltar si el
  // proveedor no reportó usage o el modelo no está tarifado). La ruta de voz
  // (Gemini Live) NO los pobla — la UI ya tolera undefined.
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface ChatResponse {
  reply: string;
  closing: boolean;
  prompt_chars: number;
  provider: string;
  model_name: string;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
}

export interface RegistroInput {
  nombre?: string;
  email?: string;
  rol_objetivo?: string;
  industria?: string;
  experience_level?: string;
}

export interface Diagnostico {
  completed_at: string;
  resumen_ejecutivo?: string;
  competencias_foco: string[];
  strengths: { skill: string; evidence: string; why_matters: string }[];
  gaps: { skill: string; evidence: string; impact: string; micro_practice: string }[];
  blind_spot: string;
  reflection_question: string;
  coach_note?: string;
  verbal_patterns: {
    vague_verbs_detected: string[];
    we_vs_i_tendency: string;
    filler_frequency: string;
  };
  recommended_next_scenario: string;
  recommended_next_level: string;
  is_demo?: boolean;
}

export interface DiagnosticoResponse {
  diagnostico: Diagnostico;
  latency_ms: number;
  saved: boolean;
  diagnostic_id: number | null;
  save_error: string | null;
}

// Resultado de la persistencia en BD del diagnóstico (por sesión).
export interface SaveInfo {
  saved: boolean;
  id: number | null;
  error: string | null;
}

// Encuesta de satisfacción del diagnóstico (estrellas + comentario opcional).
export interface SatisfactionInfo {
  rating: number; // 1-5 estrellas
  comment: string;
  submittedAt: string; // ISO
}

// Un error del proveedor/servidor ocurrido durante la sesión (502, 429, 401…).
export interface SessionError {
  at: number; // epoch ms del fallo
  status?: number; // HTTP status (502, 429, 401…) si lo trae el ApiError
  message: string;
}

// Motor del LLM a evaluar. "gemini" reproduce el prompt conciso + addendum de
// voz contra el modelo Gemini de texto; "groq" = prompt maestro + gpt-oss;
// "chatgpt" = OpenAI. La ruta de VOZ (VoiceLab) usa siempre "gemini".
export type Provider = "groq" | "gemini" | "chatgpt";

export interface ChatSession {
  id: string;
  name: string;
  avatarId: string;
  provider: Provider;
  selectedModel?: string | null;
  level: string;
  messages: ChatMsg[];
  promptChars: number | null;
  modelName?: string | null;
  closed: boolean;
  createdAt: number;
  registro?: RegistroInput;
  durationMin?: number;
  diagnostico?: Diagnostico | null;
  saveInfo?: SaveInfo | null;
  satisfaction?: SatisfactionInfo | null;
  startedAt?: number;
  completedAt?: number;
  errorLog?: SessionError[];
}

export const LEVELS = ["principiante", "intermedio", "avanzado"];

// Duraciones de práctica ofrecidas (igual que el GPT de referencia: 25/40/60).
export const DURATIONS = [25, 40, 60];
export const DEFAULT_DURATION = 25;

export const PROVIDER_MODELS = {
  groq: [
    { id: "openai/gpt-oss-20b", name: "gpt-oss-20b (Reasoning - Default)" },
    { id: "openai/gpt-oss-120b", name: "gpt-oss-120b (el del análisis)" },
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B (Versatile/JSON)" },
    { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B (Fast — ojo TPM)" },
  ],
  gemini: [
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash (GA - Default)" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview - Reasoning)" },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite (Rápido)" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Legacy)" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (Legacy - Reasoning)" },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite (Legacy)" },
  ],
  chatgpt: [
    { id: "gpt-5.5", name: "GPT-5.5 (Frontier)" },
    { id: "gpt-5.4", name: "GPT-5.4 (Balanced)" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini (Fast/Economic)" },
    { id: "gpt-5.4-nano", name: "GPT-5.4 Nano (Fastest)" },
    { id: "gpt-4o", name: "GPT-4o (Legacy)" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini (Legacy)" },
    { id: "gpt-4.1", name: "GPT-4.1 (Legacy)" },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini (Legacy)" },
  ],
};

// Etiqueta + color por proveedor, para el badge de "con qué LLM se hizo".
export const PROVIDER_BADGE: Record<Provider, { label: string; cls: string }> = {
  gemini: { label: "Gemini", cls: "bg-teal/10 text-teal border-teal/25" },
  groq: { label: "Groq", cls: "bg-violet/10 text-violet-lighter border-violet/25" },
  chatgpt: { label: "GPT", cls: "bg-success/10 text-success border-success/25" },
};
