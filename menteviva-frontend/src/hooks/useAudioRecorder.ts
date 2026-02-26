import { useState, useRef, useCallback } from "react";
import { getBestAudioFormat, isAudioRecordingSupported } from "../utils/audio";

const MIN_RECORDING_MS = 500; // Minimo 500ms de grabacion

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("");
  const startTimeRef = useRef<number>(0);

  const startRecording = useCallback(async () => {
    // Verificar soporte del navegador
    if (!isAudioRecordingSupported()) {
      setError("Tu navegador no soporta grabacion de audio");
      return;
    }

    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Detectar el mejor formato soportado
      const mimeType = getBestAudioFormat();
      mimeTypeRef.current = mimeType;

      const mediaRecorder = new MediaRecorder(stream, { mimeType });

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.start();
      startTimeRef.current = Date.now();
      setIsRecording(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Error desconocido";
      setError(`Error al acceder al microfono: ${errorMessage}`);
      console.error("Error al acceder al microfono:", err);
    }
  }, []);

  const stopRecording = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current) {
        resolve(null);
        return;
      }

      // Verificar duracion minima
      const recordingDuration = Date.now() - startTimeRef.current;
      if (recordingDuration < MIN_RECORDING_MS) {
        // Grabacion muy corta - cancelar
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        setError("Manten presionado para grabar (minimo 0.5 segundos)");
        resolve(null);
        return;
      }

      mediaRecorderRef.current.onstop = async () => {
        // Usar el mimeType detectado
        const mimeType = mimeTypeRef.current || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const base64 = await blobToBase64(blob);
        resolve(base64);
      };

      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      setIsRecording(false);
    });
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { isRecording, error, startRecording, stopRecording, clearError };
}

// Helper
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
