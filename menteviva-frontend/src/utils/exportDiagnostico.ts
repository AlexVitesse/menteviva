import type { UserProfile } from "../types";

/**
 * Genera un markdown legible del diagnostico para descarga.
 */
export function diagnosticoToMarkdown(profile: UserProfile): string {
  const d = profile.diagnostico;
  if (!d) return "# Diagnóstico\n\nSin diagnóstico todavía.";
  const r = profile.registro;
  const fecha = new Date(d.completed_at).toLocaleDateString("es-MX", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const lines: string[] = [];
  lines.push(`# Diagnóstico de Habilidades Blandas — ${r.nombre}`);
  lines.push("");
  lines.push(`**Fecha:** ${fecha}`);
  lines.push(`**Rol objetivo:** ${r.rol_objetivo}`);
  lines.push(`**Industria:** ${r.industria}`);
  lines.push(`**Nivel:** ${r.experience_level}`);
  lines.push("");
  if (d.is_demo) {
    lines.push("> ⚠️ Diagnóstico preliminar (sesión corta). Para resultados más precisos, completa una entrevista más larga.");
    lines.push("");
  }
  lines.push("## Competencias foco");
  d.competencias_foco.forEach((c) => lines.push(`- ${c.replace(/_/g, " ")}`));
  lines.push("");
  if (d.strengths.length) {
    lines.push("## Fortalezas");
    d.strengths.forEach((s) => {
      lines.push(`### ${s.skill.replace(/_/g, " ")}`);
      lines.push(`> *"${s.evidence}"*`);
      lines.push(`${s.why_matters}`);
      lines.push("");
    });
  }
  if (d.gaps.length) {
    lines.push("## Áreas de oportunidad");
    d.gaps.forEach((g) => {
      lines.push(`### ${g.skill.replace(/_/g, " ")}`);
      lines.push(`> *"${g.evidence}"*`);
      lines.push(`**Impacto:** ${g.impact}`);
      lines.push(`**Micro-práctica:** ${g.micro_practice}`);
      lines.push("");
    });
  }
  if (d.blind_spot) {
    lines.push("## Punto ciego");
    lines.push(d.blind_spot);
    lines.push("");
  }
  if (d.reflection_question) {
    lines.push("## Pregunta para llevarte");
    lines.push(`*${d.reflection_question}*`);
    lines.push("");
  }
  lines.push("## Tu siguiente reto");
  lines.push(`**${d.recommended_next_scenario}** — nivel ${d.recommended_next_level}`);
  lines.push("");
  lines.push("---");
  lines.push("Generado por Mente Viva · Entrenamiento de habilidades blandas con IA");
  return lines.join("\n");
}

/**
 * Texto corto para compartir en redes. Sin info sensible.
 */
export function diagnosticoToShareText(profile: UserProfile): string {
  const d = profile.diagnostico;
  if (!d) return "Mi diagnóstico de habilidades blandas en Mente Viva.";
  const topStrengths = d.strengths.slice(0, 2).map((s) => s.skill.replace(/_/g, " "));
  const topGap = d.gaps[0]?.skill.replace(/_/g, " ");
  const parts: string[] = [];
  parts.push(`Mi diagnóstico de soft skills en Mente Viva 🧠`);
  if (topStrengths.length) parts.push(`✅ Fortalezas: ${topStrengths.join(", ")}`);
  if (topGap) parts.push(`🎯 Foco: ${topGap}`);
  parts.push(`Próximo reto: practicar con ${d.recommended_next_scenario} (${d.recommended_next_level})`);
  return parts.join("\n");
}

export function downloadMarkdown(profile: UserProfile): void {
  const md = diagnosticoToMarkdown(profile);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const nombreSafe = profile.registro.nombre.replace(/\s+/g, "_");
  const fecha = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `diagnostico_${nombreSafe}_${fecha}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Intenta Web Share API. Si no esta disponible (desktop, navegadores viejos)
 * hace fallback a copiar al clipboard. Devuelve 'shared' | 'copied' | 'failed'.
 */
export async function shareDiagnostico(
  profile: UserProfile,
  siteUrl: string
): Promise<"shared" | "copied" | "failed"> {
  const text = diagnosticoToShareText(profile) + `\n\nProbá el tuyo: ${siteUrl}`;
  if (navigator.share) {
    try {
      await navigator.share({
        title: "Mi diagnóstico de habilidades blandas",
        text,
      });
      return "shared";
    } catch (err) {
      if ((err as Error).name === "AbortError") return "failed";
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
