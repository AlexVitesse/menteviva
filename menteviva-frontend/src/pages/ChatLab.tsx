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
import { useNavigate } from "react-router-dom";
import { Send, RotateCcw, ThumbsUp, ThumbsDown, Info, Star, MessageSquareText } from "lucide-react";
import { apiFetch, ApiFetchOptions } from "../lib/api";

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
  // Comentario del usuario al dar 👎: el "por qué no me gustó". Alimenta la
  // evaluación de prompts. Vive junto al mensaje y se persiste en BD.
  feedbackComment?: string;
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
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash (GA)" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview - Reasoning)" },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite (Rápido)" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Default)" },
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

// Encuesta de satisfacción del diagnóstico (estrellas + comentario opcional).
// Por sesión; se pide al terminar el diagnóstico y se persiste con la conversación.
interface SatisfactionInfo {
  rating: number; // 1-5 estrellas
  comment: string;
  submittedAt: string; // ISO
}

// Un error del proveedor/servidor ocurrido durante la sesión (502, 429, 401…).
// Se registra para medir la fiabilidad de la experiencia: cuántas veces falló el
// usuario antes de completar el diagnóstico. Se persiste con la conversación.
interface SessionError {
  at: number; // epoch ms del fallo
  status?: number; // HTTP status (502, 429, 401…) si lo trae el ApiError
  message: string;
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
  // Encuesta de satisfaccion enviada por el usuario tras ver el diagnostico.
  // null/undefined = aun no la ha enviado.
  satisfaction?: SatisfactionInfo | null;
  // Cronómetro de la sesión: cuándo arrancó la conversación (primer turno) y
  // cuándo se dio por terminada (cierre del avatar o generación del diagnóstico).
  // Mientras completedAt sea undefined, el tiempo sigue corriendo. Sirve para
  // "registrar el tiempo que llevó realizarla" (se persiste en BD y en el export).
  startedAt?: number;
  completedAt?: number;
  // Errores del proveedor/servidor durante la sesión (502, 429, …). Se registran
  // para la experiencia de usuario: aunque se reintente con éxito, queda el rastro
  // de cuántas veces falló. Se persiste con la conversación.
  errorLog?: SessionError[];
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

// Formatea una duración en milisegundos como mm:ss (cronómetro de la sesión:
// "cuánto me llevó realizar el diagnóstico").
function fmtDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
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
  const navigate = useNavigate();
  const [avatars, setAvatars] = useState<AvatarInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [diagLoading, setDiagLoading] = useState(false);
  const [showDiag, setShowDiag] = useState(false);
  // Modal "¿por qué no te gustó?": índice del mensaje que se está comentando
  // (null = cerrado) y borrador del texto mientras se edita.
  const [feedbackModalIndex, setFeedbackModalIndex] = useState<number | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  // Modal de satisfacción del diagnóstico (estrellas + comentario opcional).
  const [showSatisfaction, setShowSatisfaction] = useState(false);
  const [satRating, setSatRating] = useState(0);
  const [satHover, setSatHover] = useState(0);
  const [satComment, setSatComment] = useState("");
  const [chatlabToken, setChatlabToken] = useState(() => localStorage.getItem("chatlab_token") || "");
  // Reloj que avanza cada segundo para pintar el cronómetro en vivo mientras la
  // sesión está activa (arrancada y sin terminar). No dispara re-render si no hay
  // sesión corriendo (el effect no monta el intervalo).
  const [nowTick, setNowTick] = useState(() => Date.now());

  const handleTokenChange = (val: string) => {
    setChatlabToken(val);
    try {
      localStorage.setItem("chatlab_token", val);
    } catch (e) {
      console.warn("No se pudo guardar el token en localStorage:", e);
    }
  };

  async function chatLabFetch<T = unknown>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
    const headers = new Headers(opts.headers);
    if (chatlabToken) {
      headers.set("X-ChatLab-Token", chatlabToken);
    }
    return apiFetch<T>(path, { ...opts, headers });
  }
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
        selectedModel: "gemini-2.5-flash",
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
    try {
      localStorage.setItem("chatlab_active_session_id", activeSessionId);
    } catch (e) {
      console.warn("No se pudo guardar activeSessionId en localStorage:", e);
    }
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
    chatLabFetch<{ avatars: AvatarInfo[] }>("/api/chat/avatars")
      .then((data) => {
        setAvatars(data.avatars);
        setError(null);
        // Si la sesión por defecto no tiene avatarId, asignarle el primero de la lista
        setSessions((prev) => {
          const updated = prev.map((s) => {
            if (!s.avatarId && data.avatars.length) {
              return { ...s, avatarId: data.avatars[0].id };
            }
            return s;
          });
          try {
            localStorage.setItem("chatlab_sessions", JSON.stringify(updated));
          } catch (e) {
            console.warn("No se pudo guardar sesiones en localStorage:", e);
          }
          return updated;
        });
      })
      .catch((e) => {
        if (e.status === 401) {
          setError("Acceso denegado: falta el token de acceso o ha expirado. Por favor, configúralo en la sección técnica (⚙️).");
        } else {
          setError(`No se pudo cargar avatares: ${e.message}`);
        }
      });
  }, [chatlabToken]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];
  const { avatarId, provider, selectedModel, level, messages, promptChars, closed, modelName, registro, diagnostico, saveInfo, satisfaction } = activeSession;
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
  // la meta derivada de la duracion. Antes la barra topaba en 95% hasta que Sofia
  // emitiera [CIERRE] por su cuenta; si no cerraba, el usuario "respondia y
  // respondia" sin llegar a 100% (barra enganosa). Ahora la completa el ESFUERZO
  // del usuario: al alcanzar la meta de intercambios la barra llega a 100% y se
  // ofrece "Terminar y generar diagnostico" (el cierre de Sofia sigue siendo un
  // camino valido y anticipado).
  const exchanges = messages.filter((m) => m.role === "user").length;
  const progressTarget = targetExchanges(durationMin);
  const reachedTarget = exchanges >= progressTarget;
  const progressComplete = closed || reachedTarget;
  const progressPct = progressComplete
    ? 100
    : Math.round((exchanges / progressTarget) * 100);

  // Cronómetro de la sesión activa: tiempo transcurrido desde el primer turno.
  // Si ya terminó (completedAt), queda congelado; si sigue viva, avanza con nowTick.
  const elapsedMs = activeSession.startedAt
    ? (activeSession.completedAt ?? nowTick) - activeSession.startedAt
    : 0;

  // Errores registrados en la sesión activa (para el indicador de fiabilidad).
  const errorLog = activeSession.errorLog ?? [];
  const serverErrorCount = errorLog.filter((e) => (e.status ?? 0) >= 500).length;

  // Mantiene el cronómetro corriendo (1 Hz) solo mientras hay una sesión activa
  // sin terminar. Se desmonta al cerrar/generar el diagnóstico o si no arrancó.
  useEffect(() => {
    if (!activeSession.startedAt || activeSession.completedAt) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [activeSession.startedAt, activeSession.completedAt]);

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
    try {
      localStorage.setItem("chatlab_registro", JSON.stringify(merged));
    } catch (e) {
      console.warn("No se pudo guardar registro en localStorage:", e);
    }
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
      try {
        localStorage.setItem("chatlab_sessions", JSON.stringify(next));
      } catch (e) {
        console.warn("No se pudo guardar sesiones en localStorage:", e);
      }
      return next;
    });
  }

  // Atajo para los handlers de UI (siempre operan sobre la sesión visible).
  function updateActiveSession(updates: Partial<ChatSession>) {
    updateSession(activeSessionId, updates);
  }

  function reset() {
    // Limpiar la consola reinicia también el cronómetro y el registro de errores:
    // es una sesión nueva de facto (la conversación previa se descarta).
    updateActiveSession({
      messages: [],
      promptChars: null,
      closed: false,
      startedAt: undefined,
      completedAt: undefined,
      errorLog: [],
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
      const res = await chatLabFetch<ChatResponse>("/api/chat", {
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
          // Cronómetro real de la sesión: alimenta la NOTA DEL SISTEMA de ritmo
          // en el backend (Sofia no tiene reloj; con esto señaliza avance y
          // cierra a tiempo). El backend usa max(tiempo, intercambios), así que
          // al completarse la barra Sofia también entra en modo cierre.
          elapsed_seconds:
            sessionAvatar?.kind === "diagnostico" && session.startedAt
              ? Math.max(0, Math.round((Date.now() - session.startedAt) / 1000))
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
      // Si el avatar cerró, congelamos el cronómetro (fin de la sesión).
      const completedAt = res.closing ? (live.completedAt ?? Date.now()) : live.completedAt;
      updateSession(session.id, {
        messages: merged,
        promptChars: res.prompt_chars,
        closed: res.closing,
        modelName: res.model_name,
        completedAt,
      });
      // Persistir en BD (con model_name real y el cronómetro de esta corrida).
      saveConversation({ ...live, completedAt }, merged, {
        closed: res.closing,
        model: res.model_name,
      });
    } catch (e) {
      const status = (e as any).status as number | undefined;
      const message =
        status === 401
          ? "Acceso denegado: falta el token de acceso o ha expirado. Por favor, configúralo en la sección técnica (⚙️)."
          : (e as Error).message || "Error llamando al modelo";
      // Registrar el fallo en la sesión de ORIGEN (métrica de fiabilidad/UX: 502,
      // 429…). Aunque luego se reintente con éxito, queda el rastro de cuántas
      // veces falló. Se persiste con la conversación si ya hay turnos.
      const live = sessionsRef.current.find((s) => s.id === session.id);
      if (live) {
        const nextLog: SessionError[] = [
          ...(live.errorLog ?? []),
          { at: Date.now(), status, message: (e as Error).message || message },
        ];
        updateSession(session.id, { errorLog: nextLog });
        saveConversation({ ...live, errorLog: nextLog }, live.messages, { closed: live.closed });
      }
      // Mostrar el error solo si la sesión de origen sigue activa; en otra
      // sesión el banner (y su «Reintentar») no corresponderían a lo visible.
      if (activeSessionIdRef.current === session.id) {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  function startWithGreeting() {
    // Arranca el cronómetro: el saludo del avatar es el primer turno de la sesión.
    updateActiveSession({
      messages: [],
      promptChars: null,
      closed: false,
      startedAt: Date.now(),
      completedAt: undefined,
      errorLog: [],
    });
    callChat([], true);
  }

  function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next = [...messages, { role: "user" as const, content: text }];
    // Si el usuario escribe directo sin usar "Que inicie el avatar", el
    // cronómetro arranca en su primer mensaje.
    updateActiveSession(
      activeSession.startedAt ? { messages: next } : { messages: next, startedAt: Date.now() }
    );
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
    opts?: { closed?: boolean; model?: string | null; satisfaction?: SatisfactionInfo | null }
  ) {
    if (!msgs.length) return;
    // Telemetría de la sesión para "que quede registrado": tiempo real que llevó
    // (cronómetro) y errores del proveedor (502, 429…). Si sigue viva, la duración
    // se calcula hasta ahora; si terminó (completedAt), hasta el cierre.
    const errs = session.errorLog ?? [];
    const durationSeconds = session.startedAt
      ? Math.round(((session.completedAt ?? Date.now()) - session.startedAt) / 1000)
      : undefined;
    chatLabFetch("/api/chat/conversation", {
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
        // Cronómetro (snake_case para el backend).
        started_at: session.startedAt ? new Date(session.startedAt).toISOString() : undefined,
        duration_seconds: durationSeconds,
        // Fiabilidad: conteo + detalle de los errores del proveedor.
        error_count: errs.length,
        errors: errs.map((e) => ({
          at: new Date(e.at).toISOString(),
          status: e.status ?? null,
          message: e.message,
        })),
        messages: msgs.map((m) => ({ role: m.role, content: m.content })),
        feedback: msgs.map((m) => m.feedback ?? null),
        // Comentario del dislike alineado por índice con messages.
        feedback_comments: msgs.map((m) => m.feedbackComment ?? null),
        // Encuesta de satisfacción del diagnóstico (snake_case para el backend).
        satisfaction: opts?.satisfaction ?? session.satisfaction
          ? {
              rating: (opts?.satisfaction ?? session.satisfaction)!.rating,
              comment: (opts?.satisfaction ?? session.satisfaction)!.comment,
              submitted_at: (opts?.satisfaction ?? session.satisfaction)!.submittedAt,
            }
          : undefined,
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

  // Abre el modal para comentar POR QUÉ no gustó la respuesta (tras el 👎).
  // Prefila con el comentario ya existente para poder editarlo.
  function openFeedbackModal(index: number) {
    setFeedbackDraft(messages[index]?.feedbackComment ?? "");
    setFeedbackModalIndex(index);
  }

  // Guarda (o limpia) el comentario del dislike en el mensaje y lo persiste.
  function saveFeedbackComment() {
    if (feedbackModalIndex === null) return;
    const idx = feedbackModalIndex;
    const text = feedbackDraft.trim();
    const next = messages.map((m, i) =>
      i === idx ? { ...m, feedbackComment: text || undefined } : m
    );
    updateActiveSession({ messages: next });
    saveConversation(activeSession, next);
    setFeedbackModalIndex(null);
    setFeedbackDraft("");
  }

  // Envía la encuesta de satisfacción del diagnóstico y la persiste con la sesión.
  function submitSatisfaction() {
    if (satRating < 1) return;
    const info: SatisfactionInfo = {
      rating: satRating,
      comment: satComment.trim(),
      submittedAt: new Date().toISOString(),
    };
    updateActiveSession({ satisfaction: info });
    saveConversation(activeSession, activeSession.messages, { satisfaction: info });
    setShowSatisfaction(false);
  }

  // Abre el modal de satisfacción prefilando con lo ya enviado (para editarlo).
  function openSatisfaction() {
    setSatRating(activeSession.satisfaction?.rating ?? 0);
    setSatComment(activeSession.satisfaction?.comment ?? "");
    setSatHover(0);
    setShowSatisfaction(true);
  }

  // Cierra el diagnóstico; si el usuario aún no ha calificado, encadena la
  // encuesta de satisfacción (así se pide "al final, tras ver el diagnóstico").
  function closeDiag() {
    setShowDiag(false);
    if (!activeSession.satisfaction) {
      openSatisfaction();
    }
  }

  async function generateDiagnostico() {
    // Igual que callChat: el resultado va a la sesión que lo pidió, aunque el
    // usuario cambie de sesión mientras el análisis corre (~10-20s).
    const session = activeSession;
    if (diagLoading || session.messages.length === 0) return;
    setDiagLoading(true);
    setError(null);
    try {
      const res = await chatLabFetch<DiagnosticoResponse>("/api/chat/diagnostico", {
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
        // Generar el diagnóstico cierra la sesión: congela el cronómetro si el
        // avatar no lo había cerrado ya.
        completedAt: session.completedAt ?? Date.now(),
      });
      // Persistir el cronómetro final (duración total) en la conversación de BD.
      const completedAt = session.completedAt ?? Date.now();
      saveConversation({ ...session, completedAt }, session.messages);
      // Abrir el modal solo si el usuario sigue viendo esta sesión.
      if (activeSessionIdRef.current === session.id) {
        setShowDiag(true);
      }
    } catch (e) {
      if (activeSessionIdRef.current === session.id) {
        if ((e as any).status === 401) {
          setError("Acceso denegado: falta el token de acceso o ha expirado. Por favor, configúralo en la sección técnica (⚙️).");
        } else {
          setError((e as Error).message || "Error generando diagnóstico");
        }
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
      name: (() => {
        const maxNum = sessions.reduce((max, s) => {
          const m = s.name.match(/^Sesión (\d+)$/);
          return m ? Math.max(max, parseInt(m[1])) : max;
        }, 0);
        return `Sesión ${maxNum + 1}`;
      })(),
      avatarId: defaultAvatar,
      provider: "gemini",
      selectedModel: "gemini-2.5-flash",
      level: "principiante",
      messages: [],
      promptChars: null,
      closed: false,
      createdAt: Date.now(),
      durationMin: DEFAULT_DURATION,
    };
    const next = [...sessions, newSession];
    setSessions(next);
    try {
      localStorage.setItem("chatlab_sessions", JSON.stringify(next));
    } catch (e) {
      console.warn("No se pudo guardar sesiones en localStorage:", e);
    }
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
    try {
      localStorage.setItem("chatlab_sessions", JSON.stringify(remaining));
    } catch (e) {
      console.warn("No se pudo guardar sesiones en localStorage:", e);
    }
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
      try {
        localStorage.setItem("chatlab_sessions", JSON.stringify(next));
      } catch (e) {
        console.warn("No se pudo guardar sesiones en localStorage:", e);
      }
      return next;
    });
    setEditingSessionId(null);
  }

  function exportSession(session: ChatSession) {
    const sessionAvatar = avatars.find((a) => a.id === session.avatarId);
    const avatarName = sessionAvatar?.name || session.avatarId;
    const isDiagSession = sessionAvatar?.kind === "diagnostico";
    const reg = { ...savedRegistro, ...(session.registro || {}) };

    let content = `# Reporte de Laboratorio: ${session.name}\n`;
    content += `Fecha: ${new Date(session.createdAt).toLocaleDateString()}\n`;
    content += `Avatar simulado: ${avatarName}\n`;
    content += `Motor / Proveedor: ${session.provider === "gemini" ? "Gemini" : (session.provider === "chatgpt" ? "ChatGPT (OpenAI)" : "Groq")}\n`;
    if (session.modelName) {
      content += `Modelo específico: ${session.modelName}\n`;
    }
    content += `Nivel: ${session.level}\n`;
    if (isDiagSession) {
      content += `Candidato: ${reg.nombre || "N/A"}\n`;
      content += `Rol objetivo: ${reg.rol_objetivo || "N/A"}\n`;
      content += `Industria: ${reg.industria || "N/A"}\n`;
      const nivelLabels: Record<string, string> = {
        entry: "Entry",
        junior: "Junior",
        mid: "Semi-Senior",
        senior: "Senior",
        lead: "Lead",
        executive: "Ejecutivo",
      };
      content += `Nivel de experiencia: ${
        reg.experience_level ? nivelLabels[reg.experience_level] ?? reg.experience_level : "N/A"
      }\n`;
      content += `Duración simulada: ${session.durationMin ?? DEFAULT_DURATION} min\n`;
    }
    content += `Caracteres Prompt: ${session.promptChars || "N/A"}\n`;
    const totalCost = sessionCostUsd(session);
    if (totalCost > 0) {
      content += `Costo estimado de la sesión: ~${fmtUsd(totalCost)} USD (on-demand, sin cache)\n`;
    }
    // Tiempo real que llevó la sesión (cronómetro), si arrancó.
    if (session.startedAt) {
      const durMs = (session.completedAt ?? Date.now()) - session.startedAt;
      const estado = session.completedAt ? "" : " (en curso)";
      content += `Tiempo de realización: ${fmtDuration(durMs)} (mm:ss)${estado}\n`;
    }
    // Fiabilidad: errores del proveedor durante la sesión.
    const sessErrs = session.errorLog ?? [];
    content += `Errores durante la sesión: ${sessErrs.length}`;
    if (sessErrs.length) {
      const server5xx = sessErrs.filter((e) => (e.status ?? 0) >= 500).length;
      content += ` (${server5xx} de servidor/502)`;
    }
    content += `\n`;
    content += `\n`;
    if (sessErrs.length) {
      content += `## Registro de Errores\n\n`;
      sessErrs.forEach((e) => {
        const hora = new Date(e.at).toLocaleTimeString();
        content += `- [${hora}] ${e.status ? `HTTP ${e.status}` : "sin código"}: ${e.message}\n`;
      });
      content += `\n`;
    }
    content += `## Historial de Turnos de Prueba\n\n`;

    if (session.messages.length === 0) {
      content += `*No hay mensajes registrados en esta sesión.*\n`;
    } else {
      session.messages.forEach((m) => {
        const roleLabel = m.role === "user" ? "Usuario" : avatarName;
        const latency = m.latencyMs !== undefined ? ` _(${(m.latencyMs / 1000).toFixed(1)}s)_` : "";
        const fb = m.feedback === "like" ? " 👍" : m.feedback === "dislike" ? " 👎" : "";
        content += `**[${roleLabel.toUpperCase()}]**${latency}${fb}:\n${m.content}\n`;
        if (m.feedbackComment) {
          content += `> 💬 _Comentario del usuario (por qué no gustó):_ ${m.feedbackComment}\n`;
        }
        content += `\n---\n\n`;
      });
    }

    if (session.satisfaction) {
      const sat = session.satisfaction;
      content += `\n## Satisfacción del Diagnóstico\n\n`;
      content += `Valoración: ${"★".repeat(sat.rating)}${"☆".repeat(5 - sat.rating)} (${sat.rating}/5)\n`;
      if (sat.comment) {
        content += `Comentario: ${sat.comment}\n`;
      }
      content += `\n`;
    }

    if (session.diagnostico) {
      const diag = session.diagnostico;
      content += `\n## Diagnóstico\n\n`;
      if (diag.resumen_ejecutivo) {
        content += `### Resumen Ejecutivo\n${diag.resumen_ejecutivo}\n\n`;
      }
      if (diag.competencias_foco && diag.competencias_foco.length > 0) {
        content += `### Competencias Foco\n${diag.competencias_foco.map(c => `- ${c}`).join("\n")}\n\n`;
      }
      if (diag.strengths && diag.strengths.length > 0) {
        content += `### Fortalezas\n`;
        diag.strengths.forEach((s) => {
          content += `- **${s.skill}**:\n`;
          content += `  - *Evidencia*: ${s.evidence}\n`;
          content += `  - *Por qué importa*: ${s.why_matters}\n`;
        });
        content += `\n`;
      }
      if (diag.gaps && diag.gaps.length > 0) {
        content += `### Gaps / Áreas de Oportunidad\n`;
        diag.gaps.forEach((g) => {
          content += `- **${g.skill}**:\n`;
          content += `  - *Evidencia*: ${g.evidence}\n`;
          content += `  - *Impacto*: ${g.impact}\n`;
          content += `  - *Micro-práctica recomendada*: ${g.micro_practice}\n`;
        });
        content += `\n`;
      }
      if (diag.blind_spot) {
        content += `### Punto Ciego\n${diag.blind_spot}\n\n`;
      }
      if (diag.reflection_question) {
        content += `### Pregunta de Reflexión\n${diag.reflection_question}\n\n`;
      }
      if (diag.coach_note) {
        content += `### Nota del Coach\n${diag.coach_note}\n\n`;
      }
      if (diag.verbal_patterns) {
        const vp = diag.verbal_patterns;
        content += `### Patrones Verbales\n`;
        if (vp.vague_verbs_detected && vp.vague_verbs_detected.length > 0) {
          content += `- **Verbos vagos detectados**: ${vp.vague_verbs_detected.join(", ")}\n`;
        }
        if (vp.we_vs_i_tendency) {
          content += `- **Tendencia "Nosotros" vs "Yo"**: ${vp.we_vs_i_tendency}\n`;
        }
        if (vp.filler_frequency) {
          content += `- **Frecuencia de muletillas**: ${vp.filler_frequency}\n`;
        }
        content += `\n`;
      }
      if (diag.recommended_next_scenario) {
        content += `### Siguiente Práctica Recomendada\n`;
        content += `- **Escenario**: ${diag.recommended_next_scenario}\n`;
        if (diag.recommended_next_level) {
          content += `- **Nivel**: ${diag.recommended_next_level}\n`;
        }
        content += `\n`;
      }
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
            onClick={() => navigate("/voice-lab")}
            className="text-xs font-syne text-teal hover:text-cream px-3 py-1.5 rounded-lg border border-teal/25 hover:bg-teal/10 transition-all flex items-center gap-1.5"
          >
            🎙️ Voz
          </button>
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

              {/* Token de Acceso */}
              <div className="space-y-1.5 pt-2 border-t border-white/5">
                <label className="text-[11px] text-muted font-mono">TOKEN DE ACCESO</label>
                <input
                  type="password"
                  value={chatlabToken}
                  onChange={(e) => handleTokenChange(e.target.value)}
                  placeholder="Introduce el token de acceso..."
                  className="w-full bg-ink border border-white/10 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-violet focus:ring-1 focus:ring-violet/30 transition-all text-cream placeholder-subtle/40"
                />
                <p className="text-[10px] text-subtle leading-normal">
                  Requerido en producción para evitar consumos no autorizados. Se guarda localmente.
                </p>
              </div>
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

              {/* Cronómetro: tiempo real que llevó la sesión. */}
              <div className="flex justify-between items-center border-t border-white/5 pt-2">
                <span className="text-muted">Tiempo de sesión:</span>
                {activeSession.startedAt ? (
                  <span className={`font-bold ${activeSession.completedAt ? "text-cream" : "text-teal"}`}>
                    {fmtDuration(elapsedMs)}
                    {!activeSession.completedAt && <span className="text-subtle"> ⏱</span>}
                  </span>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </div>

              {/* Fiabilidad: errores del proveedor durante la sesión (502…). */}
              <div className="flex justify-between items-center border-t border-white/5 pt-2">
                <span className="text-muted">Errores (502 / total):</span>
                <span className={`font-bold ${errorLog.length ? "text-danger" : "text-teal"}`}>
                  {serverErrorCount} / {errorLog.length}
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

          {/* Barra de progreso hacia el diagnóstico (solo Sofia, ya iniciada).
              La completa el esfuerzo del usuario: al alcanzar la meta de
              intercambios llega a 100% y aparece el botón para terminar (ya no
              depende de que Sofia emita [CIERRE] por su cuenta). */}
          {isDiagnostico && messages.length > 0 && (
            <div className="bg-deep/20 px-6 py-2.5 border-b border-white/5">
              <div className="max-w-3xl mx-auto w-full">
                <div className="flex items-center justify-between text-[11px] mb-1.5">
                  <span className="font-syne font-semibold text-cream flex items-center gap-1.5">
                    {closed
                      ? "✅ Diagnóstico listo"
                      : reachedTarget
                      ? "✅ Ya tienes suficiente para tu diagnóstico"
                      : "🎯 Progreso hacia tu diagnóstico"}
                  </span>
                  <span className="font-mono text-muted">
                    {progressPct}%
                    {activeSession.startedAt && <> · ⏱ {fmtDuration(elapsedMs)}</>}
                    <> · {durationMin} min</>
                  </span>
                </div>
                <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      progressComplete ? "bg-success" : "bg-gradient-to-r from-teal to-violet"
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 mt-1.5">
                  <p className="text-[10px] text-subtle leading-normal flex-1">
                    {progressComplete
                      ? diagnostico
                        ? "Tu diagnóstico está generado — ábrelo con «Ver último diagnóstico»."
                        : closed
                        ? "Sofia cerró la entrevista. Genera tu reporte cuando quieras."
                        : "Llegaste a la meta de intercambios. Puedes seguir charlando o generar ya tu diagnóstico."
                      : `Cuéntale historias concretas; a más detalle, mejor diagnóstico. Vas ${exchanges} de ~${progressTarget} intercambios.`}
                  </p>
                  {/* CTA de cierre: aparece al completar (por meta o por cierre de
                      Sofia) mientras aún no exista diagnóstico. Da un final claro
                      al usuario en vez de dejar la barra "colgada". */}
                  {progressComplete && !diagnostico && (
                    <button
                      onClick={generateDiagnostico}
                      disabled={diagLoading}
                      className="shrink-0 font-syne font-bold text-[11px] py-1.5 px-3 rounded-lg bg-teal text-ink hover:bg-teal/80 disabled:opacity-50 transition-all flex items-center gap-1.5 active:scale-95"
                      title="Corre el análisis de producción sobre esta conversación"
                    >
                      {diagLoading ? "🔬 Analizando…" : "🔬 Terminar y generar diagnóstico"}
                    </button>
                  )}
                </div>
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

                          {/* Tras el 👎: ícono de info para contar por qué no gustó.
                              Se resalta si ya hay un comentario guardado. */}
                          {m.feedback === "dislike" && (
                            <button
                              onClick={() => openFeedbackModal(i)}
                              className={`flex items-center gap-1 p-1 rounded-md transition-all ${
                                m.feedbackComment
                                  ? "text-teal bg-teal/10"
                                  : "text-subtle hover:text-cream hover:bg-white/5 animate-pulse-slow"
                              }`}
                              title={m.feedbackComment ? "Editar tu comentario" : "¿Por qué no te gustó? (opcional)"}
                            >
                              <Info className="w-3.5 h-3.5" />
                              {m.feedbackComment && (
                                <span className="text-[9px] font-mono">nota</span>
                              )}
                            </button>
                          )}
                        </div>
                      )}

                      {/* Comentario del dislike, ya guardado (visible inline). */}
                      {m.role === "assistant" && m.feedbackComment && (
                        <div className="flex items-start gap-1.5 mt-0.5 px-2 py-1.5 rounded-lg bg-danger/5 border border-danger/15 text-[11px] text-danger/90 leading-snug max-w-full">
                          <MessageSquareText className="w-3 h-3 mt-0.5 shrink-0" />
                          <span className="italic">{m.feedbackComment}</span>
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
                    if (e.nativeEvent.isComposing) return;
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
          onClick={closeDiag}
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
                onClick={closeDiag}
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
                      onClick={openSatisfaction}
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
                      onClick={openSatisfaction}
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
      )}

      {/* Modal: ¿Por qué no te gustó? (comentario del dislike) */}
      {feedbackModalIndex !== null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/80 backdrop-blur-sm p-4"
          onClick={() => setFeedbackModalIndex(null)}
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
                  onClick={() => setFeedbackModalIndex(null)}
                  className="w-7 h-7 shrink-0 rounded-lg bg-white/5 hover:bg-white/10 text-muted hover:text-cream flex items-center justify-center transition-all"
                >
                  ✕
                </button>
              </div>

              <textarea
                value={feedbackDraft}
                onChange={(e) => setFeedbackDraft(e.target.value)}
                autoFocus
                rows={4}
                placeholder="Ej. Repitió una pregunta anterior / sonó robótico / no entendió el contexto…"
                className="w-full bg-ink border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-cream placeholder-subtle focus:outline-none focus:border-danger/50 focus:ring-1 focus:ring-danger/30 resize-none leading-relaxed"
              />

              <div className="flex items-center justify-end gap-2">
                {messages[feedbackModalIndex]?.feedbackComment && (
                  <button
                    onClick={() => { setFeedbackDraft(""); }}
                    className="text-[11px] font-syne text-muted hover:text-danger px-2 py-1 rounded-lg transition-all mr-auto"
                    title="Borrar el texto"
                  >
                    Limpiar
                  </button>
                )}
                <button
                  onClick={() => setFeedbackModalIndex(null)}
                  className="text-xs font-syne text-muted hover:text-cream px-3 py-2 rounded-xl border border-white/10 hover:bg-white/5 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={saveFeedbackComment}
                  className="text-xs font-syne font-bold bg-violet text-white hover:bg-violet-light px-4 py-2 rounded-xl transition-all active:scale-95"
                >
                  Guardar comentario
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Satisfacción del diagnóstico (estrellas + comentario opcional) */}
      {showSatisfaction && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/80 backdrop-blur-sm p-4"
          onClick={() => setShowSatisfaction(false)}
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
                    onClick={() => setSatRating(n)}
                    onMouseEnter={() => setSatHover(n)}
                    onMouseLeave={() => setSatHover(0)}
                    className="p-1 transition-transform hover:scale-110 active:scale-95"
                    title={`${n} de 5`}
                  >
                    <Star
                      className={`w-8 h-8 transition-colors ${
                        n <= (satHover || satRating) ? "text-warning fill-warning" : "text-white/15"
                      }`}
                    />
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] text-muted font-mono">COMENTARIO (opcional)</label>
                <textarea
                  value={satComment}
                  onChange={(e) => setSatComment(e.target.value)}
                  rows={3}
                  placeholder="¿Qué te gustó o qué mejorarías del diagnóstico?"
                  className="w-full bg-ink border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-cream placeholder-subtle focus:outline-none focus:border-violet/50 focus:ring-1 focus:ring-violet/30 resize-none leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowSatisfaction(false)}
                  className="text-xs font-syne text-muted hover:text-cream px-3 py-2 rounded-xl border border-white/10 hover:bg-white/5 transition-all"
                >
                  Ahora no
                </button>
                <button
                  onClick={submitSatisfaction}
                  disabled={satRating < 1}
                  className="text-xs font-syne font-bold bg-violet text-white hover:bg-violet-light disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-xl transition-all active:scale-95"
                >
                  Enviar opinión
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
