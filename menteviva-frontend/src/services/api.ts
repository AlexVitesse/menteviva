import type { Avatar } from "../types";
import { apiFetch } from "../lib/api";

// VITE_API_URL vacio (default) -> URLs relativas. Vite proxea /api al backend
// y, al acceder via tunnel, todo viaja por la misma URL. Override solo si
// se quiere apuntar a un backend remoto especifico.
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

/**
 * Obtiene la lista de avatares disponibles
 */
export async function fetchAvatars(): Promise<ApiResponse<Avatar[]>> {
  try {
    const data = await apiFetch<{ avatars: Avatar[] }>("/api/avatars");
    return { data: data.avatars, error: null };
  } catch (error) {
    console.error("Error fetching avatars:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Error desconocido"
    };
  }
}

/**
 * Obtiene un avatar por su ID
 */
export async function fetchAvatarById(id: string): Promise<ApiResponse<Avatar>> {
  try {
    const data = await apiFetch<Avatar>(`/api/avatars/${encodeURIComponent(id)}`);
    return { data: data, error: null };
  } catch (error) {
    console.error("Error fetching avatar:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Error desconocido"
    };
  }
}

/**
 * Verifica el estado de salud del servidor
 */
export async function healthCheck(): Promise<boolean> {
  try {
    await apiFetch<{ status: string }>("/health");
    return true;
  } catch {
    return false;
  }
}
