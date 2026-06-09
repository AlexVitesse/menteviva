/**
 * Utilidades PCM para el modo Gemini Live (audio nativo).
 *
 * - Conversion base64 <-> PCM16 (lo que viaja por el WebSocket).
 * - PCMStreamPlayer: reproduce chunks PCM16 conforme llegan, encolandolos en el
 *   AudioContext para playback continuo (gapless). Soporta barge-in: flush()
 *   corta y vacia la cola cuando el usuario interrumpe (evento `interrupted`).
 *
 * Formatos (ver app/services/gemini_live.py):
 *   - Captura (mic -> servidor): PCM16 mono 16 kHz.
 *   - Reproduccion (servidor -> avatar): PCM16 mono 24 kHz.
 */

/** ArrayBuffer de Int16 -> string base64. */
export function int16BufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** string base64 (PCM16) -> Int16Array. */
export function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  // Int16 = 2 bytes; recortar por si la longitud fuese impar.
  return new Int16Array(bytes.buffer, 0, Math.floor(len / 2));
}

/**
 * Remuestreador PCM16 24 kHz -> 16 kHz (interpolacion lineal) para alimentar
 * a Simli, que solo acepta 16 kHz (ver useSimliAvatar). Mantiene estado entre
 * chunks (posicion fraccional + ultima muestra del chunk anterior) para que
 * el stream se remuestree continuo, sin clicks en las costuras.
 */
export class Pcm24to16Resampler {
  // 24000/16000 = 1.5 muestras de entrada por muestra de salida.
  private static readonly STEP = 1.5;
  // Posicion de lectura relativa al inicio del chunk actual. Puede quedar en
  // (-1, 0) entre chunks: significa "entre la ultima muestra del chunk
  // anterior (this.last) y la primera del nuevo".
  private pos = 0;
  private last = 0;

  resample(input: Int16Array): Int16Array {
    const n = input.length;
    if (n === 0) return new Int16Array(0);

    const out = new Int16Array(Math.ceil((n + 1) / Pcm24to16Resampler.STEP) + 1);
    let count = 0;
    let p = this.pos;

    while (p <= n - 1) {
      let sample: number;
      if (p < 0) {
        // Interpolar entre el final del chunk anterior y el inicio de este.
        const frac = p + 1;
        sample = this.last * (1 - frac) + input[0] * frac;
      } else {
        const i = Math.floor(p);
        const frac = p - i;
        const next = i + 1 < n ? input[i + 1] : input[i];
        sample = input[i] * (1 - frac) + next * frac;
      }
      out[count++] = Math.round(sample);
      p += Pcm24to16Resampler.STEP;
    }

    this.pos = p - n; // queda en (-1, 0.5]; si es negativo cruza al proximo chunk
    this.last = input[n - 1];
    return out.subarray(0, count) as Int16Array;
  }

  /** Descarta el estado de continuidad (usar en barge-in / reconexion). */
  reset(): void {
    this.pos = 0;
    this.last = 0;
  }
}

type AudioCtxCtor = typeof AudioContext;

function getAudioContextCtor(): AudioCtxCtor {
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: AudioCtxCtor }).webkitAudioContext
  );
}

/**
 * Reproductor de cola PCM. Programa cada chunk a continuacion del anterior en
 * la linea de tiempo del AudioContext para que suene continuo. Notifica al
 * consumidor cuando empieza/termina de sonar (para el indicador "hablando").
 */
export class PCMStreamPlayer {
  private ctx: AudioContext;
  private nextTime = 0;
  private active = new Set<AudioBufferSourceNode>();
  private readonly sampleRate: number;
  private analyserNode: AnalyserNode;
  /** Llamado con true al empezar a sonar y false cuando se vacia la cola. */
  onSpeakingChange?: (speaking: boolean) => void;

  constructor(sampleRate = 24000) {
    this.sampleRate = sampleRate;
    this.ctx = new (getAudioContextCtor())({ sampleRate });
    // Analyser intercalado (sources -> analyser -> destination) para que el
    // avatar 3D pueda leer la amplitud y mover la boca (lip-sync). Mismos
    // params que TalkingHeadAvatar espera.
    this.analyserNode = this.ctx.createAnalyser();
    this.analyserNode.fftSize = 1024;
    this.analyserNode.smoothingTimeConstant = 0.5;
    this.analyserNode.connect(this.ctx.destination);
  }

  /** AnalyserNode de la salida (para lip-sync del avatar). */
  get analyser(): AnalyserNode {
    return this.analyserNode;
  }

  /** Reanuda el contexto (requiere gesto del usuario en algunos browsers). */
  async resume(): Promise<void> {
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        /* ignore */
      }
    }
  }

  /** Encola un chunk PCM16 base64 para reproduccion inmediata/continua. */
  enqueueBase64(b64: string): void {
    const pcm = base64ToInt16(b64);
    if (pcm.length === 0) return;

    const f32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 0x8000;

    const buffer = this.ctx.createBuffer(1, f32.length, this.sampleRate);
    buffer.copyToChannel(f32, 0);

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    // Pasa por el analyser (que va a destination) para alimentar el lip-sync.
    src.connect(this.analyserNode);

    const now = this.ctx.currentTime;
    // Si la cola se vacio (nextTime quedo atras), arrancar "ahora" con un
    // pequeno colchon para evitar glitches por jitter de red.
    const startAt = Math.max(this.nextTime, now + 0.02);
    src.start(startAt);
    this.nextTime = startAt + buffer.duration;

    const wasEmpty = this.active.size === 0;
    this.active.add(src);
    if (wasEmpty) this.onSpeakingChange?.(true);

    src.onended = () => {
      this.active.delete(src);
      if (this.active.size === 0) this.onSpeakingChange?.(false);
    };
  }

  /** Barge-in: corta todo lo que suena y vacia la cola. */
  flush(): void {
    for (const src of this.active) {
      try {
        src.onended = null;
        src.stop();
      } catch {
        /* ya termino */
      }
    }
    this.active.clear();
    this.nextTime = 0;
    this.onSpeakingChange?.(false);
  }

  /** True si hay audio sonando o encolado. */
  get isSpeaking(): boolean {
    return this.active.size > 0;
  }

  /** Cierra el contexto y libera recursos. */
  close(): void {
    this.flush();
    this.ctx.close().catch(() => {});
  }
}
