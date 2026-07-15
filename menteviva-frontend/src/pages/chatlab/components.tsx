/**
 * Componentes presentacionales compartidos entre ChatLab (texto) y VoiceLab (voz).
 *
 * Extraidos de ChatLab.tsx sin cambios visuales. Los modales reciben por PROPS
 * el estado y los handlers que antes tomaban del closure del componente, para
 * que ambas paginas los reusen sin duplicar ~300 lineas de JSX.
 */
import { useState } from "react";
import { Star, ThumbsDown } from "lucide-react";
import type { Diagnostico, SaveInfo, SatisfactionInfo } from "./types";
import { freqBadge } from "./helpers";

// Placeholder animado para la telemetria mientras no hay datos reales.
export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`inline-block rounded bg-white/10 animate-pulse ${className}`} />;
}

// Seccion colapsable para agrupar controles TECNICOS. Colapsada por defecto.
export function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-xs font-syne font-semibold text-muted uppercase tracking-wider hover:text-cream transition-colors group"
      >
        <span className="flex items-center gap-2">{title}</span>
        <span className={`text-[10px] text-subtle transition-transform group-hover:text-cream ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && <div className="space-y-3">{children}</div>}
    </div>
  );
}

// ============================================================
// Modal: Diagnóstico generado
// ============================================================
export function DiagnosticoModal({
  diagnostico,
  saveInfo,
  satisfaction,
  nombre,
  onClose,
  onOpenSatisfaction,
}: {
  diagnostico: Diagnostico;
  saveInfo?: SaveInfo | null;
  satisfaction?: SatisfactionInfo | null;
  nombre?: string;
  onClose: () => void;
  onOpenSatisfaction: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-deep border border-white/10 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-deep/95 backdrop-blur-md border-b border-white/5 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔬</span>
            <h2 className="font-syne font-bold text-cream text-sm">Diagnóstico de Habilidades Blandas</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-muted hover:text-cream flex items-center justify-center transition-all"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 text-sm">
          {saveInfo && (
            saveInfo.saved ? (
              <div className="p-2.5 bg-success/10 border border-success/20 rounded-xl text-[11px] text-success leading-normal">
                ✓ Guardado en la base de datos{saveInfo.id != null ? ` (diagnostic_id=${saveInfo.id})` : ""}.
              </div>
            ) : (
              <div className="p-2.5 bg-danger/10 border border-danger/20 rounded-xl text-[11px] text-danger leading-normal">
                ⚠️ No se pudo guardar en BD: {saveInfo.error || "error desconocido"}. El diagnóstico se generó igual.
              </div>
            )
          )}
          {diagnostico.is_demo && (
            <div className="p-3 bg-warning/10 border border-warning/20 rounded-xl text-[11px] text-warning leading-normal">
              ⚠️ Sesión corta o poco concluyente: este diagnóstico es preliminar (placeholder o material insuficiente). Para un análisis real, junta 4+ intercambios con historias concretas.
            </div>
          )}

          {/* Hero visual: nombre + chips de foco + tiles de conteo */}
          <div className="rounded-2xl bg-gradient-to-br from-teal/10 to-violet/10 border border-white/10 p-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-teal/20 border border-teal/30 flex items-center justify-center text-lg shadow-inner">🧑‍💼</div>
              <div className="min-w-0">
                <div className="font-syne font-bold text-cream text-sm truncate">
                  {nombre ? `Diagnóstico de ${nombre}` : "Tu diagnóstico"}
                </div>
                <div className="text-[10px] text-muted font-mono">Un espejo conductual basado en evidencia, no un juicio.</div>
              </div>
            </div>
            {diagnostico.competencias_foco?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {diagnostico.competencias_foco.map((c, i) => (
                  <span key={i} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/5 text-teal border border-teal/20">
                    {c}
                  </span>
                ))}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-success/10 border border-success/20 p-2 text-center">
                <div className="text-xl font-syne font-bold text-success leading-none">{diagnostico.strengths?.length || 0}</div>
                <div className="text-[9px] text-muted uppercase tracking-wider mt-1">Fortalezas</div>
              </div>
              <div className="rounded-xl bg-warning/10 border border-warning/20 p-2 text-center">
                <div className="text-xl font-syne font-bold text-warning leading-none">{diagnostico.gaps?.length || 0}</div>
                <div className="text-[9px] text-muted uppercase tracking-wider mt-1">A mejorar</div>
              </div>
              <div className="rounded-xl bg-violet/10 border border-violet/20 p-2 text-center">
                <div className="text-xl font-syne font-bold text-violet-lighter leading-none">{diagnostico.competencias_foco?.length || 0}</div>
                <div className="text-[9px] text-muted uppercase tracking-wider mt-1">Competencias</div>
              </div>
            </div>
          </div>

          {/* Resumen ejecutivo */}
          {diagnostico.resumen_ejecutivo && (
            <div className="space-y-1.5">
              <h3 className="text-[11px] font-syne font-bold text-teal uppercase tracking-wider flex items-center gap-1.5">📋 Resumen ejecutivo</h3>
              <p className="text-cream/90 leading-relaxed italic border-l-2 border-teal/40 pl-3">{diagnostico.resumen_ejecutivo}</p>
            </div>
          )}

          {/* Fortalezas */}
          {diagnostico.strengths?.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[11px] font-syne font-bold text-success uppercase tracking-wider flex items-center gap-1.5">✅ Fortalezas</h3>
              {diagnostico.strengths.map((s, i) => (
                <div key={i} className="relative p-3 pl-4 bg-success/5 border border-success/15 rounded-xl space-y-1.5 overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-success/60" />
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-success/20 text-success text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                    <div className="font-semibold text-cream text-xs">{s.skill}</div>
                  </div>
                  <div className="text-muted text-xs leading-relaxed italic">“{s.evidence}”</div>
                  <div className="text-subtle text-[11px] leading-relaxed">{s.why_matters}</div>
                </div>
              ))}
            </div>
          )}

          {/* Áreas de oportunidad */}
          {diagnostico.gaps?.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-[11px] font-syne font-bold text-warning uppercase tracking-wider flex items-center gap-1.5">🚀 Áreas de oportunidad</h3>
              {diagnostico.gaps.map((g, i) => (
                <div key={i} className="relative p-3 pl-4 bg-warning/5 border border-warning/15 rounded-xl space-y-1.5 overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-warning/60" />
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-warning/20 text-warning text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                    <div className="font-semibold text-cream text-xs">{g.skill}</div>
                  </div>
                  <div className="text-muted text-xs leading-relaxed italic">“{g.evidence}”</div>
                  <div className="text-subtle text-[11px] leading-relaxed">Impacto: {g.impact}</div>
                  <div className="flex items-start gap-1.5 text-[11px] text-teal leading-relaxed bg-teal/5 border border-teal/15 rounded-lg px-2 py-1.5 mt-1">
                    <span className="shrink-0">🎯</span>
                    <span><span className="font-semibold">Micro-práctica:</span> {g.micro_practice}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Blind spot */}
          {diagnostico.blind_spot && (
            <div className="rounded-xl bg-violet/5 border border-violet/20 p-3 space-y-1.5">
              <h3 className="text-[11px] font-syne font-bold text-violet-lighter uppercase tracking-wider flex items-center gap-1.5">🧭 Punto ciego</h3>
              <p className="text-cream/90 leading-relaxed">{diagnostico.blind_spot}</p>
            </div>
          )}

          {/* Pregunta para llevarse */}
          {diagnostico.reflection_question && (
            <div className="p-4 bg-gradient-to-br from-violet/15 to-violet/5 border border-violet/25 rounded-xl">
              <div className="text-[10px] font-syne font-bold text-violet-lighter uppercase tracking-wider mb-1">💭 Pregunta para llevarte</div>
              <p className="text-cream/90 leading-relaxed italic">{diagnostico.reflection_question}</p>
            </div>
          )}

          {/* Nota final del coach */}
          {diagnostico.coach_note && (
            <div className="relative p-4 pl-5 bg-teal/5 border border-teal/20 rounded-xl overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-teal/60" />
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-6 h-6 rounded-full bg-teal/20 border border-teal/30 flex items-center justify-center text-xs shrink-0">💛</span>
                <div className="text-[10px] font-syne font-bold text-teal uppercase tracking-wider">Una nota de tu coach</div>
              </div>
              <p className="text-cream/90 leading-relaxed">{diagnostico.coach_note}</p>
            </div>
          )}

          {/* Patrones verbales (chips semáforo) */}
          <div className="border-t border-white/5 pt-4 space-y-2.5">
            <h3 className="text-[11px] font-syne font-bold text-muted uppercase tracking-wider">Patrones verbales</h3>
            <div className="flex flex-wrap gap-2">
              {(() => {
                const filler = freqBadge(diagnostico.verbal_patterns?.filler_frequency);
                return (
                  <span className={`text-[10px] font-mono px-2.5 py-1 rounded-lg border ${filler.cls}`}>
                    Muletillas: {filler.label}
                  </span>
                );
              })()}
              <span className="text-[10px] font-mono px-2.5 py-1 rounded-lg border bg-white/5 text-muted border-white/10">
                Nosotros/yo: {diagnostico.verbal_patterns?.we_vs_i_tendency || "—"}
              </span>
            </div>
            {diagnostico.verbal_patterns?.vague_verbs_detected?.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-muted font-mono">Verbos vagos:</span>
                {diagnostico.verbal_patterns.vague_verbs_detected.map((vb, i) => (
                  <span key={i} className="text-[10px] font-mono px-2 py-0.5 rounded bg-danger/10 text-danger/90 border border-danger/20">
                    {vb}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Siguiente práctica sugerida */}
          {diagnostico.recommended_next_scenario && (
            <div className="flex items-center gap-2.5 rounded-xl bg-ink/60 border border-white/10 p-3">
              <span className="text-lg">🧗</span>
              <div className="text-xs">
                <div className="text-[10px] text-muted uppercase tracking-wider font-mono">Siguiente práctica sugerida</div>
                <div className="text-cream font-medium">
                  {diagnostico.recommended_next_scenario} · nivel {diagnostico.recommended_next_level}
                </div>
              </div>
            </div>
          )}

          {/* Encuesta de satisfacción (CTA dentro del diagnóstico) */}
          <div className="border-t border-white/5 pt-4">
            {satisfaction ? (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-teal/5 border border-teal/20 p-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex items-center gap-0.5 shrink-0">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star
                        key={n}
                        className={`w-3.5 h-3.5 ${n <= satisfaction.rating ? "text-warning fill-warning" : "text-white/15"}`}
                      />
                    ))}
                  </div>
                  <span className="text-[11px] text-muted truncate">
                    {satisfaction.comment ? `“${satisfaction.comment}”` : "¡Gracias por tu opinión!"}
                  </span>
                </div>
                <button
                  onClick={onOpenSatisfaction}
                  className="shrink-0 text-[11px] font-syne text-teal hover:text-cream underline decoration-dotted"
                >
                  Editar
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-gradient-to-br from-violet/10 to-teal/10 border border-white/10 p-3">
                <div className="min-w-0">
                  <div className="text-xs font-syne font-bold text-cream">¿Qué te pareció tu diagnóstico?</div>
                  <div className="text-[10px] text-muted">Tu opinión nos ayuda a mejorar.</div>
                </div>
                <button
                  onClick={onOpenSatisfaction}
                  className="shrink-0 flex items-center gap-1.5 text-xs font-syne font-bold bg-violet text-white hover:bg-violet-light px-3 py-2 rounded-xl transition-all active:scale-95"
                >
                  <Star className="w-3.5 h-3.5" /> Calificar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Modal: ¿Por qué no te gustó? (comentario del dislike)
// ============================================================
export function FeedbackModal({
  draft,
  setDraft,
  hasExistingComment,
  onClear,
  onCancel,
  onSave,
}: {
  draft: string;
  setDraft: (s: string) => void;
  hasExistingComment: boolean;
  onClear: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/80 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-deep border border-white/10 rounded-2xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h3 className="font-syne font-bold text-cream text-base flex items-center gap-2">
                <ThumbsDown className="w-4 h-4 text-danger" /> ¿Por qué no te gustó?
              </h3>
              <p className="text-xs text-muted leading-relaxed">
                Cuéntanos qué falló en esta respuesta. Es opcional, pero nos sirve muchísimo para afinar el prompt.
              </p>
            </div>
            <button
              onClick={onCancel}
              className="w-7 h-7 shrink-0 rounded-lg bg-white/5 hover:bg-white/10 text-muted hover:text-cream flex items-center justify-center transition-all"
            >
              ✕
            </button>
          </div>

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            rows={4}
            placeholder="Ej. Repitió una pregunta anterior / sonó robótico / no entendió el contexto…"
            className="w-full bg-ink border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-cream placeholder-subtle focus:outline-none focus:border-danger/50 focus:ring-1 focus:ring-danger/30 resize-none leading-relaxed"
          />

          <div className="flex items-center justify-end gap-2">
            {hasExistingComment && (
              <button
                onClick={onClear}
                className="text-[11px] font-syne text-muted hover:text-danger px-2 py-1 rounded-lg transition-all mr-auto"
                title="Borrar el texto"
              >
                Limpiar
              </button>
            )}
            <button
              onClick={onCancel}
              className="text-xs font-syne text-muted hover:text-cream px-3 py-2 rounded-xl border border-white/10 hover:bg-white/5 transition-all"
            >
              Cancelar
            </button>
            <button
              onClick={onSave}
              className="text-xs font-syne font-bold bg-violet text-white hover:bg-violet-light px-4 py-2 rounded-xl transition-all active:scale-95"
            >
              Guardar comentario
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Modal: Satisfacción del diagnóstico (estrellas + comentario opcional)
// ============================================================
export function SatisfactionModal({
  rating,
  hover,
  comment,
  setRating,
  setHover,
  setComment,
  onClose,
  onSubmit,
}: {
  rating: number;
  hover: number;
  comment: string;
  setRating: (n: number) => void;
  setHover: (n: number) => void;
  setComment: (s: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-deep border border-white/10 rounded-2xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-5">
          <div className="text-center space-y-1.5">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-warning/15 border border-warning/25 flex items-center justify-center text-2xl shadow-inner">
              ⭐
            </div>
            <h3 className="font-syne font-bold text-cream text-base">¿Qué te pareció tu diagnóstico?</h3>
            <p className="text-xs text-muted leading-relaxed">
              Tu opinión nos ayuda a mejorar la experiencia. Queda registrada con tu conversación.
            </p>
          </div>

          {/* Estrellas */}
          <div className="flex items-center justify-center gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                className="p-1 transition-transform hover:scale-110 active:scale-95"
                title={`${n} de 5`}
              >
                <Star
                  className={`w-8 h-8 transition-colors ${
                    n <= (hover || rating) ? "text-warning fill-warning" : "text-white/15"
                  }`}
                />
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] text-muted font-mono">COMENTARIO (opcional)</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="¿Qué te gustó o qué mejorarías del diagnóstico?"
              className="w-full bg-ink border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-cream placeholder-subtle focus:outline-none focus:border-violet/50 focus:ring-1 focus:ring-violet/30 resize-none leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="text-xs font-syne text-muted hover:text-cream px-3 py-2 rounded-xl border border-white/10 hover:bg-white/5 transition-all"
            >
              Ahora no
            </button>
            <button
              onClick={onSubmit}
              disabled={rating < 1}
              className="text-xs font-syne font-bold bg-violet text-white hover:bg-violet-light disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-xl transition-all active:scale-95"
            >
              Enviar opinión
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
