import { useCallback, useRef, useEffect } from "react";
import { useSessionStore } from "../stores/sessionStore";
import type { UserProfile } from "../types";

const WS_BASE_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000";

export interface WsInitPayload {
  user_profile?: UserProfile;
  session_vars?: Record<string, string | number | string[]>;
}

interface UseWebSocketOptions {
  avatarId: string | undefined;
  initPayload?: WsInitPayload;
  // Nuevos callbacks para streaming TTS
  onAudioStart?: () => void;
  onAudioChunk?: (base64Chunk: string) => void;
  onAudioEnd?: () => void;
}

export function useWebSocket({
  avatarId,
  initPayload,
  onAudioStart,
  onAudioChunk,
  onAudioEnd,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const pendingTextRef = useRef<string>("");
  const initPayloadRef = useRef(initPayload);
  const audioCallbacksRef = useRef({ onAudioStart, onAudioChunk, onAudioEnd });
  const {
    setStatus,
    addMessage,
    setMetrics,
    setServerError,
  } = useSessionStore();

  useEffect(() => {
    initPayloadRef.current = initPayload;
  }, [initPayload]);

  useEffect(() => {
    audioCallbacksRef.current = { onAudioStart, onAudioChunk, onAudioEnd };
  }, [onAudioStart, onAudioChunk, onAudioEnd]);

  const connect = useCallback(() => {
    if (!avatarId) return;

    const ws = new WebSocket(`${WS_BASE_URL}/api/conversation/${avatarId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("ready");
      const payload = initPayloadRef.current;
      if (payload && (payload.user_profile || payload.session_vars)) {
        ws.send(JSON.stringify({ type: "init", ...payload }));
      }
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "status":
          setStatus(data.status);
          // Limpiar texto pendiente cuando empieza a pensar
          if (data.status === "thinking") {
            pendingTextRef.current = "";
          }
          break;

        case "user_message":
          addMessage({
            id: crypto.randomUUID(),
            role: "user",
            content: data.content,
            timestamp: new Date(),
          });
          break;

        case "assistant_token":
          // Acumular tokens pero NO mostrar aun (esperar a assistant_audio_start)
          pendingTextRef.current += data.content;
          break;

        case "assistant_audio_start":
          // El caption se muestra cuando empieza a llegar el audio: mas abajo
          // del MSE esperamos el primer chunk para reproducir. Mostramos el
          // texto aqui para que usuario vea el caption apenas Sofia empiece a
          // hablar.
          addMessage({
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.content || pendingTextRef.current,
            timestamp: new Date(),
          });
          pendingTextRef.current = "";
          audioCallbacksRef.current.onAudioStart?.();
          break;

        case "assistant_audio_chunk":
          audioCallbacksRef.current.onAudioChunk?.(data.audio);
          break;

        case "assistant_audio_end":
          audioCallbacksRef.current.onAudioEnd?.();
          break;

        case "session_end":
          setMetrics(data.metrics);
          break;

        case "error":
          // Error del servidor - mostrar texto acumulado si hay
          if (pendingTextRef.current) {
            addMessage({
              id: crypto.randomUUID(),
              role: "assistant",
              content: pendingTextRef.current,
              timestamp: new Date(),
            });
            pendingTextRef.current = "";
          }
          setServerError(data.error || "Error en el servidor");
          setStatus("ready");
          break;
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      pendingTextRef.current = "";
    };

    ws.onerror = () => {
      setStatus("disconnected");
      pendingTextRef.current = "";
    };
  }, [
    avatarId,
    setStatus,
    addMessage,
    setMetrics,
    setServerError,
  ]);

  const sendAudio = useCallback((audioBase64: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "audio",
        audio: audioBase64,
      }));
    }
  }, []);

  const endSession = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end_session" }));
    }
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return { connect, sendAudio, endSession, disconnect };
}
