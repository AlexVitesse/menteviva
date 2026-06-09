import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SimliClient, LogLevel } from "simli-client";
import { base64ToInt16, Pcm24to16Resampler } from "../utils/pcm";
import type { GeminiAudioSink } from "./useGeminiLive";

/**
 * useSimliAvatar: avatar fotorrealista en video (Simli, WebRTC).
 *
 * Flujo: pide un session token efimero al backend (POST /api/simli/session-token
 * — la SIMLI_API_KEY vive alla), abre la conexion WebRTC con simli-client y
 * expone un `sink` para useGeminiLive: cada chunk PCM24k del avatar se
 * remuestrea a 16 kHz y se manda a Simli, que devuelve video+voz lip-synced
 * por los elementos <video>/<audio> referenciados.
 *
 * IMPORTANTE: en modo sink el reproductor PCM local NO suena (la voz sale por
 * el <audio> de Simli, sincronizada con los labios del video). Si Simli falla
 * (failed / sink inactivo), useGeminiLive cae solo al player local y la UI
 * debe renderizar el avatar 3D.
 */

const API_URL = import.meta.env.VITE_API_URL || "";

interface UseSimliAvatarOptions {
  /** Notifica cuando el avatar empieza/termina de hablar (eventos de Simli). */
  onSpeakingChange?: (speaking: boolean) => void;
}

export function useSimliAvatar({ onSpeakingChange }: UseSimliAvatarOptions = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const clientRef = useRef<SimliClient | null>(null);
  // connectedRef para el sink (callbacks estables); connected para el render.
  const connectedRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState(false);

  const resamplerRef = useRef<Pcm24to16Resampler | null>(null);
  if (!resamplerRef.current) resamplerRef.current = new Pcm24to16Resampler();

  const speakingCbRef = useRef(onSpeakingChange);
  useEffect(() => {
    speakingCbRef.current = onSpeakingChange;
  }, [onSpeakingChange]);

  const connect = useCallback(async (avatarId: string) => {
    if (clientRef.current) return; // ya conectado o conectando

    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) {
      setFailed(true);
      throw new Error("SimliAvatar no esta montado (refs de video/audio vacios)");
    }

    const resp = await fetch(`${API_URL}/api/simli/session-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatar_id: avatarId }),
    }).catch((e) => {
      setFailed(true);
      throw e;
    });
    if (!resp.ok) {
      setFailed(true);
      throw new Error(`session-token HTTP ${resp.status}`);
    }
    const { session_token } = await resp.json();

    // transport_mode "livekit" (6o arg) es CRÍTICO: el default compilado del SDK
    // es "p2p", que exige iceServers y lanza "Ice Servers Required for P2P Mode"
    // al pasar null -> el constructor revienta y el avatar nunca conecta. livekit
    // rutea por la infra de Simli (sin ICE, sin problemas de NAT). Verificado con
    // /__simli-test: el video 512x512 renderiza.
    const client = new SimliClient(session_token, video, audio, null, LogLevel.ERROR, "livekit");
    client.on("start", () => {
      // "start" dispara al renderizar el primer frame: ya hay cara visible.
      connectedRef.current = true;
      setConnected(true);
    });
    client.on("speaking", () => speakingCbRef.current?.(true));
    client.on("silent", () => speakingCbRef.current?.(false));
    client.on("error", (detail) => console.error("[Simli] error:", detail));
    client.on("startup_error", (msg) => {
      console.error("[Simli] startup_error:", msg);
      setFailed(true);
    });
    client.on("stop", () => {
      connectedRef.current = false;
      setConnected(false);
      speakingCbRef.current?.(false);
    });

    clientRef.current = client;
    try {
      await client.start();
      // Por si el evento "start" tarda en llegar (primer frame): el transporte
      // ya esta arriba, podemos empezar a mandarle audio.
      connectedRef.current = true;
    } catch (e) {
      clientRef.current = null;
      setFailed(true);
      throw e;
    }
  }, []);

  const disconnect = useCallback(() => {
    connectedRef.current = false;
    setConnected(false);
    const client = clientRef.current;
    clientRef.current = null;
    client?.stop().catch(() => {});
    resamplerRef.current?.reset();
  }, []);

  // Sink estable (identidad constante) para pasarle a useGeminiLive.
  const sink: GeminiAudioSink = useMemo(
    () => ({
      isActive: () => connectedRef.current,
      sendPcm24k: (b64: string) => {
        const client = clientRef.current;
        if (!client || !connectedRef.current) return;
        const pcm16k = resamplerRef.current!.resample(base64ToInt16(b64));
        if (pcm16k.length === 0) return;
        client.sendAudioData(
          new Uint8Array(pcm16k.buffer, pcm16k.byteOffset, pcm16k.byteLength)
        );
      },
      interrupt: () => {
        // Barge-in: descartar lo encolado en Simli y el estado del resampler.
        clientRef.current?.ClearBuffer();
        resamplerRef.current?.reset();
      },
    }),
    []
  );

  return { videoRef, audioRef, connect, disconnect, connected, failed, sink };
}
