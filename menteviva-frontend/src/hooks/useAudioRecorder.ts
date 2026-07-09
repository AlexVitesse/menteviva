import { useState, useRef, useCallback, useEffect } from "react";
import {
  getBestAudioFormat,
  isAudioRecordingSupported,
  isSecureOriginForMic,
} from "../utils/audio";

const MIN_RECORDING_MS = 500; // Minimo 500ms de grabacion
// Tope de seguridad: un turno hablado real rara vez pasa de 2 minutos y los
// clips gigantes degradan Whisper (y el free tier de Groq). Al llegar al tope
// la grabacion se corta sola y se entrega via onAutoStop.
const MAX_RECORDING_MS = 120_000;

interface UseAudioRecorderOptions {
  // Se dispara cuando la grabacion alcanza MAX_RECORDING_MS y se corta sola.
  // El audio llega listo para enviar, igual que si el usuario hubiera soltado.
  onAutoStop?: (audioBase64: string) => void;
}

export function useAudioRecorder(options: UseAudioRecorderOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Analizador conectado al stream del mic. La UI lo usa para dibujar el nivel
  // de voz real mientras se graba (feedback de "si te estoy escuchando").
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("");
  const startTimeRef = useRef<number>(0);
  const timerIntervalRef = useRef<number | null>(null);
  const maxTimeoutRef = useRef<number | null>(null);
  const onAutoStopRef = useRef(options.onAutoStop);

  useEffect(() => {
    onAutoStopRef.current = options.onAutoStop;
  }, [options.onAutoStop]);

  function clearTimers() {
    if (timerIntervalRef.current !== null) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (maxTimeoutRef.current !== null) {
      clearTimeout(maxTimeoutRef.current);
      maxTimeoutRef.current = null;
    }
  }

  function disableTracks() {
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = false));
  }

  // Obtiene (o reutiliza) el stream del mic. El stream se mantiene vivo entre
  // turnos con los tracks deshabilitados: asi el permiso se pide una sola vez
  // y cada pulsacion arranca al instante, sin perder las primeras palabras
  // mientras getUserMedia resuelve. Track deshabilitado = solo captura silencio.
  const ensureStream = useCallback(async (): Promise<MediaStream> => {
    const current = streamRef.current;
    if (current && current.getAudioTracks().some((t) => t.readyState === "live")) {
      return current;
    }
    // Limpieza de audio del microfono: cancelacion de eco, supresion de ruido
    // y control automatico de ganancia. Mejora la transcripcion de Whisper y
    // reduce el ruido de fondo que el navegador captura por defecto.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;
    stream.getAudioTracks().forEach((t) => (t.enabled = false));

    const Ctx = window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createAnalyser();
    node.fftSize = 256;
    node.smoothingTimeConstant = 0.7;
    source.connect(node);
    audioCtxRef.current = ctx;
    setAnalyser(node);
    return stream;
  }, []);

  function micErrorMessage(err: unknown): string {
    if (err instanceof DOMException) {
      if (err.name === "NotAllowedError" || err.name === "SecurityError") {
        return "Permiso de micrófono denegado. Actívalo en la configuración del navegador (icono de candado junto a la URL).";
      }
      if (err.name === "NotFoundError") {
        return "No se encontró ningún micrófono. Conecta uno e inténtalo de nuevo.";
      }
      if (err.name === "NotReadableError") {
        return "El micrófono está en uso por otra aplicación. Ciérrala e inténtalo de nuevo.";
      }
    }
    const detail = err instanceof Error ? err.message : "Error desconocido";
    return `Error al acceder al micrófono: ${detail}`;
  }

  function checkPreconditions(): boolean {
    if (!isAudioRecordingSupported()) {
      setError("Tu navegador no soporta grabación de audio");
      return false;
    }
    if (!isSecureOriginForMic()) {
      setError(
        "El micrófono solo funciona en HTTPS o localhost. Abre la app desde localhost o un túnel HTTPS."
      );
      return false;
    }
    return true;
  }

  // Pre-calienta el mic: pide el permiso y deja el stream listo. Llamar al
  // entrar a la sesion para que la primera pulsacion no tenga latencia.
  const initMic = useCallback(async (): Promise<boolean> => {
    if (!checkPreconditions()) return false;
    try {
      await ensureStream();
      return true;
    } catch (err) {
      console.error("Error al acceder al microfono:", err);
      setError(micErrorMessage(err));
      return false;
    }
  }, [ensureStream]);

  // Suelta el mic por completo (apaga el indicador de grabacion del navegador).
  // Usar al mutear o al salir de la sesion.
  const releaseMic = useCallback(() => {
    clearTimers();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setAnalyser(null);
    setIsRecording(false);
    setRecordingSeconds(0);
  }, []);

  // Cierra la grabacion en curso y resuelve el audio en base64.
  // enforceMin=false se usa en el auto-stop por tope de duracion.
  const finishRecording = useCallback((enforceMin: boolean): Promise<string | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      clearTimers();
      setIsRecording(false);
      setRecordingSeconds(0);

      if (!recorder || recorder.state === "inactive") {
        resolve(null);
        return;
      }

      const recordingDuration = Date.now() - startTimeRef.current;
      if (enforceMin && recordingDuration < MIN_RECORDING_MS) {
        // Grabacion muy corta - cancelar
        recorder.onstop = null;
        recorder.stop();
        chunksRef.current = [];
        disableTracks();
        setError("Mantén presionado para grabar (mínimo 0.5 segundos)");
        resolve(null);
        return;
      }

      recorder.onstop = async () => {
        const mimeType = mimeTypeRef.current || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        disableTracks();
        resolve(blob.size > 0 ? await blobToBase64(blob) : null);
      };
      recorder.stop();
    });
  }, []);

  const startRecording = useCallback(async () => {
    if (mediaRecorderRef.current?.state === "recording") return;
    if (!checkPreconditions()) return;

    try {
      setError(null);
      const stream = await ensureStream();
      stream.getAudioTracks().forEach((t) => (t.enabled = true));
      // El AudioContext puede nacer suspendido si el stream se pre-calento
      // fuera de un gesto del usuario; aqui ya hay gesto.
      audioCtxRef.current?.resume().catch(() => {});

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

      // timeslice: chunks periodicos en vez de un solo blob gigante al final
      mediaRecorder.start(250);
      startTimeRef.current = Date.now();
      setIsRecording(true);
      setRecordingSeconds(0);

      timerIntervalRef.current = window.setInterval(() => {
        setRecordingSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 250);

      maxTimeoutRef.current = window.setTimeout(async () => {
        const base64 = await finishRecording(false);
        if (base64) onAutoStopRef.current?.(base64);
      }, MAX_RECORDING_MS);
    } catch (err) {
      console.error("Error al acceder al microfono:", err);
      setError(micErrorMessage(err));
    }
  }, [ensureStream, finishRecording]);

  const stopRecording = useCallback((): Promise<string | null> => {
    return finishRecording(true);
  }, [finishRecording]);

  // Descarta la grabacion en curso sin producir audio (p.ej. al mutear).
  const cancelRecording = useCallback(() => {
    clearTimers();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    chunksRef.current = [];
    disableTracks();
    setIsRecording(false);
    setRecordingSeconds(0);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Soltar el mic al desmontar (fin de sesion / navegacion)
  useEffect(() => {
    return () => releaseMic();
  }, [releaseMic]);

  return {
    isRecording,
    recordingSeconds,
    error,
    analyser,
    initMic,
    releaseMic,
    startRecording,
    stopRecording,
    cancelRecording,
    clearError,
  };
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
