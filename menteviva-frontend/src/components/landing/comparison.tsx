const diferenciadores = [
  {
    titulo: "Se practica, no se ve",
    detalle:
      "Un curso se consume y se olvida. Aquí la persona sostiene la conversación completa, con las objeciones y los silencios incómodos incluidos.",
  },
  {
    titulo: "Deja evidencia, no asistencia",
    detalle:
      "Cada sesión entrega transcripción y puntaje por habilidad. La lista de asistentes de un taller no dice quién mejoró.",
  },
  {
    titulo: "Escala sin agenda",
    detalle:
      "Veinte personas pueden practicar el mismo martes a horas distintas. Un coach o un taller no se multiplica.",
  },
]

// Acto 7: el cerebro queda al fondo, atenuado; el texto ocupa todo el ancho.
export function Comparison() {
  return (
    <section data-act={7} id="comparativa" className="relative px-4 py-24 sm:px-6 lg:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-ink/70" />
      <div className="relative mx-auto max-w-6xl">
        <h2 className="lp-h2 max-w-3xl">
          Qué hace que esto funcione y un taller no
        </h2>

        <div className="mt-16 grid gap-12 md:grid-cols-3 md:gap-10">
          {diferenciadores.map((d) => (
            <article key={d.titulo} className="border-t-2 border-cream pt-6">
              <h3 className="lp-h3">{d.titulo}</h3>
              <p className="lp-body mt-4">{d.detalle}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
