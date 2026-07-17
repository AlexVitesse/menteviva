import { useCallback, useEffect, useRef, useState } from "react";
import { PCMStreamPlayer, int16BufferToBase64, pcm16Rms } from "../utils/pcm";
import { getWebSocketTicket } from "../lib/api";
import { parseServerEvent } from "../types/wsProtocol";

/**
 * useVoiceLab: sesion de voz en tiempo real para el VoiceLab (banco de pruebas
 * de prompts POR VOZ). Es el gemelo callback-driven de useGeminiLive.
 *
 * Diferencias clave con useGeminiLive (por eso es un hook aparte y no un flag):
 *  - NO escribe al sessionStore global. El VoiceLab maneja su estado por-sesion
 *    en localStorage (igual que el ChatLab de texto), asi que este hook reporta
 *    los eventos por CALLBACKS y el consumer los enruta a la sesion activa.
 *  - NO usa audioSink/Simli: la voz del avatar suena SIEMPRE por el player PCM
 *    local (este lab es "sin video").
 *  - Apunta a la ruta dedicada del lab /api/chat/voice/{avatar_id} (que corre
 *    Gemini incondicionalmente y exige el token del ChatLab por query param).
 *
 * El resto (captura continua de mic -> PCM16 16k, echo-gate, audio-gate hasta el
 * saludo, barge-in, sincronia texto/voz) replica useGeminiLive. Ver ese hook y
 * app/routers/conversation.py (voice_lab_websocket).
 */

// Echo-gate (identico a useGeminiLive): mientras el avatar habla, solo dejamos
// pasar el mic si su energia supera el piso de eco * margen. Constantes empiricas.
const ECHO_MARGIN = 3.0;
const FLOOR_FAST = 0.08;
const FLOOR_SLOW = 0.008;
const ECHO_FLOOR_INIT = 0.003;
const ECHO_HOLDOVER_MS = 300;
const PREROLL_CHUNKS = 2;

function getWsBaseUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

export interface VoiceLabInitPayload {
  user_profile?: Record<string, unknown>;
  session_vars?: Record<string, unknown>;
}

interface UseVoiceLabOptions {
  avatarId: string | undefined;
  // Token del ChatLab (localStorage["chatlab_token"]). Viaja como query param
  // porque el WebSocket del navegador no puede mandar headers personalizados.
  chatlabToken?: string;
  initPayload?: VoiceLabInitPayload;
  onUserMessage?: (text: string) => void;
  onAssistantMessage?: (text: string) => void;
  // ready | generating_audio | thinking | analyzing | disconnected | ...
  onStatusChange?: (status: string) => void;
  // El avatar llamo finalizar_entrevista -> el backend manda closing_intent.
  onClosingIntent?: () => void;
  onError?: (msg: string) => void;
  // La sesion termino (session_end del backend, o el WS se cerro). vocalNote es
  // EXPERIMENTAL: lectura de tono/nervios que Gemini extrajo del audio crudo
  // (ver gemini_live.analyze_vocal_tone), presente solo si hubo suficiente audio.
  onEnded?: (vocalNote?: string) => void;
}

type AudioCtxCtor = typeof AudioContext;

export function useVoiceLab({
  avatarId,
  chatlabToken,
  initPayload,
  onUserMessage,
  onAssistantMessage,
  onStatusChange,
  onClosingIntent,
  onError,
  onEnded,
}: UseVoiceLabOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const connectionGenerationRef = useRef(0);
  const playerRef = useRef<PCMStreamPlayer | null>(null);

  // Captura de mic.
  const captureCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micMutedRef = useRef(false);

  // Texto del avatar en curso (output_transcript hasta turn_complete).
  const assistantTextRef = useRef("");

  // Echo-gate.
  const echoFloorRef = useRef(ECHO_FLOOR_INIT);
  const avatarSpeakingRef = useRef(false);
  const echoHoldUntilRef = useRef(0);
  const gatePrerollRef = useRef<ArrayBuffer[]>([]);

  // Mensajes del avatar COMPLETADOS (turn_complete) pero cuya voz sigue sonando.
  // Se materializan cuando el player deja de sonar, para que texto y voz salgan
  // juntos (mismo criterio que useGeminiLive).
  const pendingAssistantMsgsRef = useRef<string[]>([]);

  // Compuerta de envio de audio: arranca CERRADA para no pisarle el saludo al
  // avatar. Se abre en el 1er turn_complete o por timeout de respaldo.
  const audioGateOpenRef = useRef(false);
  const gateTimerRef = useRef<number | null>(null);

  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [hasGreeted, setHasGreeted] = useState(false);

  // Espejos en ref de los callbacks + init, para que los handlers del WS/worklet
  // vean siempre el valor vigente sin re-conectar cuando cambian.
  const cbRef = useRef({
    onUserMessage,
    onAssistantMessage,
    onStatusChange,
    onClosingIntent,
    onError,
    onEnded,
  });
  const initPayloadRef = useRef(initPayload);
  const tokenRef = useRef(chatlabToken);

  useEffect(() => {
    cbRef.current = {
      onUserMessage,
      onAssistantMessage,
      onStatusChange,
      onClosingIntent,
      onError,
      onEnded,
    };
  }, [onUserMessage, onAssistantMessage, onStatusChange, onClosingIntent, onError, onEnded]);

  useEffect(() => {
    initPayloadRef.current = initPayload;
  }, [initPayload]);

  useEffect(() => {
    tokenRef.current = chatlabToken;
  }, [chatlabToken]);

  const flushPendingAssistant = useCallback(() => {
    for (const content of pendingAssistantMsgsRef.current) {
      cbRef.current.onAssistantMessage?.(content);
    }
    pendingAssistantMsgsRef.current = [];
  }, []);

  const connect = useCallback(async () => {
    if (!avatarId) return;
    const current = wsRef.current;
    if (
      current?.readyState === WebSocket.CONNECTING ||
      current?.readyState === WebSocket.OPEN
    ) {
      return;
    }
    const generation = ++connectionGenerationRef.current;

    audioGateOpenRef.current = false;
    echoFloorRef.current = ECHO_FLOOR_INIT;
    echoHoldUntilRef.current = 0;
    gatePrerollRef.current = [];
    avatarSpeakingRef.current = false;
    setHasGreeted(false);
    if (gateTimerRef.current) window.clearTimeout(gateTimerRef.current);
    gateTimerRef.current = window.setTimeout(() => {
      audioGateOpenRef.current = true;
      setHasGreeted(true);
    }, 6000);

    // Reproductor PCM24 (audio nativo del avatar). El "hablando" lo derivamos
    // de aqui: alimenta el echo-gate, el status y la sincronia texto/voz.
    const player = new PCMStreamPlayer(24000);
    player.onSpeakingChange = (speaking) => {
      const was = avatarSpeakingRef.current;
      avatarSpeakingRef.current = speaking;
      cbRef.current.onStatusChange?.(speaking ? "generating_audio" : "ready");
      if (was && !speaking) {
        // Voz terminada: materializar los mensajes retenidos (sync texto/voz) y
        // encender el hold-over del eco (la cola de eco llega un instante despues).
        flushPendingAssistant();
        echoHoldUntilRef.current = performance.now() + ECHO_HOLDOVER_MS;
      }
    };
    playerRef.current = player;
    setAnalyser(player.analyser);
    await player.resume();

    const token = tokenRef.current;
    let ticket = "";
    try {
      ticket = await getWebSocketTicket();
    } catch {
      // Compatibilidad temporal: un laboratorio local puede seguir usando el
      // token compartido aunque Firebase no este configurado.
    }
    const params = new URLSearchParams();
    if (token) params.set("token", token);
    if (ticket) params.set("ticket", ticket);
    const qs = params.size ? `?${params.toString()}` : "";
    const wsUrl = `${getWsBaseUrl()}/api/chat/voice/${avatarId}${qs}`;
    console.log("[VoiceLab] Connecting to:", wsUrl.replace(/token=[^&]*/, "token=***"));
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (generation !== connectionGenerationRef.current || wsRef.current !== ws) {
        ws.close();
        return;
      }
      console.log("[VoiceLab] Connected");
      cbRef.current.onStatusChange?.("ready");
      // El system_instruction se fija con este init (el backend abre la sesion
      // Live al recibirlo). Mandamos siempre, aunque no haya profile.
      const p = initPayloadRef.current;
      ws.send(JSON.stringify({ type: "init", ...(p || {}) }));
    };

    ws.onmessage = (event) => {
      if (generation !== connectionGenerationRef.current || wsRef.current !== ws) return;
      let data;
      try {
        data = parseServerEvent(event.data);
      } catch {
        cbRef.current.onError?.("El servidor envió un mensaje inválido.");
        return;
      }
      switch (data.type) {
        case "status":
          cbRef.current.onStatusChange?.(data.status);
          break;

        case "user_message":
          cbRef.current.onUserMessage?.(data.content);
          break;

        case "output_transcript":
          assistantTextRef.current += data.content || "";
          break;

        case "assistant_audio_chunk":
          // Encender el echo-gate desde el PRIMER chunk (el evento speaking del
          // player llega con latencia y el eco no espera).
          echoHoldUntilRef.current = performance.now() + ECHO_HOLDOVER_MS;
          playerRef.current?.enqueueBase64(data.audio);
          break;

        case "interrupted":
          // Barge-in: cortar el playback en curso.
          playerRef.current?.flush();
          break;

        case "turn_complete": {
          const text = assistantTextRef.current.trim();
          if (text) {
            if (avatarSpeakingRef.current) {
              // La voz sigue sonando: retener hasta el silencio (sync texto/voz).
              pendingAssistantMsgsRef.current.push(text);
            } else {
              cbRef.current.onAssistantMessage?.(text);
            }
          }
          assistantTextRef.current = "";
          // El avatar termino su turno (el saludo, la 1a vez): ya podemos enviar
          // audio del mic sin pisarle la iniciativa.
          audioGateOpenRef.current = true;
          setHasGreeted(true);
          break;
        }

        case "closing_intent":
          cbRef.current.onClosingIntent?.();
          break;

        case "session_end":
          // El backend del lab NO manda metrics (el diagnostico lo hace el
          // frontend por REST). Solo confirma el cierre; vocal_note es
          // experimental y puede venir ausente.
          flushPendingAssistant();
          cbRef.current.onEnded?.(data.vocal_note);
          break;

        case "error":
          cbRef.current.onError?.(data.error || "Error en el servidor");
          cbRef.current.onStatusChange?.("ready");
          break;
      }
    };

    ws.onclose = (e) => {
      console.log("[VoiceLab] Closed:", e.code, e.reason || "(no reason)");
      if (generation !== connectionGenerationRef.current || wsRef.current !== ws) return;
      wsRef.current = null;
      flushPendingAssistant();
      cbRef.current.onStatusChange?.("disconnected");
      // 1008 = token invalido/faltante (policy violation).
      if (e.code === 1008) {
        cbRef.current.onError?.(
          e.reason || "Acceso denegado: token del laboratorio invalido o faltante."
        );
      }
    };
    ws.onerror = (e) => {
      console.error("[VoiceLab] WS error:", e);
      if (generation !== connectionGenerationRef.current || wsRef.current !== ws) return;
      cbRef.current.onStatusChange?.("disconnected");
    };
  }, [avatarId, flushPendingAssistant]);

  /** Arranca la captura continua del microfono (PCM16 16 kHz). */
  const startMic = useCallback(async () => {
    if (captureCtxRef.current) return; // ya activo
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    micStreamRef.current = stream;

    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: AudioCtxCtor }).webkitAudioContext;
    const ctx = new Ctx({ sampleRate: 16000 });
    captureCtxRef.current = ctx;

    await ctx.audioWorklet.addModule("/pcm-capture-worklet.js");
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-capture");
    const sendChunk = (b: ArrayBuffer) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "audio_chunk", pcm: int16BufferToBase64(b) }));
      }
    };

    node.port.onmessage = (e: MessageEvent) => {
      if (micMutedRef.current) return;
      if (!audioGateOpenRef.current) return; // aun no termina el saludo del avatar
      const buf = e.data as ArrayBuffer;

      const gateActive =
        avatarSpeakingRef.current || performance.now() < echoHoldUntilRef.current;
      if (gateActive) {
        const rms = pcm16Rms(buf);
        const gate = echoFloorRef.current * ECHO_MARGIN;
        if (rms < gate) {
          echoFloorRef.current += (rms - echoFloorRef.current) * FLOOR_FAST;
          gatePrerollRef.current.push(buf);
          if (gatePrerollRef.current.length > PREROLL_CHUNKS) {
            gatePrerollRef.current.shift();
          }
          return;
        }
        echoFloorRef.current += (rms - echoFloorRef.current) * FLOOR_SLOW;
        for (const pre of gatePrerollRef.current) sendChunk(pre);
        gatePrerollRef.current = [];
      } else if (gatePrerollRef.current.length) {
        gatePrerollRef.current = [];
      }

      sendChunk(buf);
    };
    source.connect(node);
    const silent = ctx.createGain();
    silent.gain.value = 0;
    node.connect(silent);
    silent.connect(ctx.destination);
    workletRef.current = node;
    console.log("[VoiceLab] mic capture iniciado (16 kHz)");
  }, []);

  const stopMic = useCallback(() => {
    try {
      workletRef.current?.disconnect();
    } catch {
      /* noop */
    }
    workletRef.current = null;
    captureCtxRef.current?.close().catch(() => {});
    captureCtxRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  }, []);

  const setMicMuted = useCallback((muted: boolean) => {
    micMutedRef.current = muted;
  }, []);

  const endSession = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end_session" }));
    }
    stopMic();
  }, [stopMic]);

  const disconnect = useCallback(() => {
    connectionGenerationRef.current += 1;
    if (gateTimerRef.current) {
      window.clearTimeout(gateTimerRef.current);
      gateTimerRef.current = null;
    }
    flushPendingAssistant();
    stopMic();
    playerRef.current?.close();
    playerRef.current = null;
    setAnalyser(null);
    setHasGreeted(false);
    const ws = wsRef.current;
    wsRef.current = null;
    ws?.close();
  }, [stopMic, flushPendingAssistant]);

  useEffect(() => {
    window.addEventListener("menteviva:logout", disconnect);
    return () => {
      window.removeEventListener("menteviva:logout", disconnect);
      disconnect();
    };
  }, [disconnect]);

  return { connect, startMic, stopMic, setMicMuted, endSession, disconnect, analyser, hasGreeted };
}
