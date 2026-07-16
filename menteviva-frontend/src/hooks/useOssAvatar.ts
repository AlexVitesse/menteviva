import { useCallback, useMemo, useRef, useState } from "react";
import { base64ToInt16 } from "../utils/pcm";
import type { GeminiAudioSink } from "./useGeminiLive";

/**
 * useOssAvatar: avatar de video self-hosted (avatar-service OSS, WebRTC).
 *
 * Gemelo de useSimliAvatar que implementa el MISMO contrato `GeminiAudioSink`,
 * pero contra nuestro microservicio open-source (MuseTalk) en vez de Simli.
 * Ver docs/plans/16_avatar_oss_integracion.md §1 (EL CONTRATO — no cambiar sin
 * avisar al lado de AvatarAI).
 *
 * Flujo (§1.1 / §1.2):
 *   1. POST /api/avatar/session -> { provider:"oss", session_id, signaling_url,
 *      ice_servers, max_session_seconds }. La AVATAR_SERVICE_URL vive en el
 *      backend; el navegador solo recibe la signaling_url ya resuelta.
 *   2. RTCPeerConnection con esos ice_servers; transceivers recvonly video+audio.
 *   3. DataChannel "audio-in" (binario) para mandar el audio de Gemini.
 *   4. POST {signaling_url}/offer con el SDP offer -> SDP answer.
 *   5. Los tracks entrantes (video lip-synced + voz de Gemini re-emitida) se
 *      pegan a los <video>/<audio> referenciados.
 *
 * IMPORTANTE (igual que Simli): en modo sink el reproductor PCM local NO suena
 * (la voz sale por el <audio> del servicio, sincronizada con el video). Si el
 * servicio falla (failed / sink inactivo), useGeminiLive cae solo al player
 * local y la UI debe renderizar el avatar 2D.
 */

const API_URL = import.meta.env.VITE_API_URL || "";

interface UseOssAvatarOptions {
  /**
   * Notifica cuando el avatar empieza/termina de hablar. El avatar-service emite
   * mensajes de control en TEXTO por el DataChannel "audio-in"
   * ({"type":"speaking"} / {"type":"silent"}); los cableamos aqui para encender
   * el indicador "Sofia habla" en modo OSS (simetria con useSimliAvatar).
   */
  onSpeakingChange?: (speaking: boolean) => void;
}

interface AvatarSessionOss {
  provider: string;
  session_id: string;
  signaling_url: string;
  ice_servers?: RTCIceServer[];
  max_session_seconds?: number;
}

/** Espera a que ICE termine de reunir candidatos (sin trickle: mandamos un
 * unico offer). Resuelve al completar o al vencer el timeout (best-effort). */
function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 2000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    pc.addEventListener("icegatheringstatechange", check);
    // Respaldo: algunos navegadores no disparan "complete" con STUN publico.
    window.setTimeout(done, timeoutMs);
  });
}

export function useOssAvatar({ onSpeakingChange }: UseOssAvatarOptions = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  // connectedRef para el sink (callbacks estables); connected para el render.
  const connectedRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState(false);

  const speakingCbRef = useRef(onSpeakingChange);
  speakingCbRef.current = onSpeakingChange;

  const connect = useCallback(async (avatarId: string) => {
    if (pcRef.current) return; // ya conectado o conectando

    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) {
      setFailed(true);
      throw new Error("OssAvatar no esta montado (refs de video/audio vacios)");
    }

    // 1) Sesion efimera mediada por el backend (secretos server-side).
    const resp = await fetch(`${API_URL}/api/avatar/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatar_id: avatarId }),
    }).catch((e) => {
      setFailed(true);
      throw e;
    });
    if (!resp.ok) {
      setFailed(true);
      throw new Error(`avatar/session HTTP ${resp.status}`);
    }
    const session = (await resp.json()) as AvatarSessionOss;
    if (session.provider !== "oss") {
      // El backend no esta en modo oss: caer al fallback (2D) sin reventar.
      setFailed(true);
      throw new Error(`avatar/session provider inesperado: ${session.provider}`);
    }

    // 2) PeerConnection recvonly video+audio.
    const pc = new RTCPeerConnection({ iceServers: session.ice_servers });
    pcRef.current = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    // 3) DataChannel para el audio de Gemini (PCM16 24k) + control (interrupt).
    const dc = pc.createDataChannel("audio-in");
    dc.binaryType = "arraybuffer";
    dcRef.current = dc;

    // El servicio devuelve por el MISMO canal mensajes de control en TEXTO:
    //   {"type":"speaking"} / {"type":"silent"}  -> indicador "Sofia habla".
    // Lo que MANDAMOS es binario (PCM); lo que RECIBIMOS es solo texto, asi que
    // ignoramos cualquier frame binario entrante.
    dc.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg?.type === "speaking") speakingCbRef.current?.(true);
        else if (msg?.type === "silent") speakingCbRef.current?.(false);
      } catch {
        /* mensaje no-JSON: ignorar */
      }
    };

    // Streams entrantes: video lip-synced -> <video>, voz -> <audio>.
    const videoStream = new MediaStream();
    const audioStream = new MediaStream();
    pc.ontrack = (ev) => {
      if (ev.track.kind === "video") {
        videoStream.addTrack(ev.track);
        video.srcObject = videoStream;
        video.play().catch(() => {});
      } else if (ev.track.kind === "audio") {
        audioStream.addTrack(ev.track);
        audio.srcObject = audioStream;
        audio.play().catch(() => {});
      }
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") {
        connectedRef.current = true;
        setConnected(true);
      } else if (st === "failed" || st === "disconnected" || st === "closed") {
        connectedRef.current = false;
        setConnected(false);
        if (st === "failed") setFailed(true);
        speakingCbRef.current?.(false);
      }
    };

    // 4) Intercambio SDP contra la signaling_url del avatar-service.
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);

    const answerResp = await fetch(`${session.signaling_url}/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sdp: pc.localDescription?.sdp,
        type: pc.localDescription?.type,
      }),
    }).catch((e) => {
      setFailed(true);
      pc.close();
      pcRef.current = null;
      throw e;
    });
    if (!answerResp.ok) {
      setFailed(true);
      pc.close();
      pcRef.current = null;
      throw new Error(`signaling /offer HTTP ${answerResp.status}`);
    }
    const answer = (await answerResp.json()) as RTCSessionDescriptionInit;
    await pc.setRemoteDescription(answer);
  }, []);

  const disconnect = useCallback(() => {
    connectedRef.current = false;
    setConnected(false);
    try {
      dcRef.current?.close();
    } catch {
      /* noop */
    }
    dcRef.current = null;
    const pc = pcRef.current;
    pcRef.current = null;
    try {
      pc?.close();
    } catch {
      /* noop */
    }
  }, []);

  // Sink estable (identidad constante) para pasarle a useGeminiLive.
  const sink: GeminiAudioSink = useMemo(
    () => ({
      isActive: () =>
        connectedRef.current &&
        pcRef.current?.connectionState === "connected" &&
        dcRef.current?.readyState === "open",
      sendPcm24k: (b64: string) => {
        const dc = dcRef.current;
        if (!dc || dc.readyState !== "open") return;
        // §1.3: decodificar y mandar PCM16 24k TAL CUAL (el servicio resamplea
        // a 16k). Reutilizamos base64ToInt16 solo para el decode; NO remuestrear.
        const pcm = base64ToInt16(b64);
        if (pcm.length === 0) return;
        // Copia a un Uint8Array con ArrayBuffer propio (dc.send exige
        // ArrayBufferView<ArrayBuffer>, no ArrayBufferLike). El chunk es de
        // unos pocos KB, el costo de la copia es despreciable.
        const bytes = new Uint8Array(pcm.length * 2);
        bytes.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
        try {
          dc.send(bytes);
        } catch {
          /* buffer lleno / canal cerrandose: descartar chunk */
        }
      },
      interrupt: () => {
        // Barge-in: mensaje de control texto -> el servicio limpia su buffer.
        const dc = dcRef.current;
        if (dc?.readyState === "open") {
          try {
            dc.send(JSON.stringify({ type: "interrupt" }));
          } catch {
            /* noop */
          }
        }
      },
      endUtterance: () => {
        // Fin de turno de Gemini (§2 del brief): avisar al servicio que no
        // llegan mas chunks de esta frase para que sintetice YA, sin esperar
        // su watchdog de silencio (~350 ms). Mensaje de control texto.
        const dc = dcRef.current;
        if (dc?.readyState === "open") {
          try {
            dc.send(JSON.stringify({ type: "end_utterance" }));
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
