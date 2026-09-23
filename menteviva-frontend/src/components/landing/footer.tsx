import { Link } from "react-router-dom"
import { CONTACTO } from "../../pages/Legal"

export function Footer() {
  return (
    <footer className="relative border-t border-white/10 px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          {/* Logo */}
          <span className="font-syne text-sm font-bold text-cream">Mente Viva</span>

          {/* Links */}
          <nav className="flex items-center gap-6">
            <Link to="/privacidad" className="text-sm text-muted transition-colors hover:text-cream">
              Privacidad
            </Link>
            <Link to="/terminos" className="text-sm text-muted transition-colors hover:text-cream">
              Términos
            </Link>
            <a
              href={`mailto:${CONTACTO}`}
              className="text-sm text-muted transition-colors hover:text-cream"
            >
              Contacto
            </a>
          </nav>

          {/* Copyright */}
          <p className="text-sm text-muted">© 2026 Mente Viva. Todos los derechos reservados.</p>
        </div>

        <p className="mt-8 max-w-2xl text-sm text-muted">
          Las sesiones se transcriben para generar tu reporte. Puedes solicitar la eliminación de tus
          transcripciones en cualquier momento; el detalle está en el{" "}
          <Link to="/privacidad" className="text-violet-light hover:underline">
            aviso de privacidad
          </Link>
          .
        </p>
      </div>
    </footer>
  )
}
