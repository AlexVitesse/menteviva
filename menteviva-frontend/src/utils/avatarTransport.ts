// Selector del TRANSPORTE del proveedor de avatar OSS.
//
// Ortogonal al provider (getAvatarProvider): solo aplica cuando el provider es
// "oss". Elige como llega el video del avatar-service:
//   - "webrtc" (default) -> useOssAvatar. Producción (VPS con TURN). Contrato §1.
//   - "ws"               -> useOssAvatarWs. Interino para RunPod, cuyo NAT no deja
//                           pasar WebRTC sin TURN: video como frames JPEG por un
//                           WebSocket, audio de Gemini reproducido en local.
//
// Fuente (en orden): override por URL (?transport=webrtc|ws, persistido en
// localStorage) > VITE_AVATAR_TRANSPORT > default "webrtc". El default garantiza
// que NO se toca el path WebRTC salvo que se active explícitamente el modo WS.

export type AvatarTransport = "webrtc" | "ws";

const STORAGE_KEY = "mv_avatar_transport";

function normalize(v: string | null | undefined): AvatarTransport | null {
  if (v === "webrtc" || v === "ws") return v;
  return null;
}

export function getAvatarTransport(): AvatarTransport {
  const envDefault = normalize(import.meta.env.VITE_AVATAR_TRANSPORT) ?? "webrtc";

  if (typeof window === "undefined") return envDefault;

  const param = normalize(new URLSearchParams(window.location.search).get("transport"));
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
