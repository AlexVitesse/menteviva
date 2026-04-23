import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  Lightbulb,
  RotateCcw,
  Share2,
  Target,
} from "lucide-react";

import { useSessionStore } from "../stores/sessionStore";
import { downloadMarkdown, shareDiagnostico } from "../utils/exportDiagnostico";

export function DiagnosticoPerfil() {
  const navigate = useNavigate();
  const { userProfile, clearDiagnostico } = useSessionStore();
  const [shareToast, setShareToast] = useState<string | null>(null);

  if (!userProfile?.diagnostico) {
    navigate("/diagnostico/setup", { replace: true });
    return null;
  }

  const d = userProfile.diagnostico;
  const nombre = userProfile.registro.nombre.split(" ")[0];
  const isDemo = d.is_demo === true;

  function handleDownload() {
    if (!userProfile) return;
    downloadMarkdown(userProfile);
  }

  async function handleShare() {
    if (!userProfile) return;
    const result = await shareDiagnostico(userProfile, window.location.origin);
    if (result === "shared") setShareToast("Compartido");
    else if (result === "copied") setShareToast("Copiado al portapapeles");
    else setShareToast("No se pudo compartir");
    setTimeout(() => setShareToast(null), 2500);
  }

  function handleRedo() {
    if (!confirm("Esto borra tu diagnostico actual y empiezas una nueva entrevista. ¿Continuar?")) return;
    clearDiagnostico();
    navigate("/diagnostico/setup");
  }

  return (
    <div className="min-h-screen bg-ink text-cream py-10 px-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-3xl mx-auto space-y-6"
      >
        <header>
          <p className="text-teal text-sm font-bold uppercase tracking-wider mb-1">
            Diagnostico {isDemo ? "preliminar" : "completado"}
          </p>
          <h1 className="font-syne text-4xl font-bold mb-2">
            Esto es lo que observe, {nombre}.
          </h1>
          <p className="text-muted">
            No es una evaluacion de empleabilidad. Es un espejo para que decidas
            que trabajar.
          </p>
        </header>

        {isDemo && (
          <div className="bg-warning/10 border border-warning/40 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-syne font-bold text-warning mb-1">
                Esta sesion fue muy corta
              </p>
              <p className="text-sm text-cream mb-3">
                Para un diagnostico real necesitamos al menos 4 a 5
                intercambios donde puedas contar historias concretas. Lo de
                abajo es un punto de partida, no un analisis profundo.
              </p>
              <button
                onClick={() => navigate("/diagnostico/setup")}
                className="flex items-center gap-2 text-sm font-syne font-bold text-warning hover:text-cream transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Volver a hacer el diagnostico
              </button>
            </div>
          </div>
        )}

        {d.strengths.length > 0 && (
          <Section icon={<CheckCircle2 className="w-5 h-5 text-success" />} title="Fortalezas">
            <ul className="space-y-4">
              {d.strengths.map((s, i) => (
                <li key={i} className="bg-card/50 rounded-xl p-4 border border-white/5">
                  <p className="font-syne font-bold text-success mb-1">{s.skill}</p>
                  <p className="text-sm italic text-muted mb-2">"{s.evidence}"</p>
                  <p className="text-sm">{s.why_matters}</p>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {d.gaps.length > 0 && (
          <Section icon={<AlertCircle className="w-5 h-5 text-warning" />} title="Areas de oportunidad">
            <ul className="space-y-4">
              {d.gaps.map((g, i) => (
                <li key={i} className="bg-card/50 rounded-xl p-4 border border-white/5">
                  <p className="font-syne font-bold text-warning mb-1">{g.skill}</p>
                  <p className="text-sm italic text-muted mb-2">"{g.evidence}"</p>
                  <p className="text-sm mb-3">{g.impact}</p>
                  <div className="bg-violet/10 border border-violet/30 rounded-lg p-3">
                    <p className="text-xs text-violet-lighter font-bold uppercase mb-1">
                      Micro-practica esta semana
                    </p>
                    <p className="text-sm">{g.micro_practice}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {d.blind_spot && (
          <Section icon={<Target className="w-5 h-5 text-violet-light" />} title="Punto ciego">
            <p className="text-sm leading-relaxed bg-card/50 rounded-xl p-4 border border-white/5">
              {d.blind_spot}
            </p>
          </Section>
        )}

        {d.reflection_question && (
          <Section icon={<Lightbulb className="w-5 h-5 text-teal" />} title="Pregunta para llevarte">
            <p className="text-lg font-syne italic bg-card/50 rounded-xl p-4 border border-white/5">
              {d.reflection_question}
            </p>
          </Section>
        )}

        <div className="pt-4 space-y-3">
          <button
            onClick={() => navigate("/diagnostico/recomendacion")}
            className="w-full flex items-center justify-center gap-3 font-syne font-bold text-sm py-3 rounded-[10px] bg-violet text-white hover:bg-violet-light transition-colors"
          >
            Siguiente
            <ArrowRight className="w-4 h-4" />
          </button>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={handleDownload}
              className="flex flex-col items-center gap-1 py-3 rounded-lg border border-white/10 text-muted hover:text-cream hover:border-white/30 transition-colors text-xs"
            >
              <Download className="w-4 h-4" />
              Descargar
            </button>
            <button
              onClick={handleShare}
              className="flex flex-col items-center gap-1 py-3 rounded-lg border border-white/10 text-muted hover:text-cream hover:border-white/30 transition-colors text-xs"
            >
              <Share2 className="w-4 h-4" />
              Compartir
            </button>
            <button
              onClick={handleRedo}
              className="flex flex-col items-center gap-1 py-3 rounded-lg border border-white/10 text-muted hover:text-cream hover:border-white/30 transition-colors text-xs"
            >
              <RotateCcw className="w-4 h-4" />
              Rehacer
            </button>
          </div>
          {shareToast && (
            <p className="text-center text-xs text-teal animate-pulse">{shareToast}</p>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h2 className="font-syne text-xl font-bold">{title}</h2>
      </div>
      {children}
    </section>
  );
}
