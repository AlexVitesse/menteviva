/**
 * VoiceLab — banco de pruebas de prompts POR VOZ con Gemini Live (sin video).
 *
 * Pagina tipo "llamada" que reutiliza el shell del ChatLab pero con audio
 * nativo bidireccional. Conversacion con Sofia por microfono, captions en
 * tiempo real, diagnostico al terminar, feedback, satisfaccion y export.
 *
 * No toca /api/conversation (ruta de produccion). Usa /api/chat/voice/{avatar_id}
 * (WS dedicado del lab) y reutiliza los endpoints REST de diagnostico y
 * persistencia del ChatLab de texto.
 *
 * Ver docs/plans/14_voicelab_division_tareas.md para la arquitectura.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock,
  Mic,
  MicOff,
  PhoneOff,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Info,
  Download,
  RotateCcw,
  Settings2,
  Volume2,
  Signal,
  AlertCircle,
  Sparkles,
  PersonStanding,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { isSecureOriginForMic } from "../utils/audio";
import { useVoiceLab, type VoiceLabInitPayload } from "../hooks/useVoiceLab";
import {
  type ChatMsg,
  type ChatSession,
  type DiagnosticoResponse,
  type RegistroInput,
  type SatisfactionInfo,
  DEFAULT_DURATION,
  DURATIONS,
  PROVIDER_BADGE,
} from "./chatlab/types";
import {
  CLIENT_ID,
  fmtDuration,
} from "./chatlab/helpers";
import {
  DiagnosticoModal,
  SatisfactionModal,
  FeedbackModal,
} from "./chatlab/components";
import { exportSession } from "./chatlab/export";

function loadSession(): ChatSession | null {
  try {
    const raw = localStorage.getItem("voicelab_session");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(s: ChatSession) {
  try {
    localStorage.setItem("voicelab_session", JSON.stringify(s));
  } catch {
    /* noop */
  }
}

function loadRegistro(): RegistroInput {
  try {
    const raw = localStorage.getItem("chatlab_registro");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveRegistro(r: RegistroInput) {
  try {
    localStorage.setItem("chatlab_registro", JSON.stringify(r));
  } catch {
    /* noop */
  }
}

function getChatlabToken(): string {
  return localStorage.getItem("chatlab_token") || "";
}

interface AvatarInfo {
  id: string;
  name: string;
  role?: string;
  kind?: string;
}

// ─── Subcomponente: Avatar animado con ondas de pulso ──────────────────────

function AvatarPulse({
  speaking,
  muted,
  connected,
}: {
  speaking: boolean;
  muted: boolean;
  connected: boolean;
}) {
  const rings = useMemo(() => [1, 2, 3], []);
  return (
    <div className="relative flex items-center justify-center">
      {/* Anillos de pulso */}
      {connected && (
        <AnimatePresence>
          {rings.map((i) => (
            <motion.div
              key={i}
              className="absolute w-28 h-28 rounded-full border-2"
              style={{
                borderColor:
                  muted ? "rgba(220, 38, 38, 0.3)" : "rgba(6, 182, 212, 0.25)",
              }}
              animate={
                speaking
                  ? {
                      scale: [1, 1.18 + i * 0.06, 1],
                      opacity: [0.5 - i * 0.1, 0.1, 0.5 - i * 0.1],
                    }
                  : { scale: 1, opacity: 0 }
              }
              transition={{
                repeat: Infinity,
                duration: 1.6 + i * 0.2,
                ease: "easeInOut",
              }}
            />
          ))}
        </AnimatePresence>
      )}

      {/* Círculo central con gradiente */}
      <motion.div
        className="w-24 h-24 rounded-full flex items-center justify-center text-4xl relative overflow-hidden"
        style={{
          background: muted
            ? "linear-gradient(135deg, rgba(220,38,38,0.2), rgba(220,38,38,0.08))"
            : "linear-gradient(135deg, rgba(6,182,212,0.25), rgba(124,58,237,0.15))",
          border: muted
            ? "2px solid rgba(220,38,38,0.3)"
            : "2px solid rgba(6,182,212,0.35)",
        }}
        animate={
          speaking
            ? { scale: [1, 1.05, 1] }
            : connected
            ? { scale: [1, 1.02, 1] }
            : { scale: 1 }
        }
        transition={{
          repeat: Infinity,
          duration: speaking ? 0.8 : 3,
          ease: "easeInOut",
        }}
      >
        <PersonStanding className="w-10 h-10 text-cream/90" />

        {/* Glow interior */}
        <motion.div
          className="absolute inset-0 rounded-full opacity-40"
          style={{
            background:
              muted ? "transparent" :
              "radial-gradient(circle at 30% 30%, rgba(6,182,212,0.3), transparent 70%)",
          }}
          animate={speaking ? { opacity: [0.3, 0.6, 0.3] } : { opacity: 0.2 }}
          transition={{ repeat: Infinity, duration: 1.2 }}
        />
      </motion.div>

      {/* Indicador de micrófono */}
      {connected && (
        <motion.div
          className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center"
          style={{
            background: muted
              ? "rgba(220,38,38,0.2)"
              : "rgba(22,163,74,0.2)",
            border: muted
              ? "1px solid rgba(220,38,38,0.4)"
              : "1px solid rgba(22,163,74,0.4)",
          }}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 15 }}
        >
          {muted ? (
            <MicOff className="w-3.5 h-3.5 text-danger" />
          ) : (
            <Mic className="w-3.5 h-3.5 text-success" />
          )}
        </motion.div>
      )}
    </div>
  );
}

// ─── Subcomponente: Medidor de volumen en vivo (pre-call) ──────────────────

function VolumeMeter({ analyser }: { analyser: AnalyserNode | null }) {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    function tick(a: AnalyserNode) {
      a.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i] - 128) / 128;
        sum += v;
      }
      const avg = sum / data.length;
      setLevel(Math.min(1, avg * 3));
      rafRef.current = requestAnimationFrame(() => tick(a));
    }
    tick(analyser);
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser]);

  const segments = 8;
  const active = Math.round(level * segments);

  return (
    <div className="flex items-center gap-1 h-8">
      {Array.from({ length: segments }).map((_, i) => (
        <motion.div
          key={i}
          className="w-1 rounded-full"
          style={{
            height: `${12 + (i % 3) * 6}px`,
            background:
              i < active
                ? i < segments * 0.5
                  ? "#16A34A"
                  : i < segments * 0.75
                  ? "#F97316"
                  : "#DC2626"
                : "rgba(255,255,255,0.1)",
          }}
          animate={i < active ? { opacity: [0.6, 1, 0.6] } : { opacity: 0.3 }}
          transition={{
            repeat: Infinity,
            duration: 0.6,
            delay: i * 0.05,
          }}
        />
      ))}
    </div>
  );
}

// ─── Subcomponente: Barra de controles inferior flotante ───────────────────

function CallControls({
  isActive,
  closed,
  muted,
  closingCountdown,
  onToggleMute,
  onTerminate,
  onCancelClosing,
  onDiagnostico,
  diagLoading,
  onExport,
  onReset,
  hasMessages,
  progressPct,
  elapsedMs,
  targetSeconds,
}: {
  isActive: boolean;
  closed: boolean;
  muted: boolean;
  closingCountdown: number | null;
  onToggleMute: () => void;
  onTerminate: () => void;
  onCancelClosing: () => void;
  onDiagnostico: () => void;
  diagLoading: boolean;
  onExport: () => void;
  onReset: () => void;
  hasMessages: boolean;
  progressPct: number;
  elapsedMs: number;
  targetSeconds: number;
}) {
  return (
    <motion.div
      className="w-full shrink-0 px-4 py-3"
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.2 }}
    >
      <div className="max-w-lg mx-auto space-y-3">
        {/* Barra de progreso integrada */}
        {isActive && (
          <div className="flex items-center gap-3 text-[10px] text-muted font-mono">
            <span className="shrink-0">
              {fmtDuration(elapsedMs)} / {fmtDuration(targetSeconds * 1000)}
            </span>
            <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{
                  background:
                    progressPct >= 100
                      ? "linear-gradient(90deg, #16A34A, #06B6D4)"
                      : progressPct >= 50
                      ? "linear-gradient(90deg, #06B6D4, #7C3AED)"
                      : "linear-gradient(90deg, #7C3AED, #A855F7)",
                }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>
        )}

        {/* Controles principales flotantes */}
        <div className="flex items-center justify-center gap-4">
          {/* Silenciar */}
          <button
            onClick={onToggleMute}
            disabled={!isActive}
            className="relative group"
          >
            <motion.div
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                muted
                  ? "bg-danger/20 text-danger border border-danger/30"
                  : "bg-white/5 text-cream/70 border border-white/10 hover:bg-white/10 hover:text-cream"
              }`}
              whileTap={{ scale: 0.9 }}
              whileHover={{ scale: 1.05 }}
            >
              {muted ? (
                <MicOff className="w-5 h-5" />
              ) : (
                <Mic className="w-5 h-5" />
              )}
            </motion.div>
            <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[9px] text-muted opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap font-mono">
              {muted ? "Activar mic" : "Silenciar"}
            </span>
          </button>

          {/* Countdown o Terminar */}
          {closingCountdown !== null ? (
            <div className="flex items-center gap-2 bg-warning/10 border border-warning/20 rounded-full px-4 py-2">
              <span className="text-xs text-warning font-mono">
                {closingCountdown}s
              </span>
              <button
                onClick={onCancelClosing}
                className="text-xs font-syne text-cream hover:text-teal px-2 py-1 rounded-lg transition-all"
              >
                Seguir
              </button>
            </div>
          ) : (
            <button
              onClick={onTerminate}
              disabled={!isActive}
              className="relative group"
            >
              <motion.div
                className="w-14 h-14 rounded-full bg-danger/20 text-danger border border-danger/30 flex items-center justify-center"
                whileTap={{ scale: 0.9 }}
                whileHover={{ scale: 1.05 }}
              >
                <PhoneOff className="w-5 h-5" />
              </motion.div>
              <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[9px] text-muted opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap font-mono">
                Colgar
              </span>
            </button>
          )}

          {/* Diagnóstico */}
          {!isActive && closed && !diagLoading && (
            <button onClick={onDiagnostico} className="relative group">
              <motion.div
                className="w-14 h-14 rounded-full bg-violet/20 text-violet-lighter border border-violet/30 flex items-center justify-center"
                whileTap={{ scale: 0.9 }}
                whileHover={{ scale: 1.05 }}
              >
                <Sparkles className="w-5 h-5" />
              </motion.div>
              <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[9px] text-muted opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap font-mono">
                Diagnóstico
              </span>
            </button>
          )}
        </div>

        {/* Acciones secundarias */}
        {!isActive && closed && (
          <div className="flex items-center justify-center gap-2">
            {hasMessages && (
              <button
                onClick={onExport}
                className="flex items-center gap-1.5 text-[10px] font-syne text-muted hover:text-cream px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-all"
              >
                <Download className="w-3 h-3" /> Exportar
              </button>
            )}
            <button
              onClick={onReset}
              className="flex items-center gap-1.5 text-[10px] font-syne text-muted hover:text-cream px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-all"
            >
              <RotateCcw className="w-3 h-3" /> Nueva sesión
            </button>
          </div>
        )}

        {diagLoading && (
          <div className="flex items-center justify-center gap-2 text-xs text-muted py-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Generando diagnóstico...
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Subcomponente: Burbuja de caption con glassmorphism ───────────────────

function CaptionBubble({
  caption,
  isLast,
  msgIdx,
  chatMsg,
  onFeedback,
  onOpenFeedback,
}: {
  caption: { role: "user" | "assistant"; content: string };
  isLast: boolean;
  msgIdx: number;
  chatMsg?: ChatMsg;
  onFeedback: (index: number, value: "like" | "dislike") => void;
  onOpenFeedback: (index: number, comment: string) => void;
}) {
  const isUser = caption.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[85%] sm:max-w-[75%] space-y-1 ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        <div
          className={`px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? "bg-gradient-to-br from-violet/25 to-violet/10 border border-violet/25 text-cream rounded-2xl rounded-br-md"
              : "bg-white/[0.06] backdrop-blur-sm border border-white/[0.08] text-cream/90 rounded-2xl rounded-bl-md"
          }`}
        >
          <p>{caption.content}</p>
        </div>
        {!isUser && chatMsg && isLast && (
          <div className="flex items-center gap-1 pl-1.5">
            <button
              onClick={() => onFeedback(msgIdx, "like")}
              className={`p-1 rounded-md transition-all ${
                chatMsg.feedback === "like"
                  ? "bg-success/20 text-success"
                  : "text-subtle hover:text-cream hover:bg-white/5"
              }`}
              title="Me gustó"
            >
              <ThumbsUp className="w-3 h-3" />
            </button>
            <button
              onClick={() => onFeedback(msgIdx, "dislike")}
              className={`p-1 rounded-md transition-all ${
                chatMsg.feedback === "dislike"
                  ? "bg-danger/20 text-danger"
                  : "text-subtle hover:text-cream hover:bg-white/5"
              }`}
              title="No me gustó"
            >
              <ThumbsDown className="w-3 h-3" />
            </button>
            {chatMsg.feedback === "dislike" && (
              <button
                onClick={() => {
                  onOpenFeedback(msgIdx, chatMsg.feedbackComment ?? "");
                }}
                className="p-1 rounded-md text-subtle hover:text-cream hover:bg-white/5 transition-all"
                title={
                  chatMsg.feedbackComment
                    ? "Editar comentario"
                    : "¿Por qué no te gustó?"
                }
              >
                <Info className="w-3 h-3" />
              </button>
            )}
            {chatMsg.feedbackComment && (
              <span className="text-[10px] text-subtle italic ml-1 truncate max-w-[150px]">
                &ldquo;{chatMsg.feedbackComment}&rdquo;
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────

export function VoiceLab() {
  const navigate = useNavigate();

  // ── Estado de sesion ──────────────────────────────────────────────────
  const [session, setSession] = useState<ChatSession>(() => {
    const existing = loadSession();
    if (existing && !existing.closed) return existing;
    return {
      id: `voicelab-${Date.now()}`,
      name: "VoiceLab",
      avatarId: "entrevistador",
      provider: "gemini",
      level: "principiante",
      messages: [],
      promptChars: null,
      closed: false,
      createdAt: Date.now(),
      durationMin: DEFAULT_DURATION,
    };
  });

  const [avatars, setAvatars] = useState<AvatarInfo[]>([]);
  const [savedRegistro, setSavedRegistro] = useState<RegistroInput>(loadRegistro);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [showDiag, setShowDiag] = useState(false);
  const [closingCountdown, setClosingCountdown] = useState<number | null>(null);
  const closingTimerRef = useRef<number | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const endingRef = useRef(false);
  const [showTelemetry, setShowTelemetry] = useState(false);

  // Cronometro
  const [nowTick, setNowTick] = useState(() => Date.now());
  const startRef = useRef<number>(Date.now());

  // Feedback / satisfaccion
  const [feedbackModalIndex, setFeedbackModalIndex] = useState<number | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [showSatisfaction, setShowSatisfaction] = useState(false);
  const [satRating, setSatRating] = useState(0);
  const [satHover, setSatHover] = useState(0);
  const [satComment, setSatComment] = useState("");

  // Captions visibles (ultimos N mensajes para la vista de llamada)
  const [visibleCaptions, setVisibleCaptions] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);

  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Derivados ─────────────────────────────────────────────────────────
  const selected = avatars.find((a) => a.id === session.avatarId);
  const isDiagnostico = selected?.kind === "diagnostico";
  const effectiveRegistro: RegistroInput = {
    ...savedRegistro,
    ...(session.registro || {}),
  };
  const registroCompleto = Boolean(
    effectiveRegistro.nombre?.trim() && effectiveRegistro.rol_objetivo?.trim()
  );

  const elapsedMs = session.startedAt
    ? (session.completedAt ?? nowTick) - session.startedAt
    : 0;
  const targetSeconds = (session.durationMin ?? DEFAULT_DURATION) * 60;
  const progressComplete = session.closed || elapsedMs >= targetSeconds * 1000;
  const progressPct = progressComplete
    ? 100
    : Math.round((elapsedMs / (targetSeconds * 1000)) * 100);

  const errorLog = session.errorLog ?? [];
  const token = getChatlabToken();
  const isActive = !session.closed && sessionStarted;

  // ── Cargar avatares ───────────────────────────────────────────────────
  useEffect(() => {
    apiFetch<{ avatars: AvatarInfo[] }>("/api/chat/avatars", {
      headers: token ? { "X-ChatLab-Token": token } : undefined,
    })
      .then((data) => setAvatars(data.avatars))
      .catch(() => {});
  }, [token]);

  // ── Persistir sesion ──────────────────────────────────────────────────
  useEffect(() => {
    saveSession(session);
  }, [session]);

  // ── Cronometro ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session.startedAt || session.completedAt) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [session.startedAt, session.completedAt]);

  // ── Callbacks del hook de voz ──────────────────────────────────────────
  const updateSession = useCallback(
    (patch: Partial<ChatSession>) => {
      setSession((prev) => ({ ...prev, ...patch }));
    },
    []
  );

  const onUserMessage = useCallback((text: string) => {
    const msg: ChatMsg = { role: "user", content: text };
    setSession((prev) => {
      const next = { ...prev, messages: [...prev.messages, msg] };
      return next;
    });
    setVisibleCaptions((prev) => [
      ...prev.slice(-8),
      { role: "user", content: text },
    ]);
  }, []);

  const onAssistantMessage = useCallback((text: string) => {
    const msg: ChatMsg = { role: "assistant", content: text };
    setSession((prev) => {
      const next = { ...prev, messages: [...prev.messages, msg] };
      return next;
    });
    setVisibleCaptions((prev) => [
      ...prev.slice(-8),
      { role: "assistant", content: text },
    ]);
  }, []);

  const onStatusChange = useCallback((status: string) => {
    if (status === "disconnected") {
      if (!endingRef.current) {
        setServerError(
          "Conexión perdida. Intenta reconectar o termina la sesión."
        );
      }
    } else if (status === "ready") {
      setServerError((prev) =>
        prev ===
        "Conexión perdida. Intenta reconectar o termina la sesión."
          ? null
          : prev
      );
    }
  }, []);

  const onClosingIntent = useCallback(() => {
    setClosingCountdown(5);
  }, []);

  const onError = useCallback((msg: string) => {
    setServerError(msg);
    setSession((prev) => ({
      ...prev,
      errorLog: [
        ...(prev.errorLog ?? []),
        { at: Date.now(), message: msg },
      ],
    }));
  }, []);

  const onEnded = useCallback((vocalNote?: string) => {
    setSession((prev) => ({
      ...prev,
      closed: true,
      completedAt: prev.completedAt ?? Date.now(),
      vocalNote: vocalNote ?? prev.vocalNote,
    }));
  }, []);

  // ── Hook de voz ───────────────────────────────────────────────────────
  const voiceLab = useVoiceLab({
    avatarId: session.avatarId,
    chatlabToken: token,
    initPayload: useMemo<VoiceLabInitPayload | undefined>(() => {
      if (!effectiveRegistro.nombre && !effectiveRegistro.rol_objetivo)
        return undefined;
      return {
        user_profile: { registro: effectiveRegistro },
        session_vars: {
          minutos: session.durationMin ?? DEFAULT_DURATION,
        },
      };
    }, [effectiveRegistro, session.durationMin]),
    onUserMessage,
    onAssistantMessage,
    onStatusChange,
    onClosingIntent,
    onError,
    onEnded,
  });

  // ── Auto-scroll captions ──────────────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [visibleCaptions]);

  // ── Inicio de sesion ──────────────────────────────────────────────────
  async function handleStartSession() {
    setRequestingPermission(true);
    setPermissionError(null);

    if (!isSecureOriginForMic() || !navigator.mediaDevices?.getUserMedia) {
      const host = window.location.hostname;
      setPermissionError(
        `Tu navegador bloquea el microfono en este origen (${host}). ` +
          `En movil necesitas acceder via HTTPS — usa un tunnel (ngrok/cloudflared) ` +
          `o abre el sitio desde localhost en desktop.`
      );
      setRequestingPermission(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      stream.getTracks().forEach((t) => t.stop());
      const now = Date.now();
      endingRef.current = false;
      setSession((prev) => ({
        ...prev,
        messages: [],
        closed: false,
        startedAt: now,
        completedAt: undefined,
        errorLog: [],
      }));
      startRef.current = now;
      setSessionStarted(true);
    } catch (err) {
      const name = err instanceof Error ? err.name : "Error";
      if (
        name === "NotAllowedError" ||
        name === "PermissionDeniedError"
      ) {
        setPermissionError(
          "Necesitamos acceso al microfono. Habilitalo en los ajustes del navegador y vuelve a intentar."
        );
      } else if (
        name === "NotFoundError" ||
        name === "DevicesNotFoundError"
      ) {
        setPermissionError("No detectamos ningun microfono conectado.");
      } else {
        setPermissionError(
          "No pudimos acceder al microfono. Intenta de nuevo."
        );
      }
    } finally {
      setRequestingPermission(false);
    }
  }

  // ── Conectar WS al iniciar ────────────────────────────────────────────
  useEffect(() => {
    if (!sessionStarted) return;
    (async () => {
      try {
        await voiceLab.connect();
        await voiceLab.startMic();
      } catch (e) {
        console.error("[VoiceLab] inicio fallo:", e);
        setServerError(
          "No se pudo iniciar el microfono. Revisa los permisos del navegador."
        );
      }
    })();
    return () => {
      endingRef.current = true;
      voiceLab.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStarted]);

  // ── Countdown del cierre ──────────────────────────────────────────────
  useEffect(() => {
    if (closingCountdown === null) return;
    if (closingCountdown <= 0) {
      endingRef.current = true;
      voiceLab.endSession();
      setClosingCountdown(null);
      return;
    }
    closingTimerRef.current = window.setTimeout(() => {
      setClosingCountdown((c) => (c === null ? null : c - 1));
    }, 1000);
    return () => {
      if (closingTimerRef.current !== null) {
        window.clearTimeout(closingTimerRef.current);
      }
    };
  }, [closingCountdown, voiceLab]);

  function cancelClosing() {
    if (closingTimerRef.current !== null) {
      window.clearTimeout(closingTimerRef.current);
    }
    setClosingCountdown(null);
  }

  // ── Terminar sesion ───────────────────────────────────────────────────
  function handleTerminate() {
    endingRef.current = true;
    voiceLab.endSession();
    setSession((prev) => ({
      ...prev,
      closed: true,
      completedAt: prev.completedAt ?? Date.now(),
    }));
  }

  // ── Generar diagnostico ───────────────────────────────────────────────
  async function generateDiagnostico() {
    if (diagLoading || session.messages.length === 0) return;
    setDiagLoading(true);
    setServerError(null);
    try {
      const res = await apiFetch<DiagnosticoResponse>(
        "/api/chat/diagnostico",
        {
          method: "POST",
          headers: token ? { "X-ChatLab-Token": token } : undefined,
          json: {
            messages: session.messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            user_profile: effectiveRegistro.nombre
              ? { registro: effectiveRegistro }
              : undefined,
            session_vars: {
              minutos: session.durationMin ?? DEFAULT_DURATION,
            },
            save: true,
            vocal_note: session.vocalNote || undefined,
          },
        }
      );
      updateSession({
        diagnostico: res.diagnostico,
        saveInfo: {
          saved: res.saved,
          id: res.diagnostic_id,
          error: res.save_error,
        },
        completedAt: session.completedAt ?? Date.now(),
      });
      saveConversationToBD(session, session.messages);
      setShowDiag(true);
    } catch (e) {
      setServerError(
        (e as Error).message || "Error generando diagnóstico"
      );
    } finally {
      setDiagLoading(false);
    }
  }

  // ── Persistir conversacion en BD ──────────────────────────────────────
  function saveConversationToBD(
    sess: ChatSession,
    msgs: ChatMsg[],
    opts?: { satisfaction?: SatisfactionInfo | null }
  ) {
    if (!msgs.length) return;
    const errs = sess.errorLog ?? [];
    const durationSeconds = sess.startedAt
      ? Math.round(
          ((sess.completedAt ?? Date.now()) - sess.startedAt) / 1000
        )
      : undefined;
    apiFetch("/api/chat/conversation", {
      method: "POST",
      headers: token ? { "X-ChatLab-Token": token } : undefined,
      json: {
        session_id: `${CLIENT_ID}:${sess.id}`,
        name: sess.name,
        avatar_id: sess.avatarId,
        provider: sess.provider,
        minutos: sess.durationMin ?? DEFAULT_DURATION,
        closed: sess.closed,
        started_at: sess.startedAt
          ? new Date(sess.startedAt).toISOString()
          : undefined,
        duration_seconds: durationSeconds,
        error_count: errs.length,
        errors: errs.map((e) => ({
          at: new Date(e.at).toISOString(),
          status: e.status ?? null,
          message: e.message,
        })),
        messages: msgs.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        feedback: msgs.map((m) => m.feedback ?? null),
        feedback_comments: msgs.map((m) => m.feedbackComment ?? null),
        satisfaction: opts?.satisfaction ?? session.satisfaction
          ? {
              rating: (
                opts?.satisfaction ?? session.satisfaction
              )!.rating,
              comment: (
                opts?.satisfaction ?? session.satisfaction
              )!.comment,
              submitted_at: (
                opts?.satisfaction ?? session.satisfaction
              )!.submittedAt,
            }
          : undefined,
        user_profile: effectiveRegistro.nombre
          ? { registro: effectiveRegistro }
          : undefined,
      },
    }).catch((e) =>
      console.warn("No se pudo guardar la conversación en BD:", e)
    );
  }

  // ── Feedback por mensaje ──────────────────────────────────────────────
  function setMessageFeedback(index: number, value: "like" | "dislike") {
    const next = session.messages.map((m, i) =>
      i === index
        ? { ...m, feedback: m.feedback === value ? null : value }
        : m
    );
    updateSession({ messages: next });
    saveConversationToBD(session, next);
  }

  function saveFeedbackComment() {
    if (feedbackModalIndex === null) return;
    const idx = feedbackModalIndex;
    const text = feedbackDraft.trim();
    const next = session.messages.map((m, i) =>
      i === idx
        ? { ...m, feedbackComment: text || undefined }
        : m
    );
    updateSession({ messages: next });
    saveConversationToBD(session, next);
    setFeedbackModalIndex(null);
    setFeedbackDraft("");
  }

  // ── Satisfaccion ──────────────────────────────────────────────────────
  function submitSatisfaction() {
    if (satRating < 1) return;
    const info: SatisfactionInfo = {
      rating: satRating,
      comment: satComment.trim(),
      submittedAt: new Date().toISOString(),
    };
    updateSession({ satisfaction: info });
    saveConversationToBD(session, session.messages, {
      satisfaction: info,
    });
    setShowSatisfaction(false);
  }

  function openSatisfaction() {
    setSatRating(session.satisfaction?.rating ?? 0);
    setSatComment(session.satisfaction?.comment ?? "");
    setSatHover(0);
    setShowSatisfaction(true);
  }

  function closeDiag() {
    setShowDiag(false);
    if (!session.satisfaction) {
      openSatisfaction();
    }
  }

  // ── Registro ──────────────────────────────────────────────────────────
  function updateRegistro(patch: Partial<RegistroInput>) {
    const merged = { ...effectiveRegistro, ...patch };
    setSavedRegistro(merged);
    saveRegistro(merged);
    updateSession({ registro: merged });
  }

  // ── Export ────────────────────────────────────────────────────────────
  function handleExport() {
    exportSession(session, avatars, savedRegistro);
  }

  // ── Limpiar / nueva sesion ────────────────────────────────────────────
  function handleReset() {
    endingRef.current = true;
    voiceLab.disconnect();
    const newId = `voicelab-${Date.now()}`;
    setSession({
      id: newId,
      name: "VoiceLab",
      avatarId: "entrevistador",
      provider: "gemini",
      level: "principiante",
      messages: [],
      promptChars: null,
      closed: false,
      createdAt: Date.now(),
      durationMin: DEFAULT_DURATION,
    });
    setSessionStarted(false);
    setVisibleCaptions([]);
    setServerError(null);
    setClosingCountdown(null);
  }

  const speaking = voiceLab ? voiceLab.analyser !== null : false;

  return (
    <div className="h-screen h-dvh overflow-hidden bg-ink text-cream flex flex-col font-sans">
      {/* ── Header ────────────────────────────────────────────────── */}
      <header className="border-b border-white/[0.04] bg-deep/60 backdrop-blur-xl px-4 sm:px-6 py-3 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-3">
          <motion.div
            className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal/20 to-violet/20 border border-teal/20 flex items-center justify-center"
            whileHover={{ scale: 1.05 }}
          >
            <Volume2 className="w-4 h-4 text-teal" />
          </motion.div>
          <div>
            <h1 className="font-syne font-bold text-sm tracking-wide">
              VoiceLab
            </h1>
            <p className="text-[10px] text-muted font-mono">
              Gemini Live · Audio nativo
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Cronometro - siempre visible durante llamada */}
          {isActive && (
            <motion.div
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] rounded-full border border-white/[0.06]"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <Clock className="w-3 h-3 text-muted" />
              <span className="text-xs font-mono text-cream tabular-nums">
                {fmtDuration(elapsedMs)}
              </span>
              <span className="text-[10px] text-subtle">/</span>
              <span className="text-[10px] text-subtle font-mono tabular-nums">
                {fmtDuration(targetSeconds * 1000)}
              </span>
            </motion.div>
          )}

          {/* Telemetría toggle */}
          {sessionStarted && (
            <button
              onClick={() => setShowTelemetry((v) => !v)}
              className={`p-2 rounded-lg transition-all ${
                showTelemetry
                  ? "bg-teal/15 text-teal border border-teal/25"
                  : "text-muted hover:text-cream hover:bg-white/5 border border-transparent"
              }`}
              title="Telemetría"
            >
              <Settings2 className="w-4 h-4" />
            </button>
          )}

          {/* Navegación */}
          <button
            onClick={() => navigate("/chat-lab")}
            className="text-[10px] font-syne text-muted hover:text-cream px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-all"
          >
            ← Texto
          </button>
          <button
            onClick={() => window.history.back()}
            className="text-[10px] font-syne text-muted hover:text-cream px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-all"
          >
            Dashboard
          </button>
        </div>
      </header>

      {/* ── Error banner ──────────────────────────────────────────── */}
      <AnimatePresence>
        {serverError && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-warning/15 border-b border-warning/25 px-4 py-2.5 text-center text-xs sm:text-sm text-warning flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{serverError}</span>
              <button
                onClick={() => setServerError(null)}
                className="underline opacity-70 hover:opacity-100 shrink-0"
              >
                Cerrar
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Overlay de inicio (pre-call) ──────────────────────────── */}
      {!sessionStarted && (
        <div className="flex-1 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <motion.div
            className="w-full max-w-lg mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            {/* Card principal */}
            <div className="bg-card/80 backdrop-blur-sm rounded-3xl border border-white/[0.08] p-6 sm:p-8 text-center space-y-6">
              {/* Avatar grande + pulso */}
              <motion.div
                className="relative inline-flex"
                animate={{ scale: [1, 1.03, 1] }}
                transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
              >
                <div
                  className="w-20 h-20 mx-auto rounded-2xl flex items-center justify-center text-4xl"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(124,58,237,0.15))",
                    border: "1px solid rgba(6,182,212,0.25)",
                  }}
                >
                  <PersonStanding className="w-9 h-9 text-cream/80" />
                </div>
                <motion.div
                  className="absolute -inset-2 rounded-2xl opacity-30"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(124,58,237,0.1))",
                    filter: "blur(12px)",
                  }}
                  animate={{ opacity: [0.2, 0.4, 0.2] }}
                  transition={{
                    repeat: Infinity,
                    duration: 2.5,
                    ease: "easeInOut",
                  }}
                />
              </motion.div>

              <div className="space-y-1.5">
                <h2 className="font-syne font-bold text-cream text-xl tracking-tight">
                  {selected?.name || "Sofia"}
                </h2>
                <p className="text-sm text-muted leading-relaxed max-w-sm mx-auto">
                  Habla con Sofia por micrófono. Una conversación natural para
                  explorar tus habilidades blandas.
                </p>
              </div>

              {/* Selector de avatar (si hay múltiples) */}
              {avatars.length > 1 && (
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {avatars.map((a) => (
                    <button
                      key={a.id}
                      onClick={() =>
                        setSession((prev) => ({
                          ...prev,
                          avatarId: a.id,
                        }))
                      }
                      className={`px-3 py-1.5 rounded-xl text-xs font-syne transition-all border ${
                        session.avatarId === a.id
                          ? "bg-teal/15 text-teal border-teal/30"
                          : "text-muted border-white/10 hover:bg-white/5 hover:text-cream"
                      }`}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Selector de duración de la práctica (25/40/60, igual que ChatLab).
                  Alimenta el ritmo del diagnóstico y se manda como session_vars.minutos
                  al abrir la sesión Live (ver useVoiceLab / session_vars). */}
              <div className="space-y-2">
                <p className="text-[10px] text-muted font-mono uppercase tracking-widest text-center">
                  Duración de la práctica
                </p>
                <div className="flex items-center justify-center gap-2">
                  {DURATIONS.map((d) => (
                    <button
                      key={d}
                      onClick={() => updateSession({ durationMin: d })}
                      className={`px-4 py-1.5 rounded-xl text-xs font-syne transition-all border ${
                        (session.durationMin ?? DEFAULT_DURATION) === d
                          ? "bg-teal/15 text-teal border-teal/30"
                          : "text-muted border-white/10 hover:bg-white/5 hover:text-cream"
                      }`}
                    >
                      {d} min
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-subtle text-center leading-relaxed">
                  Marca el ritmo del diagnóstico. Nota: Gemini Live puede cerrar la
                  sesión de voz cerca de los ~15 min.
                </p>
              </div>

              {/* Registro rápido */}
              {isDiagnostico && !registroCompleto && (
                <div className="space-y-3 text-left">
                  <p className="text-[10px] text-muted font-mono uppercase tracking-widest">
                    Tus datos para el diagnóstico
                  </p>
                  <div className="relative">
                    <input
                      type="text"
                      value={effectiveRegistro.nombre || ""}
                      onChange={(e) =>
                        updateRegistro({ nombre: e.target.value })
                      }
                      placeholder="Tu nombre"
                      className="w-full bg-ink/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-cream placeholder-subtle focus:outline-none focus:border-teal/50 focus:ring-1 focus:ring-teal/30 transition-all"
                    />
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      value={effectiveRegistro.rol_objetivo || ""}
                      onChange={(e) =>
                        updateRegistro({ rol_objetivo: e.target.value })
                      }
                      placeholder="Rol objetivo (ej. Gerente de Ventas)"
                      className="w-full bg-ink/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-cream placeholder-subtle focus:outline-none focus:border-teal/50 focus:ring-1 focus:ring-teal/30 transition-all"
                    />
                  </div>
                </div>
              )}

              {/* Error de permiso */}
              <AnimatePresence>
                {permissionError && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="p-3 bg-danger/10 border border-danger/20 rounded-xl text-xs text-danger leading-relaxed"
                  >
                    {permissionError}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Botón de inicio */}
              <motion.button
                onClick={handleStartSession}
                disabled={
                  requestingPermission ||
                  (isDiagnostico && !registroCompleto)
                }
                className="w-full font-syne font-bold text-sm py-3.5 rounded-xl bg-gradient-to-r from-teal to-violet text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2.5 relative overflow-hidden group"
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
              >
                {requestingPermission ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />{" "}
                    Solicitando micrófono...
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4" /> Iniciar conversación
                  </>
                )}
              </motion.button>

              {/* Nota de requisitos */}
              <div className="flex items-center justify-center gap-4 text-[10px] text-subtle">
                <span className="flex items-center gap-1">
                  <Signal className="w-3 h-3" /> Microfono requerido
                </span>
                <span className="flex items-center gap-1">
                  <Volume2 className="w-3 h-3" /> Audio nativo
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── Vista de llamada activa ──────────────────────────────── */}
      {sessionStarted && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Área principal centrada */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Avatar + estado */}
            <div className="py-6 sm:py-8 flex flex-col items-center justify-center shrink-0">
              <AvatarPulse
                speaking={speaking}
                muted={micMuted}
                connected={true}
              />

              <motion.div
                className="mt-4 text-center space-y-1"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
              >
                <h2 className="font-syne font-bold text-cream text-base">
                  {selected?.name || "Sofia"}
                </h2>
                <motion.p
                  className="text-xs text-muted"
                  key={
                    session.closed
                      ? "closed"
                      : !voiceLab?.hasGreeted
                      ? "connecting"
                      : micMuted
                      ? "muted"
                      : "listening"
                  }
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {session.closed
                    ? "Sesión finalizada"
                    : !voiceLab?.hasGreeted
                    ? "Conectando..."
                    : micMuted
                    ? "Micrófono en silencio"
                    : "Escuchando..."}
                </motion.p>

                {/* Medidor de volumen cuando hay analyser */}
                {voiceLab?.analyser && isActive && (
                  <div className="flex justify-center mt-1">
                    <VolumeMeter analyser={voiceLab.analyser} />
                  </div>
                )}
              </motion.div>
            </div>

            {/* Captions scrollables */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-4 sm:px-8 pb-2 space-y-3 min-h-0 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
            >
              {visibleCaptions.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <motion.p
                    className="text-subtle text-xs text-center"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                  >
                    Los captions aparecerán aquí cuando empiece la
                    conversación...
                  </motion.p>
                </div>
              )}
              <div className="max-w-2xl mx-auto space-y-3 pb-4">
                <AnimatePresence initial={false}>
                  {visibleCaptions.map((c, i) => {
                    const msgIdx =
                      c.role === "assistant"
                        ? session.messages.findIndex(
                            (m) =>
                              m.role === "assistant" &&
                              m.content === c.content
                          )
                        : -1;
                    const msg =
                      msgIdx >= 0 ? session.messages[msgIdx] : null;
                    return (
                      <CaptionBubble
                        key={`${c.role}-${i}-${c.content.slice(0, 20)}`}
                        caption={c}
                        isLast={i === visibleCaptions.length - 1}
                        msgIdx={msgIdx}
                        chatMsg={msg ?? undefined}
                        onFeedback={setMessageFeedback}
                        onOpenFeedback={(idx, comment) => {
                          setFeedbackDraft(comment);
                          setFeedbackModalIndex(idx);
                        }}
                      />
                    );
                  })}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* ── Barra de controles inferior ─────────────────────── */}
          <div className="shrink-0 border-t border-white/[0.04] bg-deep/40 backdrop-blur-md">
            <CallControls
              isActive={isActive}
              closed={session.closed}
              muted={micMuted}
              closingCountdown={closingCountdown}
              onToggleMute={() => {
                setMicMuted((m) => {
                  voiceLab.setMicMuted(!m);
                  return !m;
                });
              }}
              onTerminate={handleTerminate}
              onCancelClosing={cancelClosing}
              onDiagnostico={generateDiagnostico}
              diagLoading={diagLoading}
              onExport={handleExport}
              onReset={handleReset}
              hasMessages={session.messages.length > 0}
              progressPct={progressPct}
              elapsedMs={elapsedMs}
              targetSeconds={targetSeconds}
            />
          </div>
        </div>
      )}

      {/* ── Panel de telemetría (overlay lateral) ──────────────── */}
      <AnimatePresence>
        {showTelemetry && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-ink/60 backdrop-blur-sm"
            onClick={() => setShowTelemetry(false)}
          >
            <motion.div
              initial={{ x: 320 }}
              animate={{ x: 0 }}
              exit={{ x: 320 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="absolute right-0 top-0 bottom-0 w-full max-w-sm bg-deep border-l border-white/10 p-6 overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-syne font-bold text-sm text-cream flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-muted" /> Telemetría
                </h3>
                <button
                  onClick={() => setShowTelemetry(false)}
                  className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-muted hover:text-cream flex items-center justify-center transition-all text-xs"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4 text-[11px]">
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-1.5 border-b border-white/5">
                    <span className="text-muted">Proveedor</span>
                    <span
                      className={`px-2 py-0.5 rounded-full border text-[10px] font-mono ${
                        PROVIDER_BADGE[session.provider]?.cls || ""
                      }`}
                    >
                      {PROVIDER_BADGE[session.provider]?.label ||
                        session.provider}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b border-white/5">
                    <span className="text-muted">Mensajes</span>
                    <span className="text-cream font-mono">
                      {session.messages.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b border-white/5">
                    <span className="text-muted">Duración</span>
                    <span className="text-cream font-mono">
                      {fmtDuration(elapsedMs)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b border-white/5">
                    <span className="text-muted">Errores</span>
                    <span className="text-cream font-mono">
                      {errorLog.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b border-white/5">
                    <span className="text-muted">Costo</span>
                    <span className="text-subtle font-mono">
                      N/A (Gemini Live)
                    </span>
                  </div>
                </div>

                {session.vocalNote && (
                  <div className="pt-2 space-y-1.5">
                    <span className="text-muted text-[10px] font-mono uppercase tracking-wider">
                      Señal vocal (experimental)
                    </span>
                    <p className="text-cream/80 italic leading-relaxed text-xs bg-white/[0.03] rounded-xl p-3 border border-white/5">
                      &ldquo;{session.vocalNote}&rdquo;
                    </p>
                  </div>
                )}

                {/* Acciones rápidas */}
                <div className="space-y-2 pt-4 border-t border-white/5">
                  {session.messages.length > 0 && (
                    <button
                      onClick={() => {
                        handleExport();
                        setShowTelemetry(false);
                      }}
                      className="w-full flex items-center justify-center gap-2 text-[11px] font-syne text-muted hover:text-cream px-3 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 transition-all"
                    >
                      <Download className="w-3.5 h-3.5" /> Exportar a
                      Markdown
                    </button>
                  )}
                  <button
                    onClick={() => {
                      handleReset();
                      setShowTelemetry(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 text-[11px] font-syne text-muted hover:text-cream px-3 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 transition-all"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Nueva sesión
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Modales ──────────────────────────────────────────────── */}
      {session.diagnostico && showDiag && (
        <DiagnosticoModal
          diagnostico={session.diagnostico}
          saveInfo={session.saveInfo}
          satisfaction={session.satisfaction}
          nombre={effectiveRegistro.nombre}
          onClose={closeDiag}
          onOpenSatisfaction={openSatisfaction}
        />
      )}

      {feedbackModalIndex !== null && (
        <FeedbackModal
          draft={feedbackDraft}
          setDraft={setFeedbackDraft}
          hasExistingComment={Boolean(
            session.messages[feedbackModalIndex]?.feedbackComment
          )}
          onClear={() => {
            if (feedbackModalIndex !== null) {
              setMessageFeedback(feedbackModalIndex, "dislike");
            }
            setFeedbackModalIndex(null);
            setFeedbackDraft("");
          }}
          onCancel={() => {
            setFeedbackModalIndex(null);
            setFeedbackDraft("");
          }}
          onSave={saveFeedbackComment}
        />
      )}

      {showSatisfaction && (
        <SatisfactionModal
          rating={satRating}
          hover={satHover}
          comment={satComment}
          setRating={setSatRating}
          setHover={setSatHover}
          setComment={setSatComment}
          onClose={() => setShowSatisfaction(false)}
          onSubmit={submitSatisfaction}
        />
      )}
    </div>
  );
}
