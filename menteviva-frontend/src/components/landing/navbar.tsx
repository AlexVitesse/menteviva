import { useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { useNavigate } from "react-router-dom"
import { Menu, X, Brain } from "lucide-react"
import { CONTACTO } from "../../pages/Legal"

const DEMO_HREF = `mailto:${CONTACTO}?subject=Demo%20de%20Mente%20Viva`

const navLinks = [
  { label: "Cómo funciona", href: "#como-funciona" },
  { label: "Para equipos", href: "#para-equipos" },
  { label: "Características", href: "#caracteristicas" },
  { label: "Comparativa", href: "#comparativa" },
]

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false)
  const navigate = useNavigate()
  const reduce = useReducedMotion()

  return (
    <motion.nav
      initial={reduce ? undefined : { opacity: 0, y: -20 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="fixed top-0 left-0 right-0 z-50"
    >
      <div className="mx-4 sm:mx-6 lg:mx-8 mt-4">
        <div className="max-w-6xl mx-auto rounded-2xl border border-white/10 bg-ink/80 backdrop-blur-xl px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <button onClick={() => navigate("/")} className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500/20 to-teal-500/20 backdrop-blur-sm border border-white/10 flex items-center justify-center">
                <Brain className="w-5 h-5 text-violet-400" />
              </div>
              <span className="font-syne text-cream font-bold text-lg tracking-tight">
                <span className="bg-gradient-to-r from-violet-light to-teal bg-clip-text text-transparent">
                  Mente Viva
                </span>
              </span>
            </button>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center gap-6">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-sm text-muted hover:text-cream transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </div>

            {/* Desktop CTA */}
            <div className="hidden lg:flex items-center gap-4">
              <button onClick={() => navigate("/login")} className="text-sm text-muted hover:text-cream transition-colors">
                Iniciar sesión
              </button>
              <a href={DEMO_HREF} className="rounded-lg bg-gradient-to-r from-violet-600 to-violet-500 px-4 py-2 text-sm font-medium text-white transition-all hover:opacity-90">
                Agendar demo
              </a>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="lg:hidden p-2 text-muted hover:text-cream transition-colors"
            >
              {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>

          {/* Mobile Menu */}
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="lg:hidden mt-4 pt-4 border-t border-white/10"
            >
              <div className="flex flex-col gap-4">
                {navLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsOpen(false)}
                    className="text-sm text-muted hover:text-cream transition-colors"
                  >
                    {link.label}
                  </a>
                ))}
                <div className="flex flex-col gap-3 pt-4 border-t border-white/10">
                  <a href="/login" className="text-sm text-muted hover:text-cream transition-colors">
                    Iniciar sesión
                  </a>
                  <a href={DEMO_HREF} onClick={() => setIsOpen(false)} className="w-full rounded-lg bg-gradient-to-r from-violet-600 to-violet-500 px-4 py-2.5 text-center text-sm font-medium text-white">
                    Agendar demo
                  </a>
                  <button onClick={() => { setIsOpen(false); navigate("/registro") }} className="w-full rounded-lg border border-white/20 px-4 py-2.5 text-sm font-medium text-cream">
                    Probar gratis
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </motion.nav>
  )
}
