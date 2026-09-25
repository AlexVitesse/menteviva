import { useEffect, useCallback, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, PhoneOff, AlertCircle, Clock, Loader2, Pause, Play, WifiOff } from "lucide-react";
import { AnimatedAvatar, AvatarCharacter, avatarCharacterFor } from "../components/avatar/AnimatedAvatar";
import { MicLevelMeter } from "../components/voice/MicLevelMeter";
import { ConversationIndicator, type IndicatorState } from "../components/voice/ConversationIndicator";
import { TalkingHeadAvatar } from "../components/avatar/TalkingHeadAvatar";
import { useSessionStore } from "../stores/sessionStore";
import { useWebSocket, type WsInitPayload } from "../hooks/useWebSocket";
import { useGeminiLive } from "../hooks/useGeminiLive";
import { micErrorMessage, useAudioRecorder } from "../hooks/useAudioRecorder";
import { useAudioPlayer } from "../hooks/useAudioPlayer";

// Proveedor de tiempo real. "gemini" = audio nativo continuo (mic streaming +
// barge-in). Cualquier otro valor (o ausente) = modo Groq push-to-talk actual.
const IS_GEMINI = (import.meta.env.VITE_REALTIME_PROVIDER || "groq") === "gemini";
import { useSoundEffects } from "../hooks/useSoundEffects";
import { getAvatar3DFlag, getAvatarModelUrl, getAvatarGender } from "../utils/avatar3dFlag";

export function Simulation() {
  const navigate = useNavigate();
  const { selectedAvatar, selectedLevel, selectedRobertoCase, messages, status, metrics, serverError, userProfile, setServerError, setMetrics, clearMessages } = useSessionStore();
  // El store arranca en "disconnected": solo es una caida si antes hubo conexion.
  const [hasConnected, setHasConnected] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  // Ref espejo de isMicMuted: handleVoiceButton lo lee de forma sincrona para no
  // depender del valor (posiblemente stale) capturado en el closure de render.
  // Cierra la carrera "muteo con una mano + toque del boton con la otra".
  const isMicMutedRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const endTimeoutRef = useRef<number | null>(null);
  const sessionStartRef = useRef<number>(Date.now());
  const prevStatusRef = useRef(status);
  const prevMessagesLenRef = useRef(messages.length);

  // Hook de audio y sonidos
  const { audioRef, isPlaying, startStream, appendChunk, endStream, unlockAudio, stopAudio, pauseAudio, resumeAudio } = useAudioPlayer();
  const { play: playSound } = useSoundEffects();

  const use3DAvatar = useMemo(() => getAvatar3DFlag(), []);
  const avatarModelUrl = useMemo(
    () => getAvatarModelUrl(selectedAvatar?.id),
    [selectedAvatar?.id]
  );
  const avatarGender = useMemo(
    () => getAvatarGender(selectedAvatar?.id),
    [selectedAvatar?.id]
  );

  const handleAudioStart = useCallback(
    (mime?: string) => {
      // Cada nuevo clip del avatar arranca reproduciendo: resetea el estado de
      // pausa del usuario (si pauso el turno anterior, este turno suena normal).
      setIsPaused(false);
      startStream(mime);
    },
    [startStream]
  );

  const handleAudioChunk = useCallback(
    (chunk: string) => {
      appendChunk(chunk);
    },
    [appendChunk]
  );

  const handleAudioEnd = useCallback(() => {
    endStream();
  }, [endStream]);

  // El backend solo aplica `level` para avatares con supports_levels (Roberto).
  // Mandar siempre el nivel seleccionado en Briefing es seguro y simplifica.
  const initPayload = useMemo<WsInitPayload>(
    () => ({
      ...(userProfile ? { user_profile: userProfile } : {}),
      level: selectedLevel,
      ...(selectedAvatar?.id === "roberto"
        ? { session_vars: { roberto_case: selectedRobertoCase } }
        : {}),
    }),
    [userProfile, selectedLevel, selectedAvatar?.id, selectedRobertoCase]
  );

  const { connect, sendAudio, endSession, disconnect } = useWebSocket({
    avatarId: selectedAvatar?.id,
    onAudioStart: handleAudioStart,
    onAudioChunk: handleAudioChunk,
    onAudioEnd: handleAudioEnd,
    initPayload,
  });

  // Modo Gemini Live (audio nativo continuo). Se instancia siempre (reglas de
  // hooks) pero solo se conecta cuando IS_GEMINI; en modo Groq queda inerte.
  const gemini = useGeminiLive({ avatarId: selectedAvatar?.id, initPayload });

  // Si la grabacion llega al tope de duracion se corta sola: enviamos el audio
  // igual que si el usuario hubiera soltado, para no perder lo que dijo.
  const handleAutoStop = useCallback(
    (audioBase64: string) => {
      playSound("messageSent");
      sendAudio(audioBase64);
    },
    [playSound, sendAudio]
  );

  const {
    isRecording,
    recordingSeconds,
    error: audioError,
    analyser,
    initMic,
    releaseMic,
    startRecording,
    stopRecording,
    cancelRecording,
    clearError,
  } = useAudioRecorder({ onAutoStop: handleAutoStop });

  // Conectar y arrancar la captura continua del mic. El playback del avatar
  // y el barge-in los maneja el hook internamente.
  function startGemini() {
    gemini
      .connect()
      .then(() => gemini.startMic())
      .catch((e) => {
        console.error("[Simulation] inicio Gemini fallo:", e);
        setServerError(micErrorMessage(e));
      });
  }

  useEffect(() => {
    if (!selectedAvatar) {
      navigate("/");
      return;
    }
    if (IS_GEMINI) {
      startGemini();
      return () => gemini.disconnect();
    }
    connect();
    // Pre-calentar el mic: el permiso se pide una sola vez al entrar y cada
    // pulsacion de "hablar" arranca al instante (sin perder primeras palabras).
    initMic();
    return () => disconnect();
  }, [selectedAvatar]);

  useEffect(() => {
    if (status === "ready") setHasConnected(true);
  }, [status]);

  const isDisconnected = hasConnected && status === "disconnected" && !isEnding && !metrics;

  // La conversacion vive en el servidor: cerrar o recargar la pestaña la corta.
  // (El backend igual guarda el reporte si hubo 4+ intercambios.)
  useEffect(() => {
    if (messages.length === 0 || metrics || isEnding) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [messages.length, metrics, isEnding]);

  // Tras una caida el servidor ya no tiene el historial: la conversacion
  // empieza de nuevo, y la franja lo dice (no se finge continuidad).
  function handleReconnect() {
    clearMessages();
    setServerError(null);
    sessionStartRef.current = Date.now();
    setElapsedTime(0);
    if (IS_GEMINI) {
      gemini.disconnect();
      startGemini();
    } else {
      connect();
    }
  }

  useEffect(() => {
    if (metrics) {
      playSound("sessionEnd");
      navigate("/report");
    }
  }, [metrics]);

  // Timer de sesión
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - sessionStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Sonidos según cambios de estado
  useEffect(() => {
    // Conectado
    if (prevStatusRef.current === "connecting" && status === "ready") {
      playSound("connected");
    }
    // Error o desconexión
    if (status === "disconnected" && prevStatusRef.current !== "disconnected") {
      playSound("disconnected");
    }
    // Respuesta recibida (nuevo mensaje del asistente)
    if (messages.length > prevMessagesLenRef.current) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === "assistant") {
        playSound("responseReceived");
      }
    }

    prevStatusRef.current = status;
    prevMessagesLenRef.current = messages.length;
  }, [status, messages.length, playSound]);

  // Formatear tiempo mm:ss
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Pausa/reanuda la voz del avatar. isPaused distingue "pausado por el usuario"
  // de "termino de hablar" (ambos dejan isPlaying en false).
  function handleTogglePause() {
    if (isPaused) {
      resumeAudio();
      setIsPaused(false);
    } else {
      pauseAudio();
      setIsPaused(true);
    }
  }

  async function handleToggleMicMute() {
    const next = !isMicMuted;
    // Flip inmediato para feedback visual sin esperar a unlockAudio (que en iOS
    // puede tardar hasta ~3.5s la primera vez por los timeouts de unlock). El ref
    // se actualiza de forma sincrona para que un toque del boton de voz en el
    // mismo frame ya vea el mute, antes de que React confirme el re-render.
    isMicMutedRef.current = next;
    setIsMicMuted(next);
    // Gemini: captura continua -> mutear = dejar de enviar chunks (no se corta
    // la sesion). En Groq es push-to-talk, asi que cancelamos la grabacion.
    if (IS_GEMINI) {
      gemini.setMicMuted(next);
      return;
    }
    if (next) {
      // Si estabas grabando (push-to-talk + mute con la otra mano), descarta
      // el audio en curso y suelta el mic por completo: el indicador de
      // grabacion del navegador se apaga (señal de confianza real de mute).
      if (isRecording) cancelRecording();
      pressActiveRef.current = false;
      releaseMic();
    } else {
      // Al desmutear, re-calentar el mic para que la proxima pulsacion
      // arranque al instante.
      initMic();
    }
    // Aprovechamos el gesto del usuario para desbloquear el playback en iOS.
    await unlockAudio();
  }

  // Push-to-talk real: presionar = grabar, soltar = enviar. pressActiveRef es
  // la fuente de verdad sincrona (el estado isRecording puede llegar un render
  // tarde si el usuario presiona y suelta muy rapido).
  const pressActiveRef = useRef(false);

  async function startTalking() {
    // En Gemini el mic es continuo: no hay push-to-talk (el control es mute).
    if (IS_GEMINI) return;
    // Desbloquea el playback en iOS aprovechando el gesto. Sin await: el
    // unlock puede tardar segundos la primera vez y no debe retrasar el
    // arranque de la grabacion (recorta las primeras palabras).
    void unlockAudio();

    // Mic silenciado: no grabamos ni enviamos nada. El avatar no te oye.
    // Leemos el ref (no el estado del closure) para no perder un muteo recien
    // hecho con la otra mano en el mismo frame.
    if (isMicMutedRef.current || pressActiveRef.current) return;
    if (status !== "ready") return;

    pressActiveRef.current = true;
    // Barge-in: el backend manda `ready` con el ultimo chunk, asi que el boton
    // se habilita mientras el avatar aun suena. Cortarlo evita voces encimadas
    // y que el avatar quede grabado si falla la cancelacion de eco.
    stopAudio();
    // El usuario pasa a hablar: si habia pausado la voz del avatar, ese clip
    // ya quedo atras. Limpiamos isPaused para no dejar el subtitulo anterior
    // clavado en pantalla durante el resto de la sesion.
    setIsPaused(false);
    playSound("recordStart");
    await startRecording();
  }

  async function stopTalking() {
    if (IS_GEMINI) return;
    if (!pressActiveRef.current) return;
    pressActiveRef.current = false;

    playSound("recordStop");
    const audioBase64 = await stopRecording();
    if (audioBase64) {
      playSound("messageSent");
      sendAudio(audioBase64);
    }
  }

  function cancelTalking() {
    if (IS_GEMINI || !pressActiveRef.current) return;
    pressActiveRef.current = false;
    cancelRecording();
  }

  // Refs a los handlers para que los listeners globales (barra espaciadora)
  // siempre vean la version del render actual.
  const startTalkingRef = useRef(startTalking);
  const stopTalkingRef = useRef(stopTalking);
  startTalkingRef.current = startTalking;
  stopTalkingRef.current = stopTalking;

  // Barra espaciadora como push-to-talk en desktop (manten presionada).
  useEffect(() => {
    if (IS_GEMINI) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      startTalkingRef.current();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      stopTalkingRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Solo el aviso de grabacion corta se auto-descarta. Los de acceso al micro
  // (permiso, sin dispositivo, en uso) se quedan: sin micro no hay sesion.
  useEffect(() => {
    if (!audioError?.startsWith("Mantén presionado")) return;
    const t = window.setTimeout(() => clearError(), 5000);
    return () => clearTimeout(t);
  }, [audioError, clearError]);

  function handleEndSession() {
    if (isEnding) return; // Evitar doble click
    setIsEnding(true);

    // Intentar terminar sesion normalmente
    if (IS_GEMINI) gemini.endSession();
    else endSession();

    // Fallback: si no hay respuesta en 30 s, ir al reporte sin analisis. El
    // analisis con gpt-oss-120b puede pasar de 10 s; el servidor lo termina y
    // lo guarda igual (aparece en Mi plan), y el reporte lo dice asi.
    endTimeoutRef.current = window.setTimeout(() => {
      // Crear metricas basicas con los mensajes que tenemos
      const durationSeconds = Math.floor((Date.now() - sessionStartRef.current) / 1000);
      setMetrics({
        total_exchanges: messages.filter((m) => m.role === "user").length,
        duration_seconds: durationSeconds,
        conversation: messages,
        is_fallback: true // Marcar que es fallback sin análisis real
      });
      disconnect();
      navigate("/report");
    }, 30000);
  }

  // Limpiar timeout si metrics llegan antes
  useEffect(() => {
    if (metrics && endTimeoutRef.current) {
      clearTimeout(endTimeoutRef.current);
    }
  }, [metrics]);

  if (!selectedAvatar) return null;

  const avatarCharacter: AvatarCharacter = avatarCharacterFor(selectedAvatar.id);

  // En Gemini el hook refleja "hablando" via status=generating_audio (no usa el
  // useAudioPlayer/isPlaying del modo Groq).
  const isAvatarActive = IS_GEMINI ? false : (status === "thinking" || status === "generating_audio");
  const isSpeaking = IS_GEMINI ? status === "generating_audio" : isPlaying;

  // De quien es el turno (mismo indicador que el diagnostico).
  let indicatorState: IndicatorState;
  if (status === "connecting") indicatorState = "preparing";
  else if (isDisconnected || isMicMuted) indicatorState = "paused";
  else if (isSpeaking) indicatorState = "avatarSpeaking";
  else if (["transcribing", "thinking", "generating_audio", "analyzing"].includes(status)) indicatorState = "processing";
  else if (IS_GEMINI) indicatorState = gemini.hasGreeted ? "listening" : "preparing";
  else indicatorState = isRecording ? "userSpeaking" : "yourTurn";

  // Obtener último mensaje del chat para mostrar subtítulos
  const lastAssistantMessage = [...messages].reverse().find(m => m.role === "assistant");

  return (
    <div className="h-screen bg-ink flex flex-col overflow-hidden">
      {/* Header estilo Zoom */}
      <header className="bg-deep px-3 sm:px-4 py-2 flex items-center justify-between border-b border-white/10 gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className={`w-2 h-2 rounded-full shrink-0 ${isDisconnected ? "bg-danger" : "bg-success animate-pulse"}`} />
          <span className="text-white/80 text-xs sm:text-sm font-medium truncate">
            <span className="hidden sm:inline">Mente Viva - </span>Simulación
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 bg-white/5 rounded-full">
            <Clock className="w-3 h-3 sm:w-4 sm:h-4 text-white/60" />
            <span className="text-white font-mono text-xs sm:text-sm">{formatTime(elapsedTime)}</span>
          </div>
          <div className="text-white/50 text-xs sm:text-sm hidden sm:block">
            {(() => {
              const turns = messages.filter((m) => m.role === "user").length;
              return turns === 0 ? "Esperando…" : `${turns} ${turns === 1 ? "intercambio" : "intercambios"}`;
            })()}
          </div>
        </div>
      </header>

      {isDisconnected && (
        <div role="alert" className="bg-danger/20 border-b border-danger/40 px-3 sm:px-4 py-2 shrink-0 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs sm:text-sm text-cream">
          <WifiOff className="w-4 h-4 text-danger shrink-0" aria-hidden />
          <span>Se perdió la conexión. Si reconectas, la conversación empieza de nuevo.</span>
          <button onClick={handleReconnect} className="font-semibold underline underline-offset-2 hover:no-underline">
            Reconectar
          </button>
        </div>
      )}

      {/* Main - Stack en movil, side-by-side en desktop */}
      <main className="flex-1 flex flex-col md:flex-row gap-2 p-2 overflow-hidden min-h-0">
        {/* Video del Avatar (Principal) */}
        <div className="relative rounded-xl overflow-hidden bg-gradient-to-br from-card to-deep h-[40vh] md:h-auto md:flex-1">
          {/* Avatar centrado */}
          <div className="absolute inset-0 flex items-center justify-center">
            {use3DAvatar && avatarModelUrl ? (
              <TalkingHeadAvatar
                audioRef={audioRef}
                isSpeaking={isSpeaking}
                isActive={isAvatarActive}
                modelUrl={avatarModelUrl}
                gender={avatarGender}
                externalAnalyser={IS_GEMINI ? gemini.analyser : null}
              />
            ) : (
              <AnimatedAvatar
                character={avatarCharacter}
                isSpeaking={isSpeaking}
                isActive={isAvatarActive}
                size={typeof window !== "undefined" ? Math.min(280, window.innerWidth * 0.6) : 280}
              />
            )}
          </div>

          {/* Nombre del avatar (esquina inferior izquierda) */}
          <div className="absolute bottom-4 left-4 px-3 py-1.5 bg-black/60 rounded-md backdrop-blur-sm">
            <span className="text-white text-sm font-medium">{selectedAvatar.name}</span>
            <span className="text-white/60 text-xs ml-2">{selectedAvatar.role}</span>
          </div>

          {/* Indicador de turno */}
          {!isEnding && (
            <div className="absolute top-3 left-3 right-3 sm:left-auto sm:right-3 sm:max-w-xs z-10 rounded-2xl bg-ink/75">
              <ConversationIndicator state={indicatorState} avatarName={selectedAvatar.name.split(" ")[0]} />
            </div>
          )}

          {/* Subtítulos del avatar */}
          <AnimatePresence>
            {(isSpeaking || isPaused) && lastAssistantMessage && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute bottom-16 left-4 right-4"
              >
                <div className="bg-black/80 rounded-lg px-4 py-3 backdrop-blur-sm max-h-24 overflow-y-auto">
                  <p className="text-white text-sm leading-relaxed">
                    {lastAssistantMessage.content}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Sidebar: video tuyo + chat. Stack en movil debajo del avatar */}
        <div className="md:w-64 flex flex-col gap-2 min-h-0 flex-1 md:flex-none">
          {/* Chat/Historial compacto */}
          <div className="flex-1 rounded-xl bg-deep border border-white/10 overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b border-white/10 text-xs text-white/60 font-medium">
              Chat
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {messages.length === 0 ? (
                <p className="text-white/40 text-xs text-center py-4">
                  {IS_GEMINI
                    ? gemini.hasGreeted ? "Habla cuando quieras, te escucho" : `${selectedAvatar.name.split(" ")[0]} te va a saludar…`
                    : "Mantén presionado el micrófono (o la barra espaciadora) para hablar"}
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
                      {msg.role === "user" ? "Tú" : selectedAvatar.name}
                    </span>
                    {msg.content.length > 100 ? msg.content.slice(0, 100) + "..." : msg.content}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer - Controles estilo Zoom */}
      <footer className="bg-deep px-2 sm:px-6 py-3 flex items-center justify-center gap-1 sm:gap-4 border-t border-white/10">
        {/* Botón Micrófono (Push to Talk). Pointer events unifican mouse y
            touch sin el "click sintetico" duplicado de mobile; la captura del
            pointer garantiza que el pointerup llegue al boton aunque el dedo
            se deslice fuera (la grabacion nunca queda pegada). */}
        <motion.button
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            startTalking();
          }}
          onPointerUp={stopTalking}
          onPointerCancel={cancelTalking}
          onContextMenu={(e) => e.preventDefault()}
          whileTap={{ scale: IS_GEMINI ? 1 : 0.95 }}
          disabled={IS_GEMINI ? true : status !== "ready" || isMicMuted}
          title="Mantén presionado para hablar (o la barra espaciadora)"
          className={`
            touch-none select-none
            flex flex-col items-center gap-1 px-3 sm:px-4 py-2 rounded-lg transition-all
            ${IS_GEMINI
              ? isMicMuted || isDisconnected
                ? "bg-white/5 text-white/40"
                : "bg-success/15 text-green-400"
              : isRecording
              ? "bg-danger/20 text-red-400"
              : status !== "ready" || isMicMuted
              ? "bg-white/5 text-white/30 cursor-not-allowed"
              : "bg-white/10 text-white hover:bg-white/20"}
          `}
        >
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            IS_GEMINI
              ? isMicMuted || isDisconnected ? "bg-white/10" : "bg-success"
              : isRecording ? "bg-danger" : "bg-white/10"
          }`}>
            <Mic className="w-5 h-5" />
          </div>
          <span className="text-[10px]">
            {IS_GEMINI
              ? isDisconnected ? "Sin conexión" : isMicMuted ? "Mic off" : "En vivo"
              : isRecording ? "Suelta" : "Hablar"}
          </span>
        </motion.button>

        {/* Botón Silenciar mi micrófono */}
        <button
          onClick={handleToggleMicMute}
          aria-pressed={isMicMuted}
          className={`flex flex-col items-center gap-1 px-3 sm:px-4 py-2 rounded-lg transition-all ${
            isMicMuted
              ? "bg-danger/20 text-red-400 hover:bg-danger/30"
              : "bg-white/10 text-white hover:bg-white/20"
          }`}
        >
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            isMicMuted ? "bg-danger" : "bg-white/10"
          }`}>
            {isMicMuted ? (
              <MicOff className="w-5 h-5 text-white" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </div>
          <span className="text-[10px]">{isMicMuted ? "Muteado" : "Silenciar"}</span>
        </button>

        {/* Botón Pausa/Reanudar voz del avatar. En Gemini la voz sale del player
            PCM del hook (isPlaying no aplica) y el boton quedaba siempre muerto. */}
        {!IS_GEMINI && (
        <button
          onClick={handleTogglePause}
          disabled={!isPlaying && !isPaused}
          className={`flex flex-col items-center gap-1 px-3 sm:px-4 py-2 rounded-lg transition-all ${
            !isPlaying && !isPaused
              ? "bg-white/5 text-white/30 cursor-not-allowed"
              : "bg-white/10 text-white hover:bg-white/20"
          }`}
        >
          <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
            {isPaused ? (
              <Play className="w-5 h-5" />
            ) : (
              <Pause className="w-5 h-5" />
            )}
          </div>
          <span className="text-[10px]">{isPaused ? "Reanudar" : "Pausa"}</span>
        </button>
        )}

        {/* Botón Terminar */}
        <button
          onClick={handleEndSession}
          disabled={isEnding}
          className={`flex flex-col items-center gap-1 px-3 sm:px-4 py-2 rounded-lg transition-all ${
            isEnding
              ? "bg-danger/10 text-red-300 cursor-wait"
              : "bg-danger/20 text-red-400 hover:bg-danger/30"
          }`}
        >
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            isEnding ? "bg-danger animate-pulse" : "bg-danger"
          }`}>
            <PhoneOff className="w-5 h-5 text-white" />
          </div>
          <span className="text-[10px]">{isEnding ? "Saliendo..." : "Terminar"}</span>
        </button>
      </footer>

      {/* Píldora de grabación: timer + nivel de voz real. Feedback inmediato
          de "te estoy escuchando" visible también en móvil (donde el tile
          "Tú" está oculto). */}
      <AnimatePresence>
        {isRecording && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2 rounded-full bg-black/80 border border-danger/40 backdrop-blur-sm shadow-lg"
          >
            <motion.span
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ repeat: Infinity, duration: 1.2 }}
              className="w-2.5 h-2.5 bg-danger rounded-full shrink-0"
            />
            <span className="text-white font-mono text-sm tabular-nums">
              {formatTime(recordingSeconds)}
            </span>
            <MicLevelMeter analyser={analyser} active={isRecording} className="text-red-400" />
            <span className="text-white/60 text-xs hidden sm:inline">
              Suelta para enviar
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Overlay de análisis */}
      <AnimatePresence>
        {isEnding && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center"
          >
            <div className="text-center">
              <Loader2 className="w-16 h-16 text-violet animate-spin mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-white mb-2">Analizando tu desempeño</h2>
              <p className="text-white/60">Esto tomará unos segundos...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Errores */}
      <AnimatePresence>
        {(audioError || serverError) && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 max-w-md p-4 rounded-lg bg-danger/90 backdrop-blur-sm shadow-xl"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-white flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-white font-medium text-sm">
                  {audioError || "Hubo un problema"}
                </p>
                {serverError && (
                  <p className="text-white/80 text-xs mt-1">{serverError}</p>
                )}
                <button
                  onClick={() => {
                    setServerError(null);
                    clearError();
                  }}
                  className="mt-2 text-xs text-white underline hover:no-underline"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
