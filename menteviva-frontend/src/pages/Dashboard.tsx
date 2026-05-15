import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Play,
  CheckCircle2,
  AlertCircle,
  BarChart3,
  RotateCcw,
  ArrowRight,
} from "lucide-react";
import { AvatarCard } from "../components/avatar/AvatarCard";
import { UserMenu } from "../components/auth/UserMenu";
import { useSessionStore } from "../stores/sessionStore";
import type { Avatar, Gap, Strength } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "";

export function Dashboard() {
  const navigate = useNavigate();
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [loading, setLoading] = useState(true);
  const {
    selectedAvatar,
    setSelectedAvatar,
    resetSession,
    userProfile,
    clearDiagnostico,
  } = useSessionStore();

  useEffect(() => {
    resetSession();
    fetchAvatars();
  }, []);

  async function fetchAvatars() {
    try {
      const res = await fetch(`${API_URL}/api/avatars`, { cache: "no-store" });
      const data = await res.json();
      setAvatars(data.avatars);
    } catch (error) {
      console.error("Error fetching avatars:", error);
      // Fallback alineado con app/prompts/scenarios.py por si el backend
      // no responde a tiempo (no la legacy de Roberto Martinez/TI).
      setAvatars([
        {
          id: "roberto",
          name: "Roberto Garza",
          role: "Director de Operaciones",
          company: "Manufacturera metalmecanica (cliente Ingenieria Condor)",
          personality:
            "Pragmatico, orientado a operaciones. Habla Lean/Six Sigma.",
          voice: "es-MX-JorgeNeural",
          avatar_type: "animated",
        },
        {
          id: "maria",
          name: "Maria Gonzalez",
          role: "Gerente de Compras",
          company: "Retail Express",
          personality: "Amable pero exigente",
          voice: "es-MX-DaliaNeural",
          avatar_type: "animated",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleStart() {
    if (selectedAvatar) {
      navigate("/briefing");
    }
  }

  function handleRedoDiagnostic() {
    if (
      !confirm(
        "Esto reemplaza tu diagnóstico actual al terminar la nueva entrevista. ¿Continuar?"
      )
    )
      return;
    clearDiagnostico();
    navigate("/diagnostico/setup");
  }

  return (
    <div className="min-h-screen bg-ink text-cream">
      {/* Header — mismo lenguaje del navbar del landing (rounded glass card) */}
      {/* relative z-50: el <main> usa <motion.div> con transform, lo cual crea un
          stacking context que pintaria encima del dropdown del UserMenu. Anclar
          el header como su propio stacking context arriba lo evita. */}
      <header className="relative z-50 px-4 sm:px-6 lg:px-8 pt-4">
        <div className="max-w-6xl mx-auto rounded-2xl border border-white/10 bg-ink/80 backdrop-blur-xl px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => navigate("/")}
              className="font-syne font-bold text-lg tracking-tight"
            >
              <span className="bg-gradient-to-r from-violet-light to-teal bg-clip-text text-transparent">
                Mente Viva
              </span>
            </button>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden sm:flex px-3 py-1 rounded-full bg-gradient-to-r from-violet/20 to-teal/20 border border-violet/30">
                <span className="text-xs font-semibold text-violet-lighter tracking-wider">
                  DEMO
                </span>
              </div>
              <UserMenu />
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {userProfile?.diagnostico && (
            <DiagnosticoResumen
              nombre={userProfile.registro.nombre}
              strengths={userProfile.diagnostico.strengths}
              gaps={userProfile.diagnostico.gaps}
              recommendedScenario={userProfile.diagnostico.recommended_next_scenario}
              recommendedLevel={userProfile.diagnostico.recommended_next_level}
              onSeeProfile={() => navigate("/mi-plan")}
              onRedo={handleRedoDiagnostic}
            />
          )}

          <h2 className="font-syne text-3xl sm:text-4xl font-bold mb-2">
            Elige tu escenario
          </h2>
          <p className="text-muted mb-10">
            Selecciona con quien quieres practicar hoy
          </p>

          {/* Avatar Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-muted">Cargando avatares...</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 mb-12 items-stretch">
              {avatars.map((avatar, index) => (
                <motion.div
                  key={avatar.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="h-full"
                >
                  <AvatarCard
                    avatar={avatar}
                    isSelected={selectedAvatar?.id === avatar.id}
                    onClick={() => setSelectedAvatar(avatar)}
                  />
                </motion.div>
              ))}
            </div>
          )}

          {/* Start Button */}
          <motion.div
            className="flex justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            <button
              onClick={handleStart}
              disabled={!selectedAvatar}
              className={`btn-primary flex items-center gap-3 text-lg px-10 py-4 ${
                !selectedAvatar && "opacity-50 cursor-not-allowed"
              }`}
            >
              <Play className="w-5 h-5" />
              Iniciar Simulación
            </button>
          </motion.div>
        </motion.div>
      </main>
    </div>
  );
}

function DiagnosticoResumen({
  nombre,
  strengths,
  gaps,
  recommendedScenario,
  recommendedLevel,
  onSeeProfile,
  onRedo,
}: {
  nombre: string;
  strengths: Strength[];
  gaps: Gap[];
  recommendedScenario: string;
  recommendedLevel: string;
  onSeeProfile: () => void;
  onRedo: () => void;
}) {
  const topStrengths = strengths.slice(0, 2);
  const mainGap = gaps[0];
  const firstName = nombre.split(" ")[0];

  return (
    // Gradient-border wrapper (mismo patron del landing — how-it-works/comparison)
    <div className="relative rounded-2xl p-[1px] bg-gradient-to-b from-violet/40 via-transparent to-teal/40 mb-10">
      <div className="rounded-2xl bg-deep p-6 backdrop-blur-xl">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
          <div>
            <p className="text-xs uppercase tracking-wider text-violet-lighter font-bold mb-1">
              Tu perfil
            </p>
            <h3 className="font-syne text-2xl font-bold">{firstName}</h3>
          </div>
          <div className="text-xs text-muted sm:text-right">
            <span className="block uppercase tracking-wider">Recomendado</span>
            <span className="text-violet-lighter capitalize font-medium">
              {recommendedScenario}
            </span>
            {" · "}
            <span className="text-violet-lighter capitalize">
              {recommendedLevel}
            </span>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-5">
          {topStrengths.length > 0 && (
            <div className="bg-ink/40 rounded-xl p-4 border border-white/5">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-success" />
                <span className="text-sm font-bold text-success">Fortalezas</span>
              </div>
              <ul className="space-y-1">
                {topStrengths.map((s, i) => (
                  <li key={i} className="text-sm text-muted capitalize">
                    {s.skill.replace(/_/g, " ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {mainGap && (
            <div className="bg-ink/40 rounded-xl p-4 border border-white/5">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-4 h-4 text-warning" />
                <span className="text-sm font-bold text-warning">
                  Foco principal
                </span>
              </div>
              <p className="text-sm text-muted capitalize">
                {mainGap.skill.replace(/_/g, " ")}
              </p>
            </div>
          )}
        </div>

        {/* Acciones — visibles para que no haya que cazar el botón en el header */}
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={onSeeProfile}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-violet/20 border border-violet/40 text-sm text-cream hover:bg-violet/30 hover:border-violet/60 transition-colors"
          >
            <BarChart3 className="w-4 h-4" />
            Ver mi perfil completo
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={onRedo}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-white/10 bg-white/5 text-sm text-muted hover:text-cream hover:bg-white/10 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Rehacer diagnóstico
          </button>
        </div>
      </div>
    </div>
  );
}
