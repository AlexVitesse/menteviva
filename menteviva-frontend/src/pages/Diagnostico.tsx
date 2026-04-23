import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Mic, MicOff, PhoneOff, Loader2, AlertCircle } from "lucide-react";

import { AnimatedAvatar } from "../components/avatar/AnimatedAvatar";
import { ChatBox } from "../components/chat/ChatBox";
import { useAudioPlayer } from "../hooks/useAudioPlayer";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { useWebSocket } from "../hooks/useWebSocket";
import { useSessionStore } from "../stores/sessionStore";
import { ENTREVISTADOR_AVATAR } from "../utils/entrevistador";
import { formatDuration } from "../utils/audio";

export function Diagnostico() {
  const navigate = useNavigate();
  const {
    userProfile,
    diagnosticoVars,
    messages,
    status,
    metrics,
    setSelectedAvatar,
    updateDiagnostico,
    resetSession,
  } = useSessionStore();

  const [elapsed, setElapsed] = useState(0);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [showEscape, setShowEscape] = useState(false);
  const [closingCountdown, setClosingCountdown] = useState<number | null>(null);
  const startRef = useRef<number>(Date.now());
  const closingTimerRef = useRef<number | null>(null);

  // Redirect si no hay contexto minimo
  useEffect(() => {
    if (!userProfile?.registro) {
      navigate("/registro", { replace: true });
      return;
    }
    if (!diagnosticoVars) {
      navigate("/diagnostico/setup", { replace: true });
      return;
    }
    resetSession();
    setSelectedAvatar(ENTREVISTADOR_AVATAR);
  }, [userProfile, diagnosticoVars, navigate, resetSession, setSelectedAvatar]);

  const { isPlaying, startStream, appendChunk, endStream, unlockAudio } = useAudioPlayer();

  const handleAudioStart = useCallback(() => {
    startStream("audio/mpeg");
  }, [startStream]);

  const handleAudioChunk = useCallback(
    (chunk: string) => {
      appendChunk(chunk);
    },
    [appendChunk]
  );

  const handleAudioEnd = useCallback(() => {
    endStream();
  }, [endStream]);

  // Sofia emitio [CIERRE] -> arrancar countdown de 5s antes de auto-end
  const handleClosingIntent = useCallback(() => {
    setClosingCountdown(5);
  }, []);

  const initPayload = useMemo(() => {
    if (!userProfile || !diagnosticoVars) return undefined;
    return {
      user_profile: userProfile,
      session_vars: {
        idioma: diagnosticoVars.idioma,
        tono: diagnosticoVars.tono,
        minutos: diagnosticoVars.minutos,
        ...(diagnosticoVars.competencias
          ? { competencias: diagnosticoVars.competencias }
          : {}),
      },
    };
  }, [userProfile, diagnosticoVars]);

  const { connect, sendAudio, endSession, disconnect } = useWebSocket({
    avatarId: "entrevistador",
    onAudioStart: handleAudioStart,
    onAudioChunk: handleAudioChunk,
    onAudioEnd: handleAudioEnd,
    onClosingIntent: handleClosingIntent,
    initPayload,
  });

  const { isRecording, startRecording, stopRecording } = useAudioRecorder();

  // Conexion WS y timer arrancan SOLO despues del overlay (sessionStarted)
  useEffect(() => {
    if (!sessionStarted) return;
    if (!userProfile?.registro || !diagnosticoVars) return;
    startRef.current = Date.now();
    connect();
    return () => disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStarted]);

  useEffect(() => {
    if (!sessionStarted) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionStarted]);

  /**
   * El click en "Iniciar entrevista" hace TRES cosas en el mismo gesto:
   * 1. Pide permiso de microfono (proactivo, antes de que el usuario lo
   *    necesite para hablar).
   * 2. Desbloquea el audio element (iOS Safari requiere gesto reciente).
   * 3. Conecta el WebSocket y empieza el timer.
   */
  async function handleStartSession() {
    setRequestingPermission(true);
    setPermissionError(null);
    setShowEscape(false);
    console.log("[Diagnostico] handleStartSession click");

    // FIX iOS: dispara unlock SINCRÓNICAMENTE en el gesto, antes de cualquier
    // await. iOS Safari "consume" el gesto al hacer await getUserMedia, asi
    // que el unlock debe iniciarse antes. Fire-and-forget para no bloquear.
    unlockAudio().catch((e) => console.warn("[Diagnostico] unlock failed:", e));

    // Si tras 5s seguimos en "procesando", mostramos boton de escape
    const escapeTimer = window.setTimeout(() => setShowEscape(true), 5000);

    try {
      console.log("[Diagnostico] requesting mic permission");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("[Diagnostico] permission granted");
      stream.getTracks().forEach((t) => t.stop());

      setSessionStarted(true);
    } catch (err) {
      const name = err instanceof Error ? err.name : "Error";
      console.error("[Diagnostico] getUserMedia failed:", name, err);
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setPermissionError(
          "Necesitamos acceso al microfono para la entrevista. Habilitalo en los ajustes del navegador y vuelve a intentar."
        );
      } else if (name === "NotFoundError") {
        setPermissionError("No detectamos ningun microfono conectado.");
      } else {
        setPermissionError("No pudimos acceder al microfono. Intenta de nuevo.");
      }
    } finally {
      window.clearTimeout(escapeTimer);
      setRequestingPermission(false);
    }
  }

  // Escape: si el usuario lleva 5s en "procesando" (probablemente iOS Safari
  // colgado en unlock), dejarlo pasar igual. El audio puede no funcionar
  // perfecto, pero al menos llega a la entrevista.
  function handleForceStart() {
    console.log("[Diagnostico] force start (skip wait)");
    setSessionStarted(true);
    setRequestingPermission(false);
  }

  useEffect(() => {
    if (!metrics) return;
    if (metrics.user_profile_update) {
      updateDiagnostico(metrics.user_profile_update);
    }
    navigate("/diagnostico/perfil");
  }, [metrics, navigate, updateDiagnostico]);

  // Tick del countdown. Cuando llega a 0, dispara endSession.
  useEffect(() => {
    if (closingCountdown === null) return;
    if (closingCountdown <= 0) {
      endSession();
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
  }, [closingCountdown, endSession]);

  function cancelClosing() {
    if (closingTimerRef.current !== null) {
      window.clearTimeout(closingTimerRef.current);
    }
    setClosingCountdown(null);
  }

  // Debounce para evitar doble-trigger en mobile (touch + click sintetico)
  const lastToggleRef = useRef(0);

  async function handleVoiceToggle() {
    const now = Date.now();
    if (now - lastToggleRef.current < 250) return;
    lastToggleRef.current = now;

    if (isRecording) {
      const base64 = await stopRecording();
      if (base64) sendAudio(base64);
    } else {
      startRecording();
    }
  }

  const isDisabled =
    status === "thinking" ||
    status === "generating_audio" ||
    status === "transcribing" ||
    status === "analyzing" ||
    isPlaying;

  return (
    <div className="h-screen bg-ink text-cream flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-3 sm:px-6 py-2 sm:py-3 border-b border-white/5 shrink-0 gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-syne text-sm sm:text-lg font-bold truncate">Diagnostico</p>
          <p className="text-[10px] sm:text-xs text-muted truncate">
            {userProfile?.registro.nombre} · {userProfile?.registro.rol_objetivo}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 text-sm text-muted shrink-0">
          <div className="flex items-center gap-1 sm:gap-2">
            <Clock className="w-4 h-4" />
            <span className="font-mono text-xs sm:text-sm">{formatDuration(elapsed)}</span>
          </div>
          <button
            onClick={endSession}
            className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full border border-danger/50 text-danger hover:bg-danger/10 text-xs sm:text-sm"
          >
            <PhoneOff className="w-4 h-4" />
            <span className="hidden sm:inline">Terminar</span>
          </button>
        </div>
      </header>

      {sessionStarted && status === "disconnected" && (
        <div className="bg-danger/20 border-b border-danger/40 px-4 py-2 text-center text-xs sm:text-sm text-danger shrink-0">
          Sin conexion al servidor. Verifica tu internet y recarga la pagina.
        </div>
      )}

      <main className="flex-1 flex flex-col md:flex-row gap-2 md:gap-4 p-2 md:p-4 min-h-0">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="relative rounded-xl overflow-hidden bg-gradient-to-br from-deep to-ink flex items-center justify-center h-[35vh] md:h-auto md:flex-1"
        >
          <AnimatedAvatar
            character="maria"
            isActive={status === "thinking" || status === "generating_audio"}
            isSpeaking={isPlaying}
          />
          <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg">
            <span className="text-xs sm:text-sm font-medium">{ENTREVISTADOR_AVATAR.name}</span>
          </div>
        </motion.div>

        <aside className="flex-1 md:flex-none md:w-[400px] flex flex-col gap-3 min-h-0">
          <ChatBox messages={messages} className="flex-1 min-h-0" />
          <div className="flex justify-center pt-1 sm:pt-2 shrink-0">
            <button
              type="button"
              onClick={handleVoiceToggle}
              disabled={isDisabled}
              className={`
                relative w-20 h-20 rounded-full flex items-center justify-center
                transition-all duration-200 shadow-lg
                ${isRecording ? "bg-danger shadow-danger/30" : "bg-violet shadow-violet/30"}
                ${isDisabled && "opacity-50 cursor-not-allowed"}
                active:scale-95
              `}
            >
              {isRecording && (
                <motion.div
                  initial={{ scale: 1, opacity: 0.5 }}
                  animate={{ scale: 1.5, opacity: 0 }}
                  transition={{ repeat: Infinity, duration: 1 }}
                  className="absolute inset-0 rounded-full bg-danger"
                />
              )}
              {status === "transcribing" || status === "thinking" ? (
                <Loader2 className="w-8 h-8 text-white animate-spin" />
              ) : isRecording ? (
                <MicOff className="w-8 h-8 text-white" />
              ) : (
                <Mic className="w-8 h-8 text-white" />
              )}
            </button>
          </div>
          <p className="text-center text-xs text-muted shrink-0 pb-1">
            {isRecording
              ? "Toca el microfono otra vez para enviar"
              : "Toca el microfono para hablar"}
          </p>
        </aside>
      </main>

      <AnimatePresence>
        {closingCountdown !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-ink/90 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="w-full max-w-sm bg-card rounded-2xl border border-violet/30 p-8 text-center"
            >
              <p className="text-xs uppercase tracking-wider text-violet-lighter font-bold mb-2">
                Sofia cerro la entrevista
              </p>
              <h2 className="font-syne text-3xl font-bold mb-1">
                Cerrando en {closingCountdown}...
              </h2>
              <p className="text-sm text-muted mb-6">
                Vamos a procesar tu diagnostico.
              </p>
              <button
                onClick={cancelClosing}
                className="w-full font-syne font-bold text-sm py-3 rounded-[10px] border border-white/20 text-cream hover:bg-white/5 transition-colors"
              >
                Cancelar y seguir hablando
              </button>
            </motion.div>
          </motion.div>
        )}

        {!sessionStarted && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-ink/95 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.95, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              className="w-full max-w-md bg-card rounded-2xl border border-white/5 p-8 text-center"
            >
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-violet/20 flex items-center justify-center">
                <Mic className="w-8 h-8 text-violet-light" />
              </div>
              <h2 className="font-syne text-2xl font-bold mb-2">
                Listo para empezar
              </h2>
              <p className="text-muted text-sm mb-6">
                Vamos a pedirte permiso de microfono para que Sofia pueda
                escucharte. La entrevista dura unos {diagnosticoVars?.minutos ?? 25} minutos.
              </p>

              {permissionError && (
                <div className="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-lg p-3 mb-4 text-left">
                  <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                  <p className="text-xs text-cream">{permissionError}</p>
                </div>
              )}

              <button
                onClick={handleStartSession}
                disabled={requestingPermission}
                className="w-full font-syne font-bold text-sm py-3 rounded-[10px] bg-violet text-white hover:bg-violet-light transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {requestingPermission ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Pidiendo permiso...
                  </>
                ) : (
                  "Iniciar entrevista"
                )}
              </button>

              {showEscape && requestingPermission && (
                <button
                  onClick={handleForceStart}
                  className="w-full mt-3 font-syne font-bold text-xs py-2 rounded-[10px] border border-white/20 text-muted hover:text-cream hover:border-white/40 transition-colors"
                >
                  Continuar de todas formas
                </button>
              )}

              <p className="text-[11px] text-muted mt-4">
                En movil: asegurate de NO tener el switch de silencio activado.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
