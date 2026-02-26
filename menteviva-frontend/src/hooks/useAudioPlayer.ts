import { useRef, useCallback, useState, useEffect } from "react";

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const currentBlobUrl = useRef<string | null>(null);

  // Crear elemento de audio persistente
  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = "anonymous"; // Necesario para Web Audio API
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

  const playAudio = useCallback((base64: string, mimeType = "audio/mp3") => {
    return new Promise<void>((resolve, reject) => {
      try {
        if (!audioRef.current) {
          reject(new Error("Audio element not initialized"));
          return;
        }

        // Limpiar URL anterior si existe
        if (currentBlobUrl.current) {
          URL.revokeObjectURL(currentBlobUrl.current);
          currentBlobUrl.current = null;
        }

        // Convertir base64 a blob (necesario para Web Audio API)
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
  }, []);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  }, []);

  const pauseAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, []);

  const resumeAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play();
    }
  }, []);

  return {
    audioRef, // Exponer ref para conectar con avatar
    isPlaying,
    playAudio,
    stopAudio,
    pauseAudio,
    resumeAudio,
  };
}
