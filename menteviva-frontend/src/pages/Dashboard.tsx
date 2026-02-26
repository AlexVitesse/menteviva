import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Play } from "lucide-react";
import { AvatarCard } from "../components/avatar/AvatarCard";
import { useSessionStore } from "../stores/sessionStore";
import type { Avatar } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function Dashboard() {
  const navigate = useNavigate();
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [loading, setLoading] = useState(true);
  const { selectedAvatar, setSelectedAvatar, resetSession } = useSessionStore();

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
          {/* Demo Badge */}
          <div className="px-3 py-1 rounded-full bg-gradient-to-r from-violet/20 to-teal/20 border border-violet/30">
            <span className="text-xs font-semibold text-violet-light tracking-wider">
              DEMO
            </span>
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
