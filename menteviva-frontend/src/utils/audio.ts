/**
 * Convierte un Blob a Base64
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Convierte Base64 a Blob
 */
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);

  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }

  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

/**
 * Crea una URL de objeto a partir de Base64
 */
export function createObjectURLFromBase64(base64: string, mimeType: string): string {
  const blob = base64ToBlob(base64, mimeType);
  return URL.createObjectURL(blob);
}

/**
 * Verifica si el navegador soporta grabacion de audio
 */
export function isAudioRecordingSupported(): boolean {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * Detecta si el origen actual es "seguro" desde la perspectiva de la Web API.
 * getUserMedia (y la mayoria de APIs sensibles) solo funcionan en secure context:
 * HTTPS, localhost, 127.0.0.1, o file://. Chrome para Android bloquea getUserMedia
 * en IPs de LAN sobre HTTP — incluso aunque desktop Chrome las permita.
 * Ref: https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts
 */
export function isSecureOriginForMic(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  // Fallback por si isSecureContext no esta disponible
  const { protocol, hostname } = window.location;
  if (protocol === "https:" || protocol === "file:") return true;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  return false;
}

/**
 * Obtiene los formatos de audio soportados por el navegador
 */
export function getSupportedAudioFormats(): string[] {
  const formats = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];

  return formats.filter((format) => MediaRecorder.isTypeSupported(format));
}

/**
 * Obtiene el mejor formato de audio soportado
 */
export function getBestAudioFormat(): string {
  const formats = getSupportedAudioFormats();
  return formats[0] || "audio/webm";
}

/**
 * Formatea la duracion en segundos a MM:SS
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}
