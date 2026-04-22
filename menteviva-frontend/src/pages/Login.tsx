import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { LogIn, UserPlus, AlertCircle } from "lucide-react";

import { useSessionStore } from "../stores/sessionStore";

export function Login() {
  const navigate = useNavigate();
  const userProfile = useSessionStore((s) => s.userProfile);
  const [error, setError] = useState<string | null>(null);

  function handleLogin() {
    if (!userProfile) {
      setError("No encontramos sesion guardada en este navegador. Crea una cuenta nueva para empezar.");
      return;
    }
    if (!userProfile.diagnostico) {
      navigate("/diagnostico/setup", { replace: true });
      return;
    }
    navigate("/", { replace: true });
  }

  function handleRegister() {
    navigate("/registro");
  }

  const greeting = userProfile?.registro?.nombre?.split(" ")[0];

  return (
    <div className="min-h-screen bg-ink text-cream flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-10">
          <h1 className="font-syne text-4xl font-bold bg-gradient-to-r from-violet-light to-teal bg-clip-text text-transparent mb-2">
            Mente Viva
          </h1>
          <p className="text-muted">
            Practica habilidades blandas con avatares de IA.
          </p>
        </div>

        <div className="bg-card rounded-2xl border border-white/5 p-8 shadow-2xl space-y-4">
          <button
            onClick={handleRegister}
            className="w-full flex items-center justify-center gap-3 font-syne font-bold text-sm py-4 rounded-[10px] bg-violet text-white hover:bg-violet-light transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Crear cuenta nueva
          </button>

          <div className="flex items-center gap-3 text-xs text-muted">
            <div className="flex-1 h-px bg-white/10" />
            <span>o</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 font-syne font-bold text-sm py-4 rounded-[10px] border border-violet text-violet hover:bg-violet/10 transition-colors"
          >
            <LogIn className="w-4 h-4" />
            Iniciar sesion
          </button>

          {greeting && !error && (
            <p className="text-xs text-center text-muted pt-2">
              Hay una sesion guardada como <span className="text-violet-lighter">{greeting}</span>.
            </p>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-lg p-3 mt-2">
              <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-cream">{error}</p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted mt-6">
          Demo alpha. Tu perfil se guarda solo en este navegador.
        </p>
      </motion.div>
    </div>
  );
}
