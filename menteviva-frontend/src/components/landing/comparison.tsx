import { useRef } from "react"
import { motion, useInView, useReducedMotion } from "framer-motion"
import { Check, X, Minus } from "lucide-react"

type Estado = boolean | "limited"

type ComparisonRow = {
  feature: string
  menteViva: Estado
  taller: Estado
  elearning: Estado
}

/**
 * Las columnas son las alternativas que evalua de verdad un area de formacion:
 * un taller presencial o una plataforma de e-learning corporativa.
 */
const comparisons: ComparisonRow[] = [
  { feature: "Práctica ilimitada", menteViva: true, taller: false, elearning: "limited" },
  { feature: "Feedback instantáneo", menteViva: true, taller: "limited", elearning: false },
  { feature: "Evidencia por persona", menteViva: true, taller: false, elearning: "limited" },
  { feature: "Disponible 24/7", menteViva: true, taller: false, elearning: true },
  { feature: "Escenarios por rol", menteViva: true, taller: "limited", elearning: false },
  { feature: "Sin logística ni agenda", menteViva: true, taller: false, elearning: true },
  { feature: "Seguimiento de progreso", menteViva: true, taller: false, elearning: "limited" },
  { feature: "Sin juicio ni vergüenza", menteViva: true, taller: false, elearning: true },
]

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

function StatusIcon({ status, label }: { status: Estado; label: string }) {
  if (status === true) {
    return (
      <div
        className="bg-teal/20 mx-auto flex h-6 w-6 items-center justify-center rounded-full"
        title={`${label}: incluido`}
      >
        <Check className="h-4 w-4 text-teal" aria-hidden="true" />
        <span className="sr-only">{label}: incluido</span>
      </div>
    )
  }
  if (status === "limited") {
    return (
      <div
        className="bg-warning/20 mx-auto flex h-6 w-6 items-center justify-center rounded-full"
        title={`${label}: limitado`}
      >
        <Minus className="h-4 w-4 text-warning" aria-hidden="true" />
        <span className="sr-only">{label}: limitado</span>
      </div>
    )
  }
  return (
    <div
      className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-white/10"
      title={`${label}: no incluido`}
    >
      <X className="h-4 w-4 text-muted" aria-hidden="true" />
      <span className="sr-only">{label}: no incluido</span>
    </div>
  )
}

export function Comparison() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-100px" })
  const reduce = useReducedMotion()
  const enter = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 30 },
          animate: isInView ? { opacity: 1, y: 0 } : {},
          transition: { duration: 0.6, delay },
        }

  return (
    <section ref={ref} className="relative px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <motion.div {...enter(0)} className="max-w-2xl">
          <h2 className="font-syne text-3xl font-bold text-cream sm:text-4xl md:text-5xl">
            Por qué Mente Viva
          </h2>
          <p className="mt-4 text-lg text-muted">
            Frente a un taller presencial o una plataforma de e-learning, tres diferencias que
            importan al momento de aprobar el presupuesto.
          </p>
        </motion.div>

        {/* Los tres diferenciadores que deciden la compra */}
        <div className="mt-14 divide-y divide-white/10 border-y border-white/10">
          {diferenciadores.map((d, i) => (
            <motion.article
              key={d.titulo}
              {...enter(0.1 + i * 0.1)}
              className="grid gap-3 py-8 md:grid-cols-[1fr_1.4fr] md:gap-10"
            >
              <h3 className="font-syne text-xl font-bold text-cream sm:text-2xl">{d.titulo}</h3>
              <p className="leading-relaxed text-muted">{d.detalle}</p>
            </motion.article>
          ))}
        </div>

        {/* El detalle completo queda replegado: no compite con lo de arriba */}
        <motion.div {...enter(0.45)} className="mt-10">
          <details className="group rounded-2xl border border-white/10 bg-white/5">
            <summary className="cursor-pointer list-none px-6 py-4 font-semibold text-cream transition-colors hover:bg-white/5">
              Ver comparativa completa
              <span className="ml-2 text-sm font-normal text-muted group-open:hidden">
                (8 criterios)
              </span>
            </summary>

            <div className="overflow-x-auto border-t border-white/10 px-2 pb-4">
              <table className="w-full min-w-[34rem] text-left">
                <thead>
                  <tr className="text-sm text-muted">
                    <th scope="col" className="px-4 py-4 font-medium">
                      Criterio
                    </th>
                    <th scope="col" className="px-4 py-4 text-center font-bold text-cream">
                      Mente Viva
                    </th>
                    <th scope="col" className="px-4 py-4 text-center font-medium">
                      Taller presencial
                    </th>
                    <th scope="col" className="px-4 py-4 text-center font-medium">
                      E-learning
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {comparisons.map((row) => (
                    <tr key={row.feature} className="transition-colors hover:bg-white/5">
                      <th scope="row" className="px-4 py-4 text-sm font-normal text-cream/80">
                        {row.feature}
                      </th>
                      <td className="px-4 py-4">
                        <StatusIcon status={row.menteViva} label={`Mente Viva, ${row.feature}`} />
                      </td>
                      <td className="px-4 py-4">
                        <StatusIcon status={row.taller} label={`Taller presencial, ${row.feature}`} />
                      </td>
                      <td className="px-4 py-4">
                        <StatusIcon status={row.elearning} label={`E-learning, ${row.feature}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </motion.div>
      </div>
    </section>
  )
}
