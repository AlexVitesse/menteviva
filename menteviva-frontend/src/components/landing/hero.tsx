import { motion, useReducedMotion } from "framer-motion"
import { useNavigate } from "react-router-dom"
import { ArrowRight } from "lucide-react"
import { CONTACTO } from "../../pages/Legal"

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
          transition: { duration: 0.7, delay },
        }

  return (
    <section className="relative flex min-h-[100dvh] items-center px-4 pt-28 pb-16 sm:px-6 lg:px-8">
      {/* El cerebro vive detras de toda la pagina y arranca desplazado a la
          derecha; el mensaje ocupa la mitad izquierda para no taparlo. */}
      <div className="mx-auto w-full max-w-6xl">
        <div className="max-w-2xl">
          <motion.h1
            {...enter(0)}
            className="font-syne text-[2.6rem] font-bold leading-[1.05] tracking-tight text-cream sm:text-6xl lg:text-7xl"
          >
            La conversación
            <br />
            que estás{" "}
            <span className="from-violet-light bg-gradient-to-r to-teal bg-clip-text text-transparent">
              evitando
            </span>
            .
          </motion.h1>

          <motion.p {...enter(0.12)} className="mt-8 max-w-lg text-lg text-muted sm:text-xl">
            Tenla aquí primero, en voz alta, con alguien que no te la va a poner fácil. Después
            tenla donde importa.
          </motion.p>

          <motion.div
            {...enter(0.24)}
            className="mt-10 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center"
          >
            <a
              href={`mailto:${CONTACTO}?subject=Demo%20de%20Mente%20Viva`}
              className="group from-violet-600 to-violet-500 shadow-violet-500/25 hover:shadow-violet-500/30 rounded-xl bg-gradient-to-r px-8 py-4 text-center font-semibold text-white shadow-lg transition-all hover:shadow-xl"
            >
              <span className="flex items-center justify-center gap-2">
                Agendar demo
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </a>
            <button
              onClick={() => navigate("/registro")}
              className="rounded-xl border border-white/20 px-8 py-4 font-semibold text-cream backdrop-blur-sm transition-all hover:border-white/40 hover:bg-white/5"
            >
              Probar gratis
            </button>
          </motion.div>

          <motion.dl {...enter(0.4)} className="mt-16 flex flex-wrap gap-x-12 gap-y-6">
            {stats.map((stat) => (
              <div key={stat.label}>
                <dt className="sr-only">{stat.label}</dt>
                <dd className="font-syne text-2xl font-bold text-cream sm:text-3xl">
                  {stat.value}
                </dd>
                <p className="text-sm text-muted">{stat.label}</p>
              </div>
            ))}
          </motion.dl>
        </div>
      </div>
    </section>
  )
}
