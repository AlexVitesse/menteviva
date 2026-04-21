import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Target, Lightbulb } from "lucide-react";

import { useSessionStore } from "../stores/sessionStore";

export function DiagnosticoPerfil() {
  const navigate = useNavigate();
  const { userProfile } = useSessionStore();

  if (!userProfile?.diagnostico) {
    navigate("/diagnostico/setup", { replace: true });
    return null;
  }

  const d = userProfile.diagnostico;
  const nombre = userProfile.registro.nombre.split(" ")[0];

  return (
    <div className="min-h-screen bg-ink text-cream py-10 px-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-3xl mx-auto space-y-6"
      >
        <header>
          <p className="text-teal text-sm font-bold uppercase tracking-wider mb-1">
            Diagnostico completado
          </p>
          <h1 className="font-syne text-4xl font-bold mb-2">
            Esto es lo que observe, {nombre}.
          </h1>
          <p className="text-muted">
            No es una evaluacion de empleabilidad. Es un espejo para que decidas
            que trabajar.
          </p>
        </header>

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

        <div className="bg-violet/10 border border-violet/30 rounded-2xl p-6">
          <p className="text-sm text-muted mb-1">Sugerencia para tu primera practica</p>
          <p className="font-syne text-xl font-bold mb-4">
            Empieza con{" "}
            <span className="text-violet-lighter capitalize">{d.recommended_next_scenario}</span>
            {" "}en nivel{" "}
            <span className="text-violet-lighter">{d.recommended_next_level}</span>
          </p>
          <button
            onClick={() => navigate("/")}
            className="w-full font-syne font-bold text-sm py-3 rounded-[10px] bg-violet text-white hover:bg-violet-light transition-colors"
          >
            Continuar al dashboard
          </button>
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
