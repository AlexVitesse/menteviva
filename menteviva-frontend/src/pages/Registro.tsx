import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useSessionStore } from "../stores/sessionStore";
import type { ExperienceLevel } from "../types";

const EXPERIENCE_OPTIONS: { value: ExperienceLevel; label: string }[] = [
  { value: "entry", label: "Entry (sin experiencia previa)" },
  { value: "junior", label: "Junior (<2 anos)" },
  { value: "mid", label: "Mid (2-5 anos)" },
  { value: "senior", label: "Senior (5-10 anos)" },
  { value: "lead", label: "Lead (10+ anos, roles de liderazgo)" },
  { value: "executive", label: "Executive (director/VP/C-level)" },
];

export function Registro() {
  const navigate = useNavigate();
  const { userProfile, initRegistro, updateRegistro } = useSessionStore();
  const existingRegistro = userProfile?.registro;
  const isEdit = Boolean(existingRegistro);

  const [nombre, setNombre] = useState(existingRegistro?.nombre ?? "");
  const [email, setEmail] = useState(existingRegistro?.email ?? "");
  const [rolObjetivo, setRolObjetivo] = useState(existingRegistro?.rol_objetivo ?? "");
  const [industria, setIndustria] = useState(existingRegistro?.industria ?? "");
  const [nivel, setNivel] = useState<ExperienceLevel>(
    existingRegistro?.experience_level ?? "mid"
  );
  const [errors, setErrors] = useState<string[]>([]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const missing: string[] = [];
    if (!nombre.trim()) missing.push("nombre");
    if (!rolObjetivo.trim()) missing.push("rol objetivo");
    if (!industria.trim()) missing.push("industria");
    if (missing.length) {
      setErrors(missing);
      return;
    }

    const registro = {
      nombre: nombre.trim(),
      email: email.trim() || undefined,
      rol_objetivo: rolObjetivo.trim(),
      industria: industria.trim(),
      experience_level: nivel,
    };

    if (isEdit) {
      updateRegistro(registro);
      navigate("/");
    } else {
      initRegistro(registro);
      navigate("/diagnostico/setup");
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
            ? "Actualiza tu informacion. El diagnostico previo se conserva."
            : "Antes de empezar el diagnostico, dinos quien eres. Lo usaremos para adaptar las preguntas y guardar tu avance."}
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label="Nombre *">
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className={inputClasses}
              placeholder="Maria Lopez"
              autoFocus
            />
          </Field>

          <Field label="Email (opcional)">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClasses}
              placeholder="maria@ejemplo.com"
            />
          </Field>

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
              placeholder="SaaS B2B, Retail, Educacion..."
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

          {errors.length > 0 && (
            <p className="text-danger text-sm">
              Falta completar: {errors.join(", ")}.
            </p>
          )}

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
              className="flex-1 font-syne font-bold text-sm py-3 rounded-[10px] bg-violet text-white hover:bg-violet-light transition-colors"
            >
              {isEdit ? "Guardar cambios" : "Continuar al diagnostico"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

const inputClasses =
  "w-full bg-card border border-white/10 rounded-lg px-3 py-3 text-cream focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}
