import type { Diagnostico, Registro, UserProfile } from "../types";

const STORAGE_KEY = "menteviva:user_profile";

export function loadUserProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch (error) {
    console.warn("[userProfileStorage] localStorage corrupto, ignorando", error);
    return null;
  }
}

export function saveUserProfile(profile: UserProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch (error) {
    console.error("[userProfileStorage] fallo al guardar", error);
  }
}

export function clearUserProfile(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function createProfileFromRegistro(registro: Registro): UserProfile {
  const now = new Date().toISOString();
  return {
    user_id: crypto.randomUUID(),
    created_at: now,
    updated_at: now,
    registro,
    diagnostico: null,
  };
}

export function withUpdatedRegistro(profile: UserProfile, registro: Registro): UserProfile {
  return {
    ...profile,
    registro,
    updated_at: new Date().toISOString(),
  };
}

export function withUpdatedDiagnostico(
  profile: UserProfile,
  diagnostico: Diagnostico,
): UserProfile {
  return {
    ...profile,
    diagnostico,
    updated_at: new Date().toISOString(),
  };
}
