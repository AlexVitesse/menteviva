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

// Analisis de habilidades
export interface SkillAnalysis {
  id: string;
  name: string;
  score: number;
  feedback: string;
  moment: string | null;
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
