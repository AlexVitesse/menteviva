import { useCallback, useRef, useEffect } from "react";
import { useSessionStore } from "../stores/sessionStore";
import type { UserProfile } from "../types";

// Si VITE_WS_URL no esta seteado, derivamos del location actual. Asi:
// - localhost:5173 -> ws://localhost:5173 (vite proxea a backend)
// - tunnel.devtunnels.ms -> wss://tunnel.devtunnels.ms (mismo tunnel)
function getWsBaseUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

const WS_BASE_URL = getWsBaseUrl();

export interface WsInitPayload {
  user_profile?: UserProfile;
  session_vars?: Record<string, string | number | string[]>;
}

interface UseWebSocketOptions {
  avatarId: string | undefined;
  initPayload?: WsInitPayload;
  // Callbacks para streaming TTS
  onAudioStart?: () => void;
  onAudioChunk?: (base64Chunk: string) => void;
  onAudioEnd?: () => void;
  // Sofia emitio [CIERRE] -> backend manda closing_intent.
  // El consumer decide que hacer (countdown + endSession, etc).
  onClosingIntent?: () => void;
}

export function useWebSocket({
  avatarId,
  initPayload,
  onAudioStart,
  onAudioChunk,
  onAudioEnd,
  onClosingIntent,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const pendingTextRef = useRef<string>("");
  // Texto del asistente que llega en assistant_audio_start. No se muestra
  // hasta assistant_audio_end (que es cuando el audio empieza a reproducirse)
  // para que caption y voz aparezcan juntas.
  const pendingAssistantTextRef = useRef<string>("");
  const initPayloadRef = useRef(initPayload);
  const audioCallbacksRef = useRef({ onAudioStart, onAudioChunk, onAudioEnd });
  const onClosingIntentRef = useRef(onClosingIntent);
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

  useEffect(() => {
    onClosingIntentRef.current = onClosingIntent;
  }, [onClosingIntent]);

  const connect = useCallback(() => {
    if (!avatarId) return;

    const wsUrl = `${WS_BASE_URL}/api/conversation/${avatarId}`;
    console.log("[WS] Connecting to:", wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[WS] Connected");
      setStatus("ready");
      const payload = initPayloadRef.current;
      if (payload && (payload.user_profile || payload.session_vars)) {
        console.log("[WS] Sending init payload");
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
          console.log("[WS] assistant_audio_start, contenido:", data.content?.slice(0, 40));
          // Guardamos el texto pero NO lo mostramos todavia. Aparecera en
          // assistant_audio_end junto con el play() del audio.
          pendingAssistantTextRef.current = data.content || pendingTextRef.current;
          pendingTextRef.current = "";
          audioCallbacksRef.current.onAudioStart?.();
          break;

        case "assistant_audio_chunk":
          audioCallbacksRef.current.onAudioChunk?.(data.audio);
          break;

        case "assistant_audio_end":
          console.log("[WS] assistant_audio_end recibido");
          if (pendingAssistantTextRef.current) {
            addMessage({
              id: crypto.randomUUID(),
              role: "assistant",
              content: pendingAssistantTextRef.current,
              timestamp: new Date(),
            });
            pendingAssistantTextRef.current = "";
          }
          audioCallbacksRef.current.onAudioEnd?.();
          break;

        case "closing_intent":
          console.log("[WS] closing_intent recibido");
          onClosingIntentRef.current?.();
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

    ws.onclose = (event) => {
      console.log("[WS] Closed:", event.code, event.reason || "(no reason)");
      setStatus("disconnected");
      pendingTextRef.current = "";
    };

    ws.onerror = (event) => {
      console.error("[WS] Error event:", event);
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

  const sendAudio = useCallback((audioBase64: string, format = "audio.webm") => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "audio",
        audio: audioBase64,
        format,
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
