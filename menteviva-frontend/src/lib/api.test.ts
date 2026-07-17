import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  currentUser: { getIdToken: vi.fn(async () => "firebase-token") },
}));
vi.mock("./firebase", () => ({ firebaseAuth: auth }));

import { apiFetch, getWebSocketTicket } from "./api";

describe("apiFetch", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("adjunta Firebase y serializa JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await expect(apiFetch("/api/me", { method: "POST", json: { a: 1 } }))
      .resolves.toEqual({ ok: true });
    const [, options] = fetchMock.mock.calls[0];
    const headers = options?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer firebase-token");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(options?.body).toBe('{"a":1}');
  });

  it("normaliza errores HTTP con detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "No autorizado" }), { status: 401 }),
    );
    await expect(apiFetch("/api/me")).rejects.toMatchObject({
      status: 401,
      message: "No autorizado",
    });
  });

  it("obtiene un ticket WebSocket", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ticket: "opaque" }), { status: 200 }),
    );
    await expect(getWebSocketTicket()).resolves.toBe("opaque");
  });
});
