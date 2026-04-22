import { useEffect, useCallback, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, PhoneOff, AlertCircle, Video, VideoOff, Clock, Loader2 } from "lucide-react";
import { AnimatedAvatar, AvatarCharacter } from "../components/avatar/AnimatedAvatar";
import { useSessionStore } from "../stores/sessionStore";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { useAudioPlayer } from "../hooks/useAudioPlayer";
import { useSoundEffects } from "../hooks/useSoundEffects";

export function Simulation() {
  const navigate = useNavigate();
  const { selectedAvatar, messages, status, metrics, serverError, userProfile, setServerError, setMetrics } = useSessionStore();
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isEnding, setIsEnding] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const endTimeoutRef = useRef<number | null>(null);
  const sessionStartRef = useRef<number>(Date.now());
  const prevStatusRef = useRef(status);
  const prevMessagesLenRef = useRef(messages.length);

  // Hook de audio y sonidos
  const { isPlaying, startStream, appendChunk, endStream, unlockAudio } = useAudioPlayer();
  const { play: playSound } = useSoundEffects();

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

  const initPayload = useMemo(
    () => (userProfile ? { user_profile: userProfile } : undefined),
    [userProfile]
  );

  const { connect, sendAudio, endSession, disconnect } = useWebSocket({
    avatarId: selectedAvatar?.id,
    onAudioStart: handleAudioStart,
    onAudioChunk: handleAudioChunk,
    onAudioEnd: handleAudioEnd,
    initPayload,
  });

  const { isRecording, error: audioError, startRecording, stopRecording } = useAudioRecorder();

  useEffect(() => {
    if (!selectedAvatar) {
      navigate("/");
      return;
    }
    connect();
    return () => disconnect();
  }, [selectedAvatar]);

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

  async function handleVoiceButton() {
    // Desbloquea audio en iOS Safari en el primer toque
    await unlockAudio();
    if (isRecording) {
      playSound("recordStop");
      const audioBase64 = await stopRecording();
      if (audioBase64) {
        playSound("messageSent");
        sendAudio(audioBase64);
      }
    } else {
      playSound("recordStart");
      startRecording();
    }
  }

  function handleEndSession() {
    if (isEnding) return; // Evitar doble click
    setIsEnding(true);

    // Intentar terminar sesion normalmente
    endSession();

    // Fallback: si no hay respuesta en 10 segundos, forzar navegacion
    // (el análisis toma ~3-5 segundos, damos margen amplio)
    endTimeoutRef.current = window.setTimeout(() => {
      // Crear metricas basicas con los mensajes que tenemos
      const durationSeconds = Math.floor((Date.now() - sessionStartRef.current) / 1000);
      setMetrics({
        total_exchanges: Math.floor(messages.length / 2),
        duration_seconds: durationSeconds,
        conversation: messages,
        is_fallback: true // Marcar que es fallback sin análisis real
      });
      disconnect();
      navigate("/report");
    }, 10000);
  }

  // Limpiar timeout si metrics llegan antes
  useEffect(() => {
    if (metrics && endTimeoutRef.current) {
      clearTimeout(endTimeoutRef.current);
    }
  }, [metrics]);

  if (!selectedAvatar) return null;

  const avatarCharacter: AvatarCharacter =
    selectedAvatar.id === "roberto" ? "roberto" :
    selectedAvatar.id === "maria" ? "maria" :
    "roberto";

  const isAvatarActive = status === "thinking" || status === "generating_audio";
  const isSpeaking = isPlaying;

  // Obtener último mensaje del chat para mostrar subtítulos
  const lastAssistantMessage = [...messages].reverse().find(m => m.role === "assistant");

  return (
    <div className="h-screen bg-[#1a1a1a] flex flex-col overflow-hidden">
      {/* Header estilo Zoom */}
      <header className="bg-[#232323] px-3 sm:px-4 py-2 flex items-center justify-between border-b border-white/10 gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shrink-0" />
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
            {messages.length > 0 ? `${Math.ceil(messages.length / 2)} intercambios` : "Esperando..."}
          </div>
        </div>
      </header>

      {/* Main - Stack en movil, side-by-side en desktop */}
      <main className="flex-1 flex flex-col md:flex-row gap-2 p-2 overflow-hidden min-h-0">
        {/* Video del Avatar (Principal) */}
        <div className="relative rounded-xl overflow-hidden bg-gradient-to-br from-[#2a2a3a] to-[#1a1a2e] h-[40vh] md:h-auto md:flex-1">
          {/* Avatar centrado */}
          <div className="absolute inset-0 flex items-center justify-center">
            <AnimatedAvatar
              character={avatarCharacter}
              isSpeaking={isSpeaking}
              isActive={isAvatarActive}
              size={typeof window !== "undefined" ? Math.min(280, window.innerWidth * 0.6) : 280}
            />
          </div>

          {/* Nombre del avatar (esquina inferior izquierda) */}
          <div className="absolute bottom-4 left-4 px-3 py-1.5 bg-black/60 rounded-md backdrop-blur-sm">
            <span className="text-white text-sm font-medium">{selectedAvatar.name}</span>
            <span className="text-white/60 text-xs ml-2">{selectedAvatar.role}</span>
          </div>

          {/* Indicador de estado */}
          <AnimatePresence>
            {(status !== "ready" && status !== "disconnected") && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/70 rounded-full backdrop-blur-sm"
              >
                <span className="text-sm text-white flex items-center gap-2">
                  {status === "connecting" && (
                    <>
                      <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                      Conectando...
                    </>
                  )}
                  {status === "transcribing" && (
                    <>
                      <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                      Procesando audio...
                    </>
                  )}
                  {status === "thinking" && (
                    <>
                      <span className="w-2 h-2 bg-violet rounded-full animate-pulse" />
                      Pensando...
                    </>
                  )}
                  {status === "generating_audio" && (
                    <>
                      <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                      Generando respuesta...
                    </>
                  )}
                  {status === "analyzing" && (
                    <>
                      <span className="w-2 h-2 bg-teal rounded-full animate-pulse" />
                      Analizando tu desempeno...
                    </>
                  )}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Subtítulos del avatar */}
          <AnimatePresence>
            {isSpeaking && lastAssistantMessage && (
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

            {/* Tu nombre */}
            <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 rounded text-xs text-white">
              Tú {isRecording && <span className="text-red-400 ml-1">● Grabando</span>}
            </div>

            {/* Indicador de micrófono */}
            {isRecording && (
              <div className="absolute top-2 right-2">
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 0.5 }}
                  className="w-3 h-3 bg-red-500 rounded-full"
                />
              </div>
            )}
          </div>

          {/* Chat/Historial compacto */}
          <div className="flex-1 rounded-xl bg-[#232323] border border-white/10 overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b border-white/10 text-xs text-white/60 font-medium">
              Chat
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {messages.length === 0 ? (
                <p className="text-white/40 text-xs text-center py-4">
                  Mantén presionado el micrófono para hablar
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
      <footer className="bg-[#232323] px-6 py-3 flex items-center justify-center gap-4 border-t border-white/10">
        {/* Botón Micrófono (Push to Talk) */}
        <motion.button
          onMouseDown={handleVoiceButton}
          onMouseUp={handleVoiceButton}
          onTouchStart={handleVoiceButton}
          onTouchEnd={handleVoiceButton}
          whileTap={{ scale: 0.95 }}
          disabled={status !== "ready"}
          className={`
            flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-all
            ${isRecording
              ? "bg-red-500/20 text-red-400"
              : status !== "ready"
              ? "bg-white/5 text-white/30 cursor-not-allowed"
              : "bg-white/10 text-white hover:bg-white/20"}
          `}
        >
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            isRecording ? "bg-red-500" : "bg-white/10"
          }`}>
            {isRecording ? (
              <MicOff className="w-5 h-5 text-white" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </div>
          <span className="text-[10px]">{isRecording ? "Suelta" : "Hablar"}</span>
        </motion.button>

        {/* Botón Cámara */}
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

        {/* Botón Terminar */}
        <button
          onClick={handleEndSession}
          disabled={isEnding}
          className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-all ${
            isEnding
              ? "bg-red-500/10 text-red-300 cursor-wait"
              : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
          }`}
        >
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            isEnding ? "bg-red-400 animate-pulse" : "bg-red-500"
          }`}>
            <PhoneOff className="w-5 h-5 text-white" />
          </div>
          <span className="text-[10px]">{isEnding ? "Saliendo..." : "Terminar"}</span>
        </button>
      </footer>

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
            className="fixed bottom-24 left-1/2 -translate-x-1/2 max-w-md p-4 rounded-lg bg-red-500/90 backdrop-blur-sm shadow-xl"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-white flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-white font-medium text-sm">
                  {audioError || "Error del servidor"}
                </p>
                {serverError && (
                  <p className="text-white/80 text-xs mt-1">{serverError}</p>
                )}
                <button
                  onClick={() => setServerError(null)}
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
