import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Check, Eye, EyeOff, X } from "lucide-react";
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

// Requisitos visibles para el usuario.
// `required` = debe cumplirse para crear cuenta. Por defecto Firebase Auth
// exige solo `min6` (puedes endurecer en Firebase Console -> Auth -> Settings
// -> Password policy; si activas mas reglas alla, replica aqui las flags).
interface PasswordCheck {
  id: string;
  label: string;
  required: boolean;
  test: (pw: string) => boolean;
}

const PASSWORD_CHECKS: PasswordCheck[] = [
  { id: "min6", label: "Al menos 6 caracteres (Firebase)", required: true, test: (p) => p.length >= 6 },
  { id: "min8", label: "Al menos 8 caracteres (recomendado)", required: false, test: (p) => p.length >= 8 },
  { id: "mixCase", label: "Mayúscula y minúscula", required: false, test: (p) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { id: "number", label: "Al menos un número", required: false, test: (p) => /\d/.test(p) },
  { id: "special", label: "Al menos un carácter especial (!@#$…)", required: false, test: (p) => /[^A-Za-z0-9]/.test(p) },
];

function strengthLabel(metCount: number): { label: string; color: string; pct: number } {
  // metCount = total de checks cumplidos (incluye `min6`).
  if (metCount <= 1) return { label: "Muy débil", color: "bg-red-500", pct: 20 };
  if (metCount === 2) return { label: "Débil", color: "bg-orange-500", pct: 40 };
  if (metCount === 3) return { label: "Razonable", color: "bg-yellow-500", pct: 60 };
  if (metCount === 4) return { label: "Buena", color: "bg-lime-500", pct: 80 };
  return { label: "Muy fuerte", color: "bg-green-500", pct: 100 };
}

export function Registro() {
  const navigate = useNavigate();
  const { userProfile, updateRegistro, setUserProfileFromAuth } = useSessionStore();
  const existingRegistro = userProfile?.registro;
  const isEdit = Boolean(existingRegistro);

  const [nombre, setNombre] = useState(existingRegistro?.nombre ?? "");
  const [email, setEmail] = useState(existingRegistro?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [rolObjetivo, setRolObjetivo] = useState(existingRegistro?.rol_objetivo ?? "");
  const [industria, setIndustria] = useState(existingRegistro?.industria ?? "");
  const [nivel, setNivel] = useState<ExperienceLevel>(
    existingRegistro?.experience_level ?? "mid"
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checks = useMemo(
    () => PASSWORD_CHECKS.map((c) => ({ ...c, met: c.test(password) })),
    [password]
  );
  const metCount = checks.filter((c) => c.met).length;
  const requiredMet = checks.every((c) => !c.required || c.met);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const strength = strengthLabel(metCount);

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
      if (!confirmPassword) missing.push("confirmación de contraseña");
    }
    if (missing.length) {
      setError(`Falta completar: ${missing.join(", ")}.`);
      return;
    }

    if (!isEdit) {
      if (!requiredMet) {
        setError("La contraseña no cumple los requisitos mínimos.");
        return;
      }
      if (!passwordsMatch) {
        setError("Las contraseñas no coinciden.");
        return;
      }
    }

    if (isEdit) {
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
      await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
      const profile = await apiFetch<UserProfile>("/api/auth/register", {
        method: "POST",
        json: {
          nombre: nombre.trim(),
          rol_objetivo: rolObjetivo.trim(),
          industria: industria.trim(),
          experience_level: nivel,
        },
      });
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
            <>
              <Field label="Contraseña *">
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  show={showPassword}
                  onToggle={() => setShowPassword((s) => !s)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </Field>

              {password && (
                <div className="-mt-2 space-y-3">
                  {/* Strength meter */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted">Fortaleza</span>
                      <span className="text-xs font-medium">{strength.label}</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <motion.div
                        className={`h-full rounded-full ${strength.color}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${strength.pct}%` }}
                        transition={{ duration: 0.25 }}
                      />
                    </div>
                  </div>

                  {/* Checklist */}
                  <ul className="space-y-1">
                    {checks.map((c) => (
                      <li
                        key={c.id}
                        className={`flex items-center gap-2 text-xs ${
                          c.met
                            ? "text-green-400"
                            : c.required
                            ? "text-orange-300"
                            : "text-muted"
                        }`}
                      >
                        {c.met ? (
                          <Check className="w-3.5 h-3.5 flex-shrink-0" />
                        ) : (
                          <X className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                        )}
                        <span>
                          {c.label}
                          {c.required && !c.met && (
                            <span className="ml-1 text-orange-400">(requerido)</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Field label="Confirmar contraseña *">
                <PasswordInput
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  show={showConfirm}
                  onToggle={() => setShowConfirm((s) => !s)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
                {confirmPassword.length > 0 && (
                  <p
                    className={`mt-1.5 flex items-center gap-1.5 text-xs ${
                      passwordsMatch ? "text-green-400" : "text-orange-300"
                    }`}
                  >
                    {passwordsMatch ? (
                      <>
                        <Check className="w-3.5 h-3.5" /> Las contraseñas coinciden
                      </>
                    ) : (
                      <>
                        <X className="w-3.5 h-3.5" /> Las contraseñas no coinciden
                      </>
                    )}
                  </p>
                )}
              </Field>
            </>
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

function PasswordInput({
  value,
  onChange,
  show,
  onToggle,
  placeholder,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder: string;
  autoComplete: string;
}) {
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClasses} pr-11`}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-white transition-colors"
        aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
        tabIndex={-1}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
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
