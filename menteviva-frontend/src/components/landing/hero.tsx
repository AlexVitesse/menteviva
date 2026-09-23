import { useNavigate } from "react-router-dom"
import { DEMO_HREF } from "../../lib/links"

// Acto 1. El cerebro mide ~1.1 pantallas y queda recortado arriba; el titular
// va encima de su tercio inferior. El H2 dice que es y para quien; el 3D pone
// el tono.
export function Hero() {
  const navigate = useNavigate()

  return (
    <section
      data-act={1}
      id="inicio"
      className="relative flex min-h-[100svh] flex-col justify-end px-4 sm:px-6 lg:px-8"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[58%] bg-gradient-to-t from-ink/90 via-ink/55 to-transparent"
      />
      <div className="relative mx-auto max-w-4xl pb-20 pt-32 text-center">
        <h1 className="lp-display">
          Tu equipo practica la venta difícil antes de tener al cliente enfrente.
        </h1>

        <p className="lp-lead mx-auto mt-6 max-w-2xl">
          Mente Viva es un simulador de conversaciones. Cada persona habla en voz alta con un avatar
          que objeta como un cliente real. Al terminar recibe un reporte con puntaje por habilidad, y
          tú ves quién mejora.
        </p>

        <div className="mt-10 flex flex-col items-center gap-4">
          <a
            href={DEMO_HREF}
            className="w-full rounded-md bg-cream px-8 py-4 text-center font-semibold text-ink transition-opacity hover:opacity-90 sm:w-auto"
          >
            Agendar demo
          </a>
          <button
            onClick={() => navigate("/registro")}
            className="text-cream/60 underline-offset-4 hover:text-cream hover:underline"
          >
            o prueba una conversación gratis
          </button>
        </div>
      </div>
    </section>
  )
}
