import { beforeEach, describe, expect, it } from "vitest";

import { useSessionStore } from "./sessionStore";


describe("sessionStore logout", () => {
  beforeEach(() => localStorage.clear());

  it("elimina datos de identidad y de la sesion activa", () => {
    useSessionStore.setState({
      userProfile: {
        user_id: "uid-a",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        registro: {
          nombre: "Usuario A",
          rol_objetivo: "Ventas",
          industria: "SaaS",
          experience_level: "mid",
        },
        diagnostico: null,
      },
      messages: [
        { id: "m1", role: "user", content: "privado", timestamp: new Date() },
      ],
      metrics: { total_exchanges: 1, duration_seconds: 1, conversation: [] },
      status: "ready",
    });

    useSessionStore.getState().clearUserProfile();
    const state = useSessionStore.getState();

    expect(state.userProfile).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.metrics).toBeNull();
    expect(state.status).toBe("disconnected");
    expect(localStorage.getItem("menteviva_user_profile")).toBeNull();
  });

  it("actualiza registro, mensajes, seleccion y reinicia solo la sesion", () => {
    const store = useSessionStore.getState();
    const created = store.initRegistro({
      nombre: "QA",
      rol_objetivo: "Lead",
      industria: "Software",
      experience_level: "mid",
    });
    expect(created.user_id).toBeTruthy();
    store.updateRegistro({ ...created.registro, industria: "Fintech" });
    useSessionStore.getState().addMessage({
      id: "m2", role: "assistant", content: "ok", timestamp: new Date(),
    });
    useSessionStore.getState().setStatus("thinking");
    useSessionStore.getState().setServerError("fallo");
    useSessionStore.getState().resetSession();

    const state = useSessionStore.getState();
    expect(state.userProfile?.registro.industria).toBe("Fintech");
    expect(state.messages).toEqual([]);
    expect(state.status).toBe("disconnected");
    expect(state.serverError).toBeNull();
  });

  it("hidrata perfil autenticado y limpia el diagnostico", () => {
    const authenticated = {
      user_id: "uid-auth",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      registro: {
        nombre: "QA", rol_objetivo: "Lead", industria: "Software",
        experience_level: "mid" as const,
      },
      diagnostico: { overall_score: 80 } as never,
    };
    useSessionStore.getState().setUserProfileFromAuth(authenticated);
    useSessionStore.getState().clearDiagnostico();
    expect(useSessionStore.getState().userProfile?.diagnostico).toBeNull();
  });
});
