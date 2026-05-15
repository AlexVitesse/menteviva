import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Target,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  Play,
  Calendar,
  Clock,
  TrendingUp,
  RotateCcw,
} from "lucide-react";
import { useSessionStore } from "../stores/sessionStore";
import type { PracticeSessionSummary } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "";

const AVATAR_LABELS: Record<string, string> = {
  roberto: "Roberto Garza · Director de Operaciones",
  maria: "María González · Gerente de Compras",
  carlos: "Carlos · Entrevistador",
};

export function MiPlan() {
  const navigate = useNavigate();
  const { userProfile, setSelectedAvatar, setSelectedLevel, clearDiagnostico } =
    useSessionStore();
  const [sessions, setSessions] = useState<PracticeSessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);

  useEffect(() => {
    if (!userProfile?.user_id) {
      setLoadingSessions(false);
      return;
    }
    fetch(`${API_URL}/api/user/${userProfile.user_id}/sessions`)
      .then((r) => r.json())
      .then((data) => setSessions(data.sessions ?? []))
      .catch((err) => console.error("[MiPlan] sesiones fallo:", err))
      .finally(() => setLoadingSessions(false));
  }, [userProfile?.user_id]);

  if (!userProfile?.registro) {
    return null;
  }

  const diag = userProfile.diagnostico;
  const firstName = userProfile.registro.nombre.split(" ")[0];

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

  function startNextChallenge() {
    if (!diag) return;
    const avatarId = diag.recommended_next_scenario;
    setSelectedAvatar({
      id: avatarId,
      name: avatarId === "roberto" ? "Roberto Garza" : "María González",
      role: "",
      company: "",
      personality: "",
      voice: "",
      avatar_type: "animated",
    });
    // Mapear el nivel del diagnostico (facil/intermedio/dificil) al de simulacion.
    const levelMap = {
      facil: "principiante",
      intermedio: "intermedio",
      dificil: "avanzado",
    } as const;
    setSelectedLevel(levelMap[diag.recommended_next_level] ?? "principiante");
    navigate("/briefing");
  }

  return (
    <div className="min-h-screen bg-ink">
      <header className="border-b border-white/5 px-8 py-4 flex items-center justify-between">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-muted hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver
        </button>
        <h1 className="font-syne text-xl font-bold bg-gradient-to-r from-violet-light to-teal bg-clip-text text-transparent">
          Mi Plan
        </h1>
        <div className="w-20" />
      </header>

      <main className="max-w-5xl mx-auto px-8 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          {/* Perfil */}
          <section className="bg-card/50 border border-white/5 rounded-2xl p-6">
            <p className="text-xs text-muted uppercase tracking-wider mb-1">Tu perfil</p>
            <h2 className="font-syne text-2xl font-bold mb-2">{firstName}</h2>
            <div className="flex flex-wrap gap-2 text-sm text-muted">
              <span>{userProfile.registro.rol_objetivo}</span>
              <span>·</span>
              <span>{userProfile.registro.industria}</span>
              <span>·</span>
              <span className="capitalize">{userProfile.registro.experience_level}</span>
            </div>
          </section>

          {/* Diagnostico resumen */}
          {diag && (
            <section className="bg-card/50 border border-violet/20 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4 gap-2">
                <h3 className="font-syne text-lg font-bold">Tu diagnóstico</h3>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted hidden sm:inline">
                    {new Date(diag.completed_at).toLocaleDateString("es-MX", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                  <button
                    onClick={handleRedoDiagnostic}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-muted hover:text-cream hover:bg-white/10 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Rehacer
                  </button>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div className="bg-ink/40 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-success" />
                    <span className="text-sm font-bold text-success">Fortalezas</span>
                  </div>
                  <ul className="space-y-1">
                    {diag.strengths.slice(0, 3).map((s, i) => (
                      <li key={i} className="text-sm text-muted capitalize">
                        {s.skill.replace(/_/g, " ")}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-ink/40 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-4 h-4 text-warning" />
                    <span className="text-sm font-bold text-warning">Áreas de foco</span>
                  </div>
                  <ul className="space-y-1">
                    {diag.gaps.slice(0, 3).map((g, i) => (
                      <li key={i} className="text-sm text-muted capitalize">
                        {g.skill.replace(/_/g, " ")}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {diag.blind_spot && (
                <div className="bg-violet/5 border border-violet/20 rounded-xl p-4">
                  <div className="flex items-start gap-2">
                    <Lightbulb className="w-4 h-4 text-violet-lighter mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-violet-lighter uppercase mb-1">
                        Punto ciego
                      </p>
                      <p className="text-sm text-muted">{diag.blind_spot}</p>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Tu siguiente reto */}
          {diag && (
            <section className="bg-gradient-to-r from-violet/10 to-teal/10 border border-violet/20 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-5 h-5 text-teal" />
                <h3 className="font-syne text-lg font-bold">Tu siguiente reto</h3>
              </div>
              <p className="text-sm text-muted mb-4">
                Según tu diagnóstico, te recomendamos practicar con{" "}
                <span className="text-white font-medium capitalize">
                  {diag.recommended_next_scenario}
                </span>{" "}
                en nivel{" "}
                <span className="text-white font-medium capitalize">
                  {diag.recommended_next_level}
                </span>
                .
              </p>
              <button
                onClick={startNextChallenge}
                className="btn-primary inline-flex items-center gap-2"
              >
                <Play className="w-4 h-4" />
                Iniciar siguiente reto
              </button>
            </section>
          )}

          {/* Historial */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-syne text-lg font-bold">Tu historial</h3>
              <span className="text-xs text-muted">
                {sessions.length} {sessions.length === 1 ? "sesión" : "sesiones"}
              </span>
            </div>

            {loadingSessions ? (
              <div className="bg-card/50 border border-white/5 rounded-xl p-6 text-center text-muted text-sm">
                Cargando…
              </div>
            ) : sessions.length === 0 ? (
              <div className="bg-card/50 border border-white/5 rounded-xl p-8 text-center">
                <p className="text-muted text-sm mb-4">
                  Aún no has practicado. Tu primera sesión aparecerá aquí.
                </p>
                <button
                  onClick={() => navigate("/")}
                  className="btn-secondary inline-flex items-center gap-2"
                >
                  <Play className="w-4 h-4" />
                  Empezar ahora
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {sessions.map((s) => (
                  <SessionRow key={s.session_id} session={s} />
                ))}
              </div>
            )}
          </section>
        </motion.div>
      </main>
    </div>
  );
}

function SessionRow({ session }: { session: PracticeSessionSummary }) {
  const date = new Date(session.created_at + "Z"); // SQLite escribe UTC sin zona
  const score = session.overall_score;
  const scoreColor =
    score == null
      ? "text-muted"
      : score >= 80
      ? "text-green-400"
      : score >= 60
      ? "text-yellow-400"
      : score >= 40
      ? "text-orange-400"
      : "text-red-400";

  const levelBadge = session.level
    ? session.level.charAt(0).toUpperCase() + session.level.slice(1)
    : null;

  const minutes = session.duration_seconds
    ? Math.round(session.duration_seconds / 60)
    : null;

  return (
    <div className="bg-card/50 border border-white/5 rounded-xl p-4 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium truncate">
            {AVATAR_LABELS[session.avatar_id] ?? session.avatar_id}
          </span>
          {levelBadge && (
            <span className="text-xs text-muted bg-white/5 px-2 py-0.5 rounded-full">
              {levelBadge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {date.toLocaleDateString("es-MX", {
              day: "numeric",
              month: "short",
            })}
          </span>
          {minutes != null && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {minutes} min
            </span>
          )}
          {session.total_exchanges != null && (
            <span className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              {session.total_exchanges} intercambios
            </span>
          )}
        </div>
      </div>
      <div className="text-right">
        <div className={`font-syne text-2xl font-bold ${scoreColor}`}>
          {score ?? "—"}
        </div>
        <div className="text-xs text-muted">score</div>
      </div>
    </div>
  );
}
