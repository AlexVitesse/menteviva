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
        audio.play().catch(reject);
      } catch (error) {
        reject(error);
      }
    });
  }, [cleanupPreviousSource]);

  // Streaming "ligero": acumula chunks, reproduce al cerrar como blob unico.
  const startStream = useCallback(
    (_mimeType = "audio/mpeg") => {
      cleanupPreviousSource();
    },
    [cleanupPreviousSource]
  );

  const appendChunk = useCallback((base64: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    streamChunksRef.current.push(bytes);
  }, []);

  const endStream = useCallback(() => {
    if (!audioRef.current || streamChunksRef.current.length === 0) return;

    const blob = new Blob(streamChunksRef.current as BlobPart[], { type: "audio/mpeg" });
    streamChunksRef.current = [];

    if (currentBlobUrl.current) {
      URL.revokeObjectURL(currentBlobUrl.current);
    }
    const url = URL.createObjectURL(blob);
    currentBlobUrl.current = url;

    audioRef.current.src = url;
    audioRef.current.play().catch((err) => {
      console.warn("[useAudioPlayer] play() rejected:", err);
    });
  }, []);

  /**
   * iOS Safari (y a veces Chrome con autoplay policy) requiere un gesto del
   * usuario antes de permitir audio.play() programatico. Esta funcion se debe
   * llamar desde un onClick/onTouchStart del usuario para "desbloquear" el
   * elemento. Despues, plays subsecuentes desde event handlers funcionan.
   * Idempotente: solo desbloquea la primera vez.
   */
  const unlockAudioRef = useRef(false);
  const unlockAudio = useCallback(async () => {
    if (unlockAudioRef.current || !audioRef.current) return;
    try {
      audioRef.current.muted = true;
      await audioRef.current.play();
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.muted = false;
      unlockAudioRef.current = true;
    } catch {
      // Si el navegador no permite ni el play silenciado, ya no hay mucho que hacer
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

  return {
    audioRef,
    isPlaying,
    playAudio,
    startStream,
    appendChunk,
    endStream,
    unlockAudio,
    stopAudio,
    pauseAudio,
    resumeAudio,
  };
}
