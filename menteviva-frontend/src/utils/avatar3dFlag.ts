// Toggle de avatar 3D (TalkingHeadAvatar) vs Lottie SVG.
// Resolucion: query string ?avatar3d=1 o ?avatar3d=0 lo fija y lo persiste
// en localStorage. En navegaciones siguientes se recupera de localStorage.
const STORAGE_KEY = "mv_avatar3d";

export function getAvatar3DFlag(): boolean {
  if (typeof window === "undefined") return false;
  const param = new URLSearchParams(window.location.search).get("avatar3d");
  if (param === "1") {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* noop */ }
    return true;
  }
  if (param === "0") {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
    return false;
  }
  try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
}

// Mapeo de avatar.id -> path del .glb. Sofia (entrevistadora del diagnostico)
// vive aparte porque su componente carga el modelo por defecto del componente.
export const AVATAR_MODEL_URLS: Record<string, string> = {
  roberto: "/avatars/avaturn.glb",
  maria: "/avatars/avatarsdk.glb",
  // carlos: por ahora cae al default si no esta mapeado
};

export function getAvatarModelUrl(avatarId: string | undefined): string | null {
  if (!avatarId) return null;
  return AVATAR_MODEL_URLS[avatarId] ?? null;
}
