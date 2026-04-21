import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useSessionStore } from "../stores/sessionStore";

const TONO_OPTIONS = [
  { value: "calido-profesional", label: "Calido y profesional (recomendado)" },
  { value: "coach", label: "Coach" },
  { value: "reclutador ejecutivo", label: "Reclutador ejecutivo" },
];

const IDIOMA_OPTIONS = [
  { value: "es-MX", label: "Espanol (Mexico)" },
  { value: "es-ES", label: "Espanol (Espana)" },
  { value: "en", label: "English" },
];

const DURACION_OPTIONS = [25, 40, 60];

export function DiagnosticoSetup() {
  const navigate = useNavigate();
  const { userProfile, setDiagnosticoVars } = useSessionStore();

  const [idioma, setIdioma] = useState("es-MX");
  const [tono, setTono] = useState("calido-profesional");
  const [minutos, setMinutos] = useState(25);

  if (!userProfile?.registro) {
    // Sin registro no hay nada que personalizar — el guard ya debio mandar a /registro
    navigate("/registro", { replace: true });
    return null;
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setDiagnosticoVars({ idioma, tono, minutos });
    navigate("/diagnostico");
  }

  return (
    <div className="min-h-screen bg-ink text-cream flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-xl bg-card rounded-2xl border border-white/5 p-8 shadow-2xl"
      >
        <h1 className="font-syne text-3xl font-bold mb-2">
          Hola, {userProfile.registro.nombre}
        </h1>
        <p className="text-muted mb-6">
          Voy a conducirte una entrevista corta por competencias. Al final vas a
          recibir un mapa de fortalezas y areas para trabajar. Ajustemos un par de
          detalles antes de empezar.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label="Idioma">
            <select
              value={idioma}
              onChange={(e) => setIdioma(e.target.value)}
              className={inputClasses}
            >
              {IDIOMA_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-card">
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tono del avatar">
            <select
              value={tono}
              onChange={(e) => setTono(e.target.value)}
              className={inputClasses}
            >
              {TONO_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-card">
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Duracion objetivo">
            <div className="grid grid-cols-3 gap-2">
              {DURACION_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMinutos(m)}
                  className={`py-3 rounded-lg border font-syne font-bold ${
                    minutos === m
                      ? "bg-violet border-violet text-white"
                      : "border-white/10 text-cream hover:border-violet"
                  }`}
                >
                  {m} min
                </button>
              ))}
            </div>
          </Field>

          <button
            type="submit"
            className="w-full font-syne font-bold text-sm py-3 rounded-[10px] bg-violet text-white hover:bg-violet-light transition-colors mt-4"
          >
            Comenzar diagnostico
          </button>
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
