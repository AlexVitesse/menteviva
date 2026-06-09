// Toggle del avatar fotorrealista Simli (video WebRTC). Solo aplica en modo
// Gemini: el sink de audio que alimenta a Simli vive en useGeminiLive.
//
// Default = VITE_SIMLI_AVATAR ("1" = on). Override por URL: ?simli=1 / ?simli=0
// (se persiste en localStorage, mismo patron que avatar3dFlag). El override
// existe para poder encender/apagar en el piloto sin redeployar — y porque
// Simli factura por minuto: apagado cae al avatar 3D gratuito.
const STORAGE_KEY = "mv_simli";

export function getSimliFlag(): boolean {
  const envDefault = import.meta.env.VITE_SIMLI_AVATAR === "1";
  if (typeof window === "undefined") return envDefault;
  const param = new URLSearchParams(window.location.search).get("simli");
  if (param === "1") {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* noop */ }
    return true;
  }
  if (param === "0") {
    try { localStorage.setItem(STORAGE_KEY, "0"); } catch { /* noop */ }
    return false;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch { /* noop */ }
  return envDefault;
}
