/**
 * ChatLab — banco de pruebas de PROMPTS, solo texto.
 *
 * Pantalla minima y aislada para evaluar como responde cada avatar con su
 * system_prompt actual, sin audio, avatar 3D, analisis ni base de datos.
 * Le pega al endpoint REST /api/chat (router chat_text.py). No tiene guard de
 * onboarding: se entra directo a /chat-lab.
 *
 * No forma parte del flujo de producto; es una herramienta de iteracion.
 */
import { useEffect, useRef, useState } from "react";
import { Send, RotateCcw, ThumbsUp, ThumbsDown } from "lucide-react";
import { apiFetch } from "../lib/api";

interface AvatarInfo {
  id: string;
  name: string;
  role?: string;
  kind?: string; // "diagnostico" (Sofia) | "practica"
  supports_levels?: boolean;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  latencyMs?: number; // solo en mensajes del avatar
  feedback?: "like" | "dislike" | null; // valoración manual de la respuesta del avatar
  // Tokens y costo estimado del turno (solo mensajes del avatar; puede faltar
  // si el proveedor no reportó usage o el modelo no está tarifado).
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

interface ChatResponse {
  reply: string;
  closing: boolean;
  prompt_chars: number;
  provider: string;
  model_name: string;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
}

interface RegistroInput {
  nombre?: string;
  email?: string;
  rol_objetivo?: string;
  industria?: string;
  experience_level?: string;
}

interface Diagnostico {
  completed_at: string;
  resumen_ejecutivo?: string;
  competencias_foco: string[];
  strengths: { skill: string; evidence: string; why_matters: string }[];
  gaps: { skill: string; evidence: string; impact: string; micro_practice: string }[];
  blind_spot: string;
  reflection_question: string;
  coach_note?: string;
  verbal_patterns: {
    vague_verbs_detected: string[];
    we_vs_i_tendency: string;
    filler_frequency: string;
  };
  recommended_next_scenario: string;
  recommended_next_level: string;
  is_demo?: boolean;
}

interface DiagnosticoResponse {
  diagnostico: Diagnostico;
  latency_ms: number;
  saved: boolean;
  diagnostic_id: number | null;
  save_error: string | null;
}

const LEVELS = ["principiante", "intermedio", "avanzado"];

// Identificador estable y ALEATORIO por navegador. Se usa para namespacing del
// session_id que se persiste en BD: sin esto, todos los navegadores arrancan con
// el mismo id hardcodeado ("session-default") y, como es PRIMARY KEY de
// chatlab_conversations, un usuario pisaba (upsert) la conversacion de otro.
// Prefijar con CLIENT_ID garantiza que cada navegador tenga sus propias filas y
// nunca vea/pise la conversacion de otro usuario. Vive en localStorage (por
// navegador); un flujo con login real podria sustituirlo por el uid del usuario.
const CLIENT_ID: string = (() => {
  try {
    let id = localStorage.getItem("chatlab_client_id");
    if (!id) {
      id = `client-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      localStorage.setItem("chatlab_client_id", id);
    }
    return id;
  } catch {
    return "client-anon";
  }
})();

// Duraciones de práctica ofrecidas (igual que el GPT de referencia: 25/40/60).
const DURATIONS = [25, 40, 60];
const DEFAULT_DURATION = 25;

// Meta de intercambios (turnos del usuario) para completar el diagnostico segun
// la duracion elegida. ~1 intercambio cada 3 min, minimo 4. Es el denominador de
// la barra de progreso; el 100% real lo marca el cierre del entrevistador.
function targetExchanges(min: number): number {
  return Math.max(4, Math.round(min / 3));
}

const PROVIDER_MODELS = {
  groq: [
    { id: "openai/gpt-oss-20b", name: "gpt-oss-20b (Reasoning - Default)" },
    { id: "openai/gpt-oss-120b", name: "gpt-oss-120b (el del análisis)" },
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B (Versatile/JSON)" },
    { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B (Fast — ojo TPM)" },
  ],
  gemini: [
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash (GA - Default)" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview - Reasoning)" },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite (Rápido)" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Legacy)" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (Legacy - Reasoning)" },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite (Legacy)" },
  ],
  chatgpt: [
    { id: "gpt-5.5", name: "GPT-5.5 (Frontier)" },
    { id: "gpt-5.4", name: "GPT-5.4 (Balanced)" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini (Fast/Economic)" },
    { id: "gpt-5.4-nano", name: "GPT-5.4 Nano (Fastest)" },
    { id: "gpt-4o", name: "GPT-4o (Legacy)" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini (Legacy)" },
    { id: "gpt-4.1", name: "GPT-4.1 (Legacy)" },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini (Legacy)" },
  ],
};

// Motor del LLM a evaluar. "gemini" reproduce el prompt conciso + addendum de
// voz contra el modelo Gemini de texto (como en la llamada de voz, sin audio);
// solo aplica al diagnostico (Sofia). "groq" = prompt maestro + gpt-oss.
type Provider = "groq" | "gemini" | "chatgpt";

// Etiqueta + color por proveedor, para el badge de "con qué LLM se hizo" en la
// lista de sesiones de prueba.
const PROVIDER_BADGE: Record<Provider, { label: string; cls: string }> = {
  gemini: { label: "Gemini", cls: "bg-teal/10 text-teal border-teal/25" },
  groq: { label: "Groq", cls: "bg-violet/10 text-violet-lighter border-violet/25" },
  chatgpt: { label: "GPT", cls: "bg-success/10 text-success border-success/25" },
};
// Resultado de la persistencia en BD del diagnóstico (por sesión, no global:
// el banner «✓ Guardado» debe corresponder a la sesión que se está viendo).
interface SaveInfo {
  saved: boolean;
  id: number | null;
  error: string | null;
}

interface ChatSession {
  id: string;
  name: string;
  avatarId: string;
  provider: Provider;
  selectedModel?: string | null;
  level: string;
  messages: ChatMsg[];
  promptChars: number | null;
  modelName?: string | null;
  closed: boolean;
  createdAt: number;
  // Perfil para el diagnostico (sustituye {{nombre}}, {{rol}}...). Se prefila
  // desde el registro global cacheado en localStorage.
  registro?: RegistroInput;
  // Duracion objetivo de la practica en minutos (25/40/60, como el GPT de
  // referencia). Marca el ritmo del entrevistador (session_vars.minutos) y la
  // meta de la barra de progreso hacia el diagnostico.
  durationMin?: number;
  // Ultimo diagnostico generado para esta sesion (paso de analisis de produccion).
  diagnostico?: Diagnostico | null;
  // Estado del guardado en BD de ese diagnostico.
  saveInfo?: SaveInfo | null;
}

// Costo acumulado (USD) de los turnos de una sesión. 0 si no hay datos de costo
// (sesiones viejas o modelos sin tarifa en el backend).
function sessionCostUsd(s: ChatSession): number {
  return s.messages.reduce((acc, m) => acc + (m.costUsd || 0), 0);
}

// Formatea un costo en USD con precisión para fracciones de centavo (los turnos
// del banco rondan $0.0006–$0.04).
function fmtUsd(c: number): string {
  return `$${c.toFixed(c < 0.01 ? 4 : 3)}`;
}

function userTurns(msgs: ChatMsg[]): number {
  return msgs.filter((m) => m.role === "user").length;
}

// Placeholder animado para la telemetria mientras no hay datos reales (antes de
// la primera ejecucion). Sustituye los textos tipo "Esperando..." / "No ejecutado".
function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`inline-block rounded bg-white/10 animate-pulse ${className}`} />;
}

// Colorea un valor cualitativo (alta/media/baja) de los patrones verbales del
// diagnostico para mostrarlo como chip semaforo. El LLM emite texto libre, asi
// que clasificamos por palabra clave (ES/EN); lo desconocido cae a neutro.
function freqBadge(value?: string): { label: string; cls: string } {
  const v = (value || "").toLowerCase();
  if (/alta|high|frecuente|mucho|elevad/.test(v)) return { label: value || "—", cls: "bg-danger/15 text-danger border-danger/30" };
  if (/media|moderad|algo|medio/.test(v)) return { label: value || "—", cls: "bg-warning/15 text-warning border-warning/30" };
  if (/baja|low|poca|nula|ningun|ausente|escas/.test(v)) return { label: value || "—", cls: "bg-success/15 text-success border-success/30" };
  return { label: value || "—", cls: "bg-white/5 text-muted border-white/10" };
}

// Seccion colapsable para agrupar los controles TECNICOS (motor, telemetria,
// ficha). Colapsada por defecto: quien prueba la UI no necesita verlos, pero
// siguen a un clic de distancia para iterar.
function CollapsibleSection({
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

export function ChatLab() {
  const [avatars, setAvatars] = useState<AvatarInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [diagLoading, setDiagLoading] = useState(false);
  const [showDiag, setShowDiag] = useState(false);
  // Sesion para la que el usuario cerro el modal de datos (para poder escribir
  // manualmente sin re-llenar el formulario). Se re-abre al cambiar de sesion.
  const [registroClosedFor, setRegistroClosedFor] = useState<string | null>(null);
  // Registro cacheado entre pruebas: se llena una vez y se reutiliza (no
  // re-registrarse en cada sesión nueva).
  const [savedRegistro, setSavedRegistro] = useState<RegistroInput>(() => {
    try {
      const saved = localStorage.getItem("chatlab_registro");
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("Error cargando registro cacheado:", e);
    }
    return {};
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  // Ultima llamada al LLM (para reintentar tras un error, p.ej. 429 de cuota,
  // sin re-escribir el mensaje). Lleva el sessionId de ORIGEN: reintentar solo
  // vale en la sesion donde fallo (reproducir el historial de A contra el motor
  // de B sobreescribia la conversacion de B).
  const lastCallRef = useRef<{ sessionId: string; history: ChatMsg[]; greet: boolean } | null>(null);

  // Inicializar sesiones desde localStorage
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem("chatlab_sessions");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error("Error cargando sesiones locales:", e);
    }
    return [
      {
        id: "session-default",
        name: "Prueba 1: General",
        avatarId: "",
        provider: "gemini" as const,
        selectedModel: "gemini-3.5-flash",
        level: "principiante",
        messages: [],
        promptChars: null,
        closed: false,
        createdAt: Date.now(),
        durationMin: DEFAULT_DURATION,
      },
    ];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("chatlab_active_session_id");
      if (saved) return saved;
    } catch (e) {}
    return "session-default";
  });

  // Guardar ID activo en localStorage
  useEffect(() => {
    localStorage.setItem("chatlab_active_session_id", activeSessionId);
  }, [activeSessionId]);

  // Al cambiar de sesion, el error y su «Reintentar» pertenecen a la sesion
  // donde ocurrieron: arrastrarlos permitia reintentar el historial de A contra
  // el motor de B (y pisar la conversacion de B). Se descartan aqui.
  useEffect(() => {
    setError(null);
    if (lastCallRef.current && lastCallRef.current.sessionId !== activeSessionId) {
      lastCallRef.current = null;
    }
  }, [activeSessionId]);

  // Espejos en ref del estado, para que las continuaciones async (respuesta del
  // LLM, diagnostico) lean el valor VIGENTE y no el del render que las creo.
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // Cargar lista de avatares
  useEffect(() => {
    apiFetch<{ avatars: AvatarInfo[] }>("/api/chat/avatars")
      .then((data) => {
        setAvatars(data.avatars);
        // Si la sesión por defecto no tiene avatarId, asignarle el primero de la lista
        setSessions((prev) => {
          const updated = prev.map((s) => {
            if (!s.avatarId && data.avatars.length) {
              return { ...s, avatarId: data.avatars[0].id };
            }
            return s;
          });
          localStorage.setItem("chatlab_sessions", JSON.stringify(updated));
          return updated;
        });
      })
      .catch((e) => setError(`No se pudo cargar avatares: ${e.message}`));
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];
  const { avatarId, provider, selectedModel, level, messages, promptChars, closed, modelName, registro, diagnostico, saveInfo } = activeSession;
  // Fallback para sesiones viejas cacheadas en localStorage sin durationMin.
  const durationMin = activeSession.durationMin ?? DEFAULT_DURATION;
  const selected = avatars.find((a) => a.id === avatarId);
  const isDiagnostico = selected?.kind === "diagnostico";

  // ¿Ya arrancó la conversación? Una vez hay mensajes, se BLOQUEAN los controles
  // que definen el motor/persona (avatar, proveedor, modelo, nivel): no tiene
  // sentido cambiar de modelo a mitad de una charla y hasta ahora hacerlo borraba
  // la conversación en silencio. Para cambiar: «Limpiar Consola» o «+ Nueva».
  const convStarted = messages.length > 0;
  const LOCKED_HINT = "Limpia la consola o crea una sesión nueva para cambiar esto (no se puede a mitad de una conversación).";

  // Progreso hacia el diagnostico: intercambios (respuestas del usuario) contra
  // la meta derivada de la duracion. El 100% real lo marca el cierre del avatar.
  const exchanges = messages.filter((m) => m.role === "user").length;
  const progressTarget = targetExchanges(durationMin);
  const progressPct = closed
    ? 100
    : Math.min(Math.round((exchanges / progressTarget) * 100), 95);

  // Registro efectivo: lo capturado en la sesión, con fallback al cacheado
  // global (para no re-registrarse en cada prueba nueva).
  const effectiveRegistro: RegistroInput = { ...savedRegistro, ...(registro || {}) };

  // Campos obligatorios para arrancar el diagnostico: nombre + rol objetivo
  // (personalizan la entrevista; sin ellos el diagnostico sale generico).
  const registroCompleto = Boolean(
    effectiveRegistro.nombre?.trim() && effectiveRegistro.rol_objetivo?.trim()
  );

  // El modal de datos (onboarding del diagnostico) se muestra SOLO cuando faltan
  // datos obligatorios. Si ya estan (cacheados), no reaparece — p.ej. al "Limpiar
  // consola" solo se borra la conversacion, sin volver a pedir datos.
  const showRegistroModal =
    isDiagnostico &&
    messages.length === 0 &&
    !loading &&
    !registroCompleto &&
    registroClosedFor !== activeSessionId;

  // Actualiza el registro en la sesión activa Y en el caché global (localStorage).
  function updateRegistro(patch: Partial<RegistroInput>) {
    const merged = { ...effectiveRegistro, ...patch };
    setSavedRegistro(merged);
    localStorage.setItem("chatlab_registro", JSON.stringify(merged));
    updateActiveSession({ registro: merged });
  }

  // user_profile a mandar al backend si hay algun campo de registro capturado.
  // Por sesion: las llamadas async deben usar el registro de la sesion que las
  // origino, no el de la que este activa cuando resuelvan.
  function buildUserProfileFor(session: ChatSession): { registro: RegistroInput } | undefined {
    const reg: RegistroInput = { ...savedRegistro, ...(session.registro || {}) };
    if (Object.values(reg).some((v) => v && v.trim())) {
      return { registro: reg };
    }
    return undefined;
  }

  // Auto-scroll al último mensaje
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, loading]);

  // Actualiza una sesión POR ID. Las escrituras asíncronas (respuesta del LLM,
  // diagnóstico) deben ir a la sesión que originó la llamada, aunque el usuario
  // haya cambiado a otra mientras estaba en vuelo.
  function updateSession(sessionId: string, updates: Partial<ChatSession>) {
    setSessions((prev) => {
      const next = prev.map((s) => {
        if (s.id === sessionId) {
          return { ...s, ...updates };
        }
        return s;
      });
      localStorage.setItem("chatlab_sessions", JSON.stringify(next));
      return next;
    });
  }

  // Atajo para los handlers de UI (siempre operan sobre la sesión visible).
  function updateActiveSession(updates: Partial<ChatSession>) {
    updateSession(activeSessionId, updates);
  }

  function reset() {
    updateActiveSession({
      messages: [],
      promptChars: null,
      closed: false,
    });
    setError(null);
  }

  async function callChat(history: ChatMsg[], greet: boolean) {
    // Sesión de ORIGEN capturada al despachar: todo lo que resuelva esta
    // llamada (respuesta, error, persistencia) se dirige a ella, no a la que
    // esté activa cuando el LLM conteste.
    const session = activeSession;
    const sessionAvatar = avatars.find((a) => a.id === session.avatarId);
    lastCallRef.current = { sessionId: session.id, history, greet };
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<ChatResponse>("/api/chat", {
        method: "POST",
        json: {
          avatar_id: session.avatarId,
          provider: session.provider,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          greet,
          level: sessionAvatar?.supports_levels ? session.level : undefined,
          model: session.selectedModel || undefined,
          user_profile: buildUserProfileFor(session),
          session_vars:
            sessionAvatar?.kind === "diagnostico"
              ? { minutos: session.durationMin ?? DEFAULT_DURATION }
              : undefined,
        },
      });
      const assistantMsg: ChatMsg = {
        role: "assistant",
        content: res.reply,
        latencyMs: res.latency_ms,
        inputTokens: res.input_tokens ?? undefined,
        outputTokens: res.output_tokens ?? undefined,
        costUsd: res.cost_usd ?? undefined,
      };
      // Merge sobre el estado VIVO de la sesión, no sobre la copia `history`:
      // un 👍/👎 puesto mientras la llamada estaba en vuelo se conserva. (La
      // latencia del LLM garantiza que el ref ya reflejó el turno enviado.)
      const live = sessionsRef.current.find((s) => s.id === session.id);
      if (!live || userTurns(live.messages) !== userTurns(history)) {
        // La sesión se borró o se limpió la consola en vuelo: la respuesta ya
        // no corresponde a ninguna conversación — descartarla.
        return;
      }
      const merged = [...live.messages, assistantMsg];
      updateSession(session.id, {
        messages: merged,
        promptChars: res.prompt_chars,
        closed: res.closing,
        modelName: res.model_name,
      });
      // Persistir en BD (con model_name real de esta corrida).
      saveConversation(live, merged, { closed: res.closing, model: res.model_name });
    } catch (e) {
      // Mostrar el error solo si la sesión de origen sigue activa; en otra
      // sesión el banner (y su «Reintentar») no corresponderían a lo visible.
      if (activeSessionIdRef.current === session.id) {
        setError((e as Error).message || "Error llamando al modelo");
      }
    } finally {
      setLoading(false);
    }
  }

  function startWithGreeting() {
    updateActiveSession({
      messages: [],
      promptChars: null,
      closed: false,
    });
    callChat([], true);
  }

  function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next = [...messages, { role: "user" as const, content: text }];
    updateActiveSession({ messages: next });
    setInput("");
    callChat(next, false);
  }

  // Reintenta la ultima llamada al LLM (mismo historial/greet) tras un error,
  // p.ej. cuando esperaste el cooldown del 429 de cuota de Gemini. Solo aplica
  // en la sesion donde fallo (el effect de cambio de sesion ya descarta el ref,
  // esto es cinturon y tirantes).
  function retryLast() {
    if (loading || !lastCallRef.current) return;
    if (lastCallRef.current.sessionId !== activeSessionId) return;
    callChat(lastCallRef.current.history, lastCallRef.current.greet);
  }

  // Auto-guarda la conversacion en BD (upsert por session_id). Fire-and-forget y
  // no-fatal: la fuente en vivo es localStorage; BD asegura que NO se pierda al
  // reiniciar/limpiar o cambiar de dispositivo. No guarda vacio (para no pisar en
  // BD la conversacion previa al limpiar la consola). Recibe la sesion explicita
  // (la de ORIGEN de la llamada, no necesariamente la activa) y opcionalmente el
  // model_name real de la corrida (el de la sesion va un turno atrasado).
  function saveConversation(
    session: ChatSession,
    msgs: ChatMsg[],
    opts?: { closed?: boolean; model?: string | null }
  ) {
    if (!msgs.length) return;
    apiFetch("/api/chat/conversation", {
      method: "POST",
      json: {
        // Namespaced por CLIENT_ID: aisla las filas en BD por navegador para que
        // dos usuarios distintos nunca compartan/pisen la misma conversacion.
        session_id: `${CLIENT_ID}:${session.id}`,
        name: session.name,
        avatar_id: session.avatarId,
        provider: session.provider,
        model: opts?.model ?? session.modelName ?? session.selectedModel ?? undefined,
        minutos: session.durationMin ?? DEFAULT_DURATION,
        closed: opts?.closed ?? session.closed,
        messages: msgs.map((m) => ({ role: m.role, content: m.content })),
        feedback: msgs.map((m) => m.feedback ?? null),
        user_profile: buildUserProfileFor(session),
      },
    }).catch((e) => console.warn("No se pudo guardar la conversación en BD:", e));
  }

  // Valora una respuesta del avatar (like/dislike). Toggle: volver a pulsar el
  // mismo la quita. Se persiste con la sesion (localStorage) y en BD, y se
  // incluye en el export.
  function setMessageFeedback(index: number, value: "like" | "dislike") {
    const next = messages.map((m, i) =>
      i === index ? { ...m, feedback: m.feedback === value ? null : value } : m
    );
    updateActiveSession({ messages: next });
    saveConversation(activeSession, next);
  }

  async function generateDiagnostico() {
    // Igual que callChat: el resultado va a la sesión que lo pidió, aunque el
    // usuario cambie de sesión mientras el análisis corre (~10-20s).
    const session = activeSession;
    if (diagLoading || session.messages.length === 0) return;
    setDiagLoading(true);
    setError(null);
    try {
      const res = await apiFetch<DiagnosticoResponse>("/api/chat/diagnostico", {
        method: "POST",
        json: {
          messages: session.messages.map((m) => ({ role: m.role, content: m.content })),
          user_profile: buildUserProfileFor(session),
          session_vars: { minutos: session.durationMin ?? DEFAULT_DURATION },
          save: true,
        },
      });
      updateSession(session.id, {
        diagnostico: res.diagnostico,
        saveInfo: { saved: res.saved, id: res.diagnostic_id, error: res.save_error },
      });
      // Abrir el modal solo si el usuario sigue viendo esta sesión.
      if (activeSessionIdRef.current === session.id) {
        setShowDiag(true);
      }
    } catch (e) {
      if (activeSessionIdRef.current === session.id) {
        setError((e as Error).message || "Error generando diagnóstico");
      }
    } finally {
      setDiagLoading(false);
    }
  }

  // Funciones de gestión de sesiones
  function createNewSession() {
    const newId = `session-${Date.now()}`;
    const defaultAvatar = avatars.length ? avatars[0].id : "";
    const newSession: ChatSession = {
      id: newId,
      name: `Sesión ${sessions.length + 1}`,
      avatarId: defaultAvatar,
      provider: "gemini",
      selectedModel: "gemini-3.5-flash",
      level: "principiante",
      messages: [],
      promptChars: null,
      closed: false,
      createdAt: Date.now(),
      durationMin: DEFAULT_DURATION,
    };
    const next = [...sessions, newSession];
    setSessions(next);
    localStorage.setItem("chatlab_sessions", JSON.stringify(next));
    setActiveSessionId(newId);
  }

  function deleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (sessions.length <= 1) {
      // Si es la única, solo se resetea
      reset();
      return;
    }
    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);
    localStorage.setItem("chatlab_sessions", JSON.stringify(remaining));
    if (activeSessionId === id) {
      setActiveSessionId(remaining[0].id);
    }
  }

  function startRename(id: string, currentName: string, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingSessionId(id);
    setEditNameValue(currentName);
  }

  function saveRename(id: string) {
    if (!editNameValue.trim()) return;
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, name: editNameValue.trim() } : s));
      localStorage.setItem("chatlab_sessions", JSON.stringify(next));
      return next;
    });
    setEditingSessionId(null);
  }

  function exportSession(session: ChatSession) {
    const avatarName = avatars.find((a) => a.id === session.avatarId)?.name || session.avatarId;
    let content = `# Reporte de Laboratorio: ${session.name}\n`;
    content += `Fecha: ${new Date(session.createdAt).toLocaleDateString()}\n`;
    content += `Avatar simulado: ${avatarName}\n`;
    content += `Motor / Proveedor: ${session.provider === "gemini" ? "Gemini" : (session.provider === "chatgpt" ? "ChatGPT (OpenAI)" : "Groq")}\n`;
    if (session.modelName) {
      content += `Modelo específico: ${session.modelName}\n`;
    }
    content += `Nivel: ${session.level}\n`;
    content += `Caracteres Prompt: ${session.promptChars || "N/A"}\n`;
    const totalCost = sessionCostUsd(session);
    if (totalCost > 0) {
      content += `Costo estimado de la sesión: ~${fmtUsd(totalCost)} USD (on-demand, sin cache)\n`;
    }
    content += `\n`;
    content += `## Historial de Turnos de Prueba\n\n`;

    if (session.messages.length === 0) {
      content += `*No hay mensajes registrados en esta sesión.*\n`;
    } else {
      session.messages.forEach((m) => {
        const roleLabel = m.role === "user" ? "Usuario" : avatarName;
        const latency = m.latencyMs !== undefined ? ` _(${(m.latencyMs / 1000).toFixed(1)}s)_` : "";
        const fb = m.feedback === "like" ? " 👍" : m.feedback === "dislike" ? " 👎" : "";
        content += `**[${roleLabel.toUpperCase()}]**${latency}${fb}:\n${m.content}\n\n---\n\n`;
      });
    }

    const blob = new Blob([content], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${session.name.replace(/\s+/g, "_")}_historial.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="h-screen h-dvh overflow-hidden bg-ink text-cream flex flex-col font-sans">
      {/* Top Header Bar */}
      <header className="border-b border-white/5 bg-deep/80 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-xs transition-all cursor-pointer text-muted hover:text-cream active:scale-95"
            title={sidebarOpen ? "Ocultar panel lateral" : "Mostrar panel lateral"}
          >
            {sidebarOpen ? "◀" : "▶"}
          </button>
          <div className="w-8 h-8 rounded-lg bg-violet/20 border border-violet/30 flex items-center justify-center text-lg shadow-inner">
            🧪
          </div>
          <div>
            <h1 className="font-syne font-bold text-base tracking-wide flex items-center gap-2">
              ChatLab
              <span className="text-[10px] uppercase tracking-widest bg-violet/20 text-violet-lighter px-1.5 py-0.5 rounded border border-violet/30 font-mono">
                Prompt Sandbox
              </span>
            </h1>
            <p className="text-[11px] text-muted">Mente Viva · Consola de Iteración y Diagnóstico</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => window.history.back()}
            className="text-xs font-syne text-muted hover:text-cream px-3 py-1.5 rounded-lg border border-white/5 hover:bg-white/5 transition-all"
          >
            ← Volver al Dashboard
          </button>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        
        {/* Left Side: Parameters & Telemetry */}
        <aside className={`w-full lg:w-[360px] max-h-[45vh] lg:max-h-none border-b lg:border-b-0 lg:border-r border-white/5 bg-deep/40 backdrop-blur-sm p-6 overflow-y-auto space-y-6 flex flex-col shrink-0 transition-all duration-300 ${
          sidebarOpen ? "block" : "hidden"
        }`}>
          
          {/* Section: Laboratory Sessions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-syne font-semibold text-muted uppercase tracking-wider">
                <span>🧪 Sesiones de Prueba</span>
              </div>
              <button
                onClick={createNewSession}
                className="text-[10px] font-syne bg-violet/20 hover:bg-violet/30 text-violet-lighter border border-violet/30 px-2 py-1 rounded transition-all cursor-pointer font-bold"
                title="Crear nueva sesión independiente"
              >
                + Nueva
              </button>
            </div>

            <div className="max-h-[160px] overflow-y-auto border border-white/5 rounded-xl bg-ink/40 p-1.5 space-y-1 scrollbar-thin">
              {sessions.map((s) => {
                const isActive = s.id === activeSessionId;
                const isEditing = s.id === editingSessionId;
                return (
                  <div
                    key={s.id}
                    onClick={() => !isEditing && setActiveSessionId(s.id)}
                    className={`flex items-center justify-between p-2 rounded-lg text-xs transition-all cursor-pointer group ${
                      isActive
                        ? "bg-violet/15 border border-violet/30 text-cream"
                        : "border border-transparent hover:bg-white/5 text-muted hover:text-cream"
                    }`}
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editNameValue}
                          onChange={(e) => setEditNameValue(e.target.value)}
                          onBlur={() => saveRename(s.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRename(s.id);
                            if (e.key === "Escape") setEditingSessionId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="bg-ink border border-violet text-xs rounded px-1 py-0.5 w-full text-cream focus:outline-none font-sans"
                          autoFocus
                        />
                      ) : (
                        <div className="space-y-0.5">
                          <div className="font-medium truncate flex items-center gap-1.5">
                            <span className="truncate">{s.name}</span>
                            {s.messages.length > 0 && (
                              <span className="text-[9px] px-1 bg-white/5 text-subtle font-mono rounded">
                                {s.messages.length}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${PROVIDER_BADGE[s.provider].cls}`}>
                              {PROVIDER_BADGE[s.provider].label}
                            </span>
                            {(s.modelName || s.selectedModel) && (
                              <span className="text-[9px] text-subtle font-mono truncate max-w-[110px]" title={s.modelName || s.selectedModel || ""}>
                                {s.modelName || s.selectedModel}
                              </span>
                            )}
                            {(() => {
                              const c = sessionCostUsd(s);
                              return c > 0 ? (
                                <span className="text-[9px] font-mono text-teal shrink-0" title="Costo estimado acumulado de la sesión">
                                  ~{fmtUsd(c)}
                                </span>
                              ) : null;
                            })()}
                          </div>
                        </div>
                      )}
                    </div>

                    {!isEditing && (
                      <div className="flex items-center gap-1 shrink-0 opacity-80 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => startRename(s.id, s.name, e)}
                          className="p-1 hover:bg-white/10 rounded text-muted hover:text-cream"
                          title="Renombrar sesión"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); exportSession(s); }}
                          className="p-1 hover:bg-white/10 rounded text-muted hover:text-cream"
                          title="Exportar historial (Markdown)"
                        >
                          📥
                        </button>
                        <button
                          onClick={(e) => deleteSession(s.id, e)}
                          className="p-1 hover:bg-white/10 rounded text-danger/80 hover:text-danger"
                          title="Eliminar sesión"
                        >
                          🗑️
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section: Specimen Configuration */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-syne font-semibold text-muted uppercase tracking-wider">
              <span>🧬 Parámetros del Espécimen</span>
            </div>
            
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[11px] text-muted font-mono">AVATAR / PERSONA</label>
                <select
                  value={avatarId}
                  disabled={convStarted}
                  title={convStarted ? LOCKED_HINT : undefined}
                  onChange={(e) => {
                    updateActiveSession({ avatarId: e.target.value, messages: [], promptChars: null, closed: false });
                  }}
                  className="w-full bg-ink border border-white/10 rounded-xl px-3.5 py-2.5 text-sm font-sans focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition-all text-cream cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {avatars.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} {a.role ? `(${a.role})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Avatar Metadata Card (tecnico -> colapsable) */}
              {selected && (
                <CollapsibleSection title={<span>📋 Ficha técnica</span>}>
                  <div className="p-4 bg-panel/60 border border-white/5 rounded-xl space-y-2.5 shadow-sm">
                    <div className="flex items-center justify-between border-b border-white/5 pb-2">
                      <span className="text-xs font-syne font-bold text-cream">{selected.name}</span>
                      <span className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded font-semibold ${
                        selected.kind === "diagnostico"
                          ? "bg-teal/10 text-teal border border-teal/20"
                          : "bg-violet/10 text-violet-lighter border border-violet/20"
                      }`}>
                        {selected.kind === "diagnostico" ? "Diagnóstico" : "Práctica"}
                      </span>
                    </div>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted">Nombre del Avatar:</span>
                        <span className="text-cream font-medium">{selected.name}</span>
                      </div>
                      {selected.role && (
                        <div className="flex justify-between">
                          <span className="text-muted">Rol simulado:</span>
                          <span className="text-cream font-medium">{selected.role}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted">Soporta Niveles:</span>
                        <span className={`font-mono ${selected.supports_levels ? "text-teal" : "text-subtle"}`}>
                          {selected.supports_levels ? "SÍ" : "NO"}
                        </span>
                      </div>
                    </div>
                  </div>
                </CollapsibleSection>
              )}
            </div>
          </div>

          {/* Section: Engine Controls (tecnico -> colapsable) */}
          <CollapsibleSection title={<span>⚙️ Motor de Ejecución</span>}>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[11px] text-muted font-mono">PROVEEDOR LLM</label>
                <select
                  value={provider}
                  disabled={convStarted}
                  title={convStarted ? LOCKED_HINT : undefined}
                  onChange={(e) => {
                    updateActiveSession({
                      provider: e.target.value as Provider,
                      selectedModel: null,
                      messages: [],
                      promptChars: null,
                      closed: false,
                      modelName: null
                    });
                  }}
                  className="w-full bg-ink border border-white/10 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition-all text-cream cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="groq">Groq · Prompt Maestro</option>
                  <option value="gemini">Gemini · Voz (Sin Audio)</option>
                  <option value="chatgpt">ChatGPT · OpenAI (gpt-5.x)</option>
                </select>
                <p className="text-[10px] text-subtle leading-normal">
                  {provider === "groq" && "Utiliza el prompt maestro extendido y modelos optimizados de código abierto en Groq."}
                  {provider === "gemini" && "Emula el prompt de voz optimizado de Google Gemini sin la latencia de audio."}
                  {provider === "chatgpt" && "Ejecuta los modelos oficiales de OpenAI (gpt-5.5 para Sofía, gpt-5.4-mini para otros)."}
                </p>
              </div>

              {/* Model Selector Dropdown */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-muted font-mono">MODELO ESPECÍFICO</label>
                <select
                  value={selectedModel || ""}
                  disabled={convStarted}
                  title={convStarted ? LOCKED_HINT : undefined}
                  onChange={(e) => {
                    updateActiveSession({ selectedModel: e.target.value || null, messages: [], promptChars: null, closed: false });
                  }}
                  className="w-full bg-ink border border-white/10 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition-all text-cream cursor-pointer font-sans disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Por Defecto (Auto-detectar)</option>
                  {PROVIDER_MODELS[provider].map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-subtle leading-normal">
                  {convStarted
                    ? "🔒 Bloqueado durante la conversación. Limpia la consola o crea una sesión nueva para cambiar de modelo."
                    : "Selecciona una variante específica de este proveedor para evaluar diferencias de comportamiento."}
                </p>
              </div>

              {provider === "gemini" && isDiagnostico && (
                <div className="p-2.5 bg-teal/5 border border-teal/20 rounded-xl text-[10px] text-teal leading-normal">
                  ℹ️ Gemini corre con el <b>prompt maestro</b> (mismo que GPT/Groq, ~26k) para comparar motores manzanas con manzanas.
                </div>
              )}

              {selected?.supports_levels && (
                <div className="space-y-1.5">
                  <label className="text-[11px] text-muted font-mono">NIVEL DE DIFICULTAD</label>
                  <div className="grid grid-cols-3 gap-1 bg-ink p-1 rounded-xl border border-white/10">
                    {LEVELS.map((l) => (
                      <button
                        key={l}
                        disabled={convStarted}
                        title={convStarted ? LOCKED_HINT : undefined}
                        onClick={() => {
                          updateActiveSession({ level: l, messages: [], promptChars: null, closed: false });
                        }}
                        className={`text-[11px] py-1.5 rounded-lg capitalize font-mono transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                          level === l
                            ? "bg-violet text-white font-bold"
                            : "text-muted hover:text-cream hover:bg-white/5"
                        }`}
                      >
                        {l.substring(0, 5)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Section: Telemetry (tecnico -> colapsable) */}
          <CollapsibleSection title={<span>📊 Telemetría en Tiempo Real</span>}>
            <div className="p-4 bg-panel/40 border border-white/5 rounded-xl space-y-3 font-mono text-xs">
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-muted">Carga del Prompt:</span>
                  {promptChars !== null ? (
                    <span className="text-cream font-bold">{promptChars.toLocaleString()} chars</span>
                  ) : (
                    <Skeleton className="h-3 w-20" />
                  )}
                </div>
                {promptChars !== null ? (
                  <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-teal transition-all duration-500"
                      style={{ width: `${Math.min((promptChars / 15000) * 100, 100)}%` }}
                    />
                  </div>
                ) : (
                  <div className="w-full h-1 rounded-full bg-white/10 animate-pulse" />
                )}
              </div>

              <div className="flex justify-between items-center border-t border-white/5 pt-2">
                <span className="text-muted">Modelo Activo:</span>
                {modelName ? (
                  <span className="text-cream font-bold truncate max-w-[170px]" title={modelName}>
                    {modelName}
                  </span>
                ) : (
                  <Skeleton className="h-3 w-28" />
                )}
              </div>

              <div className="flex justify-between items-center border-t border-white/5 pt-2">
                <span className="text-muted">Latencia (últ / prom):</span>
                {(() => {
                  const lats = messages.filter((m) => m.latencyMs !== undefined).map((m) => m.latencyMs!);
                  if (!lats.length) return <Skeleton className="h-3 w-16" />;
                  const last = lats[lats.length - 1];
                  const avg = lats.reduce((a, b) => a + b, 0) / lats.length;
                  return (
                    <span className="text-cream font-bold">
                      {`${(last / 1000).toFixed(1)}s / ${(avg / 1000).toFixed(1)}s`}
                    </span>
                  );
                })()}
              </div>

              <div className="flex justify-between items-center border-t border-white/5 pt-2">
                <span className="text-muted">Tokens últ. (in/out):</span>
                {(() => {
                  const withTok = messages.filter((m) => m.inputTokens !== undefined || m.outputTokens !== undefined);
                  if (!withTok.length) return <Skeleton className="h-3 w-16" />;
                  const last = withTok[withTok.length - 1];
                  return (
                    <span className="text-cream font-bold">
                      {`${(last.inputTokens ?? 0).toLocaleString()} / ${(last.outputTokens ?? 0).toLocaleString()}`}
                    </span>
                  );
                })()}
              </div>

              <div className="flex justify-between items-center border-t border-white/5 pt-2">
                <span className="text-muted">Costo (últ / sesión):</span>
                {(() => {
                  const costs = messages.filter((m) => m.costUsd !== undefined).map((m) => m.costUsd!);
                  if (!costs.length) return <Skeleton className="h-3 w-16" />;
                  const last = costs[costs.length - 1];
                  const total = costs.reduce((a, b) => a + b, 0);
                  return (
                    <span className="text-teal font-bold" title="Costo estimado on-demand (llm_costs.PRICING), sin descuentos por cache/batch">
                      {`${fmtUsd(last)} / ${fmtUsd(total)}`}
                    </span>
                  );
                })()}
              </div>

              <div className="flex justify-between border-t border-white/5 pt-2">
                <span className="text-muted">Estado del Cierre:</span>
                <span className={`font-semibold ${closed ? "text-warning animate-pulse" : "text-teal"}`}>
                  {closed ? "CIERRE MARCADO" : "ACTIVA"}
                </span>
              </div>

              {provider === "gemini" && selected && selected.kind !== "diagnostico" && (
                <div className="p-2.5 bg-warning/10 border border-warning/20 rounded-lg text-[10px] text-warning leading-normal font-sans">
                  ⚠️ Este avatar no tiene prompt de voz nativo en Gemini. Se usará el prompt maestro.
                </div>
              )}

              {provider === "groq" && selectedModel?.includes("llama") && (promptChars ?? 0) > 20000 && (
                <div className="p-2.5 bg-warning/10 border border-warning/20 rounded-lg text-[10px] text-warning leading-normal font-sans">
                  ⚠️ Prompt muy grande para llama en free tier (6k TPM): es probable un error HTTP 413. Usa gpt-oss o un avatar con prompt más corto.
                </div>
              )}

              {error && (
                <div className="p-2.5 bg-danger/10 border border-danger/20 rounded-lg text-[10px] text-danger leading-normal font-sans">
                  {error}
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Action Buttons at the bottom of sidebar */}
          <div className="pt-4 mt-auto border-t border-white/5 space-y-2">
            <button
              onClick={startWithGreeting}
              disabled={loading || !avatarId || (isDiagnostico && !registroCompleto)}
              title={isDiagnostico && !registroCompleto ? "Completa nombre y rol objetivo en la ventana de datos" : undefined}
              className="w-full font-syne font-bold text-xs py-3 px-4 rounded-xl bg-violet text-white hover:bg-violet-light disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow-lg hover:shadow-violet/20 flex items-center justify-center gap-2 active:scale-95"
            >
              <span>🚀 Que Inicie el Avatar</span>
            </button>
            {isDiagnostico && (
              <button
                onClick={generateDiagnostico}
                disabled={diagLoading || messages.length === 0}
                className="w-full font-syne font-bold text-xs py-3 px-4 rounded-xl bg-teal text-ink hover:bg-teal/80 disabled:opacity-40 transition-all hover:shadow-lg hover:shadow-teal/20 flex items-center justify-center gap-2 active:scale-95"
                title="Corre el paso de análisis de producción (Groq gpt-oss-120b) sobre esta conversación"
              >
                <span>{diagLoading ? "🔬 Analizando…" : "🔬 Generar Diagnóstico"}</span>
              </button>
            )}
            {diagnostico && !diagLoading && (
              <button
                onClick={() => setShowDiag(true)}
                className="w-full font-syne text-xs py-2 px-4 rounded-xl border border-teal/30 text-teal hover:bg-teal/10 transition-all flex items-center justify-center gap-2"
              >
                <span>📄 Ver último diagnóstico</span>
              </button>
            )}
            <button
              onClick={reset}
              disabled={loading}
              className="w-full font-syne text-xs py-2.5 px-4 rounded-xl border border-white/10 hover:bg-white/5 text-muted hover:text-cream disabled:opacity-40 transition-all flex items-center justify-center gap-2"
            >
              <span>🧹 Limpiar Consola</span>
            </button>
          </div>
        </aside>

        {/* Right Side: Chat Console */}
        <main className="flex-1 min-h-0 flex flex-col bg-deep/10 overflow-hidden">
          
          {/* Target Specimen Header */}
          <div className="bg-deep/40 px-6 py-3 border-b border-white/5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs min-w-0">
              <span className="w-2 h-2 rounded-full bg-teal animate-pulse shrink-0" />
              <span className="text-muted shrink-0">Conectado a:</span>
              <span className="text-cream font-bold font-syne truncate">{selected?.name || "Ningún Avatar"}</span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Botón de duración: cambiable en cualquier momento (afecta el ritmo
                  de los próximos turnos y la meta de la barra de progreso). */}
              {isDiagnostico && (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted font-mono hidden sm:inline">⏱</span>
                  {DURATIONS.map((d) => (
                    <button
                      key={d}
                      onClick={() => updateActiveSession({ durationMin: d })}
                      title={`Práctica de ${d} minutos`}
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-all ${
                        durationMin === d
                          ? "bg-violet text-white border-violet font-bold"
                          : "text-muted border-white/10 hover:text-cream hover:bg-white/5"
                      }`}
                    >
                      {d}m
                    </button>
                  ))}
                </div>
              )}
              {messages.length > 0 && (
                <span className="text-[10px] font-mono text-muted bg-white/5 px-2 py-0.5 rounded border border-white/5">
                  {messages.length} turnos
                </span>
              )}
            </div>
          </div>

          {/* Barra de progreso hacia el diagnóstico (solo Sofia, ya iniciada) */}
          {isDiagnostico && messages.length > 0 && (
            <div className="bg-deep/20 px-6 py-2.5 border-b border-white/5">
              <div className="max-w-3xl mx-auto w-full">
                <div className="flex items-center justify-between text-[11px] mb-1.5">
                  <span className="font-syne font-semibold text-cream flex items-center gap-1.5">
                    {closed ? "✅ Diagnóstico listo" : "🎯 Progreso hacia tu diagnóstico"}
                  </span>
                  <span className="font-mono text-muted">
                    {progressPct}% · práctica de {durationMin} min
                  </span>
                </div>
                <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      closed ? "bg-success" : "bg-gradient-to-r from-teal to-violet"
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="text-[10px] text-subtle mt-1 leading-normal">
                  {closed
                    ? diagnostico
                      ? "Tu diagnóstico está generado — ábrelo con «Ver último diagnóstico»."
                      : "Sofia cerró la entrevista. Pulsa «Generar Diagnóstico» para tu reporte."
                    : `Cuéntale historias concretas; a más detalle, mejor diagnóstico. Vas ${exchanges} de ~${progressTarget} intercambios.`}
                </p>
              </div>
            </div>
          )}

          {/* Banner de error (visible aunque el sidebar esté colapsado) */}
          {error && (
            <div className="mx-6 mt-3 p-3 bg-danger/10 border border-danger/25 rounded-xl flex items-start gap-2.5">
              <span className="text-danger text-sm mt-0.5">⚠️</span>
              <p className="flex-1 text-xs text-danger leading-relaxed">{error}</p>
              {lastCallRef.current && (
                <button
                  onClick={retryLast}
                  disabled={loading}
                  className="shrink-0 flex items-center gap-1.5 text-[11px] font-syne font-semibold text-danger bg-danger/10 hover:bg-danger/20 border border-danger/30 px-2.5 py-1 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Reintentar la última pregunta (mismo mensaje)"
                >
                  <RotateCcw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
                  {loading ? "Reintentando…" : "Reintentar"}
                </button>
              )}
              <button
                onClick={() => setError(null)}
                className="text-danger/70 hover:text-danger text-xs px-1.5 shrink-0"
                title="Descartar"
              >
                ✕
              </button>
            </div>
          )}

          {/* Messages Area */}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-6 py-8 space-y-6">
            {messages.length === 0 && !loading && isDiagnostico ? (
              /* La captura de datos vive en un modal aparte (no dentro del chat).
                 Aqui solo queda un placeholder; si el usuario cierra el modal,
                 puede reabrirlo o escribir directamente en la barra inferior. */
              <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-teal/10 border border-teal/20 flex items-center justify-center text-2xl shadow-inner">
                  🧑‍💼
                </div>
                <div className="space-y-1.5">
                  <h3 className="font-syne font-bold text-cream text-base">Entrevista de diagnóstico</h3>
                  <p className="text-xs text-muted leading-relaxed">
                    {registroCompleto
                      ? `Tus datos están listos. Pulsa Comenzar y ${selected?.name || "el avatar"} iniciará la entrevista.`
                      : "Completa tus datos en la ventana para personalizar la entrevista, o escribe directamente para empezar."}
                  </p>
                </div>
                {registroCompleto ? (
                  <div className="flex flex-col items-center gap-2 w-full max-w-[240px]">
                    <button
                      onClick={startWithGreeting}
                      disabled={loading || !avatarId}
                      className="w-full font-syne font-bold text-sm py-3 px-4 rounded-xl bg-violet text-white hover:bg-violet-light disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow-lg hover:shadow-violet/20 flex items-center justify-center gap-2 active:scale-95"
                    >
                      🚀 Comenzar entrevista
                    </button>
                    <button
                      onClick={() => setRegistroClosedFor(null)}
                      className="text-[11px] font-syne text-muted hover:text-cream px-3 py-1 rounded-lg hover:bg-white/5 transition-all"
                    >
                      Editar mis datos
                    </button>
                  </div>
                ) : (
                  !showRegistroModal && (
                    <button
                      onClick={() => setRegistroClosedFor(null)}
                      className="text-xs font-syne text-violet-lighter hover:text-cream px-3 py-1.5 rounded-lg border border-violet/30 hover:bg-violet/10 transition-all"
                    >
                      Abrir ventana de datos
                    </button>
                  )
                )}
              </div>
            ) : messages.length === 0 && !loading ? (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-2xl shadow-inner animate-pulse-slow">
                  💬
                </div>
                <div className="space-y-1.5">
                  <h3 className="font-syne font-bold text-cream text-base">Consola Lista</h3>
                  <p className="text-xs text-muted leading-relaxed">
                    Selecciona un avatar en el panel izquierdo y escribe tu mensaje o haz clic en <span className="text-violet-lighter font-medium">«Que Inicie el Avatar»</span> para iniciar la interacción.
                  </p>
                </div>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto space-y-6">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div className="flex flex-col gap-1 max-w-[85%]">
                      {/* Bubble Info Label */}
                      <div className={`flex items-center gap-1.5 text-[10px] text-muted font-mono px-1 ${
                        m.role === "user" ? "justify-end" : "justify-start"
                      }`}>
                        <span>{m.role === "user" ? "TÚ" : (selected?.name || "ASISTENTE").toUpperCase()}</span>
                        {m.latencyMs !== undefined && (
                          <span className="text-subtle">· {(m.latencyMs / 1000).toFixed(1)}s</span>
                        )}
                      </div>
                      
                      {/* Bubble Box */}
                      <div
                        className={`rounded-2xl px-4 py-3.5 text-sm leading-relaxed whitespace-pre-wrap ${
                          m.role === "user"
                            ? "bg-violet text-white rounded-tr-sm shadow-md shadow-violet/10 border border-violet/20"
                            : "bg-panel/75 border border-white/10 text-cream rounded-tl-sm shadow-sm"
                        }`}
                      >
                        {m.content}
                      </div>

                      {/* Like / dislike — solo en respuestas del avatar */}
                      {m.role === "assistant" && (
                        <div className="flex items-center gap-1 px-1 pt-0.5">
                          <button
                            onClick={() => setMessageFeedback(i, "like")}
                            className={`p-1 rounded-md transition-all ${
                              m.feedback === "like"
                                ? "text-success bg-success/10"
                                : "text-subtle hover:text-cream hover:bg-white/5"
                            }`}
                            title="Buena respuesta"
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setMessageFeedback(i, "dislike")}
                            className={`p-1 rounded-md transition-all ${
                              m.feedback === "dislike"
                                ? "text-danger bg-danger/10"
                                : "text-subtle hover:text-cream hover:bg-white/5"
                            }`}
                            title="Respuesta mejorable"
                          >
                            <ThumbsDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Loading indicator */}
                {loading && (
                  <div className="flex justify-start">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-muted font-mono px-1">PENSANDO</span>
                      <div className="bg-panel/40 border border-white/5 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-muted flex items-center gap-2.5">
                        <div className="flex space-x-1.5 items-center">
                          <div className="w-1.5 h-1.5 bg-violet rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <div className="w-1.5 h-1.5 bg-violet rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <div className="w-1.5 h-1.5 bg-violet rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                        <span className="text-[11px] font-mono text-subtle">generando respuesta...</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Input Bar */}
          <footer className="bg-deep/40 px-6 py-4 border-t border-white/5">
            <div className="max-w-3xl mx-auto">
              <div className="relative flex items-end gap-3 bg-ink/80 border border-white/10 rounded-2xl p-2.5 focus-within:border-violet/50 focus-within:ring-1 focus-within:ring-violet/30 transition-all shadow-inner">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={2}
                  placeholder="Escribe tu mensaje aquí..."
                  className="flex-1 min-h-[44px] max-h-40 resize-none bg-transparent text-sm text-cream placeholder-subtle border-0 focus:ring-0 focus:outline-none px-2 py-1 leading-relaxed"
                />
                
                <button
                  onClick={send}
                  disabled={loading || !input.trim()}
                  className="w-10 h-10 rounded-xl bg-violet text-white hover:bg-violet-light disabled:opacity-30 disabled:hover:bg-violet transition-all flex items-center justify-center shrink-0 shadow-md active:scale-95 cursor-pointer"
                  title="Enviar mensaje (Enter)"
                >
                  <Send className="w-4 h-4" strokeWidth={2.2} />
                </button>
              </div>

              <div className="flex items-center justify-between mt-2.5 px-1.5">
                <div className="text-[10px] text-muted font-mono">
                  <span>Enter envía · Shift+Enter línea nueva</span>
                </div>
                {closed && (
                  <span className="text-[10px] font-mono text-warning bg-warning/5 px-2 py-0.5 rounded border border-warning/10">
                    Cierre de sesión sugerido por el avatar
                  </span>
                )}
              </div>
            </div>
          </footer>

        </main>
      </div>

      {/* Modal: Captura de datos del diagnóstico (onboarding tipo voz).
          Ventana propia centrada — ya no queda embebida dentro del chat. */}
      {showRegistroModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm p-4">
          <div className="bg-deep border border-white/10 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between">
                <div className="text-center flex-1 space-y-1.5">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-teal/15 border border-teal/25 flex items-center justify-center text-2xl shadow-inner">
                    🧑‍💼
                  </div>
                  <h3 className="font-syne font-bold text-cream text-base">Antes de empezar</h3>
                  <p className="text-xs text-muted leading-relaxed">
                    Cuéntanos quién eres para personalizar la entrevista y el diagnóstico, igual que en el flujo de voz.
                  </p>
                </div>
                <button
                  onClick={() => setRegistroClosedFor(activeSessionId)}
                  className="w-7 h-7 shrink-0 rounded-lg bg-white/5 hover:bg-white/10 text-muted hover:text-cream flex items-center justify-center transition-all"
                  title="Cerrar (podrás escribir directamente)"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-2.5">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted font-mono">NOMBRE *</label>
                  <input
                    type="text"
                    value={effectiveRegistro.nombre || ""}
                    onChange={(e) => updateRegistro({ nombre: e.target.value })}
                    placeholder="Ej. Eric"
                    className="w-full bg-ink border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-cream placeholder-subtle focus:outline-none focus:border-violet/50 focus:ring-1 focus:ring-violet/30 font-sans"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted font-mono">CORREO (opcional)</label>
                  <input
                    type="email"
                    value={effectiveRegistro.email || ""}
                    onChange={(e) => updateRegistro({ email: e.target.value })}
                    placeholder="tucorreo@empresa.com"
                    className="w-full bg-ink border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-cream placeholder-subtle focus:outline-none focus:border-violet/50 focus:ring-1 focus:ring-violet/30 font-sans"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted font-mono">ROL / PUESTO OBJETIVO *</label>
                  <input
                    type="text"
                    value={effectiveRegistro.rol_objetivo || ""}
                    onChange={(e) => updateRegistro({ rol_objetivo: e.target.value })}
                    placeholder="Ej. Consultor de tecnología"
                    className="w-full bg-ink border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-cream placeholder-subtle focus:outline-none focus:border-violet/50 focus:ring-1 focus:ring-violet/30 font-sans"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted font-mono">INDUSTRIA</label>
                    <input
                      type="text"
                      value={effectiveRegistro.industria || ""}
                      onChange={(e) => updateRegistro({ industria: e.target.value })}
                      placeholder="Ej. Tecnología"
                      className="w-full bg-ink border border-white/10 rounded-xl px-3 py-2.5 text-sm text-cream placeholder-subtle focus:outline-none focus:border-violet/50 focus:ring-1 focus:ring-violet/30 font-sans"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted font-mono">NIVEL</label>
                    <select
                      value={effectiveRegistro.experience_level || ""}
                      onChange={(e) => updateRegistro({ experience_level: e.target.value })}
                      className="w-full bg-ink border border-white/10 rounded-xl px-3 py-2.5 text-sm text-cream focus:outline-none focus:border-violet/50 focus:ring-1 focus:ring-violet/30 cursor-pointer font-sans"
                    >
                      <option value="">Selecciona…</option>
                      {["entry", "junior", "mid", "senior", "lead", "executive"].map((lv) => (
                        <option key={lv} value={lv}>{lv}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-muted font-mono">DURACIÓN DE LA PRÁCTICA</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {DURATIONS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => updateActiveSession({ durationMin: d })}
                        className={`text-xs py-2 rounded-xl font-mono transition-all border ${
                          durationMin === d
                            ? "bg-violet text-white border-violet font-bold"
                            : "bg-ink text-muted border-white/10 hover:text-cream hover:bg-white/5"
                        }`}
                      >
                        {d} min
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                onClick={startWithGreeting}
                disabled={loading || !avatarId || !registroCompleto}
                className="w-full font-syne font-bold text-sm py-3 px-4 rounded-xl bg-violet text-white hover:bg-violet-light disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow-lg hover:shadow-violet/20 flex items-center justify-center gap-2 active:scale-95"
              >
                <span>🚀 Comenzar entrevista</span>
              </button>
              {!registroCompleto && (
                <p className="text-[10px] text-warning text-center leading-normal">
                  Completa los campos obligatorios (*) para comenzar.
                </p>
              )}
              <p className="text-[10px] text-subtle text-center leading-normal">
                Los datos se guardan con el diagnóstico en la base de datos (usuario <span className="font-mono">chatlab:*</span>).
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Diagnóstico generado */}
      {showDiag && diagnostico && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm p-4"
          onClick={() => setShowDiag(false)}
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
                onClick={() => setShowDiag(false)}
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
                      {effectiveRegistro.nombre ? `Diagnóstico de ${effectiveRegistro.nombre}` : "Tu diagnóstico"}
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

              {/* Nota final del coach (observación cálida, estilo GPT de referencia) */}
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
