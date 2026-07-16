// Selector del proveedor de avatar de video (generaliza simliFlag.ts).
//
// Provider efectivo del frontend: decide QUE hook de avatar montar
//   - "simli" -> useSimliAvatar (video WebRTC via simli-client)
//   - "oss"   -> useOssAvatar   (video WebRTC contra el avatar-service self-hosted)
//   - "none"  -> sin video; avatar 2D
//
// El backend es la autoridad final (POST /api/avatar/session responde con
// `provider`), pero el frontend necesita saber ANTES cual hook instanciar, asi
// que se elige por config, igual que hacia simliFlag. El backend debe estar
// configurado con el MISMO AVATAR_PROVIDER; si no coincide, el hook cae a 2D.
//
// Fuente (en orden): override por URL (?avatar=simli|oss|none, persistido en
// localStorage) > VITE_AVATAR_PROVIDER > compat con el viejo VITE_SIMLI_AVATAR
// via getSimliFlag() (simli|none). Este ultimo fallback garantiza REGRESION
// CERO: un deploy que solo setea VITE_SIMLI_AVATAR se comporta identico a hoy.
import { getSimliFlag } from "./simliFlag";

export type AvatarProvider = "simli" | "oss" | "none";

const STORAGE_KEY = "mv_avatar_provider";

function normalize(v: string | null | undefined): AvatarProvider | null {
  if (v === "simli" || v === "oss" || v === "none") return v;
  return null;
}

export function getAvatarProvider(): AvatarProvider {
  const envDefault =
    normalize(import.meta.env.VITE_AVATAR_PROVIDER) ??
    // Compat: sin VITE_AVATAR_PROVIDER, derivar del flag viejo de Simli.
    (getSimliFlag() ? "simli" : "none");

  if (typeof window === "undefined") return envDefault;

  const param = normalize(new URLSearchParams(window.location.search).get("avatar"));
  if (param) {
    try {
      localStorage.setItem(STORAGE_KEY, param);
    } catch {
      /* noop */
    }
    return param;
  }
  try {
    const stored = normalize(localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch {
    /* noop */
  }
  return envDefault;
}
