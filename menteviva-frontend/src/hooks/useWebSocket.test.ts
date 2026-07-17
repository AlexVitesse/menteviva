import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWebSocket } from "./useWebSocket";
import { useSessionStore } from "../stores/sessionStore";

vi.mock("../lib/api", () => ({
  getWebSocketTicket: vi.fn(async () => "ticket-test"),
}));

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(value: string) {
    this.sent.push(value);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
}

describe("useWebSocket", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    useSessionStore.setState({
      status: "disconnected",
      serverError: null,
      messages: [],
      metrics: null,
    });
  });

  it("no abre una segunda conexion mientras la primera esta conectando", async () => {
    const { result } = renderHook(() => useWebSocket({ avatarId: "roberto" }));

    await act(async () => {
      await Promise.all([result.current.connect(), result.current.connect()]);
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain("ticket=ticket-test");
  });

  it("reporta JSON invalido sin romper la conexion", async () => {
    const { result } = renderHook(() => useWebSocket({ avatarId: "roberto" }));
    await act(async () => result.current.connect());
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.open();
      ws.onmessage?.({ data: "no-json" });
    });

    await waitFor(() => {
      expect(useSessionStore.getState().serverError).toContain("mensaje inválido");
    });
  });

  it("expone el motivo de cierres de politica", async () => {
    const { result } = renderHook(() => useWebSocket({ avatarId: "roberto" }));
    await act(async () => result.current.connect());
    const ws = MockWebSocket.instances[0];

    act(() => {
      ws.open();
      ws.onclose?.({ code: 1008, reason: "Ticket expirado" });
    });

    expect(useSessionStore.getState().serverError).toBe("Ticket expirado");
    expect(useSessionStore.getState().status).toBe("disconnected");
  });

  it("procesa todos los eventos principales del servidor", async () => {
    const onAudioStart = vi.fn();
    const onAudioChunk = vi.fn();
    const onAudioEnd = vi.fn();
    const onClosingIntent = vi.fn();
    const { result } = renderHook(() => useWebSocket({
      avatarId: "roberto",
      onAudioStart,
      onAudioChunk,
      onAudioEnd,
      onClosingIntent,
    }));
    await act(async () => result.current.connect());
    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.open();
      for (const event of [
        { type: "status", status: "thinking" },
        { type: "user_message", content: "hola" },
        { type: "assistant_token", content: "respuesta" },
        { type: "assistant_audio_start" },
        { type: "assistant_audio_chunk", audio: "AAAA" },
        { type: "assistant_audio_end" },
        { type: "closing_intent" },
        { type: "session_end", metrics: { total_exchanges: 1, conversation: [] } },
      ]) ws.onmessage?.({ data: JSON.stringify(event) });
    });

    expect(onAudioStart).toHaveBeenCalledOnce();
    expect(onAudioChunk).toHaveBeenCalledWith("AAAA");
    expect(onAudioEnd).toHaveBeenCalledOnce();
    expect(onClosingIntent).toHaveBeenCalledOnce();
    expect(useSessionStore.getState().messages).toHaveLength(2);
    expect(useSessionStore.getState().metrics?.total_exchanges).toBe(1);
  });

  it("reconecta una vez tras un corte recuperable", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWebSocket({ avatarId: "roberto" }));
    await act(async () => result.current.connect());
    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.open();
      ws.onclose?.({ code: 1006, reason: "" });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.useRealTimers();
  });
});
