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

/** RMS normalizado [0,1] de un buffer PCM16. Usado por el echo-gate del mic. */
export function pcm16Rms(buf: ArrayBuffer): number {
  const int16 = new Int16Array(buf);
  const n = int16.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = int16[i] / 0x8000;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

/** Concatena varios Int16Array en uno solo (util para juntar una locucion). */
export function concatInt16(chunks: Int16Array[]): Int16Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Int16Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Envuelve PCM16 mono en un contenedor WAV (RIFF) para reproducirlo via el
 * elemento <audio>. Lo usa el transporte WS del avatar OSS (useOssAvatarWs):
 * ese endpoint solo emite VIDEO, asi que la voz de Gemini se reproduce local.
 * Little-endian: Int16Array usa el endianness de la plataforma (LE en x86/ARM),
 * que coincide con el formato WAV.
 */
export function pcm16ToWavBlob(pcm: Int16Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // tamano del sub-chunk fmt
  view.setUint16(20, 1, true); // formato = PCM
  view.setUint16(22, 1, true); // canales = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits por sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  new Int16Array(buffer, 44).set(pcm);
  return new Blob([buffer], { type: "audio/wav" });
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
 * Biquad low-pass (RBJ cookbook) con estado persistente entre chunks.
 * Usado como filtro anti-alias antes de decimar 24k -> 16k.
 */
class BiquadLowPass {
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(fc: number, fs: number, q = Math.SQRT1_2) {
    const w0 = (2 * Math.PI * fc) / fs;
    const cosW0 = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = (1 - cosW0) / 2 / a0;
    this.b1 = (1 - cosW0) / a0;
    this.b2 = (1 - cosW0) / 2 / a0;
    this.a1 = (-2 * cosW0) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  /** Filtra in-place un Float64Array. */
  process(buf: Float64Array): void {
    let { x1, x2, y1, y2 } = this;
    for (let i = 0; i < buf.length; i++) {
      const x0 = buf[i];
      const y0 = this.b0 * x0 + this.b1 * x1 + this.b2 * x2 - this.a1 * y1 - this.a2 * y2;
      buf[i] = y0;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
    }
    this.x1 = x1;
    this.x2 = x2;
    this.y1 = y1;
    this.y2 = y2;
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

/**
 * Remuestreador PCM16 24 kHz -> 16 kHz (interpolacion lineal) para alimentar
 * a Simli, que solo acepta 16 kHz (ver useSimliAvatar). Mantiene estado entre
 * chunks (posicion fraccional + ultima muestra del chunk anterior) para que
 * el stream se remuestree continuo, sin clicks en las costuras.
 *
 * Anti-alias: antes de decimar se aplica un low-pass a ~7.2 kHz (2 biquads en
 * cascada, ~24 dB/oct). Sin esto, el contenido de 8-12 kHz de la voz de Gemini
 * se "alias-ea" dentro de la banda de 16 kHz y la voz por Simli suena aspera
 * y metalica. Los filtros guardan estado entre chunks (stream continuo).
 */
export class Pcm24to16Resampler {
  // 24000/16000 = 1.5 muestras de entrada por muestra de salida.
  private static readonly STEP = 1.5;
  // Posicion de lectura relativa al inicio del chunk actual. Puede quedar en
  // (-1, 0) entre chunks: significa "entre la ultima muestra del chunk
  // anterior (this.last) y la primera del nuevo".
  private pos = 0;
  private last = 0;
  // Cascada anti-alias: corte bajo Nyquist destino (8 kHz) con margen.
  private lp1 = new BiquadLowPass(7200, 24000);
  private lp2 = new BiquadLowPass(7200, 24000);

  resample(input: Int16Array): Int16Array {
    const n = input.length;
    if (n === 0) return new Int16Array(0);

    // 1) Low-pass anti-alias (en float, con estado entre chunks).
    const f = new Float64Array(n);
    for (let i = 0; i < n; i++) f[i] = input[i];
    this.lp1.process(f);
    this.lp2.process(f);

    // 2) Decimacion por interpolacion lineal sobre la senal ya filtrada.
    const out = new Int16Array(Math.ceil((n + 1) / Pcm24to16Resampler.STEP) + 1);
    let count = 0;
    let p = this.pos;

    while (p <= n - 1) {
      let sample: number;
      if (p < 0) {
        // Interpolar entre el final del chunk anterior y el inicio de este.
        const frac = p + 1;
        sample = this.last * (1 - frac) + f[0] * frac;
      } else {
        const i = Math.floor(p);
        const frac = p - i;
        const next = i + 1 < n ? f[i + 1] : f[i];
        sample = f[i] * (1 - frac) + next * frac;
      }
      // Clampear: el filtro puede sobrepasar levemente el rango int16.
      sample = Math.round(sample);
      out[count++] = sample > 32767 ? 32767 : sample < -32768 ? -32768 : sample;
      p += Pcm24to16Resampler.STEP;
    }

    this.pos = p - n; // queda en (-1, 0.5]; si es negativo cruza al proximo chunk
    this.last = f[n - 1];
    return out.subarray(0, count) as Int16Array;
  }

  /** Descarta el estado de continuidad (usar en barge-in / reconexion). */
  reset(): void {
    this.pos = 0;
    this.last = 0;
    this.lp1.reset();
    this.lp2.reset();
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
