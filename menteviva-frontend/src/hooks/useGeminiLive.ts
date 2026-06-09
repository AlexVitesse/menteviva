import { useCallback, useRef, useEffect, useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import type { WsInitPayload } from "./useWebSocket";
import { PCMStreamPlayer, int16BufferToBase64 } from "../utils/pcm";

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
}

interface UseGeminiLiveOptions {
  avatarId: string | undefined;
  initPayload?: WsInitPayload;
  audioSink?: GeminiAudioSink | null;
}

type AudioCtxCtor = typeof AudioContext;

export function useGeminiLive({ avatarId, initPayload, audioSink }: UseGeminiLiveOptions) {
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

  const connect = useCallback(async () => {
    if (!avatarId) return;

    // Compuerta cerrada hasta que Sofia salude (1er turn_complete). Respaldo:
    // si el saludo no llega en 6s, la abrimos para no dejar al usuario mudo.
    audioGateOpenRef.current = false;
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

        case "turn_complete":
          if (assistantTextRef.current.trim()) {
            addMessage({
              id: crypto.randomUUID(),
              role: "assistant",
              content: assistantTextRef.current.trim(),
              timestamp: new Date(),
            });
          }
          assistantTextRef.current = "";
          // Sofia termino su turno (el saludo, la 1a vez): ya podemos enviar
          // el audio del mic sin pisarle la iniciativa.
          audioGateOpenRef.current = true;
          setHasGreeted(true);
          break;

        case "session_end":
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
      setStatus("disconnected");
    };
    ws.onerror = (e) => {
      console.error("[GeminiLive] WS error:", e);
      setStatus("disconnected");
    };
  }, [avatarId, setStatus, addMessage, setMetrics, setServerError]);

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
    node.port.onmessage = (e: MessageEvent) => {
      if (micMutedRef.current) return; // mute = dejar de enviar chunks
      if (!audioGateOpenRef.current) return; // aun no termina el saludo de Sofia
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "audio_chunk",
            pcm: int16BufferToBase64(e.data as ArrayBuffer),
          })
        );
      }
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
    stopMic();
    playerRef.current?.close();
    playerRef.current = null;
    setAnalyser(null);
    setHasGreeted(false);
    wsRef.current?.close();
    wsRef.current = null;
  }, [stopMic]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return { connect, startMic, stopMic, setMicMuted, endSession, disconnect, analyser, hasGreeted };
}
