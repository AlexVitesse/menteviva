import type { Diagnostico, ExperienceLevel, Registro, UserProfile } from "../types";

const STORAGE_KEY = "menteviva:user_profile";

const VALID_EXPERIENCE_LEVELS: ExperienceLevel[] = [
  "entry",
  "junior",
  "mid",
  "senior",
  "lead",
  "executive",
];

/**
 * Rellena campos faltantes del registro (ej. experience_level ausente en
 * perfiles guardados antes de que el form lo pidiera, o cuentas "Test" sin
 * el campo). Sin esto, el backend rechaza el UserProfile en pydantic y la
 * sesion termina sin diagnostico.
 */
function migrateRegistro(reg: unknown): Registro | null {
  if (!reg || typeof reg !== "object") return null;
  const r = reg as Record<string, unknown>;
  if (typeof r.nombre !== "string" || !r.nombre.trim()) return null;
  if (typeof r.rol_objetivo !== "string" || !r.rol_objetivo.trim()) return null;
  if (typeof r.industria !== "string" || !r.industria.trim()) return null;
  const level = r.experience_level;
  const experience_level: ExperienceLevel =
    typeof level === "string" && (VALID_EXPERIENCE_LEVELS as string[]).includes(level)
      ? (level as ExperienceLevel)
      : "mid";
  return {
    nombre: r.nombre,
    email: typeof r.email === "string" ? r.email : undefined,
    rol_objetivo: r.rol_objetivo,
    industria: r.industria,
    experience_level,
  };
}

export function loadUserProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const registro = migrateRegistro(parsed.registro);
    if (!registro) return null;
    const profile: UserProfile = {
      user_id:
        typeof parsed.user_id === "string" ? parsed.user_id : crypto.randomUUID(),
      created_at:
        typeof parsed.created_at === "string"
          ? parsed.created_at
          : new Date().toISOString(),
      updated_at:
        typeof parsed.updated_at === "string"
          ? parsed.updated_at
          : new Date().toISOString(),
      registro,
      diagnostico: (parsed.diagnostico as Diagnostico | null | undefined) ?? null,
    };
    // Si la hidratacion rellenó algún campo, re-guardamos para que sea
    // consistente en la siguiente carga.
    const normalized = JSON.stringify(profile);
    if (normalized !== raw) {
      localStorage.setItem(STORAGE_KEY, normalized);
    }
    return profile;
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
