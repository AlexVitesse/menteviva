// Toggle de avatar 3D (TalkingHeadAvatar) vs Lottie SVG.
// Default = ON (3D). Para forzar el SVG legacy: ?avatar3d=0 (se persiste en
// localStorage como "0" hasta que se limpie con ?avatar3d=1 o se borre el
// storage). Antes era opt-in, ahora es opt-out porque el 3D ya es la
// experiencia oficial de Roberto y Maria.
const STORAGE_KEY = "mv_avatar3d";

export function getAvatar3DFlag(): boolean {
  if (typeof window === "undefined") return true;
  const param = new URLSearchParams(window.location.search).get("avatar3d");
  if (param === "1") {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
    return true;
  }
  if (param === "0") {
    try { localStorage.setItem(STORAGE_KEY, "0"); } catch { /* noop */ }
    return false;
  }
  try { return localStorage.getItem(STORAGE_KEY) !== "0"; } catch { return true; }
}

// Mapeo de avatar.id -> path del .glb. Sofia (entrevistadora del diagnostico)
// vive aparte porque su componente carga el modelo por defecto del componente.
//
// avatarsdk.glb = hombre con barba pelirroja (Roberto, Director de Operaciones).
// avaturn.glb   = mujer cabello largo con traje (Maria, Gerente de Compras).
// (Snapshots PNG generados via /__snapshot/:model y guardados aqui mismo.)
export const AVATAR_MODEL_URLS: Record<string, string> = {
  roberto: "/avatars/avatarsdk.glb",
  maria: "/avatars/avaturn.glb",
  // carlos: por ahora cae al default si no esta mapeado.
};

export function getAvatarModelUrl(avatarId: string | undefined): string | null {
  if (!avatarId) return null;
  return AVATAR_MODEL_URLS[avatarId] ?? null;
}

// Genero del rig (para elegir la animacion idle correcta de RPM).
// roberto = barba/hombre, masculine. maria = mujer, feminine. Sofia (diagnostico)
// es feminine por default.
const AVATAR_GENDER: Record<string, "feminine" | "masculine"> = {
  roberto: "masculine",
  maria: "feminine",
  sofia: "feminine",
};

export function getAvatarGender(avatarId: string | undefined): "feminine" | "masculine" {
  if (!avatarId) return "feminine";
  return AVATAR_GENDER[avatarId] ?? "feminine";
}
