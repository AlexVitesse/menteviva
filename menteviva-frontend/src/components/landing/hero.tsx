import { motion } from "framer-motion"
import { useNavigate } from "react-router-dom"
import { ArrowRight, Sparkles } from "lucide-react"

export function Hero() {
  const navigate = useNavigate()
  return (
    <section className="relative min-h-screen flex items-center justify-center px-4 sm:px-6 lg:px-8 pt-20">
      <div className="max-w-5xl mx-auto text-center">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-violet-500/30 bg-violet-500/10 backdrop-blur-sm mb-8"
        >
          <Sparkles className="w-4 h-4 text-violet-400" />
          <span className="text-sm text-violet-300">Impulsado por IA conversacional</span>
        </motion.div>

        {/* Main Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="font-syne text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-cream leading-tight tracking-tight text-balance mb-6"
        >
          Practica las conversaciones{" "}
          <span className="bg-gradient-to-r from-violet-light to-teal bg-clip-text text-transparent">
            difíciles
          </span>
          , antes de tenerlas.
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="text-lg sm:text-xl text-muted max-w-2xl mx-auto mb-10 text-pretty"
        >
          Entrena tus habilidades blandas con avatares de IA que simulan situaciones reales. 
          Feedback instantáneo, sin juicio, a tu ritmo.
        </motion.p>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3 }}
          className="flex flex-col sm:flex-row gap-4 justify-center items-center"
        >
          <button
            onClick={() => navigate("/registro")}
            className="group relative w-full sm:w-auto overflow-hidden rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-8 py-4 font-semibold text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-xl hover:shadow-violet-500/30"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              Empezar gratis
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-violet-500 to-teal-500 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
          <button
            onClick={() => {
              document.getElementById("como-funciona")?.scrollIntoView({ behavior: "smooth" })
            }}
            className="w-full sm:w-auto rounded-xl border border-white/20 bg-white/5 px-8 py-4 font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/10 hover:border-white/30"
          >
            Ver cómo funciona
          </button>
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7, delay: 0.5 }}
          className="mt-16 grid grid-cols-3 gap-8 max-w-lg mx-auto"
        >
          {[
            { value: "10K+", label: "Prácticas" },
            { value: "95%", label: "Satisfacción" },
            { value: "24/7", label: "Disponible" },
          ].map((stat, i) => (
            <div key={i} className="text-center">
              <div className="font-syne text-2xl sm:text-3xl font-bold text-cream">{stat.value}</div>
              <div className="text-sm text-subtle">{stat.label}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
