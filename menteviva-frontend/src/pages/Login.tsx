import { lazy, Suspense, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Brain, LogIn, Sparkles, UserPlus } from "lucide-react";

import { useSessionStore } from "../stores/sessionStore";

// La escena 3D pesa ~1MB. Lazy para que el primer paint del login no espere.
const Scene3D = lazy(() =>
  import("../components/login/Scene3D").then((mod) => ({ default: mod.Scene3D }))
);

export function Login() {
  const navigate = useNavigate();
  const userProfile = useSessionStore((s) => s.userProfile);
  const [error, setError] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState<"login" | "register" | null>(null);

  function handleLogin() {
    if (!userProfile) {
      setError(
        "No encontramos sesion guardada en este navegador. Crea una cuenta nueva para empezar."
      );
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
    <main className="relative min-h-screen overflow-hidden bg-[#0a0a0f]">
      <Suspense fallback={<div className="fixed inset-0 z-0 bg-[#0a0a12]" />}>
        <Scene3D />
      </Suspense>

      <div className="relative z-10 flex min-h-screen items-center justify-center p-4 sm:p-6 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md">
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="w-full"
          >
            {/* Logo y titulo */}
            <motion.div
              className="mb-6 sm:mb-10 text-center"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.6 }}
            >
              <motion.div
                className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-teal-500/20 backdrop-blur-sm border border-white/10"
                whileHover={{ scale: 1.05, rotate: 5 }}
                transition={{ type: "spring", stiffness: 400 }}
              >
                <Brain className="h-10 w-10 text-violet-400" />
              </motion.div>

              <motion.h1
                className="mb-3 text-4xl sm:text-5xl font-bold tracking-tight font-syne"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
              >
                <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-teal-400 bg-clip-text text-transparent">
                  Mente Viva
                </span>
              </motion.h1>

              <motion.p
                className="flex items-center justify-center gap-2 text-white/60"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
              >
                <Sparkles className="h-4 w-4 text-violet-400" />
                Practica habilidades blandas con avatares de IA
                <Sparkles className="h-4 w-4 text-teal-400" />
              </motion.p>
            </motion.div>

            {/* Card glassmorphism */}
            <motion.div
              className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-8 shadow-2xl backdrop-blur-xl"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.6 }}
            >
              {/* Borde con gradiente animado */}
              <div className="pointer-events-none absolute inset-0 rounded-3xl">
                <div className="absolute inset-[-1px] rounded-3xl bg-gradient-to-r from-violet-500/50 via-transparent to-teal-500/50 opacity-50" />
              </div>

              {/* Glow superior */}
              <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-violet-500/30 blur-3xl" />

              <div className="relative space-y-5">
                {/* Boton crear cuenta */}
                <motion.button
                  onClick={handleRegister}
                  onHoverStart={() => setIsHovered("register")}
                  onHoverEnd={() => setIsHovered(null)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="group relative w-full overflow-hidden rounded-xl sm:rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 px-4 py-3.5 sm:py-4 text-sm sm:text-base font-semibold text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-xl hover:shadow-violet-500/30"
                >
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-violet-500 to-fuchsia-500"
                    initial={{ x: "-100%" }}
                    animate={{ x: isHovered === "register" ? "0%" : "-100%" }}
                    transition={{ duration: 0.3 }}
                  />
                  <span className="relative flex items-center justify-center gap-3">
                    <UserPlus className="h-5 w-5" />
                    Crear cuenta nueva
                  </span>
                </motion.button>

                {/* Divider */}
                <div className="flex items-center gap-4">
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                  <span className="text-sm text-white/40">o</span>
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                </div>

                {/* Boton iniciar sesion */}
                <motion.button
                  onClick={handleLogin}
                  onHoverStart={() => setIsHovered("login")}
                  onHoverEnd={() => setIsHovered(null)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="group relative w-full overflow-hidden rounded-xl sm:rounded-2xl border border-violet-500/50 bg-violet-500/10 px-4 py-3.5 sm:py-4 text-sm sm:text-base font-semibold text-violet-300 backdrop-blur-sm transition-all hover:border-violet-400/70 hover:bg-violet-500/20 hover:text-violet-200"
                >
                  <motion.div
                    className="absolute inset-0 bg-violet-500/10"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{
                      scale: isHovered === "login" ? 1 : 0,
                      opacity: isHovered === "login" ? 1 : 0,
                    }}
                    transition={{ duration: 0.3 }}
                    style={{ borderRadius: "1rem" }}
                  />
                  <span className="relative flex items-center justify-center gap-3">
                    <LogIn className="h-5 w-5" />
                    Iniciar sesion
                  </span>
                </motion.button>

                {/* Sesion guardada */}
                <AnimatePresence>
                  {greeting && !error && (
                    <motion.p
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="pt-2 text-center text-sm text-white/50"
                    >
                      Hay una sesion guardada como{" "}
                      <span className="text-violet-400">{greeting}</span>.
                    </motion.p>
                  )}
                </AnimatePresence>

                {/* Error */}
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 backdrop-blur-sm"
                    >
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                      <p className="text-sm text-white/80">{error}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>

            {/* Footer */}
            <motion.p
              className="mt-8 text-center text-sm text-white/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
            >
              Demo alpha · Tu perfil se guarda solo en este navegador
            </motion.p>
          </motion.div>
        </div>
      </div>
    </main>
  );
}
