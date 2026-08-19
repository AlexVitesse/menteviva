import { useRef } from "react"
import { motion, useInView, useReducedMotion } from "framer-motion"
import { ClipboardCheck, Map, Zap } from "lucide-react"

const steps = [
  {
    title: "Diagnóstico",
    description:
      "Una conversación corta detecta las áreas de oportunidad de cada persona a partir de situaciones reales de su puesto.",
    icon: ClipboardCheck,
  },
  {
    title: "Tu mapa",
    description:
      "Cada quien recibe un plan con las habilidades que debe desarrollar y el orden en que conviene trabajarlas.",
    icon: Map,
  },
  {
    title: "Práctica",
    description:
      "Sesiones de voz con avatares que sostienen el papel. Al terminar, reporte con transcripción y puntaje por habilidad.",
    icon: Zap,
  },
]

/**
 * Stepper vertical. Antes eran tres tarjetas iguales, la misma composicion que
 * usa la seccion de caracteristicas; se separan para que la pagina no repita
 * dos veces seguidas la misma familia de layout.
 */
export function HowItWorks() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-100px" })
  const reduce = useReducedMotion()

  return (
    <section ref={ref} className="relative px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <motion.h2
          initial={reduce ? undefined : { opacity: 0, y: 30 }}
          animate={reduce ? undefined : isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="font-syne max-w-xl text-3xl font-bold text-cream sm:text-4xl md:text-5xl"
        >
          Cómo funciona
        </motion.h2>

        <ol className="relative mt-14 space-y-12">
          {/* Riel que conecta los pasos */}
          <div
            className="from-violet-500/60 absolute left-6 top-3 bottom-3 hidden w-px bg-gradient-to-b via-teal/40 to-transparent sm:block"
            aria-hidden="true"
          />

          {steps.map((step, index) => (
            <motion.li
              key={step.title}
              initial={reduce ? undefined : { opacity: 0, y: 32 }}
              animate={reduce ? undefined : isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: index * 0.15 }}
              className="relative flex flex-col gap-5 sm:flex-row sm:gap-8"
            >
              <div className="bg-violet-500/20 relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ring-8 ring-ink">
                <step.icon className="text-violet-400 h-6 w-6" />
              </div>

              <div className="sm:pt-1">
                <h3 className="font-syne text-xl font-bold text-cream sm:text-2xl">{step.title}</h3>
                <p className="mt-3 max-w-xl leading-relaxed text-muted">{step.description}</p>
              </div>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  )
}
