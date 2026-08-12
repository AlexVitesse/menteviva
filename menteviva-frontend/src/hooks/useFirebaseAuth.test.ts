import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionStore } from "../stores/sessionStore";
import { useFirebaseAuth } from "./useFirebaseAuth";

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as { uid: string } | null },
  listener: null as ((user: { uid: string } | null) => Promise<void>) | null,
  apiFetch: vi.fn(),
}));
const MockApiError = vi.hoisted(() => class ApiError extends Error {
  constructor(public status: number) { super(`HTTP ${status}`); }
});

vi.mock("../lib/firebase", () => ({ firebaseAuth: mocks.auth }));
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: vi.fn((_auth, callback) => {
    mocks.listener = callback;
    return vi.fn();
  }),
}));
vi.mock("../lib/api", () => ({
  ApiError: MockApiError,
  apiFetch: mocks.apiFetch,
}));

const profile = (uid: string) => ({
  user_id: uid,
  registro: {
    nombre: uid,
    email: `${uid}@example.test`,
    rol_objetivo: "QA",
    industria: "Software",
    experience_level: "mid",
  },
  diagnostico: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("useFirebaseAuth", () => {
  beforeEach(() => {
    mocks.auth.currentUser = null;
    mocks.listener = null;
    mocks.apiFetch.mockReset();
    useSessionStore.getState().clearUserProfile();
  });

  it("no restaura el perfil si ocurre logout durante auth/sync", async () => {
    const sync = deferred<ReturnType<typeof profile>>();
    mocks.apiFetch.mockReturnValueOnce(sync.promise);
    renderHook(() => useFirebaseAuth());
    const user = { uid: "user-a" };
    mocks.auth.currentUser = user;

    await act(async () => { void mocks.listener?.(user); });
    mocks.auth.currentUser = null;
    await act(async () => { await mocks.listener?.(null); });
    await act(async () => { sync.resolve(profile("user-a")); await sync.promise; });

    expect(useSessionStore.getState().userProfile).toBeNull();
  });

  it("ignora la respuesta de A cuando Firebase ya cambio a B", async () => {
    const syncA = deferred<ReturnType<typeof profile>>();
    const syncB = deferred<ReturnType<typeof profile>>();
    mocks.apiFetch.mockReturnValueOnce(syncA.promise).mockReturnValueOnce(syncB.promise);
    const { result } = renderHook(() => useFirebaseAuth());
    const userA = { uid: "user-a" };
    const userB = { uid: "user-b" };

    mocks.auth.currentUser = userA;
    await act(async () => { void mocks.listener?.(userA); });
    mocks.auth.currentUser = userB;
    await act(async () => { void mocks.listener?.(userB); });
    await act(async () => { syncA.resolve(profile("user-a")); await syncA.promise; });
    await act(async () => { syncB.resolve(profile("user-b")); await syncB.promise; });

    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(useSessionStore.getState().userProfile?.user_id).toBe("user-b");
  });

  it("expone needs_registration ante 404", async () => {
    mocks.apiFetch.mockRejectedValueOnce(new MockApiError(404));
    const { result } = renderHook(() => useFirebaseAuth());
    const user = { uid: "new-user" };
    mocks.auth.currentUser = user;
    await act(async () => { await mocks.listener?.(user); });
    await waitFor(() => expect(result.current.status).toBe("needs_registration"));
    expect(useSessionStore.getState().needsRegistration).toBe(true);
  });

  it("deja un error recuperable ante fallo de servidor", async () => {
    mocks.apiFetch.mockRejectedValueOnce(new MockApiError(503));
    const { result } = renderHook(() => useFirebaseAuth());
    const user = { uid: "user-a" };
    mocks.auth.currentUser = user;
    await act(async () => { await mocks.listener?.(user); });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(useSessionStore.getState().authError).toContain("Reintenta");
  });
});
