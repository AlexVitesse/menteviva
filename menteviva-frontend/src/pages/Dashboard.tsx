import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Play, CheckCircle2, AlertCircle, BarChart3 } from "lucide-react";
import { AvatarCard } from "../components/avatar/AvatarCard";
import { useSessionStore } from "../stores/sessionStore";
import type { Avatar, Gap, Strength } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "";

export function Dashboard() {
  const navigate = useNavigate();
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [loading, setLoading] = useState(true);
  const { selectedAvatar, setSelectedAvatar, resetSession, userProfile } = useSessionStore();

  useEffect(() => {
    resetSession();
    fetchAvatars();
  }, []);

  async function fetchAvatars() {
    try {
      const res = await fetch(`${API_URL}/api/avatars`);
      const data = await res.json();
      setAvatars(data.avatars);
    } catch (error) {
      console.error("Error fetching avatars:", error);
      // Fallback avatars para desarrollo
      setAvatars([
        {
          id: "roberto",
          name: "Roberto Martinez",
          role: "Director de TI",
          company: "Grupo Industrial Norte",
          personality: "Esceptico pero abierto",
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

  return (
    <div className="min-h-screen bg-ink">
      {/* Header */}
      <header className="border-b border-white/5 px-8 py-6">
        <div className="flex items-center justify-between">
          <h1 className="font-syne text-2xl font-bold bg-gradient-to-r from-violet-light to-teal bg-clip-text text-transparent">
            Mente Viva
          </h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/mi-plan")}
              className="flex items-center gap-2 text-sm text-muted hover:text-white transition-colors"
            >
              <BarChart3 className="w-4 h-4" />
              Mi plan
            </button>
            <div className="px-3 py-1 rounded-full bg-gradient-to-r from-violet/20 to-teal/20 border border-violet/30">
              <span className="text-xs font-semibold text-violet-light tracking-wider">
                DEMO
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-4xl mx-auto px-8 py-12">
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
            />
          )}

          <h2 className="font-syne text-3xl font-bold mb-2">
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
              {avatars.map((avatar, index) => (
                <motion.div
                  key={avatar.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
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
              className={`
                btn-primary flex items-center gap-3 text-lg px-10 py-4
                ${!selectedAvatar && "opacity-50 cursor-not-allowed"}
              `}
            >
              <Play className="w-5 h-5" />
              Iniciar Simulacion
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
}: {
  nombre: string;
  strengths: Strength[];
  gaps: Gap[];
  recommendedScenario: string;
  recommendedLevel: string;
}) {
  const topStrengths = strengths.slice(0, 2);
  const mainGap = gaps[0];
  const firstName = nombre.split(" ")[0];

  return (
    <div className="bg-card/50 border border-violet/20 rounded-2xl p-6 mb-10">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-syne text-lg font-bold">Tu perfil, {firstName}</h3>
        <span className="text-xs text-muted uppercase tracking-wider">
          Recomendado: <span className="text-violet-lighter capitalize">{recommendedScenario}</span>
          {" · "}
          <span className="text-violet-lighter">{recommendedLevel}</span>
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {topStrengths.length > 0 && (
          <div className="bg-ink/40 rounded-xl p-4">
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
          <div className="bg-ink/40 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-warning" />
              <span className="text-sm font-bold text-warning">Foco principal</span>
            </div>
            <p className="text-sm text-muted capitalize">
              {mainGap.skill.replace(/_/g, " ")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
