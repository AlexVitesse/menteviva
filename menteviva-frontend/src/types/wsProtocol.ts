import type { ConnectionStatus, SessionMetrics } from "./index";

export type ServerEvent =
  | { type: "status"; status: ConnectionStatus }
  | { type: "user_message"; content: string }
  | { type: "assistant_token"; content: string }
  | { type: "assistant_audio_start"; content?: string }
  | { type: "assistant_audio_chunk"; audio: string }
  | { type: "assistant_audio_end" }
  | { type: "output_transcript"; content: string }
  | { type: "turn_complete" }
  | { type: "interrupted" }
  | { type: "closing_intent" }
  | { type: "session_end"; metrics?: SessionMetrics; vocal_note?: string }
  | { type: "error"; code?: string; message?: string; error?: string };

export function parseServerEvent(raw: string): ServerEvent {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("type" in value)) {
    throw new Error("Evento WebSocket invalido");
  }
  const event = value as Record<string, unknown>;
  if (typeof event.type !== "string") throw new Error("Tipo WebSocket invalido");
  const requireString = (field: string) => {
    if (typeof event[field] !== "string") {
      throw new Error(`Campo WebSocket invalido: ${field}`);
    }
  };
  switch (event.type) {
    case "status":
      requireString("status");
      break;
    case "user_message":
    case "assistant_token":
    case "output_transcript":
      requireString("content");
      break;
    case "assistant_audio_chunk":
      requireString("audio");
      break;
    case "assistant_audio_start":
      if (event.content !== undefined && typeof event.content !== "string") {
        throw new Error("Campo WebSocket invalido: content");
      }
      break;
    case "session_end":
      if (event.metrics !== undefined && (!event.metrics || typeof event.metrics !== "object")) {
        throw new Error("Campo WebSocket invalido: metrics");
      }
      break;
    case "error":
      if (![event.code, event.message, event.error].some((item) => typeof item === "string")) {
        throw new Error("Evento WebSocket error sin mensaje");
      }
      break;
    case "assistant_audio_end":
    case "turn_complete":
    case "interrupted":
    case "closing_intent":
      break;
    default:
      throw new Error(`Evento WebSocket desconocido: ${event.type}`);
  }
  return event as ServerEvent;
}
