import { motion } from "framer-motion"
import { useInView } from "framer-motion"
import { useRef } from "react"
import { Mic, MousePointerClick, FileText, Target, Clock, Compass } from "lucide-react"

const features = [
  {
    icon: Mic,
    title: "Voz natural",
    description: "Conversaciones por voz que se sienten reales. Sin texto, sin fricción, como en la vida real.",
    gradient: "from-violet-500 to-purple-500"
  },
  {
    icon: MousePointerClick,
    title: "Sin clicks",
    description: "Olvídate de interfaces complicadas. Solo habla y practica. La IA hace el resto.",
    gradient: "from-purple-500 to-pink-500"
  },
  {
    icon: FileText,
    title: "Evidencia textual",
    description: "Cada práctica genera un reporte detallado con transcripción y análisis de tu desempeño.",
    gradient: "from-pink-500 to-rose-500"
  },
  {
    icon: Target,
    title: "BEI + STAR",
    description: "Metodologías probadas de entrevista conductual integradas en cada simulación.",
    gradient: "from-teal-500 to-cyan-500"
  },
  {
    icon: Clock,
    title: "Micro-prácticas",
    description: "Sesiones de 5-10 minutos que se adaptan a tu agenda. Practica en cualquier momento.",
    gradient: "from-cyan-500 to-blue-500"
  },
  {
    icon: Compass,
    title: "Roadmap",
    description: "Un camino claro de desarrollo con metas medibles y seguimiento de tu progreso.",
    gradient: "from-blue-500 to-violet-500"
  }
]

export function Features() {
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
          <span className="text-sm font-medium text-teal uppercase tracking-wider">Características</span>
          <h2 className="font-syne text-3xl sm:text-4xl md:text-5xl font-bold text-cream mt-3">
            Todo lo que necesitas para mejorar
          </h2>
          <p className="mt-4 text-lg text-muted max-w-2xl mx-auto">
            Herramientas diseñadas para maximizar tu aprendizaje y darte resultados reales.
          </p>
        </motion.div>

        {/* Features Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 40 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="group"
            >
              <div className="relative h-full rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm transition-all duration-300 hover:bg-white/10 hover:border-white/20">
                {/* Glow Effect */}
                <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${feature.gradient} opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-10`} />
                
                {/* Icon */}
                <div className={`relative w-12 h-12 rounded-xl bg-gradient-to-br ${feature.gradient} p-[1px] mb-5`}>
                  <div className="w-full h-full rounded-xl bg-deep flex items-center justify-center">
                    <feature.icon className="w-5 h-5 text-cream" />
                  </div>
                </div>

                {/* Content */}
                <h3 className="relative font-syne text-lg font-bold text-cream mb-2">
                  {feature.title}
                </h3>
                <p className="relative text-muted text-sm leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
