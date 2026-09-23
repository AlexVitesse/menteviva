import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Menu, X } from "lucide-react"
import { DEMO_HREF } from "../../lib/links"

const navLinks = [
  { label: "La presión", href: "#presion" },
  { label: "El reporte", href: "#reporte" },
  { label: "Para equipos", href: "#equipos" },
  { label: "Comparativa", href: "#comparativa" },
]

// Barra plana a todo lo ancho: sin pildora de vidrio ni logo en gradiente.
export function Navbar() {
  const [isOpen, setIsOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <nav className="fixed inset-x-0 top-0 z-50 bg-gradient-to-b from-ink via-ink/80 to-transparent">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <button onClick={() => navigate("/")} className="font-syne text-lg font-bold tracking-tight text-cream">
          Mente Viva
        </button>

        <div className="hidden items-center gap-8 lg:flex">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} className="text-sm text-cream/60 transition-colors hover:text-cream">
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-6 lg:flex">
          <button onClick={() => navigate("/login")} className="text-sm text-cream/60 transition-colors hover:text-cream">
            Iniciar sesión
          </button>
          <a href={DEMO_HREF} className="rounded-md bg-cream px-4 py-2 text-sm font-semibold text-ink transition-opacity hover:opacity-90">
            Agendar demo
          </a>
        </div>

        <button
          onClick={() => setIsOpen(!isOpen)}
          aria-label={isOpen ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={isOpen}
          className="p-2 text-cream/60 transition-colors hover:text-cream lg:hidden"
        >
          {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {isOpen && (
        <div className="border-t border-white/[0.06] px-4 pb-6 pt-4 sm:px-6 lg:hidden">
          <div className="flex flex-col gap-4">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setIsOpen(false)} className="text-cream/70 hover:text-cream">
                {link.label}
              </a>
            ))}
            <a href="/login" className="text-cream/70 hover:text-cream">
              Iniciar sesión
            </a>
            <a href={DEMO_HREF} onClick={() => setIsOpen(false)} className="mt-2 rounded-md bg-cream px-4 py-3 text-center font-semibold text-ink">
              Agendar demo
            </a>
          </div>
        </div>
      )}
    </nav>
  )
}
