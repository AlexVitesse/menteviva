import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Compass, LayoutDashboard, Play, RotateCcw } from "lucide-react";

import { useSessionStore } from "../stores/sessionStore";

const SCENARIO_LABEL: Record<string, { name: string; descripcion: string }> = {
  roberto: {
    name: "Roberto Martinez",
    descripcion:
      "Director de TI escéptico. Vas a practicar venta consultiva: presentar valor, manejar objeciones, cerrar siguiente paso.",
  },
  maria: {
    name: "Maria Gonzalez",
    descripcion:
      "Gerente de Compras exigente. Vas a practicar negociación de contrato: defender precio, encontrar acuerdos, no ceder bajo presión.",
  },
  carlos: {
    name: "Carlos",
    descripcion: "Demo técnico. (Próximamente)",
  },
};

const LEVEL_LABEL: Record<string, string> = {
  facil: "fácil",
  intermedio: "intermedio",
  dificil: "difícil",
};

export function DiagnosticoRecomendacion() {
  const navigate = useNavigate();
  const { userProfile, setSelectedAvatar, clearDiagnostico } = useSessionStore();

  function handleRedo() {
    if (!confirm("Esto borra tu diagnostico actual y empiezas una nueva entrevista. ¿Continuar?")) return;
    clearDiagnostico();
    navigate("/diagnostico/setup");
  }

  if (!userProfile?.diagnostico) {
    navigate("/diagnostico/setup", { replace: true });
    return null;
  }

  const d = userProfile.diagnostico;
  const nombre = userProfile.registro.nombre.split(" ")[0];
  const scenarioInfo =
    SCENARIO_LABEL[d.recommended_next_scenario] ?? SCENARIO_LABEL.roberto;
  const levelLabel = LEVEL_LABEL[d.recommended_next_level] ?? d.recommended_next_level;

  function handleStartPractice() {
    // El dashboard se encarga de seleccionar el avatar; aqui solo dejamos
    // el id en sesion para que el dashboard auto-elija si quisiera.
    // Por ahora navegamos al dashboard para que el usuario confirme.
    setSelectedAvatar({
      id: d.recommended_next_scenario,
      name: scenarioInfo.name,
      role: "",
      company: "",
      personality: "",
      voice: "",
    });
    navigate("/briefing");
  }

  return (
    <div className="min-h-screen bg-ink text-cream py-10 px-6 flex items-center">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl mx-auto w-full space-y-6"
      >
        <button
          onClick={() => navigate("/diagnostico/perfil")}
          className="flex items-center gap-2 text-muted hover:text-cream transition-colors text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al diagnostico
        </button>

        <header className="text-center pt-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-violet/20 border border-violet/30 mb-4">
            <Compass className="w-8 h-8 text-violet-light" />
          </div>
          <p className="text-teal text-sm font-bold uppercase tracking-wider mb-1">
            Tu siguiente paso
          </p>
          <h1 className="font-syne text-3xl sm:text-4xl font-bold mb-2">
            {nombre}, vamos a poner esto en practica
          </h1>
          <p className="text-muted">
            Basado en lo que observamos, esta es la prueba que mas te conviene
            ahora mismo.
          </p>
        </header>

        <div className="bg-gradient-to-br from-violet/15 to-teal/10 border border-violet/40 rounded-2xl p-6 sm:p-8">
          <p className="text-xs uppercase tracking-wider text-violet-lighter font-bold mb-2">
            Recomendado para ti
          </p>
          <h2 className="font-syne text-2xl sm:text-3xl font-bold mb-1">
            {scenarioInfo.name}
          </h2>
          <p className="text-sm text-violet-lighter mb-4">
            Nivel <span className="font-bold capitalize">{levelLabel}</span>
          </p>
          <p className="text-sm text-cream leading-relaxed mb-6">
            {scenarioInfo.descripcion}
          </p>

          <button
            onClick={handleStartPractice}
            className="w-full flex items-center justify-center gap-3 font-syne font-bold text-sm py-3.5 rounded-[10px] bg-violet text-white hover:bg-violet-light transition-colors mb-3"
          >
            <Play className="w-4 h-4" />
            Empezar mi primera practica
          </button>

          <button
            onClick={() => navigate("/")}
            className="w-full flex items-center justify-center gap-3 font-syne font-bold text-sm py-3 rounded-[10px] border border-white/15 text-muted hover:text-cream hover:border-white/30 transition-colors"
          >
            <LayoutDashboard className="w-4 h-4" />
            Ir al dashboard
          </button>
        </div>

        <button
          onClick={handleRedo}
          className="w-full flex items-center justify-center gap-2 text-xs font-syne text-muted hover:text-cream transition-colors pt-2"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Rehacer el diagnostico
        </button>

        <p className="text-center text-xs text-muted pt-2">
          Tu perfil se actualizara con cada practica que hagas.
        </p>
      </motion.div>
    </div>
  );
}
