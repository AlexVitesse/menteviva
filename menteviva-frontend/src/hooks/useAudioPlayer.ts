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

  // Estado del streaming MSE
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const pendingChunksRef = useRef<ArrayBuffer[]>([]);
  const streamEndedRef = useRef<boolean>(false);

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
    mediaSourceRef.current = null;
    sourceBufferRef.current = null;
    pendingChunksRef.current = [];
    streamEndedRef.current = false;
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

  // Streaming via MediaSource
  const tryDrainQueue = useCallback(() => {
    const sb = sourceBufferRef.current;
    const ms = mediaSourceRef.current;
    if (!sb || sb.updating) return;

    const chunk = pendingChunksRef.current.shift();
    if (chunk) {
      try {
        sb.appendBuffer(chunk);
      } catch (err) {
        console.error("[useAudioPlayer] appendBuffer error:", err);
      }
      return;
    }

    if (streamEndedRef.current && ms && ms.readyState === "open") {
      try {
        ms.endOfStream();
      } catch (err) {
        console.warn("[useAudioPlayer] endOfStream error:", err);
      }
    }
  }, []);

  const startStream = useCallback(
    (mimeType = "audio/mpeg") => {
      if (!audioRef.current) return;

      cleanupPreviousSource();

      const ms = new MediaSource();
      mediaSourceRef.current = ms;

      const url = URL.createObjectURL(ms);
      currentBlobUrl.current = url;

      ms.addEventListener(
        "sourceopen",
        () => {
          try {
            const sb = ms.addSourceBuffer(mimeType);
            sb.addEventListener("updateend", tryDrainQueue);
            sourceBufferRef.current = sb;
            tryDrainQueue();
          } catch (err) {
            console.error("[useAudioPlayer] addSourceBuffer error:", err);
          }
        },
        { once: true }
      );

      audioRef.current.src = url;
      audioRef.current.play().catch((err) => {
        console.warn("[useAudioPlayer] play() rejected:", err);
      });
    },
    [cleanupPreviousSource, tryDrainQueue]
  );

  const appendChunk = useCallback(
    (base64: string) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      pendingChunksRef.current.push(bytes.buffer);
      tryDrainQueue();
    },
    [tryDrainQueue]
  );

  const endStream = useCallback(() => {
    streamEndedRef.current = true;
    tryDrainQueue();
  }, [tryDrainQueue]);

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
    stopAudio,
    pauseAudio,
    resumeAudio,
  };
}
