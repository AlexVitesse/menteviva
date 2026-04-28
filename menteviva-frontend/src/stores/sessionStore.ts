import { create } from "zustand";
import type {
  Avatar,
  ConnectionStatus,
  Diagnostico,
  Message,
  Registro,
  SessionMetrics,
  UserProfile,
} from "../types";
import {
  clearUserProfile as clearStoredProfile,
  createProfileFromRegistro,
  loadUserProfile,
  saveUserProfile,
  withUpdatedDiagnostico,
  withUpdatedRegistro,
} from "../utils/userProfileStorage";

export interface DiagnosticoSessionVars {
  idioma: string;
  tono: string;
  minutos: number;
  competencias?: string[];
}

export type SimulationLevel = "principiante" | "intermedio" | "avanzado";

interface SessionState {
  // Avatar seleccionado
  selectedAvatar: Avatar | null;
  setSelectedAvatar: (avatar: Avatar) => void;

  // Nivel de dificultad seleccionado en Briefing (Roberto soporta 3 niveles).
  // Default principiante. No persiste entre sesiones.
  selectedLevel: SimulationLevel;
  setSelectedLevel: (level: SimulationLevel) => void;

  // Configuracion de la sesion de diagnostico (transient, no persiste)
  diagnosticoVars: DiagnosticoSessionVars | null;
  setDiagnosticoVars: (vars: DiagnosticoSessionVars) => void;

  // Mensajes de la conversacion
  messages: Message[];
  addMessage: (message: Message) => void;
  clearMessages: () => void;

  // Estado de conexion
  status: ConnectionStatus;
  setStatus: (status: ConnectionStatus) => void;

  // Error del servidor
  serverError: string | null;
  setServerError: (error: string | null) => void;

  // Metricas finales
  metrics: SessionMetrics | null;
  setMetrics: (metrics: SessionMetrics) => void;

  // Perfil del usuario (registro + diagnostico). Hidratado desde localStorage al init.
  userProfile: UserProfile | null;
  initRegistro: (registro: Registro) => UserProfile;
  updateRegistro: (registro: Registro) => void;
  updateDiagnostico: (diagnostico: Diagnostico) => void;
  clearDiagnostico: () => void;
  clearUserProfile: () => void;
  // Reemplaza el userProfile con uno traido del backend (post Firebase login).
  // Persiste en localStorage para mantener el resto del flujo (sessionVars
  // del WS, dashboard) que ya espera userProfile en el store.
  setUserProfileFromAuth: (profile: UserProfile) => void;

  // Reset completo (no toca el userProfile)
  resetSession: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  selectedAvatar: null,
  setSelectedAvatar: (avatar) => set({ selectedAvatar: avatar }),

  selectedLevel: "principiante",
  setSelectedLevel: (level) => set({ selectedLevel: level }),

  diagnosticoVars: null,
  setDiagnosticoVars: (vars) => set({ diagnosticoVars: vars }),

  messages: [],
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  clearMessages: () => set({ messages: [] }),

  status: "disconnected",
  setStatus: (status) => set({ status }),

  serverError: null,
  setServerError: (error) => set({ serverError: error }),

  metrics: null,
  setMetrics: (metrics) => set({ metrics }),

  userProfile: loadUserProfile(),

  initRegistro: (registro) => {
    const profile = createProfileFromRegistro(registro);
    saveUserProfile(profile);
    set({ userProfile: profile });
    return profile;
  },

  updateRegistro: (registro) => {
    const current = get().userProfile;
    if (!current) {
      const profile = createProfileFromRegistro(registro);
      saveUserProfile(profile);
      set({ userProfile: profile });
      return;
    }
    const updated = withUpdatedRegistro(current, registro);
    saveUserProfile(updated);
    set({ userProfile: updated });
  },

  updateDiagnostico: (diagnostico) => {
    const current = get().userProfile;
    if (!current) {
      console.warn("[sessionStore] updateDiagnostico sin registro previo; se ignora");
      return;
    }
    const updated = withUpdatedDiagnostico(current, diagnostico);
    saveUserProfile(updated);
    set({ userProfile: updated });
  },

  clearDiagnostico: () => {
    const current = get().userProfile;
    if (!current) return;
    const updated = {
      ...current,
      diagnostico: null,
      updated_at: new Date().toISOString(),
    };
    saveUserProfile(updated);
    set({ userProfile: updated });
  },

  clearUserProfile: () => {
    clearStoredProfile();
    set({ userProfile: null });
  },

  setUserProfileFromAuth: (profile) => {
    saveUserProfile(profile);
    set({ userProfile: profile });
  },

  resetSession: () =>
    set({
      messages: [],
      status: "disconnected",
      metrics: null,
      serverError: null,
    }),
}));
