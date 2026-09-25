import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Home,
  RotateCcw,
  Trophy,
  Target,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Minus,
  Clock,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  BarChart3,
} from "lucide-react";
import { useSessionStore } from "../stores/sessionStore";
import { scoreTone } from "../lib/score";
import type { ConversationAnalysis, SkillAnalysis, KeyMoment } from "../types";

export function Report() {
  const navigate = useNavigate();
  const { selectedAvatar, metrics, messages } = useSessionStore();
  const [showConversation, setShowConversation] = useState(false);
  const [animatedScore, setAnimatedScore] = useState(0);

  const analysis = metrics?.analysis as ConversationAnalysis | undefined;
  // Al abrir una sesion del historial, la conversacion viene en metrics; la del
  // store es la de la llamada en curso.
  const conversation = metrics?.conversation?.length ? metrics.conversation : messages;
  const score = analysis?.overall_score ?? 0;

  // Animar score
  useEffect(() => {
    if (score > 0) {
      const duration = 1500;
      const steps = 60;
      const increment = score / steps;
      let current = 0;

      const timer = setInterval(() => {
        current += increment;
        if (current >= score) {
          setAnimatedScore(score);
          clearInterval(timer);
        } else {
          setAnimatedScore(Math.floor(current));
        }
      }, duration / steps);

      return () => clearInterval(timer);
    }
  }, [score]);

  function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  // El analisis no llego a tiempo (Simulation espero 30 s). No es culpa del
  // usuario: el servidor lo termina y lo guarda igual, y aparece en Mi plan.
  if (!analysis && metrics?.is_fallback) {
    return (
      <div className="min-h-screen bg-ink">
        <header className="border-b border-white/5 px-8 py-6">
          <h1 className="font-syne text-2xl font-bold bg-gradient-to-r from-violet-light to-teal bg-clip-text text-transparent">
            Mente Viva
          </h1>
        </header>
        <main className="max-w-xl mx-auto px-6 py-16 text-center">
          <Clock className="w-12 h-12 text-violet-light mx-auto mb-4" />
          <h2 className="font-syne text-2xl font-bold mb-3">
            Tu reporte está tardando más de lo normal
          </h2>
          <p className="text-muted mb-8">
            La sesión quedó registrada ({metrics.total_exchanges}{" "}
            {metrics.total_exchanges === 1 ? "intercambio" : "intercambios"}). El análisis sigue en proceso
            y tu puntaje aparecerá en el historial de Mi plan en cuanto termine, normalmente en menos de un minuto.
          </p>
          <div className="flex gap-4 justify-center">
            <button onClick={() => navigate("/")} className="btn-secondary flex items-center gap-2">
              <Home className="w-5 h-5" />
              Inicio
            </button>
            <button onClick={() => navigate("/mi-plan")} className="btn-primary flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Ir a Mi plan
            </button>
          </div>
        </main>
      </div>
    );
  }

  // Si no hay analisis, mostrar version simple
  if (!analysis || analysis.error) {
    return (
      <div className="min-h-screen bg-ink">
        <header className="border-b border-white/5 px-8 py-6">
          <h1 className="font-syne text-2xl font-bold bg-gradient-to-r from-violet-light to-teal bg-clip-text text-transparent">
            Mente Viva
          </h1>
        </header>

        <main className="max-w-3xl mx-auto px-8 py-12">
          <div className="text-center mb-10">
            <AlertTriangle className="w-12 h-12 text-warning mx-auto mb-4" />
            <h2 className="font-syne text-2xl font-bold mb-2">
              Sesión muy corta
            </h2>
            <p className="text-muted">
              {analysis?.overall_summary || "Necesitas más interacciones para generar un análisis completo"}
            </p>
          </div>

          <div className="card text-center mb-8">
            <p className="text-muted mb-2">Intercambios realizados</p>
            <p className="font-syne text-4xl font-bold text-violet-light">
              {metrics?.total_exchanges || 0}
            </p>
            <p className="text-sm text-muted mt-2">
              Recomendamos al menos 4-5 intercambios para un buen análisis
            </p>
          </div>

          <div className="flex gap-4 justify-center">
            <button
              onClick={() => navigate("/")}
              className="btn-secondary flex items-center gap-2"
            >
              <Home className="w-5 h-5" />
              Inicio
            </button>
            <button
              onClick={() => navigate("/briefing")}
              className="btn-primary flex items-center gap-2"
            >
              <RotateCcw className="w-5 h-5" />
              Intentar de nuevo
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink">
      {/* Header */}
      <header className="border-b border-white/5 px-8 py-6">
        <h1 className="font-syne text-2xl font-bold bg-gradient-to-r from-violet-light to-teal bg-clip-text text-transparent">
          Mente Viva
        </h1>
      </header>

      <main className="max-w-4xl mx-auto px-8 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {/* Header del reporte */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="font-syne text-2xl font-bold mb-1">
                Análisis de sesión
              </h2>
              <p className="text-muted">
                {analysis.scenario_type} con {selectedAvatar?.name}
              </p>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted">
              <span className="flex items-center gap-1">
                <MessageSquare className="w-4 h-4" />
                {metrics?.total_exchanges} intercambios
              </span>
              {metrics?.duration_seconds && (
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  {formatDuration(metrics.duration_seconds)}
                </span>
              )}
            </div>
          </div>

          {/* Score Principal */}
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="card mb-8"
          >
            <div className="flex items-center gap-8">
              <div className="text-center">
                <div className={`font-syne text-6xl font-bold ${scoreTone(score).text}`}>
                  {animatedScore}
                </div>
                <div className="text-sm text-muted mt-1">{scoreTone(score).label}</div>
              </div>
              <div className="flex-1">
                <p className="text-lg mb-2">{analysis.overall_summary}</p>
              </div>
            </div>
          </motion.div>

          {/* Skills Grid */}
          <div className="mb-8">
            <h3 className="font-syne font-bold text-lg mb-4 flex items-center gap-2">
              <Target className="w-5 h-5 text-violet-light" />
              Habilidades evaluadas
            </h3>
            <div className="grid gap-4">
              {analysis.skills.map((skill, index) => (
                <SkillCard key={skill.id} skill={skill} index={index} />
              ))}
            </div>
          </div>

          {/* Strengths & Improvements */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {/* Fortalezas */}
            <div className="card border-l-4 border-l-success">
              <h3 className="font-syne font-bold mb-4 flex items-center gap-2 text-success">
                <TrendingUp className="w-5 h-5" />
                Fortalezas
              </h3>
              <ul className="space-y-2">
                {analysis.strengths.map((strength, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                    <span className="text-muted">{strength}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Areas de mejora */}
            <div className="card border-l-4 border-l-warning">
              <h3 className="font-syne font-bold mb-4 flex items-center gap-2 text-warning">
                <AlertTriangle className="w-5 h-5" />
                Áreas de mejora
              </h3>
              <ul className="space-y-2">
                {analysis.improvements.map((improvement, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Minus className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                    <span className="text-muted">{improvement}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Key Moments */}
          {analysis.key_moments.length > 0 && (
            <div className="mb-8">
              <h3 className="font-syne font-bold text-lg mb-4 flex items-center gap-2">
                <Trophy className="w-5 h-5 text-warning" />
                Momentos Clave
              </h3>
              <div className="space-y-3">
                {analysis.key_moments.map((moment, i) => (
                  <KeyMomentCard key={i} moment={moment} />
                ))}
              </div>
            </div>
          )}

          {/* Next Steps */}
          <div className="card bg-gradient-to-r from-violet/10 to-teal/10 border-violet/20 mb-8">
            <h3 className="font-syne font-bold mb-4 flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-teal" />
              Próximos pasos
            </h3>
            <ul className="space-y-2">
              {analysis.next_steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-teal font-bold">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Conversation Toggle */}
          <div className="card mb-8">
            <button
              onClick={() => setShowConversation(!showConversation)}
              className="w-full flex items-center justify-between"
            >
              <h3 className="font-syne font-bold">Conversación completa</h3>
              {showConversation ? (
                <ChevronUp className="w-5 h-5 text-muted" />
              ) : (
                <ChevronDown className="w-5 h-5 text-muted" />
              )}
            </button>
            {showConversation && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                className="mt-4 pt-4 border-t border-white/10 space-y-3 max-h-96 overflow-y-auto"
              >
                {conversation.map((msg, i) => (
                  <div key={i} className="text-sm">
                    <span className={msg.role === "user" ? "text-violet-light font-medium" : "text-teal font-medium"}>
                      {msg.role === "user" ? "Tú: " : `${selectedAvatar?.name}: `}
                    </span>
                    <span className="text-muted">{msg.content}</span>
                  </div>
                ))}
              </motion.div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-4 justify-center">
            <button
              onClick={() => navigate("/")}
              className="btn-secondary flex items-center gap-2"
            >
              <Home className="w-5 h-5" />
              Inicio
            </button>
            <button
              onClick={() => navigate("/mi-plan")}
              className="btn-secondary flex items-center gap-2"
            >
              <BarChart3 className="w-5 h-5" />
              Mi plan
            </button>
            <button
              onClick={() => navigate("/briefing")}
              className="btn-primary flex items-center gap-2"
            >
              <RotateCcw className="w-5 h-5" />
              Practicar de nuevo
            </button>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

// Componente para cada habilidad / KPI
function SkillCard({ skill, index }: { skill: SkillAnalysis; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasIndicators =
    (skill.indicators_met && skill.indicators_met.length > 0) ||
    (skill.indicators_missed && skill.indicators_missed.length > 0);

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.1 * index }}
      className="card"
    >
      <div
        className="flex items-center gap-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">{skill.name}</span>
              {skill.weight ? (
                <span className="text-xs text-muted bg-white/5 px-2 py-0.5 rounded-full">
                  peso {skill.weight}%
                </span>
              ) : null}
            </div>
            <span className={`text-sm font-bold ${scoreTone(skill.score).text}`}>
              {skill.score}
            </span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${skill.score}%` }}
              transition={{ delay: 0.3 + 0.1 * index, duration: 0.5 }}
              className={`h-full rounded-full ${scoreTone(skill.score).bg}`}
            />
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-muted" />
        ) : (
          <ChevronDown className="w-5 h-5 text-muted" />
        )}
      </div>

      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          className="mt-4 pt-4 border-t border-white/10"
        >
          <p className="text-sm text-muted mb-3">{skill.feedback}</p>

          {hasIndicators && (
            <div className="grid sm:grid-cols-2 gap-3 mb-3">
              {skill.indicators_met && skill.indicators_met.length > 0 && (
                <div className="bg-success/5 border border-success/20 rounded-lg p-3">
                  <p className="text-xs text-success font-bold uppercase mb-2">
                    Lo que mostraste
                  </p>
                  <ul className="space-y-1.5">
                    {skill.indicators_met.map((ind, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                        <span className="text-muted">{ind}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {skill.indicators_missed && skill.indicators_missed.length > 0 && (
                <div className="bg-warning/5 border border-warning/20 rounded-lg p-3">
                  <p className="text-xs text-warning font-bold uppercase mb-2">
                    Lo que faltó
                  </p>
                  <ul className="space-y-1.5">
                    {skill.indicators_missed.map((ind, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <XCircle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                        <span className="text-muted">{ind}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {skill.moment && (
            <div className="bg-white/5 rounded-lg p-3">
              <p className="text-xs text-muted mb-1">Ejemplo de la conversacion:</p>
              <p className="text-sm italic">"{skill.moment}"</p>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

// Componente para momentos clave
function KeyMomentCard({ moment }: { moment: KeyMoment }) {
  const icon = moment.type === "positive" ? (
    <CheckCircle className="w-5 h-5 text-success" />
  ) : moment.type === "negative" ? (
    <XCircle className="w-5 h-5 text-danger" />
  ) : (
    <Minus className="w-5 h-5 text-warning" />
  );

  const borderColor = moment.type === "positive"
    ? "border-l-success"
    : moment.type === "negative"
    ? "border-l-danger"
    : "border-l-warning";

  return (
    <div className={`card border-l-4 ${borderColor}`}>
      <div className="flex items-start gap-3">
        {icon}
        <div>
          <p className="text-sm italic mb-2">"{moment.quote}"</p>
          <p className="text-xs text-muted">{moment.analysis}</p>
        </div>
      </div>
    </div>
  );
}
