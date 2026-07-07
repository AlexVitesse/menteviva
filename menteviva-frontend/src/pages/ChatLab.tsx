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
}

interface ChatResponse {
  reply: string;
  closing: boolean;
  prompt_chars: number;
  provider: string;
}

const LEVELS = ["principiante", "intermedio", "avanzado"];

// Motor del LLM a evaluar. "gemini" reproduce el prompt conciso + addendum de
// voz contra el modelo Gemini de texto (como en la llamada de voz, sin audio);
// solo aplica al diagnostico (Sofia). "groq" = prompt maestro + gpt-oss.
type Provider = "groq" | "gemini";

export function ChatLab() {
  const [avatars, setAvatars] = useState<AvatarInfo[]>([]);
  const [avatarId, setAvatarId] = useState<string>("");
  const [provider, setProvider] = useState<Provider>("groq");
  const [level, setLevel] = useState<string>("principiante");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptChars, setPromptChars] = useState<number | null>(null);
  const [closed, setClosed] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Cargar lista de avatares (incluye al entrevistador/Sofia).
  useEffect(() => {
    apiFetch<{ avatars: AvatarInfo[] }>("/api/chat/avatars")
      .then((data) => {
        setAvatars(data.avatars);
        if (data.avatars.length && !avatarId) setAvatarId(data.avatars[0].id);
      })
      .catch((e) => setError(`No se pudo cargar avatares: ${e.message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll al ultimo mensaje.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, loading]);

  const selected = avatars.find((a) => a.id === avatarId);

  function reset() {
    setMessages([]);
    setError(null);
    setPromptChars(null);
    setClosed(false);
  }

  async function callChat(history: ChatMsg[], greet: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<ChatResponse>("/api/chat", {
        method: "POST",
        json: {
          avatar_id: avatarId,
          provider,
          messages: history,
          greet,
          level: selected?.supports_levels ? level : undefined,
        },
      });
      setMessages((m) => [...m, { role: "assistant", content: res.reply }]);
      setPromptChars(res.prompt_chars);
      if (res.closing) setClosed(true);
    } catch (e) {
      setError((e as Error).message || "Error llamando al modelo");
    } finally {
      setLoading(false);
    }
  }

  function startWithGreeting() {
    reset();
    callChat([], true);
  }

  function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    callChat(next, false);
  }

  return (
    <div className="min-h-screen bg-ink text-cream flex flex-col">
      {/* Header / controles */}
      <header className="border-b border-white/10 bg-card/60 backdrop-blur px-4 py-3">
        <div className="max-w-3xl mx-auto flex flex-wrap items-center gap-3">
          <span className="font-syne font-bold text-lg">🧪 ChatLab</span>
          <span className="text-xs text-muted">prueba de prompts (solo texto)</span>

          <div className="flex-1" />

          <select
            value={avatarId}
            onChange={(e) => {
              setAvatarId(e.target.value);
              reset();
            }}
            className="bg-ink border border-white/15 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet"
          >
            {avatars.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} {a.role ? `· ${a.role}` : ""}
              </option>
            ))}
          </select>

          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as Provider);
              reset();
            }}
            title="Groq = prompt maestro + gpt-oss · Gemini = prompt conciso de voz (sin audio)"
            className="bg-ink border border-white/15 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet"
          >
            <option value="groq">Groq · prompt maestro</option>
            <option value="gemini">Gemini · voz (sin audio)</option>
          </select>

          {selected?.supports_levels && (
            <select
              value={level}
              onChange={(e) => {
                setLevel(e.target.value);
                reset();
              }}
              className="bg-ink border border-white/15 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet"
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={startWithGreeting}
            disabled={loading || !avatarId}
            className="font-syne font-bold text-xs px-3 py-1.5 rounded-lg bg-violet text-white hover:bg-violet-light disabled:opacity-40 transition-colors"
          >
            Que inicie el avatar
          </button>
          <button
            onClick={reset}
            disabled={loading}
            className="font-syne text-xs px-3 py-1.5 rounded-lg border border-white/15 hover:bg-white/5 disabled:opacity-40 transition-colors"
          >
            Limpiar
          </button>
        </div>
      </header>

      {/* Mensajes */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-4">
          {messages.length === 0 && !loading && (
            <p className="text-center text-muted text-sm mt-12">
              Elige un avatar y escribe un mensaje, o pulsa{" "}
              <span className="text-cream">«Que inicie el avatar»</span>.
            </p>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-violet text-white rounded-br-sm"
                    : "bg-card border border-white/10 text-cream rounded-bl-sm"
                }`}
              >
                {!!selected && m.role === "assistant" && (
                  <div className="text-[11px] text-muted font-syne mb-1">
                    {selected.name}
                  </div>
                )}
                {m.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-card border border-white/10 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm text-muted">
                pensando…
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pie: estado + input */}
      <footer className="border-t border-white/10 bg-card/60 backdrop-blur px-4 py-3">
        <div className="max-w-3xl mx-auto flex flex-col gap-2">
          <div className="flex items-center gap-3 text-[11px] text-muted">
            <span>motor: {provider === "gemini" ? "Gemini (voz, sin audio)" : "Groq (maestro)"}</span>
            {promptChars !== null && <span>prompt: {promptChars.toLocaleString()} chars</span>}
            {provider === "gemini" && selected && selected.kind !== "diagnostico" && (
              <span className="text-warning">
                este avatar no tiene prompt de voz propio → usa el maestro
              </span>
            )}
            {closed && (
              <span className="text-warning">el avatar marcó cierre</span>
            )}
            {error && <span className="text-danger">{error}</span>}
          </div>
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Escribe tu mensaje… (Enter envía, Shift+Enter salto de línea)"
              className="flex-1 resize-none bg-ink border border-white/15 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet"
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="font-syne font-bold text-sm px-5 rounded-xl bg-violet text-white hover:bg-violet-light disabled:opacity-40 transition-colors"
            >
              Enviar
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
