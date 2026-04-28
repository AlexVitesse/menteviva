export interface Avatar {
  id: string;
  name: string;
  role: string;
  company: string;
  personality: string;
  voice: string;
  avatar_type?: string; // "animated" para avatares SVG animados
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

// Analisis de habilidades / KPIs.
// El backend ahora envia 6 KPIs por escenario con peso (suma 100). Los campos
// `weight`, `indicators_met` e `indicators_missed` son opcionales para mantener
// compatibilidad con respuestas antiguas o de demo.
export interface SkillAnalysis {
  id: string;
  name: string;
  score: number;
  feedback: string;
  moment: string | null;
  weight?: number;
  indicators_met?: string[];
  indicators_missed?: string[];
}

export interface KeyMoment {
  quote: string;
  analysis: string;
  type: "positive" | "negative" | "neutral";
}

export interface ConversationAnalysis {
  overall_score: number;
  overall_summary: string;
  skills: SkillAnalysis[];
  strengths: string[];
  improvements: string[];
  key_moments: KeyMoment[];
  next_steps: string[];
  avatar_id?: string;
  scenario_type?: string;
  error?: boolean;
}

export interface SessionMetrics {
  total_exchanges: number;
  duration_seconds?: number;
  conversation: Message[] | Array<{ role: string; content: string }>;
  analysis?: ConversationAnalysis;
  user_profile_update?: Diagnostico | null;
  is_fallback?: boolean;
  error?: string;
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "transcribing"
  | "thinking"
  | "generating_audio"
  | "analyzing"
  | "ready";

// ============================================================
// UserProfile — espejo de menteviva-backend/app/models/user_profile.py
// Cualquier cambio aqui debe reflejarse alla.
// ============================================================

export type ExperienceLevel =
  | "entry"
  | "junior"
  | "mid"
  | "senior"
  | "lead"
  | "executive";

export type VerbalTendency = "alta" | "media" | "baja";

export type RecommendedScenario = "roberto" | "maria";

export type RecommendedLevel = "facil" | "intermedio" | "dificil";

export interface Registro {
  nombre: string;
  email?: string;
  rol_objetivo: string;
  industria: string;
  experience_level: ExperienceLevel;
}

export interface Strength {
  skill: string;
  evidence: string;
  why_matters: string;
}

export interface Gap {
  skill: string;
  evidence: string;
  impact: string;
  micro_practice: string;
}

export interface VerbalPatterns {
  vague_verbs_detected: string[];
  we_vs_i_tendency: VerbalTendency;
  filler_frequency: VerbalTendency;
}

export interface Diagnostico {
  completed_at: string; // ISO8601
  competencias_foco: string[];
  strengths: Strength[];
  gaps: Gap[];
  blind_spot: string;
  reflection_question: string;
  verbal_patterns: VerbalPatterns;
  recommended_next_scenario: RecommendedScenario;
  recommended_next_level: RecommendedLevel;
  is_demo?: boolean;
}

export interface UserProfile {
  user_id: string;
  created_at: string; // ISO8601
  updated_at: string; // ISO8601
  registro: Registro;
  diagnostico: Diagnostico | null;
}
