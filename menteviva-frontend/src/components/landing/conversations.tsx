import { useRef, useState } from "react"
import { motion, useInView, useReducedMotion } from "framer-motion"

/**
 * Fragmentos textuales de sesiones reales guardadas en la base del piloto.
 * Solo se reproducen los turnos del avatar: lo que dijo la persona no se
 * publica. Es el activo mas dificil de copiar que tiene el producto, y es lo
 * unico de esta pagina que no podria escribir un competidor.
 */
const escenarios = [
  {
    id: "roberto",
    tab: "Ventas",
    nombre: "Roberto Garza",
    papel: "Director de operaciones. No quiere tu junta.",
    turnos: [
      "Buenos días. Roberto Garza. ¿De qué empresa es y cuál es el motivo de su visita?",
      "Tuvimos un proyecto de transformación digital el año pasado que no funcionó. No tenemos mucho tiempo para proyectos que no den resultados claros.",
      "No podemos parar producción para implementar nada.",
      "Mi directora de finanzas va a preguntar el ROI en los primeros seis meses. ¿Tienen alguna estimación?",
      "¿Dos meses? Suena ambicioso. Tuvimos un proyecto previo que no funcionó a pesar de las promesas. ¿Qué los diferencia?",
    ],
  },
  {
    id: "sofia",
    tab: "Diagnóstico",
    nombre: "Sofía",
    papel: "Entrevistadora por competencias. No te deja generalizar.",
    turnos: [
      "Cuéntame una vez en que tuviste que cuestionar algo que todos asumían como correcto.",
      "No pasa nada si no recuerdas un momento específico. Quizás te resulte más fácil contarme de un día raro con tu equipo.",
      "Pásame al momento exacto en que te informaron de ese cambio. ¿Qué fue lo primero que pensaste?",
      "¿Qué fue lo siguiente que hiciste, específicamente, después de ese primer pensamiento?",
    ],
  },
]

export function Conversations() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-100px" })
  const reduce = useReducedMotion()
  const [activo, setActivo] = useState(escenarios[0].id)
  const escenario = escenarios.find((e) => e.id === activo) ?? escenarios[0]

  const enter = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 24 },
          animate: isInView ? { opacity: 1, y: 0 } : {},
          transition: { duration: 0.6, delay },
        }

  return (
    <section ref={ref} className="relative px-4 py-24 sm:px-6 sm:py-40 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <motion.div {...enter(0)} className="max-w-3xl">
          <h2 className="font-syne text-3xl font-bold leading-[1.15] text-cream sm:text-4xl md:text-5xl">
            Esto es lo que vas a oír.
          </h2>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Fragmentos textuales de sesiones reales. Ninguna está escrita para esta página.
          </p>
        </motion.div>

        {/* Selector de escenario */}
        <motion.div {...enter(0.1)} className="mt-12 flex gap-2" role="tablist">
          {escenarios.map((e) => (
            <button
              key={e.id}
              role="tab"
              aria-selected={e.id === activo}
              onClick={() => setActivo(e.id)}
              className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
                e.id === activo
                  ? "bg-cream text-ink"
                  : "border border-white/15 text-muted hover:border-white/30 hover:text-cream"
              }`}
            >
              {e.tab}
            </button>
          ))}
        </motion.div>

        <motion.div {...enter(0.2)} className="mt-10">
          <p className="font-syne text-xl font-bold text-cream">{escenario.nombre}</p>
          <p className="mt-1 text-sm text-muted">{escenario.papel}</p>

          <ol className="mt-10 space-y-0">
            {escenario.turnos.map((turno, i) => (
              <motion.li
                key={turno}
                initial={reduce ? undefined : { opacity: 0 }}
                animate={reduce ? undefined : { opacity: 1 }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="max-w-2xl border-t border-white/10 py-8 first:border-t-0 first:pt-0"
              >
                <p className="font-syne max-w-xl text-xl leading-snug text-cream sm:text-2xl lg:max-w-2xl lg:text-[1.7rem]">
                  {turno}
                </p>
                {i < escenario.turnos.length - 1 && (
                  <p className="mt-5 text-sm text-muted">tú contestas, en voz alta</p>
                )}
              </motion.li>
            ))}
          </ol>
        </motion.div>
      </div>
    </section>
  )
}
