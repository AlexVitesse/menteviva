import { useCallback, useRef, useEffect, useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import type { WsInitPayload } from "./useWebSocket";
import { PCMStreamPlayer, int16BufferToBase64, pcm16Rms } from "../utils/pcm";

// Echo-gate: mientras el avatar habla, solo dejamos pasar el mic si su energia
// supera el "piso de eco" * margen. El piso se adapta al eco real (en audifonos
// queda ~0 -> gate permisivo; en altavoces sube -> filtra el eco). Conserva el
// barge-in real (voz fuerte). Constantes empiricas — tunear probando en altavoz.
const ECHO_MARGIN = 3.0; // la voz debe superar el piso * esto para pasar
const FLOOR_FAST = 0.08; // EMA del piso sobre chunks bajo el gate (eco)
const FLOOR_SLOW = 0.008; // EMA lento sobre chunks sobre el gate (por si es eco fuerte sostenido)
const ECHO_FLOOR_INIT = 0.003;
// Hold-over: el gate sigue activo este tiempo despues de que el avatar "callo"
// (status del store) y se enciende desde el PRIMER audio chunk recibido — los
// eventos speaking/silent (player local o Simli) llegan con latencia y dejaban
// ventanas donde el eco pasaba sin filtrar.
const ECHO_HOLDOVER_MS = 300;
// Pre-roll: cuantos chunks (~100 ms c/u) descartados por el gate se retienen
// por si el siguiente chunk resulta ser voz real — sin esto el arranque de la
// frase del barge-in (baja energia) se perdia y la transcripcion quedaba coja.
const PREROLL_CHUNKS = 2;

/**
 * useGeminiLive: sesion de voz en tiempo real contra el proxy de Gemini Live.
 *
 * A diferencia de useWebSocket (push-to-talk: un blob webm por turno + TTS MP3),
 * aqui el flujo es CONTINUO:
 *   - Captura el mic sin parar (AudioWorklet -> PCM16 16 kHz -> audio_chunk).
 *   - Reproduce el audio nativo del avatar (PCM24) conforme llega, con barge-in.
 *   - Reconstruye los mensajes desde los transcripts (user_message / output_transcript).
 *
 * Comparte el mismo store (status/messages/metrics/serverError) que el modo
 * Groq, asi la UI de Simulation se reutiliza. Ver app/routers/conversation.py
 * (rama realtime_provider=="gemini") y docs/plans/05_gemini_live_voice.md.
 */

function getWsBaseUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

/**
 * Destino alternativo del audio del avatar (ej. Simli, que lo convierte en
 * video lip-synced). Si esta activo, los chunks PCM24k NO se reproducen en
 * el player local — la voz sale por el destino (sincronizada con su video).
 * Si isActive() es false (ej. Simli fallo), se cae al player local solo.
 */
export interface GeminiAudioSink {
  isActive: () => boolean;
  sendPcm24k: (b64: string) => void;
  interrupt: () => void;
  /**
   * Opcional: aviso de fin de turno del avatar (no llegan mas chunks de esta
   * frase). El sink OSS lo usa para disparar la sintesis sin esperar su
   * watchdog de silencio; Simli no lo implementa (barra baja del contrato).
   */
  endUtterance?: () => void;
}

interface UseGeminiLiveOptions {
  avatarId: string | undefined;
  initPayload?: WsInitPayload;
  audioSink?: GeminiAudioSink | null;
  // El avatar llamó la tool de cierre (finalizar_entrevista) -> el backend manda
  // closing_intent. El consumer decide qué hacer (countdown + endSession).
  onClosingIntent?: () => void;
}

type AudioCtxCtor = typeof AudioContext;

export function useGeminiLive({ avatarId, initPayload, audioSink, onClosingIntent }: UseGeminiLiveOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<PCMStreamPlayer | null>(null);
  // Ref para que el handler del WS siempre vea el sink actual sin re-conectar.
  const audioSinkRef = useRef(audioSink);

  // Captura
  const captureCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micMutedRef = useRef(false);

  // Texto del avatar en curso (se acumula desde output_transcript hasta turn_complete)
  const assistantTextRef = useRef("");
  const initPayloadRef = useRef(initPayload);
  const onClosingIntentRef = useRef(onClosingIntent);

  // Echo-gate: estado del piso de eco + si el avatar esta hablando ahora. El
  // "hablando" se toma del status del store (lo setea tanto el player local como
  // los eventos de Simli), asi funciona en ambos modos.
  const echoFloorRef = useRef(ECHO_FLOOR_INIT);
  const avatarSpeakingRef = useRef(false);
  // C3: timestamp hasta el cual el gate sigue activo (hold-over / primer chunk).
  const echoHoldUntilRef = useRef(0);
  // T4: ultimos chunks descartados por el gate (pre-roll del barge-in).
  const gatePrerollRef = useRef<ArrayBuffer[]>([]);

  // Mensajes de Sofia COMPLETADOS (turn_complete) pero cuya voz sigue SONANDO.
  // turn_complete marca el fin de la GENERACION; el playback (cola PCM o Simli)
  // dura varios segundos mas. Sin esta cola, el texto aparece en el chat antes
  // de que Sofia termine de hablar (desync texto/voz). Se vacian cuando el
  // avatar deja de sonar (o en cierre/desconexion para no perder mensajes).
  const pendingAssistantMsgsRef = useRef<string[]>([]);

  // Compuerta de envio de audio. Arranca CERRADA: si enviamos audio del mic de
  // inmediato, Gemini cree que el usuario esta tomando el turno y no saluda.
  // Se abre al primer turn_complete (Sofia ya saludo) o por timeout de respaldo.
  const audioGateOpenRef = useRef(false);
  const gateTimerRef = useRef<number | null>(null);

  // AnalyserNode del reproductor PCM, expuesto para el lip-sync del avatar 3D.
  // Se setea al conectar (cuando se crea el player) y se limpia al desconectar.
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  // True cuando el avatar ya completó su saludo inicial. Antes de eso la UI debe
  // pedir al usuario que espere (no "te escucho"), para que no hable en el vacío
  // durante la latencia del primer turno y sienta que él inició.
  const [hasGreeted, setHasGreeted] = useState(false);

  const { setStatus, addMessage, setMetrics, setServerError } = useSessionStore();

  useEffect(() => {
    initPayloadRef.current = initPayload;
  }, [initPayload]);

  useEffect(() => {
    audioSinkRef.current = audioSink;
  }, [audioSink]);

  useEffect(() => {
    onClosingIntentRef.current = onClosingIntent;
  }, [onClosingIntent]);

  // Vacia la cola de mensajes de Sofia retenidos hasta que su voz termine.
  const flushPendingAssistant = useCallback(() => {
    for (const content of pendingAssistantMsgsRef.current) {
      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content,
        timestamp: new Date(),
      });
    }
    pendingAssistantMsgsRef.current = [];
  }, [addMessage]);

  // El avatar esta "hablando" cuando status === generating_audio (lo setea el
  // player local y/o los eventos speaking/silent de Simli). Lo espejamos a un ref
  // para el echo-gate del worklet sin re-render. En la transicion hablando ->
  // silencio se materializan los mensajes retenidos (sync texto/voz).
  useEffect(() => {
    const unsub = useSessionStore.subscribe((s) => {
      const speaking = s.status === "generating_audio";
      const wasSpeaking = avatarSpeakingRef.current;
      avatarSpeakingRef.current = speaking;
      if (wasSpeaking && !speaking) {
        flushPendingAssistant();
        // C3: hold-over — el eco de cola sigue llegando un instante despues
        // de que el playback reporto silencio.
        echoHoldUntilRef.current = performance.now() + ECHO_HOLDOVER_MS;
      }
    });
    return unsub;
  }, [flushPendingAssistant]);

  const connect = useCallback(async () => {
    if (!avatarId) return;

    // Compuerta cerrada hasta que Sofia salude (1er turn_complete). Respaldo:
    // si el saludo no llega en 6s, la abrimos para no dejar al usuario mudo.
    audioGateOpenRef.current = false;
    echoFloorRef.current = ECHO_FLOOR_INIT;
    echoHoldUntilRef.current = 0;
    gatePrerollRef.current = [];
    setHasGreeted(false);
    if (gateTimerRef.current) window.clearTimeout(gateTimerRef.current);
    gateTimerRef.current = window.setTimeout(() => {
      audioGateOpenRef.current = true;
      setHasGreeted(true);
    }, 6000);

    // Reproductor PCM24 (audio nativo del avatar). Reflejamos "hablando" en el
    // status del store para reutilizar el indicador/animacion del avatar.
    const player = new PCMStreamPlayer(24000);
    player.onSpeakingChange = (speaking) => {
      setStatus(speaking ? "generating_audio" : "ready");
    };
    playerRef.current = player;
    setAnalyser(player.analyser);
    await player.resume();

    const wsUrl = `${getWsBaseUrl()}/api/conversation/${avatarId}`;
    console.log("[GeminiLive] Connecting to:", wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[GeminiLive] Connected");
      setStatus("ready");
      // El system_instruction se fija con este init (el backend abre la sesion
      // Live al recibirlo). Mandamos siempre, aunque no haya profile.
      const p = initPayloadRef.current;
      ws.send(JSON.stringify({ type: "init", ...(p || {}) }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "status":
          setStatus(data.status);
          break;

        case "user_message":
          addMessage({
            id: crypto.randomUUID(),
            role: "user",
            content: data.content,
            timestamp: new Date(),
          });
          break;

        case "output_transcript":
          // Caption incremental del avatar; se materializa en turn_complete.
          assistantTextRef.current += data.content || "";
          break;

        case "assistant_audio_chunk": {
          // C3: encender el echo-gate desde el PRIMER chunk — el evento
          // speaking (player/Simli) llega con latencia y el eco no espera.
          echoHoldUntilRef.current = performance.now() + ECHO_HOLDOVER_MS;
          // Con sink activo (Simli conectado) el audio va al video lip-synced;
          // si no (sin Simli o Simli caido), suena por el player local.
          const sink = audioSinkRef.current;
          if (sink?.isActive()) sink.sendPcm24k(data.audio);
          else playerRef.current?.enqueueBase64(data.audio);
          break;
        }

        case "interrupted":
          // Barge-in: el usuario hablo encima -> cortar el playback en curso.
          playerRef.current?.flush();
          audioSinkRef.current?.interrupt();
          break;

        case "turn_complete": {
          // Fin de generacion del turno: no llegan mas assistant_audio_chunk.
          // Avisar al sink OSS para que sintetice sin esperar su watchdog de
          // silencio (~350 ms). Simli no implementa endUtterance -> no-op.
          audioSinkRef.current?.endUtterance?.();
          const text = assistantTextRef.current.trim();
          if (text) {
            // Si la voz sigue sonando (player local o Simli), retener el
            // mensaje hasta el silencio para que texto y voz lleguen juntos.
            if (avatarSpeakingRef.current) {
              pendingAssistantMsgsRef.current.push(text);
            } else {
              addMessage({
                id: crypto.randomUUID(),
                role: "assistant",
                content: text,
                timestamp: new Date(),
              });
            }
          }
          assistantTextRef.current = "";
          // Sofia termino su turno (el saludo, la 1a vez): ya podemos enviar
          // el audio del mic sin pisarle la iniciativa.
          audioGateOpenRef.current = true;
          setHasGreeted(true);
          break;
        }

        case "closing_intent":
          // Sofia llamó finalizar_entrevista: el consumer arranca el countdown.
          onClosingIntentRef.current?.();
          break;

        case "session_end":
          // Materializar lo retenido antes de navegar al reporte.
          flushPendingAssistant();
          setMetrics(data.metrics);
          break;

        case "error":
          setServerError(data.error || "Error en el servidor");
          setStatus("ready");
          break;
      }
    };

    ws.onclose = (e) => {
      console.log("[GeminiLive] Closed:", e.code, e.reason || "(no reason)");
      flushPendingAssistant(); // no perder mensajes retenidos al caerse el WS
      setStatus("disconnected");
    };
    ws.onerror = (e) => {
      console.error("[GeminiLive] WS error:", e);
      setStatus("disconnected");
    };
  }, [avatarId, setStatus, addMessage, setMetrics, setServerError, flushPendingAssistant]);

  /** Arranca la captura continua del microfono. */
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

    // Crear el contexto a 16 kHz: el browser remuestrea el mic a esa tasa, asi
    // el worklet ya recibe 16 kHz (lo que espera Gemini) sin trabajo extra.
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
        ws.send(
          JSON.stringify({ type: "audio_chunk", pcm: int16BufferToBase64(b) })
        );
      }
    };

    node.port.onmessage = (e: MessageEvent) => {
      if (micMutedRef.current) return; // mute = dejar de enviar chunks
      if (!audioGateOpenRef.current) return; // aun no termina el saludo de Sofia
      const buf = e.data as ArrayBuffer;

      // Echo-gate: mientras el avatar habla (o acaba de hablar — hold-over C3),
      // filtra lo que parece eco (energia por debajo del piso adaptativo *
      // margen) y deja pasar el barge-in real. En audifonos el piso queda ~0,
      // asi que esto no estorba.
      const gateActive =
        avatarSpeakingRef.current || performance.now() < echoHoldUntilRef.current;
      if (gateActive) {
        const rms = pcm16Rms(buf);
        const gate = echoFloorRef.current * ECHO_MARGIN;
        if (rms < gate) {
          // Probable eco: adaptar el piso (rapido) y NO enviar. Retener el
          // chunk en el pre-roll (T4) por si el siguiente es voz real — asi
          // no se pierde el arranque (baja energia) de la frase del barge-in.
          echoFloorRef.current += (rms - echoFloorRef.current) * FLOOR_FAST;
          gatePrerollRef.current.push(buf);
          if (gatePrerollRef.current.length > PREROLL_CHUNKS) {
            gatePrerollRef.current.shift();
          }
          return;
        }
        // Sobre el gate: probable voz real. Subimos el piso MUY lento hacia rms
        // por si fuera eco fuerte sostenido (que el gate acabe capturandolo).
        echoFloorRef.current += (rms - echoFloorRef.current) * FLOOR_SLOW;
        // T4: voz real tras chunks gateados -> primero el pre-roll retenido.
        for (const pre of gatePrerollRef.current) sendChunk(pre);
        gatePrerollRef.current = [];
      } else if (gatePrerollRef.current.length) {
        // El avatar ya callo (y paso el hold-over): lo retenido era eco.
        gatePrerollRef.current = [];
      }

      sendChunk(buf);
    };
    source.connect(node);
    // Conectar a un gain en silencio para mantener el nodo en el grafo de
    // render (no queremos monitoreo del propio mic en los altavoces).
    const silent = ctx.createGain();
    silent.gain.value = 0;
    node.connect(silent);
    silent.connect(ctx.destination);
    workletRef.current = node;
    console.log("[GeminiLive] mic capture iniciado (16 kHz)");
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

  /** Mutea/desmutea el mic SIN cerrar la captura (deja de enviar chunks). */
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
    wsRef.current?.close();
    wsRef.current = null;
  }, [stopMic, flushPendingAssistant]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return { connect, startMic, stopMic, setMicMuted, endSession, disconnect, analyser, hasGreeted };
}
