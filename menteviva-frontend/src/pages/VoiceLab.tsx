/**
 * VoiceLab — banco de pruebas de prompts POR VOZ con Gemini Live (sin video).
 *
 * Página tipo "llamada" que reutiliza el shell del ChatLab pero con audio
 * nativo bidireccional. Conversación con Sofia por micrófono, captions en
 * tiempo real, diagnóstico al terminar, feedback 👍/👎, satisfacción y export.
 *
 * No toca /api/conversation (ruta de producción). Usa /api/chat/voice/{avatar_id}
 * (WS dedicado del lab) y reutiliza los endpoints REST de diagnóstico y
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
  PROVIDER_BADGE,
} from "./chatlab/types";
import {
  CLIENT_ID,
  fmtDuration,
  targetExchanges,
  userTurns,
} from "./chatlab/helpers";
import {
  CollapsibleSection,
  DiagnosticoModal,
  SatisfactionModal,
  FeedbackModal,
} from "./chatlab/components";
import { exportSession } from "./chatlab/export";

// Sesión惟一 del VoiceLab (una sesión a la vez, como Diagnostico.tsx).
// Se persiste en localStorage bajo la key "voicelab_session".
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

// Registro cacheado global (mismo que ChatLab).
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

// Token del ChatLab (mismo guard en el backend).
function getChatlabToken(): string {
  return localStorage.getItem("chatlab_token") || "";
}

// Avatares del catálogo (se cargan del backend).
interface AvatarInfo {
  id: string;
  name: string;
  role?: string;
  kind?: string;
}

export function VoiceLab() {
  const navigate = useNavigate();

  // ── Estado de sesión ──────────────────────────────────────────────────
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
  // Marca que el cierre del WS es INTENCIONAL (Terminar / cierre de Sofia /
  // reset / desmontaje). Sin esto, el ws.onclose normal disparaba un falso
  // banner "Conexión perdida" tras terminar la sesión limpiamente.
  const endingRef = useRef(false);

  // Cronómetro.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const startRef = useRef<number>(Date.now());

  // Feedback / satisfacción.
  const [feedbackModalIndex, setFeedbackModalIndex] = useState<number | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [showSatisfaction, setShowSatisfaction] = useState(false);
  const [satRating, setSatRating] = useState(0);
  const [satHover, setSatHover] = useState(0);
  const [satComment, setSatComment] = useState("");

  // Captions visibles (últimos N mensajes para la vista de llamada).
  const [visibleCaptions, setVisibleCaptions] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);

  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Derivados ─────────────────────────────────────────────────────────
  const selected = avatars.find((a) => a.id === session.avatarId);
  const isDiagnostico = selected?.kind === "diagnostico";
  const effectiveRegistro: RegistroInput = { ...savedRegistro, ...(session.registro || {}) };
  const registroCompleto = Boolean(
    effectiveRegistro.nombre?.trim() && effectiveRegistro.rol_objetivo?.trim()
  );

  const exchanges = userTurns(session.messages);
  const progressTarget = targetExchanges(session.durationMin ?? DEFAULT_DURATION);
  const reachedTarget = exchanges >= progressTarget;
  const progressComplete = session.closed || reachedTarget;
  const progressPct = progressComplete ? 100 : Math.round((exchanges / progressTarget) * 100);

  const elapsedMs = session.startedAt
    ? (session.completedAt ?? nowTick) - session.startedAt
    : 0;
  const targetSeconds = (session.durationMin ?? DEFAULT_DURATION) * 60;

  const errorLog = session.errorLog ?? [];
  const token = getChatlabToken();

  // ── Cargar avatares ───────────────────────────────────────────────────
  useEffect(() => {
    apiFetch<{ avatars: AvatarInfo[] }>("/api/chat/avatars", {
      headers: token ? { "X-ChatLab-Token": token } : undefined,
    })
      .then((data) => setAvatars(data.avatars))
      .catch(() => {});
  }, [token]);

  // ── Persistir sesión ──────────────────────────────────────────────────
  useEffect(() => {
    saveSession(session);
  }, [session]);

  // ── Cronómetro ────────────────────────────────────────────────────────
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

  const onUserMessage = useCallback(
    (text: string) => {
      const msg: ChatMsg = { role: "user", content: text };
      setSession((prev) => {
        const next = { ...prev, messages: [...prev.messages, msg] };
        return next;
      });
      setVisibleCaptions((prev) => [...prev.slice(-8), { role: "user", content: text }]);
    },
    []
  );

  const onAssistantMessage = useCallback(
    (text: string) => {
      const msg: ChatMsg = { role: "assistant", content: text };
      setSession((prev) => {
        const next = { ...prev, messages: [...prev.messages, msg] };
        return next;
      });
      setVisibleCaptions((prev) => [...prev.slice(-8), { role: "assistant", content: text }]);
    },
    []
  );

  const onStatusChange = useCallback(
    (status: string) => {
      if (status === "disconnected") {
        // Solo es un problema si NO estábamos cerrando a propósito.
        if (!endingRef.current) {
          setServerError("Conexión perdida. Intenta reconectar o termina la sesión.");
        }
      } else if (status === "ready") {
        // Reconexión exitosa: limpiar cualquier banner de desconexión previo.
        setServerError((prev) =>
          prev === "Conexión perdida. Intenta reconectar o termina la sesión." ? null : prev
        );
      }
    },
    []
  );

  const onClosingIntent = useCallback(() => {
    setClosingCountdown(5);
  }, []);

  const onError = useCallback((msg: string) => {
    setServerError(msg);
    // Registrar el fallo en el errorLog de la sesión (métrica de fiabilidad,
    // igual que el ChatLab de texto): alimenta la telemetría y el error_count
    // que se persiste en BD. Los errores del WS de voz no traen HTTP status.
    setSession((prev) => ({
      ...prev,
      errorLog: [...(prev.errorLog ?? []), { at: Date.now(), message: msg }],
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
      if (!effectiveRegistro.nombre && !effectiveRegistro.rol_objetivo) return undefined;
      return {
        user_profile: { registro: effectiveRegistro },
        session_vars: { minutos: session.durationMin ?? DEFAULT_DURATION },
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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [visibleCaptions]);

  // ── Inicio de sesión ──────────────────────────────────────────────────
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      // Arrancar cronómetro y sesión.
      const now = Date.now();
      endingRef.current = false; // sesión nueva: reactivar la detección de desconexión
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
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setPermissionError(
          "Necesitamos acceso al microfono. Habilitalo en los ajustes del navegador y vuelve a intentar."
        );
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setPermissionError("No detectamos ningun microfono conectado.");
      } else {
        setPermissionError("No pudimos acceder al microfono. Intenta de nuevo.");
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
        setServerError("No se pudo iniciar el microfono. Revisa los permisos del navegador.");
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

  // ── Terminar sesión ───────────────────────────────────────────────────
  function handleTerminate() {
    endingRef.current = true;
    voiceLab.endSession();
    setSession((prev) => ({
      ...prev,
      closed: true,
      completedAt: prev.completedAt ?? Date.now(),
    }));
  }

  // ── Generar diagnóstico ───────────────────────────────────────────────
  async function generateDiagnostico() {
    if (diagLoading || session.messages.length === 0) return;
    setDiagLoading(true);
    setServerError(null);
    try {
      const res = await apiFetch<DiagnosticoResponse>("/api/chat/diagnostico", {
        method: "POST",
        headers: token ? { "X-ChatLab-Token": token } : undefined,
        json: {
          messages: session.messages.map((m) => ({ role: m.role, content: m.content })),
          user_profile: effectiveRegistro.nombre
            ? { registro: effectiveRegistro }
            : undefined,
          session_vars: { minutos: session.durationMin ?? DEFAULT_DURATION },
          save: true,
          vocal_note: session.vocalNote || undefined,
        },
      });
      updateSession({
        diagnostico: res.diagnostico,
        saveInfo: { saved: res.saved, id: res.diagnostic_id, error: res.save_error },
        completedAt: session.completedAt ?? Date.now(),
      });
      // Persistir en BD.
      saveConversationToBD(session, session.messages);
      setShowDiag(true);
    } catch (e) {
      setServerError((e as Error).message || "Error generando diagnóstico");
    } finally {
      setDiagLoading(false);
    }
  }

  // ── Persistir conversación en BD ──────────────────────────────────────
  function saveConversationToBD(
    sess: ChatSession,
    msgs: ChatMsg[],
    opts?: { satisfaction?: SatisfactionInfo | null }
  ) {
    if (!msgs.length) return;
    const errs = sess.errorLog ?? [];
    const durationSeconds = sess.startedAt
      ? Math.round(((sess.completedAt ?? Date.now()) - sess.startedAt) / 1000)
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
        started_at: sess.startedAt ? new Date(sess.startedAt).toISOString() : undefined,
        duration_seconds: durationSeconds,
        error_count: errs.length,
        errors: errs.map((e) => ({
          at: new Date(e.at).toISOString(),
          status: e.status ?? null,
          message: e.message,
        })),
        messages: msgs.map((m) => ({ role: m.role, content: m.content })),
        feedback: msgs.map((m) => m.feedback ?? null),
        feedback_comments: msgs.map((m) => m.feedbackComment ?? null),
        satisfaction: opts?.satisfaction ?? session.satisfaction
          ? {
              rating: (opts?.satisfaction ?? session.satisfaction)!.rating,
              comment: (opts?.satisfaction ?? session.satisfaction)!.comment,
              submitted_at: (opts?.satisfaction ?? session.satisfaction)!.submittedAt,
            }
          : undefined,
        user_profile: effectiveRegistro.nombre
          ? { registro: effectiveRegistro }
          : undefined,
      },
    }).catch((e) => console.warn("No se pudo guardar la conversación en BD:", e));
  }

  // ── Feedback por mensaje ──────────────────────────────────────────────
  function setMessageFeedback(index: number, value: "like" | "dislike") {
    const next = session.messages.map((m, i) =>
      i === index ? { ...m, feedback: m.feedback === value ? null : value } : m
    );
    updateSession({ messages: next });
    saveConversationToBD(session, next);
  }

  function saveFeedbackComment() {
    if (feedbackModalIndex === null) return;
    const idx = feedbackModalIndex;
    const text = feedbackDraft.trim();
    const next = session.messages.map((m, i) =>
      i === idx ? { ...m, feedbackComment: text || undefined } : m
    );
    updateSession({ messages: next });
    saveConversationToBD(session, next);
    setFeedbackModalIndex(null);
    setFeedbackDraft("");
  }

  // ── Satisfacción ──────────────────────────────────────────────────────
  function submitSatisfaction() {
    if (satRating < 1) return;
    const info: SatisfactionInfo = {
      rating: satRating,
      comment: satComment.trim(),
      submittedAt: new Date().toISOString(),
    };
    updateSession({ satisfaction: info });
    saveConversationToBD(session, session.messages, { satisfaction: info });
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

  // ── Limpiar / nueva sesión ────────────────────────────────────────────
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

  // ── Determinar si la sesión está activa ───────────────────────────────
  const isActive = !session.closed && sessionStarted;

  return (
    <div className="h-screen h-dvh overflow-hidden bg-ink text-cream flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-white/5 bg-deep/80 backdrop-blur-md px-6 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-teal/20 border border-teal/30 flex items-center justify-center text-lg shadow-inner">
            🎙️
          </div>
          <div>
            <h1 className="font-syne font-bold text-base tracking-wide flex items-center gap-2">
              VoiceLab
              <span className="text-[10px] uppercase tracking-widest bg-teal/20 text-teal px-1.5 py-0.5 rounded border border-teal/30 font-mono">
                Voz
              </span>
            </h1>
            <p className="text-[11px] text-muted">Gemini Live · Audio nativo sin video</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isActive && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 rounded-full">
              <Clock className="w-3.5 h-3.5 text-muted" />
              <span className="text-xs font-mono text-cream">
                {fmtDuration(elapsedMs)}
              </span>
              <span className="text-[10px] text-subtle">/</span>
              <span className="text-[10px] text-subtle font-mono">
                {fmtDuration(targetSeconds * 1000)}
              </span>
            </div>
          )}
          <button
            onClick={() => navigate("/chat-lab")}
            className="text-xs font-syne text-muted hover:text-cream px-3 py-1.5 rounded-lg border border-white/5 hover:bg-white/5 transition-all"
          >
            ← Texto
          </button>
          <button
            onClick={() => window.history.back()}
            className="text-xs font-syne text-muted hover:text-cream px-3 py-1.5 rounded-lg border border-white/5 hover:bg-white/5 transition-all"
          >
            Dashboard
          </button>
        </div>
      </header>

      {/* Progress bar (solo cuando está activa) */}
      {isActive && (
        <div className="h-1 w-full bg-white/5 overflow-hidden shrink-0">
          <motion.div
            className="h-full bg-gradient-to-r from-teal to-violet"
            animate={{ width: `${progressPct}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      )}

      {/* Banners de error */}
      {sessionStarted && voiceLab && (
        <div className="sr-only" aria-live="polite">
          {serverError}
        </div>
      )}

      {serverError && (
        <div className="bg-warning/20 border-b border-warning/40 px-4 py-2 text-center text-xs sm:text-sm text-warning shrink-0 flex items-center justify-center gap-2">
          <span>{serverError}</span>
          <button onClick={() => setServerError(null)} className="underline opacity-80 hover:opacity-100">
            Cerrar
          </button>
        </div>
      )}

      {/* Overlay de inicio (permiso mic / perfil) */}
      {!sessionStarted && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-card rounded-2xl border border-white/10 p-8 text-center space-y-6">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-teal/15 border border-teal/25 flex items-center justify-center text-3xl shadow-inner">
              🎙️
            </div>
            <div className="space-y-2">
              <h2 className="font-syne font-bold text-cream text-lg">VoiceLab</h2>
              <p className="text-sm text-muted leading-relaxed">
                Habla con Sofia por micrófono. Al terminar, recibirás el mismo diagnóstico que en el ChatLab de texto.
              </p>
            </div>

            {permissionError && (
              <div className="p-3 bg-danger/10 border border-danger/20 rounded-xl text-xs text-danger leading-relaxed">
                {permissionError}
              </div>
            )}

            {/* Registro rápido si falta */}
            {isDiagnostico && !registroCompleto && (
              <div className="space-y-3 text-left">
                <p className="text-[11px] text-muted font-mono uppercase tracking-wider">
                  Datos para el diagnóstico
                </p>
                <input
                  type="text"
                  value={effectiveRegistro.nombre || ""}
                  onChange={(e) => updateRegistro({ nombre: e.target.value })}
                  placeholder="Tu nombre"
                  className="w-full bg-ink border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-cream placeholder-subtle focus:outline-none focus:border-teal/50 focus:ring-1 focus:ring-teal/30"
                />
                <input
                  type="text"
                  value={effectiveRegistro.rol_objetivo || ""}
                  onChange={(e) => updateRegistro({ rol_objetivo: e.target.value })}
                  placeholder="Rol objetivo (ej. Gerente de Ventas)"
                  className="w-full bg-ink border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-cream placeholder-subtle focus:outline-none focus:border-teal/50 focus:ring-1 focus:ring-teal/30"
                />
              </div>
            )}

            <button
              onClick={handleStartSession}
              disabled={requestingPermission || (isDiagnostico && !registroCompleto)}
              className="w-full font-syne font-bold text-sm py-3 rounded-[10px] bg-teal text-white hover:bg-teal/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {requestingPermission ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Solicitando micrófono...
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4" /> Iniciar sesión de voz
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Vista de llamada (activa) */}
      {sessionStarted && (
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
          {/* Panel principal: indicador de estado + captions */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* Indicador de estado grande */}
            <div className="p-6 flex flex-col items-center justify-center gap-4 shrink-0">
              {/* Avatar circular con pulso */}
              <div className="relative">
                <div
                  className={`w-24 h-24 rounded-full flex items-center justify-center text-4xl transition-all duration-300 ${
                    voiceLab && voiceLab.hasGreeted
                      ? "bg-teal/20 border-2 border-teal/40"
                      : "bg-white/5 border-2 border-white/10"
                  }`}
                >
                  🧑‍💼
                </div>
                {/* Pulso cuando el avatar habla */}
                {voiceLab && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <motion.div
                      className="w-28 h-28 rounded-full border-2 border-teal/30"
                      animate={
                        voiceLab.analyser
                          ? { scale: [1, 1.15, 1], opacity: [0.5, 0.2, 0.5] }
                          : { scale: 1, opacity: 0 }
                      }
                      transition={{ repeat: Infinity, duration: 1.2 }}
                    />
                  </div>
                )}
              </div>

              <div className="text-center space-y-1">
                <h2 className="font-syne font-bold text-cream text-lg">
                  {selected?.name || "Sofia"}
                </h2>
                <p className="text-xs text-muted">
                  {session.closed
                    ? "Sesión finalizada"
                    : !voiceLab?.hasGreeted
                    ? "Conectando..."
                    : micMuted
                    ? "Micrófono en silencio"
                    : "Escuchando..."}
                </p>
              </div>
            </div>

            {/* Captions scrollables */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-6 pb-4 space-y-3 min-h-0"
            >
              {visibleCaptions.length === 0 && (
                <p className="text-subtle text-xs text-center py-8">
                  Los captions aparecerán aquí cuando empiece la conversación...
                </p>
              )}
              <AnimatePresence initial={false}>
                {visibleCaptions.map((c, i) => {
                  const msgIdx = c.role === "assistant"
                    ? session.messages.findIndex((m) => m.role === "assistant" && m.content === c.content)
                    : -1;
                  const msg = msgIdx >= 0 ? session.messages[msgIdx] : null;
                  return (
                    <motion.div
                      key={`${c.role}-${i}-${c.content.slice(0, 20)}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className={`flex ${c.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div className={`max-w-[80%] space-y-1 ${c.role === "user" ? "items-end" : "items-start"}`}>
                        <div
                          className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                            c.role === "user"
                              ? "bg-violet/20 text-violet-lighter rounded-br-md"
                              : "bg-white/5 text-cream/90 rounded-bl-md"
                          }`}
                        >
                          {c.content}
                        </div>
                        {c.role === "assistant" && msg && (
                          <div className="flex items-center gap-1 pl-1">
                            <button
                              onClick={() => setMessageFeedback(msgIdx, "like")}
                              className={`p-1 rounded-md transition-all ${
                                msg.feedback === "like"
                                  ? "bg-success/20 text-success"
                                  : "text-subtle hover:text-cream hover:bg-white/5"
                              }`}
                              title="Me gustó"
                            >
                              <ThumbsUp className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setMessageFeedback(msgIdx, "dislike")}
                              className={`p-1 rounded-md transition-all ${
                                msg.feedback === "dislike"
                                  ? "bg-danger/20 text-danger"
                                  : "text-subtle hover:text-cream hover:bg-white/5"
                              }`}
                              title="No me gustó"
                            >
                              <ThumbsDown className="w-3 h-3" />
                            </button>
                            {msg.feedback === "dislike" && (
                              <button
                                onClick={() => {
                                  setFeedbackDraft(msg.feedbackComment ?? "");
                                  setFeedbackModalIndex(msgIdx);
                                }}
                                className="p-1 rounded-md text-subtle hover:text-cream hover:bg-white/5 transition-all"
                                title={msg.feedbackComment ? "Editar comentario" : "¿Por qué no te gustó?"}
                              >
                                <Info className="w-3 h-3" />
                              </button>
                            )}
                            {msg.feedbackComment && (
                              <span className="text-[10px] text-subtle italic ml-1 truncate max-w-[150px]">
                                "{msg.feedbackComment}"
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>

          {/* Panel lateral: controles + telemetría */}
          <aside className="w-full lg:w-[340px] border-t lg:border-t-0 lg:border-l border-white/5 bg-deep/40 p-4 space-y-4 overflow-y-auto shrink-0">
            {/* Controles principales */}
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => {
                  setMicMuted((m) => {
                    voiceLab.setMicMuted(!m);
                    return !m;
                  });
                }}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                  micMuted
                    ? "bg-danger/20 text-danger border border-danger/30"
                    : "bg-teal/20 text-teal border border-teal/30"
                }`}
                title={micMuted ? "Activar micrófono" : "Silenciar micrófono"}
              >
                {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              <button
                onClick={handleTerminate}
                disabled={session.closed}
                className="w-12 h-12 rounded-full bg-danger/20 text-danger border border-danger/30 flex items-center justify-center hover:bg-danger/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                title="Terminar sesión"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </div>

            {/* Countdown del cierre */}
            {closingCountdown !== null && (
              <div className="text-center space-y-2">
                <p className="text-xs text-warning">
                  Sofia quiere cerrar la entrevista. ¿Continuar?
                </p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={cancelClosing}
                    className="text-xs font-syne text-muted hover:text-cream px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-all"
                  >
                    Seguir hablando
                  </button>
                  <span className="text-xs text-muted font-mono">{closingCountdown}s</span>
                </div>
              </div>
            )}

            {/* Barra de progreso hacia diagnóstico */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-muted font-mono uppercase tracking-wider">
                <span>Progreso diagnóstico</span>
                <span>{exchanges}/{progressTarget} intercambios</span>
              </div>
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-teal to-violet rounded-full transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Botón "Terminar y generar diagnóstico" */}
            {progressComplete && !session.diagnostico && !diagLoading && (
              <button
                onClick={generateDiagnostico}
                className="w-full font-syne font-bold text-sm py-2.5 rounded-xl bg-violet text-white hover:bg-violet-light transition-colors"
              >
                Terminar y generar diagnóstico
              </button>
            )}

            {diagLoading && (
              <div className="flex items-center justify-center gap-2 text-xs text-muted py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Generando diagnóstico...
              </div>
            )}

            {/* Telemetría colapsable */}
            <CollapsibleSection title="⚙️ Telemetría">
              <div className="space-y-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Proveedor</span>
                  <span
                    className={`px-2 py-0.5 rounded-full border text-[10px] font-mono ${
                      PROVIDER_BADGE[session.provider]?.cls || ""
                    }`}
                  >
                    {PROVIDER_BADGE[session.provider]?.label || session.provider}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Mensajes</span>
                  <span className="text-cream font-mono">{session.messages.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Duración</span>
                  <span className="text-cream font-mono">{fmtDuration(elapsedMs)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Errores</span>
                  <span className="text-cream font-mono">{errorLog.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Costo</span>
                  <span className="text-subtle font-mono">N/A (Gemini Live)</span>
                </div>
                {session.vocalNote && (
                  <div className="pt-2 mt-1 border-t border-white/5 space-y-1">
                    <span className="text-muted">Señal vocal (experimental)</span>
                    <p className="text-cream/80 italic leading-relaxed">
                      "{session.vocalNote}"
                    </p>
                  </div>
                )}
              </div>
            </CollapsibleSection>

            {/* Acciones */}
            <div className="space-y-2 pt-2 border-t border-white/5">
              {session.messages.length > 0 && (
                <button
                  onClick={handleExport}
                  className="w-full flex items-center justify-center gap-2 text-xs font-syne text-muted hover:text-cream px-3 py-2 rounded-xl border border-white/10 hover:bg-white/5 transition-all"
                >
                  <Download className="w-3.5 h-3.5" /> Exportar a Markdown
                </button>
              )}
              <button
                onClick={handleReset}
                className="w-full flex items-center justify-center gap-2 text-xs font-syne text-muted hover:text-cream px-3 py-2 rounded-xl border border-white/10 hover:bg-white/5 transition-all"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Nueva sesión
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ── Modales ────────────────────────────────────────────────────── */}
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
          hasExistingComment={Boolean(session.messages[feedbackModalIndex]?.feedbackComment)}
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
