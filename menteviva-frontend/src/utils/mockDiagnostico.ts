import type { Diagnostico, UserProfile } from "../types";

/**
 * Diagnostico demo hardcodeado para fallback cuando el backend falla o la
 * sesion se cierra sin completar analisis. Contiene informacion plausible
 * pero generica — marcado con is_demo=true para que el UI muestre el banner
 * de "esto es un ejemplo, rehaz la entrevista para obtener tu diagnostico real".
 */
export function buildMockDiagnostico(userProfile?: UserProfile | null): Diagnostico {
  const nombre = userProfile?.registro?.nombre?.split(" ")[0] ?? "tu";
  const rol = userProfile?.registro?.rol_objetivo ?? "tu rol";
  return {
    completed_at: new Date().toISOString(),
    competencias_foco: ["comunicacion", "resolucion_de_problemas", "adaptabilidad"],
    strengths: [
      {
        skill: "Comunicacion estructurada",
        evidence:
          "Explicas contexto antes de entrar en detalle y segmentas ideas complejas en piezas simples.",
        why_matters:
          `En ${rol}, esto reduce malentendidos y acelera el alineamiento con stakeholders tecnicos y no tecnicos.`,
      },
      {
        skill: "Iniciativa y ownership",
        evidence:
          "Cuando detectas un bloqueo, propones una via de accion antes de escalarlo.",
        why_matters:
          "Demuestra autonomia y te posiciona como alguien en quien se puede delegar sin microgestion.",
      },
    ],
    gaps: [
      {
        skill: "Profundizacion antes de proponer solucion",
        evidence:
          "En dos momentos pasaste rapido a la solucion sin validar si entendiste bien el problema.",
        impact:
          "Puede generar reprocesos y que el equipo sienta que no los escuchas completamente antes de decidir.",
        micro_practice:
          "Antes de proponer: haz al menos 2 preguntas abiertas (que, como) y parafrasea el problema en tus propias palabras.",
      },
      {
        skill: "Gestion de la ambiguedad",
        evidence:
          "Cuando la definicion de requerimientos no estaba clara, tendiste a ejecutar sobre supuestos sin documentarlos.",
        impact:
          "Si los supuestos no quedan por escrito, cualquier desalineacion se descubre tarde y es costosa.",
        micro_practice:
          "Antes de empezar una tarea ambigua: escribe 3 supuestos clave y compartelos con el owner para validar.",
      },
    ],
    blind_spot:
      `${nombre}, tiendes a asumir que los demas tienen el mismo contexto tecnico que tu. Eso te hace saltar pasos al explicar, y quienes escuchan se pierden sin avisarte.`,
    reflection_question:
      "Piensa en la ultima vez que tuviste que explicar algo complejo. Si tu interlocutor no entendio, fue porque el mensaje era dificil o porque no ajustaste el nivel a su contexto?",
    verbal_patterns: {
      vague_verbs_detected: ["manejar", "hacer", "ver"],
      we_vs_i_tendency: "media",
      filler_frequency: "media",
    },
    recommended_next_scenario: "maria",
    recommended_next_level: "intermedio",
    is_demo: true,
  };
}
