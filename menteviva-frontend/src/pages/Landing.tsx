import { lazy, Suspense } from "react";
import { Navbar } from "../components/landing/navbar";
import { Hero } from "../components/landing/hero";
import { Problem } from "../components/landing/problem";
import { ActSection } from "../components/landing/act-section";
import { ReportAct } from "../components/landing/report-act";
import { ForTeams } from "../components/landing/for-teams";
import { Comparison } from "../components/landing/comparison";
import { CTA } from "../components/landing/cta";
import { Footer } from "../components/landing/footer";
import { useActObserver } from "../components/landing/use-act";

// three + drei + el glb no bloquean el primer paint del texto.
const BrainScene = lazy(() =>
  import("../components/landing/brain-scene").then((mod) => ({ default: mod.BrainScene }))
);

// Turnos reales de Roberto en el piloto. El audio y las cues llegan en la fase 4
// (audio-act.tsx); mientras, se leen como transcripcion.
const objecion = [
  "Tuvimos un proyecto de transformación digital el año pasado que no funcionó.",
  "No podemos parar producción para implementar nada.",
  "Mi directora de finanzas va a preguntar el ROI en los primeros seis meses. ¿Tienen alguna estimación?",
];

// Borrador para que Sophia lo corrija; en pantalla va etiquetado como ejemplo.
const respuesta = [
  "Si el proyecto anterior no funcionó, primero quiero entender por qué: ¿fue la herramienta o cómo se implementó?",
  "No le voy a pedir que pare producción. Empezamos con una sola línea, en paralelo, y medimos antes y después.",
  "El ROI lo armamos con sus números, no con los míos. ¿Cuánto le cuesta una hora de paro?",
];

/**
 * Formato de guion: quien habla a la izquierda, la linea grande a la derecha.
 * Cada linea aparece una a una (.lp-r) y hace latir la zona del acto.
 */
function Transcript({ speaker, lines, tone }: { speaker: string; lines: string[]; tone: string }) {
  return (
    <div className="mt-10 space-y-6">
      {lines.map((l, i) => (
        <div key={l} className="lp-r grid grid-cols-[5.5rem_1fr] gap-4" style={{ "--i": i } as React.CSSProperties}>
          <span className={`lp-label pt-2 ${tone}`}>{speaker}</span>
          <p className="lp-quote">{l}</p>
        </div>
      ))}
    </div>
  );
}

export function Landing() {
  useActObserver();

  return (
    <main className="relative min-h-[100dvh] overflow-x-hidden bg-ink">
      <Suspense fallback={null}>
        <BrainScene />
      </Suspense>
      {/* Atmosfera sobre el canvas y debajo del contenido: derrame de luz, viñeta, grano. */}
      <div aria-hidden="true" className="lp-bleed" />
      <div aria-hidden="true" className="lp-vignette" />
      <div aria-hidden="true" className="lp-grain" />

      <div className="relative z-10">
        <Navbar />
        <Hero />
        <Problem />

        <ActSection act={3} id="presion" side="right" kick="amygdala">
          <h2 className="lp-h2">Esto es lo que va a enfrentar tu equipo.</h2>
          <p className="lp-lead mt-4">
            Roberto es un avatar: director de operaciones de una planta. Sus objeciones salen de
            sesiones reales del piloto.
          </p>
          <Transcript speaker="Roberto" lines={objecion} tone="text-danger" />
        </ActSection>

        <ActSection act={4} side="right" kick="pfc">
          <h2 className="lp-h2">Y esto es lo que Mente Viva evalúa: cómo responde bajo presión.</h2>
          <Transcript speaker="Tú" lines={respuesta} tone="text-teal" />
          <p className="lp-note mt-8">
            Respuesta de ejemplo. La de tu equipo será la suya.
          </p>
        </ActSection>

        <ReportAct />
        <ForTeams />
        <Comparison />
        <CTA />
        <Footer />
      </div>
    </main>
  );
}
