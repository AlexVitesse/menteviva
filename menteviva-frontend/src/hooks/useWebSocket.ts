import { useCallback, useRef, useEffect, useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import type { UserProfile } from "../types";
import { getWebSocketTicket } from "../lib/api";
import { parseServerEvent } from "../types/wsProtocol";

// Si VITE_WS_URL no esta seteado, derivamos del location actual. Asi:
// - localhost:5173 -> ws://localhost:5173 (vite proxea a backend)
// - tunnel.devtunnels.ms -> wss://tunnel.devtunnels.ms (mismo tunnel)
function getWsBaseUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

const WS_BASE_URL = getWsBaseUrl();
export type SocketLifecycleState = "idle" | "connecting" | "open" | "ending" | "closed" | "error";

export interface WsInitPayload {
  user_profile?: UserProfile;
  session_vars?: Record<string, string | number | string[]>;
  // Para avatares que soportan niveles de dificultad (Roberto). El backend
  // ensambla el prompt segun este valor; ignorado por avatares sin niveles.
  level?: "principiante" | "intermedio" | "avanzado";
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
  const [connectionState, setConnectionState] = useState<SocketLifecycleState>("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const connectionGenerationRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAllowedRef = useRef(true);
  const connectRef = useRef<() => Promise<void>>(async () => undefined);
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

  const connect = useCallback(async () => {
    if (!avatarId) return;
    reconnectAllowedRef.current = true;
    setConnectionState("connecting");
    const current = wsRef.current;
    if (
      current?.readyState === WebSocket.CONNECTING ||
      current?.readyState === WebSocket.OPEN
    ) {
      return;
    }

    const generation = ++connectionGenerationRef.current;
    setStatus("connecting");
    setServerError(null);
    let ticket: string;
    try {
      ticket = await getWebSocketTicket();
    } catch (error) {
      if (generation !== connectionGenerationRef.current) return;
      setStatus("disconnected");
      setConnectionState("error");
      setServerError(
        error instanceof Error
          ? error.message
          : "No pudimos autorizar la conexión de voz."
      );
      return;
    }
    if (generation !== connectionGenerationRef.current) return;
    const wsUrl = `${WS_BASE_URL}/api/conversation/${encodeURIComponent(avatarId)}?ticket=${encodeURIComponent(ticket)}`;
    console.log("[WS] Connecting to:", wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (generation !== connectionGenerationRef.current || wsRef.current !== ws) {
        ws.close();
        return;
      }
      console.log("[WS] Connected");
      setConnectionState("open");
      reconnectAttemptsRef.current = 0;
      setStatus("ready");
      const payload = initPayloadRef.current;
      if (payload && (payload.user_profile || payload.session_vars || payload.level)) {
        console.log("[WS] Sending init payload (level:", payload.level ?? "default", ")");
        ws.send(JSON.stringify({
          type: "init",
          session_vars: payload.session_vars,
          level: payload.level,
        }));
      }
    };

    ws.onmessage = (event) => {
      if (generation !== connectionGenerationRef.current || wsRef.current !== ws) return;
      let data;
      try {
        data = parseServerEvent(event.data);
      } catch {
        setServerError("El servidor envió un mensaje inválido.");
        return;
      }

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
          if (data.metrics) setMetrics(data.metrics);
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
      if (generation !== connectionGenerationRef.current || wsRef.current !== ws) return;
      wsRef.current = null;
      setStatus("disconnected");
      setConnectionState(event.code === 1000 ? "closed" : "error");
      pendingTextRef.current = "";
      if (event.code === 1008 || event.code === 1009) {
        reconnectAllowedRef.current = false;
        setServerError(event.reason || "La conexión fue rechazada por el servidor.");
      } else if (
        reconnectAllowedRef.current &&
        (event.code === 1006 || event.code === 1011) &&
        reconnectAttemptsRef.current < 2
      ) {
        const delay = 500 * 2 ** reconnectAttemptsRef.current++;
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          void connectRef.current();
        }, delay);
      }
    };

    ws.onerror = (event) => {
      console.error("[WS] Error event:", event);
      if (generation !== connectionGenerationRef.current || wsRef.current !== ws) return;
      setStatus("disconnected");
      setConnectionState("error");
      pendingTextRef.current = "";
    };
  }, [
    avatarId,
    setStatus,
    addMessage,
    setMetrics,
    setServerError,
  ]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

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
    reconnectAllowedRef.current = false;
    setConnectionState("ending");
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end_session" }));
    }
  }, []);

  const disconnect = useCallback(() => {
    reconnectAllowedRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    connectionGenerationRef.current += 1;
    const ws = wsRef.current;
    wsRef.current = null;
    ws?.close();
    pendingTextRef.current = "";
    pendingAssistantTextRef.current = "";
    setConnectionState("closed");
  }, []);

  useEffect(() => {
    window.addEventListener("menteviva:logout", disconnect);
    return () => {
      window.removeEventListener("menteviva:logout", disconnect);
      disconnect();
    };
  }, [disconnect]);

  return { connect, sendAudio, endSession, disconnect, connectionState };
}
