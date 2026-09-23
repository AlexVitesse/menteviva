import { ActSection } from "./act-section"

// Rubrica real de Roberto (analysis.py, KPIS_BY_SCENARIO["roberto"]), las 4 de
// mas peso. Los puntajes llegan en la fase 5 desde public/landing/report.json
// (sesion real con consentimiento); mientras, no se inventa ningun numero.
// El punto de cada fila se enciende con el color de su zona en el cerebro
// (colores de marca; con puntajes reales, el semaforo).
const skills = [
  { name: "Diagnóstico técnico", color: "#A855F7" },
  { name: "Habla el idioma del cliente", color: "#22D3EE" },
  { name: "Control bajo presión técnica", color: "#F87171" },
  { name: "ROI calculado y defendible", color: "#22D3EE" },
]

const semaforo = [
  { label: "75 o más", color: "bg-success" },
  { label: "50 a 75", color: "bg-warning" },
  { label: "menos de 50", color: "bg-danger" },
]

// Acto 5: el reporte como hoja de resultados, no como tarjetas.
export function ReportAct() {
  return (
    <ActSection act={5} id="reporte" side="left">
      <h2 className="lp-h2">
        Cada sesión termina en un reporte con puntaje por habilidad.
      </h2>
      <p className="lp-lead mt-4">
        No es una opinión: cada puntaje cita la frase exacta de la conversación que lo justifica.
      </p>

      <div className="mt-10 border-y border-white/15">
        <div className="flex items-baseline justify-between border-b border-white/15 py-4">
          <span className="lp-label text-cream/50">Roberto · Venta consultiva</span>
          <span className="font-syne text-2xl font-bold text-cream/40">—</span>
        </div>
        {skills.map((s, i) => (
          <div key={s.name} className="flex items-center gap-4 border-b border-white/[0.06] py-4 last:border-b-0">
            <span
              className="lp-dot h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ "--c": s.color, "--i": i } as React.CSSProperties}
            />
            <span className="lp-body flex-1 text-cream">{s.name}</span>
            <span className="font-syne text-2xl font-bold text-cream/40">—</span>
          </div>
        ))}
      </div>

      <div className="lp-note mt-6 flex flex-wrap gap-x-6 gap-y-2">
        {semaforo.map((s) => (
          <span key={s.label} className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${s.color}`} />
            {s.label}
          </span>
        ))}
      </div>
      <p className="lp-note mt-3">
        Puntajes de una sesión real del piloto: pendientes de aprobación para publicarse.
      </p>
    </ActSection>
  )
}
