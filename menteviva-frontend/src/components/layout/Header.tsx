import { Link } from "react-router-dom";

interface Props {
  showNav?: boolean;
  subtitle?: string;
}

export function Header({ showNav = false, subtitle }: Props) {
  return (
    <header className="border-b border-white/5 px-8 py-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/">
            <h1 className="font-syne text-2xl font-bold bg-gradient-to-r from-violet-light to-teal bg-clip-text text-transparent">
              Mente Viva
            </h1>
          </Link>
          {subtitle && (
            <>
              <span className="text-muted">|</span>
              <span className="text-muted">{subtitle}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-4">
          {showNav && (
            <nav className="flex items-center gap-6">
              <Link
                to="/"
                className="text-muted hover:text-cream transition-colors"
              >
                Dashboard
              </Link>
            </nav>
          )}

          {/* Demo Badge */}
          <div className="px-3 py-1 rounded-full bg-gradient-to-r from-violet/20 to-teal/20 border border-violet/30">
            <span className="text-xs font-semibold text-violet-light tracking-wider">
              DEMO
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
