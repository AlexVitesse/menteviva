import { motion } from "framer-motion";
import { Brain, Loader2, Mic, PauseCircle, Volume2 } from "lucide-react";

// De quién es el turno en una llamada de voz con un avatar. Lo comparten
// Simulation y Diagnostico para que el usuario siempre sepa cuándo hablar.
export type IndicatorState =
  | "loading"
  | "preparing"
  | "listening" // manos libres: habla cuando quieras
  | "yourTurn" // push-to-talk: mantén presionado para hablar
  | "userSpeaking"
  | "processing"
  | "avatarSpeaking"
  | "paused";

function config(state: IndicatorState, name: string) {
  switch (state) {
    case "loading":
      return { label: "Iniciando micrófono", sublabel: "Cargando detector de voz…", icon: Loader2, color: "text-muted bg-white/5 border-white/10", pulse: false };
    case "preparing":
      return { label: `Conectando con ${name}`, sublabel: "Te va a saludar, escucha un momento…", icon: Loader2, color: "text-violet-light bg-violet/10 border-violet/30", pulse: false };
    case "listening":
      return { label: "Te escucho", sublabel: "Habla cuando quieras, sin presionar nada", icon: Mic, color: "text-success bg-success/10 border-success/30", pulse: true };
    case "yourTurn":
      return { label: "Tu turno", sublabel: "Mantén presionado el micrófono (o la barra espaciadora)", icon: Mic, color: "text-success bg-success/10 border-success/30", pulse: false };
    case "userSpeaking":
      return { label: "Estás hablando", sublabel: "Se envía cuando termines", icon: Mic, color: "text-success bg-success/20 border-success/50", pulse: true };
    case "processing":
      return { label: "Procesando", sublabel: `${name} está pensando su respuesta…`, icon: Brain, color: "text-violet-light bg-violet/10 border-violet/30", pulse: false };
    case "avatarSpeaking":
      return { label: `${name} está hablando`, sublabel: "Espera a que termine para responder", icon: Volume2, color: "text-teal bg-teal/10 border-teal/30", pulse: true };
    case "paused":
      return { label: "En pausa", sublabel: "El micrófono está inactivo", icon: PauseCircle, color: "text-muted bg-white/5 border-white/10", pulse: false };
  }
}

export function ConversationIndicator({ state, avatarName }: { state: IndicatorState; avatarName: string }) {
  const cfg = config(state, avatarName);
  const Icon = cfg.icon;
  const isLoading = state === "loading" || state === "preparing";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`shrink-0 rounded-2xl border p-3 flex items-center gap-3 backdrop-blur-md ${cfg.color} transition-colors`}
    >
      <div className="relative shrink-0" aria-hidden>
        {cfg.pulse && (
          <motion.div
            initial={{ scale: 1, opacity: 0.4 }}
            animate={{ scale: 1.6, opacity: 0 }}
            transition={{ repeat: Infinity, duration: 1.4 }}
            className="absolute inset-0 rounded-full bg-current"
          />
        )}
        <div className="relative w-10 h-10 rounded-full bg-current/20 flex items-center justify-center">
          <Icon className={`w-5 h-5 ${isLoading ? "animate-spin" : ""}`} />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-syne font-bold text-sm">{cfg.label}</p>
        <p className="text-xs opacity-70 truncate">{cfg.sublabel}</p>
      </div>
    </div>
  );
}
