import { motion } from "framer-motion"
import { useInView } from "framer-motion"
import { useRef } from "react"
import { Check, X, Minus } from "lucide-react"

type ComparisonRow = {
  feature: string
  menteViva: boolean | "limited"
  courses: boolean | "limited"
  coaches: boolean | "limited"
}

const comparisons: ComparisonRow[] = [
  {
    feature: "Práctica ilimitada",
    menteViva: true,
    courses: false,
    coaches: "limited"
  },
  {
    feature: "Feedback instantáneo",
    menteViva: true,
    courses: false,
    coaches: false
  },
  {
    feature: "Disponible 24/7",
    menteViva: true,
    courses: true,
    coaches: false
  },
  {
    feature: "Personalización",
    menteViva: true,
    courses: false,
    coaches: true
  },
  {
    feature: "Costo accesible",
    menteViva: true,
    courses: true,
    coaches: false
  },
  {
    feature: "Simulaciones realistas",
    menteViva: true,
    courses: false,
    coaches: true
  },
  {
    feature: "Seguimiento de progreso",
    menteViva: true,
    courses: "limited",
    coaches: "limited"
  },
  {
    feature: "Sin juicio ni vergüenza",
    menteViva: true,
    courses: true,
    coaches: false
  }
]

function StatusIcon({ status }: { status: boolean | "limited" }) {
  if (status === true) {
    return (
      <div className="w-6 h-6 rounded-full bg-teal-500/20 flex items-center justify-center">
        <Check className="w-4 h-4 text-teal-400" />
      </div>
    )
  }
  if (status === "limited") {
    return (
      <div className="w-6 h-6 rounded-full bg-yellow-500/20 flex items-center justify-center">
        <Minus className="w-4 h-4 text-yellow-400" />
      </div>
    )
  }
  return (
    <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
      <X className="w-4 h-4 text-white/40" />
    </div>
  )
}

export function Comparison() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-100px" })

  return (
    <section className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8" ref={ref}>
      <div className="max-w-4xl mx-auto">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="text-sm font-medium text-violet-400 uppercase tracking-wider">Comparativa</span>
          <h2 className="font-[family-name:var(--font-heading)] text-3xl sm:text-4xl md:text-5xl font-bold text-white mt-3">
            Por qué Mente Viva
          </h2>
          <p className="mt-4 text-lg text-white/60 max-w-2xl mx-auto">
            Combinamos lo mejor de los cursos online y el coaching personal.
          </p>
        </motion.div>

        {/* Comparison Table */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="relative rounded-2xl p-[1px] bg-gradient-to-b from-violet-500/50 via-transparent to-teal-500/50"
        >
          <div className="rounded-2xl bg-[#0d0c1d] overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-4 gap-4 p-4 sm:p-6 border-b border-white/10 bg-white/5">
              <div className="text-sm font-medium text-white/60">Característica</div>
              <div className="text-center">
                <span className="inline-block px-3 py-1 rounded-full bg-gradient-to-r from-violet-500 to-teal-500 text-sm font-bold text-white">
                  Mente Viva
                </span>
              </div>
              <div className="text-center text-sm font-medium text-white/60">Cursos Online</div>
              <div className="text-center text-sm font-medium text-white/60">Coaches</div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-white/5">
              {comparisons.map((row, index) => (
                <motion.div
                  key={row.feature}
                  initial={{ opacity: 0, x: -20 }}
                  animate={isInView ? { opacity: 1, x: 0 } : {}}
                  transition={{ duration: 0.4, delay: 0.3 + index * 0.05 }}
                  className="grid grid-cols-4 gap-4 p-4 sm:p-6 hover:bg-white/5 transition-colors"
                >
                  <div className="text-sm text-white/80">{row.feature}</div>
                  <div className="flex justify-center">
                    <StatusIcon status={row.menteViva} />
                  </div>
                  <div className="flex justify-center">
                    <StatusIcon status={row.courses} />
                  </div>
                  <div className="flex justify-center">
                    <StatusIcon status={row.coaches} />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Legend */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="flex justify-center gap-6 mt-6 text-sm text-white/50"
        >
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-teal-500/20 flex items-center justify-center">
              <Check className="w-3 h-3 text-teal-400" />
            </div>
            <span>Incluido</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-yellow-500/20 flex items-center justify-center">
              <Minus className="w-3 h-3 text-yellow-400" />
            </div>
            <span>Limitado</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center">
              <X className="w-3 h-3 text-white/40" />
            </div>
            <span>No incluido</span>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
