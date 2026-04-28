import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { createUserWithEmailAndPassword } from "firebase/auth";

import { firebaseAuth, isFirebaseConfigured } from "../lib/firebase";
import { ApiError, apiFetch } from "../lib/api";
import { useSessionStore } from "../stores/sessionStore";
import type { ExperienceLevel, UserProfile } from "../types";

const EXPERIENCE_OPTIONS: { value: ExperienceLevel; label: string }[] = [
  { value: "entry", label: "Entry (sin experiencia previa)" },
  { value: "junior", label: "Junior (<2 años)" },
  { value: "mid", label: "Mid (2-5 años)" },
  { value: "senior", label: "Senior (5-10 años)" },
  { value: "lead", label: "Lead (10+ años, roles de liderazgo)" },
  { value: "executive", label: "Executive (director/VP/C-level)" },
];

export function Registro() {
  const navigate = useNavigate();
  const { userProfile, updateRegistro, setUserProfileFromAuth } = useSessionStore();
  const existingRegistro = userProfile?.registro;
  const isEdit = Boolean(existingRegistro);

  const [nombre, setNombre] = useState(existingRegistro?.nombre ?? "");
  const [email, setEmail] = useState(existingRegistro?.email ?? "");
  const [password, setPassword] = useState("");
  const [rolObjetivo, setRolObjetivo] = useState(existingRegistro?.rol_objetivo ?? "");
  const [industria, setIndustria] = useState(existingRegistro?.industria ?? "");
  const [nivel, setNivel] = useState<ExperienceLevel>(
    existingRegistro?.experience_level ?? "mid"
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const missing: string[] = [];
    if (!nombre.trim()) missing.push("nombre");
    if (!rolObjetivo.trim()) missing.push("rol objetivo");
    if (!industria.trim()) missing.push("industria");
    if (!isEdit) {
      if (!email.trim()) missing.push("email");
      if (!password) missing.push("contraseña");
      if (password && password.length < 6) {
        setError("La contraseña debe tener al menos 6 caracteres.");
        return;
      }
    }
    if (missing.length) {
      setError(`Falta completar: ${missing.join(", ")}.`);
      return;
    }

    if (isEdit) {
      // Solo actualiza datos locales; no toca Firebase ni vuelve a registrar.
      updateRegistro({
        nombre: nombre.trim(),
        email: email.trim() || undefined,
        rol_objetivo: rolObjetivo.trim(),
        industria: industria.trim(),
        experience_level: nivel,
      });
      navigate("/");
      return;
    }

    if (!isFirebaseConfigured() || !firebaseAuth) {
      setError(
        "Firebase no está configurado en este build. Avisa al equipo técnico."
      );
      return;
    }

    setSubmitting(true);
    try {
      // 1) Crear cuenta en Firebase
      await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
      // 2) Registrar en backend (apiFetch adjunta el ID token recién creado)
      const profile = await apiFetch<UserProfile>("/api/auth/register", {
        method: "POST",
        json: {
          nombre: nombre.trim(),
          rol_objetivo: rolObjetivo.trim(),
          industria: industria.trim(),
          experience_level: nivel,
        },
      });
      // 3) Hidratar store y mandar al diagnóstico
      setUserProfileFromAuth(profile);
      navigate("/diagnostico/setup", { replace: true });
    } catch (err) {
      setError(translateError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink text-cream flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-xl bg-card rounded-2xl border border-white/5 p-8 shadow-2xl"
      >
        <h1 className="font-syne text-3xl font-bold mb-2">
          {isEdit ? "Editar registro" : "Bienvenido a Mente Viva"}
        </h1>
        <p className="text-muted mb-6">
          {isEdit
            ? "Actualiza tu información. El diagnóstico previo se conserva."
            : "Crea tu cuenta. Lo usaremos para guardar tu progreso entre sesiones."}
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label="Nombre *">
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className={inputClasses}
              placeholder="María López"
              autoFocus
            />
          </Field>

          <Field label={isEdit ? "Email (no editable)" : "Email *"}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClasses}
              placeholder="maria@ejemplo.com"
              autoComplete="email"
              disabled={isEdit}
            />
          </Field>

          {!isEdit && (
            <Field label="Contraseña * (mínimo 6 caracteres)">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClasses}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </Field>
          )}

          <Field label="Rol objetivo *">
            <input
              type="text"
              value={rolObjetivo}
              onChange={(e) => setRolObjetivo(e.target.value)}
              className={inputClasses}
              placeholder="Gerente de Ventas"
            />
          </Field>

          <Field label="Industria *">
            <input
              type="text"
              value={industria}
              onChange={(e) => setIndustria(e.target.value)}
              className={inputClasses}
              placeholder="SaaS B2B, Retail, Educación…"
            />
          </Field>

          <Field label="Nivel de experiencia *">
            <select
              value={nivel}
              onChange={(e) => setNivel(e.target.value as ExperienceLevel)}
              className={inputClasses}
            >
              {EXPERIENCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-card">
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>

          {error && <p className="text-danger text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            {isEdit && (
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="flex-1 font-syne font-bold text-sm py-3 rounded-[10px] border border-violet text-violet hover:bg-violet/10"
              >
                Cancelar
              </button>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 font-syne font-bold text-sm py-3 rounded-[10px] bg-violet text-white hover:bg-violet-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting
                ? "Creando cuenta…"
                : isEdit
                ? "Guardar cambios"
                : "Crear cuenta y continuar"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function translateError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message || `Backend respondió ${err.status}.`;
  }
  const code = (err as { code?: string })?.code ?? "";
  if (code === "auth/email-already-in-use") {
    return "Ya hay una cuenta con ese email. ¿Quieres iniciar sesión?";
  }
  if (code === "auth/weak-password") {
    return "La contraseña es muy débil. Usa al menos 6 caracteres.";
  }
  if (code === "auth/invalid-email") {
    return "Email con formato inválido.";
  }
  if (code === "auth/network-request-failed") {
    return "Sin conexión. Revisa tu red.";
  }
  return `No pudimos crear la cuenta: ${(err as Error)?.message ?? "error desconocido"}`;
}

const inputClasses =
  "w-full bg-card border border-white/10 rounded-lg px-3 py-3 text-cream focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet disabled:opacity-50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}
