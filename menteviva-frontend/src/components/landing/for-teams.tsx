import { DEMO_HREF } from "../../lib/links"

const ve = [
  "Qué habilidad está más baja en el equipo",
  "Quién practicó y cuándo",
  "Quién avanzó y quién se estancó",
]
const noVe = [
  "La transcripción de cada conversación",
  "Lo que alguien dijo mientras practicaba",
]

// Acto 6: la promesa a RH y el limite de privacidad, uno frente al otro.
export function ForTeams() {
  return (
    <section data-act={6} id="equipos" className="relative px-4 py-24 sm:px-6 lg:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-ink/70" />
      <div className="relative mx-auto max-w-6xl">
        <h2 className="lp-h2 max-w-3xl">
          Tú ves el avance del equipo. No sus conversaciones.
        </h2>
        <p className="lp-lead mt-5 max-w-xl">
          Corre en el navegador, con micrófono. No hay nada que instalar ni que desplegar.
        </p>

        <div className="mt-16 grid gap-px overflow-hidden rounded-md bg-white/10 md:grid-cols-2">
          <div className="bg-ink p-8 sm:p-10">
            <p className="lp-label text-teal">RH ve</p>
            <ul className="mt-6 space-y-4">
              {ve.map((t) => (
                <li key={t} className="lp-body text-cream">{t}</li>
              ))}
            </ul>
          </div>
          <div className="bg-ink p-8 sm:p-10">
            <p className="lp-label text-cream/50">RH no ve</p>
            <ul className="mt-6 space-y-4">
              {noVe.map((t) => (
                <li key={t} className="lp-body text-cream/60">{t}</li>
              ))}
            </ul>
            <p className="lp-note mt-8">
              El detalle individual no se comparte sin consentimiento expreso de la persona.
            </p>
          </div>
        </div>

        <a
          href={DEMO_HREF}
          className="mt-10 inline-block font-semibold text-cream underline decoration-cream/30 underline-offset-8 hover:decoration-cream"
        >
          Agendar demo para mi equipo
        </a>
      </div>
    </section>
  )
}
