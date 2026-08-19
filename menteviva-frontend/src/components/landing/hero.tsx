import { lazy, Suspense } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { useNavigate } from "react-router-dom"
import { ArrowRight } from "lucide-react"
import { CONTACTO } from "../../pages/Legal"

// La escena 3D pesa (three + drei + un glb de 2.5 MB): se carga aparte para
// no bloquear el primer paint del texto, que es lo que convierte.
const BrainScene = lazy(() =>
  import("./brain-scene").then((mod) => ({ default: mod.BrainScene })),
)

const stats = [
  { value: "10K+", label: "Prácticas" },
  { value: "95%", label: "Satisfacción" },
  { value: "24/7", label: "Disponible" },
]

export function Hero() {
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const enter = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 24 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.6, delay },
        }

  return (
    <section className="relative min-h-[100dvh] px-4 pt-28 pb-16 sm:px-6 lg:px-8 lg:pt-32">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.4fr_1fr] lg:gap-10">
        {/* Columna de mensaje */}
        <div className="text-center lg:text-left">
          <motion.h1
            {...enter(0)}
            className="font-syne text-4xl font-bold leading-[1.1] tracking-tight text-cream sm:text-5xl lg:text-[2.6rem] xl:text-[2.9rem]"
          >
            Practica las conversaciones{" "}
            <span className="from-violet-light bg-gradient-to-r to-teal bg-clip-text text-transparent">
              difíciles
            </span>
            , antes de tenerlas.
          </motion.h1>

          <motion.p
            {...enter(0.1)}
            className="text-pretty mx-auto mt-6 max-w-xl text-lg text-muted lg:mx-0"
          >
            Entrena a tu equipo con avatares de IA que simulan situaciones reales. Feedback
            instantáneo y evidencia medible de cada sesión.
          </motion.p>

          <motion.div
            {...enter(0.2)}
            className="mt-10 flex flex-col items-center gap-4 sm:flex-row lg:justify-start"
          >
            <a
              href={`mailto:${CONTACTO}?subject=Demo%20de%20Mente%20Viva`}
              className="group from-violet-600 to-violet-500 shadow-violet-500/25 hover:shadow-violet-500/30 relative w-full overflow-hidden rounded-xl bg-gradient-to-r px-8 py-4 font-semibold text-white shadow-lg transition-all hover:shadow-xl sm:w-auto"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                Agendar demo
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </a>
            <button
              onClick={() => navigate("/registro")}
              className="w-full rounded-xl border border-white/20 bg-white/5 px-8 py-4 font-semibold text-white backdrop-blur-sm transition-all hover:border-white/30 hover:bg-white/10 sm:w-auto"
            >
              Probar gratis
            </button>
          </motion.div>

          <motion.dl
            {...enter(0.35)}
            className="mx-auto mt-14 grid max-w-lg grid-cols-3 gap-8 lg:mx-0"
          >
            {stats.map((stat) => (
              <div key={stat.label} className="text-center lg:text-left">
                <dt className="sr-only">{stat.label}</dt>
                <dd className="font-syne text-2xl font-bold text-cream sm:text-3xl">
                  {stat.value}
                </dd>
                <p className="text-sm text-muted">{stat.label}</p>
              </div>
            ))}
          </motion.dl>
        </div>

        {/* Columna del cerebro 3D */}
        <div
          className="relative mx-auto aspect-square w-full max-w-[34rem] lg:max-w-none"
          aria-hidden="true"
        >
          <Suspense fallback={null}>
            <BrainScene />
          </Suspense>
        </div>
      </div>
    </section>
  )
}
