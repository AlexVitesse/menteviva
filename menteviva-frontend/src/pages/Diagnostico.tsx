import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock,
  Mic,
  MicOff,
  PhoneOff,
  Loader2,
  AlertCircle,
  Volume2,
  VolumeX,
  Brain,
  PauseCircle,
  Video,
  VideoOff,
} from "lucide-react";
import { useMicVAD, utils as vadUtils } from "@ricky0123/vad-react";

import { AnimatedAvatar } from "../components/avatar/AnimatedAvatar";
import { TalkingHeadAvatar } from "../components/avatar/TalkingHeadAvatar";
import { useAudioPlayer } from "../hooks/useAudioPlayer";
import { useWebSocket } from "../hooks/useWebSocket";
import { useSessionStore } from "../stores/sessionStore";
import { ENTREVISTADOR_AVATAR } from "../utils/entrevistador";
import { formatDuration, isSecureOriginForMic } from "../utils/audio";
import { buildMockDiagnostico } from "../utils/mockDiagnostico";
import { getAvatar3DFlag } from "../utils/avatar3dFlag";

type IndicatorState =
  | "loading"
  | "listening"
  | "userSpeaking"
  | "processing"
  | "sofiaSpeaking"
  | "paused";

export function Diagnostico() {
  const navigate = useNavigate();
  const {
    userProfile,
    diagnosticoVars,
    messages,
    status,
    metrics,
    serverError,
    setServerError,
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
  // Toggle visual de "tu camara" — placeholder, no abre webcam real.
  // Match con la UI de Simulation.tsx para que ambas vistas se vean iguales.
  const [isCameraOn, setIsCameraOn] = useState(true);
  const startRef = useRef<number>(Date.now());
  const closingTimerRef = useRef<number | null>(null);
  // Pending failsafe setTimeouts (mock-fallback). Se cancelan en cuanto llega
  // un diagnostico real, se aplica el mock, o el componente se desmonta.
  // Sin esto, un failsafe atrasado puede SOBREESCRIBIR un diagnostico real
  // que ya estaba en pantalla.
  const failsafeTimersRef = useRef<Set<number>>(new Set());

  const clearFailsafes = useCallback(() => {
    failsafeTimersRef.current.forEach((id) => window.clearTimeout(id));
    failsafeTimersRef.current.clear();
  }, []);

  const targetSeconds = (diagnosticoVars?.minutos ?? 25) * 60;
  const progressPct = Math.min(100, (elapsed / targetSeconds) * 100);

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

  const {
    audioRef,
    isPlaying,
    startStream,
    appendChunk,
    endStream,
    unlockAudio,
    isMuted,
    toggleMute,
  } = useAudioPlayer();

  const use3DAvatar = useMemo(() => getAvatar3DFlag(), []);

  const handleAudioStart = useCallback(() => startStream("audio/mpeg"), [startStream]);
  const handleAudioChunk = useCallback((chunk: string) => appendChunk(chunk), [appendChunk]);
  const handleAudioEnd = useCallback(() => endStream(), [endStream]);
  const handleClosingIntent = useCallback(() => setClosingCountdown(5), []);

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

  // VAD: detecta voz, auto-encodea WAV y manda al WS. Sin botones.
  // Los assets (worklet, modelo ONNX, WASM) se sirven desde /vad/ para evitar
  // fetch a CDN externo que rompe en movil (Audio Worklets tienen CORS estricto).
  // ORT en single-thread: tunnels tipo ngrok no envian COOP/COEP, por lo que
  // SharedArrayBuffer no esta disponible. Forzar numThreads=1 evita que ORT
  // intente crear un worker multi-thread y falle en Chrome Android.
  const vad = useMicVAD({
    startOnLoad: false,
    baseAssetPath: "/vad/",
    onnxWASMBasePath: "/vad/",
    ortConfig: (ort) => {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.logLevel = "warning";
    },
    onSpeechEnd: (audio: Float32Array) => {
      console.log(`[VAD] speech end, ${audio.length} samples`);
      const wavBytes = vadUtils.encodeWAV(audio);
      const base64 = vadUtils.arrayBufferToBase64(wavBytes);
      sendAudio(base64, "audio.wav");
    },
    onVADMisfire: () => {
      console.log("[VAD] misfire (too short)");
    },
    positiveSpeechThreshold: 0.5,
    negativeSpeechThreshold: 0.35,
    minSpeechMs: 200,        // descartar audios <200ms (toses, ruidos)
    redemptionMs: 600,       // esperar 600ms de silencio antes de cerrar segment
    preSpeechPadMs: 200,     // incluir 200ms previos al inicio del speech
  });

  // Pausar VAD cuando Sofia habla o estamos procesando — evita feedback loop
  // y descartamos el audio del propio TTS volviendo por el mic.
  useEffect(() => {
    if (!sessionStarted) return;
    if (vad.loading || vad.errored) return;
    const shouldListen = status === "ready" && !isPlaying;
    if (shouldListen && !vad.listening) {
      vad.start();
    } else if (!shouldListen && vad.listening) {
      vad.pause();
    }
  }, [sessionStarted, status, isPlaying, vad]);

  // WS connect tras overlay
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

  async function handleStartSession() {
    setRequestingPermission(true);
    setPermissionError(null);
    setShowEscape(false);

    // Bloqueo preventivo: en Chrome movil sobre HTTP (LAN IP), mediaDevices es
    // undefined y getUserMedia tira TypeError. Mostramos un mensaje util antes.
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

    unlockAudio().catch((e) => console.warn("[Diagnostico] unlock failed:", e));
    const escapeTimer = window.setTimeout(() => setShowEscape(true), 5000);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setSessionStarted(true);
    } catch (err) {
      const name = err instanceof Error ? err.name : "Error";
      console.error("[Diagnostico] getUserMedia failed:", name, err);
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setPermissionError(
          "Necesitamos acceso al microfono. Habilitalo en los ajustes del navegador (candado junto a la URL) y vuelve a intentar."
        );
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setPermissionError(
          "No detectamos ningun microfono. En movil: revisa que ninguna otra app este usandolo y que no tengas audifonos Bluetooth sin micro conectados."
        );
      } else if (name === "NotReadableError" || name === "TrackStartError") {
        setPermissionError(
          "El microfono esta ocupado por otra app. Cierra WhatsApp, Zoom, Grabadora o cualquier llamada activa y vuelve a intentar."
        );
      } else if (name === "SecurityError" || name === "TypeError") {
        // TypeError pasa cuando navigator.mediaDevices es undefined (HTTP en movil)
        setPermissionError(
          "Chrome bloquea el microfono en este origen. Accede desde HTTPS (ngrok/cloudflared) o desde localhost en desktop."
        );
      } else {
        setPermissionError("No pudimos acceder al microfono. Intenta de nuevo.");
      }
    } finally {
      window.clearTimeout(escapeTimer);
      setRequestingPermission(false);
    }
  }

  function handleForceStart() {
    setSessionStarted(true);
    setRequestingPermission(false);
  }

  // Aplica un diagnostico demo (is_demo=true) al perfil y navega al resumen.
  // Usado como fallback cuando el backend no puede cerrar la sesion limpio.
  // Cancela cualquier failsafe pendiente para evitar dobles aplicaciones.
  const applyDemoAndGoToPerfil = useCallback(() => {
    clearFailsafes();
    const demo = buildMockDiagnostico(userProfile);
    updateDiagnostico(demo);
    navigate("/diagnostico/perfil", { replace: true });
  }, [clearFailsafes, navigate, updateDiagnostico, userProfile]);

  // Programa un failsafe que aplica mock si en `delayMs` no hay metrics.
  const scheduleMockFailsafe = useCallback(
    (delayMs: number) => {
      const id = window.setTimeout(() => {
        failsafeTimersRef.current.delete(id);
        if (!useSessionStore.getState().metrics) {
          applyDemoAndGoToPerfil();
        }
      }, delayMs);
      failsafeTimersRef.current.add(id);
      return id;
    },
    [applyDemoAndGoToPerfil],
  );

  // Cleanup global al desmontar el componente.
  useEffect(() => {
    return () => clearFailsafes();
  }, [clearFailsafes]);

  useEffect(() => {
    if (!metrics) return;
    // Llegaron metrics: cancelamos cualquier failsafe pendiente para evitar
    // que un setTimeout atrasado sobreescriba el diagnostico real con un mock.
    clearFailsafes();
    if (metrics.user_profile_update) {
      updateDiagnostico(metrics.user_profile_update);
      navigate("/diagnostico/perfil");
    } else {
      console.warn("[Diagnostico] metrics sin user_profile_update, aplicando mock", metrics);
      applyDemoAndGoToPerfil();
    }
  }, [metrics, navigate, updateDiagnostico, applyDemoAndGoToPerfil, clearFailsafes]);

  // Countdown del cierre auto. Al llegar a 0: si WS sigue vivo -> endSession
  // normal; si esta caido -> demo fallback directo.
  useEffect(() => {
    if (closingCountdown === null) return;
    if (closingCountdown <= 0) {
      if (status === "disconnected") {
        applyDemoAndGoToPerfil();
      } else {
        endSession();
        scheduleMockFailsafe(10000);
      }
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
  }, [closingCountdown, endSession, status, applyDemoAndGoToPerfil, scheduleMockFailsafe]);

  function cancelClosing() {
    if (closingTimerRef.current !== null) {
      window.clearTimeout(closingTimerRef.current);
    }
    setClosingCountdown(null);
  }

  // "Terminar" con fallback: si el WS esta OK intentamos el cierre limpio
  // (endSession -> analisis -> metrics -> navigate via useEffect de metrics).
  // Si el WS esta caido, inyectamos un diagnostico demo y vamos al perfil
  // para que el usuario siempre vea un resultado (no queda atrapado).
  function handleTerminate() {
    if (status === "disconnected") {
      applyDemoAndGoToPerfil();
      return;
    }
    endSession();
    scheduleMockFailsafe(10000);
  }

  const indicatorState: IndicatorState = useMemo(() => {
    if (!sessionStarted) return "paused";
    if (vad.loading) return "loading";
    if (isPlaying) return "sofiaSpeaking";
    if (
      status === "transcribing" ||
      status === "thinking" ||
      status === "generating_audio" ||
      status === "analyzing"
    )
      return "processing";
    if (vad.userSpeaking) return "userSpeaking";
    if (vad.listening && status === "ready") return "listening";
    return "paused";
  }, [sessionStarted, vad.loading, vad.userSpeaking, vad.listening, isPlaying, status]);

  // Estilo del boton Mic en el footer: refleja estado del VAD (es display, no
  // push-to-talk como en Simulation — la captura es automatica).
  const micStyle = vad.userSpeaking
    ? "bg-red-500/20 text-red-400"
    : !vad.listening
    ? "bg-white/5 text-white/30"
    : "bg-white/10 text-white";

  return (
    <div className="h-screen bg-[#1a1a1a] flex flex-col overflow-hidden">
      {/* Header estilo Zoom — alineado con Simulation.tsx */}
      <header className="bg-[#232323] px-3 sm:px-4 py-2 border-b border-white/10 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shrink-0" />
            <span className="text-white/80 text-xs sm:text-sm font-medium truncate">
              <span className="hidden sm:inline">Mente Viva - </span>Diagnóstico
            </span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 bg-white/5 rounded-full shrink-0">
            <Clock className="w-3 h-3 sm:w-4 sm:h-4 text-white/60" />
            <span className="text-white font-mono text-xs sm:text-sm">
              {formatDuration(elapsed)} / {formatDuration(targetSeconds)}
            </span>
          </div>
        </div>
        {/* Progress bar — propia de Diagnostico (Simulation no la tiene porque
            no hay duracion objetivo fija). Se queda como segunda fila del
            header para no romper el look Zoom. */}
        <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden mt-2">
          <motion.div
            className="h-full bg-gradient-to-r from-violet to-teal"
            animate={{ width: `${progressPct}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </header>

      {/* Banners de error — preservados del layout anterior */}
      {sessionStarted && status === "disconnected" && (
        <div className="bg-danger/20 border-b border-danger/40 px-4 py-2 text-center text-xs sm:text-sm text-danger shrink-0">
          Sin conexion al servidor. Presiona Terminar para ir al inicio o recarga la pagina.
        </div>
      )}

      {serverError && status !== "disconnected" && (
        <div className="bg-warning/20 border-b border-warning/40 px-4 py-2 text-center text-xs sm:text-sm text-warning shrink-0 flex items-center justify-center gap-2">
          <span>{serverError}</span>
          <button onClick={() => setServerError(null)} className="underline opacity-80 hover:opacity-100">Cerrar</button>
        </div>
      )}

      {vad.errored && (
        <div className="bg-warning/20 border-b border-warning/40 px-4 py-2 text-center text-xs sm:text-sm text-warning shrink-0">
          Detector de voz fallo: {typeof vad.errored === "string" ? vad.errored : "error desconocido"}. Recarga o usa otro navegador.
        </div>
      )}

      {/* Main: avatar grande + sidebar (tu video + chat). Mismo grid que Simulation. */}
      <main className="flex-1 flex flex-col md:flex-row gap-2 p-2 overflow-hidden min-h-0">
        {/* Panel principal con avatar 3D */}
        <div className="relative rounded-xl overflow-hidden bg-gradient-to-br from-[#2a2a3a] to-[#1a1a2e] h-[40vh] md:h-auto md:flex-1">
          <div className="absolute inset-0 flex items-center justify-center">
            {use3DAvatar ? (
              <TalkingHeadAvatar
                audioRef={audioRef}
                isActive={status === "thinking" || status === "generating_audio"}
                isSpeaking={isPlaying}
              />
            ) : (
              <AnimatedAvatar
                character="maria"
                isActive={status === "thinking" || status === "generating_audio"}
                isSpeaking={isPlaying}
                size={typeof window !== "undefined" ? Math.min(280, window.innerWidth * 0.6) : 280}
              />
            )}
          </div>

          {/* Nombre del avatar (esquina inferior izquierda) — match Simulation */}
          <div className="absolute bottom-4 left-4 px-3 py-1.5 bg-black/60 rounded-md backdrop-blur-sm">
            <span className="text-white text-sm font-medium">{ENTREVISTADOR_AVATAR.name}</span>
            <span className="text-white/60 text-xs ml-2">{ENTREVISTADOR_AVATAR.role}</span>
          </div>

          {/* Indicador de estado: como Diagnostico tiene VAD + sofiaSpeaking,
              conservamos el ConversationIndicator (mas informativo que el dot
              simple de Simulation). Lo posicionamos top-right para no chocar
              con el nombre del avatar abajo. */}
          <div className="absolute top-3 left-3 right-3 sm:left-auto sm:right-3 sm:max-w-xs z-10">
            <ConversationIndicator state={indicatorState} />
          </div>
        </div>

        {/* Sidebar: video tuyo + chat compacto inline (igual que Simulation). */}
        <div className="md:w-64 flex flex-col gap-2 min-h-0 flex-1 md:flex-none">
          {/* Tu video — oculto en movil para dar espacio al chat */}
          <div className="relative h-32 md:h-48 rounded-xl overflow-hidden bg-gradient-to-br from-[#3a3a4a] to-[#2a2a3a] border border-white/10 hidden sm:block">
            {isCameraOn ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-20 h-20 rounded-full bg-violet/20 flex items-center justify-center">
                  <span className="text-3xl font-bold text-violet">Tú</span>
                </div>
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a1a]">
                <VideoOff className="w-8 h-8 text-white/30" />
              </div>
            )}

            {/* Tu nombre + indicador de voz */}
            <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 rounded text-xs text-white">
              Tú {vad.userSpeaking && <span className="text-red-400 ml-1">● Hablando</span>}
            </div>

            {/* Indicador pulsante cuando el VAD detecta voz */}
            {vad.userSpeaking && (
              <div className="absolute top-2 right-2">
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 0.5 }}
                  className="w-3 h-3 bg-red-500 rounded-full"
                />
              </div>
            )}
          </div>

          {/* Chat compacto inline */}
          <div className="flex-1 rounded-xl bg-[#232323] border border-white/10 overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b border-white/10 text-xs text-white/60 font-medium">
              Chat
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {messages.length === 0 ? (
                <p className="text-white/40 text-xs text-center py-4">
                  Sofía iniciará la conversación...
                </p>
              ) : (
                messages.slice(-6).map((msg) => (
                  <div
                    key={msg.id}
                    className={`text-xs p-2 rounded-lg ${
                      msg.role === "user"
                        ? "bg-violet/20 text-violet-lighter ml-4"
                        : "bg-white/5 text-white/80 mr-4"
                    }`}
                  >
                    <span className="font-medium text-[10px] text-white/50 block mb-0.5">
                      {msg.role === "user" ? "Tú" : ENTREVISTADOR_AVATAR.name}
                    </span>
                    {msg.content.length > 100 ? msg.content.slice(0, 100) + "..." : msg.content}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer estilo Zoom — Mic state-display, Camara, Mute (nuevo), Terminar */}
      <footer className="bg-[#232323] px-6 py-3 flex items-center justify-center gap-4 border-t border-white/10">
        {/* Mic — solo display del estado VAD, no push-to-talk (la captura es automatica) */}
        <div
          className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg ${micStyle}`}
          aria-label="Estado del microfono"
        >
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            vad.userSpeaking ? "bg-red-500" : "bg-white/10"
          }`}>
            {vad.userSpeaking ? <Mic className="w-5 h-5 text-white" /> : !vad.listening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </div>
          <span className="text-[10px]">
            {vad.userSpeaking ? "Hablando" : !vad.listening ? "Pausado" : "Escuchando"}
          </span>
        </div>

        {/* Camara — toggle placeholder, no abre webcam real */}
        <button
          onClick={() => setIsCameraOn(!isCameraOn)}
          className="flex flex-col items-center gap-1 px-4 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-all"
        >
          <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
            {isCameraOn ? (
              <Video className="w-5 h-5" />
            ) : (
              <VideoOff className="w-5 h-5 text-red-400" />
            )}
          </div>
          <span className="text-[10px]">Video</span>
        </button>

        {/* Mute — silencia el audio TTS del avatar (no afecta tu mic) */}
        <button
          onClick={toggleMute}
          className="flex flex-col items-center gap-1 px-4 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-all"
          aria-label={isMuted ? "Activar audio del avatar" : "Silenciar audio del avatar"}
        >
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            isMuted ? "bg-red-500/30" : "bg-white/10"
          }`}>
            {isMuted ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5" />}
          </div>
          <span className="text-[10px]">{isMuted ? "Activar" : "Silenciar"}</span>
        </button>

        {/* Terminar */}
        <button
          onClick={handleTerminate}
          className="flex flex-col items-center gap-1 px-4 py-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all"
        >
          <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center">
            <PhoneOff className="w-5 h-5 text-white" />
          </div>
          <span className="text-[10px]">Terminar</span>
        </button>
      </footer>

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
              <h2 className="font-syne text-2xl font-bold mb-2">Listo para empezar</h2>
              <p className="text-muted text-sm mb-6">
                Vamos a pedirte permiso de microfono para que Sofia pueda
                escucharte. La entrevista dura unos {diagnosticoVars?.minutos ?? 25} minutos.
                No necesitas presionar nada — solo habla naturalmente cuando quieras.
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
                En movil (Android/iOS): el navegador solo permite el microfono sobre HTTPS.
                Accede via un tunnel (ngrok, cloudflared) o desde localhost en desktop.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const INDICATOR_CONFIG: Record<
  IndicatorState,
  { label: string; sublabel: string; icon: typeof Mic; color: string; pulse: boolean }
> = {
  loading: {
    label: "Iniciando microfono",
    sublabel: "Cargando detector de voz...",
    icon: Loader2,
    color: "text-muted bg-white/5 border-white/10",
    pulse: false,
  },
  listening: {
    label: "Te escucho",
    sublabel: "Habla cuando quieras, sin presionar nada",
    icon: Mic,
    color: "text-success bg-success/10 border-success/30",
    pulse: true,
  },
  userSpeaking: {
    label: "Estas hablando",
    sublabel: "Te enviare cuando hagas una pausa",
    icon: Mic,
    color: "text-success bg-success/20 border-success/50",
    pulse: true,
  },
  processing: {
    label: "Procesando",
    sublabel: "Sofia esta pensando tu respuesta...",
    icon: Brain,
    color: "text-violet-light bg-violet/10 border-violet/30",
    pulse: false,
  },
  sofiaSpeaking: {
    label: "Sofia esta hablando",
    sublabel: "Espera a que termine para responder",
    icon: Volume2,
    color: "text-teal bg-teal/10 border-teal/30",
    pulse: true,
  },
  paused: {
    label: "En pausa",
    sublabel: "El microfono esta inactivo",
    icon: PauseCircle,
    color: "text-muted bg-white/5 border-white/10",
    pulse: false,
  },
};

function ConversationIndicator({ state }: { state: IndicatorState }) {
  const cfg = INDICATOR_CONFIG[state];
  const Icon = cfg.icon;
  const isLoading = state === "loading";
  return (
    <div className={`shrink-0 rounded-2xl border p-3 flex items-center gap-3 backdrop-blur-md ${cfg.color} transition-colors`}>
      <div className="relative shrink-0">
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
