import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Clock, PhoneOff } from "lucide-react";

import { AnimatedAvatar } from "../components/avatar/AnimatedAvatar";
import { ChatBox } from "../components/chat/ChatBox";
import { VoiceButton } from "../components/voice/VoiceButton";
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
  const startRef = useRef<number>(Date.now());

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
    initPayload,
  });

  const { isRecording, startRecording, stopRecording } = useAudioRecorder();

  useEffect(() => {
    if (!userProfile?.registro || !diagnosticoVars) return;
    connect();
    return () => disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!metrics) return;
    if (metrics.user_profile_update) {
      updateDiagnostico(metrics.user_profile_update);
    }
    navigate("/diagnostico/perfil");
  }, [metrics, navigate, updateDiagnostico]);

  async function handleVoiceToggle() {
    // Primer toque del usuario en la pagina: desbloquea audio en iOS Safari
    await unlockAudio();
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
            <VoiceButton
              isRecording={isRecording}
              isDisabled={isDisabled}
              isLoading={status === "transcribing" || status === "thinking"}
              onMouseDown={handleVoiceToggle}
              onMouseUp={() => {}}
            />
          </div>
          <p className="text-center text-xs text-muted shrink-0 pb-1">
            {isRecording
              ? "Toca el microfono otra vez para enviar"
              : "Toca el microfono para hablar"}
          </p>
        </aside>
      </main>
    </div>
  );
}
