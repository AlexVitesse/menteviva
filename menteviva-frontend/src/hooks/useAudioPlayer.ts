import { useRef, useCallback, useState, useEffect } from "react";

/**
 * useAudioPlayer: reproduce audio del avatar.
 *
 * Dos modos:
 * - playAudio(base64): modo legacy, recibe el blob completo y reproduce.
 * - startStream/appendChunk/endStream: modo streaming via MediaSource API.
 *   Permite que la voz empiece antes de que termine de generarse todo el audio.
 */
export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  // Ref espejo de isMuted para usar dentro de callbacks sin recrearlos en cada toggle
  const isMutedRef = useRef(false);
  const currentBlobUrl = useRef<string | null>(null);

  // Buffer de chunks para streaming. Acumulamos hasta endStream() y reproducimos
  // como un solo blob. Antes intentabamos MediaSource API para playback
  // progresivo pero rompe en Safari/iOS (no soporta MP3 via MSE) y a veces
  // falla en Chrome por timing del play() vs sourceopen. El TTFB del lado
  // servidor sigue siendo bajo (ElevenLabs .stream()), solo el cliente espera
  // al final para reproducir — vale la confiabilidad universal.
  const streamChunksRef = useRef<Uint8Array[]>([]);

  // Crear elemento de audio persistente
  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;

    const handleEnded = () => setIsPlaying(false);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);

    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.pause();
      if (currentBlobUrl.current) {
        URL.revokeObjectURL(currentBlobUrl.current);
      }
    };
  }, []);

  // Mantener audio.muted sincronizado con el estado isMuted. Esto cubre el
  // caso de toggle durante reproduccion en curso. Para clips nuevos (set src
  // en playAudio/endStream) tambien se aplica explicitamente abajo, asi el
  // nuevo elemento arranca con el muted correcto sin un frame de audio
  // audible mientras React despacha el efecto.
  useEffect(() => {
    isMutedRef.current = isMuted;
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const cleanupPreviousSource = useCallback(() => {
    if (currentBlobUrl.current) {
      URL.revokeObjectURL(currentBlobUrl.current);
      currentBlobUrl.current = null;
    }
    streamChunksRef.current = [];
  }, []);

  // Legacy: reproducir un blob completo
  const playAudio = useCallback((base64: string, mimeType = "audio/mp3") => {
    return new Promise<void>((resolve, reject) => {
      try {
        if (!audioRef.current) {
          reject(new Error("Audio element not initialized"));
          return;
        }

        cleanupPreviousSource();

        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: mimeType });
        const url = URL.createObjectURL(blob);
        currentBlobUrl.current = url;

        const audio = audioRef.current;

        const onEnded = () => {
          audio.removeEventListener("ended", onEnded);
          audio.removeEventListener("error", onError);
          resolve();
        };
        const onError = (error: Event) => {
          audio.removeEventListener("ended", onEnded);
          audio.removeEventListener("error", onError);
          reject(error);
        };
        audio.addEventListener("ended", onEnded);
        audio.addEventListener("error", onError);

        audio.src = url;
        // Persistir el estado mute entre clips: si el usuario silencio, los
        // siguientes clips tambien arrancan muted.
        audio.muted = isMutedRef.current;
        audio.play().catch(reject);
      } catch (error) {
        reject(error);
      }
    });
  }, [cleanupPreviousSource]);

  // Streaming "ligero": acumula chunks, reproduce al cerrar como blob unico.
  const startStream = useCallback(
    (_mimeType = "audio/mpeg") => {
      console.log("[Audio] startStream");
      cleanupPreviousSource();
      // Asegurar que el elemento persistente respete el mute actual al
      // arrancar un nuevo stream.
      if (audioRef.current) {
        audioRef.current.muted = isMutedRef.current;
      }
    },
    [cleanupPreviousSource]
  );

  const appendChunk = useCallback((base64: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    streamChunksRef.current.push(bytes);
    console.log(
      `[Audio] chunk #${streamChunksRef.current.length} (${bytes.length} bytes)`
    );
  }, []);

  const endStream = useCallback(() => {
    const totalChunks = streamChunksRef.current.length;
    const totalBytes = streamChunksRef.current.reduce((s, c) => s + c.length, 0);
    console.log(`[Audio] endStream: ${totalChunks} chunks, ${totalBytes} bytes`);

    if (!audioRef.current) {
      console.warn("[Audio] endStream: audioRef.current es null");
      return;
    }
    if (totalChunks === 0) {
      console.warn("[Audio] endStream: 0 chunks recibidos");
      return;
    }

    const blob = new Blob(streamChunksRef.current as BlobPart[], { type: "audio/mpeg" });
    streamChunksRef.current = [];

    if (currentBlobUrl.current) {
      URL.revokeObjectURL(currentBlobUrl.current);
    }
    const url = URL.createObjectURL(blob);
    currentBlobUrl.current = url;
    console.log(`[Audio] blob creado: ${blob.size} bytes, url: ${url}`);

    audioRef.current.src = url;
    // Aplicar mute persistente al nuevo clip
    audioRef.current.muted = isMutedRef.current;
    audioRef.current
      .play()
      .then(() => console.log("[Audio] play() OK"))
      .catch((err) => {
        console.warn("[Audio] play() rejected:", err);
      });
  }, []);

  /**
   * iOS Safari (y Chrome con autoplay policy) requieren un gesto del usuario
   * antes de permitir audio.play() programatico. Se debe llamar esta funcion
   * desde un onClick/onTouchStart real del usuario.
   *
   * Estrategia (combina lo que funciona en cada navegador):
   * 1. Crear/resumir AudioContext y reproducir un buffer silencioso de 1
   *    sample. Esto desbloquea Web Audio Y, en iOS, tambien HTMLMediaElement
   *    cuando se hace dentro del mismo gesto.
   * 2. Reproducir el HTMLAudioElement con un data URI WAV silencioso real
   *    (no vacio) para asegurar el unlock especifico del elemento.
   *
   * Idempotente: solo se ejecuta la primera vez.
   */
  const unlockAudioRef = useRef(false);
  // MP3 silencioso real (~100ms, ~1KB). iOS Safari rechaza WAVs de 0 samples
  // o data URIs malformados; este MP3 tiene frames validos y se reproduce en
  // todos los browsers incluido iOS.
  const SILENT_MP3_DATA_URI =
    "data:audio/mp3;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gTGFTb25vdGhlcXVlLm9yZwBURU5DAAAAHQAAA1N3aXRjaCBQbHVzIMKpIE5DSCBTb2Z0d2FyZQBUSVQyAAAABgAAAzIyMzUAVFNTRQAAAA8AAANMYXZmNTcuODMuMTAwAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/zQsQbAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/zQMSkAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/zQMSkAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

  // Promise.race con timeout: si play() o resume() cuelgan en iOS, fallamos
  // rapido en vez de bloquear el flujo del usuario.
  const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error("unlock timeout")), ms)
      ),
    ]);

  const unlockAudio = useCallback(async () => {
    if (unlockAudioRef.current || !audioRef.current) return;

    // Paso 1: AudioContext (desbloquea Web Audio)
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        if (ctx.state === "suspended") {
          await withTimeout(ctx.resume(), 1500);
        }
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
      }
    } catch (err) {
      console.warn("[useAudioPlayer] AudioContext unlock fallo:", err);
    }

    // Paso 2: HTMLAudioElement con MP3 silencioso real
    try {
      const audio = audioRef.current;
      audio.src = SILENT_MP3_DATA_URI;
      audio.muted = false;
      audio.volume = 1;
      await withTimeout(audio.play(), 2000);
      audio.pause();
      audio.currentTime = 0;
      unlockAudioRef.current = true;
      console.log("[useAudioPlayer] unlock OK");
    } catch (err) {
      console.warn("[useAudioPlayer] HTMLAudio unlock fallo:", err);
    }
  }, []);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  }, []);

  const pauseAudio = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const resumeAudio = useCallback(() => {
    audioRef.current?.play();
  }, []);

  // Silencia/desilencia el avatar sin detener la grabacion del mic del
  // usuario. Persiste entre clips: el effect de arriba sincroniza el
  // elemento <audio>, y playAudio/endStream/startStream leen isMutedRef.
  const setMuted = useCallback((v: boolean) => {
    setIsMuted(v);
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  return {
    audioRef,
    isPlaying,
    isMuted,
    playAudio,
    startStream,
    appendChunk,
    endStream,
    unlockAudio,
    stopAudio,
    pauseAudio,
    resumeAudio,
    toggleMute,
    setMuted,
  };
}
