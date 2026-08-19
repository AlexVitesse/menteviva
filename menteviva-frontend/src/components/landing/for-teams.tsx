import { useRef } from "react"
import { motion, useInView, useReducedMotion } from "framer-motion"
import { BarChart3, Briefcase, ShieldCheck, MonitorSmartphone, ArrowRight } from "lucide-react"
import { CONTACTO } from "../../pages/Legal"

const soportes = [
  {
    icon: Briefcase,
    title: "Escenarios por rol",
    description:
      "Ventas consultivas, renegociación de contrato o entrevista por competencias. Cada puesto entrena lo que de verdad hace.",
  },
  {
    icon: MonitorSmartphone,
    title: "Sin instalar nada",
    description:
      "Corre en el navegador. La persona entra con su cuenta, conecta el micrófono y practica. No hay despliegue de TI.",
  },
  {
    icon: ShieldCheck,
    title: "Privacidad por diseño",
    description:
      "La organización ve el agregado. El detalle de una conversación individual no se comparte sin consentimiento expreso.",
  },
]

export function ForTeams() {
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
            Para equipos, no solo para personas
          </h2>
          <p className="mt-4 text-lg text-muted">
            El entrenamiento de habilidades blandas se compra por equipo y se justifica con
            evidencia. Mente Viva entrega las dos cosas.
          </p>
        </motion.div>

        {/* Bento de 4 celdas: una destacada + tres de apoyo. */}
        <div className="mt-14 grid gap-5 lg:grid-cols-5 lg:gap-6">
          {/* Celda destacada */}
          <motion.div
            {...enter(0.1)}
            className="from-violet-600/20 relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br via-deep to-teal/10 p-8 lg:col-span-2 lg:p-10"
          >
            <div className="bg-violet-500/20 mb-6 flex h-12 w-12 items-center justify-center rounded-xl">
              <BarChart3 className="text-violet-400 h-6 w-6" />
            </div>
            <h3 className="font-syne text-2xl font-bold text-cream">Reporte agregado</h3>
            <p className="mt-3 text-muted">
              Dónde falla el equipo, no solo una persona: qué habilidad está más baja, quién avanzó
              y quién se estancó. Con la transcripción detrás de cada número.
            </p>

            <dl className="mt-8 space-y-5 border-t border-white/10 pt-6">
              <div>
                <dt className="text-sm text-muted">Escala del semáforo</dt>
                <dd className="font-syne mt-1 font-bold text-cream">
                  Verde 75+ · Ámbar 50 a 75 · Rojo bajo 50
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Metodología</dt>
                <dd className="font-syne mt-1 font-bold text-cream">BEI + STAR</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Duración de una práctica</dt>
                <dd className="font-syne mt-1 font-bold text-cream">5 a 10 min</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Reporte disponible</dt>
                <dd className="font-syne mt-1 font-bold text-cream">Al terminar la sesión</dd>
              </div>
            </dl>
          </motion.div>

          {/* Tres celdas de apoyo */}
          <div className="grid gap-5 lg:col-span-3 lg:gap-6">
            {soportes.map((item, i) => (
              <motion.div
                key={item.title}
                {...enter(0.15 + i * 0.08)}
                className="flex gap-5 rounded-2xl border border-white/10 bg-white/5 p-6 transition-colors hover:border-white/20 hover:bg-white/10 sm:p-8"
              >
                <div className="bg-teal/15 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                  <item.icon className="h-5 w-5 text-teal" />
                </div>
                <div>
                  <h3 className="font-syne text-lg font-bold text-cream">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{item.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div {...enter(0.45)} className="mt-10">
          <a
            href={`mailto:${CONTACTO}?subject=Demo%20de%20Mente%20Viva%20para%20equipos`}
            className="group text-violet-light inline-flex items-center gap-2 font-semibold transition-colors hover:text-cream"
          >
            Agendar demo
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </a>
        </motion.div>
      </div>
    </section>
  )
}
