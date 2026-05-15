import { motion } from "framer-motion"
import { useInView } from "framer-motion"
import { useRef } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight, Sparkles } from "lucide-react"

export function CTA() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-100px" })
  const navigate = useNavigate()

  return (
    <section className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8" ref={ref}>
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="relative"
        >
          {/* Glow Background */}
          <div className="absolute inset-0 bg-gradient-to-r from-violet/20 to-teal/20 rounded-3xl blur-3xl" />

          {/* Card */}
          <div className="relative rounded-3xl p-[1px] bg-gradient-to-r from-violet-light to-teal">
            <div className="rounded-3xl bg-deep p-8 sm:p-12 lg:p-16 text-center backdrop-blur-xl">
              {/* Icon */}
              <motion.div
                initial={{ scale: 0 }}
                animate={isInView ? { scale: 1 } : {}}
                transition={{ duration: 0.5, delay: 0.2, type: "spring" }}
                className="w-16 h-16 mx-auto mb-8 rounded-2xl bg-gradient-to-br from-violet-light to-teal flex items-center justify-center"
              >
                <Sparkles className="w-8 h-8 text-cream" />
              </motion.div>

              {/* Headline */}
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="font-syne text-3xl sm:text-4xl lg:text-5xl font-bold text-cream mb-4"
              >
                Empieza tu transformación hoy
              </motion.h2>

              {/* Subheadline */}
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: 0.4 }}
                className="text-lg text-muted max-w-xl mx-auto mb-8"
              >
                Tu diagnóstico gratuito te mostrará exactamente qué habilidades desarrollar 
                y cómo Mente Viva puede ayudarte a conseguirlo.
              </motion.p>

              {/* CTA Button */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: 0.5 }}
              >
                <button
                  onClick={() => navigate("/registro")}
                  className="group relative overflow-hidden rounded-xl bg-gradient-to-r from-violet to-teal px-8 py-4 font-semibold text-cream shadow-lg shadow-violet/25 transition-all hover:shadow-xl hover:shadow-violet/40 hover:scale-105"
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    Empezar mi diagnóstico gratis
                    <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
                  </span>
                </button>
              </motion.div>

              {/* Trust badges */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={isInView ? { opacity: 1 } : {}}
                transition={{ duration: 0.6, delay: 0.6 }}
                className="mt-6 text-sm text-subtle"
              >
                Sin tarjeta de crédito · Resultados en 5 minutos · 100% privado
              </motion.p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
