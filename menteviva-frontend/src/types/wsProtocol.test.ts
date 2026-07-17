import { describe, expect, it } from "vitest";

import { parseServerEvent } from "./wsProtocol";

describe("parseServerEvent", () => {
  const validEvents = [
    { type: "status", status: "ready" },
    { type: "user_message", content: "hola" },
    { type: "assistant_token", content: "hola" },
    { type: "assistant_audio_start", content: "hola" },
    { type: "assistant_audio_chunk", audio: "AAAA" },
    { type: "assistant_audio_end" },
    { type: "output_transcript", content: "hola" },
    { type: "turn_complete" },
    { type: "interrupted" },
    { type: "closing_intent" },
    { type: "session_end", metrics: { total_exchanges: 0, conversation: [] } },
    { type: "error", code: "quota", message: "Limite" },
  ];

  it.each(validEvents)("acepta el contrato $type", (event) => {
    expect(parseServerEvent(JSON.stringify(event))).toEqual(event);
  });

  it.each([
    "no-json",
    JSON.stringify(null),
    JSON.stringify({}),
    JSON.stringify({ type: "unknown" }),
    JSON.stringify({ type: "user_message", content: 1 }),
    JSON.stringify({ type: "assistant_audio_chunk" }),
    JSON.stringify({ type: "session_end", metrics: "bad" }),
    JSON.stringify({ type: "error" }),
  ])("rechaza eventos invalidos", (raw) => {
    expect(() => parseServerEvent(raw)).toThrow();
  });
});
