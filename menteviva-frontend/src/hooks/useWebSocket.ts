import { useCallback, useRef, useEffect } from "react";
import { useSessionStore } from "../stores/sessionStore";

const WS_BASE_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000";

interface UseWebSocketOptions {
  avatarId: string | undefined;
  onAudioReceived?: (base64Audio: string) => void;
}

export function useWebSocket({ avatarId, onAudioReceived }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const pendingTextRef = useRef<string>("");
  const {
    setStatus,
    addMessage,
    setMetrics,
    setServerError,
  } = useSessionStore();

  const connect = useCallback(() => {
    if (!avatarId) return;

    const ws = new WebSocket(`${WS_BASE_URL}/api/conversation/${avatarId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("ready");
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
          // Acumular tokens pero NO mostrar aun (esperar audio)
          pendingTextRef.current += data.content;
          break;

        case "assistant_audio":
          // Mostrar texto Y reproducir audio AL MISMO TIEMPO
          addMessage({
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.content || pendingTextRef.current,
            timestamp: new Date(),
          });
          pendingTextRef.current = "";
          // Usar callback externo si existe, sino fallback interno
          if (onAudioReceived) {
            onAudioReceived(data.audio);
          } else {
            playAudioFallback(data.audio);
          }
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
    onAudioReceived,
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

// Fallback interno para reproducir audio
function playAudioFallback(base64: string) {
  const audio = new Audio(`data:audio/mp3;base64,${base64}`);
  audio.play();
}
