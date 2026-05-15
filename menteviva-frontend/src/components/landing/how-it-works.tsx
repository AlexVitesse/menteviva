import { motion } from "framer-motion"
import { useInView } from "framer-motion"
import { useRef } from "react"
import { ClipboardCheck, Map, Zap } from "lucide-react"

const steps = [
  {
    number: "01",
    title: "Diagnóstico",
    description: "Identifica tus áreas de oportunidad con una evaluación rápida basada en situaciones reales.",
    icon: ClipboardCheck,
    color: "violet"
  },
  {
    number: "02", 
    title: "Tu Mapa",
    description: "Recibe un plan personalizado con las habilidades que debes desarrollar y el orden óptimo.",
    icon: Map,
    color: "purple"
  },
  {
    number: "03",
    title: "Práctica",
    description: "Entrena con avatares de IA en simulaciones realistas. Obtén feedback inmediato y mejora.",
    icon: Zap,
    color: "teal"
  }
]

export function HowItWorks() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-100px" })

  return (
    <section className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8" ref={ref}>
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="text-sm font-medium text-violet-light uppercase tracking-wider">Proceso</span>
          <h2 className="font-syne text-3xl sm:text-4xl md:text-5xl font-bold text-cream mt-3">
            Cómo funciona
          </h2>
        </motion.div>

        {/* Steps */}
        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {steps.map((step, index) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 40 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: index * 0.15 }}
              className="group relative"
            >
              {/* Gradient Border Card */}
              <div className="relative rounded-2xl p-[1px] bg-gradient-to-b from-violet-500/50 via-transparent to-teal-500/50 hover:from-violet-500 hover:to-teal-500 transition-all duration-500">
                <div className="relative rounded-2xl bg-deep p-6 sm:p-8 h-full backdrop-blur-xl">
                  {/* Step Number */}
                  <div className="font-syne text-6xl font-bold text-cream/5 absolute top-4 right-4">
                    {step.number}
                  </div>
                  
                  {/* Icon */}
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ${
                    step.color === "violet" ? "bg-violet-500/20" :
                    step.color === "purple" ? "bg-purple-500/20" :
                    "bg-teal-500/20"
                  }`}>
                    <step.icon className={`w-6 h-6 ${
                      step.color === "violet" ? "text-violet-400" :
                      step.color === "purple" ? "text-purple-400" :
                      "text-teal-400"
                    }`} />
                  </div>

                  {/* Content */}
                  <h3 className="font-syne text-xl sm:text-2xl font-bold text-cream mb-3">
                    {step.title}
                  </h3>
                  <p className="text-muted leading-relaxed">
                    {step.description}
                  </p>

                  {/* Connector Line (hidden on mobile and last item) */}
                  {index < steps.length - 1 && (
                    <div className="hidden md:block absolute top-1/2 -right-4 lg:-right-5 w-8 lg:w-10 h-[2px] bg-gradient-to-r from-violet-500/50 to-transparent" />
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
