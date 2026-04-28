import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Play, Target, Brain, Clock, MessageSquare, TrendingUp, ArrowLeft, Gauge } from "lucide-react";
import { AnimatedAvatar, AvatarCharacter } from "../components/avatar/AnimatedAvatar";
import { useSessionStore, type SimulationLevel } from "../stores/sessionStore";

const LEVELS: { value: SimulationLevel; label: string; description: string }[] = [
  {
    value: "principiante",
    label: "Principiante",
    description: "Roberto recibe vendedores en formación. Cede tras 2 objeciones manejadas + ROI claro.",
  },
  {
    value: "intermedio",
    label: "Intermedio",
    description: "Roberto exige descomposición de OEE, ROI desglosado y propuesta de piloto antes de ceder.",
  },
  {
    value: "avanzado",
    label: "Avanzado",
    description: "Roberto evalúa, no pregunta. Pide NPV/IRR + caso verificable + POC con go/no-go. Castiga descuentos prematuros.",
  },
];

// Avatares que soportan seleccion de nivel. El backend ignora `level` para los demas.
const AVATARS_WITH_LEVELS = new Set(["roberto"]);

// Datos de escenarios para cada avatar
const SCENARIOS = {
  roberto: {
    type: "Venta Consultiva B2B",
    objective: "Agendar una demo tecnica con el prospecto",
    context: [
      "Roberto es Director de TI en Grupo Industrial Norte",
      "Su empresa tiene problemas con sistemas legacy",
      "Tiene presupuesto pero necesita justificarlo ante el CFO",
      "Es esceptico por malas experiencias con vendedores",
    ],
    skills: [
      { name: "Escucha activa", icon: Brain },
      { name: "Manejo de objeciones", icon: MessageSquare },
      { name: "Construccion de rapport", icon: TrendingUp },
      { name: "Claridad de propuesta", icon: Target },
    ],
    tips: [
      "Haz preguntas antes de presentar tu solucion",
      "Respeta su tiempo, se directo y concreto",
      "Prepara respuestas a objeciones de precio y tiempo",
    ],
    duration: "8-10 minutos",
  },
  maria: {
    type: "Negociacion de Contrato",
    objective: "Cerrar una renovacion de contrato con terminos favorables",
    context: [
      "Maria es Gerente de Compras en Retail Express",
      "Busca renovar contrato con tu empresa (proveedor actual)",
      "Tiene 3 cotizaciones de la competencia",
      "Su jefe la presiona por reducir costos 15%",
    ],
    skills: [
      { name: "Defensa de valor", icon: Target },
      { name: "Negociacion win-win", icon: TrendingUp },
      { name: "Manejo de presion", icon: Brain },
      { name: "Cierre efectivo", icon: MessageSquare },
    ],
    tips: [
      "No cedas demasiado rapido o pedira mas",
      "Defiende el valor de tu producto/servicio",
      "Busca concesiones mutuas, no unilaterales",
    ],
    duration: "8-10 minutos",
  },
};

export function Briefing() {
  const navigate = useNavigate();
  const { selectedAvatar, userProfile, selectedLevel, setSelectedLevel } = useSessionStore();
  const supportsLevels = selectedAvatar ? AVATARS_WITH_LEVELS.has(selectedAvatar.id) : false;

  useEffect(() => {
    if (!selectedAvatar) {
      navigate("/");
    }
  }, [selectedAvatar, navigate]);

  if (!selectedAvatar) return null;

  const scenario = SCENARIOS[selectedAvatar.id as keyof typeof SCENARIOS];
  const avatarCharacter: AvatarCharacter = selectedAvatar.id === "roberto" ? "roberto" : "maria";
  const competencias = userProfile?.diagnostico?.competencias_foco ?? [];

  return (
    <div className="min-h-screen bg-ink">
      {/* Header */}
      <header className="border-b border-white/5 px-8 py-4 flex items-center justify-between">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-muted hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver
        </button>
        <h1 className="font-syne text-xl font-bold bg-gradient-to-r from-violet-light to-teal bg-clip-text text-transparent">
          Mente Viva
        </h1>
        <div className="w-20" /> {/* Spacer for centering */}
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-8 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid md:grid-cols-3 gap-8"
        >
          {/* Left Column - Avatar Info */}
          <div className="md:col-span-1">
            <div className="bg-surface rounded-2xl p-6 border border-white/5">
              {/* Avatar */}
              <div className="flex justify-center mb-4">
                <AnimatedAvatar
                  character={avatarCharacter}
                  size={160}
                  isActive={true}
                />
              </div>

              {/* Avatar Info */}
              <div className="text-center mb-6">
                <h2 className="font-syne text-xl font-bold">{selectedAvatar.name}</h2>
                <p className="text-violet-light text-sm">{selectedAvatar.role}</p>
                <p className="text-muted text-sm">{selectedAvatar.company}</p>
              </div>

              {/* Personality */}
              <div className="bg-ink/50 rounded-lg p-4">
                <p className="text-sm text-muted mb-1">Personalidad</p>
                <p className="text-sm">{selectedAvatar.personality}</p>
              </div>
            </div>
          </div>

          {/* Right Column - Scenario Details */}
          <div className="md:col-span-2 space-y-6">
            {/* Scenario Type Badge */}
            <div className="flex items-center gap-3">
              <span className="px-4 py-2 bg-violet/20 text-violet-light rounded-full text-sm font-medium">
                {scenario.type}
              </span>
              <span className="flex items-center gap-1 text-muted text-sm">
                <Clock className="w-4 h-4" />
                {scenario.duration}
              </span>
            </div>

            {competencias.length > 0 && (
              <div className="bg-violet/10 border border-violet/30 rounded-xl p-4">
                <p className="text-xs text-violet-lighter font-bold uppercase mb-2">
                  Segun tu diagnostico, en esta prueba vamos a trabajar
                </p>
                <div className="flex flex-wrap gap-2">
                  {competencias.map((c) => (
                    <span
                      key={c}
                      className="px-3 py-1 bg-violet/20 text-violet-lighter text-sm rounded-full border border-violet/40"
                    >
                      {c.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {supportsLevels && (
              <div className="bg-surface rounded-xl p-6 border border-white/5">
                <div className="flex items-center gap-2 mb-1">
                  <Gauge className="w-5 h-5 text-violet-light" />
                  <h3 className="font-syne font-bold">Nivel de dificultad</h3>
                </div>
                <p className="text-xs text-muted mb-4">
                  Define qué tan exigente será {selectedAvatar.name} contigo.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {LEVELS.map((lvl) => {
                    const isSelected = selectedLevel === lvl.value;
                    return (
                      <button
                        key={lvl.value}
                        type="button"
                        onClick={() => setSelectedLevel(lvl.value)}
                        className={`text-left rounded-lg p-3 border transition-colors ${
                          isSelected
                            ? "bg-violet/20 border-violet text-white"
                            : "bg-ink/50 border-white/5 text-muted hover:border-violet/40 hover:text-white"
                        }`}
                      >
                        <p className="font-syne font-bold text-sm mb-1">{lvl.label}</p>
                        <p className="text-xs leading-snug">{lvl.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Objective */}
            <div className="bg-surface rounded-xl p-6 border border-white/5">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-5 h-5 text-teal" />
                <h3 className="font-syne font-bold">Tu Objetivo</h3>
              </div>
              <p className="text-lg">{scenario.objective}</p>
            </div>

            {/* Context */}
            <div className="bg-surface rounded-xl p-6 border border-white/5">
              <h3 className="font-syne font-bold mb-4">Contexto del Escenario</h3>
              <ul className="space-y-3">
                {scenario.context.map((item, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="flex items-start gap-3"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-violet mt-2" />
                    <span className="text-muted">{item}</span>
                  </motion.li>
                ))}
              </ul>
            </div>

            {/* Skills Evaluated */}
            <div className="bg-surface rounded-xl p-6 border border-white/5">
              <h3 className="font-syne font-bold mb-4">Habilidades a Evaluar</h3>
              <div className="grid grid-cols-2 gap-3">
                {scenario.skills.map((skill, i) => (
                  <motion.div
                    key={skill.name}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.3 + i * 0.1 }}
                    className="flex items-center gap-3 bg-ink/50 rounded-lg p-3"
                  >
                    <skill.icon className="w-5 h-5 text-violet-light" />
                    <span className="text-sm">{skill.name}</span>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Tips */}
            <div className="bg-gradient-to-r from-violet/10 to-teal/10 rounded-xl p-6 border border-violet/20">
              <h3 className="font-syne font-bold mb-3">Tips para esta sesion</h3>
              <ul className="space-y-2">
                {scenario.tips.map((tip, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-muted">
                    <span className="text-teal">*</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>

            {/* Start Button */}
            <motion.button
              onClick={() => navigate("/simulation")}
              className="w-full btn-primary flex items-center justify-center gap-3 text-lg py-4"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Play className="w-5 h-5" />
              Iniciar Simulacion
            </motion.button>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
