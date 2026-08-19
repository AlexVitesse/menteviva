import { useRef } from "react"
import { motion, useInView, useReducedMotion } from "framer-motion"
import { useNavigate } from "react-router-dom"
import { ArrowRight } from "lucide-react"
import { CONTACTO } from "../../pages/Legal"

export function CTA() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-100px" })
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const enter = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 24 },
          animate: isInView ? { opacity: 1, y: 0 } : {},
          transition: { duration: 0.6, delay },
        }

  return (
    <section ref={ref} className="relative px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <motion.div {...enter(0)} className="relative">
          {/* Halo de fondo */}
          <div
            className="absolute inset-0 rounded-3xl bg-gradient-to-r from-violet/20 to-teal/20 blur-3xl"
            aria-hidden="true"
          />

          <div className="from-violet-light relative rounded-3xl bg-gradient-to-r to-teal p-[1px]">
            <div className="rounded-3xl bg-deep p-8 text-center backdrop-blur-xl sm:p-12 lg:p-16">
              <motion.h2
                {...enter(0.1)}
                className="font-syne text-3xl font-bold text-cream sm:text-4xl lg:text-5xl"
              >
                Ve el reporte antes de decidir
              </motion.h2>

              <motion.p
                {...enter(0.2)}
                className="mx-auto mt-4 max-w-xl text-lg text-muted"
              >
                En una demo de 20 minutos practicas una simulación real y te llevas el reporte que
                recibiría tu equipo.
              </motion.p>

              <motion.div
                {...enter(0.3)}
                className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
              >
                <a
                  href={`mailto:${CONTACTO}?subject=Demo%20de%20Mente%20Viva`}
                  className="group shadow-violet/25 hover:shadow-violet/40 relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-violet to-teal px-8 py-4 font-semibold text-cream shadow-lg transition-all hover:shadow-xl sm:w-auto"
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    Agendar demo
                    <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </span>
                </a>
                <button
                  onClick={() => navigate("/registro")}
                  className="w-full rounded-xl border border-white/20 bg-white/5 px-8 py-4 font-semibold text-cream transition-all hover:border-white/30 hover:bg-white/10 sm:w-auto"
                >
                  Probar gratis
                </button>
              </motion.div>

              <motion.p {...enter(0.4)} className="mt-6 text-sm text-muted">
                Sin tarjeta de crédito · Resultados en 5 minutos · 100% privado
              </motion.p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
