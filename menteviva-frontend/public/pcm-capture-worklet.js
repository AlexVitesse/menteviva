// AudioWorklet de captura para Gemini Live (Fase 3).
//
// Corre en el render thread de audio. Recibe frames Float32 del microfono
// (el AudioContext se crea a 16 kHz, asi que NO hay que remuestrear aqui:
// el browser ya entrega 16 kHz mono), los convierte a PCM16 y los postea al
// hilo principal por lotes de ~100 ms para no saturar el WS con mensajes
// diminutos (un frame son 128 samples = 8 ms).
//
// El hilo principal (useGeminiLive) toma cada ArrayBuffer Int16, lo codifica
// base64 y lo manda como {type:"audio_chunk", pcm:...} al backend, que lo
// reenvia a Gemini.
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    // 16000 Hz * 0.1 s = 1600 samples por lote (~100 ms).
    this._target = 1600;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      // Clampear a [-1, 1] y escalar a rango int16.
      let s = channel[i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      this._buf.push(s < 0 ? s * 0x8000 : s * 0x7fff);
    }

    if (this._buf.length >= this._target) {
      const pcm = new Int16Array(this._buf.length);
      for (let i = 0; i < this._buf.length; i++) pcm[i] = this._buf[i];
      this._buf = [];
      // Transferimos el buffer (zero-copy) al hilo principal.
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }

    // Devolver true mantiene vivo el procesador.
    return true;
  }
}

registerProcessor("pcm-capture", PCMCaptureProcessor);
