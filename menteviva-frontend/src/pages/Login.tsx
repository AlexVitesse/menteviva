import { FormEvent, lazy, Suspense, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertCircle, Brain, Eye, EyeOff, LogIn, Sparkles, UserPlus } from "lucide-react";
import { signInWithEmailAndPassword } from "firebase/auth";

import { firebaseAuth, isFirebaseConfigured } from "../lib/firebase";

// La escena 3D pesa ~1MB. Lazy para que el primer paint no espere.
const Scene3D = lazy(() =>
  import("../components/login/Scene3D").then((mod) => ({ default: mod.Scene3D }))
);

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = isFirebaseConfigured();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!configured || !firebaseAuth) {
      setError(
        "Firebase no está configurado en este build. Avisa al equipo técnico."
      );
      return;
    }
    if (!email.trim() || !password) {
      setError("Email y contraseña son requeridos.");
      return;
    }

    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      // El listener en useFirebaseAuth se encarga de:
      // - traer el UserProfile via /api/auth/sync
      // - meterlo en el store
      // El guard de la app redirige a / o /diagnostico/setup según corresponda.
      navigate("/", { replace: true });
    } catch (err) {
      setError(translateFirebaseError(err));
    } finally {
      setSubmitting(false);
    }
  }

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

              <h1 className="mb-3 text-4xl sm:text-5xl font-bold tracking-tight font-syne">
                <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-teal-400 bg-clip-text text-transparent">
                  Mente Viva
                </span>
              </h1>

              <p className="flex items-center justify-center gap-2 text-white/60">
                <Sparkles className="h-4 w-4 text-violet-400" />
                Practica habilidades blandas con avatares de IA
                <Sparkles className="h-4 w-4 text-teal-400" />
              </p>
            </motion.div>

            <motion.div
              className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-8 shadow-2xl backdrop-blur-xl"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.6 }}
            >
              <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-violet-500/30 blur-3xl" />

              <form onSubmit={handleSubmit} className="relative space-y-4">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Email</label>
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@empresa.com"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-white/60">Contraseña</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 pr-11 text-sm text-white placeholder:text-white/30 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-white/40 hover:text-white/80 transition-colors"
                      aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <p className="text-xs text-white/80">{error}</p>
                  </div>
                )}

                <motion.button
                  type="submit"
                  disabled={submitting}
                  whileHover={{ scale: submitting ? 1 : 1.02 }}
                  whileTap={{ scale: submitting ? 1 : 0.98 }}
                  className="group relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-xl hover:shadow-violet-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="relative flex items-center justify-center gap-3">
                    <LogIn className="h-5 w-5" />
                    {submitting ? "Entrando…" : "Iniciar sesión"}
                  </span>
                </motion.button>

                <div className="flex items-center gap-4 pt-1">
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                  <span className="text-sm text-white/40">o</span>
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                </div>

                <motion.button
                  type="button"
                  onClick={() => navigate("/registro")}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="group relative w-full overflow-hidden rounded-xl border border-violet-500/50 bg-violet-500/10 px-4 py-3.5 text-sm font-semibold text-violet-300 backdrop-blur-sm transition-all hover:border-violet-400/70 hover:bg-violet-500/20 hover:text-violet-200"
                >
                  <span className="relative flex items-center justify-center gap-3">
                    <UserPlus className="h-5 w-5" />
                    Crear cuenta nueva
                  </span>
                </motion.button>
              </form>
            </motion.div>

            <p className="mt-8 text-center text-sm text-white/40">
              Demo alpha · Datos protegidos por Firebase Auth
            </p>
          </motion.div>
        </div>
      </div>
    </main>
  );
}

function translateFirebaseError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Email o contraseña incorrectos.";
  }
  if (code === "auth/invalid-email") {
    return "Email con formato inválido.";
  }
  if (code === "auth/too-many-requests") {
    return "Demasiados intentos. Espera unos minutos antes de reintentar.";
  }
  if (code === "auth/network-request-failed") {
    return "Sin conexión. Revisa tu red.";
  }
  return `No pudimos iniciar sesión: ${(err as Error)?.message ?? "error desconocido"}`;
}
