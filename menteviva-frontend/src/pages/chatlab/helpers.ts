/**
 * Helpers puros compartidos entre ChatLab (texto) y VoiceLab (voz).
 * Extraidos de ChatLab.tsx sin cambios de logica.
 */
import type { ChatMsg, ChatSession } from "./types";

// Identificador estable y ALEATORIO por navegador. Se usa para namespacing del
// session_id que se persiste en BD: sin esto, todos los navegadores arrancan con
// el mismo id hardcodeado y, como es PRIMARY KEY de chatlab_conversations, un
// usuario pisaba (upsert) la conversacion de otro. Prefijar con CLIENT_ID aisla
// las filas por navegador. Vive en localStorage.
export const CLIENT_ID: string = (() => {
  try {
    let id = localStorage.getItem("chatlab_client_id");
    if (!id) {
      id = `client-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      localStorage.setItem("chatlab_client_id", id);
    }
    return id;
  } catch {
    return "client-anon";
  }
})();

// Meta de intercambios (turnos del usuario) para completar el diagnostico segun
// la duracion elegida. ~1 intercambio cada 3 min, minimo 4.
export function targetExchanges(min: number): number {
  return Math.max(4, Math.round(min / 3));
}

// Costo acumulado (USD) de los turnos de una sesión. 0 si no hay datos de costo.
export function sessionCostUsd(s: ChatSession): number {
  return s.messages.reduce((acc, m) => acc + (m.costUsd || 0), 0);
}

// Formatea un costo en USD con precisión para fracciones de centavo.
export function fmtUsd(c: number): string {
  return `$${c.toFixed(c < 0.01 ? 4 : 3)}`;
}

// Formatea una duración en milisegundos como mm:ss (cronómetro de la sesión).
export function fmtDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function userTurns(msgs: ChatMsg[]): number {
  return msgs.filter((m) => m.role === "user").length;
}

// Colorea un valor cualitativo (alta/media/baja) de los patrones verbales del
// diagnostico como chip semaforo. El LLM emite texto libre, asi que
// clasificamos por palabra clave (ES/EN); lo desconocido cae a neutro.
export function freqBadge(value?: string): { label: string; cls: string } {
  const v = (value || "").toLowerCase();
  if (/alta|high|frecuente|mucho|elevad/.test(v))
    return { label: value || "—", cls: "bg-danger/15 text-danger border-danger/30" };
  if (/media|moderad|algo|medio/.test(v))
    return { label: value || "—", cls: "bg-warning/15 text-warning border-warning/30" };
  if (/baja|low|poca|nula|ningun|ausente|escas/.test(v))
    return { label: value || "—", cls: "bg-success/15 text-success border-success/30" };
  return { label: value || "—", cls: "bg-white/5 text-muted border-white/10" };
}
