/**
 * Export de una sesión del laboratorio a Markdown. Extraido de ChatLab.tsx sin
 * cambios de logica; `savedRegistro` y `avatars` ahora entran como parametros
 * (antes eran closures del componente) para que lo reusen ChatLab y VoiceLab.
 */
import { DEFAULT_DURATION, type AvatarInfo, type ChatSession, type RegistroInput } from "./types";
import { fmtDuration, fmtUsd, sessionCostUsd } from "./helpers";

export function exportSession(
  session: ChatSession,
  avatars: AvatarInfo[],
  savedRegistro: RegistroInput,
): void {
  const sessionAvatar = avatars.find((a) => a.id === session.avatarId);
  const avatarName = sessionAvatar?.name || session.avatarId;
  const isDiagSession = sessionAvatar?.kind === "diagnostico";
  const reg = { ...savedRegistro, ...(session.registro || {}) };

  let content = `# Reporte de Laboratorio: ${session.name}\n`;
  content += `Fecha: ${new Date(session.createdAt).toLocaleDateString()}\n`;
  content += `Avatar simulado: ${avatarName}\n`;
  content += `Motor / Proveedor: ${session.provider === "gemini" ? "Gemini" : (session.provider === "chatgpt" ? "ChatGPT (OpenAI)" : "Groq")}\n`;
  if (session.modelName) {
    content += `Modelo específico: ${session.modelName}\n`;
  }
  content += `Nivel: ${session.level}\n`;
  if (isDiagSession) {
    content += `Candidato: ${reg.nombre || "N/A"}\n`;
    content += `Rol objetivo: ${reg.rol_objetivo || "N/A"}\n`;
    content += `Industria: ${reg.industria || "N/A"}\n`;
    const nivelLabels: Record<string, string> = {
      entry: "Entry",
      junior: "Junior",
      mid: "Semi-Senior",
      senior: "Senior",
      lead: "Lead",
      executive: "Ejecutivo",
    };
    content += `Nivel de experiencia: ${
      reg.experience_level ? nivelLabels[reg.experience_level] ?? reg.experience_level : "N/A"
    }\n`;
    content += `Duración simulada: ${session.durationMin ?? DEFAULT_DURATION} min\n`;
  }
  content += `Caracteres Prompt: ${session.promptChars || "N/A"}\n`;
  const totalCost = sessionCostUsd(session);
  if (totalCost > 0) {
    content += `Costo estimado de la sesión: ~${fmtUsd(totalCost)} USD (on-demand, sin cache)\n`;
  }
  // Tiempo real que llevó la sesión (cronómetro), si arrancó.
  if (session.startedAt) {
    const durMs = (session.completedAt ?? Date.now()) - session.startedAt;
    const estado = session.completedAt ? "" : " (en curso)";
    content += `Tiempo de realización: ${fmtDuration(durMs)} (mm:ss)${estado}\n`;
  }
  // Fiabilidad: errores del proveedor durante la sesión.
  const sessErrs = session.errorLog ?? [];
  content += `Errores durante la sesión: ${sessErrs.length}`;
  if (sessErrs.length) {
    const server5xx = sessErrs.filter((e) => (e.status ?? 0) >= 500).length;
    content += ` (${server5xx} de servidor/502)`;
  }
  content += `\n`;
  content += `\n`;
  if (sessErrs.length) {
    content += `## Registro de Errores\n\n`;
    sessErrs.forEach((e) => {
      const hora = new Date(e.at).toLocaleTimeString();
      content += `- [${hora}] ${e.status ? `HTTP ${e.status}` : "sin código"}: ${e.message}\n`;
    });
    content += `\n`;
  }
  content += `## Historial de Turnos de Prueba\n\n`;

  if (session.messages.length === 0) {
    content += `*No hay mensajes registrados en esta sesión.*\n`;
  } else {
    session.messages.forEach((m) => {
      const roleLabel = m.role === "user" ? "Usuario" : avatarName;
      const latency = m.latencyMs !== undefined ? ` _(${(m.latencyMs / 1000).toFixed(1)}s)_` : "";
      const fb = m.feedback === "like" ? " 👍" : m.feedback === "dislike" ? " 👎" : "";
      content += `**[${roleLabel.toUpperCase()}]**${latency}${fb}:\n${m.content}\n`;
      if (m.feedbackComment) {
        content += `> 💬 _Comentario del usuario (por qué no gustó):_ ${m.feedbackComment}\n`;
      }
      content += `\n---\n\n`;
    });
  }

  if (session.satisfaction) {
    const sat = session.satisfaction;
    content += `\n## Satisfacción del Diagnóstico\n\n`;
    content += `Valoración: ${"★".repeat(sat.rating)}${"☆".repeat(5 - sat.rating)} (${sat.rating}/5)\n`;
    if (sat.comment) {
      content += `Comentario: ${sat.comment}\n`;
    }
    content += `\n`;
  }

  if (session.diagnostico) {
    const diag = session.diagnostico;
    content += `\n## Diagnóstico\n\n`;
    if (diag.resumen_ejecutivo) {
      content += `### Resumen Ejecutivo\n${diag.resumen_ejecutivo}\n\n`;
    }
    if (diag.competencias_foco && diag.competencias_foco.length > 0) {
      content += `### Competencias Foco\n${diag.competencias_foco.map((c) => `- ${c}`).join("\n")}\n\n`;
    }
    if (diag.strengths && diag.strengths.length > 0) {
      content += `### Fortalezas\n`;
      diag.strengths.forEach((s) => {
        content += `- **${s.skill}**:\n`;
        content += `  - *Evidencia*: ${s.evidence}\n`;
        content += `  - *Por qué importa*: ${s.why_matters}\n`;
      });
      content += `\n`;
    }
    if (diag.gaps && diag.gaps.length > 0) {
      content += `### Gaps / Áreas de Oportunidad\n`;
      diag.gaps.forEach((g) => {
        content += `- **${g.skill}**:\n`;
        content += `  - *Evidencia*: ${g.evidence}\n`;
        content += `  - *Impacto*: ${g.impact}\n`;
        content += `  - *Micro-práctica recomendada*: ${g.micro_practice}\n`;
      });
      content += `\n`;
    }
    if (diag.blind_spot) {
      content += `### Punto Ciego\n${diag.blind_spot}\n\n`;
    }
    if (diag.reflection_question) {
      content += `### Pregunta de Reflexión\n${diag.reflection_question}\n\n`;
    }
    if (diag.coach_note) {
      content += `### Nota del Coach\n${diag.coach_note}\n\n`;
    }
    if (diag.verbal_patterns) {
      const vp = diag.verbal_patterns;
      content += `### Patrones Verbales\n`;
      if (vp.vague_verbs_detected && vp.vague_verbs_detected.length > 0) {
        content += `- **Verbos vagos detectados**: ${vp.vague_verbs_detected.join(", ")}\n`;
      }
      if (vp.we_vs_i_tendency) {
        content += `- **Tendencia "Nosotros" vs "Yo"**: ${vp.we_vs_i_tendency}\n`;
      }
      if (vp.filler_frequency) {
        content += `- **Frecuencia de muletillas**: ${vp.filler_frequency}\n`;
      }
      content += `\n`;
    }
    if (diag.recommended_next_scenario) {
      content += `### Siguiente Práctica Recomendada\n`;
      content += `- **Escenario**: ${diag.recommended_next_scenario}\n`;
      if (diag.recommended_next_level) {
        content += `- **Nivel**: ${diag.recommended_next_level}\n`;
      }
      content += `\n`;
    }
  }

  const blob = new Blob([content], { type: "text/markdown;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `${session.name.replace(/\s+/g, "_")}_historial.md`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
