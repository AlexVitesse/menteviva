export function Footer() {
  return (
    <footer className="relative py-12 px-4 sm:px-6 lg:px-8 border-t border-white/10">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-light to-teal flex items-center justify-center">
              <span className="font-syne text-cream font-bold text-xs">M</span>
            </div>
            <span className="font-syne text-muted font-medium text-sm">
              Mente Viva
            </span>
          </div>

          {/* Links */}
          <div className="flex items-center gap-6">
            <a href="#" className="text-sm text-subtle hover:text-muted transition-colors">
              Privacidad
            </a>
            <a href="#" className="text-sm text-subtle hover:text-muted transition-colors">
              Términos
            </a>
            <a href="#" className="text-sm text-subtle hover:text-muted transition-colors">
              Contacto
            </a>
          </div>

          {/* Copyright */}
          <p className="text-sm text-subtle">
            © 2026 Mente Viva. Todos los derechos reservados.
          </p>
        </div>
      </div>
    </footer>
  )
}
