import { create } from "zustand";
import type { Avatar, Message, SessionMetrics, ConnectionStatus } from "../types";

interface SessionState {
  // Avatar seleccionado
  selectedAvatar: Avatar | null;
  setSelectedAvatar: (avatar: Avatar) => void;

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

  // Reset completo
  resetSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  selectedAvatar: null,
  setSelectedAvatar: (avatar) => set({ selectedAvatar: avatar }),

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

  resetSession: () =>
    set({
      messages: [],
      status: "disconnected",
      metrics: null,
      serverError: null,
    }),
}));
