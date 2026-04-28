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
  Lightbulb
} from "lucide-react";
import { useSessionStore } from "../stores/sessionStore";
import type { ConversationAnalysis, SkillAnalysis, KeyMoment } from "../types";

export function Report() {
  const navigate = useNavigate();
  const { selectedAvatar, metrics, messages } = useSessionStore();
  const [showConversation, setShowConversation] = useState(false);
  const [animatedScore, setAnimatedScore] = useState(0);

  const analysis = metrics?.analysis as ConversationAnalysis | undefined;
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

  function getScoreColor(score: number) {
    if (score >= 80) return "text-green-400";
    if (score >= 60) return "text-yellow-400";
    if (score >= 40) return "text-orange-400";
    return "text-red-400";
  }

  function getScoreLabel(score: number) {
    if (score >= 80) return "Excelente";
    if (score >= 60) return "Competente";
    if (score >= 40) return "En desarrollo";
    return "Necesita trabajo";
  }

  function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
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
            <AlertTriangle className="w-12 h-12 text-yellow-400 mx-auto mb-4" />
            <h2 className="font-syne text-2xl font-bold mb-2">
              Sesion muy corta
            </h2>
            <p className="text-muted">
              {analysis?.overall_summary || "Necesitas mas interacciones para generar un analisis completo"}
            </p>
          </div>

          <div className="card text-center mb-8">
            <p className="text-muted mb-2">Intercambios realizados</p>
            <p className="font-syne text-4xl font-bold text-violet-light">
              {metrics?.total_exchanges || 0}
            </p>
            <p className="text-sm text-muted mt-2">
              Recomendamos al menos 4-5 intercambios para un buen analisis
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
                Analisis de Sesion
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
                <div className={`font-syne text-6xl font-bold ${getScoreColor(score)}`}>
                  {animatedScore}
                </div>
                <div className="text-sm text-muted mt-1">{getScoreLabel(score)}</div>
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
              Habilidades Evaluadas
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
            <div className="card border-l-4 border-l-green-500">
              <h3 className="font-syne font-bold mb-4 flex items-center gap-2 text-green-400">
                <TrendingUp className="w-5 h-5" />
                Fortalezas
              </h3>
              <ul className="space-y-2">
                {analysis.strengths.map((strength, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                    <span className="text-muted">{strength}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Areas de mejora */}
            <div className="card border-l-4 border-l-orange-500">
              <h3 className="font-syne font-bold mb-4 flex items-center gap-2 text-orange-400">
                <AlertTriangle className="w-5 h-5" />
                Areas de Mejora
              </h3>
              <ul className="space-y-2">
                {analysis.improvements.map((improvement, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Minus className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
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
                <Trophy className="w-5 h-5 text-yellow-400" />
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
              Proximos Pasos
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
              <h3 className="font-syne font-bold">Conversacion Completa</h3>
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
                {messages.map((msg, i) => (
                  <div key={i} className="text-sm">
                    <span className={msg.role === "user" ? "text-violet-light font-medium" : "text-teal font-medium"}>
                      {msg.role === "user" ? "Tu: " : `${selectedAvatar?.name}: `}
                    </span>
                    <span className="text-muted">{msg.content}</span>
                  </div>
                ))}
              </motion.div>
            )}
          </div>

          {/* Actions */}
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

  function getScoreColor(score: number) {
    if (score >= 80) return "bg-green-500";
    if (score >= 60) return "bg-yellow-500";
    if (score >= 40) return "bg-orange-500";
    return "bg-red-500";
  }

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
            <span className={`text-sm font-bold ${
              skill.score >= 80 ? "text-green-400" :
              skill.score >= 60 ? "text-yellow-400" :
              skill.score >= 40 ? "text-orange-400" : "text-red-400"
            }`}>
              {skill.score}
            </span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${skill.score}%` }}
              transition={{ delay: 0.3 + 0.1 * index, duration: 0.5 }}
              className={`h-full rounded-full ${getScoreColor(skill.score)}`}
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
                <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3">
                  <p className="text-xs text-green-400 font-bold uppercase mb-2">
                    Lo que mostraste
                  </p>
                  <ul className="space-y-1.5">
                    {skill.indicators_met.map((ind, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                        <span className="text-muted">{ind}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {skill.indicators_missed && skill.indicators_missed.length > 0 && (
                <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-3">
                  <p className="text-xs text-orange-400 font-bold uppercase mb-2">
                    Lo que faltó
                  </p>
                  <ul className="space-y-1.5">
                    {skill.indicators_missed.map((ind, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <XCircle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
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
    <CheckCircle className="w-5 h-5 text-green-400" />
  ) : moment.type === "negative" ? (
    <XCircle className="w-5 h-5 text-red-400" />
  ) : (
    <Minus className="w-5 h-5 text-yellow-400" />
  );

  const borderColor = moment.type === "positive"
    ? "border-l-green-500"
    : moment.type === "negative"
    ? "border-l-red-500"
    : "border-l-yellow-500";

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
