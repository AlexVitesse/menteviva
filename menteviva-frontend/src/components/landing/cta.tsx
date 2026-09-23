import { DEMO_HREF } from "../../lib/links"

// Acto 8: sin caja ni halo; el cerebro encendido detras hace de fondo.
export function CTA() {
  return (
    <section
      data-act={8}
      className="relative flex min-h-[100svh] flex-col justify-end px-4 pb-24 sm:px-6 lg:px-8"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-ink/90 via-ink/55 to-transparent"
      />
      <div className="relative mx-auto max-w-3xl text-center">
        <h2 className="lp-display">
          Agenda una demo y prueba una sesión con Roberto.
        </h2>
        <a
          href={DEMO_HREF}
          className="mt-10 inline-block w-full rounded-md bg-cream px-8 py-4 font-semibold text-ink transition-opacity hover:opacity-90 sm:w-auto"
        >
          Agendar demo
        </a>
        <p className="lp-note mt-6">
          Dura de 5 a 10 minutos · El reporte llega al terminar
        </p>
      </div>
    </section>
  )
}
