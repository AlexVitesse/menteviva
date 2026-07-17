import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { base64ToInt16, concatInt16, pcm16ToWavBlob } from "../utils/pcm";
import type { GeminiAudioSink } from "./useGeminiLive";

/**
 * useOssAvatarWs: transporte WebSocket (interino) del avatar OSS self-hosted.
 *
 * Gemelo de useOssAvatar (mismo contrato `GeminiAudioSink`, misma forma de
 * retorno: videoRef/audioRef/connect/disconnect/connected/failed/sink), pero
 * SIN WebRTC. Existe porque el NAT de RunPod no deja pasar WebRTC sin un TURN
 * server; producción sigue siendo WebRTC en el VPS (useOssAvatar). Se activa
 * solo con VITE_AVATAR_TRANSPORT=ws (ver utils/avatarTransport.ts); NO toca el
 * contrato §1 ni el path WebRTC.
 *
 * Flujo:
 *   1. POST /api/avatar/session (igual que WebRTC) -> signaling_url. De ahí se
 *      deriva la URL del WS: wss://<host>/ws/demo (host de la signaling_url).
 *   2. WebSocket binario (arraybuffer):
 *      - frame BINARIO = JPEG -> createImageBitmap -> se dibuja en un <canvas>
 *        oculto; el <video> se alimenta con canvas.captureStream(25) (reusa
 *        VideoAvatar tal cual).
 *      - frame TEXTO {"type":"speaking"|"silent"} -> onSpeakingChange().
 *   3. sink.sendPcm24k: manda el PCM16 24k TAL CUAL por el WS (igual que WebRTC)
 *      y además lo ACUMULA localmente por locución.
 *   4. AUDIO: el endpoint WS NO emite audio (solo video). La voz de Gemini se
 *      reproduce en LOCAL: al llegar {"type":"speaking"} se arma un WAV con el
 *      PCM24k acumulado y se suena por el <audio> — así queda ~sincronizado con
 *      el arranque del video (ambos disparados por "speaking").
 *
 * Igual que WebRTC: si falla (`failed`), useGeminiLive cae al player PCM local +
 * avatar 2D. En modo sink el player local de useGeminiLive NO suena (aquí lo
 * reproducimos nosotros vía el <audio>, evitando doble audio).
 */

const API_URL = import.meta.env.VITE_API_URL || "";
const OUTPUT_SAMPLE_RATE = 24000; // PCM de Gemini (ver useGeminiLive / gemini_live.py)

interface UseOssAvatarWsOptions {
  /** Notifica cuando el avatar empieza/termina de hablar (frames speaking/silent). */
  onSpeakingChange?: (speaking: boolean) => void;
}

interface AvatarSessionOss {
  provider: string;
  session_id: string;
  signaling_url: string;
}

export function useOssAvatarWs({ onSpeakingChange }: UseOssAvatarWsOptions = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Canvas oculto donde se pinta cada frame JPEG; su captureStream alimenta el
  // <video>. No necesita estar en el DOM.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctx2dRef = useRef<CanvasRenderingContext2D | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // PCM de la locución en curso (se vacía al reproducir).
  const utterancePcmRef = useRef<Int16Array[]>([]);
  const audioUrlRef = useRef<string | null>(null);
  // "Armado" para reproducir: se activa con {"type":"speaking"} y se dispara al
  // llegar el PRIMER frame de video de la locución. En RunPod el "speaking" llega
  // ~4s ANTES del primer frame (latencia de inferencia MuseTalk); reproducir en
  // "speaking" desincronizaría el audio del video. Reproducimos en el 1er frame.
  const armedRef = useRef(false);
  // Guard de reentrancia SINCRONO: wsRef.current se setea tarde (tras el fetch de
  // sesion), asi que dos connect() concurrentes (pre-conexion del boton + effect
  // de sessionStarted) podrian pasar el guard y abrir DOS sesiones — fatal contra
  // un servicio de sesion unica. Este flag corta el 2o connect de inmediato.
  const connectingRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState(false);

  const speakingCbRef = useRef(onSpeakingChange);
  speakingCbRef.current = onSpeakingChange;

  const connect = useCallback(async (avatarId: string) => {
    if (wsRef.current || connectingRef.current) return; // ya conectado/conectando
    connectingRef.current = true;
    try {
      await _connect(avatarId);
    } catch (e) {
      setFailed(true);
      throw e;
    } finally {
      connectingRef.current = false;
    }
  }, []);

  // Cuerpo real de connect (separado para envolverlo en el guard de reentrancia
  // + limpieza de connectingRef sin repetir en cada salida).
  const _connect = useCallback(async (avatarId: string) => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) {
      throw new Error("OssAvatarWs no esta montado (refs de video/audio vacios)");
    }

    // 1) Sesion mediada por el backend (idéntico al path WebRTC).
    const resp = await fetch(`${API_URL}/api/avatar/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatar_id: avatarId }),
    });
    if (!resp.ok) {
      throw new Error(`avatar/session HTTP ${resp.status}`);
    }
    const session = (await resp.json()) as AvatarSessionOss;
    if (session.provider !== "oss") {
      throw new Error(`avatar/session provider inesperado: ${session.provider}`);
    }

    // 2) Derivar la URL del WS del host de la signaling_url.
    const u = new URL(session.signaling_url);
    const wsUrl = (u.protocol === "https:" ? "wss:" : "ws:") + "//" + u.host + "/ws/demo";

    // Canvas oculto para pintar los frames JPEG.
    const canvas = document.createElement("canvas");
    canvasRef.current = canvas;
    ctx2dRef.current = canvas.getContext("2d");

    // Reproduce la locución acumulada (WAV via <audio>), sincronizada con el
    // arranque del video ("speaking"). Vacía el buffer para la siguiente.
    const playUtterance = () => {
      const chunks = utterancePcmRef.current;
      utterancePcmRef.current = [];
      if (!chunks.length) return;
      const pcm = concatInt16(chunks);
      if (pcm.length === 0) return;
      const url = URL.createObjectURL(pcm16ToWavBlob(pcm, OUTPUT_SAMPLE_RATE));
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = url;
      audio.src = url;
      audio.play().catch(() => {});
    };

    const drawFrame = (buf: ArrayBuffer) => {
      const cctx = ctx2dRef.current;
      if (!cctx) return;
      createImageBitmap(new Blob([buf], { type: "image/jpeg" }))
        .then((bmp) => {
          if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
            canvas.width = bmp.width;
            canvas.height = bmp.height;
          }
          cctx.drawImage(bmp, 0, 0);
          bmp.close?.();
          // Primer frame: enganchar el captureStream al <video> (análogo al
          // evento "start" de Simli: ya hay cara visible -> connected).
          if (!streamRef.current) {
            const stream = canvas.captureStream(25);
            streamRef.current = stream;
            video.srcObject = stream;
            video.play().catch(() => {});
            setConnected(true);
          }
          // Primer frame de la locución armada: reproducir el audio AHORA para
          // que arranque junto con el video (no en "speaking", que llega antes).
          if (armedRef.current && utterancePcmRef.current.length) {
            armedRef.current = false;
            playUtterance();
          }
        })
        .catch(() => {
          /* frame corrupto: descartar */
        });
    };

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      const data = ev.data;
      if (typeof data === "string") {
        // Control en texto: {"type":"speaking"|"silent"}.
        try {
          const msg = JSON.parse(data);
          if (msg?.type === "speaking") {
            // Armar la reproducción; el audio se dispara en el 1er frame de video
            // (el "speaking" llega ~4s antes que los frames en RunPod).
            armedRef.current = true;
            speakingCbRef.current?.(true);
          } else if (msg?.type === "silent") {
            speakingCbRef.current?.(false);
            // Fallback: si el servicio dijo "silent" sin que llegara ningún frame,
            // reproducir igual el audio acumulado para no quedar mudos.
            if (armedRef.current && utterancePcmRef.current.length) {
              armedRef.current = false;
              playUtterance();
            }
          }
        } catch {
          /* mensaje no-JSON: ignorar */
        }
        return;
      }
      // Frame binario = JPEG.
      drawFrame(data as ArrayBuffer);
    };

    ws.onclose = () => {
      setConnected(false);
      speakingCbRef.current?.(false);
    };

    // 3) Esperar apertura CON TIMEOUT: connect() DEBE resolver/rechazar acotado.
    // Diagnostico hace `await videoAvatar.connect()` ANTES de gemini.connect(), asi
    // que un WS que no abre (servicio de sesion unica ocupado) congelaria TODA la
    // sesion (Sofia nunca arranca y el video queda en "Conectando..."). Con el
    // timeout, connect() rechaza -> Diagnostico cae a 2D y Gemini SI arranca.
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* noop */
        }
        wsRef.current = null;
        reject(new Error(`avatar WS ${wsUrl} open timeout`));
      }, 12000);
      ws.onopen = () => {
        window.clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        window.clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* noop */
        }
        wsRef.current = null;
        reject(new Error(`avatar WS ${wsUrl} error`));
      };
    });
    // Ya abierto: los errores posteriores solo se loguean (no rompen la sesion).
    ws.onerror = (e) => console.error("[OssWs] ws error:", e);
  }, []);

  const disconnect = useCallback(() => {
    setConnected(false);
    const ws = wsRef.current;
    wsRef.current = null;
    // v2 (multi-sesion): "bye" ANTES de cerrar para liberar el cupo de inmediato.
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "bye" }));
      } catch {
        /* noop */
      }
    }
    try {
      ws?.close();
    } catch {
      /* noop */
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      try {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      } catch {
        /* noop */
      }
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    utterancePcmRef.current = [];
    armedRef.current = false;
    canvasRef.current = null;
    ctx2dRef.current = null;
  }, []);

  // Cierre limpio en unmount y en beforeunload (best-effort): "bye" para devolver
  // el cupo aunque el usuario cierre la pestaña o navegue fuera.
  useEffect(() => {
    const sendBye = () => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "bye" }));
        } catch {
          /* noop */
        }
      }
    };
    window.addEventListener("beforeunload", sendBye);
    return () => {
      window.removeEventListener("beforeunload", sendBye);
      disconnect();
    };
  }, [disconnect]);

  // Sink estable (identidad constante) para pasarle a useGeminiLive.
  const sink: GeminiAudioSink = useMemo(
    () => ({
      isActive: () => wsRef.current?.readyState === WebSocket.OPEN,
      sendPcm24k: (b64: string) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const pcm = base64ToInt16(b64);
        if (pcm.length === 0) return;
        // Acumular para la reproducción local (WAV en "speaking")...
        utterancePcmRef.current.push(pcm);
        // ...y mandar el PCM16 24k TAL CUAL por el WS (el servicio resamplea).
        const bytes = new Uint8Array(pcm.length * 2);
        bytes.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
        try {
          ws.send(bytes);
        } catch {
          /* buffer lleno / canal cerrandose: descartar chunk */
        }
      },
      interrupt: () => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "interrupt" }));
          } catch {
            /* noop */
          }
        }
        // Barge-in local: descartar el PCM acumulado y cortar el <audio>.
        armedRef.current = false;
        utterancePcmRef.current = [];
        const audio = audioRef.current;
        if (audio) {
          try {
            audio.pause();
            audio.currentTime = 0;
          } catch {
            /* noop */
          }
        }
        speakingCbRef.current?.(false);
      },
      endUtterance: () => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "end_utterance" }));
          } catch {
            /* noop */
          }
        }
      },
    }),
    []
  );

  return { videoRef, audioRef, connect, disconnect, connected, failed, sink };
}
